"""Generated native-to-benchmark coverage; lexical matches never establish entitlement."""

import re
from functools import lru_cache

UNSPECIFIED = object()
EFFORT_LABEL = (r"minimal|low|medium|high|xhigh|max|ultra|adaptive|deep|instant|thinking|non-thinking|"
                r"reasoning|non-reasoning|enabled|disabled|none|default")
RUN_SETTING = re.compile(r" \(((?:" + EFFORT_LABEL + r")(?:(?: with |, )[^()]*Fallback)?)\)$", re.I)


@lru_cache(maxsize=8192)
def key(value):
    return tuple(re.findall(r"[a-z]+|\d+", value.casefold()))


def query_matches(query, value):
    needle, tokens = key(query), key(value)
    # Discovery permits word gaps/prefixes; numeric release tokens remain exact.
    position = 0
    for token in tokens:
        if position < len(needle) and (needle[position] == token or (
                needle[position].isalpha() and token.startswith(needle[position]))):
            position += 1
    return position == len(needle)


@lru_cache(maxsize=8192)
def setting(label, effort=UNSPECIFIED):
    suffix = RUN_SETTING.search(label) if effort is UNSPECIFIED else None
    value = (suffix[1] if suffix else None) if effort is UNSPECIFIED else effort
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("invalid reasoning effort")
    value = value.casefold().split(", ", 1)[0].removesuffix(" with fallback")
    return value if value and value != "default" and re.fullmatch(r"[\w-]+", value) else None


def supported(model, label, effort=UNSPECIFIED):
    value = setting(label, effort)
    return (value in [e.casefold() for e in model["efforts"]]
            if value and model["efforts"] is not None else None)


@lru_cache(maxsize=8192)
def model_key(label):
    # Strip a trailing run-setting field, never a parenthesized numeric release.
    label = RUN_SETTING.sub("", label)
    return key(label.rsplit("/", 1)[-1])


def matches(model, label):
    # Provider routing and parenthesized run settings are not model identity.
    # A native ID can also name the complete bundled setting (e.g. Flash-High).
    return benchmark_key(model) in (model_key(label), key(label.rsplit("/", 1)[-1]))


def benchmark_key(model):
    return model_key(model.get("benchmark_model", model["model"]))


def canonical_catalog(catalog, preferred=None):
    """Deduplicate proved native aliases; retain distinct OpenCode provider routes."""
    groups = {}
    for model in catalog["models"]:
        provider = model["id"].partition("/")[0] if catalog["backend"] == "opencode" else ""
        groups.setdefault((model["model"], provider), []).append(model)
    models = []
    for aliases in groups.values():
        chosen = min(aliases, key=lambda m: (
            preferred not in (m["id"], m["model"]), m["id"] == "default", len(m["id"]), m["id"]))
        ids = sorted({a for m in aliases for a in m.get("aliases", [m["id"]])})
        models.append({**chosen, "aliases": ids})
    return {**catalog, "models": models}


def labels(source):
    if "measurements" in source:
        for row in source["measurements"]:
            yield row["model"], row["effort"]
    elif "points" in source:
        for row in source["points"].get("Overall", []):
            yield row["model"], source.get("efforts", {}).get(row["model"])
    elif "rows" in source:
        for row in source["rows"]:
            yield row["model_name"], setting(row["model_name"])
    else:
        for table in source.get("tables", []):
            header = next((r for r in table if "Model" in r or "Models" in r), None)
            if header is None:
                continue
            index = header.index("Model" if "Model" in header else "Models")
            for row in table[table.index(header) + 1:]:
                if len(row) > index and row[index]:
                    yield row[index], setting(row[index])


def summarize(catalog, snapshot, query=""):
    rows = []
    observations = {}
    for name, source in snapshot["sources"].items():
        if source["status"] != "ok":
            continue
        indexed = observations[name] = {}
        for label, effort in labels(source):
            for identity in {model_key(label), key(label.rsplit("/", 1)[-1])}:
                indexed.setdefault(identity, []).append((label, effort))
    for model in catalog["models"]:
        if query and not any(query_matches(query, value)
                             for value in (model["id"], model["model"], *model.get("aliases", []))):
            continue
        measured = {}
        for name, evidence in observations.items():
            found = []
            for label, effort in evidence.get(benchmark_key(model), []):
                entry = {"label": label, "setting": setting(label, effort),
                         "native_effort_supported": supported(model, label, effort)}
                if entry not in found:
                    found.append(entry)
            if found:
                measured[name] = found
        rows.append({**model, "coverage": ("reviewed model link; route performance unverified"
                     if model.get("benchmark_model") else "matched") if measured
                     else "no exact benchmark identity",
                     "sources": measured})
    return {**catalog, "benchmark_retrieved": snapshot["retrieved"], "models": rows,
            "matching": "Exact model tokens after separating provider routing and run settings; "
                        "no family/version substitution. Check harness and configuration comparability."}


def audit(snapshot, catalog=None):
    """Coverage is computed from the retained raw export, never the bounded query view."""
    rows = []
    for name, source in snapshot["sources"].items():
        labels_seen = sorted({label for label, _ in labels(source)}) if source["status"] == "ok" else []
        unmapped = ([label for label in labels_seen if not any(matches(m, label)
                                                              for m in catalog["models"])]
                    if catalog is not None else None)
        current = sorted({RUN_SETTING.sub("", label) for label in unmapped or [] if re.search(
            r"\bgpt[- ]6|\bclaude[- ](?:opus|sonnet|haiku|fable)[- ]5|\bgemini[- ]4", label, re.I)})
        details = source.get("coverage", {})
        records = source.get("rows", [])
        available = details.get("available_rows", len(labels_seen))
        captured = details.get("captured_rows", len(labels_seen))
        if source["status"] != "ok":
            available, captured, unmapped = None, 0, None
        published = source.get("published") or source.get("release")
        dates = [r.get("date") for r in source.get("measurements", []) if r.get("date")]
        newest = max(dates) if dates else published
        efforts = details.get("efforts", sorted({effort for _, effort in labels(source) if effort}))
        config = details.get("categories", sorted({r.get("configuration") for r in
            source.get("measurements", []) if r.get("configuration")}))
        arena_count = sum(n.startswith("Arena/") for n in snapshot["sources"])
        available_configs = len(details.get("available_configs", [])) or "Unverified"
        endpoint = source.get("data_url") or source.get("url")
        if name == "LiveBench" and source.get("release"):
            endpoint = f"https://livebench.ai/data/{source['release']}/"
        elif name.startswith("Arena/"):
            endpoint = ("https://datasets-server.huggingface.co/parquet?"
                        "dataset=lmarena-ai%2Fleaderboard-dataset · config="
                        + source.get("config", "Unverified"))
        rows.append({"source": name, "status": source["status"],
            "endpoint": endpoint,
            "data_endpoints": list(source["sha256"]) if type(source.get("sha256")) is dict else [endpoint],
            "view": (f"latest split; all categories; {arena_count} of {available_configs} "
                     "modality/config exports"
                     if name.startswith("Arena/") else "current release; all model rows"
                     if name == "LiveBench" else "free API; not the commercial/agent dataset"
                     if name == "Artificial Analysis" and "measurements" in source else
                     "public-page table; API not used" if name == "Artificial Analysis" else
                     "all CSV receipts; superseded retained raw" if name == "Bug Hunt" else
                     "all audit outcomes; chosen cells not used as the run universe"
                     if name == "KernelBench.com" else "full published structured export"),
            "captured_rows": captured, "available_rows": available,
            "normalized_rows": len(source.get("measurements", records)),
            "efforts_captured": efforts,
            "configs_captured": [source["config"]] if name.startswith("Arena/") else config,
            "categories_captured": config if name.startswith("Arena/") else None,
            "efforts_available": efforts,
            "configs_available": details.get("available_configs", config),
            "newest_captured": newest, "newest_available": details.get("newest_available", published),
            "harness_captured": details.get("harness_captured", "not published"),
            "unmapped_count": len(unmapped) if unmapped is not None else None,
            "unmapped_current_family": current,
            "limits": source.get("limits"), "error": source.get("error")})
    rows.append({"source": "LongBench v2", "status": "reviewed-not-ingested",
        "endpoint": "https://github.com/THUDM/LongBench",
        "view": "503-question task dataset is not model results",
        "captured_rows": 0, "available_rows": None, "newest_captured": None, "newest_available": None,
        "harness_captured": "not published", "efforts_captured": [], "unmapped_count": None,
        "unmapped_current_family": [], "limits": "Official results are a static HTML table with CoT/length "
        "bins; no stable structured model-result export verified. Task JSON is not score evidence."})
    rows.append({"source": "AA coding agents", "status": "reviewed-not-ingested",
        "endpoint": "https://artificialanalysis.ai/agents/coding-agents",
        "view": "not the models API Coding Index; no documented free agent/scaffold export established",
        "captured_rows": 0, "available_rows": None, "newest_captured": None, "newest_available": None,
        "harness_captured": "no", "efforts_captured": [], "unmapped_count": None,
        "unmapped_current_family": []})
    return {"retrieved": snapshot["retrieved"], "backend": catalog["backend"] if catalog else None,
            "sources": rows,
            "scope": "Available means this official export, not unpublished runs or all historical releases. "
                     "Unknown is not zero. Run dates and dataset publication dates differ."}


def audit_table(result):
    lines = [result["scope"], "", "| Source | Endpoint / view | Efforts captured | Rows captured/available | "
             "Newest captured/source | Harness captured | Unmapped |", "|---|---|---|---|---|---|---|"]
    def shown(value):
        return "Unverified" if value is None else str(value).replace("|", "/")
    for row in result["sources"]:
        lines.append(f"| {row['source']} | {row['endpoint']} · {row['view']} | "
            f"{', '.join(row['efforts_captured']) or 'Unverified'} | {shown(row['captured_rows'])}/"
            f"{shown(row['available_rows'])} | {shown(row['newest_captured'])}/"
            f"{shown(row['newest_available'])} | {row['harness_captured']} | "
            f"{shown(row['unmapped_count'])} |")
    lines += [f"{row['source']} unmapped current-family: " + ", ".join(row["unmapped_current_family"])
              for row in result["sources"] if row["unmapped_current_family"]]
    return "\n".join(lines)
