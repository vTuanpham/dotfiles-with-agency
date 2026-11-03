"""Check focused native mod test staging and exit handling without starting Claude."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOD = ROOT / "claude/.claude/mods/wake"


class ModRunnerTests(unittest.TestCase):
    def test_selected_files_keep_helpers_propagate_failure_and_clean_up(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "claude"
            binary.write_text(
                f"#!{sys.executable}\n"
                "import json, pathlib, sys\n"
                "assert sys.argv[1:3] == ['plugin', 'test']\n"
                "root = pathlib.Path(sys.argv[3])\n"
                "print(json.dumps({'root': str(root), 'tests': sorted(str(p.relative_to(root)) "
                "for p in root.rglob('*.test.ts')), 'helper': (root / 'tests/status-world.ts').is_file()}))\n"
                "sys.exit(7)\n"
            )
            binary.chmod(0o755)
            env = {**os.environ, "PATH": str(binary.parent) + os.pathsep + os.environ["PATH"]}
            original = sorted(MOD.rglob("*.test.ts"))
            result = subprocess.run([sys.executable, str(MOD / "test.py"), "tests/logos.test.ts"],
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 7, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data["tests"], ["tests/logos.test.ts"])
            self.assertTrue(data["helper"])
            self.assertFalse(Path(data["root"]).exists())
            self.assertEqual(sorted(MOD.rglob("*.test.ts")), original)

            result = subprocess.run([sys.executable, str(MOD / "test.py"), "../outside.test.ts"],
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertIn("not a test file inside this mod", result.stderr)


if __name__ == "__main__":
    unittest.main()
