"""Run one OpenCode server and client inside the worker's existing sandbox and scope."""

import json
import select
import subprocess
import sys
import threading
from urllib.parse import urlsplit


def main():
    binary, *args = sys.argv[1:]
    server = subprocess.Popen([binary, "serve", "--stdio", "--port", "0"],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr.buffer)
    client = None
    try:
        ready, _, _ = select.select([server.stdout], [], [], 15)
        if not ready:
            raise RuntimeError("OpenCode worker server did not become ready")
        line = server.stdout.readline(65537)
        if len(line) > 65536:
            raise RuntimeError("OpenCode worker server response is too large")
        value = json.loads(line)
        url = value["url"]
        parsed = urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
                or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("OpenCode worker server did not bind to loopback")
        print(json.dumps({"bridge_server": url}), flush=True)
        def drain():
            while server.stdout.read(8192):
                pass

        threading.Thread(target=drain, daemon=True).start()
        if args == ["--server-only"]:
            sys.stdin.buffer.read(1)
            return 0
        client = subprocess.Popen([binary, "run", "--server", url, *args],
                                  stdin=sys.stdin.buffer, stdout=sys.stdout.buffer, stderr=sys.stderr.buffer)
        return client.wait()
    finally:
        if client is not None and client.poll() is None:
            client.terminate()
            try:
                client.wait(timeout=5)
            except subprocess.TimeoutExpired:
                client.kill()
                client.wait(timeout=5)
        try:
            server.stdin.close()
        except BrokenPipeError:
            pass
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"OpenCode worker server failed: {error}", file=sys.stderr)
        sys.exit(1)
