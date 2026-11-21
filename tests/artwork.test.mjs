import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SPRITE_PATH, movePackPath } from "../asset-paths.js";
import { families, infoFor } from "../evolution.js";
import { moveForSpecies } from "../moves.js";
import { prepareEvolution } from "../assets/effects.js";
import { animationBounds, Raster, readImageMetadata, writePng } from "../assets/raster.js";
import { prepareSprites, prepareMove } from "../assets/sprites.js";
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

test("water-jet packs add directional one-shots to older cached companions", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pokemon-water-jet-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const shootTicks = [2, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2];
  const metadata = `<AnimData><Anims>
    <Anim><Name>Idle</Name><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight>
      <Durations><Duration>12</Duration></Durations></Anim>
    <Anim><Name>Walk</Name><CopyOf>Idle</CopyOf></Anim>
    <Anim><Name>Sleep</Name><CopyOf>Idle</CopyOf></Anim>
    <Anim><Name>Shoot</Name><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight><HitFrame>4</HitFrame>
      <Durations>${shootTicks.map(ticks => `<Duration>${ticks}</Duration>`).join("")}</Durations></Anim>
  </Anims></AnimData>`;
  const idle = new Raster(8, 8), shoot = new Raster(8 * shootTicks.length, 8), markers = new Raster(shoot.width, 8);
  idle.fill(2, 2, 4, 4, [140, 125, 90, 255]);
  for (let col = 0; col < shootTicks.length; col++) {
    shoot.fill(col * 8 + 2, 2, 4, 4, [140, 125 + col, 90, 255]);
  }
  markers.set(4 * 8 + 4, 3, [0, 0, 0, 255]);
  const files = { "AnimData.xml": metadata, "credits.txt": "Test artist" };
  for (const [name, raster] of [["Idle-Anim.png", idle], ["Shoot-Anim.png", shoot], ["Shoot-Offsets.png", markers]]) {
    await writePng(raster, join(home, name));
    files[name] = await readFile(join(home, name));
  }
  const fetch = t.mock.method(globalThis, "fetch", async (url) => new Response(files[new URL(url).pathname.split("/").at(-1)]));
  const { alignment, ...legacy } = await prepareSprites(home, 7);
  const manifest = join(home, SPRITE_PATH, "7", "manifest.json");
  await writeFile(manifest, JSON.stringify(legacy));

  const jet = await prepareMove(home, 7);
  assert.equal(jet.path, movePackPath("water-jet", 7));
  assert.deepEqual(JSON.parse(await readFile(manifest, "utf8")), legacy);
  assert.equal(Object.keys(jet.bounds).length, 8);
  for (const direction of Object.keys(jet.bounds)) {
    const path = join(home, jet.path, `${direction}.webp`);
    const clip = await readImageMetadata(path);
    assert.equal(clip.loop, 1);
    assert.equal(clip.delay.reduce((sum, delay) => sum + delay, 0), jet.duration);
  }
  assert.deepEqual(jet.bounds.e, legacy.bounds.idle.e);
  const effectBounds = await animationBounds(join(home, jet.path, "e.webp"));
  assert.ok(effectBounds[2] * jet.frame.width / 96 + jet.frame.left > jet.bounds.e[2]);
  const calls = fetch.mock.callCount();
  assert.deepEqual(await prepareMove(home, 7), jet);
  assert.equal(fetch.mock.callCount(), calls);
});

test("every roster species gets its type's move, including Eevee's evolved forms", () => {
  const expected = {
    Grass: "leaf-storm", Fire: "fire-breath", Water: "water-jet", Electric: "lightning-whip",
    Fairy: "fairy-nova", Normal: "shockwave-ring", Ghost: "shadow-burst", Dragon: "dragon-pulse",
  };
  for (const mon of families.flat()) {
    const {number, name, type} = infoFor(mon);
    assert.ok(expected[type], name);
    assert.equal(moveForSpecies(number), expected[type], name);
  }
  assert.deepEqual([133, 134, 135, 136].map(moveForSpecies), [
    "shockwave-ring", "water-jet", "lightning-whip", "fire-breath",
  ]);
  assert.equal(moveForSpecies(1025), undefined);
});
