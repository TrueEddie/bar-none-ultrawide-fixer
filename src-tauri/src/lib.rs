use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct PatchResult {
    /// Number of occurrences replaced.
    count: usize,
    /// Absolute path of the backup that was created before patching.
    backup_path: String,
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

    // Always back up first, with a timestamped name so an existing backup is never clobbered.
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_path: PathBuf = {
        let mut os = p.as_os_str().to_owned();
        os.push(format!(".{stamp}.bak"));
        PathBuf::from(os)
    };
    fs::copy(p, &backup_path).map_err(|e| format!("Failed to create backup: {e}"))?;

    let replaced = replace_all(&mut data, &search, &replace);
    fs::write(p, &data).map_err(|e| format!("Failed to write patched file: {e}"))?;

    Ok(PatchResult {
        count: replaced,
        backup_path: backup_path.to_string_lossy().into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![patch_exe])
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
}
