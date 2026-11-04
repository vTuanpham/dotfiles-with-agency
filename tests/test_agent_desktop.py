"""Exercise the desktop transport and install verification without a real GUI."""

import hashlib
import json
import os
import runpy
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
            "NATIVE_CALLS": str(self.home / "native.jsonl"),
            "WINDOW_INVENTORY": json.dumps({
                "version": "2.5", "ok": True, "command": "list-windows",
                "data": [
                    {"id": "w-1", "app_name": "msrdc.exe"},
                    {"id": "w-2", "app_name": "notepad.exe"},
                ],
            }),
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
import json, os, sys
with open(os.environ['NATIVE_CALLS'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1:2] == ['list-windows']:
    print(os.environ['WINDOW_INVENTORY'])
    sys.exit(int(os.environ.get('INVENTORY_EXIT', '0')))
print(json.dumps({'args': sys.argv[1:], 'stdin': sys.stdin.read()}, ensure_ascii=False))
print('native stderr', file=sys.stderr)
sys.exit(17)
""",
        )

    def launch(self, *args):
        return subprocess.run(
            [sys.executable, str(LAUNCHER), *args],
            check=False,
            input="native stdin",
            text=True,
            capture_output=True,
            env=self.env,
            timeout=10,
        )

    def calls(self):
        log = self.home / "native.jsonl"
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def assert_refused(self, result, command):
        self.assertEqual(result.returncode, 1, result.stderr)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["command"], command)
        self.assertEqual(payload["error"]["details"]["kind"], "wslg_geometry_guard")
        self.assertEqual(payload["error"]["disposition"], {"delivery": "not_delivered", "retry": "safe"})

    def test_remote_move_and_resize_are_refused_before_dispatch(self):
        for command, dimensions in (("move-window", ["--x", "100", "--y", "100"]),
                                    ("resize-window", ["--width", "800", "--height", "600"])):
            with self.subTest(command=command):
                result = self.launch("--session", "test", command, "--window-id=w-1", *dimensions)
                self.assert_refused(result, command)
                self.assertIn("msrdc.exe", result.stdout)
        self.assertEqual(self.calls(), [["list-windows", "--session", "test"]] * 2)

    def test_native_window_with_remote_neighbor_preserves_transport(self):
        args = ["move-window", "--window-id", "w-2", "--x=-100", "--y", "0", "--session=test"]
        result = self.launch(*args)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(json.loads(result.stdout), {"args": args, "stdin": "native stdin"})
        self.assertEqual(result.stderr, "native stderr\n")
        self.assertEqual(self.calls(), [["list-windows", "--session", "test"], args])

    def test_app_filter_is_delegated_to_native_inventory(self):
        self.env["WINDOW_INVENTORY"] = json.dumps({
            "version": "2.5", "ok": True, "command": "list-windows",
            "data": [{"id": "w-1", "app_name": "C:\\Windows\\MSRDC.EXE"}],
        })
        result = self.launch("resize-window", "--app=MSRDC.EXE", "--width", "800", "--height", "600")
        self.assert_refused(result, "resize-window")
        self.assertEqual(self.calls(), [["list-windows", "--app", "MSRDC.EXE"]])

    def test_native_app_selector_with_global_options_preserves_transport(self):
        self.env["WINDOW_INVENTORY"] = json.dumps({
            "version": "2.5", "ok": True, "command": "list-windows",
            "data": [{"id": "w-2", "app_name": "notepad.exe"}],
        })
        args = ["--session=root", "--agent-id", "worker", "--headed", "resize-window",
                "--app", "notepad.exe", "--width=800", "--height=600"]
        result = self.launch(*args)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(json.loads(result.stdout), {"args": args, "stdin": "native stdin"})
        self.assertEqual(self.calls(), [
            ["list-windows", "--session", "root", "--agent-id", "worker", "--app", "notepad.exe"], args,
        ])

    def test_inventory_timeout_and_unavailable_executable_refuse_without_retry(self):
        guard = runpy.run_path(str(LAUNCHER))["geometry_guard"]
        for failure in (subprocess.TimeoutExpired("list-windows", 15), FileNotFoundError("missing")):
            with self.subTest(failure=failure), patch("subprocess.run", side_effect=failure) as native:
                refusal = guard(self.exe, ["move-window", "--window-id=w-1", "--x=0", "--y=0"])
                self.assertEqual(refusal[0], "move-window")
                self.assertIn("not sent", refusal[1])
                self.assertEqual(native.call_count, 1)

    def test_unverified_geometry_targets_fail_closed(self):
        payloads = [
            "not JSON", "[]", '{}',
            '{"version":"2.5","ok":true,"command":"list-windows","data":null}',
            '{"version":"2.5","ok":true,"command":"list-windows","data":[{"id":"w-2"}]}',
            '{"version":"2.5","ok":true,"command":"list-windows","data":{"windows":[]}}',
            '{"version":"future","ok":true,"command":"list-windows","data":[]}',
        ]
        for raw in payloads:
            with self.subTest(raw=raw):
                self.env["WINDOW_INVENTORY"] = raw
                self.assert_refused(
                    self.launch("move-window", "--window-id", "w-2", "--x=0", "--y=0"), "move-window"
                )
        self.assertTrue(all(call == ["list-windows"] for call in self.calls()))

    def test_missing_target_and_inventory_failure_do_not_dispatch(self):
        self.assert_refused(self.launch("move-window", "--x=0", "--y=0"), "move-window")
        self.assertEqual(self.calls(), [])
        self.assert_refused(
            self.launch("move-window", "--window-id=w-missing", "--x=0", "--y=0"), "move-window"
        )
        self.env["INVENTORY_EXIT"] = "1"
        self.assert_refused(self.launch("move-window", "--window-id=w-2", "--x=0", "--y=0"), "move-window")
        self.assertEqual(self.calls(), [["list-windows"], ["list-windows"]])

    def test_geometry_batch_is_refused_before_any_entry_runs(self):
        for command in ("move-window", "resize-window"):
            entries = [{"command": "launch", "args": {"app": "notepad.exe"}},
                       {"command": command, "args": {"app": "msrdc.exe", "x": 0, "y": 0}}]
            self.assert_refused(self.launch("batch", "--stop-on-error", json.dumps(entries)), "batch")
        self.assertEqual(self.calls(), [])

    def test_non_geometry_batch_and_command_like_text_are_unchanged(self):
        batch = json.dumps([{"command": "set-value", "args": {"text": "move-window"}}])
        for args in (["batch", batch], ["--session", "move-window", "status"],
                     ["set-value", "@ref:e1", "resize-window"], ["batch", '[{"command": []}]'],
                     ["move-window", "--help"], ["batch", "--help"]):
            with self.subTest(args=args):
                result = self.launch(*args)
                self.assertEqual(result.returncode, 17, result.stderr)
                self.assertEqual(json.loads(result.stdout), {"args": args, "stdin": "native stdin"})
        self.assertNotIn(["list-windows"], self.calls())

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
        self.assertEqual(self.calls(), [])
        result = self.launch("move-window", "--window-id=w-1", "--x=0", "--y=0")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])
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
                check=False,
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
