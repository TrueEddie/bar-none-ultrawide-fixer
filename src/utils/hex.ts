// Hex / aspect-ratio helpers for the patcher.
//
// The byte patterns games store are the aspect ratio as an IEEE-754
// little-endian float32. The 16:9 default is 39 8E E3 3F (= 1.77778).
// A replacement is simply (width / height) packed the same way.

/** The 16:9 default value most games use as the "search for" pattern. */
export const SOURCE_16_9 = "39 8E E3 3F";

export interface Preset {
  id: string;
  label: string;
  /** "Replace with" byte string for that resolution. */
  value: string;
  width: number;
  height: number;
}

/** Default preset selected on launch. */
export const DEFAULT_RESOLUTION_ID = "5120x2160";

/**
 * Ultrawide resolution presets (wider than 16:9), from the r/ultrawidemasterrace
 * cutscene-fixer list. Every value is the target aspect ratio as a little-endian
 * float32, so they all pair with the 16:9 search default 39 8E E3 3F.
 */
export const PRESETS: Preset[] = [
  { id: "2560x1080", label: "2560 x 1080", value: "26 B4 17 40", width: 2560, height: 1080 },
  { id: "3440x1440", label: "3440 x 1440", value: "8E E3 18 40", width: 3440, height: 1440 },
  { id: "3840x1080", label: "3840 x 1080", value: "39 8E 63 40", width: 3840, height: 1080 },
  { id: "3840x1200", label: "3840 x 1200", value: "CD CC 4C 40", width: 3840, height: 1200 },
  { id: "3840x1440", label: "3840 x 1440", value: "AB AA 2A 40", width: 3840, height: 1440 },
  { id: "3840x1600", label: "3840 x 1600", value: "9A 99 19 40", width: 3840, height: 1600 },
  { id: "5120x1440", label: "5120 x 1440", value: "39 8E 63 40", width: 5120, height: 1440 },
  { id: "5120x2160", label: "5120 x 2160", value: "26 B4 17 40", width: 5120, height: 2160 },
  { id: "6880x2880", label: "6880 x 2880", value: "8E E3 18 40", width: 6880, height: 2880 },
];

/** Look up a preset's replacement hex by id. */
export function presetHexById(id: string): string {
  const found = PRESETS.find((p) => p.id === id);
  return found ? found.value : "";
}

/**
 * Parse a loose hex string into an array of byte values (0-255).
 * Tolerates spaces, commas, and `0x` prefixes; case-insensitive.
 * Returns null if the input has no hex digits or an odd number of them.
 */
export function parseHex(str: string): number[] | null {
  const cleaned = (str || "").replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Format a byte array as an uppercase, space-separated hex string. */
export function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

/**
 * Convert a resolution to its little-endian float32 byte array.
 * Returns null for invalid input.
 */
export function aspectToBytes(width: number, height: number): number[] | null {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h || h === 0) return null;
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, w / h, true); // little-endian
  return Array.from(new Uint8Array(buf));
}

/** Convenience: resolution -> hex string (or "" if invalid). */
export function aspectToHex(width: number, height: number): string {
  const bytes = aspectToBytes(width, height);
  return bytes ? bytesToHex(bytes) : "";
}
