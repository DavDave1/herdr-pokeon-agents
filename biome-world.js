import { createNoise2D } from "./vendor/simplex-noise/simplex-noise.js";

export const WORLD_HEIGHT = 270;
export const CHUNK = 16;
const TILE = 32;
const profiles = {
  forest: {water: .42, vegetation: -.2, rock: .24, texture: .20},
  desert: {water: .64, vegetation: 2, rock: .36, texture: .22},
  cave: {water: .28, vegetation: 2, rock: -.08, texture: -.08},
  mountain: {water: .48, vegetation: 2, rock: -.18, texture: .08},
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function memo(limit, calculate) {
  const cache = new Map();
  return (x, y) => {
    const key = `${x}:${y}`;
    if (cache.has(key)) {
      const value = cache.get(key);
      cache.delete(key); cache.set(key, value);
      return value;
    }
    const value = calculate(x, y);
    cache.set(key, value);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  };
}

export function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

// Pure, seeded world generation. All placement queries work across chunk
// borders; the order in which chunks become visible cannot affect the result.
export function createBiomeWorld(seed, type) {
  const profile = profiles[type] ?? profiles.forest;
  const forest = type === "forest";
  const field = salt => createNoise2D(seededRandom(seed ^ salt));
  const moisture = field(0x819a), vegetation = field(0x527b);
  const geology = field(0x462d), detail = field(0x27af), routes = field(0x94ce);
  const hash = (x, y, salt = 0) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fractal = (noise, x, y, frequency) => noise(x * frequency, y * frequency) * .78 +
    noise(x * frequency * 2, y * frequency * 2) * .22;
  const roadRow = x => 4 + Math.floor(routes(x * .035, 1) * 2.5);
  const road = memo(8192, (x, y) => {
    const centers = [roadRow(x - 1), roadRow(x), roadRow(x + 1)];
    if (y >= Math.min(...centers) && y <= Math.max(...centers) + 1) return true;
    const sector = Math.floor(x / 28);
    for (let s = sector - 1; s <= sector + 1; s++) {
      const cx = s * 28 + 6 + Math.floor(hash(s, 0, 11) * 16), cy = roadRow(cx);
      const radius = 2 + hash(s, 0, 12) * 1.5;
      if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) return true;
      if (hash(s, 0, 13) < .55 && x >= cx && x < cx + 2) {
        const north = hash(s, 0, 14) < .5;
        if (north ? y >= cy - 12 && y <= cy : y >= cy && y <= cy + 10) return true;
      }
    }
    return false;
  });
  const nearRoad = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (road(x + dx, y + dy)) return true;
    return false;
  };
  const wet = memo(8192, (x, y) => !nearRoad(x, y) &&
    fractal(moisture, x, y, forest ? .065 : .085) > profile.water);
  const water = memo(8192, (x, y) => wet(x, y) &&
    [[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dy]) => wet(x + dx, y + dy)).length >= 2);
  const touches = (bounds, contains) => {
    for (let y = Math.floor(bounds.y / TILE); y < Math.ceil((bounds.y + bounds.h) / TILE); y++)
      for (let x = Math.floor(bounds.x / TILE); x < Math.ceil((bounds.x + bounds.w) / TILE); x++)
        if (contains(x, y)) return true;
    return false;
  };
  const blocked = (x, y) => nearRoad(x, y) || water(x, y);
  const groves = memo(256, (cx, cy) => {
    if (!forest) return [];
    // Pick the strongest vegetation site in this region, then grow a dense
    // group around it rather than sprinkling unrelated individual trees.
    let best = [], bestScore = -Infinity;
    for (let i = 0; i < 6; i++) {
      const originX = cx * 12 + 1 + hash(cx, cy, 30 + i) * 7;
      const originY = cy * 10 + 1 + hash(cx, cy, 40 + i) * 7;
      const value = fractal(vegetation, originX, originY, .07);
      if (value < profile.vegetation) continue;
      const group = [];
      for (let gy = 0; gy < 2; gy++) for (let gx = 0; gx < 3; gx++) {
        const x = (originX + gx * 1.25) * TILE, feet = (originY + gy * .95) * TILE;
        const prop = {id: `grove-${cx}-${cy}-${gx}-${gy}`, kind: "tree", x, y: feet - 3 * TILE,
          w: 2 * TILE, h: 3 * TILE, depth: feet - 5};
        if (!touches(prop, blocked)) group.push(prop);
      }
      const score = value + group.length * .12;
      if (group.length >= 3 && score > bestScore) {best = group; bestScore = score;}
    }
    return best;
  });
  const nearbyTrees = bounds => {
    const result = [];
    for (let cy = Math.floor(bounds.y / TILE / 10) - 1; cy <= Math.floor((bounds.y + bounds.h) / TILE / 10) + 1; cy++)
      for (let cx = Math.floor(bounds.x / TILE / 12) - 1; cx <= Math.floor((bounds.x + bounds.w) / TILE / 12) + 1; cx++)
        result.push(...groves(cx, cy));
    return result;
  };
  const grassy = memo(8192, (x, y) => !blocked(x, y) &&
    fractal(vegetation, x + 71, y - 53, forest ? .085 : .115) > profile.texture);
  const grassEligible = memo(8192, (x, y) => {
    if (!grassy(x, y)) return false;
    const bounds = {x: x * TILE, y: y * TILE, w: TILE, h: TILE};
    return !nearbyTrees(bounds).some(p => overlaps(bounds, p, 6));
  });
  const grass = memo(8192, (x, y) => grassEligible(x,y) &&
    [[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dy]) => grassEligible(x + dx, y + dy)).length >= 2);
  const rockCandidates = memo(256, (cx, cy) => {
    const x = cx * 7 + 1 + hash(cx, cy, 60) * 3;
    const y = cy * 6 + 1 + hash(cx, cy, 61) * 2;
    if (fractal(geology, x, y, .085) < profile.rock) return [];
    const result = [];
    const count = 2 + Math.floor(hash(cx, cy, 62) * 3);
    for (let i = 0; i < count; i++) {
      const size = TILE * (.8 + hash(cx, cy, 63 + i) * .5);
      const px = (x + i % 2 * 1.35) * TILE;
      const feet = (y + Math.floor(i / 2) * 1.3) * TILE;
      const prop = {id: `rocks-${cx}-${cy}-${i}`, kind: "rock", x: px, y: feet - size,
        w: size, h: size, depth: feet - 5, priority: hash(cx, cy, 80 + i)};
      if (touches(prop, (x,y) => blocked(x,y) || (forest && grass(x,y)))) continue;
      if (nearbyTrees(prop).some(p => overlaps(prop, p, 8))) continue;
      result.push(prop);
    }
    return result;
  });
  const rocks = memo(256, (cx, cy) => rockCandidates(cx, cy).filter(p => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (rockCandidates(cx + dx, cy + dy).some(q => q.id !== p.id &&
        (q.priority > p.priority || (q.priority === p.priority && q.id > p.id)) && overlaps(p, q, 5))) return false;
    return true;
  }));
  const cell = memo(8192, (x, y) => water(x,y) ? "water" : road(x,y) ? "road" : grass(x,y) ? "grass" : "ground");
  const chunks = new Map();
  let generatedChunks = 0;
  const chunk = (cx, cy) => {
    const key = `${cx}:${cy}`;
    if (chunks.has(key)) {
      const value = chunks.get(key); chunks.delete(key); chunks.set(key, value); return value;
    }
    const ground = [], props = [];
    for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++)
      for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) ground.push({x, y, kind: cell(x,y)});
    const area = {x: cx * CHUNK * TILE, y: cy * CHUNK * TILE, w: CHUNK * TILE, h: CHUNK * TILE};
    for (const p of nearbyTrees(area)) if (Math.floor(p.x / TILE / CHUNK) === cx && Math.floor((p.y + p.h) / TILE / CHUNK) === cy) props.push(p);
    for (let ry = Math.floor(cy * CHUNK / 6) - 1; ry <= Math.floor((cy + 1) * CHUNK / 6) + 1; ry++)
      for (let rx = Math.floor(cx * CHUNK / 7) - 1; rx <= Math.floor((cx + 1) * CHUNK / 7) + 1; rx++)
        for (const p of rocks(rx, ry)) if (Math.floor(p.x / TILE / CHUNK) === cx && Math.floor((p.y + p.h) / TILE / CHUNK) === cy) props.push(p);
    const value = {ground, props}; chunks.set(key, value); generatedChunks++;
    if (chunks.size > 64) chunks.delete(chunks.keys().next().value);
    return value;
  };
  return {cell, road, water, grass, chunk, hash, get stats() {return {chunks: chunks.size, generatedChunks};}};
}

const worlds = new Map();
export function getBiomeWorld(seed, type) {
  const key = `${seed >>> 0}:${type}`;
  if (worlds.has(key)) {
    const world = worlds.get(key); worlds.delete(key); worlds.set(key, world); return world;
  }
  const world = createBiomeWorld(seed, type); worlds.set(key, world);
  if (worlds.size > 4) worlds.delete(worlds.keys().next().value);
  return world;
}
