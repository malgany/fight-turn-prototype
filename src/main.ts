import "./styles.css";
import { App } from "./app";
import { isSupabaseConfigured } from "./lib/config";
import { DemoGameService } from "./services/demoGameService";
import { SupabaseGameService } from "./services/supabaseGameService";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Elemento #app nao encontrado.");
}

const service = isSupabaseConfigured ? new SupabaseGameService() : new DemoGameService();
const app = new App(root, service);

void app.start();
