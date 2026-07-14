import "./styles.css";
import { App } from "./app";
import { isNativeMobileApp, isSupabaseConfigured } from "./lib/config";
import { setupMobileAuthRedirect } from "./lib/mobileAuth";
import { DemoGameService } from "./services/demoGameService";
import { SupabaseGameService } from "./services/supabaseGameService";

if (isNativeMobileApp()) {
  window.addEventListener("load", () => {
    const unregisterWorkers = "serviceWorker" in navigator
      ? navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      : Promise.resolve([]);
    const clearGameCaches = "caches" in window
      ? caches.keys().then((names) => Promise.all(
          names
            .filter((name) => name.startsWith("fight-turn-static-"))
            .map((name) => caches.delete(name)),
        ))
      : Promise.resolve([]);
    void Promise.all([unregisterWorkers, clearGameCaches]).catch(() => {});
  });
} else if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

setupMobileAuthRedirect();

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Elemento #app não encontrado.");
}

const service = isSupabaseConfigured ? new SupabaseGameService() : new DemoGameService();
const app = new App(root, service);

void app.start();
