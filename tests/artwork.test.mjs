import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SPRITE_PATH } from "../asset-paths.js";
import { prepareEvolution } from "../assets/effects.js";
import { Raster, readImageMetadata, writePng } from "../assets/raster.js";
import { prepareSprites } from "../assets/sprites.js";
import { addEdges, MASKS } from "../assets/terrain-tiles.js";

function solid(color) {
  const tile = new Raster(16, 16);
  tile.fill(0, 0, 16, 16, color);
  return tile;
}

test("all 47 water and ground masks produce opaque tiles", () => {
  const floor = [20, 100, 40, 255], patch = [40, 180, 60, 255], water = [20, 100, 220, 255];
  const tiles = new Map([["1", solid(floor)], ["13", solid(patch)]]);
  for (const id of [200, 201, 202, 208, 209, 210, 216, 217, 218]) tiles.set(String(id), solid(water));
  addEdges(tiles);
  assert.equal(MASKS.length, 47);
  for (const kind of ["water", "grass"]) {
    for (const mask of MASKS) {
      const tile = tiles.get(`${kind}-${mask}`);
      assert.deepEqual([tile.width, tile.height], [16, 16]);
      assert.ok(tile.data.every((value, offset) => offset % 4 !== 3 || value === 255));
    }
  }
  const pixel = (name, x, y) => [...tiles.get(name).pixel(x, y)];
  assert.deepEqual(pixel("grass-255", 0, 0), patch);
  assert.deepEqual(pixel("grass-0", 0, 0), floor);
  assert.deepEqual(pixel("grass-0", 8, 8), patch);
  assert.deepEqual(pixel("water-15", 0, 0), floor);
  assert.deepEqual(pixel("water-15", 8, 8), water);
});

test("sprite and evolution packs preserve timing, credits, and shared cache behavior", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pokemon-artwork-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const metadata = `<AnimData><Anims>
    <Anim><Name>Walk</Name><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight>
      <Durations><Duration>6</Duration><Duration>9</Duration></Durations></Anim>
    <Anim><Name>Idle</Name><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight>
      <Durations><Duration>12</Duration></Durations></Anim>
    <Anim><Name>Sleep</Name><CopyOf>Idle</CopyOf></Anim>
  </Anims></AnimData>`;
  const spriteSheet = new Raster(16, 64);
  for (let row = 0; row < 8; row++) {
    spriteSheet.fill(2, row * 8 + 2, 4, 4, [80, 120, 200, 255]);
    spriteSheet.fill(10, row * 8 + 1, 4, 4, [80, 180, 90, 255]);
  }
  await writePng(spriteSheet, join(home, "walk.png"));
  await writePng(spriteSheet.crop(0, 0, 8, 8), join(home, "idle.png"));
  const files = {
    "AnimData.xml": metadata,
    "credits.txt": "Test artist",
    "Walk-Anim.png": await readFile(join(home, "walk.png")),
    "Idle-Anim.png": await readFile(join(home, "idle.png")),
  };
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    const [, species, file] = new URL(url).pathname.match(/\/sprite\/(\d+)\/([^/]+)$/);
    return species === "0003" ? new Response(null, { status: 404 }) : new Response(files[file]);
  });
  const [first, cached] = await Promise.all([prepareSprites(home, 1), prepareSprites(home, 1)]);
  assert.deepEqual(cached, first);
  assert.equal(fetch.mock.callCount(), 4);
  assert.deepEqual(first.durations, { walk: 250, idle: 200, sleep: 200 });
  assert.deepEqual(first.bounds.sleep, first.bounds.idle);
  assert.equal(Object.keys(first.animations.walk).length, 8);
  const folder = join(home, SPRITE_PATH, "1");
  assert.equal(await readFile(join(folder, "credits.txt"), "utf8"), "Test artist");
  const walk = await readImageMetadata(join(folder, first.animations.walk.e));
  assert.deepEqual([walk.width, walk.height, walk.pages, walk.delay, walk.loop], [384, 384, 2, [100, 150], 0]);
  const release = await readImageMetadata(join(folder, "release.webp"));
  assert.equal(release.delay.reduce((sum, delay) => sum + delay, 0), first.lifecycle.release);
  assert.equal(release.loop, 1);
  const { bounds, lifecycle, ...older } = first;
  await writeFile(join(folder, "manifest.json"), JSON.stringify(older));
  await rm(join(folder, "release.webp"));
  const repaired = await prepareSprites(home, 1);
  assert.deepEqual(repaired.bounds, bounds);
  assert.deepEqual(repaired.lifecycle, lifecycle);
  assert.equal(fetch.mock.callCount(), 4);
  await prepareSprites(home, 2);
  const effect = await prepareEvolution(home, 1, 2);
  const effectInfo = await readImageMetadata(join(home, effect.path));
  assert.equal(effectInfo.delay.reduce((sum, delay) => sum + delay, 0), effect.duration);
  assert.equal(effectInfo.loop, 1);
  await assert.rejects(prepareSprites(home, 3), /HTTP 404/);
  assert.deepEqual((await readdir(join(home, SPRITE_PATH))).sort(), ["1", "2"]);
});
