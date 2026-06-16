import { defineStore } from "pinia";
import {
  SOURCE_16_9,
  PRESETS,
  parseHex,
  bytesToHex,
  aspectToHex,
  presetHexById,
} from "../utils/hex.js";

export const usePatcherStore = defineStore("patcher", {
  state: () => ({
    filePath: "",
    mode: "preset", // "preset" | "calculator" | "custom"

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
    // { ok: boolean, count?, backupPath?, message }
    lastResult: null,
  }),

  getters: {
    // The effective search/replace hex strings for the active mode.
    effectiveSearchHex(state) {
      return state.mode === "custom" ? state.customSearchHex : state.sourceHex;
    },
    effectiveReplaceHex(state) {
      if (state.mode === "preset") return presetHexById(state.presetId);
      if (state.mode === "calculator")
        return aspectToHex(state.calcWidth, state.calcHeight);
      return state.customReplaceHex;
    },

    searchBytes() {
      return parseHex(this.effectiveSearchHex);
    },
    replaceBytes() {
      return parseHex(this.effectiveReplaceHex);
    },

    // null when valid, otherwise a human-readable reason the form can't be submitted.
    validationError(state) {
      if (!state.filePath) return "Choose a game .exe first.";
      const s = this.searchBytes;
      const r = this.replaceBytes;
      if (!s) return "Search bytes are not valid hex.";
      if (!r) return "Replace bytes are not valid hex.";
      if (s.length !== r.length)
        return `Search (${s.length} bytes) and replace (${r.length} bytes) must be the same length.`;
      return null;
    },
    canPatch() {
      return !this.busy && this.validationError === null;
    },
  },

  actions: {
    formatResult(result) {
      this.lastResult = {
        ok: true,
        count: result.count,
        backupPath: result.backup_path,
        message: `Replaced ${result.count} occurrence${
          result.count === 1 ? "" : "s"
        }.`,
      };
    },
    setError(message) {
      this.lastResult = { ok: false, message: String(message) };
    },
    // Helpers used by the confirmation dialog.
    prettySearch() {
      return bytesToHex(this.searchBytes || []);
    },
    prettyReplace() {
      return bytesToHex(this.replaceBytes || []);
    },
  },
});
