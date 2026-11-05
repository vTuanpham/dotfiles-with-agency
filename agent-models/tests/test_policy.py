import hashlib
import json
from datetime import UTC, datetime
from urllib.error import HTTPError
from urllib.request import Request

import pytest

from agent_models import cli, policy, reference, refresh, transport

NOW = 1_793_793_600
ID = "codex-pricing"
URL = policy.SOURCES[ID][1]
TEXT = "# Official policy\n" + "The allowance is shared and conditions depend on the account. " * 20
TEXT += "\nException at the very end: verified accounts have different windows."


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(policy, "DIRECTORY", tmp_path / "policy")
    monkeypatch.setattr(policy, "SOURCES", {ID: ("codex", URL)})
    monkeypatch.setattr(policy.polling, "available", lambda url: None)
    monkeypatch.setattr(policy.time, "time", lambda: NOW)
    return tmp_path


def content(text=TEXT):
    return {"title": "Official policy", "text": text,
            "sha256": hashlib.sha256(text.encode()).hexdigest(), "etag": '"v1"'}


def test_missing_due_and_explicit_refresh_need_no_proposal_or_human_stamp(setup, monkeypatch):
    calls = []
    monkeypatch.setattr(policy, "fetch", lambda url, old: calls.append(url) or content())
    monkeypatch.setattr(reference, "PENDING", setup / "pending")
    reference.PENDING.write_text("a frozen proposal")
    assert policy.refresh_due(["codex"], now=NOW)[0]["text"] == TEXT
    policy.refresh_due(["codex"], now=NOW + 1)
    assert calls == [URL]
    policy.refresh_due(["codex"], now=NOW + policy.INTERVAL)
    policy.refresh_due(["codex"], now=NOW + policy.INTERVAL + 1, force=True)
    assert calls == [URL] * 3 and reference.PENDING.read_text() == "a frozen proposal"
    assert "Exception at the very end" in policy.render(policy.refresh_due(["codex"], now=NOW))


def test_last_good_is_preserved_on_failure_and_retry_is_bounded(setup, monkeypatch):
    monkeypatch.setattr(policy, "fetch", lambda *a: content())
    good = policy.refresh_due(now=NOW)[0]
    calls = []

    def fail(*args):
        calls.append(1)
        raise ValueError("captcha")

    monkeypatch.setattr(policy, "fetch", fail)
    failed = policy.refresh_due(now=NOW + policy.INTERVAL)[0]
    assert failed["text"] == TEXT and failed["fetched_at"] == good["fetched_at"]
    assert "error" in failed and policy.metadata(["codex"], now=NOW + policy.INTERVAL)[0]["status"] == (
        "last-good; latest check failed")
    policy.refresh_due(now=NOW + policy.INTERVAL + 10)
    assert calls == [1]


def test_conditional_unchanged_updates_check_time_without_inventing_new_body(setup, monkeypatch):
    monkeypatch.setattr(policy, "fetch", lambda *a: content())
    old = policy.refresh_due(now=NOW)[0]
    monkeypatch.setattr(policy, "fetch", lambda *a: None)
    new = policy.refresh_due(now=NOW + policy.INTERVAL)[0]
    assert new["fetched_at"] == old["fetched_at"] and new["checked_at"] != old["checked_at"]
    assert new["sha256"] == old["sha256"]


def test_unavailable_without_last_good_never_creates_policy_text(setup, monkeypatch):
    monkeypatch.setattr(policy, "fetch", lambda *a: (_ for _ in ()).throw(OSError()))
    record = policy.refresh_due(now=NOW)[0]
    assert "text" not in record and policy.metadata(["codex"], now=NOW)[0]["status"] == "missing"


def test_html_extraction_preserves_late_exceptions_and_footer_conditions():
    raw = ("<html><head><title>Policy</title><script>ignore()</script></head><body><nav>Menu</nav>"
           "<article><h1>Policy</h1><p>" + TEXT + "</p><footer>Late operative exception.</footer>"
           "</article></body></html>").encode()
    title, text = policy.extract(raw)
    assert title == "Policy" and "Late operative exception." in text
    assert "Exception at the very end" in text and "ignore()" not in text and "Menu" not in text
    for page in (b"", b"<html><title>Just a moment</title><body>" + TEXT.encode() + b"</body></html>",
                 b"<html><title>Sign in</title><body>" + TEXT.encode() + b"</body></html>"):
        with pytest.raises(ValueError):
            policy.extract(page)


def test_redirect_whitelist_is_exact_and_authenticated_rule_unchanged():
    request = Request(URL)
    handler = transport.ProtectedRedirect(policy.HOSTS)
    for target in ("https://learn.chatgpt.com.evil.invalid/policy", "http://learn.chatgpt.com/policy",
                   "https://user:pass@learn.chatgpt.com/policy", "https://learn.chatgpt.com:444/policy"):
        with pytest.raises(HTTPError, match="untrusted policy redirect"):
            handler.redirect_request(request, None, 302, "redirect", {}, target)
    assert handler.redirect_request(request, None, 302, "redirect", {}, URL).full_url == URL
    with pytest.raises(HTTPError, match="authenticated redirect"):
        handler.redirect_request(Request(URL, headers={"x-api-key": "synthetic"}), None, 302, "", {}, URL)


def test_transport_uses_validators_trusted_hosts_and_rejects_oversize(setup, monkeypatch):
    class Response:
        url = URL
        headers = {"ETag": '"v2"'}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, bound):
            assert bound == policy.MAX_BYTES + 1
            return TEXT.encode()

    def open_(request, **kwargs):
        assert request.get_header("If-none-match") == '"v1"'
        assert kwargs["allowed_hosts"] == policy.HOSTS
        return Response()

    monkeypatch.setattr(transport, "urlopen", open_)
    assert policy.fetch(URL, {"etag": '"v1"'})["text"] == TEXT
    monkeypatch.setattr(Response, "read", lambda *a: b"x" * (policy.MAX_BYTES + 1))
    with pytest.raises(ValueError, match="size limit"):
        policy.fetch(URL, {"etag": '"v1"'})


def test_corrupt_cache_never_becomes_fresh_source_authority(setup, monkeypatch):
    monkeypatch.setattr(policy, "fetch", lambda *a: content())
    row = policy.refresh_due(now=NOW)[0]
    row["text"] += "tampered"
    path = policy.DIRECTORY / (ID + ".json")
    path.write_text(json.dumps(row))
    assert policy.metadata(["codex"], now=NOW)[0]["status"] == "missing"
    row["text"] = TEXT
    row["checked_at"] = datetime.fromtimestamp(NOW + 5000, UTC).isoformat()
    path.write_text(json.dumps(row))
    assert policy.metadata(["codex"], now=NOW)[0]["error"] == "Policy cache unavailable"


def test_policy_command_automatically_checks_due_sources_and_preserves_full_text(setup, monkeypatch, capsys):
    monkeypatch.setattr(policy, "fetch", lambda *a: content())
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "policy", "--backend", "codex"])
    assert cli.main() == 0
    assert TEXT in capsys.readouterr().out


def test_policy_poll_runs_even_when_no_benchmark_change_is_due(setup, monkeypatch):
    called = []
    monkeypatch.setattr(policy, "refresh_due", lambda: called.append(1))
    monkeypatch.setattr(refresh.benchmarks, "snapshot", lambda: {"sources": {}})
    monkeypatch.setattr(refresh.benchmarks, "loaders", lambda: {})
    monkeypatch.setattr(policy.polling, "check", lambda data: ([], {}, []))
    assert refresh.poll() == 0 and called == [1]


def test_policy_comparison_never_fetches_and_keeps_table_qualifications(setup, monkeypatch):
    text = (
        "# Plans\n\nAvailability and quota depend on the subscription plan:\n\n"
        "| Model | Free | Pro 100 | Pro 200 |\n| --- | --- | --- | --- |\n"
        "| Example | No | Yes* | Yes |\n\n"
        "* Only non-trial subscriptions qualify.\n\n"
        "Except for verified accounts, usage resets every five hours.\n\n"
        "To learn more about plan limits, see the other documentation."
    )
    monkeypatch.setattr(policy, "fetch", lambda *a: content(text))
    policy.refresh_due(["codex"])
    monkeypatch.setattr(policy, "refresh_due", lambda *a, **k: pytest.fail("selection fetched policy"))
    item, = policy.excerpts(["codex"], context={"accounts": {"codex": {"plan": "Pro 100"}}})
    assert "Yes*" in item["excerpt"] and "non-trial" in item["excerpt"]
    assert "Except for verified accounts" in item["excerpt"]
    assert "To learn more" not in item["excerpt"]
    assert item["url"] == URL and item["checked_at"]


def test_markdown_wrapped_paragraphs_and_legacy_short_conditions_remain_complete():
    paragraph = "A paragraph with enough words to span multiple lines in the policy source."
    blocks = policy.passages("# Usage\n\n" + paragraph + "\nOnly after approval.\n\nOther text.")
    assert blocks[0]["text"] == paragraph + "\nOnly after approval."
    legacy = policy.passages("Usage\n" + paragraph + "\nOnly after approval.")
    assert "Only after approval." in legacy[0]["text"] and "Usage" in legacy[0]["text"]
