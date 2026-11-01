"""Render a terminal capture (`tmux capture-pane -e -p`) to PNG, to look at a live Wake band without a screenshot.

    tmux capture-pane -t SESSION -e -p > pane.ans
    uv run --with pillow python dev/ansi-png.py pane.ans out.png [first-row] [last-row]

Handles 24-bit and 256-colour SGR, bold/dim, and draws the half blocks Wake's scene uses as two coloured pixels per cell.
"""

import re
import sys

from PIL import Image, ImageDraw, ImageFont

CELL_W, CELL_H = 9, 18
DEFAULT_FG, DEFAULT_BG = (205, 214, 244), (30, 30, 46)
SGR = re.compile(r"\x1b\[([0-9;:]*)m|\x1b\][^\x07]*\x07|\x1b[\[\]][^a-zA-Z]*[a-zA-Z]")


def xterm(n):
    base = [(0, 0, 0), (205, 0, 0), (0, 205, 0), (205, 205, 0), (0, 0, 238), (205, 0, 205), (0, 205, 205), (229, 229, 229),
            (127, 127, 127), (255, 0, 0), (0, 255, 0), (255, 255, 0), (92, 92, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255)]
    if n < 16:
        return base[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return steps[n // 36], steps[(n // 6) % 6], steps[n % 6]
    level = 8 + (n - 232) * 10
    return level, level, level


def parse(line):
    fg, bg, cells = DEFAULT_FG, DEFAULT_BG, []
    pos = 0
    for match in SGR.finditer(line):
        for ch in line[pos:match.start()]:
            cells.append((ch, fg, bg))
        pos = match.end()
        if match.group(1) is None:
            continue
        codes = [int(c) if c else 0 for c in re.split("[;:]", match.group(1))] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                fg, bg = DEFAULT_FG, DEFAULT_BG
            elif c in (38, 48) and i + 1 < len(codes):
                if codes[i + 1] == 2 and i + 4 < len(codes):
                    color = tuple(codes[i + 2:i + 5])
                    i += 4
                elif codes[i + 1] == 5 and i + 2 < len(codes):
                    color = xterm(codes[i + 2])
                    i += 2
                else:
                    color = None
                if color is not None:
                    fg, bg = (color, bg) if c == 38 else (fg, color)
            elif c == 39:
                fg = DEFAULT_FG
            elif c == 49:
                bg = DEFAULT_BG
            elif 30 <= c <= 37:
                fg = xterm(c - 30)
            elif 40 <= c <= 47:
                bg = xterm(c - 40)
            elif 90 <= c <= 97:
                fg = xterm(c - 90 + 8)
            i += 1
    for ch in line[pos:]:
        cells.append((ch, fg, bg))
    return cells


def main():
    source, out = sys.argv[1], sys.argv[2]
    lines = open(source, encoding="utf-8", errors="replace").read().split("\n")
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    last = int(sys.argv[4]) if len(sys.argv) > 4 else len(lines)
    rows = [parse(line) for line in lines[first:last]]
    width = max((len(r) for r in rows), default=1)
    image = Image.new("RGB", (width * CELL_W, len(rows) * CELL_H), DEFAULT_BG)
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("DejaVuSansMono.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    for y, row in enumerate(rows):
        for x, (ch, fg, bg) in enumerate(row):
            box = (x * CELL_W, y * CELL_H, (x + 1) * CELL_W - 1, (y + 1) * CELL_H - 1)
            if ch == "▀":
                draw.rectangle((box[0], box[1], box[2], box[1] + CELL_H // 2 - 1), fill=fg)
                draw.rectangle((box[0], box[1] + CELL_H // 2, box[2], box[3]), fill=bg)
            elif ch == "▄":
                draw.rectangle((box[0], box[1], box[2], box[1] + CELL_H // 2 - 1), fill=bg)
                draw.rectangle((box[0], box[1] + CELL_H // 2, box[2], box[3]), fill=fg)
            elif ch == "█":
                draw.rectangle(box, fill=fg)
            else:
                draw.rectangle(box, fill=bg)
                if ch.strip():
                    draw.text((box[0], box[1] + 1), ch, fill=fg, font=font)
    image.save(out)
    print(out)


if __name__ == "__main__":
    main()
