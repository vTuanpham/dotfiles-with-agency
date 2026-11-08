"""Compact comparison witnesses; published tradeoffs never become a model ranking."""

from collections import defaultdict

from . import coverage


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
                for k in ("backend", "id", "billing_route", "privacy_gate", "admission", "efforts", "aliases",
                          "allowance_links", "account_context")
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
            if (fact["domain"] in result["domains"] and fact["score"] is not None
                    and fact.get("meets_published_bounds", True)):
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
        if len({index for index, _ in values}) < 2:
            lenses["source evidence"].append((values[0][0], label + " evidence"))
            continue
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


def row_lines(model, domains, backends=None, *, summary_limit=2):
    from .selection import point, speed_brief

    routes = model["routes"]
    shown_routes = [r for r in routes if r["billing_route"] != "unverified" or r["backend"] != "opencode"
                    or r["admission"] == "caller allowed"]
    if not shown_routes:
        shown_routes = routes[:1]
    names = [
        r["backend"]
        + ":"
        + r["id"]
        + (" [" + r["billing_route"] + "]" if r["billing_route"] != "unverified" else "")
        for r in shown_routes
    ]
    lines = [
        "- "
        + model["model"]
        + " · "
        + "; ".join(names[:4])
        + (f" (+{len(shown_routes) - 4} routes)" if len(shown_routes) > 4 else "")
    ]
    if model.get("reasons"):
        reasons = [reason for reason in model["reasons"] if not reason.endswith(" / unverified")]
        if reasons:
            lines[0] += " · " + "; ".join(reasons[:2])
    controls = [r["backend"] + ":" + r["id"] + "=" +
                (",".join(r["efforts"]) if r.get("efforts") is not None else "unknown")
                for r in shown_routes]
    lines.append("  Native effort choices: " + "; ".join(controls[:4]))
    for route in shown_routes[:4]:
        context = route.get("account_context") or {}
        if context:
            lines.append("  " + route["backend"] + ":" + route["id"] + " · caller account context: "
                         + "; ".join(key + "=" + value for key, value in context.items()))
        observation = (backends or {}).get(route["backend"], {}).get("account_observation") or {}
        accounts = observation.get("quotas", [])
        for link in route.get("allowance_links") or []:
            account = accounts[link["account_index"]]
            for index in link["window_indices"]:
                window = account["windows"][index]
                value = window.get("remaining_percent")
                remaining = f"{value:g}% remaining" if value is not None else "remaining not reported"
                lines.append(f"  {route['backend']}:{route['id']} · {account['account']} "
                             f"{window['label']}: {remaining} · {account['freshness']}"
                             + (f" · resets {window['resets']}" if window.get("resets") else "")
                             + " (native model membership; session binding unverified)")
    groups = {}
    for fact in model["evidence"]:
        if (fact["domain"] in domains and fact["score"] is not None
                and fact.get("meets_published_bounds", True)):
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
        if facts[0].get("harness"):
            scope_label = "; ".join(v for v in (facts[0]["harness"], scope_label) if v)
        if facts[0].get("tasks") is not None:
            scope_label = "; ".join(v for v in (scope_label, f"tasks={facts[0]['tasks']}") if v)
        if facts[0].get("cost_basis") and any(f["cost"] is not None for f in facts):
            scope_label = "; ".join(v for v in (scope_label, f"$={facts[0]['cost_basis']}") if v)
        by_domain[domain].append((
            (scope[1:], tuple(settings)), domain
            + "/"
            + source
            + " "
            + metric
            + " "
            + "; ".join(settings)
            + (" [" + scope_label + "]" if scope_label else "")
        ))
    candidates = [values[0] for d in domains if (values := by_domain.get(d))]
    candidates += [value for d in domains for value in by_domain.get(d, [])[1:]]
    seen = set()
    summaries = []
    for key, value in candidates:
        if key not in seen:
            seen.add(key)
            summaries.append(value)
    lines.append("  " + ("; ".join(summaries[:summary_limit])
                         if summaries else "Task outcomes not measured."))
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
    # Include a measured middle native setting so extremes are not the only choices shown.
    levels = next((r["efforts"] for r in shown_routes if r.get("efforts")), [])
    measured_levels = [level for level in levels if any(
        f.get("effort") == level and f.get("speed") and any(
            (f["speed"].get(key) or 0) > 0 for key in (
                "median_time_to_first_token_seconds", "median_output_tokens_per_second"))
        for f in model["evidence"])]
    if len(measured_levels) > 2:
        middle = measured_levels[(len(measured_levels) - 1) // 2]
        fact = next(f for f in model["evidence"] if f.get("effort") == middle and f.get("speed")
                    and any((f["speed"].get(key) or 0) > 0 for key in (
                        "median_time_to_first_token_seconds", "median_output_tokens_per_second")))
        if fact not in speed_points:
            speed_points.append(fact)
    speed_points.sort(key=lambda fact: levels.index(fact.get("effort"))
                      if fact.get("effort") in levels else len(levels))
    if speed_points:
        summaries = []
        for fact in speed_points:
            values = {
                k: v for k, v in fact["speed"].items() if k.startswith("median_") and v is not None and v > 0
            }
            speed = fact["speed"]
            workload = speed.get("workload") or {}
            scope = ["provider " + str(speed.get("provider") or "unknown")]
            if isinstance(workload, dict):
                scope.extend(f"{key}={workload[key]}" for key in ("prompt_length", "parallel_queries")
                             if workload.get(key) is not None)
            summaries.append(
                (fact["effort"] or "effort ?") + ": " + speed_brief(values).removeprefix("legacy median ")
                + " [" + ", ".join(scope) + "]"
            )
        lines.append("  Source speed: " + "; ".join(summaries))
    return lines


def accounts(result):
    from .shortlist import account_lines

    lines = []
    for backend, info in result.get("backends", {}).items():
        observed = info.get("account_observation") or {}
        for line in account_lines(observed, compact=True, limit=6):
            lines.append(backend + ": " + line.removeprefix("Allowance: ")
                         if not observed.get("quotas") else line)
        lines.extend(backend + ": " + error for error in observed.get("errors", []))
    return lines


def render(result, *, limit=None, offset=0):
    from .selection import context_lines, important_notes, policy_lines

    data = (portfolio(result, size=offset + limit) if limit is not None
            else result.get("comparison") or portfolio(result))
    visible = data["visible"][offset:offset + limit] if limit is not None else data["visible"]
    routing = result.get("task_routing", {})
    focus = routing.get("focus_domains")
    lines = [
        "Compare for: " + (result.get("task") or "the current task"),
        ("Inferred focus: " + (", ".join(focus) if focus else "unclear")
         if focus is not None else "Evidence areas: " + ", ".join(result["domains"])),
    ]
    if result.get("retrieved"):
        lines.append("Evidence snapshot: " + result["retrieved"])
    if routing.get("note"):
        lines.append(routing["note"])
    lines.append(
        "Routes are catalog observations; caller-confirmed access and native worker controls take precedence."
    )
    lines.extend(context_lines(result.get("decision_context", {})))
    from .preferences import lines as preference_lines

    lines.extend(preference_lines(result.get("preferences", [])))
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
    lines.extend(important_notes(result.get("display_notes", result)))
    for backend, failure in result.get("inventory_failures", {}).items():
        message = backend + ": " + failure["stage"] + " unavailable; routes omitted (details in --json)"
        error = failure.get("error", "")
        hints = [hint for hint in ("native CLI could not write its state or logs",
                                   "native CLI could not open a local socket") if hint in error]
        if hints:
            message += "; " + "; ".join(hints)
        lines.append(message)
    for index in visible:
        lines.extend(row_lines(data["models"][index], result["domains"], result.get("backends"),
                               summary_limit=4 if focus is not None else 2))
    lines.extend(
        ["", "Observed account capacity (session binding requires native confirmation):", *accounts(result)]
    )
    lines.extend(policy_lines(result))
    lines.append(
        "Published scores, costs and times retain their source/run scope; "
        "API costs do not measure subscription use."
    )
    lines.append(
        f"{len(visible)}/{data['model_count']} model comparisons · {len(result['options'])} routes. "
        "Full evidence: --json; run details: --choice ROUTE."
    )
    end = offset + len(visible)
    if end < data["model_count"]:
        lines.append(f"Continue comparison: --limit {limit or 12} --offset {end}")
    return "".join(c for c in "\n".join(lines) if c.isprintable() or c in "\n\t")
