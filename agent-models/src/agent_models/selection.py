"""Explainable alternatives from comparable observations; never an overall winner."""

import re
from itertools import zip_longest

from . import coverage, harness, reference
from . import effort as effort_policy
from .shortlist import frontier, human_duration, measurement

CLASSES = ("small", "mid", "high", "top")


def model_class(model):
    tokens = coverage.key(model["model"])
    found = set()
    for line in (reference.GUIDES / "models.md").read_text().splitlines():
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells[0] in CLASSES:
            for vendor, label in zip(("gpt", "claude", "gemini"), cells[1:]):
                family = coverage.key(label)
                exact_family = any(tokens[i:i + len(family)] == family
                                   for i in range(len(tokens) - len(family) + 1))
                if label != "Unverified" and vendor in tokens and exact_family:
                    found.add(cells[0])
    return next(iter(found)) if len(found) == 1 else None


def duration(value):
    if value in ("", "-", "--", "—", "N/A"):
        return None
    match = re.fullmatch(r"(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?", value)
    if not match or not any(match.groups()):
        return None
    return sum(float(v) * scale for v, scale in zip(match.groups(), (3600, 60, 1)) if v)


def observations(domain, name, source):
    """Retain each source's metric and cost definition; no score normalization."""
    for row in source.get("measurements", []):
        config = row.get("configuration")
        if name in ("Vals Index", "Vals Terminal-Bench"):
            config = config.split(":", 1)[0] if config else None
        yield {**row, "score_metric": f"{row['metric']} [{row['unit']}]",
               "group": (domain, name, row["metric"], row["unit"], row["harness"],
                         config, row["cost_kind"])}
    if name == "LiveBench":
        for row in source.get("results", []):
            yield {"model": row["model"], "effort": row["effort"], "score": row["score"],
                   "cost": row["usd_per_success"], "seconds": None, "direction": "higher",
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
                       "group": (domain, name, metric, scaffold,
                                 "fallback" if " with fallback)" in row[model] else None,
                                 "USD/test" if "Cost / Test" in header else "USD/task")}


def tradeoff(row, role):
    fact = {"domain": row["group"][0], "source": row["group"][1], "role": role,
            "metric": list(row["group"][2:]), "score": row["score"], "cost": row["cost"],
            "score_metric": row.get("score_metric", row["group"][2]),
            "direction": row["direction"], "seconds": row["seconds"],
            "effort": coverage.setting(row["model"], row["effort"]), "caveat": row.get("caveat"),
            "harness": row.get("harness"), "harness_version": row.get("harness_version"),
            "n_runs": row.get("n_runs"), "tasks": row.get("tasks")}
    fact["cost_basis"] = row.get("cost_basis") or (f"USD/published run ({row['cost_kind']})"
                          if row.get("cost_kind")
                          else row["group"][-1]) if row["cost"] is not None else None
    fact["time_basis"] = row.get("time_basis") or ("published run" if "tasks" in row else
                          "response" if row["group"][1] == "Artificial Analysis" else "test")
    return fact


def suggest(evidence, catalog, *, choice=None, effort=None, pressure=False,
            max_usd=None, max_seconds=None, minimum_class=None):
    """Domain leaders + frontier/cheap alternatives, constrained only by published facts."""
    for value in (max_usd, max_seconds):
        if value is not None:
            measurement(str(value))  # Reject negative, NaN and infinite CLI constraints.
    if effort and not choice:
        raise ValueError("--effort requires an explicit --choice")
    models = coverage.canonical_catalog(catalog, choice)["models"]
    explicit = []
    problems, notes = [], []
    if choice:
        explicit = [m for m in models if any(coverage.key(choice) == coverage.key(value)
                    for value in (m["id"], m["model"], *m.get("aliases", [])))]
        if not explicit:
            explicit = [m for m in models if any(coverage.query_matches(choice, v)
                                                for v in (m["id"], m["model"]))]
        if len(explicit) != 1:
            return {"shortlist": [], "problems": ["Explicit choice unavailable/ambiguous; no substitution."],
                    "notes": [], "choice": choice}
        models = explicit
    classes = {m["id"]: model_class(m) for m in models}
    controls = {m["id"]: m["efforts"] for m in models}
    groups = {}
    for domain, found in evidence.items():
        notes.extend(found.get("warnings", []))
        notes.extend(found.get("coverage_notes", []))
        if not found["sources"]:
            notes.append(f"{domain}: Unverified; no source evidence.")
        for name, source in found["sources"].items():
            if source["status"] != "ok":
                notes.append(f"{domain}/{name}: Unverified; source unavailable.")
                continue
            if name in ("Bug Hunt", "KernelBench.com"):
                notes.append(f"{domain}/{name}: small single-maintainer board; unversioned method, "
                             "model plus harness, not isolated model ability.")
            observed = list(observations(domain, name, source))
            for row in observed:
                if row["score"] is None:
                    continue
                for model in models:
                    if not coverage.matches(model, row["model"]):
                        continue
                    if harness.native(row.get("harness"), catalog["backend"]) is not True and any(
                        coverage.matches(model, other["model"]) and other["score"] is not None
                        and coverage.supported(model, other["model"], other["effort"]) is not False
                        and (not effort or coverage.setting(other["model"], other["effort"])
                             == effort.casefold())
                        and harness.native(other.get("harness"), catalog["backend"]) is True
                        for other in observed):
                        continue
                    supported = coverage.supported(model, row["model"], row["effort"])
                    if supported is False:
                        continue
                    if effort and coverage.setting(row["model"], row["effort"]) != effort.casefold():
                        continue
                    if minimum_class and (classes[model["id"]] is None or
                            CLASSES.index(classes[model["id"]]) < CLASSES.index(minimum_class)):
                        continue
                    if max_usd is not None and (row["cost"] is None or row.get("cost_kind") == "floor"
                                                or row["cost"] > max_usd):
                        continue
                    if max_seconds is not None and (row["seconds"] is None or row["seconds"] > max_seconds):
                        continue
                    item = {**row, "id": model["id"], "support": supported}
                    item["quality"] = row["score"] if row["direction"] == "higher" else -row["score"]
                    groups.setdefault(row["group"], []).append(item)
    roles = {role: [] for role in ("quality leader", "cost-efficient frontier", "cheap observed option",
                                 "measured option")}
    domain_leaders = {}
    comparable_tasks = set()
    for group, rows in sorted(groups.items(), key=lambda item: str(item[0])):
        quality = max(row["quality"] for row in rows)
        first = [r for r in rows if r["quality"] == quality]
        if len({r["id"] for r in rows}) < 2:
            roles["measured option"].extend(first)
            continue
        if group[0] == "performance":
            comparable_tasks.add(group)
        if first and "low" in first[0]:
            first = [r for r in rows if r["high"] >= first[0]["low"] and r["low"] <= first[0]["high"]]
        if len({r["id"] for r in first}) > 1:
            notes.append(f"{group[0]}/{group[1]}: tied scores or overlapping intervals; no clear winner.")
        domain_leaders.setdefault(group[0], set()).update(r["id"] for r in first)
        roles["quality leader"] += first
        efficient = [p["observation"] for p in frontier([
            {"score": r["quality"], "cost": r["cost"], "observation": r} for r in rows])]
        if efficient:
            cheap = min(r["cost"] for r in efficient)
            cheapest = [r for r in efficient if r["cost"] == cheap]
            roles["cost-efficient frontier"] += cheapest
            roles["cheap observed option"] += cheapest
    if len({tuple(sorted(ids)) for ids in domain_leaders.values()}) > 1:
        notes.append("Domains favor different options; conflicting evidence is not averaged into a winner.")
    options = {}
    order = (("cost-efficient frontier", "quality leader", "cheap observed option", "measured option")
             if pressure else tuple(roles))
    # Round-robin across domains prevents the first source consuming the shortlist.
    for role in order:
        rows = roles[role]
        queues = [iter(sorted((r for r in rows if r["group"][0] == domain),
                              key=lambda r: (r["id"], str(r["effort"])))) for domain in evidence]
        for batch in zip_longest(*queues):
            for row in (r for r in batch if r is not None):
                domain = row["group"][0]
                if row["id"] not in options and len(options) >= 4:
                    continue
                option = options.setdefault(row["id"], {"id": row["id"], "class": classes[row["id"]],
                    "effort_options": [], "tradeoffs": [], "problems": []})
                setting = coverage.setting(row["model"], row["effort"])
                native_setting = next((v for v in controls[row["id"]] or []
                                       if v.casefold() == setting), None)
                if row["support"] is True and native_setting not in option["effort_options"]:
                    option["effort_options"].append(native_setting)
                fact = tradeoff(row, role)
                if fact not in option["tradeoffs"]:
                    option["tradeoffs"].append(fact)
    for model in explicit:
        option = options.setdefault(model["id"], {"id": model["id"], "class": classes[model["id"]],
            "effort_options": [], "tradeoffs": [],
            "problems": ["Choice evidence/constraints Unverified; retained."]})
        if effort and (model["efforts"] is None or effort not in model["efforts"]):
            option["problems"].append("Explicit effort unsupported or controls Unverified; no substitution.")
        if minimum_class and (classes[model["id"]] is None or
                CLASSES.index(classes[model["id"]]) < CLASSES.index(minimum_class)):
            option["problems"].append("Explicit choice does not establish the minimum class; retained.")
    for option in options.values():
        model = next(m for m in models if m["id"] == option["id"])
        option["model"] = model["model"]
        option["aliases"] = model.get("aliases", [model["id"]])
        measured = [r for rows in groups.values() for r in rows if r["id"] == option["id"]]
        levels = {coverage.setting(r["model"], r["effort"]) for r in measured}
        option["measured_efforts"] = sorted(level for level in levels if level is not None)
        curves = [v.get("effort_curves", {}) for v in evidence.values()]
        plan = ({"setting": None, "plans": []} if choice and effort else
                effort_policy.recommend(model, groups, curves, max_usd=max_usd, max_seconds=max_seconds))
        option["effort_evidence"] = plan["plans"]
        option["requested_effort"] = effort if choice else None
        option["recommended_effort"] = (effort if effort and effort in (model["efforts"] or [])
                                        else None) if choice and effort else plan["setting"]
        if model["efforts"] is None:
            option["problems"].append("Native effort controls Unverified.")
        covered = {r["domain"] for r in option["tradeoffs"]}
        for domain in (d for d in evidence if d not in covered):
            available = [r for r in measured if r["group"][0] == domain]
            if available:
                # Order contexts before scores: unlike operation metrics are never ranked together.
                row = min(available, key=lambda r: (str(r["group"]), -r["quality"], str(r["effort"])))
                option["tradeoffs"].append(tradeoff(row, "measured option"))
                covered.add(domain)
        if set(evidence) - covered:
            option["problems"].append("Thin/Unverified domains: "
                                      + ", ".join(sorted(set(evidence) - covered)))
        if "performance" in evidence:
            wins = {tuple(r["metric"]) for r in option["tradeoffs"]
                    if r["domain"] == "performance" and r["role"] == "quality leader"}
            tasks = {group[2:] for group in comparable_tasks}
            option["performance_comparisons"] = {"leads": len(wins), "tasks": len(tasks)}
    if not options:
        problems.append("No verified shortlist meets the constraints; unknown values were not filled.")
    notes.append("Observed alternatives, not statistically established winners. Agent makes the final call.")
    notes.append("Native listing is not session entitlement; API cost is not included allowance.")
    if max_usd is not None or max_seconds is not None:
        notes.append("Bounds use each source's cost/time metric; unknowns and floors cannot prove a cap.")
    return {"shortlist": list(options.values()), "problems": problems, "notes": list(dict.fromkeys(notes)),
            "backend": catalog["backend"],
            "choice": choice, "constraints": {"max_usd": max_usd, "max_seconds": max_seconds,
                "minimum_class": minimum_class, "allowance_pressure": pressure}}


def brief(result):
    lines = ["Shortlist · no automatic pick", *result["problems"]]
    for option in result["shortlist"]:
        by_domain = {}
        names = {"quality leader": "leader", "cost-efficient frontier": "frontier",
                 "cheap observed option": "cheapest", "measured option": "measured"}
        for row in option["tradeoffs"]:
            by_domain.setdefault(row["domain"], set()).add(names[row["role"]])
        for roles in by_domain.values():
            if "cheapest" in roles:
                roles.discard("frontier")
        roles = "; ".join(f"{domain}: " + " + ".join(r for r in names.values() if r in values)
                          for domain, values in by_domain.items())
        if option.get("performance_comparisons"):
            counts = option["performance_comparisons"]
            roles = re.sub(r"performance: [^;]+", f"performance: leads {counts['leads']} of "
                           f"{counts['tasks']} comparable tasks", roles)
        if option["requested_effort"]:
            effort_note = "requested effort " + option["requested_effort"]
        elif option["effort_evidence"]:
            effort_note = "effort alternatives from measured curves"
        elif len(option["measured_efforts"]) == 1:
            effort_note = "effort: measured only at " + option["measured_efforts"][0]
        else:
            levels = ", ".join(option["measured_efforts"]) or "Unverified"
            effort_note = "effort: measured at " + levels + "; trade-off Unverified"
        label = option["model"] + (f" (alias {option['id']})" if option["id"] != option["model"] else "")
        lines.append(f"- {label} · {effort_note} · {roles}")
        lines.extend("  " + p["explanation"] for p in option["effort_evidence"][:2])
        facts = []
        shown = []
        for domain in by_domain:
            shown.append(next(r for r in option["tradeoffs"] if r["domain"] == domain))
        shown += [r for r in option["tradeoffs"] if r not in shown]
        for row in shown:
            key = (row["domain"], row["source"], row["effort"])
            if key in facts:
                continue
            facts.append(key)
            cost = (f"{row['cost']:.4g} {row['cost_basis']}"
                    if row["cost"] is not None else "Unverified")
            seconds = (f" · time {human_duration(row['seconds'])}/{row['time_basis']}"
                       if row["seconds"] is not None else "")
            runs = row['n_runs']
            replicates = (f"mean of {runs} run{'s' if runs != 1 else ''}"
                          if runs is not None else "run count Unverified")
            score = (f"bugs fixed {row['score']:.3g}/105 ({replicates})"
                     if row['source'] == "Bug Hunt" else
                     f"{row['score_metric']}={row['score']:.4g} ({row['direction']})")
            scaffold = harness.note(row["harness"], result.get("backend"), row["harness_version"])
            measured = " · measured at " + row["effort"] if row["effort"] else " · effort Unverified"
            lines.append(f"  {row['domain']}/{row['source']}: {score}{measured} · "
                         f"cost {cost}{seconds} · {scaffold}")
            if len(facts) == 2:
                break
        lines.extend("  " + problem for problem in option["problems"])
    urgent = [n for n in result["notes"] if any(word in n for word in ("tied", "conflicting", "unavailable"))]
    lines += list(dict.fromkeys(urgent + result["notes"]))[:6]
    return "\n".join("".join(c for c in line if c.isprintable()) for line in lines)
