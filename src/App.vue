<script setup lang="ts">
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import Button from "primevue/button";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import Card from "primevue/card";
import Menu from "primevue/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { usePatcherStore, CUSTOM_ID, type PatchResult } from "./stores/patcher";
import { PRESETS } from "./utils/hex";
import { toggleTheme, isDark } from "./utils/theme";

const store = usePatcherStore();
const { filePath, sourceHex, resolutionId, calcWidth, calcHeight, busy, lastResult } =
  storeToRefs(store);

const showConfirm = ref(false);
const showRestore = ref(false);
const editingSearch = ref(false);

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
    label: "Exit",
    icon: "pi pi-sign-out",
    command: () => {
      getCurrentWindow().close();
    },
  },
]);
function toggleMenu(event: Event) {
  menu.value?.toggle(event);
}

const resolutionOptions = computed(() => [
  ...PRESETS,
  { id: CUSTOM_ID, label: "Custom resolution…" },
]);

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

async function pickFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  if (typeof selected === "string") {
    filePath.value = selected;
    lastResult.value = null;
    await refreshBackups();
  }
}

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
</script>

<template>
  <main
    class="min-h-screen w-full text-surface-900 dark:text-surface-0 flex items-center justify-center p-2"
  >
    <Card class="mx-auto max-w-sm overflow-hidden border border-gray-500" >
      <template #header>
        <div class="bg-linear-to-b from-indigo-950 to-indigo-500 relative flex items-center p-5" data-tauri-drag-region>
          <Button
            icon="pi pi-bars"
            text
            rounded
            aria-label="Menu"
            class="!absolute !top-2 !right-2 !text-white"
            @click="toggleMenu"
          />
          <Menu ref="menu" :model="menuItems" popup append-to="body" />
          <div class="flex flex-row items-center gap-3 pointer-events-none">
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
              <InputText
                id="game-executable"
                :model-value="filePath"
                readonly
                placeholder="Select game executable…"
                class="w-full"
              />
            <Button label="Search" severity="secondary" @click="pickFile" class="w-25" />
          </section>

          <!-- 2. Target resolution -->
          <section class="flex flex-col gap-2">
            <label class="text-sm font-medium">Target resolution</label>
            <Select
              v-model="resolutionId"
              :options="resolutionOptions"
              option-label="label"
              option-value="id"
              placeholder="Select a resolution preset or choose custom…"
              class="w-full"
            >
              <template #option="{ option }">
                <div class="flex items-center justify-between gap-4 w-full">
                  <span>{{ option.label }}</span>
                  <span
                    v-if="option.value"
                    class="font-mono text-xs text-gray-400 dark:text-surface-500"
                  >{{ option.value }}</span>
                </div>
              </template>
            </Select>
            <div v-if="resolutionId === CUSTOM_ID" class="flex items-center gap-2">
              <InputNumber v-model="calcWidth" :use-grouping="false" :min="1" class="w-32" />
              <span class="text-surface-500">×</span>
              <InputNumber v-model="calcHeight" :use-grouping="false" :min="1" class="w-32" />
            </div>
          </section>

          <!-- 3. Search bytes (collapsed by default, editable) -->
          <section class="flex items-center gap-2 text-sm">
            <span class="text-surface-500">Search bytes:</span>
            <InputText
              v-if="editingSearch"
              v-model="sourceHex"
              class="font-mono flex-1"
              @keyup.enter="editingSearch = false"
            />
            <span v-else class="font-mono">{{ sourceHex }}</span>
            <span v-if="!editingSearch" class="text-xs text-surface-400">(16:9 default)</span>
            <Button
              :icon="editingSearch ? 'pi pi-check' : 'pi pi-pencil'"
              text
              rounded
              size="small"
              :aria-label="editingSearch ? 'Done editing search bytes' : 'Edit search bytes'"
              @click="editingSearch = !editingSearch"
            />
          </section>

          <!-- 4. Patch / Restore -->
          <div class="flex gap-2">
            <Button
              class="flex-1 bg-indigo-500"
              :label="busy ? 'Patching…' : 'Patch executable'"
              :disabled="!store.canPatch"
              :loading="busy"
              @click="requestPatch"
            />
            <Button
              v-if="store.hasBackups"
              label="Restore"
              icon="pi pi-history"
              severity="secondary"
              outlined
              :disabled="busy"
              @click="requestRestore"
            />
          </div>

          <!-- 5. Result / errors -->
          <Message
            v-if="filePath && store.validationError"
            severity="warn"
            :closable="false"
          >{{ store.validationError }}</Message>

          <Message
            v-if="lastResult"
            :severity="lastResult.ok ? 'success' : 'error'"
            :closable="false"
          >
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
    <Dialog
      v-model:visible="showConfirm"
      modal
      header="Confirm patch"
      :style="{ width: '22rem' }"
    >
      <div class="flex flex-col gap-2 text-sm">
        <div><span class="text-surface-500">File:</span> <span class="font-mono break-all">{{ filePath }}</span></div>
        <div><span class="text-surface-500">Search:</span> <span class="font-mono">{{ store.prettySearch() }}</span></div>
        <div><span class="text-surface-500">Replace:</span> <span class="font-mono">{{ store.prettyReplace() }}</span></div>
        <p class="text-xs text-surface-500 mt-2">A backup is made automatically before writing.</p>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showConfirm = false" />
        <Button label="Patch" @click="confirmPatch" />
      </template>
    </Dialog>

    <!-- Restore confirmation dialog -->
    <Dialog
      v-model:visible="showRestore"
      modal
      header="Restore from backup"
      :style="{ width: '22rem' }"
    >
      <div class="flex flex-col gap-2 text-sm">
        <p>This deletes the current executable and restores it from the backup:</p>
        <div class="font-mono break-all">{{ backupName }}</div>
        <p class="text-xs text-surface-500 mt-1">
          The current (patched) file is removed and replaced with the backup.
        </p>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="showRestore = false" />
        <Button label="Restore" severity="danger" @click="confirmRestore" />
      </template>
    </Dialog>
  </main>
</template>
