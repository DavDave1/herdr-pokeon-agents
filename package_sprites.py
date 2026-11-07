"""Cache SpriteCollab cycles so spawning never blocks Herdr's render thread."""
import concurrent.futures
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
from PIL import Image
from lifecycle_effects import build_effects

VERSION = 4
CANVAS = 384
DENSITY = CANVAS / 96
SOURCE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master'
# SpriteCollab rows turn from south toward east; screen y increases downward.
DIRECTIONS = ('s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw')


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Herdr-Pokemon-Meadow/1'})
    with urllib.request.urlopen(request, timeout=6) as response:
        data = response.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError('Sprite source exceeds download limit')
    return data


def visible_bounds(path):
    """Use a whole cycle's silhouette so badges don't jitter between frames."""
    boxes = []
    with Image.open(path) as image:
        for frame in range(image.n_frames):
            image.seek(frame)
            box = image.convert('RGBA').getbbox()
            if box:
                boxes.append(box)
        factor = 96 / image.width
    if not boxes:
        return [24, 24, 72, 88]
    return [min(b[0] for b in boxes) * factor, min(b[1] for b in boxes) * factor,
            max(b[2] for b in boxes) * factor, max(b[3] for b in boxes) * factor]


def add_bounds(manifest, folder):
    manifest['bounds'] = {
        action: {direction: visible_bounds(folder / filename) for direction, filename in group.items()}
        for action, group in manifest['animations'].items()
    }


def read_cached(folder):
    try:
        manifest = json.loads((folder / 'manifest.json').read_text())
        if manifest['version'] != VERSION:
            return None
        if all((folder / filename).is_file() for group in manifest['animations'].values() for filename in group.values()):
            if 'bounds' not in manifest:
                add_bounds(manifest, folder)
                temporary = folder / 'manifest.json.tmp'
                temporary.write_text(json.dumps(manifest))
                os.replace(temporary, folder / 'manifest.json')
            if 'lifecycle' not in manifest or not all((folder / name).is_file() for name in ('release.webp', 'recall.webp')):
                with Image.open(folder / manifest['animations']['idle']['s']) as image:
                    manifest['lifecycle'] = build_effects(image, folder)
                temporary = folder / 'manifest.json.tmp'
                temporary.write_text(json.dumps(manifest))
                os.replace(temporary, folder / 'manifest.json')
            return manifest
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def unpack(sheet_data, node):
    sheet = Image.open(io.BytesIO(sheet_data)).convert('RGBA')
    width, height = int(node.findtext('FrameWidth')), int(node.findtext('FrameHeight'))
    durations = [max(10, round(int(item.text) * 1000 / 60)) for item in node.findall('Durations/Duration')]
    if not durations or sheet.width != width * len(durations) or sheet.height not in (height, height * 8):
        raise ValueError('Unexpected animation sheet dimensions')
    rows = []
    for row in range(sheet.height // height):
        rows.append([sheet.crop((col * width, row * height, (col + 1) * width, (row + 1) * height)) for col in range(len(durations))])
    return rows, durations


def package(number, cache):
    folder = cache / str(number)
    cache.mkdir(parents=True, exist_ok=True)
    # Separate processes/windows share the same job and only publish complete packs.
    with (cache / f'.{number}.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cached = read_cached(folder)
        if cached:
            return cached
        base = f'{SOURCE}/sprite/{number:04d}'
        xml_data = download(f'{base}/AnimData.xml')
        nodes = {node.findtext('Name'): node for node in ET.fromstring(xml_data).findall('Anims/Anim')}
        # Pick from actual species animations; avoid sleep, hurt and fainting during work.
        gestures = [name for name in ('Hop', 'Rotate', 'Pose', 'Nod', 'DeepBreath', 'Eat', 'LookUp', 'Stretch', 'Shake', 'Dance', 'Appeal', 'Swing', 'Double', 'Shoot') if name in nodes][:8]
        work = next((name for name in ('Attack', 'QuickStrike', 'Charge', 'Swing') if name in nodes), 'Idle')
        names = {}
        for action in dict.fromkeys(['Walk', 'Idle', 'Sleep', work] + gestures):
            node = nodes.get(action)
            if node is None:
                raise ValueError(f'{action} animation unavailable')
            seen = set()
            while node.findtext('CopyOf'):
                name = node.findtext('CopyOf')
                if name in seen:
                    raise ValueError('Cyclic animation alias')
                seen.add(name)
                node = nodes[name]
            names[action] = node
        filenames = {node.findtext('Name') + '-Anim.png' for node in names.values()} | {'credits.txt'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            downloads = dict(zip(sorted(filenames), pool.map(lambda name: download(f'{base}/{name}'), sorted(filenames))))
        animations = {action.lower(): unpack(downloads[node.findtext('Name') + '-Anim.png'], node) for action, node in names.items()}
        # Sheet frames share a centre origin. Preserve it across poses and directions;
        # cropping each frame independently would introduce jumps and changes of scale.
        boxes = []
        for rows, _ in animations.values():
            for frames in rows:
                for frame in frames:
                    box = frame.getbbox()
                    if box:
                        boxes.append((box[0] - frame.width / 2, box[1] - frame.height / 2, box[2] - frame.width / 2, box[3] - frame.height / 2))
        if not boxes:
            raise ValueError('Empty sprite sheets')
        left, top = min(b[0] for b in boxes), min(b[1] for b in boxes)
        right, bottom = max(b[2] for b in boxes), max(b[3] for b in boxes)
        scale = min(2, 40 / max(abs(left), abs(right), 1), 76 / max(bottom - top, 1))
        anchor_y = 88 - bottom * scale
        temporary = Path(tempfile.mkdtemp(prefix=f'.{number}-', dir=cache))
        try:
            result = {'version': VERSION, 'canvasSize': CANVAS, 'number': number, 'source': base, 'license': 'https://creativecommons.org/licenses/by-nc/4.0/', 'animations': {}, 'durations': {}, 'randomActions': [name.lower() for name in gestures], 'workAction': work.lower(), 'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in downloads.items()}}
            for action, (rows, durations) in animations.items():
                result['animations'][action] = {}
                result['durations'][action] = sum(durations)
                for direction, row in zip(DIRECTIONS, range(8)):
                    frames = []
                    for frame in rows[row if len(rows) == 8 else 0]:
                        canvas = Image.new('RGBA', (CANVAS, CANVAS))
                        # Resize directly from source pixels: avoid a small intermediate bitmap.
                        resized = frame.resize((round(frame.width * scale * DENSITY), round(frame.height * scale * DENSITY)), Image.Resampling.NEAREST)
                        canvas.alpha_composite(resized, (round(CANVAS / 2 - resized.width / 2), round(anchor_y * DENSITY - resized.height / 2)))
                        frames.append(canvas)
                    filename = f'{action}-{direction}.webp'
                    frames[0].save(temporary / filename, save_all=True, append_images=frames[1:], duration=durations, loop=0, lossless=True, method=4)
                    result['animations'][action][direction] = filename
            (temporary / 'credits.txt').write_bytes(downloads['credits.txt'])
            (temporary / 'AnimData.xml').write_bytes(xml_data)
            (temporary / 'ATTRIBUTION.txt').write_text(f'SpriteCollab: {base}\nArtist credits: see credits.txt\nReuse policy: {SOURCE}/README.md\nCommunity artwork: CC BY-NC 4.0\nhttps://creativecommons.org/licenses/by-nc/4.0/\nOriginal game artwork: Chunsoft. Pokémon characters belong to their respective owners.\nConverted to animated WebP with common canvas alignment; artwork not redrawn.\n')
            with Image.open(temporary / result['animations']['idle']['s']) as image:
                result['lifecycle'] = build_effects(image, temporary)
            add_bounds(result, temporary)
            (temporary / 'manifest.json').write_text(json.dumps(result))
            if folder.exists():
                shutil.rmtree(folder)
            os.replace(temporary, folder)
            return result
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)


if __name__ == '__main__':
    try:
        number = int(sys.argv[1])
        if not 1 <= number <= 1025:
            raise ValueError('Invalid species number')
        cache = Path(__file__).resolve().parents[2] / 'data/pokemon-agents/v4'
        print(json.dumps(package(number, cache)))
    except Exception as error:
        print(f'Animation download failed: {error}', file=sys.stderr)
        sys.exit(1)
