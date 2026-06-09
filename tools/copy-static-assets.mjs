import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const spaIndex = resolve(dist, "index.html");

await cp(resolve(root, "assets"), resolve(dist, "assets"), {
  recursive: true,
  force: true,
});

await mkdir(resolve(dist, "online"), { recursive: true });
await cp(spaIndex, resolve(dist, "online", "index.html"), {
  force: true,
});

await mkdir(resolve(dist, "auth", "callback"), { recursive: true });
await cp(spaIndex, resolve(dist, "auth", "callback", "index.html"), {
  force: true,
});

await rm(resolve(dist, "prototype"), {
  recursive: true,
  force: true,
});

await cp(resolve(root, "prototype"), resolve(dist, "prototype"), {
  recursive: true,
  force: true,
});

await cp(resolve(root, "prototype", "mobile-layout", "index.html"), spaIndex, {
  force: true,
});
