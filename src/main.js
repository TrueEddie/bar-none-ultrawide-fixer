import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import App from "./App.vue";
import "./style.css";

const app = createApp(App);

app.use(createPinia());
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      // Emit PrimeVue's component CSS into the `primevue` cascade layer, which
      // style.css orders between Tailwind's base and utilities layers.
      cssLayer: { name: "primevue", order: "theme, base, primevue, components, utilities" },
    },
  },
});

app.mount("#app");
