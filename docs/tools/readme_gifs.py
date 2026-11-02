"""Builds the README's animated images from the real Wake renderer and the real status line.

    README_WORK=<scratch dir> uv run --with pillow python docs/tools/readme_gifs.py [dock|landscapes|hero ...]

Every layer is scaled by a whole number (scene cells x6 or x12, text drawn at its native size), so pixels stay
sharp; frames share one palette and gifsicle stores only what changes, so the files stay small.
Needs bun, google-chrome, gifsicle and the Nerd Font described in statusline.py.
"""

import array
import base64
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import statusline  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WAKE = ROOT / "claude/.claude/mods/wake"
IMAGES = ROOT / "docs/images"
WORK = Path(os.environ.get("README_WORK", "/tmp/readme-work"))
FRAMES = 48
DELAY_MS = 120
# the scene's height in pixels is Wake's own constant, so a taller sky reaches the images without an edit here
SCENE_H = int(re.search(r"SCENE_H = (\d+)", (WAKE / "hooks/landscapes/kit.ts").read_text()).group(1))

BASE = statusline.BASE
TEXT, SUBTLE, SURFACE2 = (205, 214, 244), (108, 112, 134), (88, 91, 112)
PEACH, BLUE, MAUVE, TEAL, YELLOW, PINK = (
    (250, 179, 135), (137, 180, 250), (203, 166, 247), (148, 226, 213), (249, 226, 175), (245, 194, 231),
)
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans{}.ttf"


def run(*cmd, cwd=None):
    subprocess.run(cmd, cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def cells(path, width, height=SCENE_H):
    data = array.array("I")
    data.frombytes(Path(path).read_bytes())
    return data, width * height


def scene(data, size, index, scale, height=SCENE_H):
    """Frame `index` of a rendered scene, each cell a scale x scale block."""
    image = Image.new("RGB", (size // height, height))
    image.putdata([((v >> 16) & 255, (v >> 8) & 255, v & 255) for v in data[index * size : (index + 1) * size]])
    return image.resize((image.width * scale, height * scale), Image.NEAREST)


def save_gif(frames, path, delay=DELAY_MS):
    """One shared palette (no dither, so flat colours stay flat), then gifsicle keeps only changed pixels.
    `delay` is milliseconds, one for all frames or one per frame."""
    step = max(1, len(frames) // 6)
    sample = Image.new("RGB", (frames[0].width, frames[0].height * len(frames[::step])))
    for i, frame in enumerate(frames[::step]):
        sample.paste(frame, (0, i * frame.height))
    palette = sample.quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    indexed = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    indexed[0].save(path, save_all=True, append_images=indexed[1:], duration=delay, loop=0, optimize=False)
    run("gifsicle", "-O3", "--no-comments", "-b", str(path))
    print(path.name, f"{path.stat().st_size / 1e6:.2f} MB", frames[0].size)


def label_font(bold, size):
    return ImageFont.truetype(SANS.format("-Bold" if bold else ""), size)


# ── landscapes: eight labelled scenes, edge to edge ───────────────────────────────────────────────

def landscapes():
    titles = [
        "City · working · turns become buildings",
        "Harbor · needs input · Codex boats and agy crew",
        "Beach · working · bridge jobs and Claude subagent birds",
        "Mountains · tests passed · fireworks",
        "Countryside · tests pass after a failure · rainbow",
        "Forest · rain · command failed",
        "Desert · dusk · a finished job leaves a shooting star",
        "Tundra · winter night · sleeping",
    ]
    data, size = cells(WORK / "showcase180.bin", 180)
    font = label_font(False, 17)
    frames = []
    pitch = SCENE_H * 6 + 30
    for i in range(FRAMES):
        sheet = Image.new("RGB", (1080, len(titles) * pitch), BASE)
        draw = ImageDraw.Draw(sheet)
        for s, title in enumerate(titles):
            y = s * pitch
            draw.text((16, y + 5), title, font=font, fill=(166, 173, 200))
            sheet.paste(scene(data, size, s * FRAMES + i, 6), (0, y + 30))
        frames.append(sheet)
    save_gif(frames, IMAGES / "wake-landscapes.gif")


# ── hero: the page chrome from google-chrome, the strips drawn over its black band ───────────────

def hero():
    base = WORK / "hero-base.png"
    run(
        "google-chrome", "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--window-size=1200,{250 + 4 * SCENE_H * 6 + 136}", f"--screenshot={base}",
        f"file://{ROOT / 'docs/hero.html'}",
    )
    page = Image.open(base).convert("RGB")
    data, size = cells(WORK / "showcase200.bin", 200)
    frames = []
    for i in range(FRAMES):
        frame = page.copy()
        for k, s in enumerate((1, 2, 3, 7)):  # harbor, beach, mountains, tundra
            frame.paste(scene(data, size, s * FRAMES + i, 6), (0, 250 + k * SCENE_H * 6))
        frames.append(frame)
    save_gif(frames, IMAGES / "hero.gif")


# ── dock: the scene with call-outs, the crew and quota rows, a prompt and the real status line ────

SKY = (137, 220, 235)
LEGEND = {  # name: (title, what it is, colour); the call-outs sit in the order their things stand, left to right
    "lamps": ("Plan lamps", "lit = steps done", YELLOW),
    "codex": ("Codex worker", "a boat, sized by model", BLUE),
    "claude": ("Claude subagent", "a bird: sparrow to eagle", PEACH),
    "agy": ("agy worker", "sparks, comets, stars", MAUVE),
    "trail": ("A message", "a comet, sender to receiver", SKY),
    "live": ("This turn", "a building going up", TEAL),
    "mochi": ("Mochi", "the session's mood", PINK),
}
GREEN, RED = (166, 227, 161), (243, 139, 168)
FAMILY = {"codex": TEAL, "agy": BLUE, "claude": PINK, "opencode": GREEN}  # a harness's colour, as Wake's rows use it
GROUP = (30, 30, 46)
LANES = [TEAL, MAUVE, YELLOW, BLUE, PINK, GREEN]  # the colours of the peer lanes, in Wake's order
STATE = TEAL  # a running worker's state mark


class Logo(str):
    """Three cells in a row: a harness's round logo over two of them, then a space. Drawn as the real image."""

    backend = ""


def logo(backend):
    mark = Logo("   ")
    mark.backend = backend
    return mark


def blend(color, over, amount):
    return tuple(round(o + (c - o) * amount) for c, o in zip(color, over))


def dim_peer(color, subtle, strength):  # Wake's dimPeer: a colour fading toward the subtle ink as it weakens
    return blend(color, subtle, strength)


def glint(color, light, amount):  # Wake's glint: a colour lifted toward a light one while something passes
    return color if amount <= 0 else dim_peer(light, color, min(1, amount) * 0.8)


def logos(meta, face):
    """The real 32px logos Wake embeds, scaled to the two cells (and one row) they occupy."""
    side = min(2 * face.cw, face.ch)
    out = {}
    for name, png in meta["logos"].items():
        image = Image.open(io.BytesIO(base64.b64decode(png))).convert("RGBA")
        out[name] = image.resize((side, side), Image.LANCZOS)
    return out


def put_segments(frame, draw, face, images, x, y, segments, bold=False):
    """Draw coloured text (and logos) from `x`; a segment may carry a faint tint behind it. Returns the x it ends at."""
    for segment in segments:
        text, color, *rest = segment
        tint = rest[0] if rest else None
        if tint:
            draw.rectangle([x, y, x + len(text) * face.cw - 1, y + face.ch + 2], fill=tint)
        if isinstance(text, Logo):
            mark = images[text.backend]
            frame.paste(mark, (x + (2 * face.cw - mark.width) // 2, y + (face.ch - mark.height) // 2), mark)
            x += len(text) * face.cw
            continue
        for char in text:
            face.put(draw, x, y, char, color, bold)
            x += face.cw
    return x


def quota_segments(chunks):
    """Quota runs per harness: one faint tint behind each run, hard edges at the │ between harnesses,
    remaining allowance green with plenty left, yellow getting low, red nearly gone."""
    out, last = [], None
    for chunk in chunks:
        ink = FAMILY[chunk["cli"]]
        text = chunk["text"][1:]  # the mark is replaced by the harness logo
        head, *tokens = text.split(" ")
        tint = blend(ink, GROUP, 0.13)
        if chunk["cli"] != last:
            if last:
                out.append((" │ ", SURFACE2, None))
            out.append((logo(chunk["cli"]), ink, tint))
        else:
            out.append((" · ", SUBTLE, tint))
        out.append((head, TEXT if head.endswith("*") else SUBTLE, tint))
        for token in tokens:
            part = re.match(r"^([A-Za-z]+)(\d+)%(.*)$", token)
            if part:
                pct = int(part[2])
                out.append((" " + part[1], SUBTLE, tint))
                out.append((f"{pct}%{part[3]}", GREEN if pct >= 50 else YELLOW if pct >= 20 else RED, tint))
            else:
                out.append((" " + token, SUBTLE, tint))
        last = chunk["cli"]
    return out


def crew_row(frame, draw, face, images, y, row, box, text_columns):
    """One crew row laid out as the band lays it out: logo, the harness's own spinner, title, model mark, state, effort dots,
    peer lanes, then the leader and the root graph's cell at the right edge. Returns the x of the parts the notes point at."""
    cw, ink = face.cw, FAMILY[row["backend"]]
    at = {"logo": 6 + cw}
    x = put_segments(frame, draw, face, images, 6, y, [(logo(row["backend"]), ink), (" " + row["spin"] + " ", ink)])
    if row["kind"] == "native":
        x = put_segments(frame, draw, face, images, x, y, [(row["title"], TEXT), (" " + row["mark"], ink), (" ", SUBTLE)])
        at["dots"] = x + cw * row["effort"]["total"] / 2
        put_segments(frame, draw, face, images, x, y, [
            ("●" * row["effort"]["lit"], ink), ("○" * (row["effort"]["total"] - row["effort"]["lit"]), SURFACE2), (row["after"], SUBTLE),
        ])
        x += cw * (row["effort"]["total"] + len(row["after"]))
    else:
        state = glint(STATE, TEXT, row["beat"] * 0.7)
        x = put_segments(frame, draw, face, images, x, y, [(row["title"], TEXT), (" ", TEXT), (row["mark"], ink), (" " + row["glyph"], state)])
        eff = row["effort"]
        x = put_segments(frame, draw, face, images, x, y, [((eff["before"] if eff else "") + " ", SUBTLE)])
        if eff:
            at["dots"] = x + cw * eff["total"] / 2
            x = put_segments(frame, draw, face, images, x, y, [
                ("●" * eff["lit"], ink), ("○" * (eff["total"] - eff["lit"]), SURFACE2), (" " * max(0, eff["size"] - eff["total"]) + eff["after"], SUBTLE),
            ])
        else:
            x = put_segments(frame, draw, face, images, x, y, [(row["detail"], SUBTLE)])
        at["lane"] = x + 1.5 * cw
        for lane in row["gutter"]:
            lit = glint(dim_peer(LANES[lane["color"] % 6], SUBTLE, lane["strength"]), TEXT, lane["flow"])
            x = put_segments(frame, draw, face, images, x, y, [(lane["text"], lit)], bold=lane["flow"] > 0.65)
    cell = row["cell"]
    family = FAMILY.get(cell["family"], YELLOW) if cell["family"] else YELLOW
    start = 6 + (box - 9) * cw
    if cell["branch"] == "─" and cell.get("arriving") is not None:  # beads march only while this row's message arrives
        period, step = 9, (cell["arriving"] // 120) % 9
        beads = ((" " * (period - 2) + "∙•") * (text_columns // period + 2))[(step if cell["dir"] == "in" else period - 1 - step):]
        beads = beads[: max(0, (start - x) // cw)]
        put_segments(frame, draw, face, images, x, y, [(beads, glint(dim_peer(family, SUBTLE, cell["strength"] * 0.7), TEXT, 0.15 + cell["flow"] * 0.5))])
    branch = glint(dim_peer(family, SUBTLE, cell["strength"]), TEXT, cell["flow"])
    spine = glint(dim_peer(YELLOW, SUBTLE, cell["strength"]), TEXT, cell["flow"])
    node = cell["spine"] in "◉◎"
    put_segments(frame, draw, face, images, start, y, [(" ", SUBTLE), (cell["branch"], branch)])
    put_segments(frame, draw, face, images, start + 2 * cw, y, [("◎" if node and cell["flow"] > 0.55 else cell["spine"], spine)], bold=cell["flow"] > 0.65)
    put_segments(frame, draw, face, images, start + 3 * cw, y, [(cell["arrow"], branch), (" root" if node else "", SUBTLE)])
    at["root"] = start + 2.5 * cw
    return at


def dock():
    meta = json.loads((WORK / "dock.json").read_text())
    data, size = cells(WORK / "dock.bin", meta["w"], meta["h"])
    S, face = 12, statusline.Typeface(15)
    width = meta["w"] * S
    images = logos(meta, face)
    quota_line = quota_segments(meta["quota"])
    band, rows_h, gap, note_h = 132, face.ch + 3, 12, 100
    scene_y = band
    text_y = scene_y + meta["h"] * S + gap
    crew_y = text_y + rows_h  # the turn's status line, then the crew
    notes_y = crew_y + len(meta["rows"][0]) * rows_h + 2
    quota_y = notes_y + note_h
    prompt_y = quota_y + rows_h + gap
    status_y = prompt_y + 46 + gap
    height = status_y + 2 * face.ch + 8

    chrome = Image.new("RGB", (width, height), BASE)  # everything that does not move
    draw = ImageDraw.Draw(chrome)
    put_segments(chrome, draw, face, images, 6, text_y, [("◑ ", TEAL), ("Testing · pytest", TEXT)])
    right = [("turn 7 · 1:02", SUBTLE), (" │ ", SURFACE2), ("☼ 24° Demo coast mainly clear", YELLOW), (" │ ", SURFACE2), ("7 turns ", SUBTLE), ("+82", GREEN), ("-19", RED)]
    put_segments(chrome, draw, face, images, width - 6 - sum(len(t) for t, _ in right) * face.cw, text_y, right)
    quota_x = {}  # where each harness's run of accounts begins, for the note that points at it
    x = 6
    for segment in quota_line:
        if isinstance(segment[0], Logo):
            quota_x.setdefault(segment[0].backend, x)
        x = put_segments(chrome, draw, face, images, x, quota_y, [segment])
    draw.rounded_rectangle([4, prompt_y, width - 5, prompt_y + 40], 10, outline=SURFACE2, width=2)
    typed, pitch = "❯ Fix the failing parser test", face.cw * 5 // 4
    for k, char in enumerate(typed):
        face.put(draw, 20 + k * pitch, prompt_y + 10, char, PEACH if k == 0 else TEXT)
    cursor_x = 20 + len(typed) * pitch
    title_font, small = label_font(True, 15), label_font(False, 12)

    def center(boxes):
        return sum((b["x"] + b["w"] / 2) for b in boxes) / len(boxes) * S

    # the scene's call-outs stand in the order their things stand, so no leader crosses another
    where = {name: [center(a[name]) for a in meta["anchors"] if a[name]] for name in LEGEND}  # each thing's x over the whole loop
    order = sorted(LEGEND, key=lambda name: sum(where[name]) / len(where[name]) if where[name] else 0)
    slot = width / len(order)
    held, frames = {}, []
    for i in range(meta["frames"]):
        frame = chrome.copy()
        d = ImageDraw.Draw(frame)
        frame.paste(scene(data, size, i, S, meta["h"]), (0, scene_y))
        for k, name in enumerate(order):
            title, what, color = LEGEND[name]
            found = meta["anchors"][i][name] or held.get(name, [])
            held[name] = found
            cx = int((k + 0.5) * slot)
            lx0, lx1, ly0, ly1 = cx - int(slot / 2) + 6, cx + int(slot / 2) - 6, 12, 58
            if found:
                if name != "trail":  # the comet is wherever it is lit just now: marked with a dot, not boxed
                    for box in found:
                        d.rounded_rectangle([box["x"] * S - 1, scene_y + box["y"] * S - 2, (box["x"] + box["w"]) * S, scene_y + (box["y"] + box["h"]) * S + 1], 5, outline=color, width=2)
                near = min(found, key=lambda b: abs((b["x"] + b["w"] / 2) * S - cx))
                ax, top = (near["x"] + near["w"] / 2) * S, scene_y + near["y"] * S
                d.line([(cx, ly1), (cx, ly1 + 10), (ax, top - 16), (ax, top - 5)], fill=color, width=2)
                if name == "trail":
                    d.ellipse([ax - 5, scene_y + (near["y"] + near["h"] / 2) * S - 5, ax + 5, scene_y + (near["y"] + near["h"] / 2) * S + 5], outline=color, width=2)
            d.rounded_rectangle([lx0, ly0, lx1, ly1], 10, fill=(38, 38, 56), outline=color, width=2)
            d.text((cx, ly0 + 15), title, font=title_font, fill=color, anchor="mm")
            d.text((cx, ly0 + 35), what, font=small, fill=(166, 173, 200), anchor="mm")
        spots = {}
        for r, row in enumerate(meta["rows"][i]):
            spots = crew_row(frame, d, face, images, crew_y + r * rows_h, row, meta["rowBoxes"][i], meta["textColumns"])  # the last row has every part
        # the rows' notes sit in a band of their own below the crew, each on a tick up to the part it names, so none lies on text
        placed = []
        for label, x_target, color in (
            ("Round logo, own spinner", spots["logo"], PINK),
            ("Effort dots from the model's own levels", spots["dots"], BLUE),
            ("Peer lane: who messaged whom", spots["lane"], MAUVE),
            ("Root graph: ↑ to the root, ↓ from it", spots["root"], YELLOW),
        ):
            span = small.getlength(label)
            left = min(max(6, x_target - span / 2), width - span - 6)
            tier = next(t for t in range(3) if t == 2 or all(left > p_right + 12 or left + span < p_left - 12 for p_left, p_right, p_tier in placed if p_tier == t))
            placed.append((left, left + span, tier))
            ty = notes_y + 12 + tier * 20
            d.line([(x_target, notes_y + 2), (x_target, ty - 2)], fill=color, width=2)
            d.text((left, ty), label, font=small, fill=color)
        label, x_target = "Quota per harness: green, yellow, red = what is left", quota_x["agy"] + 3 * face.cw
        span = small.getlength(label)
        left = min(max(6, x_target - span / 2), width - span - 6)
        d.text((left, quota_y - 22), label, font=small, fill=(166, 173, 200))
        d.line([(x_target, quota_y - 6), (x_target, quota_y - 1)], fill=(166, 173, 200), width=2)
        if i % 8 < 5:  # the prompt's cursor blinks
            d.rectangle([cursor_x, prompt_y + 10, cursor_x + 8, prompt_y + 28], fill=TEXT)
        status = statusline.render(statusline.ansi_lines(1_790_000_000.0 + 3.2 * i / FRAMES, i), 15)
        frame.paste(status.crop((0, 0, min(status.width, width), status.height)), (0, status_y))
        frames.append(frame)
    save_gif(frames, IMAGES / "wake-dock.gif")


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    want = sys.argv[1:] or ["dock", "landscapes", "hero"]
    if "landscapes" in want or "hero" in want:
        for w in (180, 200):
            run("bun", "dev/showcase.ts", str(WORK / f"showcase{w}.bin"), str(FRAMES), str(w), cwd=WAKE)
    if "dock" in want:
        run("bun", "dev/dock.ts", str(WORK / "dock.bin"), str(FRAMES), "117", cwd=WAKE)
    for name in want:
        {"dock": dock, "landscapes": landscapes, "hero": hero}[name]()
