import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import UPNG from "upng-js";
import { TERRAIN_PATH, TERRAIN_VERSION } from "../asset-paths.js";
import { downloadFiles, hashes, publishPack, readManifest, sha256, withPackLock, writeManifest } from "./cache.js";
import { Raster, readImageMetadata, writePng } from "./raster.js";
import { addEdges, addRoads, BIOME_VARIANTS, colors, MASKS, removeBackground, themedTiles } from "./terrain-tiles.js";

const SOURCE = "https://raw.githubusercontent.com/pret/pokeemerald/master/data/tilesets/primary/general";
const IDS = [108, 197, 268, 1, 4, 13, 21, 28, 104, 105, 106, 200, 201, 202, 208, 209, 210,
  216, 217, 218, 211, 212, 213, 214, 280, 281, 282, 288, 289, 290, 296, 297, 298];
// Matching broadleaf crown, canopy, and trunk, in row order.
const TREE = [462, 463, 468, 469, 486, 487];
const PALETTES = Array.from({ length: 7 }, (_, i) => `palettes/0${i}.pal`);
const NAMES = ["tiles.png", "metatiles.bin", ...PALETTES];
const TERRAIN_FILES = [...IDS, "rock", ...["road", "water", "grass"].flatMap((kind) =>
  MASKS.map((mask) => `${kind}-${mask}`))].map((name) => `${name}.png`);
const EXPECTED_FILES = ["tree.png", ...TERRAIN_FILES,
  ...BIOME_VARIANTS.flatMap((biome) => TERRAIN_FILES.map((name) => `${biome}/${name}`))];

function palette(data) {
  const [signature, version, size, ...entries] = data.toString("utf8").trim().split(/\r?\n/);
  const rows = entries.filter((line) => line.trim()).map((line) => line.trim().split(/\s+/).map(Number));
  if (signature !== "JASC-PAL" || version !== "0100" || size !== "16" || rows.length !== 16 ||
      rows.some((row) => row.length !== 3 || row.some((value) => !Number.isInteger(value) || value < 0 || value > 255))) {
    throw new Error("Unexpected Emerald palette");
  }
  return rows.map((rgb, index) => [...rgb, index ? 255 : 0]);
}

function readMetatiles(files) {
  const png = files["tiles.png"];
  const metadata = png.length >= 33 && png.subarray(12, 16).toString() === "IHDR";
  const depth = png[24];
  if (!metadata || png.readUInt32BE(16) !== 128 || png.readUInt32BE(20) !== 256 ||
      png[25] !== 3 || ![4, 8].includes(depth) || png[28] !== 0) {
    throw new Error("Unexpected indexed Emerald terrain sheet");
  }
  // Decode indices directly so each metatile can select its own palette.
  const pixels = UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)).data;
  const stride = 128 * depth / 8;
  if (pixels.length < stride * 256) throw new Error("Incomplete Emerald terrain sheet");
  const palettes = PALETTES.map((name) => palette(files[name]));
  const definitions = files["metatiles.bin"];
  if (definitions.length !== 8192) throw new Error("Unexpected Emerald metatile definitions");
  const metatiles = new Map();
  for (const id of [...IDS, ...TREE]) {
    const tile = new Raster(16, 16);
    for (let offset = 0; offset < 8; offset++) {
      const flags = definitions.readUInt16LE(id * 16 + offset * 2);
      const index = flags & 1023, colors = palettes[flags >> 12];
      if (index >= 512 || !colors) throw new Error("Unsupported Emerald tile reference");
      const left = index % 16 * 8, top = Math.floor(index / 16) * 8;
      const quadrantX = offset % 2 * 8, quadrantY = (Math.floor(offset / 2) % 2) * 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const px = left + (flags & 1024 ? 7 - x : x), py = top + (flags & 2048 ? 7 - y : y);
          const packed = pixels[py * stride + Math.floor(px * depth / 8)];
          const value = depth === 8 ? packed : (px % 2 ? packed & 15 : packed >> 4);
          if (value >= colors.length) throw new Error("Invalid Emerald palette index");
          if (value) tile.set(quadrantX + x, quadrantY + y, colors[value]);
        }
      }
    }
    metatiles.set(String(id), tile);
  }
  return metatiles;
}

async function saveTiles(folder, images) {
  await mkdir(folder, { recursive: true });
  const entries = [...images];
  for (let i = 0; i < entries.length; i += 16) {
    await Promise.all(entries.slice(i, i + 16).map(([name, tile]) =>
      writePng(tile.resize(tile.width * 3, tile.height * 3), join(folder, `${name}.png`))));
  }
}

export async function buildTerrain(files, folder) {
  const metatiles = readMetatiles(files);
  const tiles = new Map(IDS.map((id) => [String(id), metatiles.get(String(id))]));
  const tree = new Raster(32, 48);
  for (const [i, id] of TREE.entries()) {
    tree.composite(metatiles.get(String(id)), i % 2 * 16, Math.floor(i / 2) * 16);
  }
  tiles.set("tree", removeBackground(tree, colors(tiles.get("1"), tiles.get("28"))));
  const rockBackground = colors(tiles.get("1"));
  rockBackground.add("115,189,246");
  tiles.set("rock", removeBackground(tiles.get("197"), rockBackground));
  addRoads(tiles);
  for (const biome of BIOME_VARIANTS) {
    const variant = themedTiles(tiles, biome);
    addEdges(variant);
    await saveTiles(join(folder, biome), variant);
  }
  addEdges(tiles);
  await saveTiles(folder, tiles);
}

async function readCached(folder) {
  const manifest = await readManifest(folder);
  if (manifest?.version !== TERRAIN_VERSION || manifest.path !== TERRAIN_PATH ||
      Object.keys(manifest.files ?? {}).length !== EXPECTED_FILES.length) return null;
  for (const name of EXPECTED_FILES) {
    try {
      const data = await readFile(join(folder, name));
      if (sha256(data) !== manifest.files[name] || (await readImageMetadata(data)).format !== "png") return null;
    } catch {
      return null;
    }
  }
  return manifest;
}

export async function prepareTerrain(appHome) {
  const destination = join(appHome, TERRAIN_PATH);
  return withPackLock(destination, async () => {
    const cached = await readCached(destination);
    if (cached) return cached;
    const files = await downloadFiles(SOURCE, NAMES, 1024 * 1024, 8_000);
    return publishPack(destination, async (folder) => {
      await buildTerrain(files, folder);
      await writeFile(join(folder, "ATTRIBUTION.txt"),
        `Pokémon Emerald terrain. Original artwork: Nintendo / Game Freak / The Pokémon Company.\n` +
        `Source: ${SOURCE}/\nThe source archive does not grant an artwork license.\n` +
        "Reconstructed metatiles, nearest-neighbor scaling and connected terrain tiles.\n");
      const generated = {};
      for (const name of EXPECTED_FILES) generated[name] = sha256(await readFile(join(folder, name)));
      const manifest = { version: TERRAIN_VERSION, source: `${SOURCE}/`, path: TERRAIN_PATH,
        sources: hashes(files), files: generated };
      await writeManifest(folder, manifest);
      return manifest;
    });
  });
}
