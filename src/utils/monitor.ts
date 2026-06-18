// Monitor detection: read the user's actual display resolution so the target
// resolution can be prefilled instead of a hardcoded default.
//
// A monitor's `.size` is a PhysicalSize in real pixels (e.g. 3440x1440 even under
// Windows display scaling), which is exactly the resolution we want — no
// scale-factor math needed.

import { currentMonitor, primaryMonitor } from "@tauri-apps/api/window";

/**
 * The user's monitor resolution in physical pixels, or null if it can't be read.
 * Prefers the monitor the window is on, falling back to the primary monitor.
 */
export async function detectMonitorResolution(): Promise<{
  width: number;
  height: number;
} | null> {
  try {
    const monitor = (await currentMonitor()) ?? (await primaryMonitor());
    if (!monitor) return null;
    const { width, height } = monitor.size;
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}
