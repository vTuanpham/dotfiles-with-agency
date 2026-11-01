"""Measured effort trade-offs; the policy is explicit and never extrapolates a level."""

from . import coverage, harness
from .shortlist import frontier


def percentage(value):
    return f"{value:.1%}".replace(".0%", "%")


def knee(rows, scope, model, *, max_usd=None, max_seconds=None):
    measured = []
    for row in rows:
        setting = coverage.setting(row["model"], row["effort"])
        if (row["score"] is None or row["cost"] is None or
                coverage.supported(model, row["model"], row["effort"]) is not True):
            continue
        if max_usd is not None and row["cost"] > max_usd:
            continue
        if max_seconds is not None and (row.get("seconds") is None or row["seconds"] > max_seconds):
            continue
        measured.append({**row, "effort": next(v for v in model["efforts"] if v.casefold() == setting)})
    if len({r["effort"] for r in measured}) < 2:
        return None
    higher = measured[0]["direction"] == "higher"
    best_score = (max if higher else min)(r["score"] for r in measured)
    if best_score <= 0:
        return None
    best = min((r for r in measured if r["score"] == best_score), key=lambda r: r["cost"])
    points = [{"row": r, "score": r["score"] if higher else -r["score"], "cost": r["cost"]}
              for r in measured]
    efficient = [p["row"] for p in frontier(points)]
    def retained(row):
        return row["score"] / best_score if higher else best_score / row["score"]
    quality = sorted({r["effort"] for r in measured
                      if r["score"] == best_score and r["cost"] == best["cost"]})
    cheaper = [r for r in efficient if r["cost"] < best["cost"] and retained(r) > 0]
    # Value is the highest measured quality per dollar among cheaper frontier points.
    # No hidden retention threshold turns the highest effort into a default choice.
    candidates = cheaper or [best]
    value_ratio = max(retained(r) / r["cost"] if r["cost"] > 0 else float("inf") for r in candidates)
    candidates = [r for r in candidates if (
        retained(r) / r["cost"] if r["cost"] > 0 else float("inf")) == value_ratio]
    values = sorted({r["effort"] for r in candidates})
    chosen = min(candidates, key=lambda r: (r["cost"], r["effort"]))
    ratio = chosen["cost"] / best["cost"] if best["cost"] > 0 else None
    gain = (f"{percentage(retained(chosen))} of score" if higher else
            f"{1 / retained(chosen):.2g}x latency")
    cost = f"{percentage(ratio)} cost" if ratio is not None else "cost ratio Unverified"
    tie = " (tie)" if len(quality) > 1 or len(values) > 1 else ""
    explanation = (f"{scope}: quality: {' / '.join(quality)}; value: {' / '.join(values)}, "
                   f"{gain} at {cost}{tie}")
    return {"setting": None, "scope": scope, "quality": quality, "value": values,
            "reference_effort": best["effort"], "score_fraction": retained(chosen),
            "cost_fraction": ratio, "explanation": explanation}


def recommend(model, groups, curves, *, max_usd=None, max_seconds=None):
    plans = []
    for group, rows in sorted(groups.items(), key=lambda item: str(item[0])):
        cohorts = {}
        for row in rows:
            if row["id"] == model["id"]:
                cohorts.setdefault((row.get("harness"), row.get("harness_version"),
                                    row.get("configuration")), []).append(row)
        for (scaffold, version, _), records in sorted(cohorts.items(), key=lambda item: str(item[0])):
            label = harness.note(scaffold, None, version).removeprefix("harness: ")
            scope = f"{group[0]}/{group[1]} ({label})"
            plan = knee(records, scope, model, max_usd=max_usd, max_seconds=max_seconds)
            if plan:
                plans.append(plan)
    if not plans:
        aa = {}
        for source in curves:
            if source.get("status") != "ok":
                continue
            for step in source.get("effort_tradeoffs", []):
                if not coverage.matches(model, step["model"]):
                    continue
                rows = aa.setdefault((step["model"], step["configuration"]), [])
                for level, values in ((step["from"], step["before"]), (step["to"], step["after"])):
                    row = {"model": step["model"], "effort": level,
                           "score": values["Artificial Analysis Intelligence Index"],
                           "cost": values["Cost per Task USD"], "seconds": values.get("Total Response (s)"),
                           "direction": "higher"}
                    if row not in rows:
                        rows.append(row)
        for (_, configuration), rows in sorted(aa.items()):
            scope = "AA overall curve" + (f" ({configuration})" if configuration else "")
            plan = knee(rows, scope, model, max_usd=max_usd, max_seconds=max_seconds)
            if plan:
                plan["explanation"] += "; domain-specific effort gains Unverified"
                plans.append(plan)
    return {"setting": None, "plans": plans}
