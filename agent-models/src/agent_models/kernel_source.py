"""Reconcile KernelBench's audits with its published-run/sweep inventories."""

import csv
import hashlib
import io
import re
from dataclasses import asdict, replace
from datetime import datetime
from urllib.error import HTTPError

from . import benchmarks
from . import specialists as s

ROOT = "https://raw.githubusercontent.com/Infatoshi/kernelbench.com/master/"
CATALOG = ROOT + "public/data/catalog.json"
MEGA = ROOT + "public/data/mega/results.csv"
MANIFESTS = [ROOT + f"benchmarks/{bench}/results/published_runs.json" for bench in ("cuda", "hard")]


def run_date(identifier):
    return (datetime.strptime(identifier[:8], "%Y%m%d").date().isoformat()
            if re.match(r"^\d{8}_", identifier) else None)


def missing_runs(index, catalog, mega, manifests, measured):
    """Inventories without a matching audit remain visible and never acquire a score."""
    names = {s.text(m["slug"]): s.text(m["name"]) for m in s.sequence(s.obj(index)["models"])}
    known = {(row.run_id, s.hardware_key(row.hardware)) for row in measured}
    result, details = [], {}
    for value in s.sequence(s.obj(catalog)["cells"]):
        row = s.obj(value)
        run = s.optional_text(row.get("run_id"))
        context = (run, s.hardware_key(row.get("gpu")))
        if not run or context in known:
            continue
        known.add(context)
        model = s.text(row["model"])
        bench, problem, gpu = (s.text(row[k]) for k in ("bench", "problem", "gpu"))
        if bench not in s.PROBLEMS:
            raise ValueError("unknown KernelBench catalog deck")
        s.boolean(row["correct"])
        s.numeric(row["score"])
        seconds = s.numeric(row.get("elapsed_seconds"))
        # GPU subfolders follow the source builder; unresolved/missing files stay unknown.
        prefix = "" if gpu == "rtxpro6000" else gpu + "/"
        details[(run, gpu)] = ROOT + "public/data/rundetail/" + prefix + run + ".json"
        result.append(s.Measurement(
            names.get(model, model), names.get(model, model), None, None,
            f"{bench}/{problem} · {gpu}", None, "Unverified (no matching audit)", "higher", 1,
            None, None, seconds, run_date(run), "Catalog receipt has no matching scored audit; not ranked.",
            run_id=run, hardware=gpu))
    reader = csv.DictReader(io.StringIO(mega))
    required = {"gpu", "harness", "model", "problem", "correct", "score", "elapsed_s", "run_id",
                "megakernel_judged"}
    if not reader.fieldnames or not required <= set(reader.fieldnames):
        raise ValueError("KernelBench Mega schema changed")
    for row in reader:
        if None in row or None in row.values():
            raise ValueError("ragged KernelBench Mega CSV")
        run = s.text(row["run_id"])
        for field in ("correct", "megakernel_judged"):
            if row[field] not in ("true", "false"):
                raise ValueError("invalid KernelBench CSV boolean")
        s.csv_number(row["score"])
        context = (run, s.hardware_key(row["gpu"]))
        if context in known:
            continue
        known.add(context)
        model, gpu, problem = (s.text(row[k]) for k in ("model", "gpu", "problem"))
        result.append(s.Measurement(
            model, model, None, s.optional_text(row["harness"]), f"mega/{problem} · {gpu}", None,
            "x vs baseline", "higher", 1, None, None, s.csv_number(row["elapsed_s"]), run_date(run),
            "Mega receipt has no matching audit; correctness alone is not audit eligibility.",
            run_id=run, hardware=gpu))
    for bench, manifest in zip(("cuda", "hard"), manifests):
        data = s.obj(manifest)
        gpu = s.text(data["hardware"])
        runs = s.sequence(data["run_ids"])
        if len(set(runs)) != len(runs):
            raise ValueError("duplicate KernelBench published run")
        for identifier in runs:
            run = s.text(identifier)
            context = (run, s.hardware_key(gpu))
            if context in known:
                continue
            known.add(context)
            result.append(s.Measurement(
                run, run, None, None, bench + "/operation Unverified · " + gpu, None,
                "Unverified", "higher", 1, None, None, None, run_date(run),
                "Published-run ID without an audit or catalog identity; no model/effort inferred from ID.",
                run_id=run, hardware=gpu))
    return result, details


def detail(row, raw):
    data = s.obj(raw)
    if s.text(data["run_id"]) != row.run_id:
        raise ValueError("KernelBench detail identity mismatch")
    if (data.get("gpu") is not None
            and s.hardware_key(s.text(data["gpu"])) != s.hardware_key(row.hardware)):
        raise ValueError("KernelBench detail hardware mismatch")
    stats = s.obj(data["stats"])
    # Routing and native CLI remain separate from a guessed model family.
    harness = s.optional_text(data.get("harness")) or row.harness
    return replace(row, harness=harness, effort=s.optional_text(data.get("effort")) or row.effort,
                   cost=s.numeric(stats.get("cost_usd")), cost_kind="published",
                   seconds=s.numeric(stats.get("agent_s")), time_basis="agent session")


def load():
    inputs = {url: benchmarks.fetch(url) for url in (s.KERNEL, CATALOG, MEGA, *MANIFESTS)}
    index, catalog = [benchmarks.loads(inputs[url]) for url in (s.KERNEL, CATALOG)]
    published, rows = s.kernel(index)
    manifests = [benchmarks.loads(inputs[url]) for url in MANIFESTS]
    extra, paths = missing_runs(index, catalog, inputs[MEGA], manifests, rows)
    rows += extra
    # Reuse unchanged run detail bodies from the previous private snapshot. They are
    # supporting metadata; score/audit changes always come from the fresh index.
    previous = benchmarks.PREVIOUS.get().get("sources", {}).get("KernelBench.com", {})
    old = previous.get("raw", {}).get("details", {})
    details, failures = {}, []
    result = []
    for row in rows:
        path = paths.get((row.run_id, row.hardware))
        if path is None:
            result.append(row)
            continue
        try:
            cache_key = str(row.hardware) + "/" + s.text(row.run_id)
            raw = old.get(cache_key) or old.get(row.run_id)
            if raw is not None and s.hardware_key(raw.get("gpu")) != s.hardware_key(row.hardware):
                raw = None
            if raw is None:
                raw = benchmarks.loads(benchmarks.fetch(path))
            updated = detail(row, raw)
            details[cache_key] = raw
            result.append(updated)
        except HTTPError as error:
            if error.code != 404:
                raise
            failures.append(row.run_id)
            result.append(row)
        except (ValueError, KeyError, TypeError):
            failures.append(row.run_id)
            result.append(replace(row, caveat="Detail metadata invalid or ambiguous; Unverified."))
    newest = max((r.date for r in result if r.date), default=None)
    audit_records = sum(len(b.get("outcomes", [])) for m in index["models"] for b in m["benches"].values())
    receipts = (audit_records + len(catalog["cells"]) + len(list(csv.DictReader(io.StringIO(inputs[MEGA]))))
                + sum(len(m["run_ids"]) for m in manifests))
    return {"url": "https://kernelbench.com/", "data_url": s.KERNEL, "published": published,
            "metadata": ["Methodology version Unverified; audits plus full published-run inventories"],
            "measurements": [asdict(r) for r in result],
            "raw": {"index": index, "catalog": catalog, "mega_csv": inputs[MEGA],
                    "manifests": manifests, "details": details},
            "sha256": {url: hashlib.sha256(raw.encode()).hexdigest() for url, raw in inputs.items()},
            "methodology_url": s.KERNEL_METHOD,
            "methodology_sha256": hashlib.sha256(str(index["methodology"]).encode()).hexdigest(),
            "coverage": {"captured_rows": receipts, "available_rows": receipts,
                         "normalized_contexts": len(result),
                         "audit_records": audit_records, "audit_contexts": len(rows) - len(extra),
                         "unscored_inventory_runs": len(extra), "detail_unavailable": len(failures),
                         "harness_captured": "yes (missing metadata remains null)",
                         "newest_available": newest,
                         "efforts": sorted({r.effort for r in result if r.effort})},
            "limits": "Single maintainer; unversioned small decks. All audit outcomes and inventory-only "
                      "receipts retained; overlapping exports are not additional replicates. "
                      "Unaudited/retired/missing/conflicting scores are Unverified. Operation, "
                      "GPU, harness/version, effort and units stay separate. Detail files supply "
                      "metadata, not permission to rank an unaudited score. Missing details: "
                      + str(len(failures))}
