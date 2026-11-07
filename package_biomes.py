"""Derive biome terrain and transparent rocks from downloaded Emerald artwork."""
from PIL import Image

TYPES = ('desert', 'cave', 'mountain')
FLOORS = {'desert': 289, 'cave': 268, 'mountain': 268}
PATH_COLORS = {
    'desert': [(197,164,98), (180,139,82), (156,115,65), (222,197,131)],
    'cave': [(115,106,123), (98,90,106), (74,65,82), (139,131,148)],
    'mountain': [(180,164,139), (156,139,115), (123,106,90), (205,189,164)],
}
SAND_COLORS = [(222,205,131), (213,180,106), (205,156,82), (238,230,164)]


def build_biomes(folder, names):
    grass = set(Image.open(folder / '1.png').convert('RGB').getdata())
    rock_background = grass | {(115,189,246)}  # Water behind the source boulder.
    rock = Image.open(folder / '197.png').convert('RGBA')
    rock.putdata([(r,g,b,0 if (r,g,b) in rock_background else a) for r,g,b,a in rock.getdata()])
    rock.save(folder / 'rock.png')
    for theme in TYPES:
        out = folder / theme
        out.mkdir()
        floor = Image.open(folder / f'{FLOORS[theme]}.png').convert('RGBA')
        if theme == 'cave':
            # Use the source's dirt texture with a muted subterranean palette.
            floor.putdata([(int(r*.55),int(g*.59),int(b*.69),a) for r,g,b,a in floor.getdata()])
        elif theme == 'mountain':
            floor.putdata([(int(r*.85),int(g*.98),min(255,int(b*1.15)),a) for r,g,b,a in floor.getdata()])
        for name in names:
            if name == 'tree.png':
                continue
            if name in ('1.png', '4.png', '13.png'):
                texture = floor.copy()
                if name != '1.png':
                    # Distinct, repeatable accents on the existing floor artwork:
                    # windblown sand, cave gravel, and mountain scree.
                    strength = {'desert': 14, 'cave': 20, 'mountain': 24}[theme]
                    for y in range(texture.height):
                        for x in range(texture.width):
                            px, py = x // 3, y // 3
                            mark = ((px * 13 + py * 29) % 19 < 4 if name == '4.png'
                                    else (py + px // 5) % 5 == 0 if theme == 'desert'
                                    else (px * 7 + py * 11) % 13 < 5)
                            if mark:
                                r, g, b, a = texture.getpixel((x, y))
                                delta = strength if name == '4.png' else -strength
                                texture.putpixel((x, y), tuple(max(0, min(255, c + delta)) for c in (r, g, b)) + (a,))
                texture.save(out / name)
                continue
            source = Image.open(folder / name).convert('RGBA')
            remap = dict(zip(SAND_COLORS, PATH_COLORS[theme])) if name.startswith('road-') else {}
            pixels = []
            for y in range(source.height):
                for x in range(source.width):
                    r,g,b,a = source.getpixel((x,y))
                    if (r,g,b) in grass:
                        pixels.append(floor.getpixel((x % floor.width,y % floor.height)))
                    elif (r,g,b) in remap:
                        pixels.append((*remap[(r,g,b)],a))
                    elif theme == 'cave':
                        pixels.append((int(r*.65),int(g*.66),int(b*.78),a))
                    else:
                        pixels.append((r,g,b,a))
            source.putdata(pixels)
            source.save(out / name)
        themed_rock = rock.copy()
        if theme == 'desert':
            themed_rock.putdata([(min(255,int(r*1.15)),int(g*.92),int(b*.65),a) for r,g,b,a in rock.getdata()])
        elif theme == 'cave':
            themed_rock.putdata([(int(r*.60),int(g*.60),int(b*.72),a) for r,g,b,a in rock.getdata()])
        themed_rock.save(out / 'rock.png')
