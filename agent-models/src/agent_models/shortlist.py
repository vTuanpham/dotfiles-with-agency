"""Comparable quality/cost views and compact evidence output; no model recommendation."""

import math


def frontier(points):
    """Quality increases; cost decreases. Call separately for each comparable metric."""
    measured = [p for p in points if p["score"] is not None and p["cost"] is not None]
    return [point for point in measured if not any(
        other["score"] >= point["score"] and other["cost"] <= point["cost"]
        and (other["score"] > point["score"] or other["cost"] < point["cost"])
        for other in measured
    )]


def measurement(cell):
    if cell in ("", "-", "--", "—", "N/A"):
        return None
    value = float(cell.removeprefix("$").removesuffix("%").replace(",", ""))
    if not math.isfinite(value) or value < 0:
        raise ValueError("invalid table cost/score")
    return value


def human_duration(seconds):
    if seconds is None:
        return "Unverified"
    if not math.isfinite(seconds) or seconds < 0:
        raise ValueError("invalid duration")
    for scale, unit in ((86400, "d"), (3600, "h"), (60, "m"), (1, "s"), (0.001, "ms")):
        if seconds >= scale or unit == "ms":
            return f"{seconds / scale:.1f}".rstrip("0").rstrip(".") + unit


def table_views(headers, rows, limit):
    result = {"headers": headers, "rows": rows[:limit]}
    header = headers[0]
    score = next((header.index(name) for name in (
        "Score", "Accuracy", "Artificial Analysis Intelligence Index") if name in header), None)
    cost = next((header.index(name) for name in ("Cost / Test", "Cost per Task USD")
                 if name in header), None)
    if score is None or cost is None:
        return result
    harness = header.index("Harness") if "Harness" in header else None
    groups = {}
    for index, row in enumerate(rows):
        configuration = (row[harness] if harness is not None else
                         "fallback" if any(" with fallback)" in c for c in row) else "")
        groups.setdefault(configuration, []).append(
            {"row": index, "score": measurement(row[score]), "cost": measurement(row[cost])})
    efficient = [p for points in groups.values() for p in frontier(points)]
    efficient.sort(key=lambda p: (p["cost"], -p["score"]))
    result.update(efficient_rows=[rows[p["row"]] for p in efficient[:limit]],
                  efficient_matches=len(efficient),
                  frontier_scope="Matching candidates within this table, separately per harness; "
                                 f"higher score, lower {header[cost]}. Unknown measurements excluded.")
    return result


def brief(data):
    lines = [f"{data['domain']} · retrieved {data['retrieved']}"]
    lines += data.get("warnings", [])
    native = data.get("native_catalog")
    if native:
        lines.append(f"Native {native['backend']}: {native['matches']} matching routes; "
                     f"showing {len(native['models'])}")
        lines += [f"  {m['id']}" + (f" → {m['model']}" if m["id"] != m["model"] else "")
                  + f" · {m.get('effort_control', 'effort')}: "
                  + (", ".join(m["efforts"]) if m["efforts"] else "efforts unknown or unavailable")
                  + (f" · billing: {m['billing_route']} · privacy: {m['privacy_gate']}"
                     if m.get("billing_route") else "")
                  for m in native["models"]]
        lines += ["  " + m["identity_review"]["scope"] for m in native["models"] if m.get("identity_review")]
        if native["unmeasured_count"]:
            lines.append(f"Unmeasured native IDs: {native['unmeasured_count']} · "
                         + ", ".join(native["unmeasured_ids"]))
    for name, source in data["sources"].items():
        version = source.get("release", source.get("published",
                             ", ".join(dict.fromkeys(source.get("metadata", [])))))
        if source.get("version"):
            version = source["version"] + " · " + version
        lines += ["", f"{name} · {version}"]
        if source["status"] != "ok":
            lines.append("Unavailable: " + source["error"])
            continue
        lines.append(source.get("metric", source.get("metric_scope", "Published table metrics")))
        measured = source.get("measurements", [])
        for row in measured[:8]:
            score = "Unverified" if row["score"] is None else f"{row['score']:.4g}"
            cost = (f"{row['cost']:.4g} {row.get('cost_basis') or 'USD/run (' + row['cost_kind'] + ')'}"
                    if row["cost"] is not None else "cost Unverified")
            elapsed = (human_duration(row["seconds"]) + "/" + (row.get("time_basis") or "run")
                       if row["seconds"] is not None else "time Unverified")
            runs = row.get("n_runs")
            replicates = (f"mean of {runs} runs" if runs is not None else "run count Unverified")
            score_label = (f"bugs fixed {score}/105 ({replicates})"
                           if name == "Bug Hunt" else
                           f"{row['metric']}: {score} {row['unit']} ({row['direction']})")
            from . import harness
            scaffold = harness.note(row['harness'], (native or {}).get('backend'), row.get('harness_version'))
            lines.append(f"  {row['label']} ({row['effort'] or 'effort Unverified'}) · "
                         f"{score_label} · "
                         f"{cost} · {elapsed} · "
                         f"run {row['date'] or 'Unverified'} · {scaffold}")
        if len(measured) > 8:
            lines.append(f"Showing 8 of {len(measured)} measured cohorts; JSON retains each configuration.")
        if source.get("unverified_measurements"):
            lines.append(f"Unverified measurements: {source['unverified_measurements']} "
                         "(excluded from leaders)")
        for title, field in (("Quality", "results"), ("Efficient", "efficient_results")):
            rows = source.get(field, [])
            if not rows:
                continue
            lines.append(title + ":")
            for row in rows:
                if "usd_per_success" in row:
                    cost = row["usd_per_success"]
                    score = "Unverified" if row["score"] is None else f"{row['score']:.4g}"
                    lines.append(f"  {row['model']} ({row['effort'] or 'effort unknown'}) · "
                                 f"score {score} · "
                                 + (f"${cost:.4g}/success" if cost is not None else "cost unknown"))
                else:
                    score = "rating" if "rating" in row else "score"
                    low, high = (("rating_lower", "rating_upper") if score == "rating"
                                 else ("score_ci_lower", "score_ci_upper"))
                    lines.append(f"  {row['model_name']} · {row[score]:.2f} "
                                 f"[{row[low]:.2f}, {row[high]:.2f}] · rank {row['rank']}")
        for table in source.get("tables", []):
            lines.append(" | ".join(table["headers"][0]))
            for header in table["headers"][1:]:
                lines.append(" | ".join(header))
            for title, field in (("Quality", "rows"), ("Efficient", "efficient_rows")):
                if table.get(field):
                    lines.append(title + ":")
                    lines += ["  " + " | ".join(row) for row in table[field]]
            if "frontier_scope" in table:
                lines.append(table["frontier_scope"])
        trades = source.get("effort_tradeoffs", [])
        if trades:
            lines.append(f"Effort steps: {source['effort_tradeoff_matches']} · showing {len(trades)}")
        for trade in trades:
            fields = ("Artificial Analysis Intelligence Index", "Cost per Task USD", "Total Response (s)")
            before, after = trade["before"], trade["after"]
            values = " · ".join(f"{field}: {before[field]} → {after[field]}" for field in fields)
            lines.append(f"  {trade['model']} {trade['from']} → {trade['to']} "
                         f"({trade['configuration'] or 'published run'}) · {values}")
        if "frontier_scope" in source:
            lines.append(source["frontier_scope"])
        if source.get("limits"):
            lines.append(source["limits"])
        efficient = f" · efficient {source['efficient_matches']}" if "efficient_matches" in source else ""
        lines.append(f"Matches: {source['matches']}{efficient} · "
                     f"limit {source['limit_per_table']} per view/table")
        if "ambiguous_names" in source and source["ambiguous_names"]:
            lines.append("Separate evaluations share names: " + ", ".join(source["ambiguous_names"]))
        lines.append(source["url"])
    lines += account_lines(data.get("account_observation"))
    lines += ["", *data.get("coverage_notes", []), data["gaps"], "Full evidence: " + data["full_snapshot"]]
    return "\n".join("".join(c for c in line if c.isprintable()) for line in lines)


def account_lines(accounts, *, compact=False, limit=2):
    lines = []
    if accounts:
        if compact:
            for account in accounts["quotas"][:limit]:
                windows = "; ".join(w["label"] + "=" + (
                    "?" if w["remaining_percent"] is None else str(w["remaining_percent"]) + "%")
                    + (f"/{w['window_minutes']}m" if w.get("window_minutes") is not None else "")
                    + " reset " + (w["resets"] or "?")
                    + (" pool=" + w["pool_id"] if w.get("pool_id") else " pool=?")
                    + (" models=" + ",".join(w["model_ids"]) if w.get("model_ids") is not None
                       else " models=?") for w in account["windows"][:3])
                lines.append(f"Allowance: {account['backend']}/{account['account']} "
                             f"{account['freshness']} {windows} (cached; session binding unverified)")
                if len(account["windows"]) > 3:
                    lines.append(f"Allowance: +{len(account['windows']) - 3} source windows in --json")
            if len(accounts["quotas"]) > limit:
                lines.append(f"Allowance: +{len(accounts['quotas']) - limit} cached accounts in --json")
            if not accounts["quotas"]:
                lines.append("Allowance: no cached account observation; session binding unverified.")
            return lines
        lines += ["", "Accounts · " + accounts["scope"]]
        for backend, profile in accounts["profiles"].items():
            lines.append(f"  {backend}: " + ", ".join(f"{k}={v}" for k, v in profile.items()))
        for account in accounts["quotas"][:4]:
            windows = ", ".join(f"{w['group']} {w['label']}=".lstrip()
                                + ("?" if w["remaining_percent"] is None else f"{w['remaining_percent']}%")
                                + (f" reset {w['resets']}" if w["resets"] else "")
                                for w in account["windows"][:6])
            if len(account["windows"]) > 6:
                windows += f" · {len(account['windows']) - 6} more windows in JSON"
            flags = " · ".join(str(v) for v in (account["plan"], account["freshness"], account["status"],
                                               "active profile" if account["active"] else None) if v)
            lines.append(f"  {account['backend']}/{account['account']} · {flags} · {windows}")
        lines += accounts["errors"]
        if len(accounts["quotas"]) > 4:
            lines.append(f"  {len(accounts['quotas']) - 4} more account observations in JSON")
        if not accounts["quotas"] and not accounts["profiles"]:
            lines.append("  No cached account observation; native session binding Unverified.")
    return lines
