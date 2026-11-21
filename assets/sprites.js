import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { SPRITE_PATH, SPRITE_VERSION, movePackPath } from "../asset-paths.js";
import { moveForSpecies } from "../moves.js";
import { download, downloadFiles, hashes, isFile, publishFile, publishPack, readManifest,
  withPackLock, writeManifest } from "./cache.js";
import { buildLifecycle, CANVAS_SIZE } from "./effects.js";
import { animationBounds, Raster, readRaster, unionBounds, writeAnimation } from "./raster.js";
import { buildMove } from "./move-effects.js";

const SOURCE = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master";
const LIMIT = 4 * 1024 * 1024;
const TIMEOUT = 6_000;
const DIRECTIONS = ["s", "se", "e", "ne", "n", "nw", "w", "sw"];
const GESTURES = ["Hop", "Rotate", "Pose", "Nod", "DeepBreath", "Eat", "LookUp", "Stretch",
  "Shake", "Dance", "Appeal", "Swing", "Double", "Shoot"];
const WORK_ACTIONS = ["Attack", "QuickStrike", "Charge", "Swing"];
const CAST_POSES = ["Shoot", "SpAttack", ...WORK_ACTIONS, "Idle"];
const REQUIRED = ["Walk", "Idle", "Sleep"];
const FILE_NAME = /^[a-z0-9_-]+\.webp$/;
const MOVE_PACK_VERSION = 2;
const XML = new XMLParser({
  processEntities: false,
  parseTagValue: false,
  isArray: (_name, path) => ["AnimData.Anims.Anim", "AnimData.Anims.Anim.Durations.Duration"].includes(path),
});

function roundPixel(value) {
  // Match the half-pixel rounding used by the existing sprite packs.
  const lower = Math.floor(value);
  return value - lower === .5 ? lower + (lower & 1) : Math.round(value);
}

function chooseAnimations(metadata, movePoses = []) {
  const nodes = new Map(XML.parse(metadata.toString("utf8")).AnimData?.Anims?.Anim?.map((node) => [node.Name, node]));
  const gestures = GESTURES.filter((name) => nodes.has(name)).slice(0, 8);
  const work = WORK_ACTIONS.find((name) => nodes.has(name)) ?? "Idle";
  const movePose = movePoses.find(name => nodes.has(name));
  const sources = new Map();
  const actions = new Set([...REQUIRED, work, ...gestures]);
  if (movePose) actions.add(movePose);
  for (const action of actions) {
    const seen = new Set();
    let name = action, node = nodes.get(name);
    while (node?.CopyOf) {
      if (seen.has(name)) throw new Error("Cyclic SpriteCollab animation alias");
      seen.add(name);
      name = node.CopyOf;
      node = nodes.get(name);
    }
    if (!node || !/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`${action} animation is unavailable`);
    sources.set(action.toLowerCase(), { node, filename: `${name}-Anim.png` });
  }
  return { sources, gestures: gestures.map((name) => name.toLowerCase()), work: work.toLowerCase(), movePose: movePose?.toLowerCase() };
}

async function unpack(data, node) {
  const sheet = await readRaster(data);
  const width = Number(node.FrameWidth), height = Number(node.FrameHeight);
  const ticks = node.Durations?.Duration?.map(Number) ?? [];
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
      !ticks.length || ticks.length > 128 || ticks.some((tick) => !Number.isInteger(tick) || tick <= 0 || tick > 3600) ||
      sheet.width !== width * ticks.length || ![height, height * 8].includes(sheet.height)) {
    throw new Error("Unexpected SpriteCollab sheet dimensions or timing");
  }
  const durations = ticks.map((tick) => Math.max(10, Math.round(tick * 1000 / 60)));
  const rows = Array.from({ length: sheet.height / height }, (_, row) => ticks.map((_, col) =>
    sheet.crop(col * width, row * height, width, height)));
  return { rows, durations };
}

function spriteAlignment(animations) {
  // All sheets share a centered origin. Measure every frame relative to it.
  let bounds = null;
  for (const { rows } of animations.values()) {
    for (const frame of rows.flat()) {
      const box = frame.bounds();
      if (box) bounds = unionBounds(bounds, box.map((value, index) =>
        value - (index % 2 ? frame.height : frame.width) / 2));
    }
  }
  if (!bounds) throw new Error("SpriteCollab sheets are empty");
  const [left, top, right, bottom] = bounds;
  const scale = Math.min(2, 40 / Math.max(Math.abs(left), Math.abs(right), 1), 76 / Math.max(bottom - top, 1));
  return { scale: scale * CANVAS_SIZE / 96, anchor: (88 - bottom * scale) * CANVAS_SIZE / 96 };
}

function framePlacement(frame, { scale, anchor }) {
  const width = Math.max(1, roundPixel(frame.width * scale));
  const height = Math.max(1, roundPixel(frame.height * scale));
  return { width, height, left: roundPixel((CANVAS_SIZE - width) / 2), top: roundPixel(anchor - height / 2) };
}

function placeFrame(frame, alignment) {
  const { width, height, left, top } = framePlacement(frame, alignment);
  const canvas = new Raster(CANVAS_SIZE, CANVAS_SIZE);
  canvas.composite(frame.resize(width, height), left, top);
  return canvas;
}

async function readCached(folder, number) {
  const manifest = await readManifest(folder);
  if (manifest?.version !== SPRITE_VERSION || manifest.number !== number ||
      !REQUIRED.every((name) => manifest.animations?.[name.toLowerCase()])) return null;
  if (!(await Promise.all(["credits.txt", "AnimData.xml", "ATTRIBUTION.txt"].map((file) =>
    isFile(join(folder, file), { allowEmpty: file === "credits.txt" })))).every(Boolean)) return null;
  for (const group of Object.values(manifest.animations)) {
    if (!group || !DIRECTIONS.every((direction) => typeof group[direction] === "string" &&
      FILE_NAME.test(group[direction]))) return null;
    if (!(await Promise.all(DIRECTIONS.map((direction) => isFile(join(folder, group[direction]))))).every(Boolean)) {
      return null;
    }
  }
  let repaired = false;
  if (!manifest.bounds) {
    manifest.bounds = {};
    for (const [action, group] of Object.entries(manifest.animations)) {
      manifest.bounds[action] = {};
      for (const direction of DIRECTIONS) {
        manifest.bounds[action][direction] = await animationBounds(join(folder, group[direction]));
      }
    }
    repaired = true;
  }
  if (!manifest.lifecycle || !await isFile(join(folder, "release.webp")) || !await isFile(join(folder, "recall.webp"))) {
    const staging = await mkdtemp(join(folder, ".effects-"));
    try {
      manifest.lifecycle = await buildLifecycle(await readRaster(join(folder, manifest.animations.idle.s)), staging);
      for (const name of ["release.webp", "recall.webp"]) await rename(join(staging, name), join(folder, name));
      repaired = true;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  if (repaired) {
    await publishFile(join(folder, "manifest.json"), (file) => writeFile(file, JSON.stringify(manifest)));
  }
  return manifest;
}

async function buildSprites(folder, number) {
  const source = `${SOURCE}/sprite/${String(number).padStart(4, "0")}`;
  const metadata = await download(`${source}/AnimData.xml`, LIMIT, TIMEOUT);
  const { sources, gestures, work } = chooseAnimations(metadata);
  const filenames = [...new Set([...Array.from(sources.values(), ({ filename }) => filename), "credits.txt"])];
  const files = await downloadFiles(source, filenames, LIMIT, TIMEOUT);
  const animations = new Map();
  for (const [action, { node, filename }] of sources) animations.set(action, await unpack(files[filename], node));
  const alignment = spriteAlignment(animations);
  const manifest = {
    version: SPRITE_VERSION, canvasSize: CANVAS_SIZE, number, source,
    communityArtworkLicense: "https://creativecommons.org/licenses/by-nc/4.0/",
    animations: {}, durations: {}, bounds: {}, alignment, randomActions: gestures, workAction: work,
    sha256: hashes({ ...files, "AnimData.xml": metadata }),
  };
  for (const [action, { rows, durations }] of animations) {
    manifest.animations[action] = {};
    manifest.bounds[action] = {};
    manifest.durations[action] = durations.reduce((sum, duration) => sum + duration, 0);
    for (const [row, direction] of DIRECTIONS.entries()) {
      const frames = (rows[row] ?? rows[0]).map((frame) => placeFrame(frame, alignment));
      const filename = `${action}-${direction}.webp`;
      await writeAnimation(frames, durations, 0, join(folder, filename));
      manifest.animations[action][direction] = filename;
      const bounds = frames.reduce((box, frame) => unionBounds(box, frame.bounds()), null);
      manifest.bounds[action][direction] = bounds?.map((value) => value * 96 / CANVAS_SIZE) ?? [24, 24, 72, 88];
    }
  }
  await writeFile(join(folder, "credits.txt"), files["credits.txt"]);
  await writeFile(join(folder, "AnimData.xml"), metadata);
  await writeFile(join(folder, "ATTRIBUTION.txt"),
    `SpriteCollab: ${source}\nArtist credits: see credits.txt\nReuse policy: ${SOURCE}/README.md\n` +
    "Community artwork: CC BY-NC 4.0, https://creativecommons.org/licenses/by-nc/4.0/\n" +
    "Original game artwork: Chunsoft. Pokémon characters belong to their respective owners.\n" +
    "Converted to animated WebP with common canvas alignment.\n");
  const idle = await readRaster(join(folder, manifest.animations.idle.s));
  manifest.lifecycle = await buildLifecycle(idle, folder);
  await writeManifest(folder, manifest);
  return manifest;
}

export async function prepareSprites(appHome, number) {
  const destination = join(appHome, SPRITE_PATH, String(number));
  return withPackLock(destination, async () => {
    const cached = await readCached(destination, number);
    return cached ?? publishPack(destination, (folder) => buildSprites(folder, number));
  });
}

export async function prepareMove(appHome, number) {
  const move = moveForSpecies(number);
  if (!move) throw new Error("Elemental move is unavailable for this species");
  const version = number === 9 ? 3 : MOVE_PACK_VERSION;
  const path = movePackPath(move, number);
  const destination = join(appHome, path);
  return withPackLock(destination, async () => {
    const cached = await readManifest(destination);
    if (cached?.version === version && cached.duration && cached.frame && (await Promise.all(DIRECTIONS.map((direction) =>
      cached.bounds?.[direction] && isFile(join(destination, `${direction}.webp`))))).every(Boolean)) return { ...cached, path };
    return publishPack(destination, async (folder) => {
      const base = await prepareSprites(appHome, number);
      const source = `${SOURCE}/sprite/${String(number).padStart(4, "0")}`;
      const metadata = await readFile(join(appHome, SPRITE_PATH, String(number), "AnimData.xml"));
      const { sources, movePose } = chooseAnimations(metadata, move === "shockwave-ring" ? WORK_ACTIONS.concat("Idle") : CAST_POSES);
      const pose = sources.get(movePose);
      const offsets = pose.filename.replace("-Anim.png", "-Offsets.png");
      const names = new Set([pose.filename, offsets]);
      // Older v4 packs already have sprites on disk, but lack their source alignment.
      const baseSources = [...sources].filter(([action]) => base.animations[action]);
      if (!base.alignment) for (const [, {filename}] of baseSources) names.add(filename);
      const files = await downloadFiles(source, [...names], LIMIT, TIMEOUT);
      const alignment = base.alignment ?? spriteAlignment(new Map(await Promise.all(baseSources.map(
        async ([action, {node, filename}]) => [action, await unpack(files[filename], node)]))));
      const { rows, durations } = await unpack(files[pose.filename], pose.node);
      const offsetRows = (await unpack(files[offsets], pose.node)).rows;
      const result = await buildMove({
        folder, move, number, directions: DIRECTIONS, rows, offsetRows, durations, hitFrame: Number(pose.node.HitFrame),
        canvasSize: CANVAS_SIZE, alignment, placeFrame, framePlacement,
      });
      const manifest = { version, ...result };
      await writeManifest(folder, manifest);
      return { ...manifest, path };
    });
  });
}
