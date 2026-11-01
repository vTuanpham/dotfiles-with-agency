import copy
import json
import subprocess
from datetime import date as Date
from datetime import timedelta
from pathlib import Path

import pytest

from agent_models import benchmarks, cli, generated, reference, refresh
from agent_models.inventory import ZDR_FREE


class date(Date):
    @classmethod
    def today(cls):
        return cls(2030, 2, 3)


TODAY = date.today().isoformat()
REAL = """## Model strength
Checked 2001-01-01 for qualitative advice.
### Four separate things
Class, measurement, effort and allowance differ. Unverified claims stay unknown.
### Effort and model strength
<!-- model-guide:effort:start -->
Unverified: no benchmark snapshot generated yet.
<!-- model-guide:effort:end -->
- **Small models need effort**: use observed settings.
### Capability evidence
<!-- model-guide:capability:start -->
Unverified: no benchmark snapshot generated yet.
<!-- model-guide:capability:end -->
### Cost versus performance
<!-- model-guide:cost:start -->
Unverified: no benchmark snapshot generated yet.
<!-- model-guide:cost:end -->
### How to use each model
| Model | Role | Effort |
|---|---|---|
| Astra | hardest audits | low to medium |
### Inventory coverage
Native IDs do not establish entitlement.
"""
SUBSCRIPTIONS = """## Subscriptions
Checked 2001-01-01.
### Find live account state
Numeric allowance Unverified.
### Codex / ChatGPT
| Tier | Allowance |
|---|---|
| Pro ($100/month) | Unverified |
### Antigravity / agy
### OpenCode
- **OpenCode free**: """ + ", ".join(f"\x60{model}\x60" for model in ZDR_FREE) + """
### Claude / Claude Code
"""
SNAPSHOT = {"retrieved": "2029-12-01T12:00:00+00:00", "sources": {
    "Artificial Analysis": {
        "status": "ok", "url": "https://artificialanalysis.ai/leaderboards/models",
        "metadata": ["Intelligence Index v5.0"], "tables": [[
            ["Model", "Artificial Analysis Intelligence Index", "Cost per Task USD",
             "Latency First Chunk (s)", "Total Response (s)"],
            ["Example (adaptive)", "50", "$0.2", "1", "--"],
            ["Example (deep)", "49", "$0.5", "1.5", "30"],
            ["Other (high with fallback)", "60", "$1", "2", "60"],
        ]]},
    "LiveBench": {
        "status": "ok", "url": "https://livebench.ai/", "version": "2.0", "release": "20290101",
        "weights": {"Coding": 1}, "efforts": {"example": "adaptive"},
        "points": {suite: [
            {"model": "example", "score": 50, "cost": 0.5},
            {"model": "unknown", "score": None, "cost": None},
            {"model": "zero", "score": 0, "cost": None},
        ] for suite in ("Overall", "Coding")},
    },
}}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(reference, "date", date)
    monkeypatch.setattr(refresh, "date", date)


@pytest.fixture
def home(tmp_path, monkeypatch):
    guides = tmp_path / "guide"
    guides.mkdir()
    (guides / "models.md").write_text(REAL)
    (guides / "subscriptions.md").write_text(SUBSCRIPTIONS)
    (guides / "sources.md").write_text("")
    monkeypatch.setattr(reference, "GUIDES", guides)
    monkeypatch.setattr(reference, "LOCK", guides / "models.lock")
    monkeypatch.setattr(reference, "CACHE", tmp_path / "stale.json")
    monkeypatch.setattr(reference, "PENDING", tmp_path / "refresh/pending")
    monkeypatch.setattr(refresh, "DIR", tmp_path / "refresh")
    monkeypatch.setattr(refresh, "STAMP", tmp_path / "refresh/last")
    monkeypatch.setattr(reference, "HOME", tmp_path)
    monkeypatch.setattr(refresh, "committed", lambda: {"models.md": REAL, "subscriptions.md": SUBSCRIPTIONS})
    (tmp_path / "refresh").mkdir()
    monkeypatch.setattr(benchmarks, "CACHE", tmp_path / "benchmarks")

    def prepare(directory):
        (directory / "benchmark-data.json").write_text(json.dumps(SNAPSHOT))
        (directory / "benchmark-report.md").write_text("Source evidence")

    monkeypatch.setattr(benchmarks, "prepare", prepare)
    monkeypatch.setattr(reference, "LISTERS", {
        "codex": lambda: print("gpt-6-luna\t-\ngpt-6.1-sol\t-"),
        "opencode": lambda: print("opencode/example-free\t-\nother/x\t-"),
    })
    return tmp_path


def reviewed(text):
    return refresh.CHECKED.sub(f"Checked {TODAY}", text)


def write_lock(models, refreshed=TODAY):
    hashes = "".join(f"guide {name} {digest}\n" for name, digest in reference.guide_hashes().items())
    reference.LOCK.write_text(f"refreshed {refreshed}\n{hashes}{models}")


def proposal():
    return Path(reference.PENDING.read_text())


def test_generation_is_deterministic_and_does_not_change_prose():
    before = copy.deepcopy(SNAPSHOT)
    text = generated.render(REAL, SNAPSHOT)
    assert text == generated.render(REAL, SNAPSHOT) == generated.render(text, SNAPSHOT)
    reordered = {**SNAPSHOT, "sources": dict(reversed(list(SNAPSHOT["sources"].items())))}
    assert text == generated.render(REAL, reordered)
    assert generated.prose(text) == generated.prose(REAL) and SNAPSHOT == before
    assert "retrieved 2029-12-01" in text and "Intelligence Index v5.0" in text
    assert "https://artificialanalysis.ai/leaderboards/models" in text
    assert "high with fallback" in text and "adaptive" in text
    assert "xhigh" not in text and "max" not in text


def test_unavailable_effort_and_missing_measurements_are_unverified_not_zero():
    data = copy.deepcopy(SNAPSHOT)
    data["sources"]["Artificial Analysis"] = {"status": "unavailable", "error": "layout changed"}
    data["sources"]["LiveBench"]["points"]["Overall"] = [
        p for p in data["sources"]["LiveBench"]["points"]["Overall"] if p["model"] != "example"]
    text = generated.render(REAL, data)
    assert "Unverified: layout changed" in text and "Example (adaptive)" not in text
    assert "| unknown (Unverified) | Unverified | Unverified |" in text
    assert "| zero (Unverified) | 0 | Unverified |" in text
    assert benchmarks.frontier(data["sources"]["LiveBench"]["points"]["Overall"]) == []
    assert "Unverified: source absent" in generated.render(REAL, {**data, "sources": {}})


def test_versions_stay_in_read_path_and_review_provenance_moves_out():
    data = copy.deepcopy(SNAPSHOT)
    aa = data["sources"]["Artificial Analysis"]
    aa.update(methodology_url="https://artificialanalysis.ai/methodology/intelligence-benchmarking",
              methodology_sha256="abc", sha256="def")
    data["sources"]["Vals Index"] = {
        "status": "ok", "url": "https://www.vals.ai/benchmarks/vals_index",
        "metadata": ["Version 2.2", "Updated 10/29/2026"], "tables": [[
            ["Models", "Finance", "Coding"], ["", "Finance Agent v2.1", "Terminal-Bench 4.0"],
            ["Example", "60%", "--"],
        ]]}
    text = generated.render(REAL, data)
    assert "Version 2.2" in text
    assert all(value not in text for value in ("abc", "def", "Finance Agent v2.1", "SHA256"))
    notes = generated.provenance(data)
    assert all(value in notes for value in ("abc", "def", "methodology"))
    assert "Finance Agent v2.1" in data["sources"]["Vals Index"]["tables"][0][1]
    aa["methodology_sha256"] = "changed"
    assert generated.render(REAL, data) == text and generated.provenance(data) != notes
    aa["metadata"] = ["Intelligence Index v6.0"]
    assert generated.render(REAL, data) != text


@pytest.mark.parametrize("bad", ["2029-01-01T12:00:00", "invalid"])
def test_retrieval_dates_require_an_explicit_timezone(bad):
    with pytest.raises(ValueError):
        generated.render(REAL, {**SNAPSHOT, "retrieved": bad})


@pytest.mark.parametrize("edit", [
    lambda text: text.replace("<!-- model-guide:cost:end -->", ""),
    lambda text: text + "<!-- model-guide:cost:start -->",
    lambda text: text.replace("<!-- model-guide:effort:start -->", "<!-- model-guide:cost:end -->"),
])
def test_broken_generated_markers_fail_closed(edit):
    with pytest.raises(ValueError):
        generated.render(edit(REAL), SNAPSHOT)


def test_generated_source_text_cannot_inject_markers_or_markdown_rows():
    text = generated.cell("x|y\n<!-- model-guide:cost:end -->")
    assert "<!--" not in text and "&#124;" in text and "\n" not in text


def test_ambiguous_component_tables_are_not_guessed_and_valid_tables_still_render():
    source = {"tables": [
        [["Models", "Finance", "Coding"], ["Example", "60", "50", "40"]],
        [["Model", "Accuracy", "Cost / Test"], ["Example", "50%", "-"]],
    ]}
    text = generated.published_tables(source)
    assert "Unverified: ambiguous component table" in text
    assert "| Example (effort Unverified) | 50% | Unverified |" in text and "60" not in text
    assert generated.cell(-1.5) == "-1.5"  # Arena confidence bounds may be negative.


def test_reference_stays_bounded_with_large_sources_and_only_decision_columns():
    data = copy.deepcopy(SNAPSHOT)
    aa = data["sources"]["Artificial Analysis"]
    aa["tables"][0][0] += ["Creator", "Context Window", "Further Analysis"]
    aa["tables"][0][1:] = [
        [f"Model {i} (adaptive)", str(100 - i), f"${100 - i}", "1", "2",
         "vendor", "1M", "providers"] for i in range(100)]
    data["sources"]["LiveBench"]["points"]["Overall"] = [
        {"model": f"live-{i}", "score": 100 - i, "cost": 100 - i} for i in range(100)]
    for name, config in benchmarks.ARENA_BOARDS.items():
        score, low, high = (("score", "score_ci_lower", "score_ci_upper") if config == "agent"
                            else ("rating", "rating_lower", "rating_upper"))
        data["sources"][f"Arena/{name}"] = {
            "status": "ok", "config": config, "published": "2029-11-30", "rows": [
                {"model_name": f"arena-{i} (high)", "rank": i + 1, score: 100 - i,
                 low: 99 - i, high: 101 - i, "vote_count": 1000, "organization": "vendor"}
                for i in range(100)],
        }
    text = generated.render(REAL, data)
    assert len(text.splitlines()) < 90
    assert generated.prose(text) == generated.prose(REAL)
    assert all(column not in text for column in (
        "Creator", "Context Window", "Further Analysis", "vote_count", "organization"))
    assert "Total Response (s)" in text and "Latency First Chunk (s)" in text
    assert "**Model 99 (adaptive)**" in text  # Cheap frontier candidate survives the quality limit.
    assert text.count("https://artificialanalysis.ai/leaderboards/models") == 1


def test_proposal_report_retains_provenance_outside_the_read_path(home, monkeypatch):
    source = SNAPSHOT["sources"]["Artificial Analysis"]
    monkeypatch.setitem(source, "methodology_sha256", "method-digest")
    monkeypatch.setitem(source, "sha256", "evidence-digest")
    monkeypatch.setitem(source, "limits", "Verbatim-cell review notes")
    assert refresh.run(force=True) == 0
    report = (proposal() / "report.md").read_text()
    guide = (proposal() / "proposed-models.md").read_text()
    for value in ("method-digest", "evidence-digest", "Verbatim-cell review notes"):
        assert value in report and value not in guide


def test_stale_reports_new_and_gone_models_and_warns_from_cache(home):
    write_lock("codex gpt-6-luna\ncodex old-model\n")
    assert reference.warning() is None
    found = reference.check(probe=True)
    assert found[0].startswith("codex: new gpt-6.1-sol; gone old-model")
    assert any(line.startswith("opencode: new opencode/example-free") for line in found)
    assert "other/x" not in "".join(found)
    assert "live model lists changed" in reference.warning()
    reference.accept()
    assert reference.check(probe=True) == []


def test_an_old_lock_and_waiting_proposal_each_warn(home):
    write_lock("", date.today() - timedelta(days=45))
    assert "past their check date" in reference.warning()
    reference.accept()
    reference.PENDING.write_text(str(home))
    assert "waiting for a root to re-check" in reference.warning()


def test_generation_never_invokes_agent_bridge_or_any_subprocess(home, monkeypatch):
    reference.accept()
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: pytest.fail("generation launched a process"))
    monkeypatch.setattr(reference, "live", lambda: pytest.fail("stale --live belongs to the service"))
    assert refresh.run(force=True) == 0 and reference.PENDING.is_file()
    assert not (proposal() / "brief.md").exists()


def test_job_only_proposes_and_apply_requires_review(home, monkeypatch, capsys):
    reference.accept()
    old = reference.LOCK.read_bytes()
    assert refresh.run(force=True) == 0
    assert (reference.GUIDES / "models.md").read_text() == REAL and reference.LOCK.read_bytes() == old
    assert "waiting for the next root" in capsys.readouterr().out
    assert "report.md" in "\n".join(reference.check(probe=True))
    monkeypatch.setattr(refresh.sys.stdin, "isatty", lambda: False)
    with pytest.raises(SystemExit, match="re-check the changed claims"):
        refresh.apply(yes=False)
    assert refresh.apply(yes=True) == 0
    assert (reference.GUIDES / "models.md").read_text() == generated.render(REAL, SNAPSHOT)
    assert (reference.GUIDES / "subscriptions.md").read_text() == SUBSCRIPTIONS
    assert reference.guide_drift() == [] and not reference.PENDING.exists()
    assert refresh.run() == 0


def test_even_no_change_waits_for_apply_before_advancing_lock(home):
    (reference.GUIDES / "models.md").write_text(generated.render(REAL, SNAPSHOT))
    old = date.today() - timedelta(days=20)
    write_lock("codex gpt-6-luna\n", old)
    assert refresh.run(force=True) == 0
    assert reference.PENDING.is_file() and reference.read_lock()[0] == old
    assert refresh.apply(yes=True) == 0 and reference.read_lock()[0] == date.today()


@pytest.mark.parametrize("name", reference.DOCUMENTS)
def test_apply_refuses_intervening_edits(home, name):
    refresh.run(force=True)
    guide = reference.GUIDES / name
    guide.write_text(guide.read_text() + "\nintervening edit\n")
    with pytest.raises(SystemExit, match="guide changed"):
        refresh.apply(yes=True)
    assert refresh.run(force=True) == 0


@pytest.mark.parametrize("kind", ["number", "prose", "subscription"])
def test_apply_revalidates_generated_numbers_and_handwritten_text(home, kind):
    refresh.run(force=True)
    path = proposal() / ("proposed-subscriptions.md" if kind == "subscription" else "proposed-models.md")
    text = path.read_text()
    text = (text.replace("50", "99") if kind == "number" else
            text.replace("hardest audits", "routine work") if kind == "prose" else
            text.replace("Pro ($100/month)", "Other"))
    path.write_text(text)
    with pytest.raises(SystemExit, match="snapshot|prose|tier rows"):
        refresh.apply(yes=True)
    assert (reference.GUIDES / "models.md").read_text() == REAL


def test_intervening_edit_during_generation_is_not_overwritten(home, monkeypatch, capsys):
    prepare = benchmarks.prepare

    def edit(directory):
        prepare(directory)
        (reference.GUIDES / "models.md").write_text(REAL + "\nintervening edit\n")

    monkeypatch.setattr(benchmarks, "prepare", edit)
    assert refresh.run(force=True) == 1
    assert "changed while" in capsys.readouterr().out and not reference.PENDING.exists()


def test_failed_forced_replacement_does_not_leave_an_old_pending_pointer(home, monkeypatch):
    refresh.run(force=True)
    monkeypatch.setattr(benchmarks, "prepare", lambda _: (_ for _ in ()).throw(ValueError("bad source")))
    with pytest.raises(ValueError, match="bad source"):
        refresh.run(force=True)
    assert not reference.PENDING.exists()


def test_discard_preserves_guides_and_review_lock(home):
    reference.accept()
    before = reference.LOCK.read_bytes()
    refresh.run(force=True)
    assert refresh.discard() == 0 and not reference.PENDING.exists()
    assert reference.LOCK.read_bytes() == before
    assert (reference.GUIDES / "models.md").read_text() == REAL


def test_structured_check_is_read_only(home, monkeypatch):
    reference.accept()
    before = reference.LOCK.read_bytes()
    (reference.GUIDES / "subscriptions.md").write_text(SUBSCRIPTIONS + "\nedit\n")
    monkeypatch.setattr(reference, "live", lambda: {"codex": {"gpt-6-luna", "new-model"}})
    data = reference.inspect(probe=True)
    assert data["age_days"] == 0 and data["stale_guides"] == ["subscriptions.md"]
    assert data["models"]["codex"] == {"new": ["new-model"], "gone": ["gpt-6.1-sol"]}
    assert reference.LOCK.read_bytes() == before and not reference.CACHE.exists()


def test_record_keeps_hand_edits_and_accepts_unmeasured_ids(home, monkeypatch):
    reference.accept()
    monkeypatch.setattr(reference, "live", lambda: {"codex": {"new-unmeasured-model"}})
    (reference.GUIDES / "models.md").write_text(reviewed(REAL).replace("hardest audits", "hard tasks"))
    (reference.GUIDES / "subscriptions.md").write_text(reviewed(SUBSCRIPTIONS))
    before = refresh.documents(reference.GUIDES)
    assert refresh.record(yes=True) == 0
    assert refresh.documents(reference.GUIDES) == before and reference.guide_drift() == []
    assert reference.read_lock()[1]["codex"] == {"new-unmeasured-model"}


def test_record_after_generated_apply_accepts_only_snapshot_generated_numbers(home):
    refresh.run(force=True)
    refresh.apply(yes=True)
    for name in reference.DOCUMENTS:
        path = reference.GUIDES / name
        path.write_text(reviewed(path.read_text()))
    assert refresh.record(yes=True) == 0
    path = reference.GUIDES / "models.md"
    path.write_text(path.read_text().replace("50", "99"))
    with pytest.raises(SystemExit, match="generated sections were edited"):
        refresh.record(yes=True)


@pytest.mark.parametrize("failure", ["date", "holder", "section", "link", "unverified"])
def test_record_rejects_invalid_prose_without_changing_lock(home, failure):
    reference.accept()
    before = reference.LOCK.read_bytes()
    path = reference.GUIDES / "models.md"
    text = reviewed(REAL)
    edits = {
        "date": (f"Checked {TODAY}", "Checked 2000-01-01", "Checked date"),
        "holder": ("Class,", "Your plan is Plus. Class,", "holder-specific"),
        "section": ("### Inventory coverage", "### Coverage", "missing section"),
        "link": ("Class,", "[bad](https://) Class,", "malformed"),
        "unverified": ("Unverified claims", "Verified claims", "Unverified markers"),
    }
    old, new, expected = edits[failure]
    path.write_text(text.replace(old, new))
    with pytest.raises(SystemExit, match=expected):
        refresh.record(yes=True)
    assert reference.LOCK.read_bytes() == before


def test_record_requires_confirmation(home, monkeypatch):
    for name, text in (("models.md", REAL), ("subscriptions.md", SUBSCRIPTIONS)):
        (reference.GUIDES / name).write_text(reviewed(text))
    monkeypatch.setattr(refresh.sys.stdin, "isatty", lambda: False)
    with pytest.raises(SystemExit, match="--record --yes"):
        refresh.record()


def test_subscription_tier_and_privacy_gate_validation():
    for old, new, expected in (
        ("| Pro ($100/month)", "| Other", "tier rows"),
        (f"\x60{next(iter(ZDR_FREE))}\x60", "\x60opencode/new-free\x60", "zero-retention list"),
    ):
        errors, _ = refresh.validate(SUBSCRIPTIONS, reviewed(SUBSCRIPTIONS).replace(old, new),
                                     TODAY, "subscriptions.md")
        assert any(expected in error for error in errors)


def test_check_record_and_read_cli_routes(home, monkeypatch, capsys):
    reference.accept()
    monkeypatch.setattr(refresh.sys, "argv", ["model-guide", "check"])
    cli.main()
    assert json.loads(capsys.readouterr().out)["stale_guides"] == [] and not reference.CACHE.exists()
    calls = []
    monkeypatch.setattr(refresh, "record", lambda yes: calls.append(yes) or 0)
    monkeypatch.setattr(refresh.sys, "argv", ["model-guide", "refresh", "--record", "--yes"])
    assert cli.main() == 0 and calls == [True]
    for topic, expected in (("models", REAL), ("subscriptions", SUBSCRIPTIONS)):
        monkeypatch.setattr(refresh.sys, "argv", ["model-guide", "read", topic])
        cli.main()
        assert capsys.readouterr().out == expected.strip() + "\n"

def test_public_docs_and_help_have_no_holder_specific_wording():
    repo = Path(__file__).resolve().parents[2]
    tracked = subprocess.run(["git", "ls-files", "-z"], cwd=repo,
                             capture_output=True, text=True, check=True).stdout.split("\0")
    paths = {repo / name for name in tracked if name.endswith(".md") and (repo / name).is_file()}
    paths.update(reference.GUIDES / name for name in reference.DOCUMENTS)
    paths.add(reference.GUIDES.parent / "cli.py")
    offenders = [str(path.relative_to(repo)) for path in sorted(paths)
                 if refresh.HOLDER_WORDING.search(path.read_text(encoding="utf-8"))]
    assert offenders == []
