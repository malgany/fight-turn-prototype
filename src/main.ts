import "./styles.css";
import { App } from "./app";
import { isSupabaseConfigured } from "./lib/config";
import { setupMobileAuthRedirect } from "./lib/mobileAuth";
import { DemoGameService } from "./services/demoGameService";
import { SupabaseGameService } from "./services/supabaseGameService";

if ("serviceWorker" in navigator) {
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
