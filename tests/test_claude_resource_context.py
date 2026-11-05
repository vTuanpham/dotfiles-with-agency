import importlib.util
import os
import shlex
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "claude/.claude/hooks/resource-context.py"
spec = importlib.util.spec_from_file_location("resource_context", path)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


class ResourceContextTest(unittest.TestCase):
    def test_child_identity_is_quoted_and_inherited_owner_wins(self):
        payload = {"hook_event_name": "SubagentStart", "session_id": "root", "agent_id": "a'$(false)"}
        with patch.dict(os.environ, {"AGENT_RESOURCES_OWNER": "codex:controller"}, clear=True):
            result = hook.context(payload)["hookSpecificOutput"]["additionalContext"]
        command = result.split("`", 2)[1]
        self.assertEqual(shlex.split(command), ["export", "AGENT_RESOURCES_WORKER=1",
                         "AGENT_RESOURCES_OWNER=codex:controller", "AGENT_RESOURCES_AGENT_ID=a'$(false)"])
        with patch.dict(os.environ, {}, clear=True):
            self.assertIn("AGENT_RESOURCES_OWNER=claude:root",
                          hook.context(payload)["hookSpecificOutput"]["additionalContext"])

    def test_invalid_or_wrong_event_is_ignored(self):
        for payload in ({}, {"hook_event_name": "Stop", "session_id": "r", "agent_id": "a"},
                        {"hook_event_name": "SubagentStart", "session_id": "r", "agent_id": "bad\nagent"},
                        {"hook_event_name": "SubagentStart", "agent_id": "a"}):
            self.assertIsNone(hook.context(payload))
        with patch.dict(os.environ, {"AGENT_RESOURCES_OWNER": ""}, clear=True):
            self.assertIsNone(hook.context({"hook_event_name": "SubagentStart",
                                           "session_id": "r", "agent_id": "a"}))

    def test_nonprintable_or_whitespace_identities_are_ignored(self):
        for value in ("bad\x7fid", "bad\x85id", "bad\u200bid", "bad\u00a0id"):
            for field in ("session_id", "agent_id"):
                payload = {"hook_event_name": "SubagentStart", "session_id": "r",
                           "agent_id": "a", field: value}
                self.assertIsNone(hook.context(payload))
            with patch.dict(os.environ, {"AGENT_RESOURCES_OWNER": value}, clear=True):
                self.assertIsNone(hook.context({"hook_event_name": "SubagentStart",
                                               "session_id": "r", "agent_id": "a"}))


if __name__ == "__main__":
    unittest.main()
