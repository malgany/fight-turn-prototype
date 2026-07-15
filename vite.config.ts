/// <reference types="node" />

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

const gameAssetsRoot = resolve("assets");
const gameAssetsPrefix = "/game-assets";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

function gameAssetsDevServer(): Plugin {
  return {
    name: "final-genesis-game-assets-dev-server",
    configureServer(server) {
      server.middlewares.use(gameAssetsPrefix, (request, response, next) => {
        if (!request.url || !["GET", "HEAD"].includes(request.method || "GET")) {
          next();
          return;
        }

        const requestPath = new URL(request.url, "http://localhost").pathname;
        const filePath = resolve(gameAssetsRoot, `.${decodeURIComponent(requestPath)}`);
        const normalizedRoot = `${gameAssetsRoot}${sep}`.toLowerCase();

        if (!filePath.toLowerCase().startsWith(normalizedRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream");

        if (request.method === "HEAD") {
          response.end();
          return;
        }

        createReadStream(filePath).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [gameAssetsDevServer()],
  server: {
    port: 5173,
    watch: {
      // The prototype reads these files through the custom middleware above.
      // Watching tens of thousands of generated Android files and animation
      // frames on Windows exhausts handles and starves local asset responses.
      ignored: ["**/android/**", "**/assets/**"],
    },
  },
  preview: {
    port: 4173,
  },
});
