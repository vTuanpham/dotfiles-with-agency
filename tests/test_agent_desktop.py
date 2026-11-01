"""Exercise the desktop transport and install verification without a real GUI."""

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "computer-use/.local/bin/agent-desktop"


def script(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/usr/bin/python3\n" + text)
    path.chmod(0o755)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / "bin"
        self.exe = self.home / "data/agent-desktop/windows/agent-desktop.exe"
        self.env = {
            **os.environ,
            "HOME": str(self.home),
            "XDG_DATA_HOME": str(self.home / "data"),
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "GUARD_EVENT": str(self.home / "event.json"),
            "GUARD_EXIT": "0",
        }
        script(
            self.bin / "agent-baton",
            """
import json, os, sys
assert sys.argv[1:] == ['guard']
with open(os.environ['GUARD_EVENT'], 'w') as out:
    json.dump(json.load(sys.stdin), out)
sys.exit(int(os.environ['GUARD_EXIT']))
""",
        )
        script(
            self.exe,
            """
import json, sys
print(json.dumps({'args': sys.argv[1:], 'stdin': sys.stdin.read()}, ensure_ascii=False))
print('native stderr', file=sys.stderr)
sys.exit(17)
""",
        )

    def launch(self, *args):
        return subprocess.run(
            [sys.executable, str(LAUNCHER), *args],
            input="native stdin",
            text=True,
            capture_output=True,
            env=self.env,
        )

    def test_transport_preserves_unicode_argv_streams_and_native_failure(self):
        args = ["set-value", "@snapshot:e1", 'tiếng Việt / 日本語 / 🚀\n" $(exit 9)']
        result = self.launch(*args)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(json.loads(result.stdout), {"args": args, "stdin": "native stdin"})
        self.assertEqual(result.stderr, "native stderr\n")
        event = json.loads((self.home / "event.json").read_text())
        self.assertEqual(event["tool_name"], "mcp__computer__agent_desktop")
        self.assertIn("agent-desktop set-value", event["tool_input"]["command"])

    def test_guard_denial_prevents_execution_and_missing_guard_fails_closed(self):
        self.env["GUARD_EXIT"] = "2"
        result = self.launch("screenshot")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.env["PATH"] = str(self.bin)
        (self.bin / "agent-baton").unlink()
        result = self.launch("screenshot")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("Requires agent-baton", result.stderr)

    def test_missing_binary_reports_the_install_step(self):
        self.exe.unlink()
        result = self.launch("version")
        self.assertEqual(result.returncode, 1)
        self.assertIn("--apply desktop-tools", result.stderr)

    def test_installer_verifies_downloads_and_preserves_existing_binaries(self):
        self.exe.unlink()
        # Select WSL even on Linux CI; leave all other installer tools real.
        script(
            self.bin / "grep",
            """
import os, sys
if sys.argv[1:3] == ['-qi', 'microsoft']: sys.exit(0)
os.execv('/usr/bin/grep', ['grep', *sys.argv[1:]])
""",
        )
        script(self.bin / "uname", "print('x86_64')\n")
        archive = self.home / "archive.tar.gz"
        payload = self.home / "agent-desktop.exe"
        payload.write_text("verified fixture")
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(payload, arcname="agent-desktop.exe")
        self.env["FIXTURE_ARCHIVE"] = str(archive)
        self.env["FIXTURE_SHA"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        script(
            self.bin / "curl",
            r"""
import os, pathlib, shutil, sys
url = sys.argv[2]
dest = pathlib.Path(sys.argv[sys.argv.index('-o') + 1])
if url.endswith('checksums.txt'):
    dest.write_text(os.environ['FIXTURE_SHA'] + '  agent-desktop-v1.0.2-x86_64-pc-windows-msvc.tar.gz\r\n')
else:
    shutil.copyfile(os.environ['FIXTURE_ARCHIVE'], dest)
""",
        )
        script(
            self.bin / "gh",
            """
import os, pathlib, sys
if os.environ.get('COMPETING_BINARY'):
    pathlib.Path(os.environ['COMPETING_BINARY']).write_text('concurrent installation')
sys.exit(int(os.environ.get('ATTEST_EXIT', '0')))
""",
        )

        def install(*args):
            return subprocess.run(
                [str(ROOT / "install.sh"), *args, "desktop-tools"],
                env=self.env,
                text=True,
                capture_output=True,
            )

        dry = install()
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertFalse(self.exe.exists())
        self.env["ATTEST_EXIT"] = "1"
        self.assertNotEqual(install("--apply").returncode, 0)
        self.assertFalse(self.exe.exists())
        self.env["ATTEST_EXIT"] = "0"
        self.env["FIXTURE_SHA"] = "0" * 64
        self.assertNotEqual(install("--apply").returncode, 0)
        self.assertFalse(self.exe.exists())
        self.env["FIXTURE_SHA"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.env["COMPETING_BINARY"] = str(self.exe)
        result = install("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.exe.read_text(), "concurrent installation")
        del self.env["COMPETING_BINARY"]
        self.exe.unlink()
        result = install("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.exe.read_text(), "verified fixture")
        self.exe.write_text("existing binary must stay untouched")
        self.env["ATTEST_EXIT"] = "1"  # An existing binary must not trigger a fresh download/verification.
        self.assertEqual(install("--apply").returncode, 0)
        self.assertEqual(self.exe.read_text(), "existing binary must stay untouched")


if __name__ == "__main__":
    unittest.main()
