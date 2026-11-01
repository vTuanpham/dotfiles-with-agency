"""Deterministic Markdown views of the decoded benchmark snapshot; no source review."""

import json
import math
import re
from datetime import datetime

from . import benchmarks
from .shortlist import table_views

SECTIONS = ("effort", "capability", "cost")
LIMIT = 2  # Compact reference views; the snapshot and benchmark search retain all rows.


def cell(value):
    if value is None or value in ("", "-", "--", "—", "N/A"):
        return "Unverified"
    if isinstance(value, dict):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite benchmark measurement")
        value = f"{value:.6f}".rstrip("0").rstrip(".")
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(
        ">", "&gt;").replace("|", "&#124;").replace("\n", " ").replace("\r", " ")


def table(headers, rows):
    if not rows:
        return "Unverified: no measurements."
    return "\n" + "\n".join([
        "| " + " | ".join(cell(v) for v in headers) + " |",
        "|" + "---|" * len(headers),
        *("| " + " | ".join(cell(v) for v in row) + " |" for row in rows),
    ]) + "\n"


def source_note(name, source, retrieved):
    url = source.get("url", benchmarks.SOURCE_URLS.get(name))
    label = f"[{cell(name)}]({url})" if url else cell(name)
    identity = [source.get(k) for k in ("version", "release", "published", "config")]
    identity += source.get("metadata", [])
    version = "; ".join(dict.fromkeys(cell(v) for v in identity if v)) or "Unverified"
    failure = " · Unverified: " + cell(source["error"]) if source["status"] != "ok" else ""
    return f"- {label} · {version} · retrieved {retrieved}{failure}"


def provenance(data):
    """Review-only details; the complete rows remain in the saved snapshot."""
    parts = ["Full rows and component headers: benchmark-data.json."]
    for name, source in sorted(data["sources"].items()):
        parts.append(source_note(name, source, source.get("retrieved", data["retrieved"])))
        details = {key: source[key] for key in (
            "methodology_url", "methodology_sha256", "sha256", "limits", "weights",
            "categories", "metric", "ambiguous_names",
        ) if key in source}
        parts.append(json.dumps(details, sort_keys=True, ensure_ascii=False, indent=2))
    return "\n\n".join(parts)


def candidates(leaders, efficient):
    """Bound both views and keep an overlapping candidate only once."""
    selected = []
    for row in leaders[:LIMIT] + efficient[:LIMIT]:
        if row not in selected:
            selected.append(row)
    return selected


def published_tables(source):
    parts = []
    for raw in source["tables"]:
        header = next(i for i, row in enumerate(raw) if any("Model" in c for c in row))
        names = raw[header]
        if any(len(row) != len(names) for row in raw[header:]):
            parts.append("Unverified: ambiguous component table; inspect benchmark evidence.")
            continue
        score = next((name for name in (
            "Artificial Analysis Intelligence Index", "Score", "Accuracy") if name in names), None)
        if score is None:
            continue  # Domain components belong to the task-specific benchmark query.
        start = header + 1
        while start < len(raw) and not any(
                re.fullmatch(r"\$?\d+(?:[.,]\d+)*(?:\s*%|[kKmM])?", c)
                for c in raw[start][1:]):
            start += 1
        rows = raw[start:]
        view = table_views(raw[header:start], rows, len(rows))
        efficient = view.get("efficient_rows", [])
        model = next(names.index(name) for name in ("Model", "Models") if name in names)
        columns = [names.index(name) for name in (
            score, "Cost per Task USD", "Cost / Test", "Latency First Chunk (s)",
            "Total Response (s)", "Duration / Test",
        ) if name in names]
        selected = []
        for row in candidates(rows, efficient):
            label = row[model]
            if "Harness" in names:
                label += " (" + cell(row[names.index("Harness")]) + "; effort Unverified)"
            elif (score != "Artificial Analysis Intelligence Index"
                  or not re.fullmatch(r".+ \([^()]+\)", label)):
                label += " (effort Unverified)"
            if row in efficient:
                label = f"**{label}**"
            selected.append([label, *(row[index] for index in columns)])
        parts.append(table(["Model / published effort", *(names[i] for i in columns)], selected))
    return "\n".join(parts) or "Unverified: query domain components in benchmark evidence."


def sections(data):
    if data is None:
        return dict.fromkeys(SECTIONS, "Unverified: no benchmark snapshot generated yet.")
    retrieved = datetime.fromisoformat(data["retrieved"])
    if retrieved.tzinfo is None:
        raise ValueError("benchmark retrieval timestamp requires a timezone")
    result = {name: [] for name in SECTIONS}
    arena_rows = []
    for name, source in sorted(data["sources"].items()):
        if (name.startswith("Arena/")
                and name.removeprefix("Arena/") not in benchmarks.ARENA_DECISION_VIEWS):
            continue  # Additional published configurations remain in queries and review provenance.
        section = ("effort" if name == "Artificial Analysis" else
                   "capability" if name.startswith("Arena/") else "cost")
        source_date = datetime.fromisoformat(source.get("retrieved", data["retrieved"]))
        result[section].append(source_note(name, source, source_date.date().isoformat()))
        if source["status"] != "ok":
            continue
        if "measurements" in source:
            if name == "Artificial Analysis":
                rows = sorted((r for r in source["measurements"] if r["score"] is not None
                               and r["metric"] == "artificial_analysis_intelligence_index"),
                              key=lambda r: (-r["score"], r["model"]))[:LIMIT]
                result[section].append(table(["Model / published effort", "Intelligence Index"],
                                             [[r["label"], r["score"]] for r in rows]))
                result[section].append("Free API: task-cost curves and methodology version Unverified.")
            else:
                result[section].append("Task-specific evidence: query benchmarks --domain "
                                       + ({"KernelBench.com": "performance", "Bug Hunt": "debugging",
                                           "SWE-bench": "coding", "LiveCodeBench": "coding",
                                           "BFCL": "tools", "OSWorld": "browser"}.get(name, "overall"))
                                       + ".")
        elif name == "LiveBench":
            values = sorted(source["points"]["Overall"], key=lambda p: (
                p["score"] is None, -(p["score"] or 0), p["model"]))
            efficient = sorted(benchmarks.frontier(values),
                               key=lambda p: (p["cost"], -p["score"], p["model"]))
            rows = []
            for point in candidates(values, efficient):
                label = point["model"] + " (" + cell(source["efforts"].get(point["model"])) + ")"
                if point in efficient:
                    label = f"**{label}**"
                rows.append([label, point["score"], point["cost"]])
            result[section].append(table(
                ["Model / published effort", "Overall score", "Estimated USD/success"], rows))
        elif name.startswith("Arena/"):
            rows = sorted((r for r in source["rows"] if r.get("category", "overall") == "overall"),
                          key=lambda r: (r["rank"], r["model_name"]))[:LIMIT]
            score, low, high = (
                ("score", "score_ci_lower", "score_ci_upper") if source["config"] == "agent"
                else ("rating", "rating_lower", "rating_upper"))
            arena_rows += [[name.removeprefix("Arena/"), row["model_name"],
                            f"{cell(row[score])} [{cell(row[low])}, {cell(row[high])}]"] for row in rows]
        else:
            result[section].append(published_tables(source))
    if arena_rows:
        result["capability"].append(table(
            ["Arena board", "Model / published effort", "Score [confidence interval]"], arena_rows))
    if result["effort"]:
        result["effort"].insert(
            0, f"Up to {LIMIT} leaders and {LIMIT} cheapest frontier candidates per table; "
            "**bold** marks the frontier. Query benchmarks for full/domain views.\n")
    return {name: "\n".join(parts) if parts else "Unverified: source absent from snapshot."
            for name, parts in result.items()}


def replace(text, values):
    for name in SECTIONS:
        start, end = f"<!-- model-guide:{name}:start -->", f"<!-- model-guide:{name}:end -->"
        if text.count(start) != 1 or text.count(end) != 1:
            raise ValueError(f"models.md requires exactly one generated {name} section")
        before, _, rest = text.partition(start)
        _, found, after = rest.partition(end)
        if not found:
            raise ValueError(f"models.md has reversed generated {name} markers")
        text = before + start + "\n" + values[name] + "\n" + end + after
    return text


def prose(text):
    return replace(text, dict.fromkeys(SECTIONS, ""))


def contents(text):
    prose(text)  # Validate marker counts and ordering before extracting.
    return {name: text.split(f"<!-- model-guide:{name}:start -->", 1)[1].split(
        f"<!-- model-guide:{name}:end -->", 1)[0] for name in SECTIONS}


def render(text, data):
    return replace(text, {name: "<!-- Generated by model-guide; do not edit. -->\n" + value
                          for name, value in sections(data).items()})
