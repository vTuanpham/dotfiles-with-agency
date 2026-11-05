"""Task-scoped evidence for the selecting agent; no model or effort ranking."""

import json
import re
from collections import Counter

from . import benchmarks, coverage, decision_context, harness
from .shortlist import account_lines, human_duration, measurement


def duration(value):
    if value in ("", "-", "--", "—", "N/A"):
        return None
    match = re.fullmatch(r"(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?", value)
    if not match or not any(match.groups()):
        return None
    return sum(float(v) * scale for v, scale in zip(match.groups(), (3600, 60, 1)) if v)


def observations(domain, name, source):
    """Retain source metric/cost definitions and every returned effort/configuration."""
    domain = source.get("evidence_domain", domain)
    for row in source.get("measurements", []):
        yield {**row, "score_metric": f"{row['metric']} [{row['unit']}]",
               "group": (domain, name, row["metric"], row["unit"], row["harness"],
                         row.get("configuration"), row["cost_kind"])}
    if name == "LiveBench":
        for row in source.get("results", []):
            yield {"model": row["model"], "effort": row["effort"], "score": row["score"],
                   "cost": row["usd_per_success"], "seconds": None, "direction": "higher",
                   "cost_basis": "estimated USD/success",
                   "group": (domain, name, source["metric"], "estimated USD/success")}
    elif name.startswith("Arena/"):
        for row in source.get("results", []):
            score, low, high = (("score", "score_ci_lower", "score_ci_upper") if "score" in row
                                else ("rating", "rating_lower", "rating_upper"))
            yield {"model": row["model_name"], "effort": coverage.setting(row["model_name"]),
                   "score": row[score], "low": row[low], "high": row[high], "cost": None,
                   "seconds": None, "direction": "higher", "group": (domain, name, score)}
    elif name != "Vals Index" or domain == "overall":
        for table in source.get("tables", []):
            header = table["headers"][0]
            metric = next((h for h in ("Accuracy", "Score", "Artificial Analysis Intelligence Index")
                           if h in header), None)
            if metric is None:
                continue
            model = next(i for i, h in enumerate(header) if h in ("Model", "Models"))
            for row in table["rows"]:
                cost = next((measurement(row[header.index(h)]) for h in ("Cost / Test", "Cost per Task USD")
                             if h in header), None)
                seconds = (duration(row[header.index("Duration / Test")]) if "Duration / Test" in header
                           else measurement(row[header.index("Total Response (s)")])
                           if "Total Response (s)" in header else None)
                scaffold = next((row[header.index(h)] for h in ("Harness", "Agent", "Scaffold")
                                 if h in header), None)
                yield {"model": row[model], "effort": coverage.setting(row[model]),
                       "score": measurement(row[header.index(metric)]), "cost": cost,
                       "seconds": seconds, "direction": "higher", "harness": scaffold,
                       "cost_basis": "USD/test" if "Cost / Test" in header else "USD/task",
                       "group": (domain, name, metric, scaffold,
                                 "fallback" if " with fallback)" in row[model] else None)}


def fact(row, source, retrieved, backend):
    result = {"domain": row["group"][0], "source": row["group"][1],
              "score_metric": row.get("score_metric", row["group"][2]),
              "score": row["score"], "direction": row["direction"], "cost": row["cost"],
              "seconds": row["seconds"], "effort": coverage.setting(row["model"], row["effort"])}
    result.update({key: row.get(key) for key in (
        "harness", "harness_version", "n_runs", "tasks", "low", "high", "date", "configuration",
        "hardware", "source_id", "speed", "caveat", "cost_kind", "model_metadata")})
    result.update(url=source.get("url"), version=source.get("version"),
                  release=source.get("release", source.get("published")),
                  retrieved=source.get("retrieved", retrieved))
    result["cost_basis"] = row.get("cost_basis") or (
        f"USD/published run ({row['cost_kind']})" if row.get("cost_kind") else None)
    result["time_basis"] = row.get("time_basis") or (
        "published run" if "tasks" in row else "response" if result["source"] == "Artificial Analysis"
        else "test")
    result["harness_relation"] = harness.native(row.get("harness"), backend)
    result["execution_scope"] = "Published source run; selected-route cost, latency and reliability unknown."
    return result


def route_context(model):
    return {"efforts": model["efforts"], "listing_tier": model.get("listing_tier", "unverified"),
            "billing_route": model.get("billing_route", "unverified"),
            "privacy_gate": model.get("privacy_gate", "unverified"),
            **{key: model[key] for key in (
                "benchmark_model", "identity_review", "input_modalities", "description") if key in model}}


def meets(row, max_usd, max_seconds):
    return ((max_usd is None or (row["cost"] is not None and row["cost_kind"] != "floor"
                                and row["cost"] <= max_usd))
            and (max_seconds is None or (row["seconds"] is not None and row["seconds"] <= max_seconds)))


def suggest(evidence, catalog, *, choice=None, effort=None, context=None, task=None,
            max_usd=None, max_seconds=None):
    """All admitted native routes and observations, including interior efforts and unknowns."""
    context = decision_context.validate({} if context is None else context)
    for value in (max_usd, max_seconds):
        if value is not None:
            measurement(str(value))
    if effort and not choice:
        raise ValueError("--effort requires an explicit --choice")
    backend = catalog["backend"]
    models = coverage.canonical_catalog(catalog, choice)["models"]
    problems, notes, options, sources = [], [], [], {}
    if choice:
        models = [m for m in models if decision_context.bound(m, choice, backend)]
        if len(models) != 1:
            problems.append("Explicit choice excluded by caller allowed_routes; no substitution."
                            if catalog.get("choice_excluded_by_context") else
                            "Explicit choice unavailable/ambiguous; no substitution.")
            models = []
    query = next(iter(evidence.values())).get("query", "")
    if query and not choice:
        models = [m for m in models if any(coverage.query_matches(query, value)
                  for value in (m["id"], m["model"], *m.get("aliases", [])))]
    permitted = context.get("allowed_backends", decision_context.BACKENDS)
    if backend not in permitted:
        models = []
        problems.append(backend + ": excluded by caller allowed_backends.")
    admitted = [decision_context.admit(m, backend, context) for m in models]
    locally_excluded = sum(m is None for m in admitted)
    excluded = locally_excluded + catalog.get("excluded_by_context", 0)
    models = [m for m in admitted if m is not None]
    if choice and locally_excluded:
        problems.append("Explicit choice excluded by caller allowed_routes; no substitution.")
    indexed = {}
    for domain, found in evidence.items():
        notes.extend(found.get("warnings", []))
        notes.extend(found.get("coverage_notes", []))
        for name, source in found["sources"].items():
            sources[domain + "/" + name] = {key: source.get(key) for key in
                ("status", "url", "version", "release", "published", "retrieved", "limits", "error")}
            if source["status"] != "ok":
                notes.append(domain + "/" + name + ": source unavailable; model ability unknown.")
                continue
            for row in observations(domain, name, source):
                item = fact(row, source, found["retrieved"], backend)
                for key in {coverage.model_key(row["model"]), coverage.key(row["model"].rsplit("/", 1)[-1])}:
                    indexed.setdefault(key, []).append((row, item))
    for model in models:
        option = {"backend": backend, "id": model["id"], "model": model["model"],
                  **route_context(model), "native_efforts": model["native_efforts"],
                  "aliases": model.get("aliases", []), "admission": model["admission"],
                  "effort_restriction": model["effort_restriction"], "requested_effort": effort,
                  "account_context": context.get("accounts", {}).get(backend, {}),
                  "evidence": [], "problems": []}
        if model["efforts"] == []:
            option["admission"] = "excluded: no permitted native effort"
        if effort and (model["efforts"] is None or effort not in model["efforts"]):
            option["problems"].append("Explicit effort unsupported or controls unknown; no substitution.")
            option["admission"] = "excluded: requested effort not established"
        if model["efforts"] is None:
            option["problems"].append("Native effort controls unknown.")
        for row, item in indexed.get(coverage.benchmark_key(model), []):
            if coverage.supported(model, row["model"], row["effort"]) is False:
                continue
            if effort and coverage.setting(row["model"], row["effort"]) != effort.casefold():
                continue
            if item not in option["evidence"]:
                option["evidence"].append(dict(item))
        option["coverage"] = {d: sum(r["domain"] == d and r["score"] is not None
                                    for r in option["evidence"]) for d in evidence}
        option["measured_efforts"] = list(dict.fromkeys(r["effort"] for r in option["evidence"]
                                                       if r["effort"] is not None))
        if max_usd is not None or max_seconds is not None:
            for row in option["evidence"]:
                row["meets_published_bounds"] = meets(row, max_usd, max_seconds)
            if not any(r["meets_published_bounds"] for r in option["evidence"]):
                excluded += 1
                if not choice:
                    continue
                option["problems"].append(
                    "Choice does not establish published bounds; retained, no substitution.")
                option["admission"] = "excluded: published bounds not established"
        if option["admission"].startswith("excluded") and not choice:
            excluded += 1
            continue
        options.append(option)
    if max_usd is not None or max_seconds is not None:
        notes.append("Bounds apply only to each published source run, not actual route cost or task latency.")
    first = next(iter(evidence.values()))
    return {"backend": backend, "options": options, "excluded_count": excluded, "task": task,
            "decision_context": context, "choice": choice, "query": query,
            "constraints": {"max_usd": max_usd, "max_seconds": max_seconds},
            "domains": list(evidence), "retrieved": first["retrieved"], "review": first.get("review"),
            "sources": sources, "problems": problems, "notes": list(dict.fromkeys(notes))}


def combine(results, failures, *, context, task, domains):
    return {"options": [o for r in results for o in r["options"]],
            "backends": {r["backend"]: {k: v for k, v in r.items() if k not in (
                "options", "decision_context", "task", "domains")} for r in results},
            "inventory_failures": failures, "decision_context": context, "task": task,
            "domains": domains, "retrieved": results[0]["retrieved"] if results else None,
            "review": results[0].get("review") if results else None,
            "notes": list(dict.fromkeys(n for r in results for n in r["notes"])),
            "problems": [p for r in results for p in r["problems"]]}


def facets(options):
    result = {}
    for backend in decision_context.BACKENDS:
        rows = [o for o in options if o["backend"] == backend]
        if rows:
            result[backend] = {"routes": len(rows),
                "caller_allowed": sum(o["admission"] == "caller allowed" for o in rows),
                "with_task_evidence": sum(any(o["coverage"].values()) for o in rows),
                "billing": dict(Counter(o["billing_route"] for o in rows)),
                "domains": dict(Counter(d for o in rows for d, n in o["coverage"].items() if n))}
    return result


def important_notes(result):
    markers = ("unavailable", "stale", "absent", "vision measures", "browser/osworld", "bounds apply")
    return list(dict.fromkeys(n for n in result.get("notes", [])
                             if any(word in n.casefold() for word in markers)))[:4]


def policy_lines(result):
    lines = []
    policy_rows = result.get("policy_evidence", [])
    for backend in dict.fromkeys(row["backend"] for row in policy_rows):
        rows = [row for row in policy_rows if row["backend"] == backend]
        status = ", ".join(dict.fromkeys(row["status"] for row in rows))
        checked = [row["checked_at"][:10] for row in rows if row.get("checked_at")]
        lines.append("Policy / " + backend + ": " + status
                     + (" · checked " + min(checked) if checked else "")
                     + " · " + rows[0]["read"])
    return lines


def speed_brief(speed):
    if not speed:
        return ""
    values = []
    for key, label in (("median_output_tokens_per_second", "tokens/s"),
                       ("median_time_to_first_token_seconds", "s TTFT")):
        value = speed.get(key)
        if value is not None:
            values.append(f"{value:.4g} {label}" + (" (reported 0; validity unknown)" if value == 0 else ""))
    return "legacy median " + ", ".join(values) if values else "speed unknown"


def point(row):
    score = "?" if row["score"] is None else f"{row['score']:.4g}"
    result = (row["effort"] or "effort ?") + "=" + score
    if row.get("low") is not None:
        result += f" [{row['low']:.4g}, {row['high']:.4g}]"
    if row["cost"] is not None:
        result += f" / source {'≥' if row.get('cost_kind') == 'floor' else ''}${row['cost']:.4g}"
    if row["seconds"] is not None and row["seconds"] > 0:
        result += " / " + human_duration(row["seconds"])
    return result


def configuration_brief(value):
    prefix, separator, payload = value.partition(":")
    if not separator:
        return value
    try:
        fields = json.loads(payload)
    except ValueError:
        return value
    if type(fields) is not dict:
        return value
    known = [key + "=" + json.dumps(v, separators=(",", ":"))
             for key, v in fields.items() if v is not None]
    unknown = [key for key, v in fields.items() if v is None]
    return prefix + " {" + ",".join(known) + "}" + ("; null=" + ",".join(unknown) if unknown else "")


def evidence_lines(option):
    groups, speeds = {}, {}
    for row in option["evidence"]:
        if row["speed"]:
            speed = row["speed"]
            scope = (row["source"], row["version"], row["harness"], row["harness_version"],
                     row["configuration"], speed.get("provider"),
                     json.dumps(speed.get("workload"), sort_keys=True), speed.get("methodology_version"))
            speeds.setdefault(scope, []).append(row)
        if row["source"] == "Artificial Analysis" and row["domain"] not in option["coverage"]:
            continue
        if row["source"].startswith("Arena/") and row["source"][6:] not in benchmarks.ARENA_DECISION_VIEWS:
            continue
        scope = (row["domain"], row["source"], row["score_metric"], row["harness"],
                 row["harness_version"], row["configuration"], row["hardware"], row["cost_basis"],
                 row["time_basis"], row["tasks"], row["n_runs"], row["version"])
        groups.setdefault(scope, []).append(row)
    lines = []
    primary, extra, seen = [], [], set()
    for scope, rows in groups.items():
        pair = scope[:2]
        (extra if pair in seen else primary).append((scope, rows))
        seen.add(pair)
    shown = primary + extra[:2]
    for scope, rows in shown:
        domain, source, metric = scope[:3]
        row = rows[0]
        context = harness.note(row["harness"], option["backend"], row["harness_version"])
        if row["configuration"]:
            context += " · " + configuration_brief(row["configuration"])
        if row["n_runs"] is not None:
            context += f" · n={row['n_runs']}"
        if row["tasks"] is not None:
            context += f" · tasks={row['tasks']}"
        basis = ("; $=" + str(row["cost_basis"]) if any(r["cost"] is not None for r in rows) else "")
        basis += ("; time=" + str(row["time_basis"]) if any(r["seconds"] is not None for r in rows) else "")
        lines.append(f"  {domain}/{source} {metric}: " + "; ".join(point(r) for r in rows)
                     + basis + " · " + context)
    if len(groups) > len(shown):
        lines.append(f"  +{len(groups) - len(shown)} scoped evidence groups in --json")
    for scope, rows in speeds.items():
        speed = rows[0]["speed"]
        context = ("provider " + str(speed.get("provider") or "unknown")
                   + " · workload " + json.dumps(speed.get("workload"), separators=(",", ":")))
        values = list(dict.fromkeys((row["effort"] or "effort ?") + ": "
                      + speed_brief(row["speed"]).removeprefix("legacy median ") for row in rows))
        lines.append("  Source speed / " + scope[0] + " · legacy median · " + context
                     + ": " + "; ".join(values))
    return lines


def context_lines(context):
    lines = []
    for label in ("task", "session"):
        if context.get(label):
            lines.append(label.capitalize() + " context: " + "; ".join(
                key + "=" + value for key, value in context[label].items()))
    for backend, values in context.get("accounts", {}).items():
        lines.append(backend + " account (caller): " + "; ".join(
            key + "=" + value for key, value in values.items()))
    if "allowed_backends" in context:
        lines.append("Allowed harnesses: " + (", ".join(context["allowed_backends"]) or "none"))
    if context.get("priorities"):
        lines.append("Priorities: " + "; ".join(context["priorities"]))
    return lines


def brief(result, *, limit=None, offset=0):
    options = result["options"]
    lines = ["Decision evidence · " + ", ".join(result.get("domains", []))]
    if result.get("task"):
        lines.append("Task: " + result["task"])
    context = result.get("decision_context", {})
    if context:
        lines.extend(context_lines(context))
    lines.extend(result["problems"])
    for backend, error in result.get("inventory_failures", {}).items():
        lines.append(backend + ": " + error["stage"] + " unavailable (" + error["error"]
                     + "); access/ability unknown.")
    for backend, info in facets(options).items():
        lines.append(f"{backend}: {info['routes']} routes · {info['caller_allowed']} caller allowed · "
                     f"{info['with_task_evidence']} with task observations · billing "
                     + ", ".join(f"{k}:{v}" for k, v in info["billing"].items()))
    lines.append("Published runs do not estimate selected-route spend, latency, reliability "
                 "or subscription consumption.")
    if limit is not None:
        visible = options[offset:offset + limit]
        lines.append(f"Inventory-order page {offset}:{offset + len(visible)} of {len(options)}; no ranking.")
        if offset + len(visible) < len(options):
            lines.append(f"Continue: --limit {limit} --offset {offset + len(visible)}")
    elif len(options) <= 24:
        visible = options
    else:
        known = [o for o in options if o["admission"] == "caller allowed"]
        visible = known if len(known) <= 24 else []
        lines.append("Broad inventory: narrow with --backend / --query WORDS, "
                     "or page --limit 12 --offset 0; --json retains every candidate and observation.")
    for option in visible:
        controls = ",".join(option["efforts"]) if option["efforts"] is not None else "unknown"
        lines.append(f"- {option['backend']}:{option['id']} · {option['admission']} "
                     f"· efforts {controls}")
        if option["billing_route"] != "unverified" or option["privacy_gate"] != "unverified":
            lines.append(f"  billing {option['billing_route']} · privacy {option['privacy_gate']}")
        if option.get("input_modalities"):
            lines.append("  input " + "/".join(option["input_modalities"]))
        if option.get("description"):
            lines.append("  Native description: " + option["description"])
        releases = list(dict.fromkeys(
            r["model_metadata"]["release_date"] for r in option["evidence"]
            if r["model_metadata"] and r["model_metadata"].get("release_date")))
        if releases:
            lines.append("  Model release date (AA): " + ", ".join(releases))
        if option.get("benchmark_model"):
            lines.append("  Model evidence link: " + option["benchmark_model"]
                         + "; route performance unknown.")
        lines.extend(evidence_lines(option))
        missing = [d for d, count in option["coverage"].items() if not count]
        if missing:
            lines.append("  Task outcomes unknown: " + ", ".join(missing))
        lines.extend("  " + p for p in option["problems"])
    for backend, state in result.get("backends", {}).items():
        lines.extend("Cached accounts / " + backend + ": " + line.removeprefix("Allowance: ")
                     for line in account_lines(state.get("account_observation"), compact=True))
    if "account_observation" in result:
        lines.extend(account_lines(result["account_observation"], compact=True))
    lines.extend(important_notes(result))
    lines.extend(policy_lines(result))
    review = result.get("review") or {}
    lines.append("Snapshot " + str(result.get("retrieved") or "unknown")
                 + (" · " + review["status"] if review else "")
                 + " · details: --json (source/version, run scope, missing data); suggest --help (context).")
    return "\n".join("".join(c for c in line if c.isprintable()) for line in lines)
