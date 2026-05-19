use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use warp::Filter;
use serde::{Deserialize, Serialize};

// Estado global em memória para armazenar Código -> IP
type RelayState = Arc<Mutex<HashMap<String, String>>>;

#[derive(Deserialize, Serialize)]
struct RegisterRequest {
    code: String,
    ip: String,
}

#[derive(Serialize)]
struct LookupResponse {
    ip: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

static SERVER_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub async fn start_relay_server() -> Result<String, String> {
    if SERVER_STARTED.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok("Relay Server já está rodando".to_string());
    }

    println!("[Relay] Iniciando servidor na porta 8080...");
    
    let state: RelayState = Arc::new(Mutex::new(HashMap::new()));
    let state_filter = warp::any().map(move || state.clone());

    // POST /register
    let register = warp::post()
        .and(warp::path("register"))
        .and(warp::body::json())
        .and(state_filter.clone())
        .and_then(handle_register);

    // GET /lookup/:code
    let lookup = warp::get()
        .and(warp::path("lookup"))
        .and(warp::path::param())
        .and(state_filter.clone())
        .and_then(handle_lookup);

    // CORS para permitir que o Launcher (frontend) fale com o próprio backend via HTTP se necessário
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "POST"])
        .allow_header("content-type");

    let routes = register.or(lookup).with(cors);

    tokio::spawn(async move {
        warp::serve(routes).run(([0, 0, 0, 0], 8080)).await;
        SERVER_STARTED.store(false, std::sync::atomic::Ordering::SeqCst);
    });

    SERVER_STARTED.store(true, std::sync::atomic::Ordering::SeqCst);
    println!("[Relay] Sucesso: Porta 8080 aberta para o Playit.");
    Ok("Relay Server iniciado com sucesso".to_string())
}

async fn handle_register(
    req: RegisterRequest,
    state: RelayState,
) -> Result<impl warp::Reply, warp::Rejection> {
    println!("[Relay] Registrando código: {} -> {}", req.code, req.ip);
    let mut lock = state.lock().await;
    lock.insert(req.code, req.ip);
    Ok(warp::reply::json(&"Registrado"))
}

async fn handle_lookup(
    code: String,
    state: RelayState,
) -> Result<impl warp::Reply, warp::Rejection> {
    println!("[Relay] Buscando IP para código: {}", code);
    let lock = state.lock().await;
    if let Some(ip) = lock.get(&code) {
        Ok(warp::reply::with_status(
            warp::reply::json(&LookupResponse { ip: ip.clone() }),
            warp::http::StatusCode::OK,
        ))
    } else {
        Ok(warp::reply::with_status(
            warp::reply::json(&ErrorResponse { error: "Código não encontrado".to_string() }),
            warp::http::StatusCode::NOT_FOUND,
        ))
    }
}
