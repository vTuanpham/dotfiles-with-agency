"""Check install.sh against a throwaway HOME: dry runs change nothing, links are idempotent, and a file
that differs from the repo is reported and left alone."""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

root = Path(__file__).resolve().parents[1]
script = root / "install.sh"


def install(home, *args):
    env = {**os.environ, "HOME": str(home), "XDG_STATE_HOME": str(Path(home) / ".local/state")}
    return subprocess.run([str(script), *args], capture_output=True, text=True, env=env, cwd=root)


class InstallTests(unittest.TestCase):
    def test_a_dry_run_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = install(tmp, "links", "snapshots")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("ln -s", result.stdout)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_links_point_into_the_repo_and_a_second_run_does_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = install(tmp, "--apply", "links")
            second = install(tmp, "--apply", "links")

            self.assertEqual(first.returncode, 0, first.stderr)
            for name in (".zshrc", ".claude/CLAUDE.md", ".config/systemd/user/agent-models-reference.timer",
                         ".local/libexec/chatgpt-browser-idle.py", ".codex/skills/codex-wake",
                         ".local/libexec/agent-process-guard.py", ".claude/hooks/rtk.py",
                         ".claude/hooks/resource-context.py",
                         ".local/bin/agent-desktop",
                         ".config/opencode/plugins/agent-process-guard.js",
                         ".config/systemd/user/agent-lab-gc.timer",
                         ".config/systemd/user/agent-lab-gc.service"):
                link = Path(tmp) / name
                self.assertTrue(link.is_symlink(), name)
                self.assertTrue(str(link.resolve()).startswith(str(root)), name)
            for skill in ("correct", "benchmark-checklist", "create-verification-skill",
                          "maintain-verification-skill", "how", "why", "blast-radius", "arena", "unslop",
                          "python-project", "agent-lab", "agent-desktop"):
                source = root / "agents/.agents/skills" / skill
                self.assertTrue((source / "SKILL.md").is_file(), skill)
                for directory in (".agents/skills", ".claude/skills", ".gemini/config/skills"):
                    link = Path(tmp) / directory / skill
                    self.assertTrue(link.is_symlink(), str(link))
                    self.assertEqual(link.resolve(), source)
            self.assertNotIn("  + ", second.stdout)
            for directory in (".agents/skills", ".claude/skills", ".gemini/config/skills"):
                self.assertFalse((Path(tmp) / directory / "codex-wake").exists())

    def test_a_different_file_is_a_conflict_and_is_left_alone_but_an_identical_copy_becomes_a_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".zshrc").write_text("my own zshrc\n")
            crlf = (root / "shell/.zprofile").read_text().replace("\n", "\r\n")
            (home / ".zprofile").write_text(crlf.rstrip("\r\n"))  # same text: CRLF and no final newline

            result = install(home, "--apply", "links")

            self.assertEqual(result.returncode, 1)
            self.assertIn("CONFLICT", result.stdout)
            self.assertEqual((home / ".zshrc").read_text(), "my own zshrc\n")
            self.assertTrue((home / ".zprofile").is_symlink())
            self.assertTrue((home / ".bashrc").is_symlink())  # the rest still went through

    def test_snapshots_copy_only_what_is_missing_and_never_a_package_readme(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".gitconfig").write_text("[user]\n\tname = someone else\n")

            result = install(home, "--apply", "snapshots")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((home / ".gitconfig").read_text(), "[user]\n\tname = someone else\n")
            self.assertIn("differs: ~/.gitconfig", result.stdout)
            self.assertTrue((home / ".claude/settings.json").is_file())
            self.assertFalse((home / "README.md").exists())


    def test_hooks_are_added_to_an_existing_file_without_losing_anything_and_only_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            live = home / ".claude/settings.json"
            live.parent.mkdir()
            live.write_text(
                json.dumps(
                    {
                        "model": "mine",
                        "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "mine"}]}]},
                    }
                )
            )

            dry = install(home, "hooks")
            self.assertIn("gains the hooks and plugins", dry.stdout)
            self.assertNotIn("agent-baton guard", live.read_text())  # a dry run edits nothing

            install(home, "--apply", "hooks")
            result = json.loads(live.read_text())
            commands = [h["command"] for g in result["hooks"]["PreToolUse"] for h in g["hooks"]]
            self.assertNotIn("AskUserQuestion", [g.get("matcher") for g in result["hooks"]["PreToolUse"]])
            self.assertNotIn("agent-inbox claude-question", commands)
            self.assertEqual(result["model"], "mine")
            self.assertIn("mine", commands)
            self.assertEqual(commands.count("agent-baton guard"), 2)  # the Bash group and the browser-tool group
            self.assertIn('python3 -I "$HOME/.claude/hooks/rtk.py"', commands)
            self.assertIn("python3 -I ~/.claude/hooks/resource-context.py",
                          [h["command"] for g in result["hooks"]["SubagentStart"] for h in g["hooks"]])
            self.assertEqual(commands.count('python3 -I "$HOME/.local/libexec/agent-process-guard.py"'), 1)
            self.assertTrue(result["enabledPlugins"]["ponytail@ponytail"])  # the plugin and its marketplace
            self.assertIn("ponytail", result["extraKnownMarketplaces"])
            backups = list((home / ".local/state/backups/dotfiles-with-agency").glob("*/.claude/settings.json"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(json.loads(backups[0].read_text())["model"], "mine")
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            self.assertEqual(backups[0].parent.stat().st_mode & 0o777, 0o700)
            self.assertIn(str(live), (backups[0].parents[1] / "README.txt").read_text())
            self.assertFalse((home / ".claude/settings.json.bak-install").exists())
            self.assertIn("already has the hooks", install(home, "--apply", "hooks").stdout)

    def test_rtk_hooks_replace_old_entries_preserving_local_hooks_and_other_matchers(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            claude = home / ".claude/settings.json"
            codex = home / ".codex/hooks.json"
            local = {"type": "command", "command": "RTK_DEBUG=1 rtk hook claude"}
            custom = {"type": "command", "command": "rtk hook claude"}
            for path in (claude, codex):
                path.parent.mkdir()
                path.write_text(json.dumps({"permissions": {"defaultMode": "auto"}, "hooks": {
                    "PreToolUse": [{"matcher": "Bash", "hooks": [custom, local]},
                                   {"matcher": "CustomTool", "hooks": [custom]}]}}))
            before = claude.read_bytes()
            self.assertEqual(install(home, "links", "hooks").returncode, 0)
            self.assertEqual(claude.read_bytes(), before)
            self.assertEqual(install(home, "--apply", "links", "hooks").returncode, 0)
            first = claude.read_bytes()
            settings = json.loads(first)
            bash = next(g["hooks"] for g in settings["hooks"]["PreToolUse"] if g["matcher"] == "Bash")
            self.assertNotIn(custom, bash)
            self.assertIn(local, bash)
            self.assertEqual(sum(h["command"] == 'python3 -I "$HOME/.claude/hooks/rtk.py"'
                                 for h in bash), 1)
            self.assertEqual(settings["permissions"], {"defaultMode": "auto"})
            self.assertIn({"matcher": "CustomTool", "hooks": [custom]}, settings["hooks"]["PreToolUse"])
            codex_settings = json.loads(codex.read_text())
            codex_bash = next(g["hooks"] for g in codex_settings["hooks"]["PreToolUse"]
                              if g["matcher"] == "Bash")
            self.assertNotIn(custom, codex_bash)
            self.assertIn(local, codex_bash)
            self.assertEqual(sum(h["command"] == "rtk hook codex" for h in codex_bash), 1)
            self.assertIn({"matcher": "CustomTool", "hooks": [custom]}, codex_settings["hooks"]["PreToolUse"])
            codex_first = codex.read_bytes()
            self.assertTrue((home / ".claude/hooks/rtk.py").is_symlink())
            self.assertEqual(install(home, "--apply", "links", "hooks").returncode, 0)
            self.assertEqual(claude.read_bytes(), first)
            self.assertEqual(codex.read_bytes(), codex_first)

    def test_rtk_migration_keeps_one_existing_native_entry_and_its_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            for filename, command in ((".codex/hooks.json", "rtk hook codex"),
                                      (".claude/settings.json", 'python3 -I "$HOME/.claude/hooks/rtk.py"')):
                live = home / filename
                live.parent.mkdir()
                native = {"type": "command", "command": command, "timeout": 17}
                local = {"type": "command", "command": "RTK_DEBUG=1 rtk hook claude"}
                live.write_text(json.dumps({"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
                    {"type": "command", "command": "rtk hook claude"}, native, local,
                ]}]}}))
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            for filename in (".codex/hooks.json", ".claude/settings.json"):
                live = home / filename
                hooks = json.loads(live.read_text())["hooks"]["PreToolUse"][0]["hooks"]
                self.assertNotIn("rtk hook claude", [hook["command"] for hook in hooks])
                managed = [hook for hook in hooks if hook["command"] in (
                    "rtk hook codex", 'python3 -I "$HOME/.claude/hooks/rtk.py"')]
                self.assertEqual(len(managed), 1)
                self.assertEqual(managed[0]["timeout"], 17)
                self.assertIn(local, hooks)
                before = live.read_bytes()
                self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
                self.assertEqual(live.read_bytes(), before)

    def test_codex_idle_hooks_merge_once_preserving_local_hooks(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            live = home / ".codex/hooks.json"
            live.parent.mkdir()
            live.write_text(json.dumps({"hooks": {"Stop": [{"hooks": [
                {"type": "command", "command": "mine"}]}]}}))
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            first = live.read_bytes()
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            self.assertEqual(live.read_bytes(), first)
            hooks = json.loads(first)["hooks"]
            post = next(g for g in hooks["PostToolUse"]
                        if g.get("matcher") == "^mcp__node_repl__js$")["hooks"][0]
            self.assertTrue(post["async"])
            self.assertGreater(post["timeout"], 300)
            self.assertIn("chatgpt-browser-idle.py", post["command"])
            collected = next(g for g in hooks["PostToolUse"] if g.get("matcher") == "Bash")["hooks"]
            self.assertEqual(collected, [{"type": "command", "command": "codex-wake hook", "timeout": 3}])
            self.assertIn("mine", [h["command"] for g in hooks["Stop"] for h in g["hooks"]])
            for name in ("Stop", "Interrupt", "SessionEnd"):
                self.assertIn("chatgpt-browser-idle.py", hooks[name][0]["hooks"][-1]["command"])

    def test_antigravity_named_hooks_preserve_local_entries_and_disabled_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            live = home / ".gemini/config/hooks.json"
            self.assertEqual(install(home, "hooks").returncode, 0)
            self.assertFalse(live.exists())
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            first = live.read_bytes()
            self.assertIn("run_command", first.decode())
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            self.assertEqual(live.read_bytes(), first)
            local = {"mine": {"Stop": []}, "agent-process-guard": {"enabled": False}}
            live.write_text(json.dumps(local))
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            self.assertEqual(json.loads(live.read_text()), local)
            live.write_text(json.dumps({"mine": {"Stop": []}}))
            self.assertEqual(install(home, "--apply", "hooks").returncode, 0)
            self.assertEqual(json.loads(live.read_text())["mine"], {"Stop": []})
            backups = list((home / ".local/state/backups/dotfiles-with-agency").glob("*/.gemini/config/hooks.json"))
            self.assertEqual(len(backups), 1)

    def test_the_cron_line_is_a_valid_five_field_entry(self):
        line = re.search(r"local line='([^']+)'", script.read_text()).group(1)

        self.assertRegex(line, r"^\d+ \* \* \* \* \$HOME/\S+ >/dev/null 2>>\$HOME/\S+$")


if __name__ == "__main__":
    unittest.main()
