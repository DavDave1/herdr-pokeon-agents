import { getBiomeWorld, WORLD_HEIGHT, CHUNK } from "./biome-world.js";

// Emerald metatiles are 16px, packaged at 3× with nearest-neighbor sampling.
export const TILE = 32;
export const BIOME_TYPES = ["forest", "desert", "cave", "mountain"];
export const BIOME_LABELS = {forest: "Forest clearing", desert: "Desert oasis", cave: "Cavern", mountain: "Mountain pass"};
export const PLACEHOLDER_TILE = "mods/pokemon-agents/tiles/placeholder.svg";

// Cardinal joins plus diagonals distinguish convex and concave road corners.
export function roadMask(contains, x, y) {
  const n = contains(x, y - 1), e = contains(x + 1, y);
  const s = contains(x, y + 1), w = contains(x - 1, y);
  return (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0) |
    (n && e && contains(x + 1, y - 1) ? 16 : 0) |
    (e && s && contains(x + 1, y + 1) ? 32 : 0) |
    (s && w && contains(x - 1, y + 1) ? 64 : 0) |
    (w && n && contains(x - 1, y - 1) ? 128 : 0);
}

export function buildBiome(...args) {
  const steps = buildBiomeSteps(...args);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function* buildBiomeSteps(width, height, terrainPath = null, seed = 0, type = "forest") {
  if (!BIOME_TYPES.includes(type)) type = "forest";
  const forest = type === "forest", offsetY = height - WORLD_HEIGHT;
  const cols = Math.ceil(width / TILE), firstRow = Math.floor(-offsetY / TILE);
  const lastRow = Math.ceil(WORLD_HEIGHT / TILE);
  const ground = [], scenery = [], obstacles = [];
  const asset = id => `${terrainPath}${forest ? "" : `/${type}`}/${id}.png`;
  const world = getBiomeWorld(seed, type);
  const addGround = (x, y, kind, path) => {
    const tile = {x: x * TILE, y: y * TILE + offsetY, w: TILE, h: TILE};
    ground.push({...tile, path, kind});
    if (kind === "water") obstacles.push(tile);
  };
  if (!terrainPath) {
    // Roads and water can be drawn without generating the scenery chunks.
    for (let y = firstRow; y < lastRow; y++) for (let x = 0; x < cols; x++) {
      const kind = world.road(x, y) ? "road" : world.water(x, y) ? "water" : "ground";
      addGround(x, y, kind, forest && kind === "ground" ? PLACEHOLDER_TILE : null);
    }
    return {ground, scenery, obstacles};
  }
  const addProp = prop => {
    const y = prop.y + offsetY;
    scenery.push({...prop, id: `${type}-prop-${prop.id}`,
      path: asset(prop.kind), y, depth: prop.depth + offsetY});
    obstacles.push(prop.kind === "tree"
      ? {x: prop.x, y, w: prop.w, h: prop.h, kind: "tree"}
      : {x: prop.x + prop.w * .2, y: y + prop.h - TILE * .65, w: prop.w * .6, h: TILE * .6});
  };
  // Include neighboring owners so canopies and collisions remain correct at
  // chunk borders and when a resize reveals part of a previously hidden prop.
  for (let cy = Math.floor((firstRow - 4) / CHUNK); cy <= Math.floor((lastRow + 4) / CHUNK); cy++)
    for (let cx = -1; cx <= Math.floor((cols + 4) / CHUNK); cx++) {
      const chunk = world.chunk(cx, cy);
      for (const tile of chunk.ground) {
        if (tile.x < 0 || tile.x >= cols || tile.y < firstRow || tile.y >= lastRow) continue;
        const kind = tile.kind;
        const id = kind === "ground" ? 1 : `${kind}-${roadMask((x,y) => world.cell(x,y) === kind, tile.x, tile.y)}`;
        addGround(tile.x, tile.y, kind, asset(id));
      }
      for (const prop of chunk.props) {
        if (prop.x + prop.w < 0 || prop.x > width || prop.y + prop.h + offsetY < 0 || prop.y + offsetY > height) continue;
        addProp(prop);
      }
      yield;
    }
  // Let the viewport crop the world naturally; no artificial top contour.
  scenery.sort(compareDepth);
  return {ground, scenery, obstacles};
}

export function compareDepth(a, b) {
  return a.depth - b.depth || (a.x ?? 0) - (b.x ?? 0);
}

function crossesBox(fromX, fromY, x, y, left, top, right, bottom) {
  if (Math.max(fromX, x) <= left || Math.min(fromX, x) >= right ||
      Math.max(fromY, y) <= top || Math.min(fromY, y) >= bottom) return false;
  if (fromX === x || fromY === y) return true;
  const enterX = (left - fromX) / (x - fromX), exitX = (right - fromX) / (x - fromX);
  const enterY = (top - fromY) / (y - fromY), exitY = (bottom - fromY) / (y - fromY);
  return Math.max(0, Math.min(enterX, exitX), Math.min(enterY, exitY)) <
    Math.min(1, Math.max(enterX, exitX), Math.max(enterY, exitY));
}

function terrainClear(biome, fromX, fromY, x, y, padding, body) {
  const crosses = (left, top, right, bottom) => crossesBox(fromX, fromY, x, y, left, top, right, bottom);
  return !biome.obstacles.some(r => {
    if (crosses(r.x - padding, r.y - padding, r.x + r.w + padding, r.y + r.h + padding)) return true;
    // Expand the canopy by the sprite's bounds relative to its ground anchor.
    // Testing the anchor against that box checks the sprite along the entire route.
    return body && r.kind === "tree" && crosses(r.x - body.x - body.w, r.y - body.y - body.h,
      r.x + r.w - body.x, r.y + r.h - body.y);
  });
}

export function isWalkable(biome, x, y, padding = 5, body = null) {
  return terrainClear(biome, x, y, x, y, padding, body);
}

export function clearRoute(biome, fromX, fromY, x, y, body = null) {
  return terrainClear(biome, fromX, fromY, x, y, 5, body);
}

export function nearestGround(biome, x, y, bounds, offset, body = null) {
  const canStand = (px, py) => isWalkable(biome, px + offset, py, 5, body);
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  x = clamp(x, bounds.left, bounds.right); y = clamp(y, bounds.back, bounds.front);
  if (canStand(x, y)) return {x, y};
  let best = null, distance = Infinity;
  for (let py = bounds.back; py <= bounds.front; py += 8) for (let px = bounds.left; px <= bounds.right; px += 8) {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < distance && canStand(px, py)) { best = {x: px, y: py}; distance = d; }
  }
  return best;
}
