"""Scene-scale Codex filmstrip: four beats across, all four classes, pixels doubled."""
import json
import sys
from PIL import Image, ImageDraw

data = json.load(open(sys.argv[1]))
scale, columns = int(sys.argv[3]) if len(sys.argv) > 3 else 2, 4
width, height = data["w"], data["h"]
cell_width, cell_height = width * scale + 12, height * scale + 30
image = Image.new("RGB", (cell_width * columns + 8, ((len(data["rows"]) + columns - 1) // columns) * cell_height + 8), (30, 30, 46))
draw = ImageDraw.Draw(image)
for index, row in enumerate(data["rows"]):
    left = 8 + (index % columns) * cell_width
    top = 8 + (index // columns) * cell_height
    label = row["name"] if scale > 1 else row["name"].split("·", 1)[-1].strip()
    draw.text((left, top), label, fill=(166, 173, 200))
    for pixel, color in enumerate(row["px"]):
        x, y = left + (pixel % width) * scale, top + 20 + (pixel // width) * scale
        draw.rectangle((x, y, x + scale - 1, y + scale - 1), fill=((color >> 16) & 255, (color >> 8) & 255, color & 255))
image.save(sys.argv[2])
