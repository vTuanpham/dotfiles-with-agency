import copy
import json
from email.utils import formatdate
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import Request

import pytest

from agent_models import artificial, benchmarks, kernel_source, policy, polling, reference, refresh, transport

NOW = 1_800_000_000
URL = "https://example.invalid/table.csv"
DATA = {"sources": {"LiveBench": {"status": "ok"}}}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(polling, "STATE", tmp_path / "poll.json")
    monkeypatch.setattr(policy, "refresh_due", lambda: [])
    monkeypatch.setattr(polling, "endpoints", lambda _: {"LiveBench": [URL]})
    request = Mock(return_value=(200, {"ETag": '"v1"'}, b"model,score\na,1\n"))
    monkeypatch.setattr(polling, "request", request)
    return request


def test_unchanged_semantic_rows_skip_heavy_fetch_and_proposal(setup, monkeypatch, tmp_path):
    assert polling.check(DATA, now=NOW)[0] == ["LiveBench"]
    polling.accept(["LiveBench"])
    setup.return_value = (200, {}, b"model,score\n\"a\",1\r\n")
    assert polling.check(DATA, now=NOW + polling.INTERVAL)[0] == []
    monkeypatch.setattr(reference, "PENDING", tmp_path / "pending")
    monkeypatch.setattr(benchmarks, "snapshot", lambda: DATA)
    monkeypatch.setattr(polling, "check", lambda _: ([], {}, []))
    monkeypatch.setattr(benchmarks, "prepare", lambda *a, **k: pytest.fail("heavy data fetched"))
    assert refresh.poll() == 0 and not reference.PENDING.exists()
    assert polling.STATE.stat().st_mode & 0o777 == 0o600


def test_nothing_due_means_no_requests(setup):
    polling.check(DATA, now=NOW)
    setup.reset_mock()
    assert polling.check(DATA, now=NOW + 1)[0] == []
    setup.assert_not_called()


def test_304_preserves_digest_and_sends_both_validators(setup):
    setup.return_value = (200, {"ETag": '"v1"', "Last-Modified": "Wed, 21 Oct 2026 07:28:00 GMT"},
                          b"model,score\na,1\n")
    polling.check(DATA, now=NOW)
    polling.accept(["LiveBench"])
    before = polling.load()["sources"]["LiveBench"]["endpoints"][URL]["digest"]
    setup.return_value = (304, {"ETag": '"v2"'}, b"")
    assert polling.check(DATA, now=NOW + polling.INTERVAL)[0] == []
    validators = setup.call_args.args[1]
    assert validators == {"If-None-Match": '"v1"',
                          "If-Modified-Since": "Wed, 21 Oct 2026 07:28:00 GMT"}
    assert polling.load()["sources"]["LiveBench"]["endpoints"][URL]["digest"] == before


def test_changed_digest_refreshes_only_that_source_and_proposes(setup, monkeypatch, tmp_path):
    polling.check(DATA, now=NOW)
    polling.accept(["LiveBench"])
    setup.return_value = (200, {}, b"model,score\na,2\n")
    names, fetched, messages = polling.check(DATA, now=NOW + polling.INTERVAL)
    assert names == ["LiveBench"] and fetched[URL] == b"model,score\na,2\n" and not messages
    monkeypatch.setattr(reference, "PENDING", tmp_path / "pending")
    monkeypatch.setattr(benchmarks, "snapshot", lambda: DATA)
    monkeypatch.setattr(polling, "check", lambda _: (names, fetched, []))
    monkeypatch.setattr(benchmarks, "prepare", lambda directory, **kwargs: None)

    def generate(**kwargs):
        assert kwargs == {"snapshot": DATA}
        reference.PENDING.write_text("pending proposal")
        return 0

    monkeypatch.setattr(refresh, "run", generate)
    assert refresh.poll() == 0 and reference.PENDING.is_file()
    assert not polling.load()["sources"]["LiveBench"]["refresh_needed"]


@pytest.mark.parametrize("retry", ["259200", formatdate(NOW + 259200, usegmt=True)])
def test_429_honours_retry_after_and_exponential_host_backoff(setup, retry):
    setup.return_value = (429, {"Retry-After": retry}, b"do not log response bodies")
    assert polling.check(DATA, now=NOW)[0] == []
    entry = polling.load()["sources"]["LiveBench"]
    assert entry["next_due"] == NOW + 259200
    setup.reset_mock()
    polling.check(DATA, now=NOW + 200000)
    setup.assert_not_called()
    setup.return_value = (429, {}, b"")
    polling.check(DATA, now=NOW + 259200)
    assert polling.load()["sources"]["LiveBench"]["next_due"] == NOW + 259200 + 2 * polling.INTERVAL


def test_failed_regeneration_keeps_change_pending_for_retry(setup):
    polling.check(DATA, now=NOW)
    setup.return_value = (304, {}, b"")
    assert polling.check(DATA, now=NOW + polling.INTERVAL)[0] == ["LiveBench"]


def test_aa_key_used_only_in_header_never_in_state_or_errors(monkeypatch, tmp_path):
    monkeypatch.setenv(artificial.KEY, "fake-sensitive-value")
    monkeypatch.setattr(polling, "STATE", tmp_path / "poll.json")
    monkeypatch.setattr(polling, "endpoints", lambda _: {"Artificial Analysis": [artificial.API]})

    def fail(request, **kwargs):
        assert request.get_header("X-api-key") == "fake-sensitive-value"
        raise OSError("fake-sensitive-value")

    monkeypatch.setattr(polling, "urlopen", fail)
    messages = polling.check(DATA, now=NOW)[2]
    assert "fake-sensitive-value" not in json.dumps(messages) + polling.STATE.read_text()
    monkeypatch.setattr(benchmarks, "fetch_bytes", lambda *a: (_ for _ in ()).throw(
        OSError("fake-sensitive-value")))
    with pytest.raises(ValueError, match="API request or schema failed") as error:
        artificial.load()
    assert "fake-sensitive-value" not in str(error.value)


def test_aa_missing_key_keeps_manual_adapter_and_skips_scheduled_website(monkeypatch):
    monkeypatch.delenv(artificial.KEY, raising=False)
    monkeypatch.setattr(benchmarks, "webpage", lambda url: {"url": url})
    assert artificial.load()["url"] == benchmarks.SOURCE_URLS["Artificial Analysis"]
    assert polling.endpoints({"sources": {"Artificial Analysis": {}}})["Artificial Analysis"] == []


def test_vals_new_build_path_with_identical_rows_does_not_regenerate(setup, monkeypatch):
    page = "https://www.vals.ai/benchmarks/example"
    before = "https://www.vals.ai/_astro/benchmark_view_example.aaa.json"
    after = "https://www.vals.ai/_astro/benchmark_view_example.bbb.json"
    monkeypatch.setattr(polling, "endpoints", lambda _: {"Vals Index": [page]})
    export = b'{"metadata":{"version":"1"},"tasks":{"overall":{"Example":{"accuracy":50}}}}'
    setup.side_effect = [(200, {}, b'<link href="/_astro/benchmark_view_example.aaa.json">'),
                         (200, {}, export)]
    assert polling.check(DATA, now=NOW)[0] == ["Vals Index"]
    polling.accept(["Vals Index"])
    setup.side_effect = [(200, {}, b'<link href="/_astro/benchmark_view_example.bbb.json">'),
                         (200, {}, export)]
    assert polling.check(DATA, now=NOW + polling.INTERVAL)[0] == []
    assert setup.call_args.args[0] == after
    assert before in polling.load()["sources"]["Vals Index"]["endpoints"]


def test_partial_prepare_preserves_other_source_and_its_retrieval(monkeypatch, tmp_path):
    old = {"status": "ok", "retrieved": "2020-01-01T00:00:00Z", "metadata": [], "url": "https://old"}
    monkeypatch.setattr(benchmarks, "loaders", lambda: {
        "Changed": lambda: {"url": "https://changed"},
        "Unchanged": lambda: pytest.fail("unchanged source fetched")})
    benchmarks.prepare(tmp_path, names=["Changed"], previous={"sources": {"Unchanged": old}})
    saved = json.loads((tmp_path / "benchmark-data.json").read_text())
    assert saved["sources"]["Unchanged"] == old
    assert saved["sources"]["Changed"]["retrieved"]


def test_dependent_refresh_requests_also_honour_host_backoff(setup, monkeypatch):
    monkeypatch.setattr(polling.time, "time", lambda: NOW)
    polling.defer(URL, {"Retry-After": "259200"})
    monkeypatch.setattr(benchmarks, "urlopen", lambda *a, **kw: pytest.fail("server backoff ignored"))
    with pytest.raises(ValueError, match="server backoff"):
        benchmarks.fetch_bytes(URL)


def test_kernel_probe_hashes_receipts_not_generation_time_or_unique_model_ids():
    raw = b'model,run_id,gpu\nSame,run1,H100\nSame,run2,B200\n'
    assert len(polling.rows(kernel_source.MEGA, raw)) == 2
    first = {"generated": "2020-01-01", "cells": [{"id": "a", "score": None}], "legend": []}
    second = {**first, "generated": "2030-01-01"}
    assert polling.digest(polling.rows(kernel_source.CATALOG, json.dumps(first).encode())) == (
        polling.digest(polling.rows(kernel_source.CATALOG, json.dumps(second).encode())))


def test_existing_snapshot_seeds_probe_baseline_without_a_heavy_refresh(setup, monkeypatch):
    url = "https://example.invalid/scores.json"
    raw = {"rows": [{"model": "a", "score": 1}]}
    snapshot = {"sources": {"Example": {"status": "ok", "data_url": url, "raw": raw}}}
    monkeypatch.setattr(polling, "endpoints", lambda _: {"Example": [url]})
    setup.return_value = (200, {}, json.dumps(raw).encode())
    assert polling.check(snapshot, now=NOW)[0] == []


def test_api_redirect_cannot_forward_the_key_to_any_target():
    request = Request(artificial.API, headers={"x-api-key": "fake-sensitive-value"})
    with pytest.raises(HTTPError, match="authenticated redirect refused") as error:
        transport.ProtectedRedirect().redirect_request(request, None, 302, "redirect", {},
                                                        "https://other.invalid/")
    assert "fake-sensitive-value" not in str(error.value)


@pytest.mark.parametrize("field,bad", [("next_due", True), ("failures", 0.5), ("refresh_needed", "yes")])
def test_corrupt_private_poll_state_is_rejected_before_network(setup, field, bad):
    polling.save({"hosts": {}, "sources": {"LiveBench": {"endpoints": {}, field: bad}}})
    with pytest.raises(ValueError):
        polling.check(DATA, now=NOW)
    setup.assert_not_called()


def test_successful_last_rate_limited_response_stops_other_host_requests(setup, monkeypatch):
    monkeypatch.setattr(polling, "endpoints", lambda _: {"One": [URL], "Two": [URL + "?other"]})
    setup.return_value = (200, {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": str(NOW + 3600)},
                          b"model,score\na,1\n")
    assert polling.check(DATA, now=NOW)[0] == ["One"]
    assert setup.call_count == 1 and polling.load()["hosts"]["example.invalid"] == NOW + 3600


def test_auth_failure_backs_off_schedule_without_blocking_a_manual_key_correction(setup):
    setup.return_value = (401, {}, b"")
    polling.check(DATA, now=NOW)
    assert polling.load()["sources"]["LiveBench"]["next_due"] > NOW
    assert not polling.load()["hosts"]


@pytest.fixture
def pending_observations(setup, monkeypatch, tmp_path):
    cache = tmp_path / "benchmarks"
    cache.mkdir()
    monkeypatch.setattr(benchmarks, "CACHE", cache)
    monkeypatch.setattr(reference, "PENDING", tmp_path / "pending")
    monkeypatch.setattr(refresh, "DIR", tmp_path / "refresh")
    monkeypatch.setattr(refresh, "STAMP", tmp_path / "last")
    monkeypatch.setattr(reference, "LOCK", tmp_path / "models.lock")
    monkeypatch.setattr(reference, "GUIDES", tmp_path / "guides")
    reference.GUIDES.mkdir()
    source = {"status": "ok", "url": "https://example.invalid/", "version": "v1",
        "retrieved": "2026-01-01T00:00:00Z", "efforts": {"example": "medium"},
        "limits": "fixture", "frontiers": {}, "points": {suite: [
            {"model": "example", "score": 1, "cost": 0.2}] for suite in ("Overall", "Coding")}}
    snapshot = {"retrieved": "2026-01-01T00:00:00Z", "sources": {"LiveBench": source}}
    (cache / "benchmark-data.json").write_text(json.dumps(snapshot))
    work = tmp_path / "waiting-proposal"
    work.mkdir()
    reference.PENDING.write_text(str(work))
    frozen = {reference.PENDING: str(work), reference.LOCK: "reviewed lock", refresh.STAMP: "old date",
        work / "benchmark-data.json": json.dumps(snapshot), work / "proposed-models.md": "old proposal",
        work / "report.md": "old report", reference.GUIDES / "models.md": "current guide",
        reference.GUIDES / "subscriptions.md": "current terms"}
    for path, text in frozen.items():
        path.write_text(text)

    def loader():
        assert benchmarks.PRELOADED.get()[URL] == b"model,score\na,2\n"
        result = copy.deepcopy(source)
        result["points"] = {suite: [{"model": "example", "score": 2, "cost": 0.2}]
                            for suite in ("Overall", "Coding")}
        return result

    monkeypatch.setattr(benchmarks, "loaders", lambda: {"LiveBench": loader})
    polling.check(snapshot, now=NOW)
    polling.accept(["LiveBench"])
    setup.return_value = (200, {}, b"model,score\na,2\n")
    monkeypatch.setattr(polling.time, "time", lambda: NOW + polling.INTERVAL)
    return frozen


def test_pending_proposal_does_not_pause_validated_queryable_observations(pending_observations):
    assert refresh.run() == 0  # Normal refresh delegates to due polling while pending.
    assert {path: path.read_text() for path in pending_observations} == pending_observations
    data = benchmarks.snapshot()
    found = benchmarks.search("coding", data=data)
    assert found["sources"]["LiveBench"]["results"][0]["score"] == 2
    assert data["sources"]["LiveBench"]["retrieved"] != "2026-01-01T00:00:00Z"
    assert not polling.load()["sources"]["LiveBench"]["refresh_needed"]


@pytest.mark.parametrize("stage", ["probe", "decode"])
def test_pending_observation_failures_preserve_proposal_and_honest_unknowns(
        pending_observations, setup, monkeypatch, stage):
    before = (benchmarks.CACHE / "benchmark-data.json").read_text()
    if stage == "probe":
        setup.return_value = (200, {}, b"not valid csv")
    else:
        def invalid():
            raise ValueError("malformed source")
        monkeypatch.setattr(benchmarks, "loaders", lambda: {"LiveBench": invalid})
    assert refresh.poll() == 0
    assert {path: path.read_text() for path in pending_observations} == pending_observations
    if stage == "probe":
        assert (benchmarks.CACHE / "benchmark-data.json").read_text() == before
        assert polling.load()["sources"]["LiveBench"]["failures"] == 1
    else:
        assert benchmarks.snapshot()["sources"]["LiveBench"]["status"] == "unavailable"
        assert polling.load()["sources"]["LiveBench"]["refresh_needed"]


def test_proposal_appearing_during_cache_refresh_is_not_overwritten_or_false_accepted(
        pending_observations, monkeypatch):
    reference.PENDING.unlink()
    original = benchmarks.prepare

    def arrival(*args, **kwargs):
        result = original(*args, **kwargs)
        reference.PENDING.write_text(pending_observations[reference.PENDING])
        return result

    monkeypatch.setattr(benchmarks, "prepare", arrival)
    assert refresh.poll() == 0
    assert {path: path.read_text() for path in pending_observations} == pending_observations
    assert benchmarks.snapshot()["sources"]["LiveBench"]["points"]["Coding"][0]["score"] == 2
    assert not polling.load()["sources"]["LiveBench"]["refresh_needed"]
