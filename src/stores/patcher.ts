import { defineStore } from "pinia";
import {
  SOURCE_16_9,
  DEFAULT_RESOLUTION_ID,
  parseHex,
  bytesToHex,
  aspectToHex,
  presetHexById,
} from "../utils/hex";

/** Sentinel resolution id meaning "enter a custom width x height". */
export const CUSTOM_ID = "custom";

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

interface PatcherState {
  filePath: string;
  /** Search bytes — the 16:9 default, editable for the rare game that differs. */
  sourceHex: string;
  /** A PRESETS id, or CUSTOM_ID for a user-entered resolution. */
  resolutionId: string;
  calcWidth: number;
  calcHeight: number;
  busy: boolean;
  lastResult: LastResult | null;
  /** Backup file paths that exist for the selected exe, newest first. */
  backups: string[];
}

export const usePatcherStore = defineStore("patcher", {
  state: (): PatcherState => ({
    filePath: "",
    sourceHex: SOURCE_16_9,
    resolutionId: DEFAULT_RESOLUTION_ID, // 5120x2160
    calcWidth: 5120,
    calcHeight: 2160,
    busy: false,
    lastResult: null,
    backups: [],
  }),

  getters: {
    hasBackups: (state): boolean => state.backups.length > 0,

    /** The most recent backup (the one a restore would use). */
    latestBackup: (state): string | null => state.backups[0] ?? null,

    effectiveSearchHex: (state): string => state.sourceHex,

    effectiveReplaceHex: (state): string =>
      state.resolutionId === CUSTOM_ID
        ? aspectToHex(state.calcWidth, state.calcHeight)
        : presetHexById(state.resolutionId),

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
      if (s.length !== r.length)
        return `Search (${s.length} bytes) and replace (${r.length} bytes) must be the same length.`;
      return null;
    },
    canPatch(): boolean {
      return !this.busy && this.validationError === null;
    },
  },

  actions: {
    formatResult(result: PatchResult) {
      this.lastResult = {
        ok: true,
        count: result.count,
        backupPath: result.backup_path,
        message: `Replaced ${result.count} occurrence${
          result.count === 1 ? "" : "s"
        }.`,
      };
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
