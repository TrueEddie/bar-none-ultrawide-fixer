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
  import Card from "primevue/card";
  import Menu from "primevue/menu";
  import Popover from "primevue/popover";
  import SplitButton from "primevue/splitbutton";
  import Tag from "primevue/tag";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

  import { usePatcherStore, type PatchResult } from "./stores/patcher";
  import { SOURCE_16_9 } from "./utils/hex";
  import { toggleTheme, isDark } from "./utils/theme";

  const store = usePatcherStore();
  const { filePath, sourceHex, calcWidth, calcHeight, busy, lastResult } =
    storeToRefs(store);

  const showConfirm = ref(false);
  const showRestore = ref(false);
  const showReset = ref(false);
  const showAbout = ref(false);
  const editingSearch = ref(false);

  // Exe icons as data URLs, keyed by path (covers the selected file and recents).
  const recentIcons = ref<Record<string, string>>({});
  const pathPopover = ref<InstanceType<typeof Popover> | null>(null);
  const exeName = computed(() =>
    filePath.value ? filePath.value.split(/[\\/]/).pop() : ""
  );
  const iconUrl = computed(() =>
    filePath.value ? recentIcons.value[filePath.value] ?? null : null
  );
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
  function showPath(event: Event) {
    if (filePath.value) pathPopover.value?.show(event);
  }
  function hidePath() {
    pathPopover.value?.hide();
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
      command: () => { showReset.value = true; },
    },
    {
      label: "About",
      icon: "pi pi-info-circle",
      command: () => { showAbout.value = true; },
    },
  ]);
  function confirmReset() {
    showReset.value = false;
    store.resetSavedData();
    recentIcons.value = {};
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
  const backupName = computed(() =>
    store.latestBackup ? store.latestBackup.split(/[\\/]/).pop() : ""
  );

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
    }
  );

  // Keep recent-file icons loaded for the dropdown.
  watch(() => store.recentFiles.map((r) => r.path).join("|"), loadRecentIcons, {
    immediate: true,
  });

  function requestPatch() {
    if (!store.canPatch) return;
    showConfirm.value = true;
  }

  async function confirmPatch() {
    showConfirm.value = false;
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
    showRestore.value = true;
  }

  async function confirmRestore() {
    showRestore.value = false;
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
  });
  onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <main ref="rootEl" class="w-fit text-surface-900 dark:text-surface-0">
    <Card class="w-96 overflow-hidden border border-gray-500 !shadow-none rounded-xl">
      <template #header>
        <div class="bg-linear-to-b from-indigo-950 to-indigo-500 flex flex-col">
          <!-- title-bar controls: hamburger left, minimize/close right (the drag handle) -->
          <div class="flex items-center justify-between px-1 pt-1" data-tauri-drag-region>
            <Button icon="pi pi-bars" text rounded size="small" aria-label="Menu" class="!text-white"
              @click="toggleMenu" />
            <Menu ref="menu" :model="menuItems" popup append-to="body" />
            <div class="flex items-center">
              <Button icon="pi pi-minus" text rounded size="small" aria-label="Minimize" class="!text-white"
                @click="minimizeWindow" />
              <Button icon="pi pi-times" text rounded size="small" aria-label="Close" class="!text-white"
                @click="closeWindow" />
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
              class="flex-1 flex items-center gap-2 py-1 px-2 rounded-md border dark:bg-black border-gray-300 dark:border-gray-600 overflow-hidden"
              @mouseenter="showPath" @mouseleave="hidePath">
              <template v-if="filePath">
                <img v-if="iconUrl" :src="iconUrl" alt="" class="w-7 h-7 shrink-0 rounded" />
                <i v-else class="pi pi-file shrink-0 opacity-50" />
                <span class="truncate text-sm">{{ exeName }}</span>
              </template>
              <template v-else>
                <div
                  class="w-7 h-7 shrink-0 rounded border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
                  <i class="pi pi-image text-xs opacity-40" />
                </div>
                <span class="text-sm opacity-60">No executable selected</span>
              </template>
            </div>
            <SplitButton label="Search" severity="secondary" :model="recentMenuItems" @click="pickFile">
              <template #item="{ item, props }">
                <a v-bind="props.action" class="flex items-center gap-2 px-2 py-2">
                  <img v-if="item.path && recentIcons[item.path]" :src="recentIcons[item.path]" alt=""
                    class="w-5 h-5 shrink-0 rounded" />
                  <i v-else-if="item.path" class="pi pi-file text-xs opacity-50 shrink-0" />
                  <span class="truncate text-sm">{{ item.label }}</span>
                </a>
              </template>
            </SplitButton>
          </section>
          <Popover ref="pathPopover" placement="top">
            <div class="max-w-xs text-sm font-mono break-all">{{ filePath }}</div>
          </Popover>

          <!-- 2. Target resolution + from → to hex -->
          <section class="flex flex-col gap-2">
            <label class="text-sm font-medium">Target resolution</label>
            <div class="flex items-center gap-2 w-full">
              <InputNumber v-model="calcWidth" :use-grouping="false" :min="1" placeholder="3440" fluid
                class="flex-1 min-w-0" />
              <span class="text-surface-500 shrink-0">×</span>
              <InputNumber v-model="calcHeight" :use-grouping="false" :min="1" placeholder="1440" fluid
                class="flex-1 min-w-0" />
            </div>

            <div class="flex items-center gap-2 text-sm mt-2">
              <!-- from: a tag when idle, an inline input (with reset + save inside) when editing -->
              <div v-if="editingSearch" class="relative flex-1 min-w-0">
                <InputText v-model="sourceHex" class="font-mono w-full pr-16" autofocus
                  @keyup.enter="editingSearch = false" />
                <div class="absolute inset-y-0 right-1 flex items-center">
                  <Button v-if="sourceHex !== SOURCE_16_9" icon="pi pi-replay" text rounded size="small"
                    aria-label="Reset search bytes to 16:9" @click="sourceHex = SOURCE_16_9" />
                  <Button icon="pi pi-check" text rounded size="small" aria-label="Done editing search bytes"
                    @click="editingSearch = false" />
                </div>
              </div>
              <Tag v-else :value="sourceHex" :severity="sourceHex === SOURCE_16_9 ? 'secondary' : 'warn'"
                class="font-mono cursor-pointer" @click="editingSearch = true" />
              <i class="pi pi-arrow-right text-xs opacity-60 shrink-0" />
              <span class="font-mono shrink-0">{{ store.effectiveReplaceHex || "—" }}</span>
            </div>
          </section>

          <!-- 4. Patch / Restore -->
          <div class="flex gap-2">
            <Button v-if="store.hasBackups" label="Restore" icon="pi pi-history" severity="secondary" outlined
              :disabled="busy" @click="requestRestore" />
            <Button class="flex-1 bg-indigo-500 text-white!" :label="busy ? 'Patching…' : 'Patch Executable'"
              :disabled="!store.canPatch" :loading="busy" @click="requestPatch" />
          </div>

          <!-- 5. Result / errors -->
          <Message v-if="filePath && store.validationError" severity="warn" :closable="false">{{ store.validationError
          }}
          </Message>

          <Message v-if="lastResult" :severity="lastResult.ok ? 'success' : 'error'" closable
            @close="lastResult = null">
            <div class="flex flex-col">
              <span>{{ lastResult.message }}</span>
              <span v-if="lastResult.ok && lastResult.backupPath" class="text-xs font-mono break-all">
                Backup: {{ lastResult.backupPath }}
              </span>
            </div>
          </Message>
        </div>
      </template>
    </Card>

    <!-- Confirmation dialog -->
    <Dialog v-model:visible="showConfirm" modal header="Confirm patch" :style="{ width: '22rem' }">
      <div class="flex flex-col gap-2 text-sm">
        <div><span class="text-surface-500">File:</span> <span class="font-mono break-all">{{ filePath }}</span></div>
        <div><span class="text-surface-500">Search:</span> <span class="font-mono">{{ store.prettySearch() }}</span>
        </div>
        <div><span class="text-surface-500">Replace:</span> <span class="font-mono">{{ store.prettyReplace() }}</span>
        </div>
        <p class="text-xs text-surface-500 mt-2">A backup is made automatically before writing.</p>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showConfirm = false" />
        <Button label="Patch" @click="confirmPatch" class="text-white!" />
      </template>
    </Dialog>

    <!-- Restore confirmation dialog -->
    <Dialog v-model:visible="showRestore" modal header="Restore from backup" :style="{ width: '22rem' }">
      <div class="flex flex-col gap-2 text-sm">
        <p>This deletes the current executable and restores it from the backup:</p>
        <div class="font-mono break-all">{{ backupName }}</div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showRestore = false" />
        <Button label="Restore" severity="danger" @click="confirmRestore" />
      </template>
    </Dialog>
    <!-- About dialog -->
    <Dialog v-model:visible="showAbout" modal header="About" :style="{ width: '22rem' }">
      <div class="flex flex-col items-center gap-3 py-2 text-sm text-center">
        <img src="/logo.png" alt="Bar None icon" class="w-16 h-16" />
        <div class="flex flex-col gap-1">
          <span class="text-base font-bold">Bar None</span>
          <span class="text-gray-300">Ultrawide cutscene fixer</span>
          <span class="text-gray-300">v0.1.0</span>
        </div>
        <p class="text-surface-500 text-xs max-w-xs text-gray-500">
          Patches game executables to replace the hardcoded aspect ratio with your monitor's ratio, removing cutscene
          black
          bars.
        </p>
      </div>
    </Dialog>

    <!-- Reset saved data confirmation dialog -->
    <Dialog v-model:visible="showReset" modal header="Reset saved data" :style="{ width: '22rem' }">
      <div class="flex flex-col gap-2 text-sm">
        <p>This will clear your recent files, restore the default target resolution (5120×2160), and reset the search
          bytes
          to 16:9. Your theme preference is kept.</p>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showReset = false" />
        <Button label="Reset" severity="danger" @click="confirmReset" />
      </template>
    </Dialog>
  </main>
</template>
