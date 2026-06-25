// MiniMax Agent Desktop - Tauri 2.x shell
//
// Responsibilities:
// - Boot the React frontend
// - Spawn the FastAPI backend as a sidecar (PyInstaller-frozen exe preferred,
//   Python source as last-resort fallback for dev without a built bundle)
// - Expose Tauri commands to control the backend lifecycle
// - Forward backend stdout/stderr to the frontend for live logs
// - On startup, auto-launch the backend, then healthcheck `/api/config`
//   before signalling success — the React UI can show a clear error toast
//   instead of hanging on a half-up server.
// - On Windows, attach the spawned backend to a Job Object with
//   KILL_ON_JOB_CLOSE so that an unexpected death of the Tauri process
//   (crash, Stop-Process, power loss) brings the backend down too —
//   no orphan on :8765.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

struct BackendProcess(Mutex<Option<Child>>);

/// On Windows: the OS handle of the Job Object the backend is attached
/// to, wrapped in a `std::os::windows::io::OwnedHandle` (which is
/// `Send + Sync` and closes via `CloseHandle` on drop). The job is
/// configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so closing
/// the handle (intentionally or via process death) is what kills the
/// backend. We keep the handle alive in app state for the lifetime of
/// the Tauri process; the OS then closes it during process cleanup
/// (graceful exit, crash, or `Stop-Process -Force`), which is the
/// moment we want the child to die.
///
/// On non-Windows, this state is unused.
#[cfg(windows)]
struct BackendJob(Mutex<Option<std::os::windows::io::OwnedHandle>>);
#[cfg(not(windows))]
struct BackendJob(Mutex<Option<()>>);

const BACKEND_PORT: &str = "8765";
const BACKEND_URL: &str = "http://127.0.0.1:8765";
const HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Walk up from the resource dir until we find a directory that looks
/// like the project root (one containing `dist/backend/backend.exe`,
/// which is the onedir artifact produced by the PyInstaller spike).
/// Used to locate the dev-time binary in option (b) below.
fn repo_root_with_dist(app: &AppHandle) -> Result<PathBuf, String> {
    let mut p = app
        .path()
        .resource_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .map_err(|e| format!("Could not resolve resource dir: {}", e))?;
    for _ in 0..8 {
        if p.join("dist").join("backend").join("backend.exe").exists() {
            return Ok(p);
        }
        if !p.pop() {
            break;
        }
    }
    Err("Repo root (containing dist/backend/backend.exe) not found".into())
}

/// Resolve which backend binary to spawn, in this order:
///   a) `<resource_dir>/backend/backend.exe`   — installed/production bundle
///   b) `<repo_root>/dist/backend/backend.exe` — dev: artifact from the
///                                               PyInstaller spike
///   c) `py -3.10 web/backend/main.py`        — last-resort fallback when
///                                               neither frozen artifact
///                                               exists (e.g. fresh clone,
///                                               `py -3.10` on PATH)
/// Returns `(program, args, cwd, kind)` where `kind` is a short tag for logging.
fn resolve_backend_binary(app: &AppHandle) -> Result<(String, Vec<String>, PathBuf, &'static str), String> {
    // (a) production: bundled alongside the app
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("backend").join("backend.exe");
        if bundled.exists() {
            eprintln!("[minimax-desktop] backend: using bundled exe (a) {}", bundled.display());
            return Ok((bundled.to_string_lossy().into_owned(), vec![], bundled.parent().unwrap().to_path_buf(), "a"));
        }
    }

    // (b) dev: PyInstaller onedir artifact at <repo>/dist/backend/backend.exe
    if let Ok(repo) = repo_root_with_dist(app) {
        let dev = repo.join("dist").join("backend").join("backend.exe");
        if dev.exists() {
            eprintln!("[minimax-desktop] backend: using dev artifact (b) {}", dev.display());
            return Ok((dev.to_string_lossy().into_owned(), vec![], dev.parent().unwrap().to_path_buf(), "b"));
        }
    }

    // (c) fallback: Python source. Walks up looking for web/backend/main.py
    let mut p = app
        .path()
        .resource_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .map_err(|e| format!("Could not resolve resource dir: {}", e))?;
    for _ in 0..8 {
        let main_py = p.join("web").join("backend").join("main.py");
        if main_py.exists() {
            eprintln!("[minimax-desktop] backend: falling back to py -3.10 (c) {}", main_py.display());
            return Ok((
                "py".to_string(),
                vec!["-3.10".to_string(), main_py.to_string_lossy().into_owned()],
                p.join("web").join("backend"),
                "c",
            ));
        }
        if !p.pop() {
            break;
        }
    }
    Err("No backend binary found (tried bundled exe, dev artifact, and py -3.10 main.py)".into())
}

/// Ensure the user-writable project root exists. This is where
/// `config/config.yaml`, `workspace/conversations`, `workspace/uploads`,
/// and `workspace/.user_profile.json` will live. We point
/// `MINIMAX_PROJECT_ROOT` here so the frozen exe (whose `__file__` is
/// inside `_internal/`) writes user data outside the read-only bundle.
fn ensure_user_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Could not resolve app_local_data_dir: {}", e))?;
    let config_dir = dir.join("config");
    let workspace_dir = dir.join("workspace");
    std::fs::create_dir_all(&config_dir).map_err(|e| format!("create_dir_all({}): {}", config_dir.display(), e))?;
    std::fs::create_dir_all(&workspace_dir).map_err(|e| format!("create_dir_all({}): {}", workspace_dir.display(), e))?;
    Ok(dir)
}

/// Poll `/api/config` until 200 or timeout. Tells the caller whether
/// the backend actually bound the port and finished starting up — much
/// more reliable than just checking "process exists" (the exe can be
/// up but still importing the world).
fn healthcheck_backend(timeout: Duration) -> Result<(), String> {
    let url = format!("{}/api/config", BACKEND_URL);
    let deadline = Instant::now() + timeout;
    let mut last_err = String::new();
    while Instant::now() < deadline {
        match ureq_get(&url) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = e;
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    Err(format!(
        "Backend did not respond on {} within {:?} (last error: {})",
        url, timeout, last_err
    ))
}

/// Tiny stdlib-only HTTP GET. We avoid pulling in `reqwest`/`ureq`
/// just for one healthcheck call. Returns Ok(()) on HTTP 2xx.
fn ureq_get(url: &str) -> Result<(), String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    // Parse http://127.0.0.1:8765/api/config
    let stripped = url.trim_start_matches("http://");
    let (host_port, path) = stripped
        .split_once('/')
        .map(|(hp, p)| (hp, format!("/{}", p)))
        .unwrap_or((stripped, "/".to_string()));
    let mut stream = TcpStream::connect(host_port)
        .map_err(|e| format!("connect {}: {}", host_port, e))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1000)))
        .map_err(|e| e.to_string())?;
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, host_port
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).map_err(|e| format!("read: {}", e))?;
    let head = String::from_utf8_lossy(&buf[..n.min(buf.len())]);
    if head.contains(" 200 ") || head.contains(" 201 ") {
        Ok(())
    } else {
        Err(format!("non-2xx: {}", head.lines().next().unwrap_or("")))
    }
}

/// Windows-only: create a Job Object, configure it to kill every
/// process assigned to it when the job's last handle closes, and
/// attach the given child to it. Returns the job handle as a
/// `std::os::windows::io::OwnedHandle` (Send + Sync, closes on drop
/// via `CloseHandle`). The caller stores it in `BackendJob` for the
/// lifetime of the app; when the Tauri process exits, `OwnedHandle`'s
/// drop fires (or, on a hard crash, the OS reclaims the handle as
/// part of process teardown) and the backend dies via
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
///
/// On non-Windows this is a no-op.
#[cfg(windows)]
fn attach_to_job(child: &Child) -> Result<std::os::windows::io::OwnedHandle, String> {
    use std::mem::{size_of, ManuallyDrop};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        // 1) Create the job. Returning null means another process already
        //    has a job with the same name, but we pass None for both args
        //    so the name is always NULL and there is no collision.
        let job: HANDLE = CreateJobObjectW(None, None)
            .map_err(|e| format!("CreateJobObjectW: {}", e))?;
        if job.is_invalid() {
            return Err("CreateJobObjectW returned an invalid handle".into());
        }

        // 2) Configure KILL_ON_JOB_CLOSE so the OS kills the child the
        //    moment the job handle closes (which only happens when the
        //    Tauri process is being torn down).
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| format!("SetInformationJobObject: {}", e))?;

        // 3) Attach the child. We do not have PROCESS_ALL_ACCESS, but
        //    PROCESS_SET_QUOTA + PROCESS_TERMINATE is what
        //    AssignProcessToJobObject needs (the docs are explicit).
        //    The Child's raw handle already has those access bits
        //    because the OS gave us the handle when we spawned it.
        AssignProcessToJobObject(job, HANDLE(child.as_raw_handle()))
            .map_err(|e| format!("AssignProcessToJobObject: {}", e))?;

        // 4) Transfer ownership: the `HANDLE` wrapper from `windows` is
        //    `Drop` (it would CloseHandle on the way out), so we wrap
        //    it in `ManuallyDrop` to suppress that, and hand the raw
        //    pointer to an `OwnedHandle` which becomes the sole owner
        //    that closes the handle when the app exits.
        let md = ManuallyDrop::new(job);
        let raw = md.0;
        let owned: OwnedHandle = OwnedHandle::from_raw_handle(raw);
        Ok(owned)
    }
}

#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: State<BackendProcess>,
    _python_path: Option<String>,
) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("Backend already running".into());
    }

    let (program, args_prefix, cwd, kind) = resolve_backend_binary(&app)?;
    let user_root = ensure_user_data_root(&app)?;

    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&log_dir).ok();
    let stdout_log = log_dir.join("backend.stdout.log");
    let stderr_log = log_dir.join("backend.stderr.log");
    let stdout_file = std::fs::File::create(&stdout_log).map_err(|e| e.to_string())?;
    let stderr_file = std::fs::File::create(&stderr_log).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&program);
    cmd.args(&args_prefix)
        .env("PORT", BACKEND_PORT)
        // User data dir is writable and stable across upgrades. The
        // frozen exe's __file__ points inside _internal/ (read-only),
        // so we have to redirect writes here.
        .env("MINIMAX_PROJECT_ROOT", &user_root)
        // Disable the dev hot-reloader for the frozen exe — see
        // web/backend/main.py for why.
        .env("MINIMAX_RELOAD", "0")
        .current_dir(&cwd)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .stdin(Stdio::null());

    // Hide the console window of the backend.exe (a PyInstaller console
    // app). Without this, Windows allocates a stray black console window
    // every launch — which screams "not a real app". stdout/stderr are
    // already redirected to log files, so we need no console for I/O.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn backend ({}): {} (logs: {})", program, e, stderr_log.display()))?;

    // Attach to a Job Object on Windows so the backend cannot outlive
    // the Tauri process — covers crashes, Stop-Process -Force, and
    // power loss. The job handle is kept alive in app state until
    // the process dies.
    #[cfg(windows)]
    {
        let job_owned = attach_to_job(&child)?;
        if let Ok(mut job_guard) = app.state::<BackendJob>().0.lock() {
            *job_guard = Some(job_owned);
        }
        eprintln!(
            "[minimax-desktop] backend attached to job (PID={:?})",
            child.id()
        );
    }

    let pid = child.id();
    *guard = Some(child);

    Ok(format!(
        "Backend started (kind={}, PID: {:?}, program: {}, cwd: {}, user_data: {}, logs: {})",
        kind, pid, program, cwd.display(), user_root.display(), stderr_log.display()
    ))
}

#[tauri::command]
fn stop_backend(state: State<BackendProcess>) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
        // Reap so we don't leave a zombie on Windows.
        let _ = child.wait();
        Ok("Backend stopped".into())
    } else {
        Err("Backend not running".into())
    }
}

#[tauri::command]
fn backend_status(state: State<BackendProcess>) -> Result<bool, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_status)) => {
                *guard = None;
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(e) => Err(e.to_string()),
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn get_backend_url() -> String {
    BACKEND_URL.to_string()
}

/// Try to auto-start the backend during Tauri `setup`. Failures are
/// logged and surfaced as a `backend-status` event so the React UI
/// can show a toast/inline error instead of crashing the window.
///
/// We do NOT call `start_backend` directly from `setup` because the
/// setup callback must return `Result<(), Box<dyn Error>>`. A spawn
/// failure (e.g. `py` not on PATH, `py -3.10` not installed) should
/// be visible to the user, not fatal — and `start_backend` can be
/// retried manually from the UI via `invoke('start_backend')`.
///
/// The auto-start runs on a background OS thread (no async dep).
/// We sleep briefly so the React window is mounted and listening
/// for the `backend-status` event before we fire it.
fn auto_start_backend(app: &AppHandle) {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let state = app_handle.state::<BackendProcess>();
        let spawn_result = start_backend(app_handle.clone(), state, None);
        match spawn_result {
            Ok(spawn_msg) => {
                eprintln!("[minimax-desktop] auto-start: {}", spawn_msg);
                // Now confirm the process is actually serving traffic
                // before we tell the UI "all good".
                match healthcheck_backend(HEALTHCHECK_TIMEOUT) {
                    Ok(()) => {
                        let _ = app_handle.emit(
                            "backend-status",
                            serde_json::json!({
                                "ok": true,
                                "message": spawn_msg,
                                "healthy": true,
                            }),
                        );
                    }
                    Err(hc_err) => {
                        eprintln!("[minimax-desktop] healthcheck failed: {}", hc_err);
                        let _ = app_handle.emit(
                            "backend-status",
                            serde_json::json!({
                                "ok": false,
                                "message": format!("{} | healthcheck: {}", spawn_msg, hc_err),
                                "healthy": false,
                            }),
                        );
                    }
                }
            }
            Err(spawn_err) => {
                eprintln!("[minimax-desktop] auto-start failed: {}", spawn_err);
                let _ = app_handle.emit(
                    "backend-status",
                    serde_json::json!({
                        "ok": false,
                        "message": spawn_err,
                        "healthy": false,
                    }),
                );
            }
        }
    });
}

/// Idempotent: kills the backend child if it's still in our state.
/// Safe to call from multiple exit paths (WindowEvent::CloseRequested,
/// RunEvent::ExitRequested, RunEvent::Exit) — `take()` only fires once.
///
/// On Windows the Job Object attached at spawn time is the real
/// backstop: even if this function never runs (Tauri crashed or was
/// SIGKILL'd), the OS closes the job handle during process cleanup,
/// which triggers JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE on the child.
fn shutdown_backend(app: &AppHandle) {
    let state = app.state::<BackendProcess>();
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(mut child) = guard.take() {
        eprintln!("[minimax-desktop] shutting down backend (PID {:?})", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Native folder picker used by the CodingPanel header to pick a
        // per-session coding workspace. See WorkspacePicker.jsx.
        .plugin(tauri_plugin_dialog::init())
        // Auto-updater — checks GitHub Releases for newer versions and
        // applies signed updates on relaunch. Configured via
        // `plugins.updater` in tauri.conf.json. Frontend wires the
        // "Check for updates" button in Settings → About to
        // `@tauri-apps/plugin-updater`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Process plugin — used by the updater flow to relaunch the app
        // after downloadAndInstall completes.
        .plugin(tauri_plugin_process::init())
        .manage(BackendProcess(Mutex::new(None)))
        .manage(BackendJob(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            backend_status,
            get_backend_url
        ])
        .setup(|app| {
            // Fire-and-forget the auto-start. Failures are reported to
            // the frontend via the `backend-status` event so the user
            // sees a clear error rather than a hung window.
            auto_start_backend(&app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                shutdown_backend(&window.app_handle().clone());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building MiniMax Agent Desktop");

    // App-level exit handling. This catches:
    //  - normal exit (user clicked X, then OS is shutting Tauri down)
    //  - SIGINT / SIGTERM that the OS converts to ExitRequested
    //  - any path that bypasses WindowEvent::CloseRequested
    // We still keep the WindowEvent handler above for the "user
    // closed the X but the process is still alive" case, where we
    // want to do the cleanup *before* the OS starts tearing down.
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
            shutdown_backend(&handle.clone());
        }
    });
}
