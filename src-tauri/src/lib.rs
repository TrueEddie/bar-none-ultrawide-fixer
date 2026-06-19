use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize)]
struct PatchResult {
    /// Number of occurrences replaced.
    count: usize,
    /// Absolute path of the backup that was created before patching.
    backup_path: String,
}

/// Map a file-write failure into an actionable message. A running game holds its
/// exe open for writing, so the OS rejects the write with a sharing/lock violation
/// (Windows) or a permission error — in that case tell the user to close the game.
fn write_error_message(action: &str, e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    // Windows: 32 = ERROR_SHARING_VIOLATION, 33 = ERROR_LOCK_VIOLATION.
    let in_use = matches!(e.raw_os_error(), Some(32) | Some(33))
        || e.kind() == ErrorKind::PermissionDenied;
    if in_use {
        "The file is in use — close the game (and any launcher running it), then try again.".into()
    } else {
        format!("Failed to {action}: {e}")
    }
}

/// Count non-overlapping occurrences of `needle` in `haystack`.
fn count_occurrences(haystack: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() || haystack.len() < needle.len() {
        return 0;
    }
    let mut count = 0;
    let mut i = 0;
    while i + needle.len() <= haystack.len() {
        if &haystack[i..i + needle.len()] == needle {
            count += 1;
            i += needle.len();
        } else {
            i += 1;
        }
    }
    count
}

/// Replace all non-overlapping occurrences of `search` with `replace`, in place.
/// Caller guarantees `search.len() == replace.len()`, so the buffer length is unchanged.
fn replace_all(data: &mut [u8], search: &[u8], replace: &[u8]) -> usize {
    let mut count = 0;
    let mut i = 0;
    while i + search.len() <= data.len() {
        if &data[i..i + search.len()] == search {
            data[i..i + search.len()].copy_from_slice(replace);
            count += 1;
            i += search.len();
        } else {
            i += 1;
        }
    }
    count
}

/// Patch a binary file by replacing every occurrence of `search` bytes with `replace` bytes.
///
/// A timestamped backup (`<file>.YYYYMMDD-HHMMSS.bak`) is **always** created before any write.
/// The search and replace patterns must be the same length so the file size never changes.
#[tauri::command]
fn patch_exe(path: String, search: Vec<u8>, replace: Vec<u8>) -> Result<PatchResult, String> {
    if search.is_empty() {
        return Err("Search pattern is empty.".into());
    }
    if search.len() != replace.len() {
        return Err(format!(
            "Search ({} bytes) and replace ({} bytes) must be the same length.",
            search.len(),
            replace.len()
        ));
    }

    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("File not found: {path}"));
    }

    let mut data = fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;

    let count = count_occurrences(&data, &search);
    if count == 0 {
        return Err(
            "Pattern not found — the game may already be patched or uses a different default value."
                .into(),
        );
    }

    // Probe writability before backing up, so a locked exe (the game is still
    // running) reports a clear "close the game" error instead of leaving an orphan
    // backup. Opening for write does not modify the file.
    if let Err(e) = fs::OpenOptions::new().write(true).open(p) {
        return Err(write_error_message("open the file for writing", &e));
    }

    // Always back up first, with a timestamped name so an existing backup is never clobbered.
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_path: PathBuf = {
        let mut os = p.as_os_str().to_owned();
        os.push(format!(".{stamp}.bak"));
        PathBuf::from(os)
    };
    fs::copy(p, &backup_path).map_err(|e| format!("Failed to create backup: {e}"))?;

    let replaced = replace_all(&mut data, &search, &replace);
    fs::write(p, &data).map_err(|e| write_error_message("write the patched file", &e))?;

    Ok(PatchResult {
        count: replaced,
        backup_path: backup_path.to_string_lossy().into_owned(),
    })
}

/// True if `name` is one of our timestamped backups for `prefix`
/// (i.e. `<prefix><YYYYMMDD-HHMMSS>.bak`).
fn is_backup_name(name: &str, prefix: &str) -> bool {
    if !name.starts_with(prefix) || !name.ends_with(".bak") {
        return false;
    }
    let start = prefix.len();
    let end = name.len().saturating_sub(4); // strip ".bak"
    if end <= start {
        return false;
    }
    let stamp = name[start..end].as_bytes();
    if stamp.len() != 15 {
        return false; // YYYYMMDD-HHMMSS
    }
    stamp
        .iter()
        .enumerate()
        .all(|(i, b)| if i == 8 { *b == b'-' } else { b.is_ascii_digit() })
}

/// List the timestamped backups Bar None created for `path`, newest first.
#[tauri::command]
fn list_backups(path: String) -> Result<Vec<String>, String> {
    let p = Path::new(&path);
    let (dir, file_name) = match (p.parent(), p.file_name().and_then(|n| n.to_str())) {
        (Some(d), Some(n)) => (d, n),
        _ => return Ok(vec![]),
    };
    let prefix = format!("{file_name}.");
    let mut backups: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if is_backup_name(name, &prefix) {
                    backups.push(entry.path().to_string_lossy().into_owned());
                }
            }
        }
    }
    backups.sort(); // timestamp in the name sorts chronologically
    backups.reverse(); // newest first
    Ok(backups)
}

/// Restore `path` from `backup_path`: remove the current file and rename the
/// backup back to the original name. `backup_path` must be one of our backups
/// sitting next to `path`.
#[tauri::command]
fn restore_backup(path: String, backup_path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let b = Path::new(&backup_path);

    if !b.is_file() {
        return Err("Backup file not found.".into());
    }

    // Safety: only restore from a Bar None backup that sits next to `path`.
    match (
        p.parent(),
        p.file_name().and_then(|n| n.to_str()),
        b.parent(),
        b.file_name().and_then(|n| n.to_str()),
    ) {
        (Some(dir), Some(fname), Some(b_dir), Some(b_name)) => {
            if dir != b_dir {
                return Err("Backup is not in the same folder as the executable.".into());
            }
            if !is_backup_name(b_name, &format!("{fname}.")) {
                return Err("That file is not a backup of this executable.".into());
            }
        }
        _ => return Err("Invalid file paths.".into()),
    }

    // Windows rename can't overwrite, so remove the current file first, then rename in.
    if p.exists() {
        fs::remove_file(p).map_err(|e| write_error_message("remove the current file", &e))?;
    }
    fs::rename(b, p).map_err(|e| write_error_message("restore the backup", &e))?;
    Ok(())
}

/// Extract the icon embedded in an executable, returned as PNG bytes.
#[cfg(any(target_os = "windows", target_os = "macos"))]
#[tauri::command]
fn get_exe_icon(path: String) -> Result<Vec<u8>, String> {
    systemicons::get_icon(&path, 64).map_err(|e| format!("{e:?}"))
}

/// No native icon source on Linux; the UI treats this error as "no icon".
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
fn get_exe_icon(_path: String) -> Result<Vec<u8>, String> {
    Err("Icon extraction is not supported on this platform.".into())
}

/// Return only the paths that still exist on disk (to prune stale recents).
#[tauri::command]
fn filter_existing(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| Path::new(p).is_file())
        .collect()
}

fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Read the persisted settings JSON (returns "{}" if none yet).
#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> String {
    settings_file(&app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_else(|| "{}".to_string())
}

/// Write the settings JSON to disk synchronously (flushes immediately).
#[tauri::command]
fn write_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = settings_file(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, json).map_err(|e| format!("Failed to write settings: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            patch_exe,
            list_backups,
            restore_backup,
            get_exe_icon,
            filter_existing,
            read_settings,
            write_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_replaces_equal_length_in_place() {
        // 16:9 default (39 8E E3 3F) appears twice, surrounded by filler.
        let mut data = vec![
            0x00, 0x01, 0x39, 0x8E, 0xE3, 0x3F, 0x09, 0x39, 0x8E, 0xE3, 0x3F, 0x05,
        ];
        let search = vec![0x39, 0x8E, 0xE3, 0x3F];
        let replace = vec![0x26, 0xB4, 0x17, 0x40]; // 2560x1080 / 5120x2160

        assert_eq!(count_occurrences(&data, &search), 2);

        let n = replace_all(&mut data, &search, &replace);
        assert_eq!(n, 2);
        assert_eq!(count_occurrences(&data, &replace), 2);
        assert_eq!(count_occurrences(&data, &search), 0);
        assert_eq!(data.len(), 12, "file size must not change");
    }

    #[test]
    fn in_use_errors_get_a_close_the_game_message() {
        use std::io::{Error, ErrorKind};

        // Windows sharing/lock violations and permission errors -> actionable hint.
        for e in [
            Error::from_raw_os_error(32),
            Error::from_raw_os_error(33),
            Error::new(ErrorKind::PermissionDenied, "denied"),
        ] {
            let msg = write_error_message("write the patched file", &e);
            assert!(msg.contains("close the game"), "got: {msg}");
        }

        // Other errors keep the generic, action-specific wording.
        let other = Error::new(ErrorKind::NotFound, "nope");
        let msg = write_error_message("write the patched file", &other);
        assert!(msg.contains("Failed to write the patched file"), "got: {msg}");
    }

    #[test]
    fn no_match_returns_zero() {
        let data = vec![0u8, 1, 2, 3, 4, 5];
        let search = vec![0x39, 0x8E, 0xE3, 0x3F];
        assert_eq!(count_occurrences(&data, &search), 0);
    }

    #[test]
    fn patch_exe_backs_up_and_replaces_on_disk() {
        // Unique temp file containing the 16:9 pattern twice.
        let dir = std::env::temp_dir();
        let path = dir.join(format!("barnone_test_{}.bin", std::process::id()));
        let original: Vec<u8> = vec![
            0xAA, 0x39, 0x8E, 0xE3, 0x3F, 0xBB, 0xCC, 0x39, 0x8E, 0xE3, 0x3F, 0xDD,
        ];
        fs::write(&path, &original).unwrap();

        let res = patch_exe(
            path.to_string_lossy().into_owned(),
            vec![0x39, 0x8E, 0xE3, 0x3F],
            vec![0x26, 0xB4, 0x17, 0x40],
        )
        .expect("patch should succeed");

        assert_eq!(res.count, 2);

        // Backup exists and matches the original bytes.
        let backup = std::path::PathBuf::from(&res.backup_path);
        assert!(backup.exists(), "backup file must exist");
        assert_eq!(fs::read(&backup).unwrap(), original);

        // Patched file: same length, pattern replaced.
        let patched = fs::read(&path).unwrap();
        assert_eq!(patched.len(), original.len());
        assert_eq!(count_occurrences(&patched, &[0x26, 0xB4, 0x17, 0x40]), 2);
        assert_eq!(count_occurrences(&patched, &[0x39, 0x8E, 0xE3, 0x3F]), 0);

        // Re-patching the same file now finds nothing -> error (graceful).
        let again = patch_exe(
            path.to_string_lossy().into_owned(),
            vec![0x39, 0x8E, 0xE3, 0x3F],
            vec![0x26, 0xB4, 0x17, 0x40],
        );
        assert!(again.is_err());

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&backup);
    }

    #[test]
    fn lists_and_restores_backup() {
        let dir = std::env::temp_dir();
        let exe = dir.join(format!("barnone_restore_{}.bin", std::process::id()));
        let bak = dir.join(format!(
            "barnone_restore_{}.bin.20260101-120000.bak",
            std::process::id()
        ));
        fs::write(&exe, b"PATCHED").unwrap();
        fs::write(&bak, b"ORIGINAL").unwrap();

        let exe_s = exe.to_string_lossy().into_owned();

        // The backup is discovered for this exe.
        let found = list_backups(exe_s.clone()).unwrap();
        assert!(found.iter().any(|p| p == &bak.to_string_lossy()));

        // Restore swaps the backup back in and consumes it.
        restore_backup(exe_s.clone(), bak.to_string_lossy().into_owned()).unwrap();
        assert_eq!(fs::read(&exe).unwrap(), b"ORIGINAL");
        assert!(!bak.exists());
        assert!(list_backups(exe_s).unwrap().is_empty());

        let _ = fs::remove_file(&exe);
    }

    #[test]
    fn rejects_non_backup_restore() {
        let dir = std::env::temp_dir();
        let exe = dir.join(format!("barnone_reject_{}.bin", std::process::id()));
        let other = dir.join(format!("barnone_reject_other_{}.txt", std::process::id()));
        fs::write(&exe, b"DATA").unwrap();
        fs::write(&other, b"NOT A BACKUP").unwrap();

        // A file that isn't a Bar None backup of `exe` must be refused.
        let err = restore_backup(
            exe.to_string_lossy().into_owned(),
            other.to_string_lossy().into_owned(),
        );
        assert!(err.is_err());
        assert!(exe.exists(), "exe must be untouched on rejection");

        let _ = fs::remove_file(&exe);
        let _ = fs::remove_file(&other);
    }
}
