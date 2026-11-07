"""Build pixel-art release/recall cycles from a Pokémon's existing sprite."""
from PIL import Image, ImageDraw


def ball(opened=False):
    art = Image.new('RGBA', (16, 16))
    draw = ImageDraw.Draw(art)
    # Stepped outlines and the sprite palette keep the ball in the PMD pixel-art style.
    outline = '#30303e'
    draw.polygon([(5,2),(10,2),(10,3),(12,3),(12,5),(13,5),(13,10),(12,10),(12,12),(10,12),(10,13),(5,13),(5,12),(3,12),(3,10),(2,10),(2,5),(3,5),(3,3),(5,3)], fill=outline)
    draw.rectangle((5,3,10,6), fill='#e95451')
    draw.rectangle((3,5,12,6), fill='#e95451')
    draw.rectangle((5,4,7,4), fill='#ffaca0')
    draw.rectangle((3,9,12,10), fill='#eee9d5')
    draw.rectangle((5,11,10,12), fill='#c6c7c6')
    draw.rectangle((3,7,12,8), fill=outline)
    draw.rectangle((6,6,9,9), fill=outline)
    draw.rectangle((7,7,8,8), fill='#fff7de')
    if opened:
        draw.rectangle((3,6,12,9), fill='#fff5c6')
        draw.rectangle((5,7,10,8), fill='#ffffff')
    return art


def burst(canvas, radius):
    draw=ImageDraw.Draw(canvas)
    cx,cy=192,328
    radius = min(radius, 40)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        x,y=cx+dx*radius,cy+dy*radius
        draw.rectangle((x-4,y-4,x+4,y+4), fill='#fff5c6')


def build_effects(source, folder):
    folder.mkdir(parents=True,exist_ok=True)
    source=source.convert('RGBA').resize((384,384),Image.Resampling.NEAREST)
    closed=ball().resize((64,64),Image.Resampling.NEAREST)
    opened=ball(True).resize((64,64),Image.Resampling.NEAREST)
    frames=[];durations=[]
    for lift in [0,8,12,4,0]:
        frame=Image.new('RGBA',(384,384));frame.alpha_composite(closed,(160,296-lift))
        frames.append(frame);durations.append(80)
    for radius in [12,28,44]:
        frame=Image.new('RGBA',(384,384));frame.alpha_composite(opened,(160,296));burst(frame,radius)
        frames.append(frame);durations.append(70)
    for ratio in [.16,.3,.48,.68,.86,1]:
        frame=Image.new('RGBA',(384,384))
        width=round(384*ratio)
        sprite=source.resize((width,width),Image.Resampling.NEAREST)
        if ratio<.68:
            # White energy silhouette precedes the original, unmodified colour frames.
            glow=Image.new('RGBA',sprite.size,'#fff5c6');glow.putalpha(sprite.getchannel('A'));sprite=glow
        frame.alpha_composite(sprite,(round(192*(1-ratio)),round(352*(1-ratio))))
        if ratio<.68:frame.alpha_composite(opened,(160,296))
        if ratio<.86:burst(frame,round(50*ratio+20))
        frames.append(frame);durations.append(70)
    frames.append(source);durations.append(170)
    frames[0].save(folder/'release.webp',save_all=True,append_images=frames[1:],duration=durations,loop=1,lossless=True,method=4)
    reverse=list(reversed(frames));reverse_durations=list(reversed(durations))
    reverse.append(Image.new('RGBA',(384,384)));reverse_durations.append(120)
    reverse[0].save(folder/'recall.webp',save_all=True,append_images=reverse[1:],duration=reverse_durations,loop=1,lossless=True,method=4)
    return {'release':sum(durations),'recall':sum(reverse_durations)}
