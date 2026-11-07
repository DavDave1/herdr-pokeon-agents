"""Download and atomically cache Emerald terrain outside the mod repository."""
import concurrent.futures
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import urllib.request

sys.dont_write_bytecode = True
from PIL import Image
from package_roads import build_roads
from package_biomes import build_biomes, TYPES

VERSION = 9
SOURCE = 'https://raw.githubusercontent.com/pret/pokeemerald/master/data/tilesets/primary/general/'
IDS = [108,197,268,1,4,13,21,28,104,105,106,200,201,202,208,209,210,216,217,218,211,212,213,214,280,281,282,288,289,290,296,297,298]
# Matching broadleaf crown, middle canopy, and trunk/base, in row order.
TREE = [462,463,468,469,486,487]
NAMES = ['tiles.png', 'metatiles.bin'] + [f'palettes/{i:02}.pal' for i in range(7)]


def download(name):
    request = urllib.request.Request(SOURCE + name, headers={'User-Agent': 'Herdr-Pokemon-Habitat/1'})
    with urllib.request.urlopen(request, timeout=8) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('Terrain source exceeds download limit')
    return data


def read_cached(folder):
    try:
        manifest = json.loads((folder / 'manifest.json').read_text())
        if manifest['version'] != VERSION or set(manifest['files']) != set(expected_files()):
            return None
        for name, digest in manifest['files'].items():
            data = (folder / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                return None
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
        return manifest
    except (OSError, ValueError, KeyError, TypeError):
        return None


def road_masks():
    return [m for m in range(256) if all(not m & bit or (m & a and m & b) for bit,a,b in [(16,1,2),(32,2,4),(64,4,8),(128,8,1)])]


def expected_files():
    base = [f'{i}.png' for i in IDS] + ['tree.png'] + [f'road-{m}.png' for m in road_masks()]
    return base + ['rock.png'] + [f'{theme}/{name}' for theme in TYPES for name in base if name != 'tree.png'] + [f'{theme}/rock.png' for theme in TYPES]


def build(downloads, folder):
    with Image.open(io.BytesIO(downloads['tiles.png'])) as source:
        source.load()
        if source.mode != 'P' or source.size != (128,256):
            raise ValueError('Unexpected terrain sheet format')
        palettes = []
        for i in range(7):
            lines = downloads[f'palettes/{i:02}.pal'].decode().splitlines()
            if lines[:3] != ['JASC-PAL', '0100', '16']:
                raise ValueError('Unexpected terrain palette')
            colors = [tuple(map(int, line.split())) for line in lines[3:] if line.strip()]
            if len(colors) != 16 or any(len(c) != 3 or any(v < 0 or v > 255 for v in c) for c in colors):
                raise ValueError('Invalid terrain palette')
            palettes.append(colors)
        definitions = downloads['metatiles.bin']
        if len(definitions) != 8192:
            raise ValueError('Unexpected terrain definitions')
        tiles = {}
        for number in set(IDS + TREE):
            tile = Image.new('RGBA', (16,16))
            for layer in range(2):
                for quadrant in range(4):
                    flags = struct.unpack_from('<H', definitions, number * 16 + layer * 8 + quadrant * 2)[0]
                    index, palette = flags & 1023, flags >> 12
                    if index >= 512 or palette >= len(palettes):
                        raise ValueError('Unsupported terrain reference')
                    x, y = index % 16 * 8, index // 16 * 8
                    pixels = source.crop((x,y,x+8,y+8))
                    part = Image.new('RGBA', (8,8))
                    part.putdata([(*palettes[palette][v], 255 if v else 0) for v in pixels.getdata()])
                    if flags & 1024: part = part.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    if flags & 2048: part = part.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                    tile.alpha_composite(part, (quadrant % 2 * 8, quadrant // 2 * 8))
            tiles[number] = tile
            if number in IDS:
                tile.resize((48,48), Image.Resampling.NEAREST).save(folder / f'{number}.png')
        tree = Image.new('RGBA', (32,48))
        for i, number in enumerate(TREE):
            tree.alpha_composite(tiles[number], (i % 2 * 16, i // 2 * 16))
        grass = set(tiles[1].convert('RGB').getdata()) | set(tiles[28].convert('RGB').getdata())
        tree.putdata([(r,g,b,0 if (r,g,b) in grass else a) for r,g,b,a in tree.getdata()])
        tree.resize((96,144), Image.Resampling.NEAREST).save(folder / 'tree.png')
    build_roads(folder)
    base = [f'{i}.png' for i in IDS] + ['tree.png'] + [f'road-{m}.png' for m in road_masks()]
    build_biomes(folder, base)


def package(cache):
    cache.mkdir(parents=True, exist_ok=True)
    folder = cache / 'emerald-v9'
    with (cache / '.terrain.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cached = read_cached(folder)
        if cached:
            return cached
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            downloads = dict(zip(NAMES, pool.map(download, NAMES)))
        temporary = Path(tempfile.mkdtemp(prefix='.terrain-', dir=cache))
        try:
            build(downloads, temporary)
            attribution = ('Pokémon Emerald terrain. Original artwork: Nintendo / Game Freak / The Pokémon Company.\n'
                           f'Source: {SOURCE}\nNo artwork license is granted by the source archive.\n'
                           'Reconstructed metatiles, transparent tree, nearest-neighbor enlargement and composed road corners.\n')
            (temporary / 'ATTRIBUTION.txt').write_text(attribution)
            manifest = {'version': VERSION, 'source': SOURCE, 'path': 'data/pokemon-agents/terrain/emerald-v9',
                        'sources': {name: hashlib.sha256(data).hexdigest() for name,data in downloads.items()},
                        'files': {name: hashlib.sha256((temporary / name).read_bytes()).hexdigest() for name in expected_files()}}
            (temporary / 'manifest.json').write_text(json.dumps(manifest))
            if folder.exists():
                shutil.rmtree(folder)
            os.replace(temporary, folder)
            return manifest
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)


if __name__ == '__main__':
    try:
        cache = Path(__file__).resolve().parents[2] / 'data/pokemon-agents/terrain'
        print(json.dumps(package(cache)))
    except Exception as error:
        print(f'Terrain download failed: {error}', file=sys.stderr)
        sys.exit(1)
