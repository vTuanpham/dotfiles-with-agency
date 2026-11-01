"""Strict JSON boundaries for the independent kernelbench.com and Bug Hunt boards."""

import csv
import io
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, cast

KERNEL = "https://raw.githubusercontent.com/Infatoshi/kernelbench.com/master/public/data/models.json"
BUG = "https://raw.githubusercontent.com/phuryn/bug-hunt-bench/main/results/runs.csv"
BUG_SUMMARY = "https://bughunt.productcompass.pm/data/benchmark.json"
KERNEL_METHOD = "https://github.com/Infatoshi/kernelbench.com/blob/master/app/_lib/models.ts"
BUG_METHOD = "https://bughunt.productcompass.pm/method"
PROBLEMS = {
    "hard": {"01_fp8_gemm", "02_kda_cutlass", "03_paged_attention", "05_topk_bitonic",
             "06_sonic_moe_swiglu", "07_w4a16_gemm"},
    "cuda": {"01_glm52_fused_moe", "02_deepseek_nsa", "03_megaqwen_decode", "04_grid_mingru_sps"},
    "mega": {"02_kimi_linear_decode"},
}


@dataclass(frozen=True)
class Measurement:
    model: str
    label: str
    effort: str | None
    harness: str | None
    metric: str
    score: float | None
    unit: str
    direction: Literal["higher", "lower"]
    tasks: int | None
    cost: float | None
    cost_kind: str | None
    seconds: float | None
    date: str | None
    caveat: str | None
    harness_version: str | None = None
    run_id: str | None = None
    n_runs: int | None = None
    hardware: str | None = None
    configuration: str | None = None
    domain: str | None = None
    cost_basis: str | None = None
    time_basis: str | None = None
    source_id: str | None = None


def obj(value: object) -> dict:
    if type(value) is not dict:
        raise ValueError("expected JSON object")
    return value


def sequence(value: object) -> list:
    if type(value) is not list:
        raise ValueError("expected JSON array")
    return value


def text(value: object) -> str:
    if type(value) is not str or not value.strip():
        raise ValueError("expected nonempty JSON string")
    return value


def optional_text(value: object) -> str | None:
    return None if value in (None, "") else text(value)


def numeric(value: object, *, maximum=None) -> float | None:
    if value is None:
        return None
    if type(value) not in (int, float):
        raise ValueError("invalid JSON measurement")
    try:
        result = float(cast(int | float, value))
    except OverflowError as error:
        raise ValueError("invalid JSON measurement") from error
    if not math.isfinite(result) or result < 0 or (maximum is not None and result > maximum):
        raise ValueError("invalid JSON measurement")
    return result


def count(value: object) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError("expected positive JSON task/run count")
    return value


def boolean(value: object) -> bool:
    if type(value) is not bool:
        raise ValueError("expected JSON boolean")
    return value


def hardware_key(value):
    return {"RTX PRO 6000": "rtxpro6000", "RTX_PRO_6000": "rtxpro6000",
            "RTX PRO 6000 Blackwell": "rtxpro6000", "RTX PRO 6000 Blackwell (SM120)": "rtxpro6000",
            "B200": "b200", "H100": "h100", "H100_SXM": "h100_sxm"}.get(value, value)


def csv_number(value: str, *, maximum=None) -> float | None:
    if value == "":
        return None
    if not re.fullmatch(r"\d+(?:\.\d+)?", value):
        raise ValueError("invalid CSV measurement")
    return numeric(float(value), maximum=maximum)


def bug_runs(raw: str, summary: object = None) -> tuple[str, list[Measurement], dict]:
    annotations = {}
    if summary is not None:
        bug_hunt(summary)  # Retain the existing strict task/count/effort-status decoder.
        annotations = {row["id"]: row for row in obj(summary)["runs"]}
    reader = csv.DictReader(io.StringIO(raw))
    required = {"run", "board_row", "row_status", "model", "vendor", "harness", "effort", "date",
                "fixed_of_105", "fixed_of_45", "fixed_of_60", "partial", "claimed_only", "extras",
                "wall_min", "cost_usd", "cost_kind", "turns", "turns_repo1", "turns_repo2",
                "model_id", "harness_version", "note"}
    if (reader.fieldnames is None or set(reader.fieldnames) != required
            or len(reader.fieldnames) != len(required)):
        raise ValueError("Bug Hunt CSV schema changed")
    rows = list(reader)
    if not rows or any(None in r or None in r.values() for r in rows):
        raise ValueError("empty or ragged Bug Hunt CSV")
    identities, aliases = set(), defaultdict(set)
    for row in rows:
        aliases[text(row["model_id"])].add(text(row["model"]))
    result = []
    for row in rows:
        identifier = text(row["run"])
        if identifier in identities:
            raise ValueError("duplicate Bug Hunt run identity")
        identities.add(identifier)
        if row["row_status"] not in ("live", "superseded"):
            raise ValueError("unknown Bug Hunt row status")
        score, first, second = [csv_number(row[k], maximum=n) for k, n in (
            ("fixed_of_105", 105), ("fixed_of_45", 45), ("fixed_of_60", 60))]
        if score is None or first is None or second is None:
            raise ValueError("Bug Hunt per-run bug counts require integers")
        if any(v % 1 != 0 for v in (score, first, second)):
            raise ValueError("Bug Hunt per-run bug counts require integers")
        if score != first + second:
            raise ValueError("inconsistent Bug Hunt planted totals")
        for field in ("partial", "claimed_only", "extras", "turns", "turns_repo1", "turns_repo2"):
            value = csv_number(row[field])
            if value is not None and value % 1 != 0:
                raise ValueError("Bug Hunt count requires integer")
        cost, minutes = csv_number(row["cost_usd"]), csv_number(row["wall_min"])
        kind = text(row["cost_kind"])
        if kind not in ("bill", "list", "floor", "free", "unknown"):
            raise ValueError("unknown Bug Hunt cost basis")
        if kind == "free" and cost not in (None, 0):
            raise ValueError("contradictory free Bug Hunt cost")
        effort = text(row["effort"])
        if effort not in ("low", "medium", "high", "xhigh", "max", "default", "enabled"):
            raise ValueError("unknown Bug Hunt effort")
        run_date = date.fromisoformat(text(row["date"])).isoformat()
        harness = text(row["harness"])
        label, model = text(row["model"]), text(row["model_id"])
        # Some routed IDs (deepseek-flash) are reused for different dated releases.
        if len(aliases[model]) > 1:
            model = label
        if row["row_status"] == "superseded":
            continue
        note = optional_text(row["note"])
        annotation = annotations.get(row["board_row"])
        status = (annotation["effort_status"] if annotation and annotation["harness"] == harness
                  and annotation["model"] == label else None)
        wall_note = (optional_text(annotation.get("wall_note"))
                     if annotation is not None and status is not None else None)
        if status in ("default", "inert_default", "clamped"):
            effort = "default"
        config = re.sub(r" \((?:low|medium|high|xhigh|max) effort\)| - mean of \d+", "", row["board_row"])
        if config.startswith(label):
            config = config[len(label):].strip()
        result.append(Measurement(
            model, label, None if effort == "default" else effort, harness, "bugs fixed", score,
            "/105", "higher", 105, cost if kind != "unknown" else None, kind,
            minutes * 60 if minutes is not None and wall_note is None
            and not (note and "contend" in note.casefold()) else None,
            run_date, "; ".join(p for p in (note, wall_note,
                "effort verification: " + (status or "Unverified")) if p),
            optional_text(row["harness_version"]), identifier, n_runs=1, configuration=config or None))
    if not result:
        raise ValueError("empty current Bug Hunt CSV")
    return max(r.date for r in result if r.date is not None), result, {
        "available_rows": len(rows), "captured_rows": len(rows), "live_rows": len(result),
        "superseded_rows": len(rows) - len(result), "harness_captured": "yes",
        "efforts": sorted({row["effort"] for row in rows}),
        "newest_available": max(row["date"] for row in rows)}


def cohorts(rows: list[dict]) -> list[dict]:
    """Mean replicates only within identical model/harness/version/effort/configuration."""
    groups = defaultdict(list)
    for row in rows:
        key = tuple(row.get(k) for k in ("model", "harness", "harness_version", "effort", "metric",
                                        "unit", "hardware", "configuration", "cost_kind"))
        # Unknown harness/version is not proof two runs used the same scaffold build.
        identifier = row.get("source_id") or row.get("run_id")
        if identifier and (not row.get("harness") or not row.get("harness_version")):
            key += (identifier,)
        groups[key].append(row)
    result = []
    for records in groups.values():
        row = dict(records[0])
        for field in ("score", "cost", "seconds"):
            values = [r[field] for r in records]
            row[field] = sum(values) / len(values) if all(v is not None for v in values) else None
        counts = [r.get("n_runs") for r in records]
        row["n_runs"] = sum(counts) if all(type(n) is int for n in counts) else None
        row["run_ids"] = [r.get("run_id") for r in records]
        row["date"] = max((r["date"] for r in records if r["date"]), default=None)
        result.append(row)
    return result


def kernel(raw: object) -> tuple[str, list[Measurement]]:
    data = obj(raw)
    stamp = datetime.fromisoformat(text(data["generated"]))
    if stamp.tzinfo is None:
        raise ValueError("kernel generation timestamp requires timezone")
    text(data["methodology"])
    benches = obj(data["benches"])
    if set(benches) != set(PROBLEMS):
        raise ValueError("kernel bench/unit layout changed; review methodology")
    for bench, spec in benches.items():
        spec = obj(spec)
        problems = [text(v) for v in sequence(spec["problems"])]
        if len(set(problems)) != len(problems) or not set(problems) <= PROBLEMS[bench]:
            raise ValueError("kernel problem/unit layout changed")
        gpu = obj(spec["gpu"])["name"] if type(spec["gpu"]) is dict else spec["gpu"]
        if gpu not in ("RTX PRO 6000 Blackwell Workstation", "RTX PRO 6000 Blackwell"):
            raise ValueError("kernel canonical hardware changed; review units and baselines")
    if any("outcomes" in b for m in sequence(data["models"]) for b in obj(m["benches"]).values()):
        return stamp.date().isoformat(), kernel_outcomes(data)
    result, identities = [], set()
    for entry in sequence(data["models"]):
        model = obj(entry)
        slug, name = text(model["slug"]), text(model["name"])
        if slug in identities:
            raise ValueError("duplicate kernel model identity")
        identities.add(slug)
        for bench, block in obj(model["benches"]).items():
            if bench not in benches:
                raise ValueError("unknown kernel bench")
            block = obj(block)
            cells = obj(block["cells"])
            effort = optional_text(block["effort"])
            harness = optional_text(block["harness"])
            # Only the canonical RTX board; never splice GPU boards or site-wide aggregates.
            for problem in benches[bench]["problems"]:
                cell = obj(cells[problem]) if problem in cells else None
                value = seconds = run_date = None
                unit, direction = ("x vs baseline", "higher") if bench == "mega" else ("% roofline", "higher")
                latency = bench == "cuda" and problem == "02_deepseek_nsa"
                if latency:
                    unit, direction = "geomean latency ms", "lower"
                if cell is not None:
                    valid, correct = boolean(cell["valid"]), boolean(cell["correct"])
                    verdict = text(cell["verdict"])
                    score = numeric(cell["score"])
                    measured_latency = numeric(cell.get("latency_ms"))
                    seconds = numeric(cell.get("elapsed_seconds"))
                    run = optional_text(cell["run_id"])
                    if run:
                        if not re.match(r"^\d{8}_", run):
                            raise ValueError("unknown kernel run date format")
                        run_date = datetime.strptime(run[:8], "%Y%m%d").date().isoformat()
                    if valid and (not correct or verdict not in ("clean", "interesting", "harness_limited")):
                        raise ValueError("contradictory kernel audit eligibility")
                    if valid:
                        value = measured_latency if latency else score
                        if value is not None and unit == "% roofline":
                            value *= 100
                result.append(Measurement(
                    name, name, effort, harness, f"{bench}/{problem} · RTX PRO 6000", value,
                    unit, direction, len(benches[bench]["problems"]), None, None, seconds, run_date,
                    "Single-maintainer small deck; canonical GPU; unaudited/invalid/missing cells Unverified."
                    " Units and operations are separate comparisons, never a combined score."))
    if not result:
        raise ValueError("empty kernel index")
    return stamp.date().isoformat(), result


def kernel_outcomes(data: dict) -> list[Measurement]:
    """The index carries every audit outcome, not just each model's chosen board cell."""
    result, seen = [], set()
    for value in sequence(data["models"]):
        model = obj(value)
        name = text(model["name"])
        for bench, value in obj(model["benches"]).items():
            block = obj(value)
            hardware_by_run = defaultdict(set)
            for outcome in sequence(block.get("outcomes", [])):
                outcome = obj(outcome)
                published_gpu = optional_text(outcome.get("gpu"))
                if published_gpu is not None:
                    hardware_by_run[text(outcome["run_id"])].add(hardware_key(published_gpu))
            cells = {}
            for gpu, board in [("RTX PRO 6000", block), *obj(block.get("gpus", {})).items()]:
                for problem, cell in obj(board.get("cells", {})).items():
                    cell = obj(cell)
                    if cell.get("run_id"):
                        cells[(cell["run_id"], hardware_key(gpu))] = (gpu, problem, cell)
            for value in sequence(block.get("outcomes", [])):
                row = obj(value)
                run = text(row["run_id"])
                identity = (name, bench, run, row.get("gpu"), row.get("harness"), row.get("effort"))
                if identity in seen:
                    continue  # A repeated audit record is not another replicate.
                seen.add(identity)
                if not re.match(r"^\d{8}_", run):
                    raise ValueError("unknown kernel run date format")
                run_date = datetime.strptime(run[:8], "%Y%m%d").date().isoformat()
                gpu = optional_text(row.get("gpu"))
                candidates = [v for (identifier, _), v in cells.items() if identifier == run]
                selected = cells.get((run, hardware_key(gpu)))
                if selected is None and gpu is None and len(candidates) == 1:
                    selected = candidates[0]
                if gpu in ("RTX_PRO_6000", "RTX PRO 6000 Blackwell", "RTX PRO 6000 Blackwell (SM120)"):
                    gpu = "RTX PRO 6000"
                if gpu is None and selected:
                    gpu = selected[0]
                problem = text(row["problem"])
                current = problem in PROBLEMS[bench]
                unit, direction = ("x vs baseline", "higher") if bench == "mega" else ("% roofline", "higher")
                latency = bench == "cuda" and problem == "02_deepseek_nsa"
                if latency:
                    unit, direction = "geomean latency ms", "lower"
                if not current:
                    unit = "Unverified (retired/changed operation)"
                correct = row.get("correct")
                if isinstance(correct, str):
                    text(correct)  # Audit notes in this field are not verified booleans.
                    correct = None
                elif correct is not None:
                    boolean(correct)
                if correct is None and selected:
                    correct = boolean(selected[2]["correct"])
                for field in ("publish_grade", "board_eligible"):
                    if row.get(field) is not None:
                        boolean(row[field])
                score = numeric(row.get("latency_ms") if latency else row.get("score"))
                collision = len(hardware_by_run[run]) > 1
                conflict = collision and selected is None
                if selected and score is not None and not latency and collision:
                    selected_score = numeric(selected[2].get("score"))
                    if selected_score is not None:
                        conflict = score != selected_score
                eligible = (current and gpu is not None and correct is True
                            and row.get("publish_grade") is True and row.get("board_eligible") is not False
                            and row.get("verdict") in ("clean", "interesting", "harness_limited")
                            and not conflict and not any(s in str(row.get("measurement_status"))
                                        for s in ("wrong_hardware", "wrong_gpu")))
                if eligible and unit == "% roofline" and score is not None:
                    score *= 100
                seconds = numeric(selected[2].get("elapsed_seconds")) if selected else None
                harness = optional_text(row.get("harness"))
                versions = set(re.findall(r"(?i)(?:codex CLI|Claude Code|OpenCode)\s+(\d+(?:\.\d+)+)",
                                          (harness or "") + " " + str(row.get("summary", ""))))
                version = next(iter(versions)) if len(versions) == 1 else None
                result.append(Measurement(
                    name, name, optional_text(row.get("effort")), harness,
                    f"{bench}/{problem} · {gpu or 'hardware Unverified'}", score if eligible else None,
                    unit, direction, 1, None, None, seconds, run_date,
                    f"Audit: {row.get('verdict')}; publish_grade={row.get('publish_grade')}; "
                    f"conflicting board cell={conflict}; "
                    "operation/hardware kept separate; method version Unverified.",
                    version, run, n_runs=1, hardware=gpu))
    if not result:
        raise ValueError("empty kernel audit outcomes")
    return result


def bug_hunt(raw: object) -> tuple[str, list[Measurement]]:
    data = obj(raw)
    meta = obj(data["meta"])
    total = count(meta["planted_total"])
    if (total, count(meta["repo1_total"]), count(meta["repo2_total"])) != (105, 45, 60):
        raise ValueError("Bug Hunt task set changed; review methodology")
    published = date.fromisoformat(text(meta["updated"])).isoformat()
    result, identities = [], set()
    for value in sequence(data["runs"]):
        row = obj(value)
        identifier = text(row["id"])
        if identifier in identities:
            raise ValueError("duplicate Bug Hunt run identity")
        identities.add(identifier)
        superseded = optional_text(row["superseded"])
        run_date = date.fromisoformat(text(row["date"])).isoformat()
        if run_date > published:
            raise ValueError("Bug Hunt run newer than snapshot publication")
        count(row["n_runs"])
        score = numeric(row["fixed"], maximum=total)
        first = numeric(row["repo1_fixed"], maximum=45)
        second = numeric(row["repo2_fixed"], maximum=60)
        # Published means round each repo and the total independently to one decimal.
        if (score is not None and first is not None and second is not None and
                abs(Decimal(str(score)) - Decimal(str(first)) - Decimal(str(second))) > Decimal("0.1")):
            raise ValueError("inconsistent Bug Hunt planted totals")
        cost = numeric(row["cost_usd"])
        minutes = numeric(row["wall_min"])
        cost_kind = text(row["cost_kind"])
        if cost_kind not in ("bill", "list", "floor", "free", "unknown"):
            raise ValueError("unknown Bug Hunt cost basis")
        if cost_kind == "free" and cost not in (None, 0):
            raise ValueError("contradictory free Bug Hunt cost")
        status = text(row["effort_status"])
        if status not in ("first_party", "verified", "verified_ceiling", "default",
                          "inert_default", "clamped"):
            raise ValueError("unknown Bug Hunt effort verification")
        effort = text(row["effort"])
        if status in ("default", "inert_default", "clamped"):
            effort = None
        model = optional_text(row["model_id"])
        # A missing native ID is never repaired by borrowing another version or a display alias.
        label = text(row["model"])
        harness = text(row["harness"])
        caveat = optional_text(row["caveat"])
        wall_note = optional_text(row["wall_note"])
        if superseded:
            continue
        result.append(Measurement(
            model or label, label, effort, harness, "Planted bugs fixed /105", score, "bugs /105", "higher",
            total, cost if cost_kind != "unknown" else None, cost_kind,
            minutes * 60 if minutes is not None and wall_note is None else None, run_date,
            "; ".join(part for part in (f"n={row['n_runs']}; effort verification: {status}",
                                       caveat, wall_note) if part), n_runs=row["n_runs"]))
    if not result:
        raise ValueError("empty current Bug Hunt board")
    return published, result
