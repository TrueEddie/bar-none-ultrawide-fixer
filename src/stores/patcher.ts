import { defineStore } from "pinia";
import {
  SOURCE_16_9,
  PRESETS,
  parseHex,
  bytesToHex,
  aspectToHex,
  presetHexById,
} from "../utils/hex";

export type PatchMode = "preset" | "calculator" | "custom";

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
  mode: PatchMode;
  sourceHex: string;
  presetId: string;
  calcWidth: number;
  calcHeight: number;
  customSearchHex: string;
  customReplaceHex: string;
  busy: boolean;
  lastResult: LastResult | null;
}

export const usePatcherStore = defineStore("patcher", {
  state: (): PatcherState => ({
    filePath: "",
    mode: "preset",

    // Shared "search for" pattern used by preset + calculator modes.
    sourceHex: SOURCE_16_9,

    // preset mode
    presetId: PRESETS[3].id, // default 5120x2160

    // calculator mode
    calcWidth: 5120,
    calcHeight: 2160,

    // custom mode (independent search + replace)
    customSearchHex: SOURCE_16_9,
    customReplaceHex: "",

    busy: false,
    lastResult: null,
  }),

  getters: {
    // The effective search/replace hex strings for the active mode.
    effectiveSearchHex: (state): string =>
      state.mode === "custom" ? state.customSearchHex : state.sourceHex,

    effectiveReplaceHex: (state): string => {
      if (state.mode === "preset") return presetHexById(state.presetId);
      if (state.mode === "calculator")
        return aspectToHex(state.calcWidth, state.calcHeight);
      return state.customReplaceHex;
    },

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
      if (!r) return "Replace bytes are not valid hex.";
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
    // Helpers used by the confirmation dialog.
    prettySearch(): string {
      return bytesToHex(this.searchBytes ?? []);
    },
    prettyReplace(): string {
      return bytesToHex(this.replaceBytes ?? []);
    },
  },
});
