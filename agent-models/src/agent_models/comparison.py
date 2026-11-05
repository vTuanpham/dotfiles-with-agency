"""Compact comparison witnesses; published tradeoffs never become a model ranking."""

from collections import defaultdict

from . import coverage
from .shortlist import human_duration


def models(options):
    grouped = {}
    for option in options:
        if option["admission"].startswith("excluded"):
            continue
        key = "/".join(coverage.benchmark_key(option))
        row = grouped.setdefault(
            key,
            {
                "key": key,
                "model": option.get("benchmark_model", option["model"]),
                "routes": [],
                "evidence": [],
                "reasons": [],
            },
        )
        row["routes"].append(
            {
                k: option.get(k)
                for k in ("backend", "id", "billing_route", "privacy_gate", "admission", "efforts", "aliases")
            }
        )
        for fact in option["evidence"]:
            same = {k: v for k, v in fact.items() if k not in ("harness_relation", "execution_scope")}
            if same not in row["evidence"]:
                row["evidence"].append(same)
    return list(grouped.values())


def cohort(row):
    return tuple(
        row.get(k)
        for k in (
            "domain",
            "source",
            "score_metric",
            "version",
            "release",
            "harness",
            "harness_version",
            "configuration",
            "hardware",
            "tasks",
            "cost_kind",
        )
    )


def witnesses(facts):
    """Keep measured points together within one source/run scope."""
    known = [f for f in facts if f["score"] is not None]
    if not known:
        return []
    quality = max(known, key=lambda f: f["score"] if f["direction"] == "higher" else -f["score"])
    result = [("observed quality", quality)]
    priced = [f for f in known if f["cost"] is not None and f.get("cost_kind") != "floor"]
    if priced:
        result.append(("published cost", min(priced, key=lambda f: f["cost"])))
        frontier = [
            f
            for f in priced
            if not any(
                g["cost"] <= f["cost"]
                and (g["score"] >= f["score"] if f["direction"] == "higher" else g["score"] <= f["score"])
                and (g["cost"] < f["cost"] or g["score"] != f["score"])
                for g in priced
            )
        ]
        frontier.sort(key=lambda f: f["cost"])
        if len(frontier) > 2:
            result.append(("intermediate tradeoff", frontier[len(frontier) // 2]))
    timed = [f for f in known if f["seconds"] is not None and f["seconds"] > 0]
    if timed:
        result.append(("published time", min(timed, key=lambda f: f["seconds"])))
    return result


def portfolio(result, *, size=12):
    """Cover different observed tradeoffs and routes without a combined preference score."""
    rows = models(result["options"])
    selected, views = [], defaultdict(list)
    session = result.get("decision_context", {}).get("session", {})

    def add(index, reason):
        if reason not in rows[index]["reasons"]:
            rows[index]["reasons"].append(reason)
        if index not in selected:
            selected.append(index)

    pools = defaultdict(list)
    for i, model in enumerate(rows):
        for route in model["routes"]:
            if session.get("model") in (route["id"], *route.get("aliases", [])) and (
                session.get("backend") == route["backend"]
            ):
                add(i, "current session")
            pools[
                (route["backend"], route["billing_route"], route["privacy_gate"], route["admission"])
            ].append(i)
        for fact in model["evidence"]:
            if fact["domain"] in result["domains"] and fact["score"] is not None:
                views[cohort(fact)].append((i, fact))

    # Different routes remain visible even when a source has no outcome for them.
    for pool, indices in pools.items():
        candidates = sorted(
            set(indices),
            key=lambda i: (
                -len(
                    {
                        f["domain"]
                        for f in rows[i]["evidence"]
                        if f["domain"] in result["domains"] and f["score"] is not None
                    }
                ),
                i,
            ),
        )
        if pool[3] == "caller allowed" or any(
            f["domain"] in result["domains"] and f["score"] is not None
            for f in rows[candidates[0]]["evidence"]
        ):
            add(candidates[0], f"{pool[0]} / {pool[1]}")
    lenses = defaultdict(list)
    for scope, values in views.items():
        label = scope[0] + "/" + scope[1]
        owners = {id(f): i for i, f in values}
        for reason, fact in witnesses([f for _, f in values]):
            lenses[reason].append((owners[id(fact)], label + " " + reason))
    # Round-robin lenses keep one benchmark or dimension from consuming the brief.
    for position in range(max(map(len, lenses.values()), default=0)):
        for lens in lenses.values():
            if position < len(lens):
                add(*lens[position])
    selected.extend(i for i in range(len(rows)) if i not in selected)
    visible = [rows[i] for i in selected[:size]]
    return {
        "models": visible,
        "visible": list(range(len(visible))),
        "model_count": len(rows),
        "method": "source-scoped comparison witnesses; no model preference rank",
    }


def row_lines(model, domains):
    from .selection import point, speed_brief

    routes = model["routes"]
    names = [
        r["backend"]
        + ":"
        + r["id"]
        + (" [" + r["billing_route"] + "]" if r["billing_route"] != "unverified" else "")
        for r in routes
        if r["billing_route"] != "unverified" or r["backend"] != "opencode"
    ]
    if not names:
        names = [routes[0]["backend"] + ":" + routes[0]["id"]]
    lines = [
        "- "
        + model["model"]
        + " · "
        + "; ".join(names[:4])
        + (f" (+{len(routes) - 4} routes)" if len(routes) > 4 else "")
    ]
    groups = {}
    for fact in model["evidence"]:
        if fact["domain"] in domains and fact["score"] is not None:
            groups.setdefault(cohort(fact), []).append(fact)
    by_domain = defaultdict(list)
    for scope, facts in groups.items():
        domain, source, metric = scope[:3]
        chosen = []
        for _, fact in witnesses(facts):
            if fact not in chosen:
                chosen.append(fact)
        counts = {f.get("n_runs") for f in facts}
        settings = [
            point(fact)
            + (
                " / cost unavailable"
                if fact["cost"] is None and any(f["cost"] is not None for f in facts)
                else ""
            )
            + (f" [n={fact['n_runs']}]" if len(counts) > 1 and fact.get("n_runs") is not None else "")
            for fact in chosen
        ]
        run = facts[0].get("harness_version")
        sample = next(iter(counts)) if len(counts) == 1 else None
        scope_label = "; ".join(v for v in (run, f"n={sample}" if sample is not None else None) if v)
        by_domain[domain].append(
            domain
            + "/"
            + source
            + " "
            + metric
            + " "
            + "; ".join(settings)
            + (" [" + scope_label + "]" if scope_label else "")
        )
    summaries = [values[0] for d in domains if (values := by_domain.get(d))]
    summaries += [value for d in domains for value in by_domain.get(d, [])[1:]]
    lines.append("  " + ("; ".join(summaries[:2]) if summaries else "Task outcomes not measured."))
    speed_points = []
    for key, reverse in (
        ("median_time_to_first_token_seconds", False),
        ("median_output_tokens_per_second", True),
    ):
        known = [
            f
            for f in model["evidence"]
            if f.get("speed") and (v := f["speed"].get(key)) is not None and v > 0
        ]
        if known:
            fact = sorted(known, key=lambda f: f["speed"][key], reverse=reverse)[0]
            if fact not in speed_points:
                speed_points.append(fact)
    if speed_points:
        summaries = []
        for fact in speed_points:
            values = {
                k: v for k, v in fact["speed"].items() if k.startswith("median_") and v is not None and v > 0
            }
            summaries.append(
                (fact["effort"] or "effort ?") + ": " + speed_brief(values).removeprefix("legacy median ")
            )
        lines.append("  Source speed: " + "; ".join(summaries) + " · provider/workload in --json")
    return lines


def accounts(result):
    lines = []
    for backend, info in result.get("backends", {}).items():
        observed = info.get("account_observation") or {}
        for account in observed.get("quotas", [])[:2]:
            windows = []
            for window in account["windows"]:
                period = (
                    human_duration(window["window_minutes"] * 60)
                    if window.get("window_minutes")
                    else window["label"]
                )
                if window.get("group"):
                    period = window["group"] + " " + period
                value = window["remaining_percent"]
                windows.append(period + " " + (f"{value:g}%" if value is not None else "reading unavailable"))
            lines.append(
                backend
                + "/"
                + account["account"]
                + " "
                + account.get("freshness", "")
                + ": "
                + ", ".join(windows)
                + (" · " + account["plan"] if account.get("plan") else "")
            )
    return lines


def render(result):
    from .selection import context_lines, important_notes, policy_lines

    data = result.get("comparison") or portfolio(result)
    lines = [
        "Compare for: " + (result.get("task") or "the current task"),
        "Evidence areas: " + ", ".join(result["domains"]),
    ]
    if result.get("retrieved"):
        lines.append("Evidence snapshot: " + result["retrieved"])
    routing = result.get("task_routing", {})
    if routing.get("note"):
        lines.append(routing["note"])
    lines.append(
        "Routes are catalog observations; caller-confirmed access and native worker controls take precedence."
    )
    lines.extend(context_lines(result.get("decision_context", {})))
    session = result.get("decision_context", {}).get("session", {})
    if session.get("model"):
        lines.append(
            "Current session: "
            + session.get("backend", "")
            + ":"
            + session["model"]
            + " · continuing here is an option"
        )
    lines.extend(result.get("problems", []))
    lines.extend(important_notes(result))
    for backend, failure in result.get("inventory_failures", {}).items():
        lines.append(backend + ": " + failure["stage"] + " unavailable")
    for index in data["visible"]:
        lines.extend(row_lines(data["models"][index], result["domains"]))
    lines.extend(
        ["", "Observed account capacity (session binding requires native confirmation):", *accounts(result)]
    )
    lines.extend(policy_lines(result))
    lines.append(
        "Published scores, costs and times retain their source/run scope; "
        "API costs do not measure subscription use."
    )
    lines.append(
        f"{len(data['visible'])}/{data['model_count']} model comparisons · {len(result['options'])} routes. "
        "Full evidence: --json; run details: --choice ROUTE; "
        "all routes: --limit 12 --offset 0."
    )
    return "".join(c for c in "\n".join(lines) if c.isprintable() or c in "\n\t")
