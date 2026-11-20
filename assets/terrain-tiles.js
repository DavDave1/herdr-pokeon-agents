import { Raster } from "./raster.js";

export const BIOME_VARIANTS = ["desert", "cave", "mountain"];
export const MASKS = Array.from({ length: 256 }, (_, mask) => mask).filter((mask) =>
  [[16, 3], [32, 6], [64, 12], [128, 9]].every(([diagonal, sides]) =>
    !(mask & diagonal) || (mask & sides) === sides));

const QUADRANTS = [
  { x: 0, y: 0, horizontal: 8, vertical: 1, diagonal: 128, corner: 0, side: 3, end: 1 },
  { x: 8, y: 0, horizontal: 2, vertical: 1, diagonal: 16, corner: 2, side: 5, end: 1 },
  { x: 0, y: 8, horizontal: 8, vertical: 4, diagonal: 64, corner: 6, side: 3, end: 7 },
  { x: 8, y: 8, horizontal: 2, vertical: 4, diagonal: 32, corner: 8, side: 5, end: 7 },
];
const ROAD_TILES = [280, 281, 282, 288, 289, 290, 296, 297, 298];
const WATER_TILES = [200, 201, 202, 208, 209, 210, 216, 217, 218];
const SAND = ["222,205,131", "213,180,106", "205,156,82", "238,230,164"];
const PATH_COLORS = {
  desert: [[197, 164, 98], [180, 139, 82], [156, 115, 65], [222, 197, 131]],
  cave: [[115, 106, 123], [98, 90, 106], [74, 65, 82], [139, 131, 148]],
  mountain: [[180, 164, 139], [156, 139, 115], [123, 106, 90], [205, 189, 164]],
};

export function mapPixels(image, transform) {
  const output = new Raster(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) output.set(x, y, transform(image.pixel(x, y), x, y));
  }
  return output;
}

function rgb(pixel) {
  return pixel.subarray(0, 3).join(",");
}

export function colors(...images) {
  const result = new Set();
  for (const image of images) {
    for (let offset = 0; offset < image.data.length; offset += 4) {
      result.add(rgb(image.data.subarray(offset, offset + 4)));
    }
  }
  return result;
}

export function removeBackground(image, background) {
  return mapPixels(image, (pixel) => background.has(rgb(pixel))
    ? [pixel[0], pixel[1], pixel[2], 0] : pixel);
}

function connected(tiles, floor, mask, patch = null) {
  const image = new Raster(16, 16);
  for (const { x, y, horizontal, vertical, diagonal, corner, side, end } of QUADRANTS) {
    const joinsHorizontal = Boolean(mask & horizontal), joinsVertical = Boolean(mask & vertical);
    let tile = tiles[4];
    if (!joinsHorizontal) tile = tiles[joinsVertical ? side : corner];
    else if (!joinsVertical) tile = tiles[end];
    for (let dy = 0; dy < 8; dy++) {
      for (let dx = 0; dx < 8; dx++) {
        const px = x + dx, py = y + dy;
        const inwardX = x === 0 ? dx : 7 - dx, inwardY = y === 0 ? dy : 7 - dy;
        const inset = joinsHorizontal && joinsVertical && !(mask & diagonal) && inwardX + inwardY < 3;
        const cutCorner = !joinsHorizontal && !joinsVertical && inwardX + inwardY < 6;
        const inside = (joinsHorizontal || inwardX >= 2) && (joinsVertical || inwardY >= 2);
        const useFloor = inset || (patch && (!inside || cutCorner));
        const source = useFloor ? floor : patch ?? tile;
        image.set(px, py, source.pixel(px, py));
      }
    }
  }
  return image;
}

export function addRoads(tiles) {
  const road = ROAD_TILES.map((id) => tiles.get(String(id)));
  for (const mask of MASKS) tiles.set(`road-${mask}`, connected(road, tiles.get("1"), mask));
}

export function addEdges(tiles) {
  const water = WATER_TILES.map((id) => tiles.get(String(id)));
  const floor = tiles.get("1"), texture = tiles.get("13");
  for (const mask of MASKS) {
    tiles.set(`water-${mask}`, connected(water, floor, mask));
    tiles.set(`grass-${mask}`, connected(water, floor, mask, texture));
  }
}

function multiply([r, g, b, a], [red, green, blue]) {
  return [Math.min(255, r * red), Math.min(255, g * green), Math.min(255, b * blue), a];
}

function floorAccent(floor, biome, bright) {
  const strength = { desert: 14, cave: 20, mountain: 24 }[biome];
  return mapPixels(floor, ([r, g, b, a], x, y) => {
    const mark = bright ? (x * 13 + y * 29) % 19 < 4
      : biome === "desert" ? (y + Math.floor(x / 5)) % 5 === 0 : (x * 7 + y * 11) % 13 < 5;
    const delta = mark ? (bright ? strength : -strength) : 0;
    return [r, g, b].map((channel) => Math.max(0, Math.min(255, channel + delta))).concat(a);
  });
}

export function themedTiles(base, biome) {
  const grass = colors(base.get("1"));
  let floor = base.get(biome === "desert" ? "289" : "268");
  if (biome === "cave") floor = mapPixels(floor, (pixel) => multiply(pixel, [.55, .59, .69]));
  if (biome === "mountain") floor = mapPixels(floor, (pixel) => multiply(pixel, [.85, .98, 1.15]));
  const variants = new Map([
    ["1", floor], ["4", floorAccent(floor, biome, true)], ["13", floorAccent(floor, biome, false)],
  ]);
  const palette = new Map(SAND.map((color, index) => [color, PATH_COLORS[biome][index]]));
  for (const [name, image] of base) {
    if (variants.has(name) || name === "tree" || name === "rock") continue;
    variants.set(name, mapPixels(image, (pixel, x, y) => {
      const color = rgb(pixel);
      if (grass.has(color)) return floor.pixel(x, y);
      if (name.startsWith("road-") && palette.has(color)) return [...palette.get(color), pixel[3]];
      return biome === "cave" ? multiply(pixel, [.65, .66, .78]) : pixel;
    }));
  }
  const rockTint = { desert: [1.15, .92, .65], cave: [.6, .6, .72], mountain: [1, 1, 1] }[biome];
  variants.set("rock", mapPixels(base.get("rock"), (pixel) => multiply(pixel, rockTint)));
  return variants;
}
