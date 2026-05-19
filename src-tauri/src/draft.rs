use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use std::sync::atomic::{AtomicBool, Ordering};

// Gerenciador de conexões ativas
type ClientList = Arc<Mutex<HashMap<usize, mpsc::UnboundedSender<Message>>>>;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

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

    if SERVER_RUNNING.load(Ordering::SeqCst) {
        println!("[DraftServer] Servidor ja detectado como rodando.");
        return Ok("Servidor ja rodando".to_string());
    }

    // Mata processos zumbis segurando a porta
    kill_process_on_port(27025);

    let addr = "0.0.0.0:27025";
    println!("[DraftServer] Tentando bind em {}...", addr);

    // O bind DEVE ser aguardado aqui para garantir que a porta abriu
    let listener = TcpListener::bind(addr).await.map_err(|e| {
        let err_msg = format!("Erro ao abrir porta {}: {}. Verifique se ha outras instancias abertas.", addr, e);
        println!("[DraftServer] {}", err_msg);
        err_msg
    })?;

    println!("[DraftServer] SUCESSO: Porta 27025 aberta.");
    SERVER_RUNNING.store(true, Ordering::SeqCst);

    let clients: ClientList = Arc::new(Mutex::new(HashMap::new()));
    let clients_clone = clients.clone();

    // Spawn do loop de aceitação em background
    tokio::spawn(async move {
        println!("[DraftServer] Loop de aceitacao iniciado.");
        let mut client_id_counter = 1;

        while let Ok((stream, _addr)) = listener.accept().await {
            let id = client_id_counter;
            client_id_counter += 1;
            
            let clients_for_spawn = clients_clone.clone();
            tokio::spawn(handle_connection(stream, id, clients_for_spawn));
        }
        println!("[DraftServer] Loop de aceitacao encerrado.");
        SERVER_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok("Servidor iniciado".to_string())
}

async fn handle_connection(stream: TcpStream, id: usize, clients: ClientList) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            println!("[DraftServer] Erro no handshake WS (ID {}): {}", id, e);
            return;
        }
    };

    println!("[DraftServer] Cliente {} conectado com sucesso.", id);

    let (mut sender, mut receiver) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    clients.lock().await.insert(id, tx.clone());

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        if msg.is_text() {
            broadcast(&clients, msg, id).await;
        }
    }

    println!("[DraftServer] Cliente {} desconectado.", id);
    clients.lock().await.remove(&id);
    send_task.abort();
}

async fn broadcast(clients: &ClientList, msg: Message, _sender_id: usize) {
    let clients_lock = clients.lock().await;
    for (_id, tx) in clients_lock.iter() {
        let _ = tx.send(msg.clone());
    }
}
