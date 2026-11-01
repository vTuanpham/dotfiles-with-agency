"""Read and maintain the shared model reference without loading Bridge."""

import argparse
import json
import os
import sys

from . import benchmarks, coverage, inventory, queries, reference, refresh, selection, shortlist


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(prog="model-guide", description="Shared model selection reference.")
    commands = parser.add_subparsers(dest="command", required=True)
    read = commands.add_parser("read", help="read only the reference needed for this task")
    read.add_argument("topic", choices=("models", "subscriptions", "sources", "maintenance"))
    compare = commands.add_parser("benchmarks", help="search benchmark evidence with local account context")
    suggest = commands.add_parser("suggest", help="explain a native shortlist; never automatically pick")
    for command in (compare, suggest):
        command.add_argument("--domain", choices=benchmarks.DOMAINS, action="append",
                             help="repeat for multiple domains; overrides task keyword routing")
        command.add_argument("--task", help="deterministic keyword routing; unknown tasks require --domain")
        command.add_argument("--query", default="", help="partial model name or current native alias")
        command.add_argument("--backend", choices=("codex", "claude", "agy", "opencode"),
                             required=command is suggest)
        command.add_argument("--account", help="native account override (agy only)")
    compare.add_argument("--limit", type=int, choices=range(1, 21), default=5, metavar="1..20")
    compare.add_argument("--brief", action="store_true", help="compact evidence and native controls")
    compare.add_argument("--coverage", action="store_true", help="audit full source/config/harness coverage")
    suggest.add_argument("--json", action="store_true")
    suggest.add_argument("--choice", help="explicit user/project model choice; never substituted")
    suggest.add_argument("--effort", help="explicit effort for --choice")
    suggest.add_argument("--allowance-pressure", action="store_true",
                         help="show efficient alternatives first; API costs are not subscription quota")
    suggest.add_argument("--max-usd", type=float, help="cap each source's published task/run cost")
    suggest.add_argument("--max-seconds", type=float,
                         help="cap each source's published response/run duration")
    suggest.add_argument("--min-class", choices=selection.CLASSES,
                         help="use reviewed positioning convention; unknown classes cannot meet a floor")
    for name in ("check", "stale"):
        suffix = " as JSON" if name == "check" else " and cache warnings"
        check = commands.add_parser(name, help="inspect reference drift" + suffix)
        check.add_argument("--live", action="store_true",
                           help="explicitly query signed-in native CLI inventories")
    models = commands.add_parser("models", help="list native CLI inventory; not account entitlement")
    models.add_argument("--backend", choices=("codex", "claude", "agy", "opencode"), required=True)
    models.add_argument("--account", help="existing agy account; otherwise current native profile")
    models.add_argument("--json", action="store_true",
                        help="native IDs/efforts and generated benchmark coverage")
    update = commands.add_parser("refresh", help="propose or explicitly review a reference update")
    action = update.add_mutually_exclusive_group()
    for flag in ("force", "poll", "prepare", "apply", "record", "discard"):
        action.add_argument("--" + flag, action="store_true")
    update.add_argument("--yes", action="store_true", help="confirm completed source review")
    args = parser.parse_args()
    try:
        if args.command == "read":
            print((reference.GUIDES / (args.topic + ".md")).read_text().strip())
        elif args.command in ("benchmarks", "suggest"):
            if args.account and not args.backend:
                parser.error("--account requires --backend")
            if args.account and args.backend != "agy":
                parser.error("--account cannot establish native selectability here; use its native session")
            catalog = inventory.catalog(args.backend, args.account) if args.backend else None
            if args.command == "benchmarks" and args.coverage:
                result = coverage.audit(benchmarks.snapshot(), catalog)
                print(coverage.audit_table(result) if args.brief else json.dumps(result, indent=2))
                return 0
            domains = queries.domains(args.domain, args.task)
            limit = args.limit if args.command == "benchmarks" else 1000
            evidence = queries.search(domains, args.query, limit, catalog,
                                      include_effort=args.command == "suggest")
            accounts = benchmarks.account_observation(args.backend, args.account)
            if args.command == "suggest":
                result = selection.suggest(evidence, catalog, choice=args.choice, effort=args.effort,
                    pressure=args.allowance_pressure, max_usd=args.max_usd, max_seconds=args.max_seconds,
                    minimum_class=args.min_class)
                result.update(domains=domains, retrieved=next(iter(evidence.values()))["retrieved"],
                              account_observation=accounts)
                print(json.dumps(result, indent=2) if args.json else selection.brief(result))
            else:
                for found in evidence.values():
                    found["account_observation"] = accounts
                result = next(iter(evidence.values())) if len(evidence) == 1 else {"domains": evidence}
                print("\n\n".join(shortlist.brief(v) for v in evidence.values())
                      if args.brief else json.dumps(result, indent=2))
        elif args.command == "models":
            if args.json:
                print(json.dumps(coverage.summarize(inventory.catalog(args.backend, args.account),
                                                    benchmarks.snapshot()), indent=2))
            else:
                inventory.show(args.backend, args.account)
        elif args.command == "check":
            print(json.dumps(reference.inspect(probe=args.live), indent=2))
        elif args.command == "stale":
            found = reference.check(probe=args.live)
            print("\n".join(found) if found else "the reference is current")
            return int(bool(found))
        elif args.prepare:
            print(benchmarks.prepare())
        elif args.apply:
            return refresh.apply(args.yes)
        elif args.record:
            return refresh.record(args.yes)
        elif args.discard:
            return refresh.discard()
        elif args.poll:
            return refresh.poll()
        else:
            return refresh.run(args.force)
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(f"model-guide: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
