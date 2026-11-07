"""Read and maintain the shared model reference without loading Bridge."""

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

from . import (
    benchmarks,
    comparison,
    coverage,
    decision_context,
    inventory,
    policy,
    preferences,
    queries,
    reference,
    refresh,
    selection,
    shortlist,
)


def suggestions(args, context, routing):
    domains = routing["domains"]
    permitted = context.get("allowed_backends", decision_context.BACKENDS)
    backends = [args.backend] if args.backend else list(permitted)
    backends = [b for b in backends if b in permitted]
    results, failures = [], {}
    captured = benchmarks.snapshot() if backends else None
    try:
        observed_accounts = benchmarks.account_observation(None, None) if backends else {}
    except (OSError, ValueError, RuntimeError, KeyError):
        observed_accounts = {"profiles": {}, "quotas": [], "scope": "session binding unknown",
                             "errors": ["Account observation unavailable."]}

    def collect(backend):
        stage = "inventory"
        try:
            catalog = inventory.catalog(backend, args.account)
            model_count = len(catalog["models"])
            catalog = decision_context.restrict(catalog, context, args.choice)
            stage = "evidence"
            evidence = queries.search(domains, "" if args.choice else args.query, 1000, catalog,
                                      include_effort=True, complete=True, data=captured)
            result = selection.suggest(evidence, catalog, choice=args.choice, effort=args.effort,
                context=context, task=args.task, max_usd=args.max_usd, max_seconds=args.max_seconds)
            try:
                result["account_observation"] = benchmarks.account_observation(
                    backend, args.account, data=observed_accounts)
            except (OSError, ValueError, RuntimeError, KeyError):
                result["account_observation"] = {"profiles": {}, "quotas": [],
                    "scope": "session binding unknown", "errors": ["Account observation unavailable."]}
            result["inventory"] = {k: v for k, v in catalog.items() if k != "models"}
            result["inventory"]["native_model_count"] = model_count
            accounts = result["account_observation"].get("quotas", [])
            for option in result["options"]:
                names = {option["id"], *option["aliases"]}
                if backend != "opencode":
                    names.add(option["model"])
                option["allowance_links"] = [
                    {"account_index": index, "window_indices": matched}
                    for index, account in enumerate(accounts)
                    if (matched := [i for i, window in enumerate(account["windows"])
                                    if window.get("model_ids") is not None
                                    and names.intersection(window["model_ids"])])]
            result["allowance_link_scope"] = (
                "Reported exact native model membership only; empty links mean unknown, not no allowance. "
                "All windows remain in account_observation; selected-session account binding unverified.")
            return result, None
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            return None, {"stage": stage, "error": str(error)}

    with ThreadPoolExecutor(max_workers=4) as pool:
        for backend, (result, error) in zip(backends, pool.map(collect, backends)):
            if error is not None:
                failures[backend] = error
            else:
                results.append(result)
    result = selection.combine(results, failures, context=context, task=args.task, domains=domains)
    if args.choice and result["options"]:
        result["problems"] = [p for p in result["problems"] if "unavailable/ambiguous" not in p]
    if args.backend and args.backend not in permitted:
        result["problems"].append(args.backend + ": excluded by caller allowed_backends.")
    result["facets"] = selection.facets(result["options"])
    result["total_options"] = len(result["options"])
    result["comparison"] = comparison.portfolio(result)
    try:
        result["preferences"] = preferences.applicable(args.backend)
    except (OSError, ValueError, TypeError) as error:
        result["preferences"] = []
        result["problems"].append("Preferences unavailable: " + str(error))
    result["policy_evidence"] = policy.excerpts(backends, context=context, observations=result["backends"])
    result["choice"] = args.choice
    result["task_routing"] = routing
    if routing.get("note"):
        result["notes"].append(routing["note"])
    if not result["options"]:
        result["problems"].append("No admitted routes; check caller restrictions and discovery failures.")
    return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(prog="model-guide", description="Shared model selection reference.")
    commands = parser.add_subparsers(dest="command", required=True)
    pref = commands.add_parser("preferences", help="manage private, attributed model-selection notes")
    pref_commands = pref.add_subparsers(dest="action", required=True)
    pref_commands.add_parser("list", help="list all notes, including expired ones")
    add = pref_commands.add_parser("add", help="record a note; provenance is supplied by the caller")
    add.add_argument("--source", choices=("user", "agent"), required=True)
    add.add_argument("--note", required=True)
    add.add_argument("--backend", choices=decision_context.BACKENDS)
    for name in ("model", "account", "task", "reason"):
        add.add_argument("--" + name)
    add.add_argument("--expires", help="last applicable date, YYYY-MM-DD")
    remove = pref_commands.add_parser("remove", help="remove a note by its id")
    remove.add_argument("id")
    read = commands.add_parser("read", help="read only the reference needed for this task")
    read.add_argument("topic", choices=("models", "subscriptions", "sources", "maintenance"))
    compare = commands.add_parser("benchmarks", help="search benchmark evidence with local account context")
    suggest = commands.add_parser("suggest", help="task-relevant model/effort evidence for agent judgment",
        epilog=decision_context.HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    for command in (compare, suggest):
        command.add_argument("--domain", choices=benchmarks.DOMAINS, action="append",
                             help="evidence area chosen by the caller; repeat for multiple areas")
        command.add_argument("--task",
                             help="full task context; use --domain for task-specific evidence")
        command.add_argument("--query", default="",
                             help="model words/prefixes or native alias; task prose uses --task")
        command.add_argument("--backend", choices=decision_context.BACKENDS,
                             help="restrict native harness; suggest otherwise discovers all four")
        command.add_argument("--account", help="native account override (agy only)")
    compare.add_argument("--limit", type=int, choices=range(1, 21), default=5, metavar="1..20")
    compare.add_argument("--brief", action="store_true", help="compact evidence and native controls")
    compare.add_argument("--coverage", action="store_true", help="audit full source/config/harness coverage")
    suggest.add_argument("--json", action="store_true")
    suggest.add_argument("--choice", help="explicit user/project model choice; never substituted")
    suggest.add_argument("--effort", help="explicit effort for --choice")
    suggest.add_argument("--context", metavar="PATH|-", help="ephemeral caller JSON; schema below")
    suggest.add_argument("--limit", type=int, choices=range(1, 101), metavar="1..100",
                         help="page native inventory order, not a score-ranked shortlist")
    suggest.add_argument("--offset", type=int, default=0, help="page offset; requires --limit")
    suggest.add_argument("--max-usd", type=float, help="cap each source's published task/run cost")
    suggest.add_argument("--max-seconds", type=float,
                         help="cap each source's published response/run duration")
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
    policies = commands.add_parser("policy", help="official provider policy text; fetch missing/due cache")
    policies.add_argument("--backend", choices=decision_context.BACKENDS,
                          help="scope provider policy sources")
    policies.add_argument("--refresh", action="store_true",
                          help="force a conditional recheck; no account changes")
    policies.add_argument("--json", action="store_true",
                          help="full text and source/date/digest/error metadata")
    update = commands.add_parser("refresh", help="propose or explicitly review a reference update")
    action = update.add_mutually_exclusive_group()
    for flag in ("force", "poll", "prepare", "apply", "record", "discard"):
        action.add_argument("--" + flag, action="store_true")
    update.add_argument("--yes", action="store_true", help="confirm completed source review")
    args = parser.parse_args()
    try:
        if args.command == "preferences":
            if args.action == "list":
                print(json.dumps(preferences.read(), indent=2, ensure_ascii=False))
            elif args.action == "add":
                print(json.dumps(preferences.add(args), ensure_ascii=False))
            else:
                preferences.remove(args.id)
            return 0
        if args.command == "read":
            print((reference.GUIDES / (args.topic + ".md")).read_text().strip())
        elif args.command in ("benchmarks", "suggest"):
            if args.account and not args.backend:
                parser.error("--account requires --backend")
            if args.account and args.backend != "agy":
                parser.error("--account cannot establish native selectability here; use its native session")
            context = decision_context.read(args.context, sys.stdin) if args.command == "suggest" else {}
            routing = queries.resolve(args.domain, args.task)
            domains = routing["domains"]
            if args.command == "suggest":
                if args.offset < 0 or (args.offset and args.limit is None):
                    raise ValueError("nonnegative --offset requires --limit")
                if args.effort and not args.choice:
                    raise ValueError("--effort requires --choice")
                result = suggestions(args, context, routing)
                if args.json:
                    if args.limit is not None:
                        end = args.offset + args.limit
                        result["options"] = result["options"][args.offset:end]
                        result.pop("comparison", None)
                        result["continuation"] = end if end < result["total_options"] else None
                    print(json.dumps(result, indent=2))
                else:
                    print(selection.brief(result, limit=args.limit, offset=args.offset)
                          if args.choice or args.limit is not None else comparison.render(result))
                return 0
            catalog = inventory.catalog(args.backend, args.account) if args.backend else None
            if args.command == "benchmarks" and args.coverage:
                result = coverage.audit(benchmarks.snapshot(), catalog)
                print(coverage.audit_table(result) if args.brief else json.dumps(result, indent=2))
                return 0
            evidence = queries.search(domains, args.query, args.limit, catalog)
            accounts = benchmarks.account_observation(args.backend, args.account)
            for found in evidence.values():
                found["account_observation"] = accounts
                if args.task:
                    found["task"] = args.task
                if routing.get("note"):
                    found["warnings"].append(routing["note"])
            result = next(iter(evidence.values())) if len(evidence) == 1 else {"domains": evidence}
            print("\n\n".join(shortlist.brief(v) for v in evidence.values())
                  if args.brief else json.dumps(result, indent=2))
        elif args.command == "models":
            if args.json:
                print(json.dumps(coverage.summarize(inventory.catalog(args.backend, args.account),
                                                    benchmarks.snapshot()), indent=2))
            else:
                inventory.show(args.backend, args.account)
        elif args.command == "policy":
            records = policy.refresh_due([args.backend] if args.backend else None, force=args.refresh)
            print(json.dumps(records, indent=2) if args.json else policy.render(records))
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
