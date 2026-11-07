"""Compose one-shot evolution from cached PMD sprites; never alter source packs."""
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from PIL import Image, ImageDraw


def build(old, new, output):
    """Keep the original pixel silhouettes and common ground origin throughout the flash."""
    def idle(folder):
        manifest = json.loads((folder / 'manifest.json').read_text())
        with Image.open(folder / manifest['animations']['idle']['s']) as image:
            return image.convert('RGBA')
    before, after = idle(old), idle(new)
    frames = []
    for index in range(36):
        source = before if index < 18 else after
        if index < 6:
            intensity = index / 5
        elif index < 26:
            intensity = .75 + .25 * math.sin((index - 6) * math.pi / 3) ** 2
        else:
            intensity = max(0, 1 - (index - 26) / 7)
        white = Image.new('RGBA', source.size, '#fff5dc')
        white.putalpha(source.getchannel('A'))
        frame = Image.blend(source, white, intensity)
        if 5 <= index < 33:
            draw = ImageDraw.Draw(frame)
            box = source.getbbox() or (100, 100, 280, 340)
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            radius = min(110, max(box[2]-box[0], box[3]-box[1]) / 2 + 16)
            for star in range(8):
                angle = star * math.pi / 4 + index * .06
                x = max(8, min(372, round((cx + math.cos(angle) * radius) / 4) * 4))
                y = max(8, min(372, round((cy + math.sin(angle) * radius) / 4) * 4))
                draw.rectangle((x-4,y-4,x+3,y+3), fill='#fff1a8')
                if (index + star) % 3 == 0:
                    draw.rectangle((x-8,y-1,x+7,y+2), fill='#fff8e5')
                    draw.rectangle((x-1,y-8,x+2,y+7), fill='#fff8e5')
        frames.append(frame)
    frames.append(after)
    durations = [60] * 36 + [240]
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(suffix='.webp', dir=output.parent)
    os.close(handle)
    try:
        frames[0].save(temporary, format='WEBP', save_all=True, append_images=frames[1:],
                       duration=durations, loop=1, lossless=True, method=4)
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return sum(durations)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2] / 'data/pokemon-agents'
    old, new = map(int, sys.argv[1:3])
    duration = build(root / f'v4/{old}', root / f'v4/{new}', root / f'evolution/{old}-{new}.webp')
    print(json.dumps({'duration': duration, 'path': f'data/pokemon-agents/evolution/{old}-{new}.webp'}))
