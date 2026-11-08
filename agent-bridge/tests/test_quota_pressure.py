import json
import time
from types import SimpleNamespace

from agent_accounts.models import Quota, QuotaWindow

from agent_bridge import claude, codex, quota_pressure
from agent_bridge.acknowledgements import event_lines, urgent

CLOCK = 1_800_000_000.0
STATE = {"backend": "claude", "model": "fable", "contextTokens": 180_000}


def claude_event(used, resets=CLOCK + 7200):
    return {"type": "rate_limit_event", "rate_limit_info": {
        "status": "allowed", "rateLimitType": "five_hour", "utilization": used, "resetsAt": resets,
        "unifiedWindows": {
            "five_hour": {"utilization": used, "resetsAt": resets, "status": "allowed"},
            "seven_day": {"utilization": 0.1, "resetsAt": CLOCK + 99_000, "status": "allowed"}}}}


def test_claude_stream_windows_become_remaining_percent():
    readings = quota_pressure.claude(claude_event(0.26), CLOCK)
    assert {r.key: round(r.remaining) for r in readings} == {"claude:five_hour": 74, "claude:seven_day": 90}
    assert quota_pressure.claude({"rate_limit_info": {"rateLimitType": "five_hour"}}, CLOCK) == []
    assert quota_pressure.claude(claude_event(1.5), CLOCK)[0].key == "claude:seven_day"


def test_codex_snapshot_is_the_workers_own_limit_for_its_model():
    snapshot = {"limitId": "codex", "normalModelSlug": None,
                "primary": {"usedPercent": 7, "windowDurationMins": 10080, "resetsAt": int(CLOCK) + 9000},
                "secondary": None}
    [reading] = quota_pressure.codex([snapshot, None], "gpt-x", CLOCK)
    assert (reading.key, reading.label, reading.remaining) == ("codex:codex:primary", "7d", 93)
    scoped = {**snapshot, "limitId": "spark", "normalModelSlug": "spark"}
    assert quota_pressure.codex([scoped], "gpt-x", CLOCK) == []
    assert quota_pressure.codex([scoped], "spark", CLOCK)[0].key == "codex:spark:primary"


def agy_observation(model_ids):
    window = QuotaWindow("5h", 6, "g", "5h", "2027-01-15T10:00:00+00:00", pool_id="pool",
                         model_ids=model_ids, remaining_fraction=0.06)
    return Quota("agy", "a1", None, False, (window,), None, "2027-01-15T08:00:00+00:00", 0, "fresh")


def test_agy_window_applies_only_when_its_model_set_names_the_worker_model():
    assert quota_pressure.agy(agy_observation(("gemini",)), "gemini")[0].key == "agy:pool"
    assert quota_pressure.agy(agy_observation(("gemini",)), "other") == []
    assert quota_pressure.agy(agy_observation(None), "gemini") == []
    stale = agy_observation(("gemini",))
    assert quota_pressure.agy(SimpleNamespace(**{**stale.__dict__, "freshness": "stale"}), "gemini") == []


def test_depleting_window_warns_root_once_with_the_choices_and_survives_a_new_turn(tmp_path):
    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    quota_pressure.feed(job, STATE, quota_pressure.claude(claude_event(0.90), CLOCK), CLOCK)
    quota_pressure.feed(job, STATE, quota_pressure.claude(claude_event(0.95), CLOCK + 300), CLOCK + 300)
    quota_pressure.feed(job, STATE, quota_pressure.claude(claude_event(0.96), CLOCK + 360), CLOCK + 360)
    rows = [row for _, row in event_lines(job) if row.get("kind") == "quota_pressure"]
    assert len(rows) == 1 and urgent(rows[0])
    message = rows[0]["message"]
    for part in ("five hour", "5% left", "fable", "180k tokens", "resume owner/worker --model M",
                 "--compact", "compact owner/worker", "none of them the default"):
        assert part in message
    assert json.loads((job / "quota-runway.json").read_text())["notified"]


def test_agy_sampling_reads_its_own_login_and_keeps_the_cache_fresh(tmp_path, monkeypatch):
    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    seen, spawned = [], []
    monkeypatch.setattr(quota_pressure.providers, "agy_observation",
                        lambda account, identity: seen.append((account, identity)))
    monkeypatch.setattr(quota_pressure.subprocess, "Popen",
                        lambda command, **_: spawned.append(command) or SimpleNamespace(poll=lambda: None))
    state = {"backend": "agy", "account": "a1", "agyAuthId": "login", "model": "gemini"}
    monitor = {}
    quota_pressure.sample_agy(job, state, monitor)
    quota_pressure.sample_agy(job, state, monitor)  # inside the sampling interval
    assert seen == [("a1", "login")] and len(spawned) == 1 and spawned[0][-2:] == ["--account", "a1"]
    quota_pressure.sample_agy(job, {**state, "agyAuthId": None}, {})
    assert len(seen) == 1


def test_codex_reads_the_account_limits_through_its_rpc_and_survives_an_unsupported_server(tmp_path):
    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    primary = {"usedPercent": 7, "windowDurationMins": 10080, "resetsAt": int(time.time()) + 9000}
    snapshot = {"limitId": "codex", "normalModelSlug": None, "secondary": None, "primary": primary}
    state = {"backend": "codex", "model": "gpt-x"}
    codex.read_quota(SimpleNamespace(call=lambda method: {"rateLimits": snapshot,
                                                         "rateLimitsByLimitId": {"codex": snapshot}}),
                     job, state)
    assert list(json.loads((job / "quota-runway.json").read_text())["samples"]) != []

    def unsupported(method):
        raise RuntimeError("account/rateLimits/read: method not found")

    codex.read_quota(SimpleNamespace(call=unsupported), job, state)


def test_claude_stream_feeds_the_runway_and_records_context_size(tmp_path):
    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    state = {"backend": "claude"}
    claude.process({"type": "assistant", "message": {"content": [], "usage": {
        "input_tokens": 10, "cache_read_input_tokens": 90_000, "cache_creation_input_tokens": 500}}},
        state, job)
    assert state["contextTokens"] == 90_510
    claude.process(claude_event(0.5, resets=time.time() + 7200), state, job)
    assert list(json.loads((job / "quota-runway.json").read_text())["samples"])


def test_compaction_forgets_the_context_size_and_hostile_limits_never_stop_the_worker(tmp_path):
    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    state = {"backend": "claude", "contextTokens": 200_000}
    claude.process({"type": "system", "subtype": "compact_boundary",
                    "compact_metadata": {"pre_tokens": 200_000, "trigger": "manual"}}, state, job)
    assert "contextTokens" not in state
    hostile = {"limitId": "codex", "normalModelSlug": None, "secondary": None,
               "primary": {"usedPercent": 7, "windowDurationMins": "week", "resetsAt": time.time() + 9000}}
    codex.read_quota(SimpleNamespace(call=lambda method: {"rateLimits": hostile}), job, state)
    quota_pressure.feed(job, {}, quota_pressure.codex([hostile], "gpt-x", time.time()))


def test_warning_says_when_the_choices_are_available(tmp_path):
    hit = SimpleNamespace(label="5h", remaining=5, seconds_to_empty=600, note="")
    text = quota_pressure.advice(tmp_path / "owner" / "worker", {"backend": "codex"}, hit)
    assert "agent-bridge interrupt owner/worker" in text and "Once its turn ends" in text


def named_groups():
    """The shape AGY's /usage really has: group names, no model sets."""
    def window(group, pool):
        return QuotaWindow(pool, 6, group, "weekly", "2027-01-15T10:00:00+00:00", pool_id=pool,
                           model_ids=None, remaining_fraction=0.06)
    return Quota("agy", "a1", None, False, (window("Gemini Models", "gemini-weekly"),
                                            window("Claude and GPT models", "3p-weekly")),
                 None, "2027-01-15T08:00:00+00:00", 0, "fresh")


def test_agy_group_names_match_a_model_family_and_say_the_match_was_inferred():
    [reading] = quota_pressure.agy(named_groups(), "gemini-3.8-flash")
    assert reading.key == "agy:gemini-weekly" and "'Gemini Models'" in reading.note
    assert [r.key for r in quota_pressure.agy(named_groups(), "claude-sonnet-4-6")] == ["agy:3p-weekly"]
    assert quota_pressure.agy(named_groups(), "mystery-model") == []
    assert quota_pressure.agy(named_groups(), None) == []


def test_inferred_match_is_stated_in_the_warning_and_keeps_the_cache_fresh(tmp_path, monkeypatch):
    note = "matched by the group name 'X'"
    hit = SimpleNamespace(label="weekly", remaining=5, seconds_to_empty=600, note=note)
    assert "(matched by the group name 'X')" in quota_pressure.advice(tmp_path / "o" / "w", {}, hit)
    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    spawned = []
    monkeypatch.setattr(quota_pressure.providers, "agy_observation", lambda account, identity: named_groups())
    monkeypatch.setattr(quota_pressure.subprocess, "Popen",
                        lambda command, **_: spawned.append(command) or SimpleNamespace(poll=lambda: None))
    state = {"backend": "agy", "account": "a1", "agyAuthId": "login", "model": "gemini-3.8-flash"}
    quota_pressure.sample_agy(job, state, {})
    assert len(spawned) == 1
    quota_pressure.sample_agy(job, {**state, "model": "mystery-model"}, {})
    assert len(spawned) == 1  # no window covers this model: refreshing cannot help
