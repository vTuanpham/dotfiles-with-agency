"""The docs say what the code does: every place, character, effect and creature is mentioned, and every link resolves.

The lists come from the code itself, so adding a place, a character, a session effect or a creature without telling the
README fails here instead of going stale. Links and anchors are checked in the README, the docs/ pages and the Wake and
codex-wake READMEs, and every image they show must exist.
"""

import re
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
wake = root / "claude/.claude/mods/wake"
wake_readme = (root / "claude/README.md").read_text()


def slug(heading):
    text = re.sub(r"[`*_]", "", heading).strip().lower()
    return re.sub(r"[^\w\s-]", "", text).replace(" ", "-")


def anchors(path):
    return {slug(m.group(1)) for line in path.read_text().splitlines() if (m := re.match(r"#{1,6}\s+(.*)", line))}


class WakeReadmeMatchesTheCode(unittest.TestCase):
    def test_every_place_is_in_the_landscape_and_exit_tables(self):
        places = re.search(r"WakePreset = ([^\n]+)", (wake / "types/index.d.ts").read_text()).group(1)
        for place in re.findall(r"'(\w+)'", places):
            self.assertTrue(place.lower() in wake_readme.lower(), f"{place} is a landscape the Wake README never mentions")

    def test_every_character_is_listed_with_its_gadget_command(self):
        mochi = (wake / "hooks/mochi.ts").read_text()
        body = mochi[mochi.index("export const CHARACTERS") : mochi.index("export type CharacterId")]
        ids = re.findall(r"^  (\w+): \{", body, re.MULTILINE)
        self.assertEqual(len(ids), 4, "the README says four characters; update it with the count")
        listed = re.search(r"/wake mochi <([^>]*\|[^>]*)>", wake_readme).group(1).split("|")
        self.assertEqual(sorted(listed), sorted(ids), "the /wake mochi list in the README is not the code's list")
        for label in re.findall(r"label: '(\w+)'", body):
            self.assertTrue(label in wake_readme, f"character {label} is not described")

    def test_every_session_effect_is_described(self):
        kinds = re.search(r"SceneEffect = \{ kind: ([^;]+); age", (wake / "hooks/scene.ts").read_text()).group(1)
        words = {"fireworks": "fireworks", "storm": "storm", "shoot": "shooting star", "lanterns": "lanterns", "rainbow": "rainbow"}
        for kind in re.findall(r"'(\w+)'", kinds):
            self.assertTrue(words[kind] in wake_readme, f"effect {kind} is not in the README's effects table")

    def test_every_creature_is_named(self):
        text = (wake / "hooks/landscapes/creatures.ts").read_text()
        for name in re.findall(r"^const (\w+): Species", text, re.MULTILINE):
            self.assertTrue(name.replace("_", " ").lower() in wake_readme.lower(), f"creature {name} is not in the README")

    def test_every_exit_family_and_style_place_is_covered(self):
        styles = (wake / "hooks/exit-styles.ts").read_text()
        for place in ("city", "harbor", "beach", "mountains", "countryside", "forest", "desert", "tundra"):
            for table in ("CODEX", "FLIGHT", "BURST", "ENDING"):
                block = styles[styles.index(f"const {table}") :]
                self.assertRegex(block[:3500], rf"\b{place}\b", f"{table} has no {place} entry")


class LinksResolve(unittest.TestCase):
    pages = (
        "README.md", "docs/setup.md", "docs/packages.md", "claude/README.md", "codex-wake/README.md",
        "docs/tools/README.md", "agent-baton/README.md", "agent-bridge/README.md", "agent-inbox/README.md",
        "computer-use/README.md", "shell/README.md", "tests/README.md",
        "agent-bridge/tests/fixtures/README.md", "agent-inbox/tests/fixtures/README.md",
    )

    def test_relative_links_anchors_and_images(self):
        problems = []
        for name in self.pages:
            page = root / name
            for m in re.finditer(r'\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"', page.read_text()):
                target = m.group(1) or m.group(2)
                if target.startswith(("http", "mailto")):
                    continue
                path, _, fragment = target.partition("#")
                dest = (page.parent / path).resolve() if path else page
                if not dest.exists():
                    problems.append(f"{name}: {target} does not exist")
                elif fragment and dest.suffix == ".md" and fragment not in anchors(dest):
                    problems.append(f"{name}: {target} has no such heading")
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
