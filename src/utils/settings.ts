// Persisted settings, stored in a JSON file written by Rust (read_settings /
// write_settings). Unlike the webview's localStorage, Rust's fs::write flushes
// to disk immediately on every change, so values survive an abrupt app close.
//
// Settings are preloaded once into a synchronous cache (preloadSettings) before
// the app mounts, so the Pinia store and theme can read them synchronously.

import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  sourceHex?: string;
  recentFiles?: { path: string; sourceHex: string }[];
  calcWidth?: number;
  calcHeight?: number;
  theme?: "light" | "dark";
}

let cache: Settings = {};

/** Load the settings file into the cache. Call once before mounting the app. */
export async function preloadSettings(): Promise<void> {
  try {
    const json = await invoke<string>("read_settings");
    cache = (JSON.parse(json) as Settings) ?? {};
  } catch {
    cache = {};
  }
}

/** Synchronous read of the cached settings. */
export function loadSettings(): Settings {
  return cache;
}

/** Merge in the given fields and persist the whole settings object to disk. */
export function saveSettings(settings: Settings): void {
  cache = { ...cache, ...settings };
  void invoke("write_settings", { json: JSON.stringify(cache) });
}
