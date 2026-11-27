"""Exercise Orbit over its stdio MCP entry point."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

PROVIDER = Path(__file__).resolve().parents[1] / "codex/.codex/statusline.py"
SNAPSHOT_KEY = "com.openai/codex-statusline-state"
URI = "ui://orbit-statusline/footer"


def read(state):
    return "resources/read", {"uri": URI, "_meta": {SNAPSHOT_KEY: state}}


def leaves(node):
    if isinstance(node, str):
        return [node]
    return [leaf for child in node["children"] for leaf in leaves(child)]


class OrbitTests(unittest.TestCase):
    def test_switching_threads_changes_the_footer(self):
        active = {
            "thread": {
                "agent": {"state": "thinking"},
                "model": {"display_name": "Test Model", "reasoning_level": "high"},
                "workspace": {"cwd": "/work/observatory"},
                "usage": {"context": {"used_percentage": 63}},
            },
            "account": {
                "rate_limits": [{
                    "limit_id": "codex",
                    "primary_limit": {"window_minutes": 300, "used_percent": 83},
                    "secondary_limit": {"window_minutes": 10080, "used_percent": 101},
                }],
            },
        }
        fresh = {
            "thread": {
                "agent": {"state": "ready"},
                "model": {"display_name": "Other Model"},
                "workspace": {"cwd": "/work/new\nproject"},
            },
        }
        requests = [("tools/list", {}), read(active), read(fresh)]
        output = subprocess.run(
            [sys.executable, "-u", PROVIDER],
            input="".join(
                json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n"
                for i, (method, params) in enumerate(requests)
            ),
            capture_output=True, text=True, check=True, timeout=3,
        ).stdout
        listing, active_read, fresh_read = [json.loads(line)["result"] for line in output.splitlines()]
        tool, = listing["tools"]
        self.assertEqual(tool["name"], "statusline")
        self.assertEqual(tool["_meta"]["openai/ui"]["entrypoints"], [{"type": "statusline", "resourceUri": URI}])

        trees = []
        for reply in (active_read, fresh_read):
            resource, = reply["contents"]
            self.assertEqual((resource["uri"], resource["mimeType"]), (URI, "application/json"))
            trees.append(json.loads(resource["text"]))
        self.assertEqual(leaves(trees[0]), [
            "◐ Thinking", "Test Model", "high", "ctx", "▰▰▱▱▱", "37%", "5h", "▰▱▱▱▱", "17%",
            "7d", "▱▱▱▱▱", "0%", "⌂ observatory",
        ])
        self.assertEqual(leaves(trees[1]), ["○ Ready", "Other Model", "⌂ newproject"])
        self.assertEqual(trees[0]["children"][-3]["children"][-1]["props"]["color"], "yellow")
        self.assertEqual(trees[0]["children"][-2]["children"][-1]["props"]["color"], "red")


if __name__ == "__main__":
    unittest.main()
