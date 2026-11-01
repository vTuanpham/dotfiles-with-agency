"""Official structured leaderboard exports, preserving published configurations."""

import csv
import hashlib
import io
import json
import re
from collections import defaultdict
from dataclasses import asdict, replace
from datetime import UTC, date, datetime

from . import benchmarks, coverage
from . import specialists as s

SWE = "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json"
OSWORLD = "https://osworld-v2.xlang.ai/static/data/leaderboard/official-results.json"
BFCL = "https://gorilla.cs.berkeley.edu/data_overall.csv"
BFCL_PAGE = "https://gorilla.cs.berkeley.edu/leaderboard.html"
LCB = "https://livecodebench.github.io/performances_generation.json"
VALS = "https://www.vals.ai"


def source(url, raw, rows, *, published=None, version=None, available=None, limits=""):
    if not rows:
        raise ValueError("empty structured leaderboard")
    return {"url": url, "data_url": url, "published": published, "version": version,
            "raw": raw, "measurements": [asdict(r) for r in rows],
            "sha256": hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest(),
            "coverage": {"captured_rows": available if available is not None else len(rows),
                         "available_rows": available if available is not None else len(rows),
                         "harness_captured": "yes" if any(r.harness for r in rows) else "not published",
                         "newest_available": published,
                         "efforts": sorted({r.effort for r in rows if r.effort})},
            "limits": limits or "Published configurations are separate evidence, not native-harness runs. "
                                 "Missing effort, scaffold versions and measurements remain Unverified."}


def vals_decode(raw):
    data = s.obj(raw)
    meta = s.obj(data["metadata"])
    published = date.fromisoformat(s.text(meta["updated"])).isoformat()
    version = s.text(meta["version"])
    rows = []
    tasks = s.obj(data["tasks"])
    for task, values in tasks.items():
        title = s.text(s.obj(meta["tasks"])[task])
        for model, value in s.obj(values).items():
            row = s.obj(value)
            controls = [s.optional_text(row.get(k)) for k in ("compute_effort", "reasoning_effort")]
            levels = {v for v in controls if v is not None}
            if len(levels) > 1:
                raise ValueError("conflicting Vals native effort controls")
            effort = next(iter(levels), None)
            harness = s.optional_text(row.get("harness")) or s.optional_text(meta.get("harness"))
            config = json.dumps({k: row.get(k) for k in (
                "temperature", "top_p", "max_output_tokens", "reasoning", "verbosity", "provider")},
                sort_keys=True)
            rows.append(s.Measurement(
                s.text(model), model, effort, harness, title, s.numeric(row["accuracy"], maximum=100),
                "% accuracy", "higher", None, s.numeric(row["cost_per_test"]), "published",
                s.numeric(row["latency"]), None, "Dataset updated " + published,
                configuration=task + ":" + config, cost_basis="USD/test", time_basis="test"))
    return rows, published, version


def vals(url):
    page = benchmarks.fetch(url)
    paths = set(re.findall(r'(/_astro/benchmark_view_[A-Za-z0-9_.-]+\.json)', page))
    if len(paths) != 1:
        raise ValueError("Vals structured export changed")
    endpoint = VALS + next(iter(paths))
    raw = benchmarks.loads(benchmarks.fetch(endpoint))
    rows, published, version = vals_decode(raw)
    return {**source(endpoint, raw, rows, published=published, version=version), "url": url}


def swe_decode(raw):
    rows, seen = [], set()
    for value in s.sequence(s.obj(raw)["leaderboards"]):
        board = s.obj(value)
        subset = s.text(board["name"])
        for value in s.sequence(board["results"]):
            row = s.obj(value)
            identifier = (subset, s.text(row["folder"]))
            if identifier in seen:
                raise ValueError("duplicate SWE-bench submission")
            seen.add(identifier)
            model = s.optional_text(row.get("model_display")) or s.text(row["name"])
            agent = s.optional_text(row.get("agent"))
            version = s.optional_text(row.get("mini-swe-agent_version"))
            stamp = date.fromisoformat(s.text(row["date"])).isoformat()
            score = s.numeric(row["resolved"], maximum=100)
            if row.get("warning"):
                score = None
            rows.append(s.Measurement(
                model, s.text(row["name"]), s.optional_text(row.get("reasoning_effort")), agent,
                subset + " resolved", score, "% resolved", "higher", None,
                s.numeric(row.get("instance_cost")), "published", None, stamp,
                s.optional_text(row.get("warning")), version, row["folder"],
                configuration=subset, cost_basis="USD/instance", time_basis="instance"))
    return rows


def swe():
    raw = benchmarks.loads(benchmarks.fetch(SWE))
    rows = swe_decode(raw)
    return source(SWE, raw, rows, published=max(r.date for r in rows), version="subsets kept separate")


def osworld_decode(raw):
    data = s.obj(raw)
    s.count(data["datasetSize"])
    rows = []
    for value in s.sequence(data["results"]):
        row = s.obj(value)
        label = s.text(row["model"])
        model = s.optional_text(row.get("basePlannerModel")) or label
        kind = s.text(row["modelType"])
        if kind not in ("e2e", "agent"):
            raise ValueError("unknown OSWorld model/scaffold type")
        config = json.dumps({k: row.get(k) for k in (
            "releaseVersion", "datasetScope", "stepBudget", "toolSetting", "binarySuccessThreshold")},
            sort_keys=True)
        if row.get("stepBudget") is not None:
            s.count(row["stepBudget"])
        controls = s.optional_text(row.get("reasoning"))
        effort = controls if controls in ("low", "medium", "high", "xhigh", "max") else None
        for metric in ("binaryAccuracy", "partialScore"):
            rows.append(s.Measurement(
                model, label, effort, label if kind == "agent" else None,
                metric, s.numeric(row[metric], maximum=100), "%", "higher", None,
                s.numeric(row.get("costPerTaskUsd")), "published", None, None,
                "Result date Unverified; " + (controls or "effort Unverified"),
                configuration=config, cost_basis="USD/task", time_basis="task"))
    return rows


def osworld():
    raw = benchmarks.loads(benchmarks.fetch(OSWORLD))
    rows = osworld_decode(raw)
    stamp = date.fromisoformat(s.text(raw["updatedAt"])).isoformat()
    result = source(OSWORLD, raw, rows, published=stamp, version=s.text(raw["benchmarkVersion"]),
                    available=len(raw["results"]))
    result["coverage"]["harness_captured"] = "yes for named agents; e2e scaffold not published"
    return result


def bfcl_decode(raw):
    reader = csv.DictReader(io.StringIO(raw))
    required = {"Model", "Overall Acc", "Total Cost ($)", "Latency Mean (s)"}
    if not reader.fieldnames or not required <= set(reader.fieldnames):
        raise ValueError("BFCL schema changed")
    rows, seen = [], set()
    for row in reader:
        if None in row or None in row.values():
            raise ValueError("ragged BFCL CSV")
        label = s.text(row["Model"])
        match = re.fullmatch(r"(.+) \((FC|Prompt)\)", label)
        if label in seen:
            raise ValueError("duplicate BFCL model/configuration")
        seen.add(label)
        name, mode = match.groups() if match else (label, None)
        def number(field, maximum=None):
            value = row[field]
            return None if value in ("N/A", "", "-") else s.csv_number(value.removesuffix("%"),
                                                                       maximum=maximum)
        rows.append(s.Measurement(
            name, label, None, "BFCL native function calling" if mode == "FC" else "BFCL prompt adapter"
            if mode == "Prompt" else None, "Overall accuracy", number("Overall Acc", 100), "%", "higher",
            None, number("Total Cost ($)"), "published", number("Latency Mean (s)"), None,
            "Latency is mean API response, cost is entire benchmark; effort/run date not published.",
            configuration=mode, cost_basis="USD/benchmark", time_basis="response"))
    return rows


def bfcl():
    raw = benchmarks.fetch(BFCL)
    rows = bfcl_decode(raw)
    page = benchmarks.fetch(BFCL_PAGE)
    method = bfcl_method(page)
    rows = [replace(row, harness_version=method["commit"]) for row in rows]
    return {**source(BFCL, {"csv": raw, "method": method}, rows, published=method["updated"],
                     version="BFCL V4 / eval " + method["commit"]),
            "methodology_sha256": hashlib.sha256(json.dumps(method, sort_keys=True).encode()).hexdigest()}


def bfcl_method(page):
    parsed = benchmarks.Tables()
    parsed.feed(page)
    text = " ".join(parsed.text)
    version = re.search(r"\(BFCL\) V(\d+)", text)
    commit = re.search(r"commit\s+([a-f0-9]{7,40})\b", text)
    updated = re.search(r"Last Updated:\s*(\d{4}-\d{2}-\d{2})", text)
    if not version or version[1] != "4" or not commit or not updated:
        raise ValueError("BFCL version/methodology changed; source review required")
    return {"version": version[1], "commit": commit[1],
            "updated": date.fromisoformat(updated[1]).isoformat()}


def lcb_decode(raw):
    data = s.obj(raw)
    models = {s.text(m["model_repr"]): s.obj(m) for m in s.sequence(data["models"])}
    if len(models) != len(data["models"]):
        raise ValueError("duplicate LiveCodeBench model identity")
    groups, seen = defaultdict(list), set()
    for value in s.sequence(data["performances"]):
        row = s.obj(value)
        label = s.text(row["model"])
        if label not in models:
            raise ValueError("unlisted LiveCodeBench model")
        stamp = s.numeric(row["date"])
        if stamp is None:
            raise ValueError("missing LiveCodeBench question date")
        day = datetime.fromtimestamp(stamp / 1000, UTC).date().isoformat()
        identity = (label, s.text(row["question_id"]), day)
        if identity in seen:
            raise ValueError("duplicate LiveCodeBench question/model")
        seen.add(identity)
        groups[(label, day)].append(s.numeric(row["pass@1"], maximum=100))
    rows = []
    for (label, day), scores in sorted(groups.items()):
        # Keep every question date instead of the website's default slider window.
        score = sum(scores) / len(scores) if all(v is not None for v in scores) else None
        released = s.numeric(models[label].get("release_date"))
        clean = False
        if released is not None:
            try:
                clean = datetime.fromtimestamp(released / 1000, UTC).date().isoformat() < day
            except (ValueError, OSError, OverflowError):
                raise ValueError("invalid LiveCodeBench model release date") from None
        # The official UI withholds rank for windows starting before model release.
        # A known reported score is not evidence of an uncontaminated comparison.
        if not clean:
            score = None
        rows.append(s.Measurement(
            s.text(models[label]["model_name"]), label, coverage.setting(label), None,
            "code generation pass@1", score, "%", "higher", len(scores), None, None, None, None,
            "Question publication date (not evaluation date): " + day
            + ("; pre-release/unknown cutoff: contamination risk, excluded from leaders"
               if not clean else ""),
            configuration="question date " + day))
    return rows


def lcb():
    raw = benchmarks.loads(benchmarks.fetch(LCB))
    rows = lcb_decode(raw)
    return source(LCB, raw, rows, version="generation; every published question date",
                  available=len(raw["performances"]),
                  limits="Full generation JSON retained; daily question cohorts are separate. "
                         "Pre-release/unknown-cutoff cohorts are excluded from leaders, "
                         "as in the official UI. "
                         "Question dates are not run dates. Repair/execution/test-generation releases "
                         "are not this generation dataset. No harness versions or task costs published.")
