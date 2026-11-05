"""Artificial Analysis's documented free API; never store authentication material."""

import hashlib
import os
from dataclasses import asdict
from datetime import date
from urllib.error import HTTPError

from . import benchmarks, coverage, specialists

API = "https://artificialanalysis.ai/api/v2/data/llms/models"
KEY = "ARTIFICIAL_ANALYSIS_API_KEY"


def speed(row, options):
    """Legacy median fields; do not relabel them with newer v3 mean/TTFT semantics."""
    prompt = options.get("prompt_length", "medium (documented default: 1k input tokens)")
    if type(prompt) is str:
        specialists.text(prompt)
    elif specialists.numeric(prompt) is None or prompt <= 0:
        raise ValueError("invalid AA speed prompt length")
    parallel = options.get("parallel_queries")
    if parallel is not None:
        specialists.count(parallel)
    return {"median_output_tokens_per_second": specialists.numeric(
                row.get("median_output_tokens_per_second")),
            "median_time_to_first_token_seconds": specialists.numeric(
                row.get("median_time_to_first_token_seconds")),
            "provider": None, "methodology_version": "Unverified (legacy free API)",
            "workload": {"prompt_length": prompt, "parallel_queries": parallel}, "source": API,
            "scope": "Legacy API median speed; serving endpoint, TTFT/reasoning inclusion and "
                     "task completion time unverified. TTFT is not first-answer-token latency."}


def with_speed(source):
    """Recover already-retained raw fields in memory; no fetch or snapshot mutation."""
    raw = source.get("raw")
    if type(raw) is not dict or "status" not in raw:
        return source
    retained = {identifier: {"speed": speed(row, options), "model_metadata": model_metadata(row)}
                for row, identifier, options in records(raw)}
    return {**source, "measurements": [
        {**row, **retained[row["source_id"]]} if row.get("source_id") in retained
        and row["metric"] == "artificial_analysis_intelligence_index" else row
        for row in source.get("measurements", [])]}


def model_metadata(row):
    released = row.get("release_date")
    return {"release_date": date.fromisoformat(specialists.text(released)).isoformat()
            if released is not None else None, "source": API}


def records(raw):
    data = specialists.obj(raw)
    if type(data["status"]) is not int or data["status"] != 200:
        raise ValueError("Artificial Analysis API status is not 200")
    ids = set()
    options = specialists.obj(data.get("prompt_options", {}))
    for item in specialists.sequence(data["data"]):
        row = specialists.obj(item)
        identifier = specialists.text(row["id"])
        if identifier in ids:
            raise ValueError("duplicate Artificial Analysis model ID")
        ids.add(identifier)
        yield row, identifier, options
    if not ids:
        raise ValueError("empty Artificial Analysis API data")


def decode(raw):
    result = []
    for row, identifier, options in records(raw):
        label = specialists.text(row["name"])
        match = coverage.RUN_SETTING.search(label)
        configuration = match[1].partition(", ")[2] if match and ", " in match[1] else (
            "with fallback" if match and "with fallback" in match[1].casefold() else None)
        metadata = model_metadata(row)
        specialists.text(row["slug"])
        creator = specialists.obj(row["model_creator"])
        for field in ("id", "name", "slug"):
            specialists.text(creator[field])
        evaluations = specialists.obj(row["evaluations"])
        # API token prices are not a task-cost estimate or subscription allowance.
        for value in specialists.obj(row["pricing"]).values():
            specialists.numeric(value)
        performance = speed(row, options)
        for metric, value in evaluations.items():
            score = specialists.numeric(value)
            measurement = asdict(specialists.Measurement(
                label, label, coverage.setting(label), None, specialists.text(metric), score,
                "published index" if metric.endswith("_index") else "published value (unit Unverified)",
                "higher", None, None, None, None, None,
                "Artificial Analysis free API; task cost, run date, harness and method version "
                "not published by this endpoint. Native effort verified only when named explicitly.",
                configuration=configuration, source_id=identifier))
            if metric == "artificial_analysis_intelligence_index":
                measurement["speed"] = performance
                measurement["model_metadata"] = metadata
            result.append(measurement)
    return result


def load():
    key = os.environ.get(KEY)
    if not key:
        # Explicit manual refresh retains the existing public-page adapter.
        # Scheduled polling does not scrape AA: its website terms prohibit it.
        return benchmarks.webpage(benchmarks.SOURCE_URLS["Artificial Analysis"])
    try:
        raw = benchmarks.fetch_bytes(API, {"x-api-key": key})
        if key.encode() in raw:
            raise ValueError("Artificial Analysis response refused")
        data = benchmarks.loads(raw.decode("utf-8"))
        rows = decode(data)
    except HTTPError as error:
        raise ValueError(f"Artificial Analysis API unavailable (HTTP {error.code})") from None
    except Exception:
        # Even mocked transports or malformed responses must not echo a credential.
        raise ValueError("Artificial Analysis API request or schema failed") from None
    return {"url": "https://artificialanalysis.ai/", "data_url": API,
            "metadata": ["Free API; methodology version Unverified"], "raw": data,
            "measurements": rows, "sha256": hashlib.sha256(raw).hexdigest(),
            "limits": "Attribution: Artificial Analysis (https://artificialanalysis.ai/). "
                      "Free API coverage differs from the website/commercial API; effort/configuration "
                      "coverage is not guaranteed. Token pricing is not task cost. No coding-agent "
                      "scaffold or per-effort task-cost curve is supplied by the documented endpoint.",
            "coverage": {"available_rows": len(data["data"]), "captured_rows": len(data["data"]),
                         "harness_captured": "not published"}}
