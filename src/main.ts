import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";
import App from "./App.vue";
import { preloadSettings } from "./utils/settings";
import { initTheme } from "./utils/theme";
import "primeicons/primeicons.css";
import "./style.css";

// Aura's default primary is emerald; remap it to indigo.
const BarNonePreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "{indigo.50}",
      100: "{indigo.100}",
      200: "{indigo.200}",
      300: "{indigo.300}",
      400: "{indigo.400}",
      500: "{indigo.500}",
      600: "{indigo.600}",
      700: "{indigo.700}",
      800: "{indigo.800}",
      900: "{indigo.900}",
      950: "{indigo.950}",
    },
  },
});

async function bootstrap() {
  // Load persisted settings from disk before mounting, so the store and theme
  // hydrate synchronously and there's no flash.
  await preloadSettings();
  initTheme();

  const app = createApp(App);
  app.use(createPinia());
  app.use(PrimeVue, {
    theme: {
      preset: BarNonePreset,
      options: {
        // Manual light/dark via the `.app-dark` class on <html> (see utils/theme).
        darkModeSelector: ".app-dark",
        // Emit PrimeVue's component CSS into the `primevue` cascade layer, which
        // style.css orders between Tailwind's base and utilities layers.
        cssLayer: { name: "primevue", order: "theme, base, primevue, components, utilities" },
      },
    },
  });
  app.mount("#app");
}

bootstrap();
