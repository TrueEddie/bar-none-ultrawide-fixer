<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import Button from "primevue/button";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import Dialog from "primevue/dialog";

import { usePatcherStore, type PatchResult } from "./stores/patcher";
import { PRESETS } from "./utils/hex";

const store = usePatcherStore();
const {
  filePath,
  mode,
  sourceHex,
  presetId,
  calcWidth,
  calcHeight,
  customSearchHex,
  customReplaceHex,
  busy,
  lastResult,
} = storeToRefs(store);

const showConfirm = ref(false);

async function pickFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  if (typeof selected === "string") {
    filePath.value = selected;
    lastResult.value = null;
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
  } catch (err) {
    store.setError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main
    class="min-h-screen w-full bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-0 px-6 py-8"
  >
    <div class="mx-auto max-w-2xl flex flex-col gap-6">
      <!-- Header -->
      <header>
        <h1 class="text-2xl font-bold tracking-tight">Bar None</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400">
          Ultrawide cutscene fixer — patches a game's 16:9 aspect-ratio bytes to your
          monitor's ratio so cutscenes fill the screen.
        </p>
      </header>

      <!-- 1. File picker -->
      <section class="flex flex-col gap-2">
        <label class="text-sm font-medium">Game executable</label>
        <div class="flex gap-2">
          <InputText
            :model-value="filePath"
            readonly
            placeholder="No file selected…"
            class="flex-1"
          />
          <Button label="Choose .exe…" severity="secondary" @click="pickFile" />
        </div>
      </section>

      <!-- 2. Search pattern -->
      <section class="flex flex-col gap-2">
        <label class="text-sm font-medium">Search for (current aspect bytes)</label>
        <InputText v-model="sourceHex" class="font-mono" :disabled="mode === 'custom'" />
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Default <code>39 8E E3 3F</code> is 16:9 — what most games hardcode. Custom mode
          uses its own field below.
        </p>
      </section>

      <!-- 3. Target (three modes) -->
      <section class="flex flex-col gap-2">
        <label class="text-sm font-medium">Replace with (target aspect)</label>
        <Tabs v-model:value="mode">
          <TabList>
            <Tab value="preset">Preset</Tab>
            <Tab value="calculator">Resolution</Tab>
            <Tab value="custom">Custom hex</Tab>
          </TabList>
          <TabPanels>
            <!-- Preset -->
            <TabPanel value="preset">
              <Select
                v-model="presetId"
                :options="PRESETS"
                option-label="label"
                option-value="id"
                class="w-full"
              />
              <p class="mt-2 font-mono text-sm">→ {{ store.effectiveReplaceHex }}</p>
            </TabPanel>

            <!-- Resolution calculator -->
            <TabPanel value="calculator">
              <div class="flex items-center gap-2">
                <InputNumber
                  v-model="calcWidth"
                  :use-grouping="false"
                  :min="1"
                  class="w-32"
                />
                <span class="text-surface-500">×</span>
                <InputNumber
                  v-model="calcHeight"
                  :use-grouping="false"
                  :min="1"
                  class="w-32"
                />
              </div>
              <p class="mt-2 font-mono text-sm">
                ratio {{ (calcWidth / calcHeight).toFixed(5) }} → {{ store.effectiveReplaceHex }}
              </p>
            </TabPanel>

            <!-- Custom hex -->
            <TabPanel value="custom">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-medium">Search for</label>
                <InputText v-model="customSearchHex" class="font-mono" />
                <label class="text-xs font-medium mt-1">Replace with</label>
                <InputText v-model="customReplaceHex" class="font-mono" />
              </div>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </section>

      <!-- Backup notice (always-on, not optional) -->
      <Message severity="info" :closable="false">
        A timestamped backup (<code>&lt;file&gt;.YYYYMMDD-HHMMSS.bak</code>) is always created
        next to the exe before patching.
      </Message>

      <!-- Validation / patch -->
      <section class="flex flex-col gap-3">
        <Message
          v-if="store.validationError"
          severity="warn"
          :closable="false"
        >{{ store.validationError }}</Message>

        <Button
          :label="busy ? 'Patching…' : 'Patch executable'"
          :disabled="!store.canPatch"
          :loading="busy"
          @click="requestPatch"
        />
      </section>

      <!-- Result -->
      <Message
        v-if="lastResult"
        :severity="lastResult.ok ? 'success' : 'error'"
        :closable="false"
      >
        <div class="flex flex-col">
          <span>{{ lastResult.message }}</span>
          <span v-if="lastResult.ok" class="text-xs font-mono break-all">
            Backup: {{ lastResult.backupPath }}
          </span>
        </div>
      </Message>
    </div>

    <!-- Confirmation dialog -->
    <Dialog
      v-model:visible="showConfirm"
      modal
      header="Confirm patch"
      :style="{ width: '32rem' }"
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
  </main>
</template>
