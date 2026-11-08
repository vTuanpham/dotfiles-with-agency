"""Record only the native main-agent effort from Claude's hook input."""

import json
import os
import sys


def main():
    try:
        event = json.load(sys.stdin)
        effort = event.get("effort")
        level = effort.get("level") if isinstance(effort, dict) else None
        session = event.get("session_id")
        if (event.get("agent_id") or level not in {"low", "medium", "high", "xhigh", "max"}
                or not isinstance(session, str) or not session):
            return
        line = json.dumps({"session": session, "effort": level}, separators=(",", ":")) + "\n"
        fd = os.open(sys.argv[1], os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, line.encode())
        finally:
            os.close(fd)
    except (OSError, ValueError, TypeError, AttributeError, IndexError):
        pass


if __name__ == "__main__":
    main()
