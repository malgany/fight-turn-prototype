import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.malganiplay.finalgenesis",
  appName: "Final Genesis",
  webDir: "dist",
  bundledWebRuntime: false,
  android: {
    buildOptions: {
      releaseType: "AAB",
    },
  },
};

export default config;
