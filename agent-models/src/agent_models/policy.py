"""Slow official policy-text cache; the selecting agent interprets conditions."""

import hashlib
import json
import re
import time
from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request

from agent_accounts.models import timestamp

from . import benchmarks, polling, retrieval, transport
from .state import HOME

DIRECTORY = HOME / "policy"
INTERVAL = 7 * 86400
MAX_BYTES = 1_048_576
SOURCES = {
    "codex-pricing": ("codex", "https://learn.chatgpt.com/docs/pricing.md"),
    "codex-pro-tiers": ("codex", "https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers"),
    "claude-usage": (
        "claude",
        "https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work",
    ),
    "claude-fable": (
        "claude",
        "https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan",
    ),
    "agy-plans": ("agy", "https://antigravity.google/docs/plans.md"),
    "agy-models": ("agy", "https://antigravity.google/docs/models.md"),
    "opencode-models": ("opencode", "https://opencode.ai/v2/docs/console/models/"),
    "opencode-go": ("opencode", "https://opencode.ai/docs/go"),
}
HOSTS = frozenset(urlsplit(url).hostname for _, url in SOURCES.values())


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.parts = {"body": [], "main": [], "article": [], "title": []}

    def handle_starttag(self, tag, attrs):
        self.boundary(tag)
        if tag not in ("meta", "link", "img", "input", "br", "hr", "source", "wbr"):
            self.stack.append(tag)
        if re.fullmatch(r"h[1-6]", tag):
            for part in ("body", "main", "article"):
                if part in self.stack:
                    self.parts[part].append("#" * int(tag[1]) + " ")

    def handle_endtag(self, tag):
        self.boundary(tag)
        if tag in self.stack:
            self.stack = self.stack[: len(self.stack) - 1 - self.stack[::-1].index(tag)]

    def boundary(self, tag):
        if tag in ("p", "div", "section", "footer", "li", "table", "tr") or re.fullmatch(r"h[1-6]", tag):
            for part in ("body", "main", "article"):
                if part in self.stack:
                    self.parts[part].append("\n\n")

    def handle_data(self, data):
        if any(tag in self.stack for tag in ("script", "style", "noscript", "svg", "nav")):
            return
        value = data.strip()
        if value:
            for tag in self.parts:
                if tag in self.stack:
                    self.parts[tag].append(value)


def extract(raw):
    value = raw.decode("utf-8")
    if "<html" in value[:1000].lower() or "<!doctype html" in value[:1000].lower():
        parser = Text()
        parser.feed(value)
        title = " ".join(parser.parts["title"])
        parts = parser.parts["article"] or parser.parts["main"] or parser.parts["body"]
        value = " ".join(parts)
    else:
        title = next((line.lstrip("# ") for line in value.splitlines() if line.strip()), "")
    if (
        len(value.strip()) < 200
        or len(value.split()) < 35
        or not title
        or any(
            word in title.casefold()
            for word in ("captcha", "just a moment", "access denied", "sign in", "log in", "not found")
        )
        or "verify you are human" in value[:2000].casefold()
    ):
        raise ValueError("empty, login or challenge policy page")
    return title, value.strip()


def read(identifier, now=None):
    path = DIRECTORY / (identifier + ".json")
    backend, url = SOURCES[identifier]
    empty = {"schema_version": 1, "id": identifier, "backend": backend, "url": url}
    if not path.is_file():
        return empty
    if path.is_symlink() or path.stat().st_size > 2 * MAX_BYTES:
        raise ValueError("unsafe policy cache")
    return validate(identifier, benchmarks.loads(path.read_text()), now)


def validate(identifier, data, now=None):
    now = time.time() if now is None else now
    backend, url = SOURCES[identifier]
    empty = {"schema_version": 1, "id": identifier, "backend": backend, "url": url}
    if (
        type(data) is not dict
        or any(data.get(key) != value for key, value in empty.items())
        or type(data.get("schema_version")) is not int
    ):
        raise ValueError("invalid policy cache identity")
    for key in ("checked_at", "fetched_at", "attempted_at", "retry_at"):
        if key in data:
            parsed = timestamp(data[key])
            if key != "retry_at" and parsed > now + 60:
                raise ValueError("future policy cache timestamp")
    if "text" in data:
        if (
            type(data["text"]) is not str
            or len(data["text"].strip()) < 200
            or len(data["text"].encode()) > MAX_BYTES
            or data.get("sha256") != hashlib.sha256(data["text"].encode()).hexdigest()
            or type(data.get("title")) is not str
            or "fetched_at" not in data
        ):
            raise ValueError("invalid policy cache content")
    for key in ("etag", "last_modified", "error"):
        if key in data and (
            type(data[key]) is not str or len(data[key]) > 4096 or any(ord(c) < 32 for c in data[key])
        ):
            raise ValueError("invalid policy cache metadata")
    if "resolved_url" in data:
        if type(data["resolved_url"]) is not str:
            raise ValueError("invalid policy response source")
        target = urlsplit(data["resolved_url"])
        if (
            target.scheme != "https"
            or target.hostname not in HOSTS
            or target.username
            or target.password
            or target.port not in (None, 443)
        ):
            raise ValueError("invalid policy response source")
    return data


def fetch(url, old):
    polling.available(url)
    headers = {"User-Agent": "model-guide-policy/0.1", "Accept": "text/markdown,text/html"}
    headers.update(
        {
            header: old[key]
            for header, key in (("If-None-Match", "etag"), ("If-Modified-Since", "last_modified"))
            if old.get(key)
        }
    )
    try:
        with transport.urlopen(Request(url, headers=headers), timeout=20, allowed_hosts=HOSTS) as response:
            target = urlsplit(response.url)
            if (
                target.scheme != "https"
                or target.hostname not in HOSTS
                or target.username
                or target.password
                or target.port not in (None, 443)
                or any(part in ("login", "signin", "auth") for part in target.path.split("/"))
            ):
                raise ValueError("untrusted policy response")
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError("policy source exceeds size limit")
            title, text = extract(raw)
            if response.headers.get("Retry-After") or response.headers.get("X-RateLimit-Remaining") == "0":
                polling.defer(url, dict(response.headers.items()))
            return {
                "title": title,
                "text": text,
                "resolved_url": response.url,
                "sha256": hashlib.sha256(text.encode()).hexdigest(),
                **{
                    key: response.headers[header]
                    for header, key in (("ETag", "etag"), ("Last-Modified", "last_modified"))
                    if header in response.headers
                },
            }
    except HTTPError as error:
        if error.code == 304 and old.get("text"):
            return None
        if error.code in (429, 503):
            polling.defer(url, dict(error.headers.items()))
        raise


def refresh_due(backends=None, *, force=False, now=None):
    now = time.time() if now is None else now
    stamp = datetime.fromtimestamp(now, UTC).isoformat()
    result = []
    for identifier, (backend, url) in SOURCES.items():
        if backends is not None and backend not in backends:
            continue
        try:
            data = read(identifier, now)
        except (OSError, ValueError):
            data = {"schema_version": 1, "id": identifier, "backend": backend, "url": url}
        due = "checked_at" not in data or timestamp(data["checked_at"]) + INTERVAL <= now
        waiting = "retry_at" in data and timestamp(data["retry_at"]) > now
        if force or due and not waiting:
            try:
                changed = fetch(url, data)
                candidate = dict(data)
                if changed is not None:
                    candidate = {
                        **{key: value for key, value in data.items() if key not in ("etag", "last_modified")},
                        **changed,
                        "fetched_at": stamp,
                    }
                candidate.update(checked_at=stamp, attempted_at=stamp)
                candidate.pop("error", None)
                candidate.pop("retry_at", None)
                data = validate(identifier, candidate, now)
            except (OSError, ValueError, KeyError) as error:
                reason = f"HTTP {error.code}" if isinstance(error, HTTPError) else type(error).__name__
                data.update(
                    attempted_at=stamp,
                    error="Policy check failed: " + reason,
                    retry_at=datetime.fromtimestamp(now + 3600, UTC).isoformat(),
                )
            DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
            benchmarks.write_snapshot(
                DIRECTORY / (identifier + ".json"),
                json.dumps(data, ensure_ascii=False, allow_nan=False) + "\n",
            )
        result.append(data)
    return result


def metadata(backends, *, now=None):
    now = time.time() if now is None else now
    result = []
    for identifier, (backend, url) in SOURCES.items():
        if backend not in backends:
            continue
        try:
            data = read(identifier, now)
        except (OSError, ValueError):
            data = {"error": "Policy cache unavailable"}
        status = (
            "missing"
            if not data.get("text")
            else "fresh"
            if "checked_at" in data and timestamp(data["checked_at"]) + INTERVAL > now
            else "stale"
        )
        if data.get("text") and data.get("error"):
            status = "last-good; latest check failed"
        result.append(
            {
                "id": identifier,
                "backend": backend,
                "url": url,
                "status": status,
                **{
                    key: data.get(key)
                    for key in ("title", "checked_at", "fetched_at", "sha256", "error", "resolved_url")
                },
                "read": "model-guide policy --backend " + backend,
            }
        )
    return result


def render(records):
    lines = [
        "Cached official policy text; conditions are interpreted by the selecting agent. "
        "This is not session entitlement or permission to spend."
    ]
    for record in records:
        lines.extend(
            [
                "",
                record["id"] + " · " + record["url"],
                "Fetched "
                + record.get("fetched_at", "unknown")
                + "; checked "
                + record.get("checked_at", "unknown"),
                record.get("error", ""),
                record.get("text", "Policy content unavailable; conditions unknown."),
            ]
        )
    return "\n".join(lines)


def passages(text):
    """Retain whole source paragraphs and their headings, including adjacent qualifications."""
    blocks, heading = [], ""
    markdown = re.search(r"(?m)^#{1,6}\s", text) is not None
    for paragraph in re.split(r"\n\s*\n", text):
        lines = paragraph.strip().splitlines()
        if not lines:
            continue
        body = []
        for line in lines:
            if re.match(r"^#{1,6}\s", line):
                heading = line.lstrip("# ")
            elif line.strip():
                body.append(line.strip())
        if body and (markdown or any(line.startswith("|") for line in body)):
            blocks.append({"heading": heading, "text": "\n".join(body)})
            continue
        # Older HTML caches have one text node per line; keep short qualifications with their text.
        pending = []
        start = len(blocks)
        for line in body:
            if len(line.split()) >= 12:
                blocks.append({"heading": heading, "text": " ".join([*pending, line])})
                pending = []
            else:
                pending.append(line)
        if pending:
            if len(blocks) > start:
                blocks[-1]["text"] += " " + " ".join(pending)
            else:
                blocks.append({"heading": heading, "text": " ".join(pending)})
    return blocks


def excerpts(backends, *, context=None, observations=None):
    """Bring current source conditions into the comparison; never turn excerpts into access rules."""
    context, observations = context or {}, observations or {}
    result = metadata(backends)
    for item in result:
        try:
            record = read(item["id"])
            blocks = passages(record.get("text", ""))
            if not blocks:
                continue
            backend = item["backend"]
            caller = context.get("accounts", {}).get(backend, {})
            observed = observations.get(backend, {}).get("account_observation", {})
            plans = [q["plan"] for q in observed.get("quotas", []) if q.get("plan")]
            profile = observed.get("profiles", {}).get(backend, {})
            plans.extend(
                v for k, v in profile.items() if k in ("plan", "subscriptionType") and isinstance(v, str)
            )
            query = " ".join(
                [
                    backend,
                    *caller.values(),
                    *plans,
                    "Usage subscription plan limits quota allowance weekly hourly monthly reset "
                    "included credits "
                    "billing availability eligibility restrictions exceptions.",
                ]
            )
            relevant = [
                b
                for b in blocks
                if not (
                    "@ai-sdk/" in b["text"]
                    or "inference/" in b["text"]
                    or re.match(r"(?i)^(to learn more|for more information)\b", b["text"])
                )
            ]
            if not relevant:
                continue
            blocks = []
            for block in relevant:
                if block["heading"] and blocks and blocks[-1]["heading"] == block["heading"]:
                    blocks[-1]["text"] += "\n\n" + block["text"]
                else:
                    blocks.append(dict(block))
            units = []
            for index, block in enumerate(blocks):
                chosen = [block]
                for neighbor in blocks[index + 1 :]:
                    if chosen[-1]["text"].endswith(":") or re.match(
                        r"(?i)^(except|unless|however|note\b|only\b|this\b|these\b|\\?\*|†|‡)",
                        neighbor["text"],
                    ):
                        chosen.append(neighbor)
                    else:
                        break
                units.append(chosen)
            texts = [" ".join(b["heading"] + " " + b["text"] for b in unit) for unit in units]
            ranked = retrieval.lexical_rank(query, texts)
            limits_query = "usage limits quota reset weekly hourly monthly shared pool"
            limits = retrieval.lexical_rank(limits_query, [unit[0]["heading"] for unit in units])
            if not limits:
                limits = retrieval.lexical_rank(limits_query, texts)
            chosen = []
            for index in dict.fromkeys(ranked[:1] + limits[:1]):
                for block in units[index]:
                    if block not in chosen:
                        chosen.append(block)
            item["passages"] = chosen
            sections, heading = [], None
            for block in chosen:
                if block["heading"] != heading:
                    heading = block["heading"]
                    if heading:
                        sections.append(heading + ":")
                sections.append(block["text"])
            item["excerpt"] = "\n".join(sections)
            item["scope"] = "Retrieved source passages; full conditions remain in the cached policy text."
        except (ImportError, OSError, ValueError, RuntimeError) as error:
            item["retrieval_error"] = type(error).__name__
    return result
