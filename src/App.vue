<script setup lang="ts">
  import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
  import { storeToRefs } from "pinia";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";

  import Button from "primevue/button";
  import InputText from "primevue/inputtext";
  import InputNumber from "primevue/inputnumber";
  import Message from "primevue/message";
  import Dialog from "primevue/dialog";
  import ConfirmDialog from "primevue/confirmdialog";
  import { useConfirm } from "primevue/useconfirm";
  import Card from "primevue/card";
  import Menu from "primevue/menu";
  import SplitButton from "primevue/splitbutton";
  import Tag from "primevue/tag";
  import Badge from "primevue/badge";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";

  import { usePatcherStore, type PatchResult } from "./stores/patcher";
  import { SOURCE_16_9, parseHex } from "./utils/hex";
  import { toggleTheme, isDark } from "./utils/theme";
  import { loadSettings } from "./utils/settings";
  import { detectMonitorResolution } from "./utils/monitor";
  import { checkLatestRelease, isNewer } from "./utils/update";

  const store = usePatcherStore();
  const { filePath, sourceHex, calcWidth, calcHeight, busy, lastResult } = storeToRefs(store);
  const confirm = useConfirm();

  const showAbout = ref(false);
  const editingSearch = ref(false);
  const hexInvalid = ref(false);
  // App version, read from the compiled binary (tauri.conf.json) so About stays in sync.
  const appVersion = ref("");
  getVersion().then((v) => (appVersion.value = v));

  // Update check: a badge surfaces when a newer GitHub release exists.
  const updateAvailable = ref(false);
  const latestVersion = ref("");
  const latestUrl = ref("");
  const showUpdate = ref(false);

  /** Compare the latest release to the running version and update badge state. */
  async function refreshUpdateState(): Promise<boolean> {
    const latest = await checkLatestRelease();
    if (!latest) return false;
    latestVersion.value = latest.version;
    latestUrl.value = latest.url;
    updateAvailable.value = appVersion.value ? isNewer(latest.version, appVersion.value) : false;
    return updateAvailable.value;
  }

  /** Hamburger "Check for updates": re-check, then show the result. */
  async function checkForUpdates() {
    await refreshUpdateState();
    showUpdate.value = true;
  }

  function downloadUpdate() {
    showUpdate.value = false;
    if (latestUrl.value) void openUrl(latestUrl.value);
  }

  /** Fill the target resolution from the user's monitor. */
  async function useMonitorResolution() {
    const res = await detectMonitorResolution();
    if (res) {
      calcWidth.value = res.width;
      calcHeight.value = res.height;
    }
  }

  // Exe icons as data URLs, keyed by path (covers the selected file and recents).
  const recentIcons = ref<Record<string, string>>({});
  const exeName = computed(() => (filePath.value ? filePath.value.split(/[\\/]/).pop() : ""));
  const iconUrl = computed(() => (filePath.value ? (recentIcons.value[filePath.value] ?? null) : null));
  function bytesToDataUrl(bytes: number[]): string {
    let binary = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return `data:image/png;base64,${btoa(binary)}`;
  }
  async function loadIcon(path: string) {
    if (recentIcons.value[path]) return;
    try {
      const bytes = await invoke<number[]>("get_exe_icon", { path });
      recentIcons.value[path] = bytesToDataUrl(bytes);
    } catch {
      // no icon available — ignore
    }
  }
  function loadRecentIcons() {
    for (const r of store.recentFiles) void loadIcon(r.path);
  }

  // Hamburger menu + theme toggle.
  const menu = ref<InstanceType<typeof Menu> | null>(null);
  const isDarkMode = ref(isDark());
  const menuItems = computed(() => [
    {
      label: isDarkMode.value ? "Light mode" : "Dark mode",
      icon: isDarkMode.value ? "pi pi-sun" : "pi pi-moon",
      command: () => {
        isDarkMode.value = toggleTheme();
      },
    },
    { separator: true },
    {
      label: "Reset saved data",
      icon: "pi pi-trash",
      command: requestReset,
    },
    {
      label: updateAvailable.value ? "Update available" : "Check for updates",
      icon: "pi pi-download",
      update: true,
      command: checkForUpdates,
    },
    {
      label: "About",
      icon: "pi pi-info-circle",
      command: () => {
        showAbout.value = true;
      },
    },
  ]);
  /** Normalize raw input to "XX XX XX XX": hex only, uppercase, byte-paired, max 4 bytes. */
  function formatHex(raw: string): string {
    const digits = raw
      .replace(/[^0-9a-fA-F]/g, "")
      .toUpperCase()
      .slice(0, 8);
    return digits.replace(/(.{2})/g, "$1 ").trim();
  }
  function onHexInput(e: Event) {
    const el = e.target as HTMLInputElement;
    const formatted = formatHex(el.value);
    // Write back to the DOM too, so stripped/uppercased chars show even when the
    // model value is unchanged (and Vue skips the re-render).
    el.value = formatted;
    sourceHex.value = formatted;
    hexInvalid.value = false; // clear the invalid flag as the user edits
  }

  /** The "from" hex is valid only when it's a complete 4-byte value. */
  const hexValid = computed(() => parseHex(sourceHex.value)?.length === 4);
  /** Save the edited hex; if it isn't 4 valid bytes, flag invalid and keep editing. */
  function saveHex() {
    if (hexValid.value) {
      hexInvalid.value = false;
      editingSearch.value = false;
    } else {
      hexInvalid.value = true;
    }
  }
  function startEditingHex() {
    hexInvalid.value = false;
    editingSearch.value = true;
  }
  function resetHex() {
    sourceHex.value = SOURCE_16_9;
    hexInvalid.value = false;
  }

  function requestReset() {
    confirm.require({
      group: "reset",
      header: "Reset saved data",
      acceptProps: { label: "Reset", severity: "danger" },
      rejectProps: { label: "Cancel", severity: "secondary", text: true },
      accept: () => {
        store.resetSavedData();
        recentIcons.value = {};
        editingSearch.value = false;
        // Mirror first-launch: re-detect the monitor instead of the fixed default.
        void useMonitorResolution();
      },
    });
  }

  function toggleMenu(event: Event) {
    menu.value?.toggle(event);
  }
  function minimizeWindow() {
    getCurrentWindow().minimize();
  }
  function closeWindow() {
    getCurrentWindow().close();
  }

  /** Filename of the backup a restore would use. */
  const backupName = computed(() => (store.latestBackup ? store.latestBackup.split(/[\\/]/).pop() : ""));

  /** Refresh the list of backups that exist for the selected exe. */
  async function refreshBackups() {
    if (!filePath.value) {
      store.backups = [];
      return;
    }
    try {
      store.backups = await invoke<string[]>("list_backups", { path: filePath.value });
    } catch {
      store.backups = [];
    }
  }

  /** Select a file: restore its saved "from", remember it, refresh icon + backups. */
  async function selectFile(path: string) {
    filePath.value = path;
    lastResult.value = null;
    const savedFrom = store.recentSourceHex(path);
    if (savedFrom) sourceHex.value = savedFrom;
    store.addRecentFile(path, sourceHex.value);
    void loadIcon(path);
    await refreshBackups();
  }

  async function pickFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: filePath.value || undefined,
      filters: [{ name: "Executable", extensions: ["exe"] }],
    });
    if (typeof selected === "string") {
      await selectFile(selected);
    }
  }

  /** Recent-executables menu for the SplitButton dropdown. */
  const recentMenuItems = computed(() => {
    if (!store.recentFiles.length) {
      return [{ label: "No recent files", disabled: true }];
    }
    return store.recentFiles.map((r) => ({
      label: r.path.split(/[\\/]/).pop(),
      path: r.path,
      command: () => selectFile(r.path),
    }));
  });

  // Persist on change; also remember the current "from" against the selected exe.
  watch(
    () => [sourceHex.value, calcWidth.value, calcHeight.value],
    () => {
      if (filePath.value) store.setRecentSourceHex(filePath.value, sourceHex.value);
      store.persist();
    },
  );

  // Keep recent-file icons loaded for the dropdown.
  watch(() => store.recentFiles.map((r) => r.path).join("|"), loadRecentIcons, {
    immediate: true,
  });

  function requestPatch() {
    if (!store.canPatch) return;
    confirm.require({
      group: "patch",
      header: "Confirm patch",
      acceptProps: { label: "Patch", class: "text-white!" },
      rejectProps: { label: "Cancel", severity: "secondary", text: true },
      accept: () => doPatch(),
    });
  }

  async function doPatch() {
    busy.value = true;
    lastResult.value = null;
    try {
      const result = await invoke<PatchResult>("patch_exe", {
        path: filePath.value,
        search: store.searchBytes,
        replace: store.replaceBytes,
      });
      store.formatResult(result);
      await refreshBackups();
    } catch (err) {
      store.setError(err);
    } finally {
      busy.value = false;
    }
  }

  function requestRestore() {
    if (!store.hasBackups) return;
    confirm.require({
      group: "restore",
      header: "Restore from backup",
      acceptProps: { label: "Restore", severity: "danger" },
      rejectProps: { label: "Cancel", severity: "secondary", text: true },
      accept: () => doRestore(),
    });
  }

  async function doRestore() {
    const backup = store.latestBackup;
    if (!backup) return;
    busy.value = true;
    lastResult.value = null;
    try {
      await invoke("restore_backup", { path: filePath.value, backupPath: backup });
      lastResult.value = { ok: true, message: "Restored the executable from backup." };
      await refreshBackups();
    } catch (err) {
      store.setError(err);
    } finally {
      busy.value = false;
    }
  }

  // Resize the borderless window to hug the card, so the modal mask and shadow
  // never extend past it.
  const rootEl = ref<HTMLElement | null>(null);
  let lastW = 0;
  let lastH = 0;
  let resizeObserver: ResizeObserver | null = null;
  async function fitWindowToContent() {
    const el = rootEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height);
    if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    await getCurrentWindow().setSize(new LogicalSize(w, h));
  }
  onMounted(async () => {
    resizeObserver = new ResizeObserver(() => fitWindowToContent());
    if (rootEl.value) resizeObserver.observe(rootEl.value);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await fitWindowToContent();

    // Borderless transparent windows can launch behind other windows; bring it
    // to the front once it has sized itself.
    try {
      await getCurrentWindow().setFocus();
    } catch {
      // ignore
    }

    // Drop recents whose file no longer exists.
    if (store.recentFiles.length) {
      try {
        const existing = await invoke<string[]>("filter_existing", {
          paths: store.recentFiles.map((r) => r.path),
        });
        store.setRecentFiles(store.recentFiles.filter((r) => existing.includes(r.path)));
      } catch {
        // ignore
      }
    }

    // First run only: prefill the target resolution from the user's monitor
    // (don't overwrite a resolution the user has already saved).
    const saved = loadSettings();
    if (saved.calcWidth === undefined || saved.calcHeight === undefined) {
      await useMonitorResolution();
    }

    // Silent update check: set the badge if a newer release exists (no popup).
    void refreshUpdateState();
  });
  onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <main ref="rootEl" class="w-fit text-surface-900 dark:text-surface-0">
    <Card class="w-96 overflow-hidden border border-gray-500 shadow-none! rounded-xl">
      <template #header>
        <div class="bg-linear-to-b from-indigo-950 to-indigo-500 flex flex-col drop-shadow-md">
          <!-- title-bar controls: hamburger left, minimize/close right (the drag handle) -->
          <div class="flex items-center justify-between px-1 pt-1" data-tauri-drag-region>
            <div class="relative">
              <Button icon="pi pi-bars" text rounded size="small" :aria-label="updateAvailable ? 'Menu (update available)' : 'Menu'" class="text-white!" @click="toggleMenu" />
              <Badge v-if="updateAvailable" severity="danger" class="absolute! top-1 right-1 h-2! min-w-2! w-2! p-0 pointer-events-none" />
            </div>
            <Menu ref="menu" :model="menuItems" popup append-to="body">
              <template #item="{ item, props }">
                <a v-bind="props.action" class="flex items-center gap-2 px-3 py-2">
                  <span :class="item.icon" class="text-sm" />
                  <span class="text-sm">{{ item.label }}</span>
                  <Badge v-if="item.update && updateAvailable" severity="danger" class="ml-auto self-center h-2! w-2! min-w-2! p-0" />
                </a>
              </template>
            </Menu>
            <div class="flex items-center">
              <Button icon="pi pi-minus" text rounded size="small" aria-label="Minimize" class="text-white!" @click="minimizeWindow" />
              <Button icon="pi pi-times" text rounded size="small" aria-label="Close" class="text-white!" @click="closeWindow" />
            </div>
          </div>
          <!-- logo + title -->
          <div class="flex flex-row items-center gap-3 px-5 pb-5 pt-1">
            <img src="/logo.png" alt="Bar None icon" class="w-16 h-16" />
            <div class="flex flex-col leading-tight">
              <h1 class="text-2xl font-bold text-white">Bar None</h1>
              <span class="text-sm font-medium text-gray-300">Ultrawide cutscene fixer</span>
            </div>
          </div>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-5 mt-2">
          <!-- 1. File picker -->
          <section class="flex gap-2 w-full items-stretch">
            <div
              v-tooltip.top="filePath ? { value: filePath, class: 'max-w-xs break-all font-mono text-xs' } : undefined"
              class="flex-1 flex items-center gap-2 py-1 px-2 rounded-md border-none bg-(--p-tag-secondary-background) dark:bg-black overflow-hidden"
            >
              <template v-if="filePath">
                <img v-if="iconUrl" :src="iconUrl" alt="" class="w-7 h-7 shrink-0 rounded" />
                <i v-else class="pi pi-file shrink-0 opacity-50" />
                <span class="truncate text-sm">{{ exeName }}</span>
              </template>
              <template v-else>
                <div class="w-7 h-7 shrink-0 rounded border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                  <i class="pi pi-image text-xs opacity-40" />
                </div>
                <span class="text-sm opacity-60">No executable selected</span>
              </template>
            </div>
            <SplitButton label="Search" severity="secondary" :model="recentMenuItems" @click="pickFile">
              <template #item="{ item, props }">
                <a v-bind="props.action" class="flex items-center gap-2 px-2 py-2">
                  <img v-if="item.path && recentIcons[item.path]" :src="recentIcons[item.path]" alt="" class="w-5 h-5 shrink-0 rounded" />
                  <i v-else-if="item.path" class="pi pi-file text-xs opacity-50 shrink-0" />
                  <span class="truncate text-sm">{{ item.label }}</span>
                </a>
              </template>
            </SplitButton>
          </section>

          <!-- 2. Target resolution + from → to hex -->
          <section class="flex flex-col gap-2">
            <Tag class="p-2 flex gap-4" severity="secondary">
              <div class="flex items-center text-center">
                <label class="text-sm font-medium">Target Resolution</label>
              </div>
              <div class="flex items-center gap-2 w-full">
                <InputNumber v-model="calcWidth" :use-grouping="false" :min="1" fluid class="flex-1 min-w-0" input-class="text-center" :pt="{ pcInputText: { root: { autocomplete: 'off' } } }" />
                <span class="text-surface-500 shrink-0">×</span>
                <InputNumber v-model="calcHeight" :use-grouping="false" :min="1" fluid class="flex-1 min-w-0" input-class="text-center" :pt="{ pcInputText: { root: { autocomplete: 'off' } } }" />
              </div>
              <Button label="Auto" text size="small" aria-label="Use my monitor's resolution" class="px-3" @click="useMonitorResolution" />
            </Tag>
            <div class="flex items-center gap-2 text-sm mt-3 justify-between">
              <!-- from: a tag when idle, an inline input (with reset + save inside) when editing -->
              <div v-if="editingSearch" class="relative shrink-0">
                <InputText :value="sourceHex" :invalid="hexInvalid" class="font-mono w-46 pr-16" autocomplete="off" autofocus maxlength="11" @input="onHexInput" @keyup.enter="saveHex" />
                <div class="absolute inset-y-0 right-1 flex items-center">
                  <Button v-if="sourceHex !== SOURCE_16_9" icon="pi pi-replay" text rounded size="small" aria-label="Reset search bytes to 16:9" @click="resetHex" />
                  <Button icon="pi pi-check" text rounded size="small" aria-label="Done editing search bytes" @click="saveHex" />
                </div>
              </div>
              <Tag v-else :value="sourceHex" :severity="sourceHex === SOURCE_16_9 ? 'secondary' : 'warn'" class="font-mono cursor-pointer" @click="startEditingHex" />
              <i class="pi pi-arrow-right text-xs opacity-60 shrink-0" />
              <Tag>
                <span class="font-mono shrink-0">{{ store.effectiveReplaceHex || "—" }}</span>
              </Tag>
            </div>
          </section>

          <!-- 3. Patch / Restore -->
          <div class="flex gap-2">
            <Button v-if="store.hasBackups" label="Restore" icon="pi pi-history" severity="secondary" outlined :disabled="busy" @click="requestRestore" />
            <Button class="flex-1 bg-indigo-500 text-white!" :label="busy ? 'Patching…' : 'Patch Executable'" :disabled="!store.canPatch" :loading="busy" @click="requestPatch" />
          </div>

          <!-- 4. Result / errors -->
          <Message v-if="filePath && store.validationError" severity="warn" :closable="false">{{ store.validationError }} </Message>

          <Message v-if="lastResult" :severity="lastResult.ok ? 'success' : 'error'" closable @close="lastResult = null">
            <div class="flex flex-col">
              <span>{{ lastResult.message }}</span>
              <span v-if="lastResult.ok && lastResult.backupPath" class="text-xs font-mono break-all"> Backup: {{ lastResult.backupPath }} </span>
            </div>
          </Message>
        </div>
      </template>
    </Card>

    <!-- Patch confirmation -->
    <ConfirmDialog group="patch" :closable="false" :style="{ width: '22rem' }">
      <template #message>
        <div class="flex flex-col gap-2 text-sm w-full">
          <div>
            <span class="text-surface-500">File:</span> <span class="font-mono break-all">{{ filePath }}</span>
          </div>
          <div>
            <span class="text-surface-500">Search:</span> <span class="font-mono">{{ store.prettySearch() }}</span>
          </div>
          <div>
            <span class="text-surface-500">Replace:</span> <span class="font-mono">{{ store.prettyReplace() }}</span>
          </div>
          <p class="text-xs text-surface-500 mt-2">A backup is made automatically before writing.</p>
        </div>
      </template>
    </ConfirmDialog>

    <!-- Restore confirmation -->
    <ConfirmDialog group="restore" :closable="false" :style="{ width: '22rem' }">
      <template #message>
        <div class="flex flex-col gap-2 text-sm w-full">
          <p>This deletes the current executable and restores it from the backup:</p>
          <div class="font-mono break-all">{{ backupName }}</div>
        </div>
      </template>
    </ConfirmDialog>
    <!-- About dialog -->
    <Dialog v-model:visible="showAbout" modal header="About" :style="{ width: '22rem' }">
      <div class="flex flex-col items-center gap-3 py-2 text-sm text-center">
        <img src="/logo.png" alt="Bar None icon" class="w-16 h-16" />
        <div class="flex flex-col gap-1">
          <span class="text-base font-bold">Bar None</span>
          <span class="dark:text-gray-300 text-gray-500">Ultrawide cutscene fixer</span>
          <span v-if="appVersion" class="dark:text-gray-300 text-gray-500">v{{ appVersion }}</span>
        </div>
        <p class="text-xs max-w-xs dark:text-gray-300 text-gray-500">Patches game executables to replace the hardcoded aspect ratio with your monitor's ratio, removing cutscene black bars.</p>
      </div>
    </Dialog>

    <!-- Update check result -->
    <Dialog v-model:visible="showUpdate" modal header="Check for updates" :closable="false" :style="{ width: '22rem' }">
      <div class="flex flex-col gap-2 text-sm">
        <template v-if="updateAvailable">
          <p>A new version is available.</p>
          <p class="font-mono text-surface-500">v{{ appVersion }} → v{{ latestVersion }}</p>
        </template>
        <template v-else>
          <p>
            You're on the latest version<span v-if="appVersion"> (v{{ appVersion }})</span>.
          </p>
        </template>
      </div>
      <template #footer>
        <Button :label="updateAvailable ? 'Close' : 'OK'" severity="secondary" text @click="showUpdate = false" />
        <Button v-if="updateAvailable" label="Download" icon="pi pi-download" class="text-white!" @click="downloadUpdate" />
      </template>
    </Dialog>

    <!-- Reset saved data confirmation -->
    <ConfirmDialog group="reset" :closable="false" :style="{ width: '22rem' }">
      <template #message>
        <div class="flex flex-col gap-2 text-sm w-full">
          <p>This will clear your recent files, restore the target resolution to your monitor's detected resolution, and reset the search bytes to 16:9.</p>
          <p>Your theme preference is kept.</p>
        </div>
      </template>
    </ConfirmDialog>
  </main>
</template>
