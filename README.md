# Bar None — Ultrawide Cutscene Fixer

A tiny Windows desktop app that fixes the **black bars on all four sides** that many
games show during cutscenes on ultrawide / super-ultrawide monitors.

Lots of games hardcode a **16:9** aspect ratio for their pre-rendered or in-engine
cutscenes. On a 21:9 or 32:9 display that 16:9 frame gets letterboxed *and* pillarboxed,
leaving a small window of video surrounded by black. The community fix is to open the
game's `.exe` in a hex editor and replace the 4 bytes that encode `16:9` with the 4 bytes
for your monitor's aspect ratio. **Bar None automates exactly that** — pick the exe, pick
your resolution, click Patch. It always makes a backup first.

> ⚠️ Editing a game's executable can violate its terms of service and may trip anti-cheat
> systems in multiplayer games. Use it on single-player games, at your own risk. A
> timestamped backup is always created so you can restore the original.

## Download

**[⬇️ Download the latest version](https://github.com/TrueEddie/bar-none-ultrawide-fixer/releases/latest)** — grab `bar-none.exe` from the latest release. No installer; just run it.

If you find Bar None useful, you can support development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/L3L31GRM9L)

---

## How it works

The bytes a game stores for its aspect ratio are just the ratio as an IEEE-754
little-endian **float32**:

| Aspect | Value | Bytes |
|--------|-------|-------|
| 16:9 (the default most games hardcode) | 1.77778 | `39 8E E3 3F` |
| 2560×1080 / 5120×2160 (21:9) | 2.37037 | `26 B4 17 40` |
| 3440×1440 (21:9) | 2.38889 | `8E E3 18 40` |
| 3840×1080 (32:9) | 3.55556 | `39 8E 63 40` |

Bar None searches the exe for the 16:9 bytes and replaces **every** occurrence with the
bytes for your target ratio. Because both patterns are exactly 4 bytes, the replacement is
in place — **the file size never changes and no offsets shift**, which is what makes this
safe.

---

## Using the app

1. **Launch `bar-none.exe`.** No installation required.
2. **Search** — click to pick your game's executable. The dropdown next to it lists your
   **last 5 executables** (with their icons) for quick re-selection.
3. **Target resolution** — type your monitor's `width × height` (e.g. `3440 × 1440`). The
   app computes the target aspect bytes live and shows them as the **→ to** value.
4. **From bytes** — shown as a tag, defaulting to `39 8E E3 3F` (16:9), which almost every
   affected game uses. **Click the tag** to edit it inline for the rare game whose default
   differs; the ↺ button resets it back to 16:9. The chosen "from" bytes are remembered
   per-executable.
5. **Patch executable** — review the confirmation dialog (file, search bytes, replace
   bytes) and confirm.
6. You'll see **"Replaced N occurrence(s)"** and the path of the backup that was created.

Then launch the game and enjoy full-screen cutscenes.

The hamburger menu (top-left) holds a **light/dark theme** toggle, **Reset saved data**
(clears recents and restores defaults — see below), and **About**.

### Backups & restoring

A backup is **always** made automatically, right before patching, named:

```
<game>.exe.YYYYMMDD-HHMMSS.bak
```

It's saved next to the game's exe. The timestamp means an existing backup is never
overwritten. When a backup exists for the selected exe, a **Restore** button appears in the
app — one click rolls the executable back to its most recent backup. (You can also undo
manually by renaming the `.bak` back to the original name, or re-verifying the game files
through Steam/Epic.)

### Saved data

Bar None remembers your theme, target resolution, "from" bytes, and the last 5
executables in a small `settings.json` in your Windows app-config folder. **Reset saved
data** in the menu clears all of it and returns the app to its first-run state (your theme
choice is kept).

### If it says "pattern not found"

That means the 16:9 bytes weren't in the file — usually because the game is **already
patched**, or it uses a different default value. Nothing is written and no backup is made
in that case.

---

## Building from source

### Prerequisites

- [Node.js](https://nodejs.org/) (npm)
- [Rust toolchain](https://www.rust-lang.org/tools/install) (`rustup`, MSVC)
- Windows: the MSVC C++ build tools and the WebView2 runtime (preinstalled on Windows 11)

See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for details.

### Commands

```sh
npm install

# Run in development (hot-reloads the UI)
npm run tauri dev

# Build the portable exe -> src-tauri/target/release/bar-none.exe
npm run tauri build
```

The portable `bar-none.exe` is the only artifact needed to share the app. Installer
bundles (`.msi` / NSIS) are disabled by default; re-enable them by setting
`bundle.active` to `true` in `src-tauri/tauri.conf.json`.

---

## Contributing

`main` is protected — direct pushes are blocked and changes land via pull request. Work on
a branch and open a PR:

```sh
git switch -c my-change
# ...commit your work on the branch...
git push -u origin my-change
gh pr create --fill
gh pr merge --squash   # self-merge once you're happy
```

---

## Tech stack

- **[Tauri](https://tauri.app/) v2** — desktop shell; all file I/O (read, backup, write)
  runs in the Rust backend ([`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)).
- **[Vue 3](https://vuejs.org/)** + **[Pinia](https://pinia.vuejs.org/)** — UI and state.
- **[PrimeVue](https://primevue.org/)** + **[Tailwind CSS](https://tailwindcss.com/) v4** —
  components and styling.

The core patch logic and a timestamped-backup end-to-end test live in
[`src-tauri/src/lib.rs`](src-tauri/src/lib.rs); run them with `cargo test --lib` from
`src-tauri/`.
