import { div } from "gpui-kit";
import { overlaps } from "./biome-world.js";

const OUTLINE = "#2a2639";
const WIDTH = 14;
const HEIGHT = 15;
const SPRITES = new Map(Object.entries({
  idle: {
    scale: 1.6, fill: "#aacef5", light: "#f1f9ff", shade: "#7397cb", ink: "#253657",
    lift: 2, period: 2800, priority: 0,
    glyph: [
      "#######",
      ".....##",
      "....##.",
      "...##..",
      "..##...",
      ".##....",
      "#######",
    ],
  },
  done: {
    scale: 1.8, fill: "#75ebae", light: "#d9ffe9", shade: "#41b17f", ink: "#164738",
    lift: 3, period: 1500, priority: 1,
    glyph: [
      ".......",
      ".....##",
      "....##.",
      "#..##..",
      "####...",
      ".##....",
      ".......",
    ],
  },
  blocked: {
    scale: 2, fill: "#ffd065", light: "#fff4c4", shade: "#e99445", ink: "#542d36",
    lift: 4, period: 850, priority: 2,
    strokes: [[2, 0, 3, 4], [2, 5, 3, 2]],
  },
  error: {
    scale: 2, fill: "#d94b57", light: "#ffb1a7", shade: "#ab344e", ink: "#fff4e4",
    lift: 4, period: 850, priority: 2,
    glyph: [
      "##...##",
      ".##.##.",
      "..###..",
      "...#...",
      "..###..",
      ".##.##.",
      "##...##",
    ],
  },
}));
const ROW_SPACING = Math.max(...Array.from(SPRITES.values(), ({scale, lift}) => HEIGHT * scale + lift)) + 3;

function pixelBubble(sprite) {
  const {scale, fill, light, shade, ink, glyph, strokes} = sprite;
  const rect = (x, y, w, h, color) => div().absolute()
    .left(x * scale).top(y * scale).w(w * scale).h(h * scale).bg(color);
  const bubble = div().absolute().left(0).top(0).size_full()
    // Overlapping rectangles make the stepped outline and its tail.
    .child(rect(2, 0, 10, 12, OUTLINE))
    .child(rect(1, 1, 12, 10, OUTLINE))
    .child(rect(0, 2, 14, 8, OUTLINE))
    .child(rect(4, 11, 4, 2, OUTLINE))
    .child(rect(4, 12, 3, 2, OUTLINE))
    .child(rect(4, 13, 2, 2, OUTLINE))
    .child(rect(2, 1, 10, 10, shade))
    .child(rect(1, 2, 12, 8, shade))
    .child(rect(5, 11, 2, 1, shade))
    .child(rect(5, 11, 1, 2, shade))
    .child(rect(2, 1, 10, 8, fill))
    .child(rect(1, 2, 12, 6, fill))
    .child(rect(3, 1, 8, 1, light))
    .child(rect(2, 2, 1, 2, light));
  // Paint solid strokes as single quads so fractional zoom cannot split them.
  for (const [x, y, w, h] of strokes ?? []) {
    bubble.child(rect(4 + x, 2 + y, w, h, ink));
  }
  for (const [y, row] of (glyph ?? []).entries()) {
    for (const run of row.matchAll(/#+/g)) {
      bubble.child(rect(4 + run.index, 2 + y, run[0].length, 1, ink));
    }
  }
  return bubble;
}

export function statusSprites(notifications, {width, height}, motionEpoch) {
  const visible = notifications.map(notification => ({...notification, sprite: SPRITES.get(notification.status)}))
    .filter(({sprite, bounds: [left, top, right, bottom]}) =>
      sprite && right > 0 && left < width && bottom > 0 && top < height)
    .sort((a, b) => b.sprite.priority - a.sprite.priority);
  const occupied = [];
  const elements = [];
  for (const {address, status, bounds: [left, top, right], sprite, duration = 0} of visible) {
    const {scale, lift, period} = sprite;
    const w = WIDTH * scale, h = HEIGHT * scale;
    // Leave the habitat controls clear whenever the panel has enough headroom.
    const minY = height >= 38 + lift + h ? 38 + lift : lift;
    const above = top - h - 2;
    const upperRight = left + (right - left) * .7 - 5 * scale;
    const upperLeft = left + (right - left) * .3 - 5 * scale;
    const sideY = Math.max(above, minY);
    const shoulders = [[upperRight, above], [upperLeft, above]];
    const sides = [[right + 4, sideY], [left - w - 4, sideY]];
    const candidates = above >= minY ? [...shoulders, ...sides] : [...sides, ...shoulders];
    candidates.push([upperRight + w + 8, above], [upperLeft - w - 8, above],
      [upperRight, above - ROW_SPACING]);
    const fit = ([x, y]) => ({
      x: Math.max(0, Math.min(x, width - w)),
      y: Math.max(0, Math.min(Math.max(y, minY), height - h)),
    });
    const footprint = ({x, y}) => ({x, y: y - lift, w, h: h + lift});
    const position = candidates
      .filter(([x, y]) => x >= 0 && x + w <= width && y >= minY && y + h <= height)
      .map(([x, y]) => ({x, y}))
      .find(point => occupied.every(other => !overlaps(footprint(point), other, 2)))
      ?? fit([upperRight, above]);
    occupied.push(footprint(position));
    const {x, y} = position;
    elements.push(div().id(`pokemon-status-position-${address}-${motionEpoch}`).absolute().left(x).top(y).w(w).h(h)
      .transition("left", {duration, easing: "linear"})
      .transition("top", {duration, easing: "linear"})
      .child(pixelBubble(sprite).id(`pokemon-status-${address}-${status}`)
        .loop("top", {from: 0, to: -Math.min(lift, y), period, easing: "ease-in-out"})));
  }
  // Place urgent alerts first, then paint them above the others if space runs out.
  return elements.reverse();
}
