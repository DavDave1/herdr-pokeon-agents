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
  const cols = Math.ceil(width / TILE), rows = Math.ceil(height / TILE);
  const ground = [], scenery = [], obstacles = [];
  if (!terrainPath) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
      ground.push({path: PLACEHOLDER_TILE, x: x * TILE, y: y * TILE, w: TILE, h: TILE});
    return {ground, scenery, obstacles};
  }
  if (!BIOME_TYPES.includes(type)) type = "forest";
  const forest = type === "forest";
  const asset = id => `${terrainPath}${forest ? "" : `/${type}`}/${id}.png`;
  const random = seededRandom(seed);
  const roomy = cols >= 14 && rows >= 7;
  const pondSide = random() < .5 ? .22 : .70;
  const pond = roomy ? {
    x: Math.max(2, Math.min(cols - 6, Math.floor(cols * (pondSide + random() * .10)))),
    y: Math.max(2, Math.floor(rows * (.19 + random() * .13))),
    w: Math.min(4 + Math.floor(random() * 3), Math.floor(cols / 6)),
    h: Math.min(3 + Math.floor(random() * 2), Math.max(3, Math.floor(rows * .3))),
  } : null;
  const pathRow = Math.min(rows - 2, Math.max(2, Math.floor(rows * (.56 + random() * .18))));
  const bends = [.20 + random() * .13, .46 + random() * .12, .72 + random() * .12].map(t => Math.floor(cols * t));
  const levels = [0, Math.floor(random() * 3) - 1, Math.floor(random() * 3) - 1, Math.floor(random() * 3) - 1];
  const ledgeEnd = Math.max(3, Math.floor(cols * (.20 + random() * .14)));
  const grassCenter = pondSide < .5 ? .70 : .24;
  const grassX = Math.floor(cols * (grassCenter - .09 + random() * .05));
  const grassWidth = Math.max(2, Math.floor(cols * (.13 + random() * .10)));
  const grassBottom = Math.max(3, pathRow - 1);
  const decorationSeed = Math.floor(random() * 100000);
  const decoration = (x, y) => {
    let hash = Math.imul(x + decorationSeed, 374761393) ^ Math.imul(y + 1, 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  const pathCenter = x => {
    const section = bends.filter(bend => x >= bend).length;
    let center = Math.max(2, Math.min(rows - 2, pathRow + levels[section]));
    if (pond && x >= pond.x - 1 && x <= pond.x + pond.w) center = Math.min(rows - 2, Math.max(center, pond.y + pond.h));
    return center;
  };
  // Fill both columns around a change in height to keep vertical turns two tiles wide.
  const path = (x, y) => {
    if (pond && x >= pond.x && x < pond.x + pond.w && y >= pond.y && y < pond.y + pond.h) return false;
    const centers = [pathCenter(x - 1), pathCenter(x), pathCenter(x + 1)];
    return y >= Math.min(...centers) && y <= Math.max(...centers) + 1;
  };
  const patch = (x, y, r, tiles) => tiles[(y === r.y ? 0 : y === r.y + r.h - 1 ? 2 : 1) * 3 + (x === r.x ? 0 : x === r.x + r.w - 1 ? 2 : 1)];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let id = 1;
    if (path(x, y)) {
      id = `road-${roadMask(path, x, y)}`;
    } else if (roomy && x >= grassX && x < grassX + grassWidth && y >= 2 && y < grassBottom && decoration(Math.floor(x / 3), Math.floor(y / 2)) > .18) {
      id = decoration(x, y) < .15 ? 4 : 13;
    } else if (decoration(x, y) < .018 && y > 1) id = 4;
    if (pond && x >= pond.x && x < pond.x + pond.w && y >= pond.y && y < pond.y + pond.h) {
      id = patch(x, y, pond, [200,201,202,208,209,210,216,217,218]);
    }
    // A low rock ledge beneath the northern treeline.
    if (roomy && y === 1 && x >= 2 && x < ledgeEnd) id = x === 2 ? 211 : x === ledgeEnd - 1 ? 212 : (x % 2 ? 213 : 214);
    ground.push({path: asset(id), x: x * TILE, y: y * TILE, w: TILE, h: TILE});
  }
  if (pond) obstacles.push({x: (pond.x + .22) * TILE, y: (pond.y + .22) * TILE, w: (pond.w - .44) * TILE, h: (pond.h - .44) * TILE});
  if (roomy) obstacles.push({x: TILE * 2, y: TILE * 1.55, w: (ledgeEnd - 2) * TILE, h: TILE * .45});
  const tree = (x, y) => {
    const w = TILE * (forest ? 2 : 1.5), h = TILE * (forest ? 3 : 1.5);
    scenery.push({id: `${type}-prop-${x}-${y}`, path: asset(forest ? "tree" : "rock"), x, y: y - h, w, h, depth: y - 5});
    obstacles.push({x: x + w * .2, y: y - TILE * .65, w: w * .6, h: TILE * .6});
  };
  // Overlapping crowns make a continuous forest, with an open central clearing.
  if (rows >= 5) {
    for (let x = -TILE; x < width; x += TILE * (forest ? 1.35 + random() * .25 : 1.8 + random() * 1.5))
      tree(x, TILE * (forest ? 1.1 + random() * .35 : .8 + random() * .25));
    if (roomy) {
      tree(-TILE * (.4 + random() * .3), height - 4 - random() * 12);
      tree(TILE * (.6 + random() * .5), height + TILE * (.4 + random() * .4));
      tree(width - TILE * (1.1 + random() * .4), height + TILE * random() * .35);
      if (rows >= 11) {
        tree(-TILE * .7, height * (.38 + random() * .18));
        tree(width - TILE * 1.1, height * (.38 + random() * .18));
      }
    }
  }
  if (!forest && roomy) {
    // Scatter rock clusters outside the guaranteed road corridor and lake.
    for (let y = 3; y < rows - 2; y += 3) for (let x = 2; x < cols - 2; x += 4) {
      if (decoration(x + 77, y) > (type === "desert" ? .25 : .55)) continue;
      if ([0,1,2].some(dx => [0,1,2].some(dy => path(x + dx, y + dy)))) continue;
      if (pond && x + 2 >= pond.x && x <= pond.x + pond.w && y + 2 >= pond.y && y <= pond.y + pond.h) continue;
      tree(x * TILE, (y + 1) * TILE);
    }
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
