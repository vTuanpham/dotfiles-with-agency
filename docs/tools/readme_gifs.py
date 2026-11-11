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
FRAMES = 144
TIMELAPSE_FRAMES = 480
DELAY_MS = 50
# the scene's height in pixels is Wake's own constant, so a taller sky reaches the images without an edit here
SCENE_H = int(re.search(r"SCENE_H = (\d+)", (WAKE / "hooks/landscapes/kit.ts").read_text()).group(1))

BASE = statusline.BASE
TERMINAL_PX = 16  # the terminal's default 12 pt at 96 dpi: SauceCode Pro Nerd Font cells of 10 x 21 px
TEXT, SUBTLE, SURFACE2 = (205, 214, 244), (108, 112, 134), (88, 91, 112)
PEACH, BLUE, MAUVE, TEAL, YELLOW, PINK = (
    (250, 179, 135), (137, 180, 250), (203, 166, 247), (148, 226, 213), (249, 226, 175), (245, 194, 231),
)
GREEN, RED = (166, 227, 161), (243, 139, 168)
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans{}.ttf"


def run(*cmd, cwd=None):
    browser = cmd[0] == "google-chrome"
    if browser:
        cmd = (*cmd, f"--user-data-dir={WORK / 'chrome-profile'}")
    subprocess.run(cmd, cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   timeout=60 if browser else None)


def cells(path, width, height=SCENE_H):
    data = array.array("I")
    data.frombytes(Path(path).read_bytes())
    return data, width * height


def scene(data, size, index, scale, height=SCENE_H, scale_y=None):
    """Frame `index` of a rendered scene, each cell a scale x scale_y block (square unless a terminal's half blocks say otherwise)."""
    image = Image.new("RGB", (size // height, height))
    image.putdata([((v >> 16) & 255, (v >> 8) & 255, v & 255) for v in data[index * size : (index + 1) * size]])
    return image.resize((image.width * scale, height * (scale_y or scale)), Image.NEAREST)


def save_gif(frames, path, delay=DELAY_MS, count=None):
    """One shared palette (no dither, so flat colours stay flat), then gifsicle keeps only changed pixels.
    `delay` is milliseconds, one for all frames or one per frame."""
    count, frame_at = (len(frames), frames.__getitem__) if count is None else (count, frames)
    first = frame_at(0)
    samples = range(0, count, max(1, count // 6))
    sample = Image.new("RGB", (first.width, first.height * len(samples)))
    for row, index in enumerate(samples):
        sample.paste(frame_at(index), (0, row * first.height))
    palette = sample.quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    indexed = [frame_at(i).quantize(palette=palette, dither=Image.Dither.NONE) for i in range(count)]
    indexed[0].save(path, save_all=True, append_images=indexed[1:], duration=delay, loop=0, optimize=False)
    run("gifsicle", "-O3", "--no-comments", "-b", str(path))
    print(path.name, f"{path.stat().st_size / 1e6:.2f} MB", first.size)


def loop_scene(image, index):
    """Dip between recordings after the crews leave; never overlay two moving scenes."""
    t = min(1, index / 8, (TIMELAPSE_FRAMES - 1 - index) / 8)
    return image if t >= 1 else Image.blend(Image.new("RGB", image.size, BASE), image, t * t * (3 - 2 * t))


def dissolve(last, first):
    """An editorial transition between recordings whose simulation clocks restart."""
    return [Image.blend(last, first, i / 7) for i in range(1, 7)]


def label_font(bold, size):
    return ImageFont.truetype(SANS.format("-Bold" if bold else ""), size)


# ── landscapes: eight labelled scenes, edge to edge ───────────────────────────────────────────────

def landscapes():
    titles = [
        "City · working · turns become buildings",
        "Harbor · needs input · Codex boats and agy crew",
        "Beach · working · machines, flamingos and constellations",
        "Mountains · tests passed · fireworks",
        "Countryside · tests pass after a failure · rainbow",
        "Forest · rain · command failed",
        "Desert · dusk · a finished job leaves a shooting star",
        "Tundra · winter night · sleeping",
    ]
    data, size = cells(WORK / "showcase180.bin", 180)
    font = label_font(False, 17)
    pitch = SCENE_H * 6 + 30
    def frame_at(i):
        i = (i + 80) % TIMELAPSE_FRAMES  # open on the settled scene, not the loop transition
        sheet = Image.new("RGB", (1080, len(titles) * pitch), BASE)
        draw = ImageDraw.Draw(sheet)
        for s, title in enumerate(titles):
            y = s * pitch
            draw.text((16, y + 5), title, font=font, fill=(166, 173, 200))
            sheet.paste(loop_scene(scene(data, size, s * TIMELAPSE_FRAMES + i, 6), i), (0, y + 30))
        return sheet
    save_gif(frame_at, IMAGES / "wake-landscapes.gif", count=TIMELAPSE_FRAMES)


# ── hero: the page chrome from google-chrome, the strips drawn over its black band ───────────────

# One large terminal window with Wake above the real status line. It visits four places, each for the stretch of its loop where
# the crew talk (worker to worker, worker to Mochi, Mochi back) and the place's event plays; tabs in the title bar and a caption
# say which. The page around it (title, window chrome, the six tools) is Chrome's rendering of docs/hero.html.
HERO_W, HERO_SCALE = 120, 9  # scene cells across and pixels per cell: 1080 px, the window's inner width
HERO_STOPS = (  # (showcase scene, loop frame it starts at, tab, caption); messages fly from frame 138, events start at 216
    (0, 130, "City", "A Codex dragon's bolt turns into a Claude bat's sonar on its way; the bat reports to Mochi"),
    (2, 130, "Beach", "A flamingo and a kite trade messages, and Mochi answers"),
    (5, 196, "Forest", "Rain sets in, a command fails and a storm rolls over the crew"),
    (3, 200, "Mountains", "Tests pass: fireworks, while a constellation and a lantern report to Mochi"),
)
HERO_LEG, HERO_FADE = 120, 8  # frames per stop, frames of each cross-fade


def hero():
    base = WORK / "hero-base.png"
    source = WORK / "hero.html"
    screen_h = SCENE_H * HERO_SCALE
    source.write_text((ROOT / "docs/hero.html").read_text().replace("--screen: 180px", f"--screen: {screen_h}px"))
    page_h = 236 + 38 + screen_h + 64 + 2 + 64 + 196
    run(
        "google-chrome", "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--window-size=1200,{page_h}", f"--screenshot={base}", f"file://{source}",
    )
    page = Image.open(base).convert("RGB")
    # the screen is the page's one pure-black block: find it rather than trust the layout's arithmetic
    black = [(x, y) for y in range(200, page.height) for x in (600,) if page.getpixel((x, y)) == (0, 0, 0)]
    top = black[0][1]
    left = next(x for x in range(page.width) if page.getpixel((x, top)) == (0, 0, 0))
    lines = statusline.ansi_lines(1_790_000_000.0, 0)
    status = next(s for s in (statusline.render(lines, size) for size in range(16, 9, -1)) if s.width <= 1080 - 28)  # the largest that fits
    status_at = (left + 14, top + screen_h + (64 - status.height) // 2)
    data, size = cells(WORK / f"showcase{HERO_W}.bin", HERO_W)
    tab_font, cap_font = label_font(True, 13), label_font(False, 16)

    def shot(stop, k):
        return scene(data, size, HERO_STOPS[stop][0] * TIMELAPSE_FRAMES + HERO_STOPS[stop][1] + k, HERO_SCALE)

    def frame_at(i):
        stop, k = divmod(i, HERO_LEG)
        image = shot(stop, k)
        if k < HERO_FADE:  # cross-fade from where the last stop ended
            image = Image.blend(shot((stop - 1) % len(HERO_STOPS), HERO_LEG - 1), image, (k + 1) / (HERO_FADE + 1))
        frame = page.copy()
        frame.paste(image, (left, top))
        frame.paste(status, status_at)
        d = ImageDraw.Draw(frame)
        x = left + 1080 - 12  # the tabs, right-aligned in the title bar, the current place lit
        for n in reversed(range(len(HERO_STOPS))):
            label = HERO_STOPS[n][2]
            w = int(tab_font.getlength(label)) + 20
            x -= w
            if n == stop:
                d.rounded_rectangle([x, top - 30, x + w, top - 9], 8, fill=(69, 71, 90))
            d.text((x + w / 2, top - 19), label, font=tab_font, fill=(205, 214, 244) if n == stop else (127, 132, 156), anchor="mm")
            x -= 6
        d.text((left + 2, top + screen_h + 64 + 22), HERO_STOPS[stop][3], font=cap_font, fill=(166, 173, 200))
        return frame

    save_gif(frame_at, IMAGES / "hero.gif", count=HERO_LEG * len(HERO_STOPS))


# ── dock: the scene with call-outs, the crew and quota rows, a prompt and the real status line ────

LEGEND = {  # name: (title, what it is, colour); the call-outs sit in the order their things stand, left to right
    "lamps": ("Plan lamps", "lit = steps done", YELLOW),
    "codex": ("Codex worker", "a boat, sized by model", BLUE),
    "claude": ("Claude subagent", "a crab along the quay", PEACH),
    "agy": ("AGY worker", "a drifting constellation", MAUVE),
    "live": ("This turn", "a building going up", TEAL),
    "message": ("Message", "a rocket that lands as agy stars", GREEN),
    "mochi": ("Mochi", "the session's mood", PINK),
}
FAMILY = {"codex": TEAL, "agy": BLUE, "claude": PINK, "opencode": GREEN}  # a harness's colour, as Wake's rows use it
GROUP = BASE  # what a faint tint is blended over
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
            part = next((p for p in chunk["parts"] if p["pct"] is not None
                         and token.startswith(f'{p["label"]}{p["pct"]}%')), None)
            if part:
                pct, label = part["pct"], part["label"]
                out.append((" " + label, SUBTLE, tint))
                out.append((token[len(label):], GREEN if pct >= 50 else YELLOW if pct >= 20 else RED, tint))
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
    face = statusline.Typeface(TERMINAL_PX)
    S, SY = face.cw, face.ch // 2  # one scene pixel per terminal column, two per row (a half block): 9 x 10 px here
    width = meta["w"] * S
    images = logos(meta, face)
    quota_lines = [quota_segments(line) for line in meta["quota"]]  # one run of segments per quota row, each opening with its logo
    band, rows_h, gap, note_h = 132, face.ch, 12, 100  # rows stand one cell high, as in the terminal
    scene_y = band
    text_y = scene_y + meta["h"] * SY  # the turn's line sits right under the scene
    crew_y = text_y + rows_h  # the turn's status line, then the crew
    notes_y = crew_y + len(meta["rows"][0]) * rows_h + 2
    quota_y = notes_y + note_h
    prompt_y = quota_y + len(quota_lines) * rows_h  # the prompt is three rows: border, text, border
    status_y = prompt_y + 3 * face.ch
    height = status_y + 2 * face.ch + 8

    chrome = Image.new("RGB", (width, height), BASE)  # everything that does not move
    draw = ImageDraw.Draw(chrome)
    put_segments(chrome, draw, face, images, 6, text_y, [("◑ ", TEAL), ("Testing · pytest", TEXT)])
    right = [("turn 7 · 1:02", SUBTLE), (" │ ", SURFACE2), ("☼ 24° Demo coast mainly clear", YELLOW), (" │ ", SURFACE2), ("7 turns ", SUBTLE), ("+82", GREEN), ("-19", RED)]
    put_segments(chrome, draw, face, images, width - 6 - sum(len(t) for t, _ in right) * face.cw, text_y, right)
    quota_x = {}  # where each harness's run of accounts begins on the first row, for the note that points at it
    for r, line in enumerate(quota_lines):
        x = 6
        for segment in line:
            if isinstance(segment[0], Logo) and r == 0:
                quota_x.setdefault(segment[0].backend, x)
            x = put_segments(chrome, draw, face, images, x, quota_y + r * rows_h, [segment])
    draw.rounded_rectangle([face.cw // 2, prompt_y + face.ch // 2, width - 1 - face.cw // 2, prompt_y + 5 * face.ch // 2], 8, outline=SURFACE2, width=1)
    typed, pitch = "❯ Fix the failing parser test", face.cw
    for k, char in enumerate(typed):
        face.put(draw, 2 * face.cw + k * pitch, prompt_y + face.ch, char, PEACH if k == 0 else TEXT)
    cursor_x = 2 * face.cw + len(typed) * pitch
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
        frame.paste(scene(data, size, i, S, meta["h"], SY), (0, scene_y))
        for k, name in enumerate(order):
            title, what, color = LEGEND[name]
            found = meta["anchors"][i][name] or held.get(name, [])
            held[name] = found
            cx = int((k + 0.5) * slot)
            lx0, lx1, ly0, ly1 = cx - int(slot / 2) + 6, cx + int(slot / 2) - 6, 12, 58
            if found:
                for box in found:
                    d.rounded_rectangle([box["x"] * S - 1, scene_y + box["y"] * SY - 2, (box["x"] + box["w"]) * S, scene_y + (box["y"] + box["h"]) * SY + 1], 5, outline=color, width=2)
                near = min(found, key=lambda b: abs((b["x"] + b["w"] / 2) * S - cx))
                ax, top = (near["x"] + near["w"] / 2) * S, scene_y + near["y"] * SY
                d.line([(cx, ly1), (cx, ly1 + 10), (ax, top - 16), (ax, top - 5)], fill=color, width=2)
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
        label, x_target = "Quota per harness: green, yellow, red = what is left", quota_x["claude"] + 3 * face.cw
        span = small.getlength(label)
        left = min(max(6, x_target - span / 2), width - span - 6)
        d.text((left, quota_y - 22), label, font=small, fill=(166, 173, 200))
        d.line([(x_target, quota_y - 6), (x_target, quota_y - 1)], fill=(166, 173, 200), width=2)
        if (i * DELAY_MS) % 1200 < 750:  # the prompt's cursor blinks
            d.rectangle([cursor_x, prompt_y + face.ch, cursor_x + face.cw - 1, prompt_y + 2 * face.ch - 2], fill=TEXT)
        status = statusline.render(statusline.ansi_lines(1_790_000_000.0 + i * DELAY_MS / 1000, i), TERMINAL_PX)
        assert status.width <= width, "Status line exceeds the demo terminal width"
        frame.paste(status, (0, status_y))
        frames.append(frame)
    save_gif(frames, IMAGES / "wake-dock.gif")


# ── crew: the four characters catching a message, and every family arriving and leaving in every place ──

CHARACTERS = (("Mochi", "satellite dish"), ("Tabby", "radar whiskers"), ("Tuxedo", "ear trumpet"), ("Bun", "rabbit-ear antennae"))
PLACES = ("City", "Harbor", "Beach", "Mountains", "Countryside", "Forest", "Desert", "Tundra")
FAMILIES = ("Codex", "Claude", "agy", "OpenCode")


def crew():
    small, bold = label_font(False, 15), label_font(True, 17)
    # the characters: one scene each, scaled x8, the gadget popping out each time the worker's message lands
    data, size = cells(WORK / "crew-characters.bin", 34)
    scale, pad = 8, 12
    width = len(CHARACTERS) * (34 * scale + pad) + pad
    frames = []
    for i in range(FRAMES):
        sheet = Image.new("RGB", (width, SCENE_H * scale + 62), BASE)
        draw = ImageDraw.Draw(sheet)
        for n, (name, gadget) in enumerate(CHARACTERS):
            x = pad + n * (34 * scale + pad)
            sheet.paste(scene(data, size, n * FRAMES + i, scale), (x, 10))
            draw.text((x, SCENE_H * scale + 18), name, font=bold, fill=TEXT)
            draw.text((x, SCENE_H * scale + 40), gadget, font=small, fill=(166, 173, 200))
        frames.append(sheet)
    save_gif(frames, IMAGES / "wake-characters.gif")
    # the passages: a grid of places x families, each arriving, working, then leaving in its own way
    data, size = cells(WORK / "crew-passages.bin", 64)
    scale, left, top, gap = 3, 118, 34, 6
    cell_w, cell_h = 64 * scale, SCENE_H * scale
    width = left + len(FAMILIES) * (cell_w + gap)
    frames = []
    for i in range(FRAMES):
        sheet = Image.new("RGB", (width, top + len(PLACES) * (cell_h + gap)), BASE)
        draw = ImageDraw.Draw(sheet)
        for f, family in enumerate(FAMILIES):
            draw.text((left + f * (cell_w + gap) + 4, 8), family, font=bold, fill=TEXT)
        for p, place in enumerate(PLACES):
            y = top + p * (cell_h + gap)
            draw.text((10, y + cell_h // 2 - 9), place, font=small, fill=(166, 173, 200))
            for f in range(len(FAMILIES)):
                sheet.paste(scene(data, size, (p * len(FAMILIES) + f) * FRAMES + i, scale), (left + f * (cell_w + gap), y))
        frames.append(sheet)
    save_gif(frames, IMAGES / "wake-passages.gif")


# ── the new crew: the cast at work, a message sequence, an interrupt ──────────────────────────────────────

def cast():
    """Every family at work in every place (class 4): the moving structure, the effects and the escorts."""
    small, bold = label_font(False, 15), label_font(True, 17)
    data, size = cells(WORK / "readme-crew-cast.bin", 72)
    scale, left, top, gap = 3, 118, 34, 6
    cell_w, cell_h = 72 * scale, SCENE_H * scale
    width = left + len(FAMILIES) * (cell_w + gap)
    def frame_at(i):
        i = (i + 80) % TIMELAPSE_FRAMES
        sheet = Image.new("RGB", (width, top + len(PLACES) * (cell_h + gap)), BASE)
        draw = ImageDraw.Draw(sheet)
        for f, family in enumerate(FAMILIES):
            draw.text((left + f * (cell_w + gap) + 4, 8), family, font=bold, fill=TEXT)
        for p, place in enumerate(PLACES):
            y = top + p * (cell_h + gap)
            draw.text((10, y + cell_h // 2 - 9), place, font=small, fill=(166, 173, 200))
            for f in range(len(FAMILIES)):
                sheet.paste(loop_scene(scene(data, size, (p * len(FAMILIES) + f) * TIMELAPSE_FRAMES + i, scale), i), (left + f * (cell_w + gap), y))
        return sheet
    save_gif(frame_at, IMAGES / "wake-cast.gif", count=TIMELAPSE_FRAMES)


def tiles(sheet_name, width_cells, scale, columns, labels, out_name, captions=None):
    """A grid of one-scene tiles, each a looping family, labelled above."""
    small, bold = label_font(False, 15), label_font(True, 17)
    data, size = cells(WORK / sheet_name, width_cells)
    cell_w, cell_h = width_cells * scale, SCENE_H * scale
    rows = -(-len(labels) // columns)
    pad, head = 10, 28
    width = pad + columns * (cell_w + pad)
    height = pad + rows * (head + cell_h + pad)
    frames = []
    for i in range(FRAMES):
        sheet = Image.new("RGB", (width, height), BASE)
        draw = ImageDraw.Draw(sheet)
        for n, label in enumerate(labels):
            x, y = pad + (n % columns) * (cell_w + pad), pad + (n // columns) * (head + cell_h + pad)
            draw.text((x, y), label, font=bold, fill=TEXT)
            if captions:
                draw.text((x + cell_w - 8 * len(captions[n]) - 4, y + 4), captions[n], font=small, fill=(166, 173, 200))
            sheet.paste(scene(data, size, n * FRAMES + i, scale), (x, y + head))
        frames.append(sheet)
    save_gif(frames, IMAGES / out_name)


def sequence():
    """A worker with a message for the root: it brakes to a hover, turns to face her, sends, turns back and sets off again."""
    tiles("readme-crew-sequence.bin", 110, 4, 2, FAMILIES, "wake-sequence.gif")


def conversations():
    """Two workers and Mochi message one another on a loop: each family throws and catches in its own way."""
    tiles("readme-crew-conversations.bin", 120, 4, 2,
          ("Codex → Claude · city", "OpenCode → Codex · harbor", "agy → OpenCode · desert", "Claude → Claude · mountains"),
          "wake-conversations.gif", ("translated", "translated", "translated", "kin chorus"))


def strike():
    """A worker whose turn is interrupted is struck down, shedding its family's debris."""
    tiles("readme-crew-strike.bin", 64, 4, 2, FAMILIES, "wake-strike.gif",
          captions=("city", "mountains", "desert", "tundra"))


def tour():
    """One large scene at a time, with chapter labels and native playback timing."""
    meta = json.loads((WORK / "tour.json").read_text())
    data, size = cells(WORK / "tour.bin", meta["width"], meta["height"])
    assert len(data) == size * meta["frames"]
    scale, head, foot = 8, 72, 12
    width = meta["width"] * scale
    title_font, caption_font = label_font(True, 22), label_font(False, 15)
    frames = []
    for n, clip in enumerate(meta["clips"]):
        for i in range(clip["start"], clip["end"]):
            frame = Image.new("RGB", (width, head + SCENE_H * scale + foot), BASE)
            draw = ImageDraw.Draw(frame)
            draw.text((18, 10), clip["title"], font=title_font, fill=TEXT)
            draw.text((18, 40), clip["caption"], font=caption_font, fill=(166, 173, 200))
            draw.text((width - 18, 16), f'{n + 1:02} / {len(meta["clips"]):02}', font=caption_font, fill=TEAL, anchor="ra")
            frame.paste(scene(data, size, i, scale), (0, head))
            y = head + SCENE_H * scale + 4
            draw.rectangle((0, y, width * (i - clip["start"] + 1) / (clip["end"] - clip["start"]), y + 2), fill=TEAL)
            frames.append(frame)
    assert len(frames) == meta["frames"]
    edited = []
    cuts = set(meta["cuts"])
    for i, frame in enumerate(frames):
        if i in cuts and edited:
            edited.extend(dissolve(edited[-1], frame))
        edited.append(frame)
    edited.extend(dissolve(edited[-1], edited[0]))
    save_gif(edited, IMAGES / "wake-tour.gif", delay=meta["delay"])


NEW = {"cast": cast, "sequence": sequence, "conversations": conversations, "strike": strike}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    want = sys.argv[1:] or ["tour", "dock", "landscapes", "hero", "crew", "cast", "sequence", "conversations", "strike"]
    if "tour" in want:
        run("bun", "dev/readme-tour.ts", str(WORK / "tour"), cwd=WAKE)
    if any(name in NEW for name in want):
        run("bun", "dev/readme-crew.ts", str(WORK / "readme-crew"), str(FRAMES), cwd=WAKE)
    for name, w in (("landscapes", 180), ("hero", HERO_W)):
        if name in want:
            run("bun", "dev/showcase.ts", str(WORK / f"showcase{w}.bin"), str(TIMELAPSE_FRAMES), str(w), cwd=WAKE)
    if "dock" in want:
        run("bun", "dev/dock.ts", str(WORK / "dock.bin"), str(FRAMES), cwd=WAKE)
    if "crew" in want:
        run("bun", "dev/crew-life.ts", str(WORK / "crew"), str(FRAMES), cwd=WAKE)
    for name in want:
        {"tour": tour, "dock": dock, "landscapes": landscapes, "hero": hero, "crew": crew, **NEW}[name]()
