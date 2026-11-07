"""Compose road corners from a downloaded terrain pack."""
from PIL import Image
from pathlib import Path
def build_roads(out):
    source={i:Image.open(out/f'{i}.png').resize((16,16),Image.Resampling.NEAREST) for i in [280,281,282,288,289,290,296,297,298]}
    grass=Image.open(out/'1.png').resize((16,16),Image.Resampling.NEAREST)
    for mask in range(256):
     # N,E,S,W,NE,SE,SW,NW. Ignore diagonals unless both adjacent sides join.
     valid=mask&15
     for bit,a,b in [(16,1,2),(32,2,4),(64,4,8),(128,8,1)]:
      if mask&bit and mask&a and mask&b:valid|=bit
     if valid!=mask:continue
     im=Image.new('RGBA',(16,16))
     for qx,qy,h,v,d,outer,edgeh,edgev in [(0,0,8,1,128,280,288,281),(1,0,2,1,16,282,290,281),(0,1,8,4,64,296,288,297),(1,1,2,4,32,298,290,297)]:
      joinedh=bool(mask&h);joinedv=bool(mask&v)
      tile=outer if not joinedh and not joinedv else edgeh if not joinedh else edgev if not joinedv else 289
      box=(qx*8,qy*8,qx*8+8,qy*8+8);quarter=source[tile].crop(box)
      if joinedh and joinedv and not mask&d:
       # Concave sand/grass corner: continue both straight edges into a small rounded inset.
       for dy in range(4):
        for dx in range(4):
         if dx+dy<3:
          px=dx if qx==0 else 7-dx;py=dy if qy==0 else 7-dy
          quarter.putpixel((px,py),grass.getpixel((qx*8+px,qy*8+py)))
      im.paste(quarter,(qx*8,qy*8))
     im.resize((48,48),Image.Resampling.NEAREST).save(out/f'road-{mask}.png')
