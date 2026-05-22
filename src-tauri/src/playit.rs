// -*- coding: utf-8 -*-
use tauri::{command, Manager, AppHandle, Emitter};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio, Child};
use std::time::{Duration, Instant};
use std::sync::{Mutex, OnceLock};

static PLAYIT_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn get_process_guard() -> &'static Mutex<Option<Child>> {
    PLAYIT_PROCESS.get_or_init(|| Mutex::new(None))
}

const TUNNEL_TIMEOUT_SECS: u64 = 45;

#[command]
pub fn stop_tunnel() -> Result<(), String> {
    if let Ok(mut guard) = get_process_guard().lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            println!("[Playit] Tunel encerrado com sucesso.");
        }
    }
    Ok(())
}

#[command]
pub async fn start_tunnel(app: AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || try_start_tunnel(app))
        .await
        .map_err(|e| format!("Task falhou: {}", e))?
}

fn try_start_tunnel(app: AppHandle) -> Result<String, String> {
    let _ = app.emit("deadlock-server-log", "[Playit] Iniciando diagnóstico de túnel...");

    // Garante que o diretório de dados do app existe para usar como working dir
    let app_data = app.path().app_data_dir().map_err(|e| format!("Falha ao obter AppData: {}", e))?;
    if !app_data.exists() {
        let _ = std::fs::create_dir_all(&app_data);
    }
    
    let mut possible_paths = Vec::new();

    // 1. Tenta via recurso do Tauri
    if let Ok(resource_path) = app.path().resolve("bin/playit.exe", tauri::path::BaseDirectory::Resource) {
        if resource_path.exists() {
            possible_paths.push(resource_path.to_string_lossy().to_string());
        }
    }

    // 2. Tenta na mesma pasta do executável
    if let Ok(exe_dir) = std::env::current_exe().map(|p| p.parent().unwrap_or(&p).to_path_buf()) {
        let local_playit = exe_dir.join("playit.exe");
        if local_playit.exists() {
            possible_paths.push(local_playit.to_string_lossy().to_string());
        }
    }

    // 3. Fallbacks
    possible_paths.extend(vec![
        "playit.exe".to_string(),
        "playit".to_string(),
        "C:\\Program Files\\playit_gg\\bin\\playit.exe".to_string()
    ]);

    // Remove duplicatas e limpa prefixo de caminho longo do Windows (\\?\) que pode bugar alguns binários
    let mut unique_paths = Vec::new();
    for p in possible_paths {
        let clean_p = p.replace("\\\\?\\", "");
        if !unique_paths.contains(&clean_p) {
            unique_paths.push(clean_p);
        }
    }

    // Verifica se já existe um processo rodando
    if let Ok(mut process_guard) = get_process_guard().lock() {
        if let Some(mut old_child) = process_guard.take() {
            let _ = old_child.kill();
        }
    }

    let mut child = None;
    let mut last_error = String::new();

    // Limpeza de caminhos mais agressiva
    let clean_paths: Vec<String> = unique_paths.into_iter().map(|p| {
        p.trim_start_matches(r"\\?\").to_string()
    }).collect();

    for path in &clean_paths {
        let _ = app.emit("deadlock-server-log", format!("[Playit] Tentando: {}", path));
        let mut cmd = Command::new(path);
        cmd.arg("start")
           .current_dir(&app_data)
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.spawn() {
            Ok(c) => {
                let _ = app.emit("deadlock-server-log", format!("[Playit] Processo ID {} iniciado.", c.id()));
                child = Some(c);
                break;
            }
            Err(e) => {
                last_error = format!("{}: {}", path, e);
                let _ = app.emit("deadlock-server-log", format!("[Playit] Falha ao spawnar {}: {}", path, e));
            }
        }
    }

    let mut child = match child {
        Some(c) => c,
        None => return Err(format!("Playit nao encontrado. Ultimo erro: {}", last_error)),
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // SALVA O CHILD IMEDIATAMENTE NO GUARD PARA PODER MATAR DEPOIS SE DER TIMEOUT OU RESTART
    if let Ok(mut guard) = get_process_guard().lock() {
        *guard = Some(child);
    }

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    
    // Thread para monitorar se o processo encerrou
    let tx_out = tx.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if tx_out.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let tx_err = tx.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if tx_err.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    drop(tx);

    let deadline = Instant::now() + Duration::from_secs(TUNNEL_TIMEOUT_SECS);
    let mut line_count = 0;

    while Instant::now() < deadline {
        // Verifica se o processo morreu checando pelo guard
        let mut is_dead = false;
        let mut exit_status = None;
        if let Ok(mut guard) = get_process_guard().lock() {
            if let Some(c) = guard.as_mut() {
                if let Ok(Some(status)) = c.try_wait() {
                    is_dead = true;
                    exit_status = Some(status);
                }
            }
        }

        if is_dead {
            let _ = app.emit("deadlock-server-log", format!("[Playit] ERRO: Processo encerrou com status {:?}", exit_status));
            return Err(format!("Playit parou inesperadamente (status {:?})", exit_status));
        }

        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => {
                line_count += 1;
                let _ = app.emit("deadlock-server-log", format!("[Playit] {}", line));
                
                if let Some(addr) = parse_tunnel_address(&line) {
                    let _ = app.emit("deadlock-server-log", format!("[Playit] SUCESSO! Endereço: {}", addr));
                    // Não damos kill aqui, deixamos ele no guard para a partida usar
                    return Ok(addr);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                let _ = app.emit("deadlock-server-log", "[Playit] Canal de logs desconectado.");
                break;
            },
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
        }
    }

    if let Ok(mut guard) = get_process_guard().lock() {
        if let Some(mut c) = guard.take() {
            let _ = c.kill();
        }
    }

    if line_count == 0 {
        Err("Playit nao produziu nenhuma saida de texto. Verifique firewall ou se o binario e valido.".to_string())
    } else {
        Err("Timeout aguardando endereco do Playit. Verifique os logs acima para o erro real.".to_string())
    }
}

fn parse_tunnel_address(line: &str) -> Option<String> {
    let line_lower = line.to_lowercase();

    // Padroes conhecidos do playit CLI
    let keywords = [
    "tunnel address:",
    "address:",
    "allocated tcp",
    "allocated udp",
    "tcp tunnel at",
    "udp tunnel at",
    "connectar:",
    "listening at",
    "→ localhost",      
    "-> localhost",     
    "tcp tunnel",       
    ];

    for keyword in keywords {
        if let Some(pos) = line_lower.find(keyword) {
            let after = line[pos + keyword.len()..].trim();
            let after = after
                .trim_start_matches("tcp://")
                .trim_start_matches("udp://");
            
            let candidate = after
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|c: char| !c.is_alphanumeric() && c != '.' && c != ':' && c != '-');

            if is_valid_tunnel_address(candidate) {
                return Some(candidate.to_string());
            }
        }
    }

    for word in line.split_whitespace() {
        let clean = word.trim_matches(|c: char| {
            !c.is_alphanumeric() && c != '.' && c != ':' && c != '-'
        });
        if is_valid_tunnel_address(clean) {
            return Some(clean.to_string());
        }
    }

    None
}

fn is_valid_tunnel_address(s: &str) -> bool {
    let is_playit_host = s.contains(".ply.gg:")
        || s.contains(".playit.gg:")
        || s.contains(".gl.at.ply.gg:");

    if !is_playit_host {
        return false;
    }

    if let Some(colon_pos) = s.rfind(':') {
        let port_str = &s[colon_pos + 1..];
        return port_str.parse::<u16>().is_ok();
    }

    false
}