import argparse
import json
import subprocess
import sys
from dataclasses import asdict
from datetime import datetime, timezone

from . import providers, refresh


def main():
    parser = argparse.ArgumentParser(description="Account observations, independent of job state.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("snapshot", help="read cached account observations as JSON; no provider refresh")
    refresh_parser = commands.add_parser("refresh", help="query existing provider account allowance")
    refresh_parser.add_argument("--backend", choices=(*refresh.BACKENDS, "all"), default="agy")
    refresh_parser.add_argument("--account", help="one signed-in AGY account; omitted means all accounts")
    refresh_parser.add_argument("--if-stale", action="store_true",
                                help="refresh only due sources, coordinating concurrent readers")
    args = parser.parse_args()
    try:
        refresh_errors = []
        if args.command == "refresh":
            if args.account and args.backend != "agy":
                parser.error("--account selects one AGY account; omit it for other backends")
            refresh_errors = refresh.run(refresh.BACKENDS if args.backend == "all" else [args.backend],
                                         account=args.account, if_stale=args.if_stale)
        quotas, errors = providers.snapshot()
        quotas = refresh.annotate(quotas)
        errors += refresh.diagnostics()
        value = {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
                 "quotas": [asdict(row) for row in quotas], "errors": errors}
        print(json.dumps(value, allow_nan=False))
    except (OSError, ValueError, RuntimeError, TypeError, AttributeError,
            subprocess.SubprocessError) as error:
        print(f"agent-accounts: {type(error).__name__}", file=sys.stderr)
        return 1
    return int(args.command == "refresh" and not args.if_stale and bool(refresh_errors))


if __name__ == "__main__":
    sys.exit(main())
