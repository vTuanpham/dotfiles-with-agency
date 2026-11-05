"""Exercise global filters as an isolated trusted project, including real dispatch."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


CLAUDE_HOOK = Path(__file__).resolve().parents[1] / "claude/.claude/hooks/rtk.py"


class FilterTests(unittest.TestCase):
    def test_summary_does_not_classify_jq_expressions_or_filenames_as_tests(self):
        rtk = shutil.which("rtk")
        jq = shutil.which("jq")
        self.assertIsNotNone(rtk, "install RTK before running filter checks")
        self.assertIsNotNone(jq, "install jq before running filter checks")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "build_models.json"
            data.write_text(json.dumps([
                {"model": f"model-{i:02}", "billing": "free", "observations": i}
                for i in range(20)
            ]))
            env = {**os.environ, "HOME": directory, "XDG_CONFIG_HOME": str(root / "config"),
                   "XDG_DATA_HOME": str(root / "data")}
            query = ('.[] | select(.model | test("model")) | '
                     '"\\(.model) billing=\\(.billing) observations=\\(.observations)"')
            result = subprocess.run([rtk, "summary", jq, "-r", query, str(data)],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("model-00 billing=free observations=0", result.stdout)
            self.assertNotIn("Test Results:", result.stdout)
            self.assertNotIn("Build Summary:", result.stdout)
            paths = [root / f"test_policy_{i:02}.py" for i in range(20)]
            for path in paths:
                path.write_text("line\n" * 37)
            result = subprocess.run([rtk, "summary", "wc", "-l", *map(str, paths)],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("Test Results:", result.stdout)
            self.assertIn("37", result.stdout)

    def test_summary_preserves_native_test_counts_and_failure_diagnostics(self):
        rtk = shutil.which("rtk")
        node = shutil.which("node")
        self.assertIsNotNone(rtk, "install RTK before running filter checks")
        self.assertIsNotNone(node, "install Node before running filter checks")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {**os.environ, "HOME": directory, "XDG_CONFIG_HOME": str(root / "config"),
                   "XDG_DATA_HOME": str(root / "data")}
            source = root / "passing.test.mjs"
            source.write_text(
                'import test from "node:test";\n'
                'test("reports failed saves", () => {});\n'
                'test("skips broken links", () => {});\n'
                'test("keeps ok markers", () => {});\n'
            )
            result = subprocess.run(
                [rtk, "summary", node, "--test", "--test-reporter=tap", str(source)],
                cwd=root, env=env, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("# pass 3", result.stdout)
            self.assertIn("# fail 0", result.stdout)
            self.assertNotIn("Failures:", result.stdout)
            (root / "broken_test.py").write_text(
                'import unittest\n'
                'class Broken(unittest.TestCase):\n'
                '    def test_saved_value(self):\n'
                '        self.assertEqual("lost", "saved")\n'
            )
            result = subprocess.run([rtk, "summary", sys.executable, "-m", "unittest", "broken_test"],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("AssertionError", result.stdout + result.stderr)
            self.assertIn("FAILED (failures=1)", result.stdout + result.stderr)

    def test_codex_adapter_returns_valid_replacement_input(self):
        self.assertIsNotNone(shutil.which("rtk"), "install RTK before running filter checks")
        snapshot = Path(__file__).resolve().parents[1] / "codex/.codex/hooks.json"
        bash = next(group for group in json.loads(snapshot.read_text())["hooks"]["PreToolUse"]
                    if group.get("matcher") == "Bash")
        self.assertEqual([hook["command"] for hook in bash["hooks"]
                          if hook["command"].startswith("rtk hook ")], ["rtk hook codex"])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {**os.environ, "HOME": directory, "XDG_CONFIG_HOME": str(root / "config"),
                   "XDG_DATA_HOME": str(root / "data")}
            env.pop("RTK_REWRITE_HOST", None)
            for command in ("git status", "rtk git status", "find . -type f | rg keep | sort",
                            "git status && git diff --stat", "false && git status"):
                original = {"command": command, "yield_time_ms": 30000, "max_output_tokens": 1000}
                event = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": original,
                         "permission_mode": "default", "cwd": directory}
                result = subprocess.run(["rtk", "hook", "codex"], input=json.dumps(event),
                                        cwd=root, env=env, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                output = json.loads(result.stdout) if result.stdout.strip() else {}
                hook = output.get("hookSpecificOutput", {})
                if "updatedInput" in hook:
                    self.assertEqual(hook["hookEventName"], "PreToolUse")
                    self.assertEqual(hook.get("permissionDecision"), "allow")
                    self.assertIsInstance(hook["updatedInput"]["command"], str)
                    self.assertEqual({k: v for k, v in hook["updatedInput"].items() if k != "command"},
                                     {k: v for k, v in original.items() if k != "command"})
                if command == "git status":
                    self.assertEqual(hook["updatedInput"]["command"], "rtk git status")
                elif command.startswith("find"):
                    self.assertEqual(hook.get("updatedInput", original)["command"], command)

    def test_claude_hook_leaves_classifier_reviewed_inputs_intact(self):
        for mode in ("auto", "plan", "future-mode", None, []):
            for command in ("git status", "rtk git status", "git status && git diff --stat"):
                with self.subTest(mode=mode, command=command):
                    event = {"tool_name": "Bash", "tool_input": {"command": command},
                             "permission_mode": mode}
                    result = subprocess.run(
                        [sys.executable, "-I", str(CLAUDE_HOOK)], input=json.dumps(event),
                        capture_output=True, text=True, timeout=30,
                    )
                    self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        for payload in ('{"tool_name":"Bash"}', "[]", "null", "{broken"):
            result = subprocess.run([sys.executable, "-I", str(CLAUDE_HOOK)], input=payload,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        result = subprocess.run(
            [sys.executable, "-I", str(CLAUDE_HOOK)],
            input=json.dumps({"permission_mode": "default", "tool_name": "Bash",
                              "tool_input": {"command": "git status"}}),
            env={**os.environ, "PATH": ""}, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))

    def test_claude_hook_delegates_other_modes_to_native_rtk(self):
        self.assertIsNotNone(shutil.which("rtk"), "install RTK before running filter checks")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {**os.environ, "HOME": str(root), "XDG_CONFIG_HOME": str(root / "config"),
                   "XDG_DATA_HOME": str(root / "data")}
            env.pop("RTK_REWRITE_HOST", None)
            for mode in ("default", "acceptEdits", "dontAsk", "bypassPermissions"):
                for command in ("git status", "rtk git status"):
                    event = {"tool_name": "Bash", "tool_input": {
                        "command": command, "description": "Check status", "timeout": 30000},
                        "permission_mode": mode, "cwd": str(root)}
                    options = dict(input=json.dumps(event), cwd=root, env=env,
                                   capture_output=True, text=True, timeout=30)
                    native = subprocess.run(["rtk", "hook", "claude"], **options)
                    wrapped = subprocess.run([sys.executable, "-I", str(CLAUDE_HOOK)], **options)
                    self.assertEqual((wrapped.returncode, wrapped.stdout, wrapped.stderr),
                                     (native.returncode, native.stdout, native.stderr))
                    self.assertEqual(wrapped.returncode, 0, wrapped.stderr)
                    output = json.loads(wrapped.stdout) if wrapped.stdout.strip() else {}
                    rewritten = output.get("hookSpecificOutput", {}).get("updatedInput", {})
                    self.assertEqual(rewritten.get("command", command), "rtk git status")

    def test_hook_preserves_intermediate_data_and_shell_control_flow(self):
        rtk = shutil.which("rtk")
        self.assertIsNotNone(rtk, "install RTK before running filter checks")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {**os.environ, "HOME": str(root), "XDG_CONFIG_HOME": str(root / "config"),
                   "XDG_DATA_HOME": str(root / "data")}
            env.pop("RTK_REWRITE_HOST", None)

            def rewrite(command):
                result = subprocess.run(
                    [rtk, "hook", "claude"], input=json.dumps({
                        "tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(root)}),
                    cwd=root, env=env, capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                output = json.loads(result.stdout) if result.stdout.strip() else {}
                hook = output.get("hookSpecificOutput", {})
                self.assertNotEqual(hook.get("permissionDecision"), "deny", output)
                return hook.get("updatedInput", {}).get("command", command)

            self.assertEqual(rewrite("find . -type f | rg keep | rg jsonl"),
                             "find . -type f | rg keep | rtk rg jsonl")
            self.assertEqual(rewrite("git status; find . -type f | rg jsonl && git diff --stat"),
                             "rtk git status; find . -type f | rtk rg jsonl && rtk git diff --stat")
            for command in ("find . -type f | rg keep | sort", "find . -type f > inventory.txt",
                            'printf "%s\\n" "$(find . -type f | wc -l)"'):
                self.assertEqual(rewrite(command), command)

            for number in range(120):
                (root / f"keep-{number:03d}.jsonl").touch()
            pipeline = "find . -maxdepth 1 -name 'keep-*.jsonl' | rg keep | wc -l"
            result = subprocess.run(["bash", "-o", "pipefail", "-c", rewrite(pipeline)],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "120")
            for command, expected in (("false && git status", 1), ("true || git status", 0)):
                result = subprocess.run(["bash", "-c", rewrite(command)], cwd=root, env=env,
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                self.assertEqual(result.stdout, "")

    def test_inline_fixtures_dispatch_and_failed_exit_code(self):
        rtk = shutil.which("rtk")
        self.assertIsNotNone(rtk, "install RTK before running filter checks")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".rtk").mkdir()
            (root / ".rtk/filters.toml").write_bytes(
                (Path(__file__).resolve().parents[1] / "rtk/.config/rtk/filters.toml").read_bytes()
            )
            (root / "uvx").write_text(
                '#!/bin/sh\nprintf "Resolved 2 packages in 120ms\\nerror: fixture failure\\n" >&2\nexit 7\n'
            )
            (root / "uvx").chmod(0o755)
            env = {**os.environ, "XDG_CONFIG_HOME": str(root / "config"),
                   "XDG_DATA_HOME": str(root / "data"),
                   "PATH": str(root) + os.pathsep + os.environ["PATH"]}
            env.pop("RTK_NO_TOML", None)
            env.pop("RTK_TRUST_ALL", None)
            options = dict(cwd=root, env=env, capture_output=True, text=True, timeout=30)
            subprocess.run([rtk, "trust", "--yes"], check=True, **options)
            verified = subprocess.run(
                [rtk, "verify", "--filter", "uvx-progress", "--require-all"], check=True, **options
            )
            self.assertIn("3/3 tests passed", verified.stdout)
            output = subprocess.run([rtk, "uvx", "fixture"], **options)
            self.assertEqual(output.returncode, 7, output.stdout + output.stderr)
            self.assertIn("error: fixture failure", output.stdout + output.stderr)
            self.assertNotIn("Resolved", output.stdout + output.stderr)


if __name__ == "__main__":
    unittest.main()
