// Hex / aspect-ratio helpers for the patcher.
//
// The byte patterns games store are the aspect ratio as an IEEE-754
// little-endian float32. The 16:9 default is 39 8E E3 3F (= 1.77778).
// A replacement is simply (width / height) packed the same way.

/** The 16:9 default value most games use as the "search for" pattern. */
export const SOURCE_16_9 = "39 8E E3 3F";

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
