import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");

await cp(resolve(root, "assets"), resolve(dist, "assets"), {
  recursive: true,
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
