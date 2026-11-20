import { join } from "node:path";
import { ASSET_ROOT, SPRITE_PATH } from "../asset-paths.js";
import { publishFile, withPackLock } from "./cache.js";
import { Raster, readImageMetadata, readRaster, writeAnimation } from "./raster.js";

export const CANVAS_SIZE = 384;
const FLASH = [255, 245, 198, 255];
const OUTLINE = [48, 48, 62, 255];

function ball(open) {
  const art = new Raster(16, 16);
  art.fill(5, 2, 6, 12, OUTLINE);
  art.fill(3, 3, 10, 10, OUTLINE);
  art.fill(2, 5, 12, 6, OUTLINE);
  art.fill(5, 3, 6, 4, [233, 84, 81, 255]);
  art.fill(3, 5, 10, 2, [233, 84, 81, 255]);
  art.fill(5, 4, 3, 1, [255, 172, 160, 255]);
  art.fill(3, 9, 10, 2, [238, 233, 213, 255]);
  art.fill(5, 11, 6, 2, [198, 199, 198, 255]);
  art.fill(3, 7, 10, 2, OUTLINE);
  art.fill(6, 6, 4, 4, OUTLINE);
  art.fill(7, 7, 2, 2, [255, 247, 222, 255]);
  if (open) {
    art.fill(3, 6, 10, 4, FLASH);
    art.fill(5, 7, 6, 2, [255, 255, 255, 255]);
  }
  return art.resize(64, 64);
}

function burst(frame, radius) {
  radius = Math.min(radius, 40);
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    frame.fill(188 + x * radius, 324 + y * radius, 9, 9, FLASH);
  }
}

function tint(source, color, intensity) {
  const frame = source.copy();
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const value = frame.data[offset + channel];
      frame.data[offset + channel] = value + (color[channel] - value) * intensity;
    }
  }
  return frame;
}

const canvas = () => new Raster(CANVAS_SIZE, CANVAS_SIZE);
const total = (durations) => durations.reduce((sum, value) => sum + value, 0);

export async function buildLifecycle(source, folder) {
  const closed = ball(false), opened = ball(true);
  const frames = [], delays = [];
  function addFrame(frame, delay) {
    frames.push(frame);
    delays.push(delay);
  }
  for (const lift of [0, 8, 12, 4, 0]) {
    const frame = canvas();
    frame.composite(closed, 160, 296 - lift);
    addFrame(frame, 80);
  }
  for (const radius of [12, 28, 44]) {
    const frame = canvas();
    frame.composite(opened, 160, 296);
    burst(frame, radius);
    addFrame(frame, 70);
  }
  for (const ratio of [.16, .3, .48, .68, .86, 1]) {
    const frame = canvas();
    const size = Math.round(CANVAS_SIZE * ratio);
    const sprite = source.resize(size, size);
    frame.composite(ratio < .68 ? tint(sprite, FLASH, 1) : sprite,
      Math.round(192 * (1 - ratio)), Math.round(352 * (1 - ratio)));
    if (ratio < .68) frame.composite(opened, 160, 296);
    if (ratio < .86) burst(frame, Math.round(50 * ratio + 20));
    addFrame(frame, 70);
  }
  addFrame(source, 170);
  await writeAnimation(frames, delays, 1, join(folder, "release.webp"));
  const reverseDelays = [...delays].reverse().concat(120);
  await writeAnimation([...frames].reverse().concat(canvas()), reverseDelays, 1, join(folder, "recall.webp"));
  return { release: total(delays), recall: total(reverseDelays) };
}

function evolutionFrames(before, after) {
  const frames = [];
  for (let index = 0; index < 36; index++) {
    const source = index < 18 ? before : after;
    const intensity = index < 6 ? index / 5 : index < 26
      ? .75 + .25 * Math.sin((index - 6) * Math.PI / 3) ** 2 : Math.max(0, 1 - (index - 26) / 7);
    const frame = tint(source, [255, 245, 220], intensity);
    if (index >= 5 && index < 33) {
      const [left, top, right, bottom] = source.bounds() ?? [100, 100, 280, 340];
      const radius = Math.min(110, Math.max(right - left, bottom - top) / 2 + 16);
      const snap = (value) => Math.max(8, Math.min(372, Math.round(value / 4) * 4));
      for (let star = 0; star < 8; star++) {
        const angle = star * Math.PI / 4 + index * .06;
        const x = snap((left + right) / 2 + Math.cos(angle) * radius);
        const y = snap((top + bottom) / 2 + Math.sin(angle) * radius);
        frame.fill(x - 4, y - 4, 8, 8, [255, 241, 168, 255]);
        if ((index + star) % 3 === 0) {
          frame.fill(x - 8, y - 1, 16, 4, [255, 248, 229, 255]);
          frame.fill(x - 1, y - 8, 4, 16, [255, 248, 229, 255]);
        }
      }
    }
    frames.push(frame);
  }
  frames.push(after);
  return frames;
}

export async function prepareEvolution(appHome, oldNumber, newNumber) {
  const path = `${ASSET_ROOT}/evolution/${oldNumber}-${newNumber}.webp`;
  const destination = join(appHome, path);
  const delays = Array(36).fill(60).concat(240), duration = total(delays);
  return withPackLock(destination, async () => {
    const info = await readImageMetadata(destination).catch(() => null);
    if (info?.format === "webp" && info.loop === 1 && info.delay && total(info.delay) === duration) {
      return { duration, path };
    }
    const [before, after] = await Promise.all([oldNumber, newNumber].map((number) =>
      readRaster(join(appHome, SPRITE_PATH, String(number), "idle-s.webp"))));
    const frames = evolutionFrames(before, after);
    await publishFile(destination, (file) => writeAnimation(frames, delays, 1, file));
    return { duration, path };
  });
}
