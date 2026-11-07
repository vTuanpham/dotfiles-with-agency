import json

from agent_bridge import agy


def test_build_home_never_touches_real_agy_store(tmp_path, monkeypatch):
    real, acct, job = tmp_path / "real", tmp_path / "acct", tmp_path / "job"
    store = real / ".gemini" / "antigravity-cli"
    store.mkdir(parents=True)
    (store / "history.db").write_text("mine")
    (real / ".gemini" / "other").write_text("shared")
    (real / ".zshrc").write_text("rc")
    (real / ".gemini" / "config" / "projects").mkdir(parents=True)
    (real / ".gemini" / "config" / "projects" / "p.json").write_text("stub")
    (real / ".gemini" / "config" / "mcp_config.json").write_text("{}")
    (acct / agy.TOKEN).parent.mkdir(parents=True)
    (acct / agy.TOKEN).write_text("tok")
    monkeypatch.setattr(agy.Path, "home", staticmethod(lambda: real))
    monkeypatch.setattr(agy, "ACCOUNTS", tmp_path / "accts")
    (tmp_path / "accts").symlink_to(tmp_path)
    job.mkdir()
    state = {"account": "acct", "cwd": "/w", "writableRoots": [], "sandbox": "read-only"}
    home = agy.build_home(job, state)
    cli = home / ".gemini" / "antigravity-cli"
    assert not cli.is_symlink() and not (cli / "history.db").exists()
    assert not (home / ".gemini").is_symlink() and (home / ".gemini" / "other").is_symlink()
    (cli / "history.db").write_text("worker")  # a worker writing its session
    assert (store / "history.db").read_text() == "mine"
    assert sorted(p.name for p in store.iterdir()) == ["history.db"]
    projects = home / ".gemini" / "config" / "projects"
    assert not projects.is_symlink() and (home / ".gemini" / "config" / "mcp_config.json").is_symlink()
    (projects / "p.json").write_text("rewritten")
    assert (real / ".gemini" / "config" / "projects" / "p.json").read_text() == "stub"


def test_burn_check_reports_requests_the_stream_never_showed(tmp_path, monkeypatch):
    log_dir = tmp_path / "home/.gemini/antigravity-cli/brain/c1/.system_generated/logs"
    log_dir.mkdir(parents=True)
    transcript = log_dir / "transcript.jsonl"
    request = json.dumps({"input_tokens": 10, "cache_read_tokens": 100, "output_tokens": 1})
    tool = json.dumps({"type": "GENERIC", "content": "output"})
    clock = iter(range(0, 1000, agy.BURN_WINDOW))
    monkeypatch.setattr(agy.time, "monotonic", lambda: next(clock))
    mon = {"at": next(clock), "offset": 0, "seen": True, "hidden": 0}
    state = {"conversationId": "c1"}

    def events():
        return [json.loads(line) for line in (tmp_path / "live.jsonl").read_text().splitlines()]

    for window in range(agy.BURN_WINDOWS + 1):
        with transcript.open("a") as handle:
            handle.write(f"{request}\n{tool}\n{request}")  # the last line is still being written
            handle.write("\n" if window < agy.BURN_WINDOWS else "")
        agy.burn_check(tmp_path, state, mon)
    kinds = [event["kind"] for event in events()]
    assert kinds.count("model_requests") == agy.BURN_WINDOWS + 1
    first = events()[0]
    assert first["streamed"] is True and first["requests"] == 2
    assert first["input_tokens"] == 20 and first["cache_read_tokens"] == 200
    assert kinds.count("quota_burn") == 1  # once, after BURN_WINDOWS windows with nothing streamed
    burn = next(event for event in events() if event["kind"] == "quota_burn")
    assert burn["level"] == "urgent" and "polling" in burn["message"]


def test_burn_check_counts_a_streamed_window_as_progress(tmp_path, monkeypatch):
    log_dir = tmp_path / "home/.gemini/antigravity-cli/brain/c1/.system_generated/logs"
    log_dir.mkdir(parents=True)
    (log_dir / "transcript.jsonl").write_text(json.dumps({"input_tokens": 1}) + "\n")
    monkeypatch.setattr(agy.time, "monotonic", lambda: 10_000.0)
    mon = {"at": 0.0, "offset": 0, "seen": True, "hidden": 2}
    agy.burn_check(tmp_path, {"conversationId": "c1"}, mon)
    assert mon["hidden"] == 0 and not mon["seen"]
    assert "quota_burn" not in (tmp_path / "live.jsonl").read_text()
