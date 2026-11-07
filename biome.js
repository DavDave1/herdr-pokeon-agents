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

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildBiome(width, height, terrainPath = null, seed = 0, type = "forest") {
  const viewportWidth = width, viewportHeight = height;
  // World terrain is anchored to the bottom-left. Resizing reveals or clips
  // this same landscape; only the northern boundary follows the top edge.
  width = 1000; height = 270;
  const cols = Math.ceil(width / TILE), rows = Math.ceil(height / TILE);
  const offsetY = viewportHeight - height;
  const visibleCols = Math.ceil(viewportWidth / TILE);
  const firstRow = Math.floor(-offsetY / TILE);
  const lastRow = Math.ceil((viewportHeight - offsetY) / TILE);
  const ground = [], scenery = [], obstacles = [];
  if (!terrainPath) {
    for (let y = firstRow; y < lastRow; y++) for (let x = 0; x < visibleCols; x++)
      ground.push({path: PLACEHOLDER_TILE, x: x * TILE, y: y * TILE + offsetY, w: TILE, h: TILE});
    return {ground, scenery, obstacles};
  }
  if (!BIOME_TYPES.includes(type)) type = "forest";
  const forest = type === "forest";
  const asset = id => `${terrainPath}${forest ? "" : `/${type}`}/${id}.png`;
  const random = seededRandom(seed);
  // Each habitat has its own balance of water, cover, and open space.
  const profile = {
    forest: {water: .75, pools: 3, cover: .60, rocks: .18, texture: .48},
    desert: {water: .40, pools: 2, cover: 0, rocks: .30, texture: .30},
    cave: {water: .65, pools: 4, cover: 0, rocks: .65, texture: .55},
    mountain: {water: .50, pools: 2, cover: 0, rocks: .75, texture: .40},
  }[type];
  const integer = (low, high) => low + Math.floor(random() * (high - low + 1));
  const decorationSeed = integer(0, 1000000);
  const decoration = (x, y) => {
    let hash = Math.imul(x + decorationSeed, 374761393) ^ Math.imul(y + 1, 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  // Meandering tracks, forks, crossroads, and clearings produce different
  // silhouettes, rather than small variations on one horizontal road.
  const route = integer(0, 4);
  const pathRow = integer(2, 6), branchX = integer(5, 26);
  const bends = [integer(4, 9), integer(12, 18), integer(22, 28)];
  const levels = [0, integer(-2, 2), integer(-2, 2), integer(-2, 2)];
  const pathWidth = random() < .35 ? 1 : 2;
  const clearing = {x: integer(6, 25), y: integer(3, 6), r: integer(2, 3)};
  const pathCenter = x => pathRow + levels[bends.filter(bend => x >= bend).length];
  const path = (x, y) => {
    const centers = [pathCenter(x - 1), pathCenter(x), pathCenter(x + 1)];
    const main = y >= Math.min(...centers) && y < Math.max(...centers) + pathWidth;
    const branch = x >= branchX && x < branchX + pathWidth &&
      (route === 2 || (route === 1 && y <= pathCenter(x)) || (route === 3 && y >= pathCenter(x)));
    const plaza = route === 4 && (x - clearing.x) ** 2 + (y - clearing.y) ** 2 <= clearing.r ** 2;
    return main || branch || plaza;
  };
  const ponds = [];
  if (random() < profile.water) {
    const count = integer(1, profile.pools);
    for (let attempt = 0; attempt < 60 && ponds.length < count; attempt++) {
      const pond = {x: integer(1, cols - 6), y: integer(0, 6), w: integer(2, 6), h: integer(2, 3)};
      if (Array.from({length: pond.w + 2}, (_, dx) => dx - 1).some(dx =>
        Array.from({length: pond.h + 2}, (_, dy) => dy - 1).some(dy => path(pond.x + dx, pond.y + dy)))) continue;
      if (ponds.some(p => pond.x < p.x + p.w + 1 && pond.x + pond.w + 1 > p.x && pond.y < p.y + p.h + 1 && pond.y + pond.h + 1 > p.y)) continue;
      ponds.push(pond);
    }
  }
  const inWater = (x, y, margin = 0) => ponds.some(p => x >= p.x - margin && x < p.x + p.w + margin && y >= p.y - margin && y < p.y + p.h + margin);
  const ledges = Array.from({length: integer(0, 3)}, (_, i) => {
    const x = i * 11 + integer(1, 5);
    return {x, w: integer(2, 7)};
  });
  // One grove and one meadow per large world cell. Their shapes and
  // membership depend only on world coordinates, never on the viewport.
  const forestZone = (cx, cy, meadow = false) => {
    const salt = meadow ? 307 : 173;
    return {
      x: cx * 14 + 2 + Math.floor(decoration(cx + salt, cy) * 6),
      y: cy * 10 + 1 + Math.floor(decoration(cx, cy + salt) * 5),
      rx: meadow ? 2 + Math.floor(decoration(cx + salt, cy + 8) * 2) : 2,
      ry: meadow ? 1.5 : 1.2,
    };
  };
  const inMeadow = (x, y) => {
    // Whole 2×2 blocks keep each patch cohesive, including its edge tiles.
    const px = Math.floor(x / 2) * 2 + 1, py = Math.floor(y / 2) * 2 + 1;
    const cx = Math.floor(px / 14), cy = Math.floor(py / 10);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const zone = forestZone(cx + dx, cy + dy, true);
      if (((px - zone.x) / zone.rx) ** 2 + ((py - zone.y) / zone.ry) ** 2 <= 1) return true;
    }
    return false;
  };
  const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  const groveTrees = [];
  if (forest) {
    for (let cy = Math.floor(firstRow / 10) - 1; cy <= Math.floor(lastRow / 10) + 1; cy++)
      for (let cx = -1; cx <= Math.floor(visibleCols / 14) + 1; cx++) {
        const zone = forestZone(cx, cy);
        const group = [];
        for (let gy = 0; gy < 2; gy++) for (let gx = 0; gx < 3; gx++) {
          const x = zone.x + gx * 1.35, y = zone.y + gy * 1.1;
          if ([-1,0,1].some(dx => [-1,0,1].some(dy => path(Math.floor(x) + dx, Math.floor(y) + dy) || inWater(Math.floor(x) + dx, Math.floor(y) + dy)))) continue;
          group.push({x: x * TILE, y: (y + .8) * TILE, w: TILE * 2, h: TILE * 3});
        }
        // Reject fragments that would leave a solitary tree beside a road.
        if (group.length >= 3) groveTrees.push(...group);
      }
  }
  const meadowTile = (x, y) => {
    if (!inMeadow(x, y)) return false;
    // Reserve complete grass blocks around the painted canopy. Checking only
    // trunks leaves grass visible beneath the sides and back of a grove.
    const block = {x: Math.floor(x / 2) * 2 * TILE, y: Math.floor(y / 2) * 2 * TILE, w: TILE * 2, h: TILE * 2};
    return !groveTrees.some(p => overlaps(block, {...p, y: p.y - p.h}, TILE * .15));
  };
  const patch = (x, y, r, tiles) => tiles[(y === r.y ? 0 : y === r.y + r.h - 1 ? 2 : 1) * 3 + (x === r.x ? 0 : x === r.x + r.w - 1 ? 2 : 1)];
  for (let y = firstRow; y < lastRow; y++) for (let x = 0; x < visibleCols; x++) {
    let id = 1;
    if (path(x, y)) {
      id = `road-${roadMask(path, x, y)}`;
    } else {
      if (forest) {
        if (meadowTile(x, y)) id = 13;
      } else {
        const patchNoise = decoration(Math.floor(x / 4), Math.floor(y / 3));
        if (patchNoise < profile.texture) id = decoration(x, y) < .3 ? 4 : 13;
        else if (decoration(x, y) < .045) id = 4;
      }
    }
    const pond = ponds.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
    if (pond) id = patch(x, y, pond, [200,201,202,208,209,210,216,217,218]);
    ground.push({path: asset(id), x: x * TILE, y: y * TILE + offsetY, w: TILE, h: TILE});
  }
  for (const pond of ponds) obstacles.push({x: pond.x * TILE, y: pond.y * TILE + offsetY, w: pond.w * TILE, h: pond.h * TILE});
  // Boundary tiles use panel coordinates, independently of the world grid.
  for (const ledge of ledges) {
    obstacles.push({x: ledge.x * TILE, y: TILE * 1.55, w: ledge.w * TILE, h: TILE * .45});
    for (let x = ledge.x; x < ledge.x + ledge.w; x++) {
      const id = x === ledge.x ? 211 : x === ledge.x + ledge.w - 1 ? 212 : (x % 2 ? 213 : 214);
      ground.push({path: asset(id), x: x * TILE, y: TILE, w: TILE, h: TILE});
    }
  }
  const tree = (x, y, boundary = false, rock = !forest, scale = 1) => {
    const id = `${type}-${boundary ? "boundary" : "prop"}-${rock ? "rock" : "tree"}-${x}-${y}`;
    if (!boundary) y += offsetY;
    const w = TILE * (rock ? 1.5 : 2) * scale, h = TILE * (rock ? 1.5 : 3) * scale;
    // The moving northern contour occludes rocks as it passes over them.
    // Keep the world position intact and clip only the visible image.
    const clipTop = forest && rock ? Math.min(h, Math.max(0, TILE * 1.5 - (y - h))) : 0;
    scenery.push({id, path: asset(rock ? "rock" : "tree"), x, y: y - h, w, h, depth: y - 5, clipTop});
    obstacles.push({x: x + w * .2, y: y - TILE * .65, w: w * .6, h: TILE * .6});
  };
  // Overlapping crowns make a continuous forest, with an open central clearing.
  if (rows >= 5) {
    // A separate stream keeps extending the boundary from changing world props.
    const boundaryRandom = seededRandom(seed ^ 0x51ed270b);
    for (let x = -TILE; x < viewportWidth; x += TILE * (forest ? 1.35 + boundaryRandom() * .25 : 1.8 + boundaryRandom() * 1.5))
      tree(x, TILE * (forest ? 1.1 + boundaryRandom() * .35 : .8 + boundaryRandom() * .25), true);
  }
  for (const prop of groveTrees) tree(prop.x, prop.y);
  // Coordinate-based clusters extend into newly revealed ground without
  // consuming a viewport-dependent random stream. Keep road corridors clear.
  for (let y = firstRow - 1; y < lastRow + 3; y += 1) for (let x = 0; x < visibleCols + 2; x += 1) {
    const cluster = decoration(Math.floor(x / 4) + 91, Math.floor(y / 3) - 37);
    const chance = profile.rocks;
    if (cluster > chance || decoration(x + 123, y - 49) > .22) continue;
    if ([-1,0,1].some(dx => [-1,0,1].some(dy => path(x + dx, y + dy) || inWater(x + dx, y + dy)))) continue;
    const scale = .65 + decoration(x + 54, y + 31) * .5;
    if (forest) {
      const size = TILE * 1.5 * scale;
      const bounds = {x: x * TILE, y: (y + .8) * TILE - size, w: size, h: size};
      // Reserve the entire painted canopy, not only the tree's trunk.
      if (groveTrees.some(p => overlaps(bounds, {...p, y: p.y - p.h}, TILE * .25))) continue;
      let meadow = false;
      for (let ty = Math.floor(bounds.y / TILE); ty < Math.ceil((bounds.y + bounds.h) / TILE); ty++)
        for (let tx = x; tx < Math.ceil((bounds.x + bounds.w) / TILE); tx++)
          if (inMeadow(tx, ty)) meadow = true;
      if (meadow) continue;
    }
    tree(x * TILE, (y + .8) * TILE, false, true, scale);
  }
  // Publish scenery in painter order too; placement order is not depth order.
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

export function nearestGround(biome, x, y, bounds, offset) {
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  x = clamp(x, bounds.left, bounds.right); y = clamp(y, bounds.back, bounds.front);
  if (isWalkable(biome, x + offset, y)) return {x, y};
  let best = null, distance = Infinity;
  for (let py = bounds.back; py <= bounds.front; py += 8) for (let px = bounds.left; px <= bounds.right; px += 8) {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < distance && isWalkable(biome, px + offset, py)) { best = {x: px, y: py}; distance = d; }
  }
  return best ?? {x, y};
}
