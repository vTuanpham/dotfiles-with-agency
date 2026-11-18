"""Artificial Analysis's documented free API; never store authentication material."""

import hashlib
import os
from dataclasses import asdict
from datetime import date
from urllib.error import HTTPError

from . import benchmarks, coverage, specialists

# The free tier's models list (https://artificialanalysis.ai/data-api/docs): page-numbered, 200 a page.
# It replaced /api/v2/data/llms/models, which now answers 410; snapshots saved from that one still decode.
API = "https://artificialanalysis.ai/api/v2/language/models/free"
KEY = "ARTIFICIAL_ANALYSIS_API_KEY"
MAX_PAGES = 10


def api_page(url):
    if url == API:
        return 1
    if url.startswith(API + "?page="):
        value = url.removeprefix(API + "?page=")
        if not value.isdecimal() or not 1 <= int(value) <= MAX_PAGES:
            raise ValueError("invalid Artificial Analysis page URL")
        return int(value)
    return None


def pagination(page, number):
    value = specialists.obj(page["pagination"])
    if (any(type(value[k]) is not int or value[k] < 1 for k in ("page", "page_size", "total_pages"))
            or value["page"] != number or not number <= value["total_pages"] <= MAX_PAGES
            or type(value["has_more"]) is not bool
            or value["has_more"] != (number < value["total_pages"])):
        raise ValueError("invalid Artificial Analysis pagination")
    return value


def speed(row, options):
    """Keep current headline means separate from retained legacy median observations."""
    if "performance_v3" in row:
        figures = None if row["performance_v3"] is None else specialists.obj(row["performance_v3"])
        return {key: specialists.numeric(figures["mean_" + key]) if figures is not None else None for key in (
                    "output_tokens_per_second", "time_to_first_token_seconds",
                    "time_to_first_answer_token_seconds")} | {
            "provider": None, "statistic": "headline mean", "methodology_version": "v3",
            "workload": {"mix": "single-request and multi-turn", "window": "trailing 5 days"},
            "source": API,
            "scope": "AA performance-endpoint means, or the median of endpoint means; "
                     "end-to-end output speed includes reasoning and first-token time. "
                     "Provider identity, exact workloads and window end are not in the free response. "
                     "First-token and first-answer-token latency are separate; neither is task duration.",
        }
    prompt = options.get("prompt_length", "medium (documented default: 1k input tokens)")
    if type(prompt) is str:
        specialists.text(prompt)
    elif specialists.numeric(prompt) is None or prompt <= 0:
        raise ValueError("invalid AA speed prompt length")
    parallel = options.get("parallel_queries")
    if parallel is not None:
        specialists.count(parallel)
    # the current endpoint nests the medians under "performance"; the removed one put them on the model
    figures = row["performance"] if type(row.get("performance")) is dict else row
    return {"output_tokens_per_second": specialists.numeric(
                figures.get("median_output_tokens_per_second")),
            "time_to_first_token_seconds": specialists.numeric(
                figures.get("median_time_to_first_token_seconds")),
            "time_to_first_answer_token_seconds": specialists.numeric(
                figures.get("median_time_to_first_answer_token_seconds")),
            "provider": None, "statistic": "median", "methodology_version": "Unverified (legacy free API)",
            "workload": {"prompt_length": prompt, "parallel_queries": parallel}, "source": API,
            "scope": "Legacy API median speed; serving endpoint, TTFT/reasoning inclusion and "
                     "task completion time unverified. TTFT is not first-answer-token latency."}


def with_observations(source):
    """Recover already-retained raw fields in memory; no fetch or snapshot mutation."""
    raw = source.get("raw")
    if type(raw) is not dict or "data" not in raw:
        return source
    retained = {identifier: index_facts(row, options)
                for row, identifier, options in records(raw)}
    return {**source, "measurements": [
        {**row, **retained[row["source_id"]]} if row.get("source_id") in retained
        and row["metric"] == "artificial_analysis_intelligence_index" else row
        for row in source.get("measurements", [])]}


def index_facts(row, options):
    cost = None
    block = row.get("artificial_analysis_intelligence_index_cost")
    if block is not None:
        block = specialists.obj(block)
        if specialists.numeric(block["total_cost"]) is None:
            raise ValueError("AA evaluation total cost must be a number")
        per_task = block["cost_per_task"]
        if per_task is not None:
            cost = specialists.numeric(specialists.obj(per_task)["total_cost"])
            if cost is None:
                raise ValueError("AA weighted per-task cost must be a number")
    return {"speed": speed(row, options), "model_metadata": model_metadata(row),
            "cost": cost, "cost_kind": "published" if cost is not None else None,
            "cost_basis": "USD/index task" if cost is not None else None,
            "caveat": "AA weighted index-evaluation cost, when published; not native route spend or "
                      "subscription use. Run date, harness and complete index method version are "
                      "unverified. Native effort is known only when explicitly named."}


def model_metadata(row):
    released = row.get("release_date")
    return {"release_date": date.fromisoformat(specialists.text(released)).isoformat()
            if released is not None else None, "source": API}


def records(raw):
    data = specialists.obj(raw)
    if "status" in data:  # a snapshot saved from the removed /data/llms/models endpoint
        if type(data["status"]) is not int or data["status"] != 200:
            raise ValueError("Artificial Analysis API status is not 200")
        options = specialists.obj(data.get("prompt_options", {}))
    else:
        specialists.text(data.get("tier"))
        # performance fields default to the long prompt (prompt_type, documented); the response does not say
        options = {"prompt_length": "long (documented default for the performance fields)"}
    ids = set()
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
        specialists.text(row["slug"])
        if row["model_creator"] is not None:
            creator = specialists.obj(row["model_creator"])
            for field in ("id", "name"):  # the free tier's creator has no slug
                specialists.text(creator[field])
        evaluations = specialists.obj(row["evaluations"])
        # API token prices are not a task-cost estimate or subscription allowance.
        for value in specialists.obj(row["pricing"]).values():
            specialists.numeric(value)
        facts = index_facts(row, options)
        for metric, value in evaluations.items():
            score = specialists.numeric(value)
            if score is None:  # null is "not measured", not a result
                continue
            measurement = asdict(specialists.Measurement(
                label, label, coverage.setting(label), None, specialists.text(metric), score,
                "published index" if metric.endswith("_index") else "published value (unit Unverified)",
                "higher", None, None, None, None, None,
                "Artificial Analysis free API; task cost, run date, harness and method version "
                "not published by this endpoint. Native effort verified only when named explicitly.",
                configuration=configuration, source_id=identifier))
            if metric == "artificial_analysis_intelligence_index":
                measurement.update(facts)
            result.append(measurement)
    return result


def load():
    key = os.environ.get(KEY)
    if not key:
        # Explicit manual refresh retains the existing public-page adapter.
        # Scheduled polling does not scrape AA: its website terms prohibit it.
        return benchmarks.webpage(benchmarks.SOURCE_URLS["Artificial Analysis"])
    try:
        pages, digest = [], hashlib.sha256()
        for number in range(1, MAX_PAGES + 1):
            raw = benchmarks.fetch_bytes(API if number == 1 else f"{API}?page={number}", {"x-api-key": key})
            if key.encode() in raw:
                raise ValueError("Artificial Analysis response refused")
            digest.update(raw)
            page = benchmarks.loads(raw.decode("utf-8"))
            if pages and (page["tier"] != pages[0]["tier"]
                          or page["intelligence_index_version"] != pages[0]["intelligence_index_version"]
                          or any(page["pagination"][k] != pages[0]["pagination"][k]
                                 for k in ("page_size", "total_pages"))):
                raise ValueError("Artificial Analysis pages changed during capture")
            pages.append(page)
            if not pagination(page, number)["has_more"]:
                break
        else:
            raise ValueError("Artificial Analysis page limit exceeded")
        data = {**pages[0], "data": [row for page in pages for row in specialists.sequence(page["data"])]}
        rows = decode(data)
    except HTTPError as error:
        raise ValueError(f"Artificial Analysis API unavailable (HTTP {error.code})") from None
    except Exception:
        # Even mocked transports or malformed responses must not echo a credential.
        raise ValueError("Artificial Analysis API request or schema failed") from None
    return {"url": "https://artificialanalysis.ai/", "data_url": API,
            "metadata": [f"Free API; Intelligence Index version {data.get('intelligence_index_version')} "
                         "as reported; methodology version otherwise Unverified"], "raw": data,
            "measurements": rows, "sha256": digest.hexdigest(),
            "limits": "Attribution: Artificial Analysis (https://artificialanalysis.ai/). "
                      "Free API coverage differs from the website/commercial API; effort/configuration "
                      "coverage is not guaranteed. Published weighted index-task cost is separate from "
                      "token pricing and native subscription use. Native harness and run dates are unknown.",
            "coverage": {"available_rows": len(data["data"]), "captured_rows": len(data["data"]),
                         "harness_captured": "not published"}}
