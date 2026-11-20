import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import lockfile from "proper-lockfile";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export async function readManifest(folder) {
  try {
    return JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return null;
  }
}

export function writeManifest(folder, manifest) {
  return writeFile(join(folder, "manifest.json"), JSON.stringify(manifest));
}

export async function isFile(path, { allowEmpty = false } = {}) {
  try {
    const info = await stat(path);
    return info.isFile() && (allowEmpty || info.size > 0);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function withPackLock(path, work) {
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 15_000,
    retries: { retries: 100, factor: 1, minTimeout: 500 },
  });
  try {
    return await work();
  } finally {
    await release();
  }
}

export async function publishPack(destination, build) {
  const staging = await mkdtemp(join(dirname(destination), ".pack-"));
  const pack = join(staging, "pack");
  const previous = join(staging, "previous");
  let keepPrevious = false;
  try {
    await mkdir(pack);
    const manifest = await build(pack);
    try {
      await rename(destination, previous);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(pack, destination);
    } catch (error) {
      try {
        await rename(previous, destination);
      } catch (restoreError) {
        if (restoreError.code !== "ENOENT") {
          keepPrevious = true;
          throw new Error(`Could not restore artwork cache. Previous pack is at ${previous}`,
            { cause: restoreError });
        }
      }
      throw error;
    }
    return manifest;
  } finally {
    if (!keepPrevious) await rm(staging, { recursive: true, force: true });
  }
}

export async function publishFile(destination, write) {
  const staging = await mkdtemp(join(dirname(destination), ".file-"));
  const file = join(staging, basename(destination));
  try {
    await write(file);
    await rename(file, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function download(url, maxBytes, timeout) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Herdr-Pokemon-Agents/1" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`Artwork download exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function downloadFiles(source, names, maxBytes, timeout) {
  const files = {};
  for (let i = 0; i < names.length; i += 4) {
    const batch = names.slice(i, i + 4);
    const data = await Promise.all(batch.map((name) => download(`${source}/${name}`, maxBytes, timeout)));
    for (const [index, name] of batch.entries()) files[name] = data[index];
  }
  return files;
}

export function hashes(files) {
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, sha256(data)]));
}
