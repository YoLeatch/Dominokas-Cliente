mod addons;
mod connect;
mod deep_link;
mod draft;
mod gameinfo;
mod ping;
mod playit;
mod relay;
mod steam;
mod telemetry;

#[tauri::command]
fn save_last_address(app: tauri::AppHandle, address: String) -> Result<(), String> {
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app, "settings.json").build() {
        store.set("last_playit_address", serde_json::Value::String(address));
        let _ = store.save();
    }
    Ok(())
}

#[tauri::command]
fn get_last_address(app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app, "settings.json").build() {
        if let Some(val) = store.get("last_playit_address") {
            if let Some(s) = val.as_str() {
                return Ok(s.to_string());
            }
        }
    }
    Ok("".to_string())
}

/// Try to patch gameinfo.gi at startup. If the game is running the file is
/// locked, so we just log and move on — the user will be told at connect time.
fn patch_gameinfo_on_startup() {
    let game_dir_buf;
    let game_dir: &std::path::Path = if let Some(override_dir) = connect::get_game_dir_override() {
        game_dir_buf = override_dir;
        &game_dir_buf
    } else {
        let cfg_dir = match connect::find_deadlock_cfg_dir() {
            Ok(d) => d,
            Err(_) => return, // Deadlock not installed, nothing to do
        };
        game_dir_buf = match cfg_dir.parent().and_then(|p| p.parent()) {
            Some(d) => d.to_path_buf(),
            None => return,
        };
        &game_dir_buf
    };
    match gameinfo::ensure_addonroot(game_dir) {
        Ok(true) => println!("[startup] Patched gameinfo.gi with addonroot"),
        Ok(false) => {} // already present
        Err(e) => println!("[startup] Could not patch gameinfo.gi (game may be running): {}", e),
    }
}

#[tauri::command]
fn save_playit_address(app: tauri::AppHandle, address: String) -> Result<(), String> {
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app, "settings.json").build() {
        store.set("manual_playit_address", serde_json::Value::String(address));
        let _ = store.save();
    }
    Ok(())
}

#[tauri::command]
fn get_playit_address(app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app, "settings.json").build() {
        if let Some(val) = store.get("manual_playit_address") {
            if let Some(s) = val.as_str() {
                return Ok(s.to_string());
            }
        }
    }
    Ok("".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in &args {
                if arg.starts_with("dominokas://") {
                    deep_link::dispatch(app, deep_link::parse_url(arg));
                }
            }
            deep_link::surface_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(deep_link::DeepLinkStateContainer::new())
        .invoke_handler(tauri::generate_handler![
            connect::launch_deadlock,
            connect::get_detected_game_dir,
            connect::get_game_dir,
            connect::set_game_dir,
            connect::reset_game_dir,
            connect::start_deadlock_server,
            connect::stop_deadlock_server,
            connect::check_game_server_running,
            connect::send_server_command,
            connect::save_match_state,
            connect::connect_to_match,
            addons::prepare_and_connect,
            ping::ping_server,
            deep_link::deep_link_ready,
            steam::get_steam_user,
            steam::get_steam_avatar,
            playit::start_tunnel,
            playit::stop_tunnel,
            relay::start_relay_server,
            draft::start_draft_server,
            save_last_address,
            get_last_address,
            save_playit_address,
            get_playit_address,
        ])
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;
            use tauri_plugin_deep_link::DeepLinkExt;

            // Register the deadworks:// scheme at runtime for dev / portable runs.
            // Bundled installers (MSI/NSIS) write the registry entry at install time
            // via tauri.conf.json, so this is a no-op for packaged builds.
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            let _ = app.deep_link().register("dominokas");

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    deep_link::dispatch(&handle, deep_link::parse_url(url.as_str()));
                }
                deep_link::surface_main_window(&handle);
            });

            // Restore game directory override from persisted settings
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app_handle, "settings.json").build() {
                    if let Some(path) = store.get("game_dir_override").and_then(|v| v.as_str().map(String::from)) {
                        connect::set_game_dir_override(Some(std::path::PathBuf::from(path)));
                    }
                }
                patch_gameinfo_on_startup();
                telemetry::maybe_send_install(&app_handle);
                telemetry::maybe_send_heartbeat(&app_handle);

                // Inicia o Relay Server automaticamente em background na porta 8080
                match relay::start_relay_server().await {
                    Ok(_) => println!("[startup] Relay Server iniciado automaticamente na porta 8080"),
                    Err(e) => println!("[startup] Falha ao iniciar Relay Server: {}", e),
                }
            });

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let launch = MenuItem::with_id(app, "launch", "Launch Deadlock", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &launch, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Dominokas")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "launch" => {
                        let _ = open::that(format!("steam://run/{}", "1422450"));
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only hide the main window to tray; let other windows close normally
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                println!("[lib] App exiting. Cleaning up processes...");
                let _ = connect::stop_deadlock_server();
                let _ = playit::stop_tunnel();
            }
        });
}
