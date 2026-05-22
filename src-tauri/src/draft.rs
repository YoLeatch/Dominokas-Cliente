use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;

// Estrutura para armazenar informações do jogador e seu canal de envio
struct ClientInfo {
    sender: mpsc::UnboundedSender<Message>,
    steam_id: Option<String>,
    name: Option<String>,
    peer_addr: String,
    is_host: bool,
}

// Gerenciador de conexões ativas
type ClientList = Arc<Mutex<HashMap<usize, ClientInfo>>>;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static HOST_STEAM_ID: StdMutex<Option<String>> = StdMutex::new(None);

#[cfg(windows)]
fn kill_process_on_port(port: u16) {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = Command::new("cmd")
        .args(&["/C", &format!("netstat -ano | findstr :{}", port)])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
        
    if let Ok(out) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // line looks like: TCP    0.0.0.0:27025    0.0.0.0:0    LISTENING    12345
            if parts.len() >= 5 && parts[1].ends_with(&format!(":{}", port)) && parts[3] == "LISTENING" {
                if let Some(pid_str) = parts.last() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        // Não tenta matar o próprio processo
                        if pid > 0 && pid != std::process::id() {
                            println!("[DraftServer] Encontrado processo {} segurando a porta {}. Tentando encerrar...", pid, port);
                            let _ = Command::new("taskkill")
                                .args(&["/F", "/PID", &pid.to_string()])
                                .creation_flags(CREATE_NO_WINDOW)
                                .output();
                            // Aguarda um instante para o SO liberar a porta
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                    }
                }
            }
        }
    }
}

#[cfg(not(windows))]
fn kill_process_on_port(_port: u16) {}

#[tauri::command]
pub async fn start_draft_server() -> Result<String, String> {
    println!("[DraftServer] Recebido comando para iniciar servidor...");

    if SERVER_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        println!("[DraftServer] Servidor ja detectado como rodando.");
        return Ok("Servidor ja rodando".to_string());
    }

    // Inicializa ou limpa o HOST_STEAM_ID usando a API do Steam local
    {
        let mut host_id_lock = HOST_STEAM_ID.lock().unwrap();
        *host_id_lock = crate::steam::get_steam_user().ok().map(|u| u.steam_id);
        println!("[DraftServer] Host Steam ID inicializado: {:?}", *host_id_lock);
    }

    // Mata processos zumbis segurando a porta
    kill_process_on_port(27025);

    let addr = "0.0.0.0:27025";
    println!("[DraftServer] Tentando bind em {}...", addr);

    // O bind DEVE ser aguardado aqui para garantir que a porta abriu
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            let err_msg = format!("Erro ao abrir porta {}: {}. Verifique se ha outras instancias abertas.", addr, e);
            println!("[DraftServer] {}", err_msg);
            SERVER_RUNNING.store(false, Ordering::SeqCst);
            return Err(err_msg);
        }
    };

    println!("[DraftServer] SUCESSO: Porta 27025 aberta.");

    let clients: ClientList = Arc::new(Mutex::new(HashMap::new()));
    let clients_clone = clients.clone();

    // Spawn do loop de aceitação em background
    tokio::spawn(async move {
        println!("[DraftServer] Loop de aceitacao iniciado.");
        let mut client_id_counter = 1;

        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let id = client_id_counter;
                    client_id_counter += 1;
                    
                    let clients_for_spawn = clients_clone.clone();
                    tokio::spawn(handle_connection(stream, id, addr.to_string(), clients_for_spawn));
                }
                Err(e) => {
                    println!("[DraftServer] Erro no listener accept: {}. Aguardando 50ms...", e);
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        }
    });

    Ok("Servidor iniciado".to_string())
}

async fn handle_connection(stream: TcpStream, id: usize, peer_addr: String, clients: ClientList) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            println!("[DraftServer] Erro no handshake WS (ID {}): {}", id, e);
            return;
        }
    };

    println!("[DraftServer] Cliente {} conectado com sucesso do IP {}.", id, peer_addr);

    let (mut sender, mut receiver) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    let client_info = ClientInfo {
        sender: tx.clone(),
        steam_id: None,
        name: None,
        peer_addr: peer_addr.clone(),
        is_host: false,
    };

    clients.lock().await.insert(id, client_info);

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        if msg.is_text() {
            let mut skip_broadcast = false;
            
            if let Ok(text) = msg.to_text() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
                    let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("UNKNOWN");
                    
                    // 1. Obter informações de estado do remetente
                    let (sender_steam_id, sender_is_host, sender_name) = {
                        let lock = clients.lock().await;
                        if let Some(info) = lock.get(&id) {
                            (info.steam_id.clone(), info.is_host, info.name.clone().unwrap_or_else(|| format!("Cliente {}", id)))
                        } else {
                            (None, false, format!("Cliente {}", id))
                        }
                    };

                    // 2. Intercepta mensagens JOIN_ROOM para registrar o jogador e autenticar se é host
                    if msg_type == "JOIN_ROOM" {
                        if let Some(player) = val.get("player") {
                            let steam_id = player.get("steamId").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let name = player.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let is_host_req = player.get("isHost").and_then(|v| v.as_bool()).unwrap_or(false);
                            
                            if let (Some(s_id), Some(n)) = (steam_id, name) {
                                let mut clients_lock = clients.lock().await;
                                let mut host_id_lock = HOST_STEAM_ID.lock().unwrap();
                                
                                // Se não houver Host Steam ID ainda, ou se o usuário requisitar e bater com o obtido via API local
                                if host_id_lock.is_none() && is_host_req {
                                    *host_id_lock = Some(s_id.clone());
                                }
                                
                                let is_real_host = if let Some(ref h_id) = *host_id_lock {
                                    h_id == &s_id
                                } else {
                                    is_host_req
                                };

                                println!("[DraftServer] Vinculando Cliente {} ao jogador '{}' (Steam ID: {}), Host={}, IP={}", id, n, s_id, is_real_host, peer_addr);
                                if let Some(info) = clients_lock.get_mut(&id) {
                                    info.steam_id = Some(s_id);
                                    info.name = Some(n);
                                    info.is_host = is_real_host;
                                }
                            }
                        }
                    }

                    // 3. Impede tráfego de qualquer ação antes do registro via JOIN_ROOM
                    if sender_steam_id.is_none() && msg_type != "JOIN_ROOM" && msg_type != "HEARTBEAT" {
                        println!("[DraftServer] [REJEITADO] Mensagem '{}' de Cliente {} sem JOIN_ROOM prévio.", msg_type, id);
                        skip_broadcast = true;
                    }
                    
                    // 4. Antispoofing rígido: comandos administrativos somente do Host
                    else {
                        let admin_commands = [
                            "STATE_UPDATE", "PAUSE_DRAFT", "START_DRAFT", "RESUME_DRAFT",
                            "UNDO_DRAFT_ACTION", "RESTART_DRAFT", "START_MATCH", "END_MATCH"
                        ];
                        if admin_commands.contains(&msg_type) {
                            if !sender_is_host {
                                println!("[DraftServer] [WARNING] [SPOOF_ATTEMPT] Cliente '{}' (ID {}) tentou enviar admin-cmd '{}' sem ser Host!", sender_name, id, msg_type);
                                skip_broadcast = true;
                            }
                        }
                        
                        // 5. Antispoofing rígido: escolhas e bans pertencentes ao próprio jogador (ou ao Host como fallback)
                        let action_commands = ["BAN_HERO", "LOCK_HERO", "SELECT_HERO"];
                        if action_commands.contains(&msg_type) {
                            let msg_steam_id = val.get("steamId").and_then(|v| v.as_str());
                            if let Some(s_id) = msg_steam_id {
                                if let Some(ref actual_s_id) = sender_steam_id {
                                    if s_id != actual_s_id && !sender_is_host {
                                        println!("[DraftServer] [WARNING] [SPOOF_ATTEMPT] Cliente '{}' (ID {}) tentou agir por '{}' no comando '{}'!", sender_name, id, s_id, msg_type);
                                        skip_broadcast = true;
                                    }
                                }
                            }
                        }
                    }

                    if !skip_broadcast {
                        println!("[DraftServer] [MSG] De '{}': tipo '{}'", sender_name, msg_type);
                    }
                }
            }

            if !skip_broadcast {
                broadcast(&clients, msg, id).await;
            }
        }
    }

    // Ao cair a conexão, verifica se estava vinculado a um jogador
    let mut lock = clients.lock().await;
    if let Some(removed_client) = lock.remove(&id) {
        if let (Some(steam_id), Some(name)) = (removed_client.steam_id, removed_client.name) {
            println!("[DraftServer] Jogador '{}' (Steam ID: {}) desconectado abruptamente do IP: {}", name, steam_id, removed_client.peer_addr);
            
            // Envia um broadcast avisando sobre a desconexão para os demais clientes
            let dc_msg_value = serde_json::json!({
                "type": "PLAYER_DISCONNECTED",
                "steamId": steam_id,
                "name": name
            });
            if let Ok(dc_msg_str) = serde_json::to_string(&dc_msg_value) {
                let dc_msg = Message::Text(dc_msg_str);
                
                // Realiza o broadcast manual para os sobreviventes
                for (&other_id, other_client) in lock.iter() {
                    if other_id != id {
                        let _ = other_client.sender.send(dc_msg.clone());
                    }
                }
            }
        } else {
            println!("[DraftServer] Cliente desconectado (sem jogador vinculado): ID={}, IP={}", id, removed_client.peer_addr);
        }
    }

    send_task.abort();
}

async fn broadcast(clients: &ClientList, msg: Message, _sender_id: usize) {
    let clients_lock = clients.lock().await;
    for (_id, client) in clients_lock.iter() {
        let _ = client.sender.send(msg.clone());
    }
}
