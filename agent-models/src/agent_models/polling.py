"""Daily conditional probes; persistent validators and backoff, no agent or auto-apply."""

import csv
import fcntl
import hashlib
import io
import json
import os
import re
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request

from . import artificial, benchmarks, boards, kernel_source, specialists
from .state import HOME
from .transport import urlopen

STATE = HOME / "poll.json"
INTERVAL = 36 * 3600
MAX_BACKOFF = 14 * 86400


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def rows(url, raw):
    """Hash meaning, not markup, row order, signed links or generation timestamps."""
    text = raw.decode("utf-8")
    if url == artificial.API:
        value = benchmarks.loads(text)
        artificial.decode(value)
        return sorted(value["data"], key=lambda r: r["id"])
    if url == specialists.BUG:
        reader = csv.DictReader(io.StringIO(text))
        result = list(reader)
        if not result or any(None in r or None in r.values() for r in result):
            raise ValueError("invalid CSV probe")
        return sorted(result, key=lambda r: r["run"])
    if url == specialists.BUG_SUMMARY:
        data = benchmarks.loads(text)
        specialists.bug_hunt(data)
        return {"meta": data["meta"], "effort_annotations": sorted([
            {k: row[k] for k in ("id", "harness", "effort", "effort_status", "wall_note")}
            for row in data["runs"]], key=lambda r: r["id"])}
    if url == boards.BFCL:
        boards.bfcl_decode(text)
        return sorted(csv.DictReader(io.StringIO(text)), key=lambda r: r["Model"])
    if url == boards.BFCL_PAGE:
        return boards.bfcl_method(text)
    if url == specialists.KERNEL:
        value = specialists.obj(benchmarks.loads(text))
        return {k: value[k] for k in ("models", "benches", "methodology")}
    if url == kernel_source.CATALOG:
        value = specialists.obj(benchmarks.loads(text))
        return {"cells": sorted(specialists.sequence(value["cells"]), key=lambda r: r["id"]),
                "legend": value["legend"]}
    if url == kernel_source.MEGA:
        reader = csv.DictReader(io.StringIO(text))
        value = list(reader)
        if (not value or "run_id" not in (reader.fieldnames or [])
                or any(None in r or None in r.values() for r in value)):
            raise ValueError("invalid KernelBench Mega CSV")
        return sorted(value, key=lambda r: (r["run_id"], r["gpu"]))
    if "huggingface.co/api/datasets/" in url:
        value = specialists.sequence(benchmarks.loads(text))
        result = [specialists.text(specialists.obj(r["lfs"])["oid"]) for r in value
                  if r["type"] == "file" and "/latest-" in r["path"]]
        if not result:
            raise ValueError("Arena latest shard manifest absent")
        return sorted(result)
    if url.endswith(".csv"):
        return sorted(benchmarks.csv_rows(text), key=lambda r: r["model"])
    if url.endswith(".json"):
        value = benchmarks.loads(text)
        if url == boards.SWE:
            value["leaderboards"] = sorted(value["leaderboards"], key=lambda r: r["name"])
            for board in value["leaderboards"]:
                board["results"] = sorted(board["results"], key=lambda r: r["folder"])
        elif url == boards.OSWORLD:
            value["results"] = sorted(value["results"], key=lambda r: json.dumps(r, sort_keys=True))
        elif url == boards.LCB:
            value["performances"] = sorted(value["performances"], key=lambda r: (
                r["model"], r["date"], r["question_id"]))
            value["models"] = sorted(value["models"], key=lambda r: r["model_repr"])
        return value
    if url.endswith(".md"):
        return text.replace("\r\n", "\n")
    if url == benchmarks.LIVE:
        script = re.search(r'src="\./(static/js/main\.[a-z0-9]+\.js)"', text)
        if not script:
            raise ValueError("LiveBench release script changed")
        return script[1]
    parsed = benchmarks.Tables()
    parsed.feed(text)
    exports = sorted(set(re.findall(r'/_astro/benchmark_view_[A-Za-z0-9_.-]+\.json', text)))
    if exports:
        return {"exports": exports, "terminal_releases": sorted(set(re.findall(
            r"/benchmarks/terminal-bench-\d+(?:-\d+)*", text)))}
    tables = [t for t in parsed.tables if len(t) > 2 and any("Model" in c for r in t[:3] for c in r)]
    if not tables:
        raise ValueError("benchmark table absent")
    metadata = re.findall(r"(?:Version \d+(?:\.\d+)*|Updated \d{1,2}/\d{1,2}/\d{4})",
                          " ".join(parsed.text))
    releases = sorted(set(re.findall(r"/benchmarks/terminal-bench-\d+(?:-\d+)*", text)))
    return {"tables": tables, "metadata": metadata, "terminal_releases": releases}


def endpoints(snapshot):
    result = {}
    for name, source in snapshot.get("sources", {}).items():
        if name == "Artificial Analysis":
            # Website terms prohibit scraping; the manual page adapter is retained.
            result[name] = [artificial.API] if os.environ.get(artificial.KEY) else []
        elif name == "LiveBench":
            result[name] = [benchmarks.LIVE]
            if source.get("release"):
                result[name] += [f"{benchmarks.LIVE}data/{source['release']}/{f}"
                                 for f in ("table.csv", "cost.csv", "categories.json")]
        elif name.startswith("Arena/"):
            config = benchmarks.ARENA_BOARDS[name.removeprefix("Arena/")]
            result[name] = [f"https://huggingface.co/api/datasets/{benchmarks.DATASET}/tree/main/{config}"]
        elif name == "KernelBench.com":
            result[name] = [specialists.KERNEL, kernel_source.CATALOG, kernel_source.MEGA,
                            *kernel_source.MANIFESTS]
        elif name == "Bug Hunt":
            result[name] = [specialists.BUG, specialists.BUG_SUMMARY,
                "https://raw.githubusercontent.com/phuryn/bug-hunt-bench/main/results/run-notes.md"]
        elif name == "BFCL":
            result[name] = [boards.BFCL, boards.BFCL_PAGE]
        elif name in ("Vals Index", "Vals Terminal-Bench"):
            result[name] = [source.get("url", benchmarks.SOURCE_URLS[name])]
        else:
            result[name] = [source.get("data_url") or source.get("url", benchmarks.SOURCE_URLS[name])]
    return result


def baseline(source, url):
    """Bootstrap validators against evidence already retained, not an invented digest."""
    raw = source.get("raw")
    if "huggingface.co/api/datasets/" in url and type(source.get("sha256")) is dict:
        return digest(sorted(source["sha256"].values()))
    if url == benchmarks.LIVE and source.get("release_script"):
        return digest(source["release_script"])
    if "/data/" in url and "livebench.ai" in url:
        if url.endswith("table.csv") and source.get("rows"):
            return digest(sorted(source["rows"], key=lambda r: r["model"]))
        if url.endswith("cost.csv") and source.get("cost_rows"):
            return digest(sorted(source["cost_rows"], key=lambda r: r["model"]))
    if type(raw) is not dict:
        return None
    if url == specialists.KERNEL:
        value = raw.get("index", raw)
    elif url == kernel_source.CATALOG:
        value = raw.get("catalog")
    elif url == kernel_source.MEGA:
        value = raw.get("mega_csv")
    elif url in kernel_source.MANIFESTS:
        value = (raw.get("manifests") or [None, None])[kernel_source.MANIFESTS.index(url)]
    elif url == specialists.BUG:
        value = raw.get("runs_csv")
    elif url == specialists.BUG_SUMMARY:
        value = raw.get("summary_annotations")
    elif url.endswith("run-notes.md"):
        value = raw.get("run_notes_md")
    elif url == boards.BFCL:
        value = raw.get("csv")
    elif url == boards.BFCL_PAGE:
        return digest(raw["method"]) if raw.get("method") else None
    elif url.endswith(".json") or url == artificial.API:
        value = raw
    else:
        return None
    if value is None:
        return None
    body = value.encode() if isinstance(value, str) else json.dumps(value).encode()
    return digest(rows(url, body))


def request(url, validators):
    headers = {"User-Agent": "model-guide/0.1", **validators}
    if url == artificial.API:
        headers["x-api-key"] = os.environ[artificial.KEY]
    try:
        with urlopen(Request(url, headers=headers), timeout=25) as response:
            raw = response.read(benchmarks.MAX_BYTES + 1)
            if len(raw) > benchmarks.MAX_BYTES:
                raise ValueError("source exceeds size limit")
            if 'rel="next"' in response.headers.get("Link", ""):
                raise ValueError("paginated probe requires source review")
            if url == artificial.API and os.environ[artificial.KEY].encode() in raw:
                raise ValueError("Artificial Analysis response refused")
            if url == artificial.API and any(os.environ[artificial.KEY] in response.headers.get(h, "")
                                            for h in ("ETag", "Last-Modified")):
                raise ValueError("Artificial Analysis validator refused")
            if url == artificial.API and response.url != artificial.API:
                raise ValueError("Artificial Analysis API redirect refused")
            return response.status, dict(response.headers.items()), raw
    except HTTPError as error:
        return error.code, dict(error.headers.items()), b""
    except Exception:
        raise ValueError("benchmark probe transport failed") from None


def retry_after(headers, now):
    value = headers.get("retry-after", "")
    if value.isdecimal():
        return now + int(value)
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is not None:
            return parsed.timestamp()
    except (ValueError, TypeError, OverflowError):
        pass
    return now


def load():
    if not STATE.is_file():
        return {"sources": {}, "hosts": {}}
    value = benchmarks.loads(STATE.read_text())
    if type(value) is not dict or set(value) != {"sources", "hosts"}:
        raise ValueError("invalid polling state")
    if any(type(value[k]) is not dict for k in value):
        raise ValueError("invalid polling state")
    for host, until in value["hosts"].items():
        specialists.text(host)
        if specialists.numeric(until) is None:
            raise ValueError("invalid host backoff")
    for name, entry in value["sources"].items():
        specialists.text(name)
        entry = specialists.obj(entry)
        if set(entry) - {"endpoints", "next_due", "failures", "refresh_needed"}:
            raise ValueError("invalid source poll state")
        if "next_due" in entry and specialists.numeric(entry["next_due"]) is None:
            raise ValueError("invalid polling due time")
        if "failures" in entry and (type(entry["failures"]) is not int or not 0 <= entry["failures"] <= 10):
            raise ValueError("invalid polling failure count")
        if "refresh_needed" in entry:
            specialists.boolean(entry["refresh_needed"])
        for url, record in specialists.obj(entry["endpoints"]).items():
            parsed = urlsplit(specialists.text(url))
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError("invalid polling endpoint")
            record = specialists.obj(record)
            if (set(record) - {"digest", "etag", "last_modified", "exports"}
                    or not re.fullmatch(r"[0-9a-f]{64}", specialists.text(record.get("digest")))):
                raise ValueError("invalid endpoint poll state")
            for field in ("etag", "last_modified"):
                if field in record and any(ord(c) < 32 for c in specialists.text(record[field])):
                    raise ValueError("invalid HTTP validator")
            if "exports" in record:
                for path in specialists.sequence(record["exports"]):
                    if not re.fullmatch(r"/_astro/benchmark_view_[A-Za-z0-9_.-]+\.json", path):
                        raise ValueError("invalid Vals export path")
    return value


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    benchmarks.write_snapshot(STATE, json.dumps(state, sort_keys=True, allow_nan=False) + "\n")
    STATE.chmod(0o600)


def available(url):
    if STATE.is_file() and load()["hosts"].get(urlsplit(url).netloc, 0) > time.time():
        raise ValueError("source is in server backoff; manual force does not bypass it")


def defer(url, headers):
    """A refresh's dependent fetches share the poller's host backoff."""
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with STATE.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = time.time()
        headers = {k.casefold(): v for k, v in headers.items()}
        until = max(now + INTERVAL, retry_after(headers, now))
        reset = headers.get("x-ratelimit-reset", "")
        if headers.get("x-ratelimit-remaining") == "0" and reset.isdecimal():
            until = max(until, int(reset))
        state = load()
        host = urlsplit(url).netloc
        state["hosts"][host] = max(state["hosts"].get(host, 0), until)
        save(state)


def check(snapshot, *, now=None):
    """Return changed source names and reusable probe bodies. Do not accept digests yet."""
    now = time.time() if now is None else now
    state = load()
    changed, fetched, messages = [], {}, []
    for name, urls in endpoints(snapshot).items():
        entry = state["sources"].setdefault(name, {"endpoints": {}})
        if not urls:
            messages.append(f"{name}: automatic poll needs ARTIFICIAL_ANALYSIS_API_KEY; no website requests")
            continue
        if entry.get("next_due", 0) > now:
            continue
        different, failed = False, False
        for url in urls:
            host = urlsplit(url).netloc
            if state["hosts"].get(host, 0) > now:
                entry["next_due"] = max(entry.get("next_due", 0), state["hosts"][host])
                failed = True
                break
            old = entry["endpoints"].get(url, {})
            prior_digest = old.get("digest")
            if "/_astro/benchmark_view_" in url and not old:
                prior_digest = next((v["digest"] for k, v in entry["endpoints"].items()
                                     if "/_astro/benchmark_view_" in k), None)
            validators = {header: old[field] for header, field in (
                ("If-None-Match", "etag"), ("If-Modified-Since", "last_modified")) if old.get(field)}
            headers = {}
            status = None
            try:
                if prior_digest is None:
                    prior_digest = baseline(snapshot["sources"].get(name, {}), url)
                status, headers, raw = request(url, validators)
                headers = {k.casefold(): v for k, v in headers.items()}
                delay = max(now + INTERVAL, retry_after(headers, now))
                deadline = retry_after(headers, now)
                reset = headers.get("x-ratelimit-reset", "")
                if headers.get("x-ratelimit-remaining") == "0" and reset.isdecimal():
                    deadline = max(deadline, int(reset))
                if deadline > now:
                    state["hosts"][host] = max(state["hosts"].get(host, 0), deadline)
                poll_interval = headers.get("x-poll-interval", "")
                if poll_interval.isdecimal():
                    delay = max(delay, now + int(poll_interval))
                if status == 304:
                    if "digest" not in old:
                        raise ValueError("304 without a prior digest")
                    item = dict(old)
                elif status == 200:
                    value = rows(url, raw)
                    item = {"digest": digest(value)}
                    if type(value) is dict and "exports" in value:
                        urls.extend(boards.VALS + path for path in value["exports"])
                        item["exports"] = value["exports"]
                    else:
                        different |= item["digest"] != prior_digest
                    fetched[url] = raw
                else:
                    raise ValueError(f"HTTP {status}")
                for header, field in (("etag", "etag"), ("last-modified", "last_modified")):
                    if header in headers:
                        item[field] = headers[header]
                entry["endpoints"][url] = item
                if status == 304 and item.get("exports"):
                    urls.extend(boards.VALS + path for path in item["exports"])
                entry["next_due"] = max(entry.get("next_due", 0), delay)
            except (ValueError, OSError, KeyError, TypeError):
                failures = min(entry.get("failures", 0) + 1, 10)
                wait = min(INTERVAL * 2 ** (failures - 1), MAX_BACKOFF)
                until = max(now + wait, retry_after(headers, now))
                reset = headers.get("x-ratelimit-reset", "")
                if headers.get("x-ratelimit-remaining") == "0" and reset.isdecimal():
                    until = max(until, int(reset))
                entry.update(failures=failures, next_due=until)
                if status in (429, 503) or retry_after(headers, now) > now or (
                        headers.get("x-ratelimit-remaining") == "0"):
                    state["hosts"][host] = max(state["hosts"].get(host, 0), until)
                reason = f" (HTTP {status})" if status is not None and status not in (200, 304) else ""
                messages.append(f"{name}: check unavailable{reason}; backed off until "
                                + datetime.fromtimestamp(until, UTC).isoformat())
                failed = True
                break
        if not failed:
            entry["failures"] = 0
            if different or entry.get("refresh_needed"):
                entry["refresh_needed"] = True
                changed.append(name)
    save(state)
    return changed, fetched, messages


def accept(names):
    state = load()
    for name in names:
        state["sources"][name]["refresh_needed"] = False
    save(state)
