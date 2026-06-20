import { defineStore } from "pinia";
import { SOURCE_16_9, parseHex, bytesToHex, aspectToHex } from "../utils/hex";
import { loadSettings, saveSettings } from "../utils/settings";

/** Max number of recently-opened executables to remember. */
const MAX_RECENTS = 5;

// Match-count thresholds for the patch dialog's severity tag. Internal constants,
// not user settings — no UI exposes them and they aren't persisted.
const MATCH_WARN_THRESHOLD = 5;
const MATCH_HIGH_THRESHOLD = 17;

/** Shape returned by the Rust `patch_exe` command. */
export interface PatchResult {
  count: number;
  backup_path: string;
}

/** UI-facing result of the last patch attempt. */
export interface LastResult {
  ok: boolean;
  count?: number;
  backupPath?: string;
  message: string;
}

/** A remembered executable plus the "search" bytes last used for it. */
export interface RecentFile {
  path: string;
  sourceHex: string;
}

/** Normalize persisted recents (also migrates the legacy string[] format). */
function normalizeRecents(saved: unknown): RecentFile[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .map((r): RecentFile | null => {
      if (typeof r === "string") return { path: r, sourceHex: SOURCE_16_9 };
      if (r && typeof r.path === "string") {
        return { path: r.path, sourceHex: typeof r.sourceHex === "string" ? r.sourceHex : SOURCE_16_9 };
      }
      return null;
    })
    .filter((r): r is RecentFile => r !== null)
    .slice(0, MAX_RECENTS);
}

interface PatcherState {
  filePath: string;
  /** Search bytes — the 16:9 default, editable for the rare game that differs. */
  sourceHex: string;
  /** Target resolution the user is patching to. */
  calcWidth: number;
  calcHeight: number;
  busy: boolean;
  lastResult: LastResult | null;
  /** Backup file paths that exist for the selected exe, newest first. */
  backups: string[];
  /** Recently-opened executables, newest first (persisted). */
  recentFiles: RecentFile[];
}

export const usePatcherStore = defineStore("patcher", {
  state: (): PatcherState => {
    const saved = loadSettings();
    return {
      filePath: "",
      sourceHex: saved.sourceHex ?? SOURCE_16_9,
      calcWidth: saved.calcWidth ?? 5120,
      calcHeight: saved.calcHeight ?? 2160,
      busy: false,
      lastResult: null,
      backups: [],
      recentFiles: normalizeRecents(saved.recentFiles),
    };
  },

  getters: {
    hasBackups: (state): boolean => state.backups.length > 0,

    /** The most recent backup (the one a restore would use). */
    latestBackup: (state): string | null => state.backups[0] ?? null,

    effectiveSearchHex: (state): string => state.sourceHex,

    effectiveReplaceHex: (state): string => aspectToHex(state.calcWidth, state.calcHeight),

    searchBytes(): number[] | null {
      return parseHex(this.effectiveSearchHex);
    },
    replaceBytes(): number[] | null {
      return parseHex(this.effectiveReplaceHex);
    },

    // null when valid, otherwise a human-readable reason the form can't be submitted.
    validationError(): string | null {
      if (!this.filePath) return "Choose a game .exe first.";
      const s = this.searchBytes;
      const r = this.replaceBytes;
      if (!s) return "Search bytes are not valid hex.";
      if (!r) return "Enter a valid target resolution.";
      if (s.length !== r.length) return `Search (${s.length} bytes) and replace (${r.length} bytes) must be the same length.`;
      return null;
    },
    canPatch(): boolean {
      return !this.busy && this.validationError === null;
    },

    /** PrimeVue Tag severity for a scan's match count. */
    matchSeverity() {
      return (count: number): "secondary" | "warn" | "danger" => {
        // Zero is a problem (nothing to patch); high counts risk coincidental matches.
        if (count === 0 || count >= MATCH_HIGH_THRESHOLD) return "danger";
        if (count >= MATCH_WARN_THRESHOLD) return "warn";
        return "secondary";
      };
    },
  },

  actions: {
    /** Add/refresh an entry at the front of the recents list (deduped, capped). */
    addRecentFile(path: string, sourceHex: string) {
      this.recentFiles = [{ path, sourceHex }, ...this.recentFiles.filter((r) => r.path !== path)].slice(0, MAX_RECENTS);
      this.persist();
    },
    /** Replace the recents list (e.g. after pruning missing files). */
    setRecentFiles(files: RecentFile[]) {
      this.recentFiles = files.slice(0, MAX_RECENTS);
      this.persist();
    },
    /** Remember the search bytes used for a recent exe (no reorder). */
    setRecentSourceHex(path: string, sourceHex: string) {
      const entry = this.recentFiles.find((r) => r.path === path);
      if (entry && entry.sourceHex !== sourceHex) {
        entry.sourceHex = sourceHex;
        this.persist();
      }
    },
    /** The saved search bytes for a path, if any. */
    recentSourceHex(path: string): string | undefined {
      return this.recentFiles.find((r) => r.path === path)?.sourceHex;
    },
    /** Write the persisted settings to localStorage. */
    persist() {
      saveSettings({
        sourceHex: this.sourceHex,
        recentFiles: this.recentFiles,
        calcWidth: this.calcWidth,
        calcHeight: this.calcHeight,
      });
    },
    formatResult(result: PatchResult) {
      this.lastResult = {
        ok: true,
        count: result.count,
        backupPath: result.backup_path,
        message: `Replaced ${result.count} occurrence${result.count === 1 ? "" : "s"}.`,
      };
    },
    /** Return to the first-run state: clear saved settings and session state alike. */
    resetSavedData() {
      // Persisted settings.
      this.sourceHex = SOURCE_16_9;
      this.calcWidth = 5120;
      this.calcHeight = 2160;
      this.recentFiles = [];
      // Session state, so the UI looks freshly launched (no selected exe/backups).
      this.filePath = "";
      this.backups = [];
      this.lastResult = null;
      this.persist();
    },
    setError(message: unknown) {
      this.lastResult = { ok: false, message: String(message) };
    },
    prettySearch(): string {
      return bytesToHex(this.searchBytes ?? []);
    },
    prettyReplace(): string {
      return bytesToHex(this.replaceBytes ?? []);
    },
  },
});
