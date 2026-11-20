import sharp from "sharp";

export class Raster {
  constructor(width, height, data = Buffer.alloc(width * height * 4)) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  copy() {
    return new Raster(this.width, this.height, Buffer.from(this.data));
  }

  offset(x, y) {
    return (y * this.width + x) * 4;
  }

  pixel(x, y) {
    const offset = this.offset(x, y);
    return this.data.subarray(offset, offset + 4);
  }

  set(x, y, rgba) {
    this.data.set(rgba, this.offset(x, y));
  }

  crop(left, top, width, height) {
    const result = new Raster(width, height);
    for (let y = 0; y < height; y++) {
      const start = this.offset(left, top + y);
      this.data.copy(result.data, y * width * 4, start, start + width * 4);
    }
    return result;
  }

  resize(width, height) {
    const result = new Raster(width, height);
    const columns = Array.from({ length: width }, (_, x) => Math.floor((x + .5) * this.width / width));
    for (let y = 0; y < height; y++) {
      const row = Math.floor((y + .5) * this.height / height);
      for (let x = 0; x < width; x++) result.set(x, y, this.pixel(columns[x], row));
    }
    return result;
  }

  fill(left, top, width, height, color) {
    for (let y = Math.max(0, top); y < Math.min(this.height, top + height); y++) {
      for (let x = Math.max(0, left); x < Math.min(this.width, left + width); x++) this.set(x, y, color);
    }
  }

  composite(source, left, top) {
    for (let y = Math.max(0, top); y < Math.min(this.height, top + source.height); y++) {
      for (let x = Math.max(0, left); x < Math.min(this.width, left + source.width); x++) {
        const pixel = source.pixel(x - left, y - top);
        if (!pixel[3]) continue;
        const destination = this.pixel(x, y);
        if (pixel[3] === 255 || !destination[3]) {
          destination.set(pixel);
          continue;
        }
        const remain = destination[3] * (1 - pixel[3] / 255);
        const alpha = pixel[3] + remain;
        for (let i = 0; i < 3; i++) {
          destination[i] = Math.round((pixel[i] * pixel[3] + destination[i] * remain) / alpha);
        }
        destination[3] = Math.round(alpha);
      }
    }
  }

  bounds() {
    let left = this.width, top = this.height, right = 0, bottom = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.data[this.offset(x, y) + 3]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = y + 1;
      }
    }
    return right ? [left, top, right, bottom] : null;
  }
}

export function unionBounds(first, second) {
  if (!first || !second) return first ?? second;
  return [Math.min(first[0], second[0]), Math.min(first[1], second[1]),
    Math.max(first[2], second[2]), Math.max(first[3], second[3])];
}

export async function readRaster(input) {
  const { data, info } = await sharp(input, { limitInputPixels: 4_194_304 })
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Raster(info.width, info.height, data);
}

export function readImageMetadata(input) {
  return sharp(input, { limitInputPixels: 4_194_304 }).metadata();
}

export async function animationBounds(input) {
  const { data, info } = await sharp(input, { animated: true, limitInputPixels: 32_000_000 })
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const height = info.pageHeight ?? info.height;
  const frameSize = info.width * height * 4;
  let bounds = null;
  for (let offset = 0; offset < data.length; offset += frameSize) {
    const frame = new Raster(info.width, height, data.subarray(offset, offset + frameSize));
    bounds = unionBounds(bounds, frame.bounds());
  }
  return bounds?.map((coordinate) => coordinate * 96 / info.width) ?? [24, 24, 72, 88];
}

export function writePng(image, path) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png().toFile(path);
}

export function writeAnimation(frames, delays, loop, path) {
  const { width, height } = frames[0];
  const raw = { width, height: height * frames.length, channels: 4, pageHeight: height };
  return sharp(Buffer.concat(frames.map((frame) => frame.data)), { raw })
    .webp({ lossless: true, effort: 4, delay: delays, loop })
    .toFile(path);
}
