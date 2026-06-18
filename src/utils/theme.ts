// Light/dark theme handling.
//
// Both PrimeVue (darkModeSelector ".app-dark") and Tailwind (the `dark` custom
// variant in style.css) react to the `.app-dark` class on <html>. We default to
// the OS preference and remember a manual choice in the persisted settings file
// (see utils/settings). initTheme() must run after preloadSettings().

import { loadSettings, saveSettings } from "./settings";

const DARK_CLASS = "app-dark";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function isDark(): boolean {
  return document.documentElement.classList.contains(DARK_CLASS);
}

export function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle(DARK_CLASS, dark);
}

/** Apply the saved theme, or fall back to the system preference. */
export function initTheme(): void {
  const saved = loadSettings().theme;
  applyDark(saved ? saved === "dark" : systemPrefersDark());
}

/** Flip light/dark, persist the choice, and return the new dark state. */
export function toggleTheme(): boolean {
  const dark = !isDark();
  applyDark(dark);
  saveSettings({ theme: dark ? "dark" : "light" });
  return dark;
}
