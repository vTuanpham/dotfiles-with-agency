"""Exercise the native statusline payloads without touching live session state."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1] / "claude/.claude"
NOW = 1_000_000


def render(payload, subagent=False):
    script = ROOT / ("subagent_statusline.py" if subagent else "statusline.py")
    with tempfile.TemporaryDirectory() as home:
        result = subprocess.run(
            [sys.executable, "-c", "import runpy,sys,time; time.time=lambda:1000000; runpy.run_path(sys.argv[1])", str(script)],
            input=json.dumps(payload), text=True, capture_output=True, check=True,
            cwd=home, env={**os.environ, "HOME": home},
        ).stdout
    if subagent:
        result = json.loads(result)["content"]
    return re.sub(r"\x1b\[[0-9;]*m", "", result)


class StatuslineTests(unittest.TestCase):
    def test_native_cache_lifetimes_and_expiry(self):
        for ttl, left, text in (("1h", 2820, "47m"), ("5m", 120, "2m00s"), ("1h", -1, "cold")):
            with self.subTest(ttl=ttl, left=left):
                output = render({"prompt_cache": {"caching_observed": True, "warm": True,
                                "ttl": ttl, "expires_at": NOW + left}})
                self.assertIn("cache ", output)
                self.assertIn(text, output)

    def test_native_cache_cold_and_unreported(self):
        self.assertIn("cold", render({"prompt_cache": {
            "caching_observed": True, "warm": False, "ttl": "1h", "expires_at": None}}))
        for cache in (None, {}, {"caching_observed": False},
                      {"caching_observed": True, "warm": True, "ttl": "1h", "expires_at": True},
                      {"caching_observed": True, "warm": True, "ttl": "1h", "expires_at": None}):
            with self.subTest(cache=cache):
                self.assertNotIn("cache ", render({"prompt_cache": cache}))

    def test_zero_quota_and_effective_effort_are_visible(self):
        output = render({"effort": {"level": "xhigh"}, "rate_limits": {"five_hour": {"used_percentage": 0}}})
        self.assertIn("●●●●○", output)  # Wake's effort dots: four of the five levels lit, no word
        self.assertNotIn("xhigh", output)
        self.assertIn("turbo", render({"effort": {"level": "turbo"}}))  # a level off the scale keeps its word
        self.assertRegex(output, r"5h .* 0%")

    def test_subagent_tokens_before_model_resolution(self):
        task = {"id": "demo", "status": "running", "tokenCount": 12000}
        output = render({"tasks": [task]}, subagent=True)
        self.assertIn("12k", output)
        self.assertNotIn("%", output)
        task["contextWindowSize"] = 200000
        self.assertIn("12k 6%", render({"tasks": [task]}, subagent=True))


if __name__ == "__main__":
    unittest.main()
