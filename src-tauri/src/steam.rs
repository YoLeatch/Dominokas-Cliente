use serde::{Deserialize, Serialize};
use steamworks::Client;

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamUser {
    pub steam_id: String,
    pub name: String,
}

#[tauri::command]
pub fn get_steam_user() -> Result<SteamUser, String> {
    // Usamos o AppID 480 (Spacewar) por padrão para pegar dados do usuário.
    // Isso evita que a Steam diga que você está jogando "Deadlock" apenas por abrir o Launcher.
    // O AppID 480 é o padrão de desenvolvimento da Valve e permite ler Nome e SteamID.
    let client = match Client::init_app(480) {
        Ok((client, _)) => client,
        Err(_) => {
            // Se falhar o 480, tenta o do Deadlock como último recurso
            match Client::init_app(1422450) {
                Ok((client, _)) => client,
                Err(e) => return Err(format!("Falha ao inicializar Steam: {}", e)),
            }
        }
    };

    let steam_id = client.user().steam_id();
    let name = client.friends().name();

    Ok(SteamUser {
        steam_id: steam_id.raw().to_string(),
        name,
    })
}

#[tauri::command]
pub async fn get_steam_avatar(steam_id: String) -> Result<String, String> {
    let url = format!("https://steamcommunity.com/profiles/{}/?xml=1", steam_id);
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    
    // Extrai simples do XML <avatarIcon><![CDATA[URL]]></avatarIcon>
    if let Some(start) = text.find("<avatarIcon><![CDATA[") {
        let after_start = &text[start + 21..];
        if let Some(end) = after_start.find("]]></avatarIcon>") {
            return Ok(after_start[..end].to_string());
        }
    }
    
    Err("Avatar não encontrado".to_string())
}
