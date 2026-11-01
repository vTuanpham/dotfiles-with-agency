"""Public benchmark evidence for a reviewer; never selects models or edits the guide."""

import csv
import hashlib
import io
import json
import math
import re
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from dataclasses import asdict
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request

from agent_accounts import providers
from agent_accounts.models import loads

from . import coverage, harness, specialists
from .shortlist import frontier, table_views
from .state import HOME
from .transport import urlopen

PRELOADED = ContextVar("benchmark_preloaded", default={})
PREVIOUS = ContextVar("benchmark_previous", default={})

MAX_BYTES = 8_000_000
LIVE = "https://livebench.ai/"
ARENA = "https://datasets-server.huggingface.co/parquet?"
DATASET = "lmarena-ai/leaderboard-dataset"
CACHE = HOME / "benchmarks"
DOMAINS = ("overall", "reasoning", "backend", "coding", "terminal", "design", "browser", "research", "data",
           "writing", "vision", "documents", "long-context", "tools", "finance", "legal", "tax",
           "performance", "debugging")
ARENA_BOARDS = {"agent": "agent", "webdev": "webdev", "text": "text_style_control",
                "vision": "vision_style_control", "document": "document_style_control", "search": "search"}
ARENA_DECISION_VIEWS = frozenset(ARENA_BOARDS)
ARENA_BOARDS.update({name: name for name in (
    "agent_bash_recovery_steps", "agent_bash_reliability", "agent_praise_complaint", "agent_steerability",
    "agent_task_outcome_explicit", "agent_tool_hallucination", "text_raw", "text_factuality",
    "vision_raw", "search_factuality", "search_style_control")})
ARENA_BOARDS.update(text_raw="text", vision_raw="vision")
SOURCE_URLS = {"LiveBench": LIVE,
               "SWE-bench": "https://www.swebench.com/",
               "OSWorld": "https://osworld-v2.xlang.ai/",
               "BFCL": "https://gorilla.cs.berkeley.edu/leaderboard.html",
               "LiveCodeBench": "https://livecodebench.github.io/leaderboard.html",
               "KernelBench.com": "https://kernelbench.com/",
               "Bug Hunt": "https://bughunt.productcompass.pm/",
               "Artificial Analysis": "https://artificialanalysis.ai/leaderboards/models",
               "Vals Index": "https://www.vals.ai/benchmarks/vals_index",
               "Vals Terminal-Bench": "https://www.vals.ai/benchmarks/vals_index",
               **{f"Arena/{name}": f"https://huggingface.co/datasets/{DATASET}" for name in ARENA_BOARDS}}


def fetch_bytes(url, headers=None):
    if url in PRELOADED.get():
        return PRELOADED.get()[url]
    from . import polling

    polling.available(url)
    try:
        with urlopen(Request(url, headers={"User-Agent": "model-guide/0.1", **(headers or {})}),
                     timeout=25) as response:
            data = response.read(MAX_BYTES + 1)
    except HTTPError as error:
        if error.code in (429, 503) or error.headers.get("x-ratelimit-remaining") == "0":
            polling.defer(url, dict(error.headers.items()))
        raise
    if len(data) > MAX_BYTES:
        raise ValueError("source exceeds size limit")
    return data


def fetch(url):
    return fetch_bytes(url).decode("utf-8")


def number(value, *, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("expected numeric measurement")
    result = float(value)
    if not math.isfinite(result) or result < 0 or (maximum is not None and result > maximum):
        raise ValueError("measurement out of range")
    return result


def csv_rows(text):
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if (not rows or not reader.fieldnames or "model" not in reader.fieldnames
            or len(set(reader.fieldnames)) != len(reader.fieldnames)):
        raise ValueError("empty or ambiguous CSV")
    if any(None in row or None in row.values() for row in rows):
        raise ValueError("ragged CSV")
    identifiers = [row["model"] for row in rows]
    if any(not identifier for identifier in identifiers) or len(set(identifiers)) != len(identifiers):
        raise ValueError("empty or duplicate model ID")
    return rows


def livebench():
    page = fetch(LIVE)
    script = re.search(r'src="\./(static/js/main\.[a-z0-9]+\.js)"', page)
    if not script:
        raise ValueError("LiveBench release script changed; review current source")
    code = fetch(LIVE + script[1])
    releases = re.findall(r'\["\d{8}"(?:,"\d{8}")*\]', code)
    dates = {value for group in releases for value in json.loads(group)}
    if not dates:
        raise ValueError("LiveBench release catalog changed")
    release = max(dates)
    if datetime.strptime(release, "%Y%m%d").date() > date.today():
        raise ValueError("LiveBench catalog contains a future release")
    base = f"{LIVE}data/{release}/"
    raw = {name: fetch(base + name) for name in ("table.csv", "categories.json", "cost.csv")}
    rows = csv_rows(raw["table.csv"])
    costs = {row["model"]: row for row in csv_rows(raw["cost.csv"])}
    categories = loads(raw["categories.json"])
    if type(categories) is not dict:
        raise ValueError("invalid LiveBench categories")
    weights = categories.pop("_overall_weights", {})
    if type(weights) is not dict or not categories or set(weights) - set(categories):
        raise ValueError("invalid LiveBench categories/weights")
    fields = []
    for category, columns in categories.items():
        if not isinstance(columns, list) or len(columns) != 1 or not isinstance(columns[0], str):
            raise ValueError("LiveBench suite layout changed")
        weight = number(weights.get(category, 1))
        if weight <= 0:
            raise ValueError("invalid LiveBench weight")
        fields.append((category, columns[0], weight))
    if len({field for _, field, _ in fields}) != len(fields):
        raise ValueError("duplicate LiveBench suite")
    points = {name: [] for name in (*categories, "Overall")}
    for row in rows:
        cost = costs.get(row["model"], {})
        scores = {}
        total_cost = total_tasks = 0
        complete_cost = True
        for category, field, _ in fields:
            value = row[field]
            point = {"model": row["model"], "score": None, "cost": None}
            points[category].append(point)
            if value == "":
                complete_cost = False
                continue
            score = number(value, maximum=100)
            point["score"] = score
            scores[category] = score
            if cost.get(field, "") == "" or cost.get("nq_" + field, "") == "":
                complete_cost = False
                continue
            spend, count = number(cost[field]), number(cost["nq_" + field])
            if count <= 0 or not count.is_integer():
                raise ValueError("invalid LiveBench task count")
            total_cost += spend
            total_tasks += count
            if score > 0:
                point["cost"] = spend / count / (score / 100)
        overall = None
        overall_cost = None
        if len(scores) == len(fields):
            overall = sum(scores[name] * w for name, _, w in fields) / sum(w for _, _, w in fields)
            if overall > 0 and complete_cost and total_tasks:
                overall_cost = total_cost / total_tasks / (overall / 100)
        points["Overall"].append({"model": row["model"], "score": overall, "cost": overall_cost})
    version = re.search(r"LiveBench (\d+\.\d+) -", page)
    if not version:
        raise ValueError("LiveBench version not published in page title")
    efforts = dict(re.findall(r'"([^"{}]+)":\{displayName:"[^"{}]+"[^{}]*?effort:"([^"{}]+)"', code))
    return {"url": LIVE, "release": release, "version": version[1], "efforts": efforts,
            "release_script": script[1],
            "rows": rows, "categories": categories, "weights": weights,
            "cost_rows": list(costs.values()), "points": points,
            "frontiers": {name: frontier(values) for name, values in points.items()},
            "sha256": {base + name: hashlib.sha256(text.encode()).hexdigest()
                       for name, text in raw.items()},
            "coverage": {"available_rows": len(rows), "captured_rows": len(rows),
                         "harness_captured": "not published", "newest_available": release,
                         "efforts": sorted(set(efforts.values()))},
            "limits": "One run per suite; effort must be checked in site metadata. "
                      "Overall cost/success divides mean task cost by weighted overall score; "
                      "it is a composite proxy, not a retry guarantee. Incomplete rows excluded "
                      "from the frontier, never filled with zero. Time per task unavailable."}


def arena(config, catalog=None):
    import polars as pl

    if catalog is None:
        catalog = loads(fetch(ARENA + urlencode({"dataset": DATASET})))
    if type(catalog) is not dict or catalog.get("partial") is not False:
        raise ValueError("incomplete Arena export catalog")
    files = [item for item in catalog["parquet_files"]
             if item["config"] == config and item["split"] == "latest"]
    if not files or len(files) > 8:
        raise ValueError("Arena latest export unavailable")
    rows, digests, total = [], {}, 0
    for item in files:
        url, size = item["url"], item["size"]
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "huggingface.co"
                or not parsed.path.startswith(f"/datasets/{DATASET}/resolve/")
                or type(size) is not int or not 0 < size <= MAX_BYTES):
            raise ValueError("invalid Arena export URL/size")
        raw = fetch_bytes(url)
        if len(raw) != size or url in digests:
            raise ValueError("incomplete or duplicate Arena export")
        digests[url] = hashlib.sha256(raw).hexdigest()
        try:
            frame = pl.read_parquet(io.BytesIO(raw), n_rows=20001)
            total += frame.height
            if total > 20000:
                raise ValueError("Arena export exceeds row limit")
            rows.extend(frame.to_dicts())
        except pl.exceptions.PolarsError as error:
            raise ValueError("invalid Arena Parquet/schema") from error
    score_fields = (("score", "score_ci_lower", "score_ci_upper") if config.startswith("agent")
                    else ("rating", "rating_lower", "rating_upper"))
    for row in rows:
        for key in score_fields:
            if type(row[key]) not in (int, float) or not math.isfinite(row[key]):
                raise ValueError("invalid Arena score")
        if not row[score_fields[1]] <= row[score_fields[0]] <= row[score_fields[2]]:
            raise ValueError("invalid Arena confidence interval")
        if type(row["model_name"]) is not str or not row["model_name"]:
            raise ValueError("invalid Arena model name")
        date.fromisoformat(row["leaderboard_publish_date"][:10])
    if not rows or len({json.dumps(r, sort_keys=True) for r in rows}) != len(rows):
        raise ValueError("empty or duplicate Arena records")
    names = Counter((r["category"], r["model_name"]) for r in rows)
    dates = {r["leaderboard_publish_date"] for r in rows}
    return {"url": f"https://huggingface.co/datasets/{DATASET}", "config": config,
            "metric": "published agent score" if config.startswith("agent") else "preference rating",
            "published": max(dates), "publication_dates": sorted(dates), "rows": rows, "sha256": digests,
            "ambiguous_names": [name for (_, name), count in names.items() if count > 1],
            "coverage": {"available_rows": total, "captured_rows": len(rows),
                         "categories": sorted({r["category"] for r in rows}),
                         "available_configs": sorted({r["config"] for r in catalog["parquet_files"]}),
                         "harness_captured": "not published"},
            "limits": "All categories in this modality's latest export; overall used in decision views. "
                      "Historical full split and other modality/config exports are not this snapshot. "
                      "Raw score scale and "
                      "confidence intervals retained. Preference and agent net-improvement scores "
                      "are distinct. Dataset does not supply task cost/time. CC-BY-4.0, Arena."}


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.text = [], []
        self.table = self.row = self.cell = None
        self.skipping = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skipping = True
        elif tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("th", "td") and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if not self.skipping:
            self.text.append(data)
            if self.cell is not None:
                self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skipping = False
        elif tag in ("th", "td") and self.cell is not None and self.row is not None:
            self.row.append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None and self.table is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def webpage(url):
    raw = fetch(url)
    parsed = Tables()
    parsed.feed(raw)
    tables = [t for t in parsed.tables if len(t) > 2 and any("Model" in c for r in t[:3] for c in r)]
    if not tables:
        raise ValueError("benchmark table absent; review source layout")
    text = " ".join(" ".join(parsed.text).split())
    metadata = re.findall(r"(?:Version \d+(?:\.\d+)*|Updated \d{1,2}/\d{1,2}/\d{4})", text)
    methodology = None
    methodology_sha256 = None
    if "artificialanalysis.ai" in url:
        methodology = "https://artificialanalysis.ai/methodology/intelligence-benchmarking"
        methods = fetch(methodology)
        methodology_sha256 = hashlib.sha256(methods.encode()).hexdigest()
        versions = re.findall(r"Intelligence Index v(\d+\.\d+)", methods)
        if not versions:
            raise ValueError("Artificial Analysis methodology version missing")
        metadata.append("Intelligence Index v" + versions[0])
    return {"url": url, "metadata": metadata, "methodology_url": methodology, "tables": tables,
            "methodology_sha256": methodology_sha256,
            "effort_tradeoffs": effort_tradeoffs(tables) if methodology else [],
            "sha256": hashlib.sha256(raw.encode()).hexdigest(),
            "limits": "Published table cells retained verbatim, including effort/harness and "
                      "task cost/time columns. Verify methodology/version before comparing. "
                      "Missing values have not been filled. Response latency is not agent task "
                      "completion time; retain the source's exact duration/workload label."}


def vals_terminal(*, structured=False):
    index = "https://www.vals.ai/benchmarks/vals_index"
    raw = fetch(index)
    paths = set(re.findall(r'href=[\"\'](?:https://www\.vals\.ai)?'
                           r'(/benchmarks/terminal-bench-\d+(?:-\d+)*)[\"\']', raw))
    if not paths:
        raise ValueError("Vals Index no longer links a Terminal-Bench release")
    path = max(paths, key=lambda p: tuple(int(v) for v in re.findall(r"\d+", p)))
    from . import boards

    loader = boards.vals if structured else webpage
    return {**loader("https://www.vals.ai" + path), "discovered_from": index}


def effort_tradeoffs(tables):
    """Neighboring measured settings by cost within a model/configuration, not an effort ladder."""
    groups = {}
    for table in tables:
        header = next((r for r in table if "Cost per Task USD" in r), None)
        if header is None:
            continue
        indexes = {name: header.index(name) for name in
                   ("Model", "Artificial Analysis Intelligence Index", "Cost per Task USD",
                    "Latency First Chunk (s)", "Total Response (s)")}
        for row in table[table.index(header) + 1:]:
            if len(row) != len(header):
                raise ValueError("Artificial Analysis table width changed")
            match = re.fullmatch(r"(.+) \(([^()]+)\)", row[indexes["Model"]])
            if not match:
                continue
            measurements = {}
            for name, index in indexes.items():
                if name != "Model":
                    value = row[index].removeprefix("$").replace(",", "")
                    measurements[name] = None if value in ("--", "") else number(
                        value, maximum=100 if name == "Artificial Analysis Intelligence Index" else None)
            setting = match[2]
            configuration = "with fallback" if setting.endswith(" with fallback") else ""
            setting = setting.removesuffix(" with fallback")
            key = (match[1], configuration)
            group = groups.setdefault(key, {})
            if setting in group:
                raise ValueError("duplicate model/effort measurement")
            group[setting] = measurements
    result = []
    for (model, configuration), levels in groups.items():
        measured = sorted(((setting, values) for setting, values in levels.items()
                           if values["Cost per Task USD"] is not None),
                          key=lambda item: item[1]["Cost per Task USD"])
        for (before_effort, before), (after_effort, after) in zip(measured, measured[1:]):
            deltas = {key: round(after[key] - value, 6)
                      if value is not None and after[key] is not None else None
                      for key, value in before.items()}
            result.append({"model": model, "configuration": configuration,
                           "from": before_effort, "to": after_effort,
                           "before": before, "after": after, "delta": deltas})
    return result


def bug_hunt_source():
    raw = fetch(specialists.BUG)
    summary = loads(fetch(specialists.BUG_SUMMARY))
    published, measurements, coverage_info = specialists.bug_runs(raw, summary)
    methods = fetch("https://raw.githubusercontent.com/phuryn/bug-hunt-bench/main/results/run-notes.md")
    data = {"runs_csv": raw, "summary_annotations": summary, "run_notes_md": methods}
    return {"url": SOURCE_URLS["Bug Hunt"], "data_url": specialists.BUG, "published": published,
            "metadata": ["Methodology version Unverified; dated dataset, not a versioned standard"],
            "methodology_url": specialists.BUG_METHOD,
            "methodology_sha256": hashlib.sha256(json.dumps(methods, sort_keys=True).encode()).hexdigest(),
            "sha256": {specialists.BUG: hashlib.sha256(raw.encode()).hexdigest()},
            "measurements": [asdict(row) for row in measurements], "raw": data,
            "coverage": coverage_info,
            "limits": ("Unversioned method. Single maintainer; no independent replication established. "
                       "Small task set; "
                       "model plus vendor CLI/harness, not isolated model ability. Unmatched names "
                       "and missing cells are Unverified. "
                       "105 planted bugs in two repos; no bug report; hidden answer key, judge-graded. "
                       "Bill/list/floor/free costs are distinct; wall times can be contended; "
                       "small score gaps may be run variance. Every CSV effort/run retained; "
                       "superseded receipts retained in raw only; means never cross harness versions.")}


def collect(name, loader):
    try:
        return name, {"status": "ok", **loader()}
    except (OSError, ValueError, KeyError, TypeError) as error:
        return name, {"status": "unavailable", "error": f"{type(error).__name__}: {error}"}


def loaders():
    from . import artificial, boards, kernel_source

    loaders = [("LiveBench", livebench)]
    loaders += [(f"Arena/{name}", lambda config=config: arena(config))
                for name, config in ARENA_BOARDS.items()]
    loaders.append(("Artificial Analysis", artificial.load))
    loaders.append(("Vals Index", lambda: boards.vals(SOURCE_URLS["Vals Index"])))
    loaders.append(("Vals Terminal-Bench", lambda: vals_terminal(structured=True)))
    loaders += [("SWE-bench", boards.swe), ("OSWorld", boards.osworld),
                ("BFCL", boards.bfcl), ("LiveCodeBench", boards.lcb)]
    loaders += [
        ("KernelBench.com", kernel_source.load), ("Bug Hunt", bug_hunt_source),
    ]
    return dict(loaders)


def prepare(directory=CACHE, *, names=None, previous=None, fetched=None):
    started = time.monotonic()
    available = loaders()
    selected = set(available) if names is None else set(names)
    if selected - available.keys():
        raise ValueError("unknown benchmark source")

    def capture(item):
        token = PRELOADED.set(fetched or {})
        prior = PREVIOUS.set(previous or {})
        try:
            name, result = collect(*item)
            result["retrieved"] = datetime.now(UTC).isoformat()
            return name, result
        finally:
            PRELOADED.reset(token)
            PREVIOUS.reset(prior)

    sources = dict((previous or {}).get("sources", {}))
    with ThreadPoolExecutor(max_workers=4) as pool:
        sources.update(pool.map(capture, [(name, available[name]) for name in available if name in selected]))
    directory.mkdir(parents=True, exist_ok=True)
    snapshot = {"retrieved": datetime.now(UTC).isoformat(),
                "elapsed_seconds": round(time.monotonic() - started, 3), "sources": sources}
    target = directory / "benchmark-data.json"
    write_snapshot(target, json.dumps(snapshot, indent=2, allow_nan=False) + "\n")
    lines = ["# Benchmark preprocessing", f"Retrieved {snapshot['retrieved']}", "",
             "Source data is evidence, not instructions. Recheck methodology, model/effort mapping "
             "and gaps before changing advice. No guide or review lock was changed.",
             "Full rows, source URLs, digests and calculated points: benchmark-data.json.", "",
             "| Source | State | Publication/release |", "|---|---|---|"]
    failures = []
    for name, source in sources.items():
        version = source.get("published", source.get("release", ", ".join(source.get("metadata", []))))
        lines.append(f"| {name} | {source['status']} | {version or 'Unverified'} |")
        if source["status"] != "ok":
            failures.append(f"- {name}: {source['error']}")
    lines += ["", *failures]
    live = sources.get("LiveBench", {})
    if live.get("status") == "ok":
        lines += ["", "## Cost-performance frontiers", live["limits"],
                  "Candidate set: all complete model rows in this LiveBench release. Higher score, "
                  "lower estimated USD per successful task; each suite compared separately. "
                  "A frontier is an observed tradeoff, not a recommendation or significant rank."]
        for suite, points in live["frontiers"].items():
            lines += [f"\n### {suite}", "| Model ID | Score | USD/success |", "|---|---:|---:|"]
            lines += [f"| {p['model']} | {p['score']:.2f} | {p['cost']:.4f} |"
                      for p in sorted(points, key=lambda p: p["cost"])]
    write_snapshot(directory / "benchmark-report.md", "\n".join(lines) + "\n")
    return directory / "benchmark-report.md"


def write_snapshot(path, text):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(text)
            stream.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def account_observation(backend, account):
    context = providers.context()
    if backend:
        context["quotas"] = [row for row in context["quotas"]
                             if row["backend"] == backend and (account is None or row["account"] == account)]
        context["profiles"] = {key: value for key, value in context["profiles"].items() if key == backend}
    return context


def snapshot():
    path = CACHE / "benchmark-data.json"
    if not path.is_file():
        raise ValueError("benchmark snapshot missing; run model-guide refresh --prepare")
    return loads(path.read_text())


def search(domain, query="", limit=5, catalog=None, *, data=None):
    """Bounded offline evidence, grouped by source; never blend unlike metrics."""
    data = snapshot() if data is None else data
    native = coverage.summarize(catalog, data, query) if catalog is not None else None

    unsupported = set()

    def selected(label, effort=coverage.UNSPECIFIED):
        if native is None:
            return name_matches(query, label)
        models = [m for m in native["models"] if coverage.matches(m, label)]
        if models and all(coverage.supported(m, label, effort) is False for m in models):
            unsupported.add((label, effort))
            return False
        return bool(models)
    suite = {"overall": "Overall", "reasoning": "Reasoning", "coding": "Coding", "backend": "Coding",
             "design": "Design",
             "browser": "Browser", "research": "Research", "data": "Data Analysis"}.get(domain)
    arena_config = {"overall": "agent", "design": "webdev", "writing": "text", "vision": "vision",
                    "documents": "document", "research": "search", "tools": "agent"}.get(domain)
    wanted = ({"LiveBench"} if suite else set())
    if arena_config:
        wanted.add("Arena/" + arena_config)
        stem = {"text": "text", "vision": "vision", "search": "search", "agent": "agent"}.get(arena_config)
        if stem:
            wanted.update("Arena/" + key for key in ARENA_BOARDS if key.startswith(stem + "_"))
    if domain in ("overall", "finance", "legal", "tax", "data"):
        wanted.add("Vals Index")
    if domain in ("backend", "coding", "terminal"):
        wanted.add("Vals Terminal-Bench")
    if domain in ("backend", "coding", "debugging"):
        wanted.add("SWE-bench")
    if domain == "coding":
        wanted.add("LiveCodeBench")
    if domain == "tools":
        wanted.add("BFCL")
    if domain == "browser":
        wanted.add("OSWorld")
    wanted.update({"performance": {"KernelBench.com"}, "debugging": {"Bug Hunt"}}.get(domain, set()))
    if domain == "overall" or query:
        wanted.add("Artificial Analysis")
    results = {}
    for name, source in data["sources"].items():
        if name not in wanted:
            continue
        info = {key: value for key, value in source.items()
                if key not in ("rows", "tables", "cost_rows", "points", "frontiers", "sha256", "efforts",
                               "effort_tradeoffs", "categories", "weights", "measurements", "raw")}
        if source["status"] != "ok":
            results[name] = info
            continue
        if "measurements" in source:
            def relevant(row):
                if name == "Vals Index":
                    task = row["configuration"].split(":", 1)[0]
                    return task in {"overall": ("overall",), "finance": ("finance_agent", "emb"),
                                   "data": ("finance_agent", "emb"), "legal": ("legal_research",
                                   "legal_agent_benchmark"), "tax": ("tax_agent_bench",)}.get(domain, ())
                if name == "Vals Terminal-Bench":
                    return row["configuration"].startswith("overall:")
                if name == "Artificial Analysis":
                    return row["metric"] == "artificial_analysis_intelligence_index"
                return True

            raw_matches = [r for r in source["measurements"] if relevant(r)
                           and selected(r["model"], r["effort"])]
            matches = specialists.cohorts(raw_matches) if name == "Bug Hunt" else raw_matches
            info["unverified_measurements"] = sum(r["score"] is None for r in matches)
            info["run_dates"] = [r["date"] for r in raw_matches]
            # Bound each metric/hardware/harness/cost basis independently; never merge units.
            groups = {}
            for row in matches:
                if row["score"] is None:
                    continue
                groups.setdefault((row["metric"], row["unit"], row["direction"],
                                   row["harness"], row.get("harness_version"), row.get("configuration"),
                                   row["cost_kind"]), []).append(row)
            info["measurements"] = []
            for key, rows in sorted(groups.items(), key=lambda item: str(item[0])):
                quality = sorted(rows, key=lambda r: (r["score"] is None,
                    -(r["score"] or 0) if r["direction"] == "higher" else (r["score"] or 0), r["model"]))
                points = [{"model": i, "score": (r["score"] if r["direction"] == "higher" else -r["score"])
                           if r["score"] is not None else None, "cost": r["cost"]}
                          for i, r in enumerate(rows)]
                efficient = sorted(frontier(points), key=lambda p: (p["cost"], -p["score"]))
                found = quality[:limit] + [rows[p["model"]] for p in efficient[:limit]]
                info["measurements"].extend(r for i, r in enumerate(found) if r not in found[:i])
            info["measurements"].sort(key=lambda r: (
                harness.native(r["harness"], catalog["backend"]) is not True if catalog else False,
                r["metric"], r["unit"], -r["score"] if r["direction"] == "higher" else r["score"],
                r["model"], str(r["effort"]), str(r["harness"]), str(r["cost_kind"])))
            info["frontier_scope"] = "Per metric/unit/hardware/harness/cost basis; not an aggregate rank."
        elif name == "LiveBench":
            assert suite is not None
            values = source["points"][suite]
            matches = [p for p in values if selected(p["model"], source["efforts"].get(p["model"]))]
            efficient = sorted(frontier(matches), key=lambda p: (p["cost"], -p["score"]))
            pareto = {p["model"] for p in efficient}
            info["metric"] = suite + " score"
            info["cost_metric"] = "estimated USD/success"
            quality = sorted(matches, key=lambda p: (p["score"] is None, -(p["score"] or 0)))
            for field, points in (("results", quality), ("efficient_results", efficient)):
                info[field] = [{"model": p["model"], "effort": source["efforts"].get(p["model"]),
                                "score": p["score"], "usd_per_success": p["cost"],
                                "time_per_task": None, "on_frontier": p["model"] in pareto}
                               for p in points[:limit]]
            info["efficient_matches"] = len(efficient)
            info["frontier_scope"] = (
                "Matching candidates in this release/suite after native/query filtering; "
                "higher score, lower estimated USD/success. Not subscription usage.")
        elif name.startswith("Arena/"):
            matches = [r for r in source["rows"] if r.get("category", "overall") == "overall"
                       and selected(r["model_name"])]
            info["results"] = sorted(matches, key=lambda r: r["rank"])[:limit]
        else:
            info["tables"] = []
            matches = []
            for table in source["tables"]:
                header = next(i for i, row in enumerate(table) if any("Model" in c for c in row))
                model_column = next(i for i, cell in enumerate(table[header]) if "Model" in cell)
                start = header + 1
                # Multi-level headers belong to the evidence, not to the model search.
                while start < len(table) and not any(
                    re.fullmatch(r"\$?\d+(?:[.,]\d+)*(?:\s*%|[kKmM])?", c)
                    for c in table[start][1:]):
                    start += 1
                found = [r for r in table[start:] if selected(r[model_column])]
                matches.extend(found)
                if name != "Artificial Analysis" or domain == "overall":
                    info["tables"].append(table_views(table[header:start], found, limit))
            trades = [r for r in source.get("effort_tradeoffs", [])
                      if selected(r["model"], r["from"]) and selected(r["model"], r["to"])]
            info["effort_tradeoffs"] = trades[:limit]
            info["effort_tradeoff_matches"] = len(trades)
            if trades:
                info["comparison_order"] = "Increasing measured cost; no universal effort order."
            if name == "Artificial Analysis" and domain != "overall":
                info["metric_scope"] = "Broad-index effort tradeoffs; not a domain score."
        info["matches"] = len(matches)
        info["limit_per_table"] = limit
        results[name] = info
    if native is not None:
        groups = []
        for info in results.values():
            returned = []
            # Interleave views so the native context budget also preserves cheap candidates.
            for index in range(limit):
                for field in ("results", "efficient_results"):
                    if index < len(info.get(field, [])):
                        row = info[field][index]
                        returned.append(row.get("model", row.get("model_name", "")))
            returned.extend(r["model"] for r in info.get("effort_tradeoffs", []))
            returned.extend(r["model"] for r in info.get("measurements", []))
            for table in info.get("tables", []):
                header = next(r for r in table["headers"] if any("Model" in c for c in r))
                index = next(i for i, c in enumerate(header) if "Model" in c)
                for position in range(limit):
                    for field in ("rows", "efficient_rows"):
                        if position < len(table.get(field, [])):
                            returned.append(table[field][position][index])
            groups.append(list(dict.fromkeys(returned)))
        returned = [group[i] for i in range(max(map(len, groups), default=0))
                    for group in groups if i < len(group)]
        all_models = native.pop("models")
        candidates = [{key: value for key, value in m.items() if key not in ("sources", "coverage")}
                      for m in all_models if any(coverage.matches(m, label) for label in returned)]
        candidates.sort(key=lambda m: next(i for i, label in enumerate(returned)
                                            if coverage.matches(m, label)))
        native["models"] = candidates[:limit]
        native["matches"] = len(candidates)
        native["limit"] = limit
        missing = [m["id"] for m in all_models if not m["sources"]]
        native["unmeasured_count"] = len(missing)
        native["unmeasured_ids"] = missing[:limit]
        native["coverage_command"] = "model-guide models --backend " + native["backend"] + " --json"
    return {"retrieved": data["retrieved"], "domain": domain, "query": query,
            "missing_sources": sorted(wanted - data["sources"].keys()),
            "unsupported_effort_count": len(unsupported),
            "native_catalog": native,
            "coverage_notes": (["Backend uses coding and terminal proxies; database design, security "
                                "and service architecture are not directly measured."] if domain == "backend"
                               else ["Writing uses style-controlled text preference, not a dedicated "
                                     "writing-quality or factual-accuracy benchmark."] if domain == "writing"
                               else ["GPU/kernel engineering only; separate operations/hardware/units, "
                                     "not general CPU/server performance."] if domain == "performance"
                               else ["Planted-bug discovery without a bug report in two repos, judge-graded; "
                                     "not production incident diagnosis."] if domain == "debugging"
                               else []),
            "sources": results, "gaps": "Missing measurements/settings are unknown; source scales differ.",
            "review_sources": (
                ["https://longbench2.github.io/"] if domain == "long-context" else
                ["https://gorilla.cs.berkeley.edu/leaderboard.html"] if domain == "tools" else []),
            "full_snapshot": str(CACHE / "benchmark-data.json")}


def name_matches(query, value):
    # Display names and native IDs differ in separators; search never establishes identity.
    return coverage.query_matches(query, value)
