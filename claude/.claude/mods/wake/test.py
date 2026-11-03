"""Run all Wake tests, or selected files, through Claude's native mod test kit."""

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="test files relative to this mod, e.g. tests/logos.test.ts")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    selected = set()
    for name in args.files:
        path = (root / name).resolve()
        if (not path.is_relative_to(root) or not path.is_file()
                or not path.name.endswith((".test.ts", ".test.tsx"))):
            parser.error(f"not a test file inside this mod: {name}")
        selected.add(path)

    with tempfile.TemporaryDirectory(prefix="wake-tests-") as temporary:
        target = root
        if selected:
            def ignore(directory, names):
                return [name for name in names if name == "__pycache__"
                        or (Path(directory) == root / ".claude-plugin" and name == "types")
                        or (name.endswith((".test.ts", ".test.tsx"))
                            and (Path(directory) / name).resolve() not in selected)]

            target = Path(temporary) / "wake"
            shutil.copytree(root, target, ignore=ignore)
        result = subprocess.run(["claude", "plugin", "test", str(target)], cwd=root)
    return result.returncode if result.returncode >= 0 else 128 - result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
