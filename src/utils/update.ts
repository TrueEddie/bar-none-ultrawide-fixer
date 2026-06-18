// Update check: compare the running version against the latest GitHub release.
//
// The GitHub API is CORS-enabled and the app's CSP is null, so a plain webview
// fetch works — no HTTP plugin needed. All failures are treated as "no info"
// (returns null), so being offline never disrupts the app.

const REPO = "TrueEddie/bar-none-ultrawide-fixer";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface LatestRelease {
  /** Version without a leading "v", e.g. "1.1.0". */
  version: string;
  /** Release page URL to open for download. */
  url: string;
}

/** Parse "1.2.3" (tolerant of a leading "v") into numeric [major, minor, patch]. */
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/** True if `latest` is a higher version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Fetch the latest release, or null if it can't be determined (offline, etc.). */
export async function checkLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tag: unknown = data?.tag_name;
    const url: unknown = data?.html_url;
    if (typeof tag !== "string" || typeof url !== "string") return null;
    return { version: tag.replace(/^v/i, ""), url };
  } catch {
    return null;
  }
}
