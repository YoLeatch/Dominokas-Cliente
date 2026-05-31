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

#[cfg(windows)]
static ACTIVE_JOB: Mutex<Option<win_job::JobObject>> = Mutex::new(None);

pub(crate) fn set_game_dir_override(path: Option<PathBuf>) {
    *GAME_DIR_OVERRIDE.lock().unwrap() = path;
}

pub(crate) fn get_game_dir_override() -> Option<PathBuf> {
    GAME_DIR_OVERRIDE.lock().unwrap().clone()
}

/// Find Steam install path from the Windows registry.
#[cfg(windows)]
fn find_steam_path() -> Result<PathBuf, String> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER};
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(steam_key) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam") {
        if let Ok(install_path) = steam_key.get_value::<String, _>("InstallPath") {
            return Ok(PathBuf::from(install_path));
        }
    }

    // Fallback search in HKEY_CURRENT_USER
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key_hkcu = hkcu
        .open_subkey("Software\\Valve\\Steam")
        .map_err(|e| format!("Failed to open Steam registry key in HKLM and HKCU: {}", e))?;
    let install_path: String = steam_key_hkcu
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
pub fn set_game_dir(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let citadel = p.join("citadel");
    if !citadel.exists() {
        return Err(format!(
            "Invalid Deadlock directory: expected a 'citadel' folder inside '{}'",
            path
        ));
    }
    set_game_dir_override(Some(p));

    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app, "settings.json").build() {
        store.set("game_dir_override", serde_json::Value::String(path));
        let _ = store.save();
    }
    Ok(())
}

/// Clear the manual override, reverting to auto-detection.
#[tauri::command]
pub fn reset_game_dir(app: AppHandle) -> Result<(), String> {
    set_game_dir_override(None);
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(&app, "settings.json").build() {
        store.delete("game_dir_override");
        let _ = store.save();
    }
    Ok(())
}

#[tauri::command]
pub fn send_server_command(command: String) -> Result<(), String> {
    if command.chars().any(|c| matches!(c, '&' | '|' | '>' | '<' | ';')) {
        return Err("Comando inválido: contém caracteres de controle não permitidos.".into());
    }

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
        #[cfg(windows)]
        {
            *ACTIVE_JOB.lock().unwrap() = None;
        }
        println!("[Connect] Servidor de jogo encerrado.");
        Ok(())
    } else {
        Err("Servidor não está rodando.".into())
    }
}

#[tauri::command]
pub fn start_deadlock_server(app: AppHandle) -> Result<(), String> {
    // Prevenção de Reentrância: verificar se SERVER_PROCESS já possui um processo ativo
    {
        let mut proc_lock = SERVER_PROCESS.lock().unwrap();
        if proc_lock.is_some() {
            let is_alive = if let Some(child) = proc_lock.as_mut() {
                match child.try_wait() {
                    Ok(None) => true, // Processo ainda rodando
                    _ => false, // Processo terminou ou deu erro
                }
            } else {
                false
            };

            if is_alive {
                return Err("Servidor já está rodando.".into());
            } else {
                // Se já terminou, limpamos para poder iniciar outro
                *proc_lock = None;
                *SERVER_STDIN.lock().unwrap() = None;
                #[cfg(windows)]
                {
                    *ACTIVE_JOB.lock().unwrap() = None;
                }
            }
        }
    }

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

    #[cfg(windows)]
    let job = {
        use std::os::windows::io::AsRawHandle;
        let job = win_job::JobObject::new().map_err(|e| format!("Falha ao criar Job Object: {}", e))?;
        job.assign_process(child.as_raw_handle())
            .map_err(|e| format!("Falha ao associar processo ao Job Object: {}", e))?;
        job
    };

    let stdout = child.stdout.take().ok_or("Sem stdout")?;
    let stderr = child.stderr.take().ok_or("Sem stderr")?;
    let stdin = child.stdin.take().ok_or("Sem stdin")?;

    // Salva o stdin e o Child para uso futuro
    *SERVER_STDIN.lock().unwrap() = Some(stdin);
    *SERVER_PROCESS.lock().unwrap() = Some(child);
    #[cfg(windows)]
    {
        *ACTIVE_JOB.lock().unwrap() = Some(job);
    }

    let app_clone1 = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line_str) => {
                    if app_clone1.emit("deadlock-server-log", line_str).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let app_clone2 = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line_str) => {
                    if app_clone2.emit("deadlock-server-log", format!("ERROR: {}", line_str)).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[cfg(windows)]
#[allow(non_snake_case)]
mod win_job {
    use std::os::raw::c_void;
    use std::os::windows::io::RawHandle;

    type HANDLE = *mut c_void;
    type BOOL = i32;
    type DWORD = u32;

    #[repr(C)]
    #[derive(Debug, Copy, Clone)]
    pub struct IO_COUNTERS {
        pub ReadOperationCount: u64,
        pub WriteOperationCount: u64,
        pub OtherOperationCount: u64,
        pub ReadTransferCount: u64,
        pub WriteTransferCount: u64,
        pub OtherTransferCount: u64,
    }

    #[repr(C)]
    #[derive(Debug, Copy, Clone)]
    pub struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        pub PerProcessUserTimeLimit: i64,
        pub PerJobUserTimeLimit: i64,
        pub LimitFlags: DWORD,
        pub MinimumWorkingSetSize: usize,
        pub MaximumWorkingSetSize: usize,
        pub ActiveProcessLimit: DWORD,
        pub Affinity: usize,
        pub PriorityClass: DWORD,
        pub SchedulingClass: DWORD,
    }

    #[repr(C)]
    #[derive(Debug, Copy, Clone)]
    pub struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        pub BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        pub IoInfo: IO_COUNTERS,
        pub ProcessMemoryLimit: usize,
        pub JobMemoryLimit: usize,
        pub PeakProcessMemoryUsed: usize,
        pub PeakJobMemoryUsed: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut c_void, lpName: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            hJob: HANDLE,
            JobObjectInformationClass: u32,
            lpJobObjectInformation: *const c_void,
            cbJobObjectInformationLength: u32,
        ) -> BOOL;
        fn AssignProcessToJobObject(hJob: HANDLE, hProcess: HANDLE) -> BOOL;
        fn CloseHandle(hObject: HANDLE) -> BOOL;
    }

    pub struct JobObject {
        handle: HANDLE,
    }

    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if handle.is_null() {
                    return Err(format!("CreateJobObjectW failed with error: {}", std::io::Error::last_os_error()));
                }
                let mut info = std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
                info.BasicLimitInformation.LimitFlags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

                let res = SetInformationJobObject(
                    handle,
                    9, // JobObjectExtendedLimitInformation
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if res == 0 {
                    let err = std::io::Error::last_os_error();
                    CloseHandle(handle);
                    return Err(format!("SetInformationJobObject failed with error: {}", err));
                }

                Ok(JobObject { handle })
            }
        }

        pub fn assign_process(&self, process_handle: RawHandle) -> Result<(), String> {
            unsafe {
                let res = AssignProcessToJobObject(self.handle, process_handle);
                if res == 0 {
                    return Err(format!("AssignProcessToJobObject failed with error: {}", std::io::Error::last_os_error()));
                }
                Ok(())
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

