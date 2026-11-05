"""Leave classifier-reviewed commands intact; otherwise use RTK's native hook."""

import json
import subprocess
import sys


def main():
    payload = sys.stdin.buffer.read()
    try:
        event = json.loads(payload)
    except (ValueError, UnicodeError):
        return 0
    # Plan can also use the auto classifier; unknown modes must not rewrite its input.
    if not isinstance(event, dict) or event.get("permission_mode") not in (
        "default", "acceptEdits", "dontAsk", "bypassPermissions"
    ):
        return 0
    try:
        return subprocess.run(["rtk", "hook", "claude"], input=payload).returncode
    except OSError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
