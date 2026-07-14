import { access, cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const sourceAssets = resolve(root, "assets");
const gameAssets = resolve(dist, "game-assets");
const spaIndex = resolve(dist, "index.html");

const requiredBackgrounds = [
  "stage-training-zone.webp",
  "stage-ravenfall-day.webp",
  "stage-ravenfall-night.webp",
  "stage-black-forest-cellar.webp",
  "title-screen-fighters.webp",
  "online-shell.webp",
];

const scanFiles = [
  "src/styles.css",
  "src/app.ts",
  "src/data/characters.ts",
  "prototype/mobile-layout/index.html",
  "assets/characters/ninja/ninja.json",
  "assets/characters/itzcoatl/itzcoatl.json",
  "assets/characters/urban/urban.json",
  "assets/characters/doll/doll.json",
  "assets/characters/iop/iop.json",
];

const characterConfigPaths = [
  "characters/ninja/ninja.json",
  "characters/itzcoatl/itzcoatl.json",
  "characters/urban/urban.json",
  "characters/doll/doll.json",
  "characters/iop/iop.json",
];

const animationFrameLimits = {
  idle: 60,
  getUp: 90,
  crouch: 90,
  jump: 60,
  special: 100,
  ultimate: 120,
};

await rm(gameAssets, { recursive: true, force: true });
await mkdir(gameAssets, { recursive: true });

await copyDirectory("audio");
await copyDirectory("effects");
await copyDirectory("fonts");
await copyDirectory("characters", {
  exclude: (relativePath) => relativePath === "old" || relativePath.startsWith("old/"),
});
await copyDirectory("ui", {
  exclude: (relativePath) =>
    relativePath === "action-panel/buttons/old" ||
    relativePath.startsWith("action-panel/buttons/old/") ||
    relativePath === "action-panel/buttons/question.png",
});

await mkdir(join(gameAssets, "backgrounds"), { recursive: true });
for (const fileName of requiredBackgrounds) {
  await cp(join(sourceAssets, "backgrounds", fileName), join(gameAssets, "backgrounds", fileName), {
    force: true,
  });
}

await validateStaticReferences();
await validateCharacterFrames();

await mkdir(resolve(dist, "online"), { recursive: true });
await cp(spaIndex, resolve(dist, "online", "index.html"), {
  force: true,
});

await mkdir(resolve(dist, "auth", "callback"), { recursive: true });
await cp(spaIndex, resolve(dist, "auth", "callback", "index.html"), {
  force: true,
});
await cp(spaIndex, resolve(dist, "auth", "callback.html"), {
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

async function copyDirectory(directory, options = {}) {
  const from = join(sourceAssets, directory);
  const to = join(gameAssets, directory);
  await copyTree(from, to, "", options.exclude || (() => false));
}

async function copyTree(from, to, relativePath, exclude) {
  const normalizedRelativePath = normalizePath(relativePath);
  if (normalizedRelativePath && exclude(normalizedRelativePath)) {
    return;
  }

  const entries = await readdir(from, { withFileTypes: true });
  await mkdir(to, { recursive: true });

  for (const entry of entries) {
    const childRelativePath = normalizePath(join(relativePath, entry.name));
    if (exclude(childRelativePath)) {
      continue;
    }

    const sourcePath = join(from, entry.name);
    const targetPath = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath, childRelativePath, exclude);
    } else if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, { force: true });
    }
  }
}

async function validateStaticReferences() {
  const required = new Set();
  const assetPathPattern = /(?:\/|\.\.\/\.\.\/)game-assets\/([^"'`),\s]+)|\bgame-assets\/([^"'`),\s]+)/g;

  for (const filePath of scanFiles) {
    const text = await readFile(resolve(root, filePath), "utf8");
    for (const match of text.matchAll(assetPathPattern)) {
      const assetPath = normalizeAssetPath(match[1] || match[2]);
      if (!assetPath || assetPath.includes("{frame}")) {
        continue;
      }
      required.add(assetPath);
    }
  }

  await assertExistingAssets([...required]);
}

async function validateCharacterFrames() {
  for (const configPath of characterConfigPaths) {
    const raw = await readFile(join(gameAssets, configPath), "utf8");
    const config = JSON.parse(raw);
    for (const [animationKey, animation] of Object.entries(config.animations || {})) {
      const framePattern = normalizeAssetPath(String(animation.framePattern || ""));
      const frameCount = Number(animation.frameCount || 0);
      const framePad = Number(animation.framePad || 0);
      const frameStart = Number(animation.frameStart ?? 1);
      const frameStep = Number(animation.frameStep ?? 1);
      if (
        !framePattern ||
        !framePattern.includes("{frame}") ||
        !Number.isInteger(frameCount) ||
        frameCount < 1 ||
        !Number.isInteger(frameStart) ||
        frameStart < 1 ||
        !Number.isInteger(frameStep) ||
        frameStep < 1
      ) {
        throw new Error(`Invalid animation declaration in ${configPath}`);
      }

      const frameNumbers = Array.from({ length: frameCount }, (_, index) => frameStart + index * frameStep);
      const requiredFrames = sampleAnimationFrameNumbers(frameNumbers, animationFrameLimits[animationKey])
        .map((frame) => framePattern.replace("{frame}", String(frame).padStart(framePad, "0")));
      await assertExistingAssets(requiredFrames);
    }
  }
}

function sampleAnimationFrameNumbers(frameNumbers, frameLimit) {
  if (!Number.isInteger(frameLimit) || frameLimit < 1 || frameNumbers.length <= frameLimit) {
    return frameNumbers;
  }

  if (frameLimit === 1) {
    return [frameNumbers[0]];
  }

  const lastIndex = frameNumbers.length - 1;
  return Array.from({ length: frameLimit }, (_, index) => {
    const sourceIndex = Math.round((index * lastIndex) / (frameLimit - 1));
    return frameNumbers[sourceIndex];
  });
}

async function assertExistingAssets(assetPaths) {
  const missing = [];
  for (const assetPath of assetPaths) {
    try {
      await access(join(gameAssets, assetPath));
    } catch {
      missing.push(assetPath);
    }
  }

  if (missing.length) {
    throw new Error(`Missing copied game assets:\n${missing.slice(0, 50).join("\n")}`);
  }
}

function normalizeAssetPath(value) {
  const withoutQuery = value.split("?")[0].split("#")[0];
  const marker = "game-assets/";
  const markerIndex = withoutQuery.indexOf(marker);
  const relativePath = markerIndex >= 0 ? withoutQuery.slice(markerIndex + marker.length) : withoutQuery;
  return normalizePath(relativePath.replace(/^\/+/, ""));
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}
