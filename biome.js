import { getBiomeWorld, overlaps, WORLD_HEIGHT, CHUNK } from "./biome-world.js";

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

export function buildBiome(width, height, terrainPath = null, seed = 0, type = "forest") {
  if (!BIOME_TYPES.includes(type)) type = "forest";
  const forest = type === "forest", offsetY = height - WORLD_HEIGHT;
  const cols = Math.ceil(width / TILE), firstRow = Math.floor(-offsetY / TILE);
  const lastRow = Math.ceil(WORLD_HEIGHT / TILE);
  const ground = [], scenery = [], obstacles = [];
  const asset = id => `${terrainPath}${forest ? "" : `/${type}`}/${id}.png`;
  if (!terrainPath) {
    for (let y = firstRow; y < lastRow; y++) for (let x = 0; x < cols; x++)
      ground.push({path: PLACEHOLDER_TILE, x: x * TILE, y: y * TILE + offsetY, w: TILE, h: TILE});
    return {ground, scenery, obstacles};
  }
  const world = getBiomeWorld(seed, type);
  const addProp = prop => {
    const y = prop.y + offsetY;
    scenery.push({...prop, id: `${type}-prop-${prop.id}`,
      path: asset(prop.kind), y, depth: prop.depth + offsetY});
    obstacles.push(prop.kind === "tree"
      ? {x: prop.x, y, w: prop.w, h: prop.h}
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
        ground.push({path: asset(id), x: tile.x * TILE, y: tile.y * TILE + offsetY, w: TILE, h: TILE});
        if (kind === "water") obstacles.push({x: tile.x * TILE, y: tile.y * TILE + offsetY, w: TILE, h: TILE});
      }
      for (const prop of chunk.props) {
        if (prop.x + prop.w < 0 || prop.x > width || prop.y + prop.h + offsetY < 0 || prop.y + offsetY > height) continue;
        addProp(prop);
      }
    }
  // Let the viewport crop the world naturally; no artificial top contour.
  scenery.sort(compareDepth);
  return {ground, scenery, obstacles};
}

export function compareDepth(a, b) {
  return a.depth - b.depth || (a.x ?? 0) - (b.x ?? 0);
}

export function isWalkable(biome, x, y, padding = 5) {
  return !biome.obstacles.some(r => x > r.x - padding && x < r.x + r.w + padding && y > r.y - padding && y < r.y + r.h + padding);
}

export function clearRoute(biome, fromX, fromY, x, y) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(biome, fromX + (x - fromX) * t, fromY + (y - fromY) * t)) return false;
  }
  return true;
}

export function nearestGround(biome, x, y, bounds, offset, body = null) {
  const trees = body ? biome.scenery.filter(prop => prop.kind === "tree") : [];
  const canStand = (px, py) => {
    if (!isWalkable(biome, px + offset, py)) return false;
    if (!body) return true;
    const sprite = {x: px + body.x, y: py + body.y, w: body.w, h: body.h};
    return !trees.some(tree => overlaps(sprite, tree));
  };
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
