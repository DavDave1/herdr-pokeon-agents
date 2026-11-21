import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";
import { Raster, unionBounds, writeAnimation } from "./raster.js";

const SIZE = 96;
const PADDING = 40;
const FRAME_SIZE = SIZE + PADDING * 2;
const EFFECTS = {
  "dragon-pulse": { pivot: [18, 32], length: .34, width: .4, timeScale: .65, hold: 320 },
  "fairy-nova": { pivot: [64, 48], anchor: "body", length: .55, width: .48, timeScale: .46, hold: 250 },
  "fire-breath": { pivot: [8, 50], length: .3, width: .38, timeScale: .45, hold: 340 },
  "leaf-storm": { pivot: [3, 28], length: .58, width: .54, timeScale: .56, hold: 300 },
  "lightning-whip": { pivot: [14, 44], length: .37, width: .5, timeScale: .58, hold: 240 },
  "shadow-burst": { pivot: [56, 54], anchor: "body", distance: 18, length: .58, width: .55, timeScale: .59, hold: 320 },
  "shockwave-ring": { pivot: [60, 30], anchor: "feet", length: .59, width: .54, timeScale: .48, hold: 100 },
  "water-jet": { pivot: [8, 20], length: .4, width: .4, timeScale: .57, hold: 440 },
};
// Barrel openings in Blastoise's firing pose. The near barrel comes first.
const BLASTOISE_MUZZLES = {
  s: [[13.5, 24.5], [34.5, 24.5]],
  se: [[20.5, 26], [28.5, 18.5]],
  e: [[31, 24.5], [26, 16]],
  ne: [[33, 19], [23, 11]],
  n: [[14.5, 10.5], [33.5, 10.5]],
  nw: [[15, 19], [25, 11]],
  w: [[17, 24.5], [22, 16]],
  sw: [[27.5, 26], [19.5, 18.5]],
};

async function readEffect(move, { timeScale }) {
  const path = fileURLToPath(new URL(`./${move}.webp`, import.meta.url));
  const { data, info } = await sharp(path, { animated: true }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { delay: delays } = await sharp(path).metadata();
  const height = info.pageHeight;
  const bytes = info.width * height * 4;
  const frames = delays.map((_, index) => new Raster(info.width, height, data.subarray(index * bytes, (index + 1) * bytes)));
  return { frames, delays: delays.map(delay => Math.round(delay * timeScale)) };
}

function frameStarts(delays) {
  let time = 0;
  return delays.map(delay => {
    const start = time;
    time += delay;
    return start;
  }).concat(time);
}

// WebP playback can replace delays of 10 ms or less with a 100 ms delay.
const webpTime = (time) => Math.round(time / 20) * 20;

function headMarker(offsets) {
  for (let y = 0; y < offsets.height; y++) for (let x = 0; x < offsets.width; x++) {
    const [r, g, b, a] = offsets.pixel(x, y);
    if (a && !r && !g && !b) return [x + .5, y + .5];
  }
  return null;
}

function headPosition(frame, offsets) {
  const box = frame.bounds();
  return headMarker(offsets) ?? [(box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) / 3];
}

function drawEffect(frame, effect, bounds, [x, y], dx, dy, tuning) {
  const [pivotX, pivotY] = tuning.pivot;
  const reach = tuning.length / Math.hypot(dx, dy / .55);
  for (let row = 0; row < frame.height; row++) for (let col = 0; col < frame.width; col++) {
    const u = col + .5 - x - PADDING, v = row + .5 - y - PADDING;
    const sx = Math.floor(pivotX + (dx * u + dy * v) / reach);
    const sy = Math.floor(pivotY + (-dy * u + dx * v) / tuning.width);
    if (sx >= bounds[0] && sx < bounds[2] && sy >= bounds[1] && sy < bounds[3]) {
      const pixel = effect.pixel(sx, sy);
      if (pixel[3]) frame.set(col, row, pixel);
    }
  }
}

export async function buildMove({
  folder, move, number, directions, rows, offsetRows, durations, hitFrame, canvasSize, alignment, placeFrame, framePlacement,
}) {
  const tuning = EFFECTS[move];
  const cannonShot = number === 9 && durations.length === 6 && rows[0][0].width === 48 && rows[0][0].height === 56;
  const release = cannonShot ? 1
    : Number.isInteger(hitFrame) && hitFrame >= 0 && hitFrame < durations.length ? hitFrame : 0;
  const effect = await readEffect(move, tuning);
  // The twin streams supply the flash. Hold the clean cannon pose and skip the baked flash frames.
  const poseDelays = cannonShot ? [...durations.slice(0, 2), ...durations.slice(4)] : [...durations];
  poseDelays[release] = Math.max(tuning.hold, poseDelays[release]);
  const poseStarts = frameStarts(poseDelays).map(webpTime);
  const effectStarts = frameStarts(effect.delays).map(start => webpTime(start + poseStarts[release]));
  // Looping artwork such as the beam needs a clean final frame for a one-shot.
  const effectEnd = effectStarts.at(-1) + (effect.frames.at(-1).bounds() ? 40 : 0);
  const starts = [...new Set([...poseStarts, ...effectStarts, effectEnd])].sort((a, b) => a - b);
  const delays = starts.slice(1).map((start, index) => start - starts[index]);
  const duration = starts.at(-1);
  const bounds = {};
  const scale = canvasSize / SIZE, fullSize = FRAME_SIZE * scale, padding = PADDING * scale;
  for (const [row, direction] of directions.entries()) {
    const sourcePoses = rows[row] ?? rows[0], offsets = offsetRows[row] ?? offsetRows[0];
    const poses = cannonShot ? [...sourcePoses.slice(0, 2), ...sourcePoses.slice(4)] : sourcePoses;
    const body = poses.map(frame => placeFrame(frame, alignment));
    const bodyBounds = body.reduce((box, frame) => unionBounds(box, frame.bounds()), null);
    bounds[direction] = bodyBounds.map(value => value / scale);
    const angle = Math.PI / 2 - row * Math.PI / 4;
    const heading = Math.atan2(Math.sin(angle) * .55, Math.cos(angle));
    const dx = Math.cos(heading), dy = Math.sin(heading);
    const firingPose = poses[release], placement = framePlacement(firingPose, alignment);
    const [left, top, right, bottom] = (body[release].bounds() ?? bodyBounds).map(value => value / scale);
    const distance = tuning.distance ?? 0;
    const origins = tuning.anchor
      ? [[(left + right) / 2 + dx * distance,
        (tuning.anchor === "feet" ? bottom : (top + bottom) / 2) + dy * distance * .55]]
      : (cannonShot ? BLASTOISE_MUZZLES[direction] : [headPosition(firingPose, offsets[release])]).map(([x, y]) => [
        (placement.left + x * placement.width / firingPose.width) / scale + (cannonShot ? 0 : dx * 3),
        (placement.top + y * placement.height / firingPose.height) / scale + (cannonShot ? 0 : Math.max(1, dy * 3)),
      ]);
    const headingX = tuning.anchor ? 1 : dx, headingY = tuning.anchor ? 0 : dy;
    const behind = [], inFront = [];
    for (const [index, origin] of origins.entries()) {
      const occluded = tuning.anchor || dy < -.2 || (cannonShot && index === 1 && direction !== "s");
      (occluded ? behind : inFront).push(origin);
    }
    const effectLayers = effect.frames.map(effectFrame => {
      const box = effectFrame.bounds();
      return [behind, inFront].map(layer => {
        if (!box || !layer.length) return null;
        const frame = new Raster(FRAME_SIZE, FRAME_SIZE);
        for (const origin of layer) drawEffect(frame, effectFrame, box, origin, headingX, headingY, tuning);
        return frame.resize(fullSize, fullSize);
      });
    });
    const frames = starts.slice(0, -1).map(start => {
      const frame = new Raster(fullSize, fullSize);
      const pose = Math.min(body.length - 1, poseStarts.findLastIndex(time => time <= start));
      const layers = effectLayers[effectStarts.findLastIndex(time => time <= start)];
      if (layers?.[0]) frame.composite(layers[0], 0, 0);
      frame.composite(body[pose], padding, padding);
      if (layers?.[1]) frame.composite(layers[1], 0, 0);
      return frame;
    });
    await writeAnimation(frames, delays, 1, join(folder, `${direction}.webp`));
  }
  return { duration, bounds, frame: { width: FRAME_SIZE, height: FRAME_SIZE, left: -PADDING, top: -PADDING } };
}
