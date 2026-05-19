use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use std::process::{Command, Stdio, ChildStdin};
use std::io::{BufRead, BufReader, Write};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DEADLOCK_APP_ID: &str = "1422450";

/// User override for the Deadlock game directory. When set, bypasses auto-detection.
static GAME_DIR_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);
static SERVER_STDIN: Mutex<Option<ChildStdin>> = Mutex::new(None);
static SERVER_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);

pub(crate) fn set_game_dir_override(path: Option<PathBuf>) {
    *GAME_DIR_OVERRIDE.lock().unwrap() = path;
}

pub(crate) fn get_game_dir_override() -> Option<PathBuf> {
    GAME_DIR_OVERRIDE.lock().unwrap().clone()
}

/// Find Steam install path from the Windows registry.
#[cfg(windows)]
fn find_steam_path() -> Result<PathBuf, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let steam_key = hklm
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        .map_err(|e| format!("Failed to open Steam registry key: {}", e))?;
    let install_path: String = steam_key
        .get_value("InstallPath")
        .map_err(|e| format!("Failed to read Steam InstallPath: {}", e))?;
    Ok(PathBuf::from(install_path))
}

/// Parse libraryfolders.vdf to find all Steam library paths.
fn find_library_folders(steam_path: &PathBuf) -> Result<Vec<PathBuf>, String> {
    let vdf_path = steam_path.join("steamapps").join("libraryfolders.vdf");
    let content = fs::read_to_string(&vdf_path)
        .map_err(|e| format!("Failed to read {}: {}", vdf_path.display(), e))?;

    let mut folders = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("\"path\"") {
            if let Some(val) = extract_vdf_value(trimmed) {
                folders.push(PathBuf::from(val));
            }
        }
    }

    folders.push(steam_path.clone());
    Ok(folders)
}

fn extract_vdf_value(line: &str) -> Option<String> {
    let mut parts = line.splitn(2, "\"path\"");
    parts.next()?;
    let rest = parts.next()?.trim();
    let start = rest.find('"')? + 1;
    let end = rest[start..].find('"')? + start;
    Some(rest[start..end].replace("\\\\", "\\"))
}

/// Find Deadlock's cfg directory across all Steam libraries.
#[cfg(windows)]
pub(crate) fn find_deadlock_cfg_dir() -> Result<PathBuf, String> {
    let steam_path = find_steam_path()?;
    let libraries = find_library_folders(&steam_path)?;

    for lib in &libraries {
        let cfg_dir = lib
            .join("steamapps")
            .join("common")
            .join("Deadlock")
            .join("game")
            .join("citadel")
            .join("cfg");
        if cfg_dir.exists() {
            return Ok(cfg_dir);
        }
    }

    Err("Deadlock installation not found in any Steam library".into())
}

#[cfg(not(windows))]
pub(crate) fn find_deadlock_cfg_dir() -> Result<PathBuf, String> {
    Err("Deadlock detection is only supported on Windows".into())
}

#[derive(serde::Serialize)]
pub struct ConnectResult {
    success: bool,
    method: String,
    message: String,
}

/// Open `steam://connect/<addr>` which tells Steam to launch/join the server.
/// `addr` must be a raw `ip:port` pair; anything else is rejected so the API
/// (or a deep link) cannot smuggle extra URL segments into Steam's handler.
pub(crate) fn connect_to_server_inner(addr: &str) -> Result<ConnectResult, String> {
    if !crate::deep_link::is_valid_ip_port(addr) {
        return Err(format!("invalid server address: {}", addr));
    }
    // Write dominokas_connect.cfg so the player can run "exec dominokas_connect" if the game is already open
    if let Ok(cfg_dir) = get_effective_cfg_dir() {
        let file_path = cfg_dir.join("dominokas_connect.cfg");
        let content = format!("connect {}\n", addr);
        if let Err(e) = fs::write(&file_path, content) {
            eprintln!("[connect] Failed to write dominokas_connect.cfg: {}", e);
        } else {
            eprintln!("[connect] Successfully wrote dominokas_connect.cfg to {:?}", file_path);
        }
    }
    // Formato explícito para garantir que o Steam use o AppID correto do Deadlock
    let steam_url = format!("steam://run/{}//+connect {}", DEADLOCK_APP_ID, addr);
    open::that(&steam_url).map_err(|e| format!("Failed to open Steam: {}", e))?;
    Ok(ConnectResult {
        success: true,
        method: "steam_connect".into(),
        message: format!("Opening {}", steam_url),
    })
}

pub(crate) fn get_effective_cfg_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = get_game_dir_override() {
        let cfg = override_dir.join("citadel").join("cfg");
        if cfg.exists() {
            return Ok(cfg);
        }
    }
    find_deadlock_cfg_dir()
}

pub(crate) fn get_effective_managed_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = get_game_dir_override() {
        // Para servidores: game/bin/win64/managed
        let managed = override_dir.join("bin").join("win64").join("managed");
        if managed.exists() {
            return Ok(managed);
        }
        // Fallback para estrutura sem 'game' no override
        let managed2 = override_dir.join("game").join("bin").join("win64").join("managed");
        if managed2.exists() {
            return Ok(managed2);
        }
    }
    
    // Fallback: Tenta achar a pasta cfg e navegar a partir dela
    let cfg = find_deadlock_cfg_dir()?;
    // De game/citadel/cfg para game/bin/win64/managed
    let managed = cfg.parent().unwrap().parent().unwrap()
        .join("bin").join("win64").join("managed");
    
    Ok(managed)
}

#[tauri::command]
pub fn save_match_state(state_json: String) -> Result<(), String> {
    // Salva na pasta managed para o plugin encontrar mais fácil
    if let Ok(managed_dir) = get_effective_managed_dir() {
        let file_path = managed_dir.join("match_state.json");
        let _ = fs::write(&file_path, &state_json);
    }

    // Mantém o save na cfg por compatibilidade
    if let Ok(cfg_dir) = get_effective_cfg_dir() {
        let file_path = cfg_dir.join("match_state.json");
        fs::write(&file_path, state_json).map_err(|e| format!("Failed to write match_state.json: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn connect_to_match(addr: String) -> Result<ConnectResult, String> {
    eprintln!("[connect] Attempting steam://run/{}//+connect {}", DEADLOCK_APP_ID, addr);
    connect_to_server_inner(&addr)
}

#[tauri::command]
pub fn launch_deadlock() -> Result<(), String> {
    let steam_url = format!("steam://run/{}", DEADLOCK_APP_ID);
    open::that(&steam_url).map_err(|e| format!("Failed to launch Deadlock: {}", e))
}

/// Returns the auto-detected game directory (ignoring any override).
#[tauri::command]
pub fn get_detected_game_dir() -> Result<String, String> {
    let cfg_dir = find_deadlock_cfg_dir()?;
    cfg_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine game directory".into())
}

/// Returns the current effective game directory (override or auto-detected).
#[tauri::command]
pub fn get_game_dir() -> Result<String, String> {
    if let Some(override_dir) = get_game_dir_override() {
        return Ok(override_dir.to_string_lossy().to_string());
    }
    get_detected_game_dir()
}

/// Set a manual override for the game directory.
#[tauri::command]
pub fn set_game_dir(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let citadel = p.join("citadel");
    if !citadel.exists() {
        return Err(format!(
            "Invalid Deadlock directory: expected a 'citadel' folder inside '{}'",
            path
        ));
    }
    set_game_dir_override(Some(p));
    Ok(())
}

/// Clear the manual override, reverting to auto-detection.
#[tauri::command]
pub fn reset_game_dir() {
    set_game_dir_override(None);
}

#[tauri::command]
pub fn send_server_command(command: String) -> Result<(), String> {
    let mut lock = SERVER_STDIN.lock().unwrap();
    if let Some(stdin) = lock.as_mut() {
        writeln!(stdin, "{}", command).map_err(|e| format!("Falha ao enviar comando: {}", e))?;
        stdin.flush().map_err(|e| format!("Falha ao limpar buffer: {}", e))?;
        Ok(())
    } else {
        Err("Servidor não está rodando ou entrada não disponível.".into())
    }
}

#[tauri::command]
pub fn stop_deadlock_server() -> Result<(), String> {
    let mut proc_lock = SERVER_PROCESS.lock().unwrap();
    if let Some(mut child) = proc_lock.take() {
        let _ = child.kill();
        // Limpa também o stdin
        *SERVER_STDIN.lock().unwrap() = None;
        println!("[Connect] Servidor de jogo encerrado.");
        Ok(())
    } else {
        Err("Servidor não está rodando.".into())
    }
}

#[tauri::command]
pub fn start_deadlock_server(app: AppHandle) -> Result<(), String> {
    let deadlock_sv_dir = PathBuf::from("C:\\DeadlockSV");
    if !deadlock_sv_dir.exists() {
        return Err("A pasta C:\\DeadlockSV não foi encontrada.".into());
    }

    // Encontrar o arquivo .bat na raiz da pasta
    let mut bat_file = None;
    if let Ok(entries) = fs::read_dir(&deadlock_sv_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("bat") {
                bat_file = Some(path);
                break;
            }
        }
    }

    let bat_path = bat_file.ok_or("Nenhum arquivo .bat encontrado em C:\\DeadlockSV")?;

    let mut child_cmd = Command::new("cmd");
    child_cmd.arg("/c").arg(&bat_path).current_dir(&deadlock_sv_dir);
    child_cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::piped());

    #[cfg(windows)]
    child_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = child_cmd.spawn()
        .map_err(|e| format!("Falha ao iniciar servidor Deadworks: {}", e))?;

    let stdout = child.stdout.take().ok_or("Sem stdout")?;
    let stderr = child.stderr.take().ok_or("Sem stderr")?;
    let stdin = child.stdin.take().ok_or("Sem stdin")?;

    // Salva o stdin e o Child para uso futuro
    *SERVER_STDIN.lock().unwrap() = Some(stdin);
    *SERVER_PROCESS.lock().unwrap() = Some(child);

    let app_clone1 = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_str) = line {
                // Filtra spam recorrente do motor Source 2 quando rodando sem janela de console
                if !line_str.contains("CTextConsoleWin::GetLine") && !line_str.contains("!GetNumberOfConsoleInputEvents") {
                    let _ = app_clone1.emit("deadlock-server-log", line_str);
                }
            }
        }
    });

    let app_clone2 = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line_str) = line {
                // Filtra spam recorrente do motor Source 2 também no stderr
                if !line_str.contains("CTextConsoleWin::GetLine") && !line_str.contains("!GetNumberOfConsoleInputEvents") {
                    let _ = app_clone2.emit("deadlock-server-log", format!("ERROR: {}", line_str));
                }
            }
        }
    });

    Ok(())
}

