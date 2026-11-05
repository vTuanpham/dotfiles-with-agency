"""Code-only benchmark proposals and explicit recording of source-reviewed prose."""

import difflib
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from . import benchmarks, generated, reference
from .inventory import ZDR_FREE
from .state import HOME

DIR = HOME / "refresh"
STAMP = DIR / "last"
BULLET = re.compile(r"^- \*\*([^*]+)\*\*", re.M)
FREE_IDS = re.compile(r"`(opencode/[\w.\-]+-free)`")
CHECKED = re.compile(r"Checked \d{4}-\d{2}-\d{2}")
HOLDER_WORDING = re.compile(
    r"\b(?:not\s+subscribed|your\s+plan\s+is|currently\s+on|pro\s+lite|our\s+pro|"
    r"the\s+user(?:'s\s+plans|\s+is\s+on)|the\s+owner(?:'s\s+(?:plan|subscription)|\s+subscribes)|"
    r"we\s+have\s+(?:a\s+)?(?:pro|plus|max)|35%\s+and\s+12%|"
    r"used\s+extremely\s+heavily|burn\s+the\s+plus\s+accounts)\b",
    re.I,
)


def unchanged(old, new):
    """The same document, whatever date it says it was checked on."""
    return CHECKED.sub("Checked", old) == CHECKED.sub("Checked", new)


def validate(old, new, stamp, name="models.md"):
    """(errors that reject the proposal, notes shown to the user)."""
    errors, notes = [], []
    if HOLDER_WORDING.search(new):
        errors.append("holder-specific wording is forbidden in public guides")
    if name == "models.md":
        try:
            if generated.prose(old) != generated.prose(new):
                errors.append("hand-written prose changed in a generated proposal")
            return errors, notes
        except ValueError as error:
            errors.append(str(error))
            return errors, notes
    if unchanged(old, new):
        return errors, notes
    if not 0.7 * len(old) <= len(new) <= 1.5 * len(old):
        errors.append("the size changed too much: a rewrite, not a refresh")
    for heading in re.findall(r"^###+ .*", old, re.M):
        if heading not in new:
            errors.append(f"the heading {heading!r} is missing")
    if f"Checked {stamp}" not in new:
        errors.append(f"the Checked date was not set to {stamp}")
    if BULLET.findall(old) != BULLET.findall(new):
        errors.append("the bullet labels changed")
    if name == "subscriptions.md":
        if table_labels(old) != table_labels(new):
            errors.append("the subscription tier rows changed")
        free = next((line for line in new.splitlines() if line.startswith("- **OpenCode free**")), "")
        if set(FREE_IDS.findall(free)) != set(ZDR_FREE):
            errors.append("the free-tier list differs from the zero-retention list in code")
    return errors, notes


def content_errors(text, name, stamp, *, checked=True):
    errors = []
    sections = {
        "models.md": ("## Model decision evidence", "### Effort and model strength",
                      "### Capability evidence", "### Cost versus performance", "### Inventory coverage"),
        "subscriptions.md": ("### Find live account state", "### Codex / ChatGPT", "### Antigravity / agy",
                             "### OpenCode", "### Claude / Claude Code"),
    }
    for section in sections[name]:
        if section not in text:
            errors.append(f"{name}: missing section {section}")
    if checked and f"Checked {stamp}" not in text:
        errors.append(f"{name}: Checked date must be {stamp}")
    if HOLDER_WORDING.search(text):
        errors.append(f"{name}: holder-specific wording is forbidden")
    links = re.findall(r"\]\(([^)]+)\)", text)
    if text.count("](") != len(links):
        errors.append(f"{name}: malformed Markdown link")
    for link in links:
        try:
            parsed = urlsplit(link)
            _ = parsed.port
        except ValueError:
            errors.append(f"{name}: malformed link {link!r}")
            continue
        if (any(c.isspace() for c in link) or
                (parsed.scheme and (parsed.scheme not in ("https", "http") or not parsed.netloc)) or
                (not parsed.scheme and not (reference.GUIDES / parsed.path).is_file())):
            errors.append(f"{name}: malformed or missing link {link!r}")
    return errors


def table_labels(text):
    return [line.split("|")[1].strip() for line in text.splitlines() if line.startswith("| ")]


def report(work, old, new, errors, notes, snapshot):
    diff = "".join(
        line for name in reference.DOCUMENTS
        for line in difflib.unified_diff(old[name].splitlines(1), new[name].splitlines(1),
                                         f"current/{name}", f"proposed/{name}")
    )
    said = (work / "notes.md").read_text(encoding="utf-8") if (work / "notes.md").is_file() else "(none)"
    parts = [
        "Rejected:\n" + "\n".join(f"- {e}" for e in errors) if errors else "Checks passed.",
        "Big moves:\n" + "\n".join(f"- {n}" for n in notes) if notes else "",
        f"Generation notes:\n{said}",
        "Review provenance:\n" + generated.provenance(snapshot),
        f"Diff:\n{diff or '(no change)'}",
    ]
    text = "\n\n".join(p for p in parts if p)
    (work / "report.md").write_text(text, encoding="utf-8")
    return text


def documents(directory, prefix=""):
    return {name: (directory / f"{prefix}{name}").read_text(encoding="utf-8")
            for name in reference.DOCUMENTS}


def validate_documents(old, new, stamp, snapshot):
    errors, notes = [], []
    for name in reference.DOCUMENTS:
        if name == "subscriptions.md" and old[name] != new[name]:
            errors.append("subscriptions.md: hand-written subscription facts changed in a generated proposal")
        rejected, moves = validate(old[name], new[name], stamp, name)
        errors.extend(f"{name}: {error}" for error in rejected)
        notes.extend(f"{name}: {note}" for note in moves)
        if name == "models.md":
            if generated.render(new[name], snapshot) != new[name]:
                errors.append("models.md: generated sections differ from the benchmark snapshot")
            errors.extend(content_errors(new[name], name, stamp, checked=False))
        if name != "models.md" and not unchanged(old[name], new[name]):
            errors.extend(content_errors(new[name], name, stamp))
        if (name != "models.md"
                and new[name].lower().count("unverified") < old[name].lower().count("unverified")):
            errors.append(f"{name}: Unverified markers were removed")
    return errors, notes


def poll():
    from . import policy, polling

    policy.refresh_due()
    try:
        previous = benchmarks.snapshot()
    except ValueError:
        previous = {"sources": {name: {"url": benchmarks.SOURCE_URLS[name],
                                      "status": "unavailable", "error": "not fetched"}
                                for name in benchmarks.loaders()}}
    for name in benchmarks.loaders():
        previous["sources"].setdefault(name, {"url": benchmarks.SOURCE_URLS[name],
                                             "status": "unavailable", "error": "not fetched"})
    names, fetched, messages = polling.check(previous)
    for message in messages:
        print(message)
    if not names:
        print("no benchmark changes due for regeneration")
        return 0
    benchmarks.prepare(benchmarks.CACHE, names=names, previous=previous, fetched=fetched)
    updated = benchmarks.snapshot()
    polling.accept([name for name in names if updated["sources"][name]["status"] == "ok"])
    return run(snapshot=updated)


def run(force=False, *, names=None, previous=None, fetched=None, snapshot=None):
    if reference.PENDING.is_file() and not force:
        if snapshot is None:
            return poll()
        print("observation cache refreshed; existing guide proposal left unchanged and unapproved")
        return 0
    today = date.today().isoformat()
    captured = snapshot is not None
    # A failed replacement must not leave an older pointer to overwritten scratch files.
    if force:
        reference.PENDING.unlink(missing_ok=True)
    work = DIR / today
    work.mkdir(parents=True, exist_ok=True)
    current = documents(reference.GUIDES)
    for name, text in current.items():
        (work / f"current-{name}").write_text(text, encoding="utf-8")
    if snapshot is not None:
        benchmarks.write_snapshot(work / "benchmark-data.json",
                                  json.dumps(snapshot, indent=2, allow_nan=False) + "\n")
        (work / "benchmark-report.md").write_text((benchmarks.CACHE / "benchmark-report.md").read_text())
    elif names is None:
        benchmarks.prepare(work)
    else:
        benchmarks.prepare(work, names=names, previous=previous, fetched=fetched)
    snapshot = benchmarks.loads((work / "benchmark-data.json").read_text())
    new = {**current, "models.md": generated.render(current["models.md"], snapshot)}
    for name, text in new.items():
        (work / f"proposed-{name}").write_text(text, encoding="utf-8")
    if not captured:
        benchmarks.CACHE.mkdir(parents=True, exist_ok=True)
        for name in ("benchmark-data.json", "benchmark-report.md"):
            benchmarks.write_snapshot(benchmarks.CACHE / name, (work / name).read_text())
    (work / "notes.md").write_text(
        "Generated from benchmark-data.json; prose and subscriptions were not reviewed.\n"
        "Inspect release, methodology, source failures and frontier scope before applying.\n",
        encoding="utf-8",
    )
    errors, notes = validate_documents(current, new, today, snapshot)
    report(work, current, new, errors, notes, snapshot)
    if errors:
        print(f"proposal rejected, nothing changed: {'; '.join(errors)}\nreport: {work / 'report.md'}")
        return 1
    if documents(reference.GUIDES) != current:
        print(f"the guide changed while generation ran; nothing applied. `refresh --force` to redo\n{work}")
        return 1
    # Even an unchanged proposal requires explicit review before the lock can advance.
    STAMP.write_text(today)
    reference.PENDING.write_text(str(work))
    print(f"a proposal is waiting for the next root to re-check and apply: {work / 'report.md'}")
    return 0


def install(new, snapshot):
    for name, text in new.items():
        (reference.GUIDES / name).write_text(text, encoding="utf-8")
    reference.accept(evidence=snapshot)
    reference.PENDING.unlink(missing_ok=True)


def committed():
    """The public baseline, not a copy captured after the root's edits."""
    result = {}
    for name in reference.DOCUMENTS:
        path = reference.GUIDES / name
        relative = subprocess.run(["git", "ls-files", "--full-name", "--", str(path)],
                                  cwd=reference.GUIDES, check=True, capture_output=True,
                                  text=True).stdout.strip()
        if not relative:
            sys.exit(f"cannot review {name}: guide must have a committed baseline")
        result[name] = subprocess.run(["git", "show", f"HEAD:{relative}"], cwd=reference.GUIDES,
                                      check=True, capture_output=True, text=True,
                                      ).stdout
    return result


def record(yes=False):
    """Validate root edits and record their review; never modify the documents."""
    current, baseline = documents(reference.GUIDES), committed()
    found = reference.live()
    errors = []
    today = date.today().isoformat()
    try:
        generated_changed = (generated.contents(current["models.md"])
                             != generated.contents(baseline["models.md"]))
        if (generated_changed
                and generated.render(current["models.md"], benchmarks.snapshot()) != current["models.md"]):
            errors.append("models.md: generated sections were edited; use refresh to regenerate")
    except ValueError as error:
        errors.append(str(error))
    for name, text in current.items():
        errors.extend(content_errors(text, name, today))
        before = generated.prose(baseline[name]) if name == "models.md" else baseline[name]
        after = generated.prose(text) if name == "models.md" else text
        if after.lower().count("unverified") < before.lower().count("unverified"):
            errors.append(f"{name}: Unverified markers were removed; retain unresolved claims")
    missing_tiers = set(table_labels(baseline["subscriptions.md"])) - set(
        table_labels(current["subscriptions.md"]))
    if missing_tiers:
        errors.append("subscriptions.md: missing tier rows: " + ", ".join(sorted(missing_tiers)))
    if set(BULLET.findall(baseline["subscriptions.md"])) - set(
            BULLET.findall(current["subscriptions.md"])):
        errors.append("subscriptions.md: a subscription catalog bullet was removed")
    free = next((line for line in current["subscriptions.md"].splitlines()
                 if line.startswith("- **OpenCode free**")), "")
    if set(FREE_IDS.findall(free)) != set(ZDR_FREE):
        errors.append("subscriptions.md: the free-tier list differs from the zero-retention list in code")
    for name in reference.DOCUMENTS:
        print("".join(difflib.unified_diff(baseline[name].splitlines(1), current[name].splitlines(1),
                                          f"HEAD/{name}", f"working/{name}")), end="")
    if errors:
        sys.exit("record refused:\n" + "\n".join(f"- {error}" for error in errors))
    if not yes:
        if not sys.stdin.isatty():
            sys.exit("re-check the cited sources, then re-run refresh --record --yes")
        if input("Record both guides as source-checked? [y/N] ").strip().lower() != "y":
            return 1
    if documents(reference.GUIDES) != current:
        sys.exit("guides changed during review; record again")
    evidence = benchmarks.snapshot() if (benchmarks.CACHE / "benchmark-data.json").is_file() else None
    if evidence is not None and generated.render(current["models.md"], evidence) != current["models.md"]:
        evidence = None
    reference.accept(found=found, evidence=evidence)
    reference.PENDING.unlink(missing_ok=True)
    print("recorded both guides and live model lists in models.lock; guide text unchanged (uncommitted)")
    return 0


def apply(yes):
    if not reference.PENDING.is_file():
        sys.exit("nothing is waiting")
    work = Path(reference.PENDING.read_text())
    old, new = documents(reference.GUIDES), documents(work, "proposed-")
    if old != documents(work, "current-"):
        sys.exit(
            "the guide changed since this proposal was made; applying it would undo that: `refresh --force`"
        )
    snapshot = benchmarks.loads((work / "benchmark-data.json").read_text())
    errors, notes = validate_documents(old, new, work.name, snapshot)
    text = report(work, old, new, errors, notes, snapshot)
    if errors:
        sys.exit(text)
    print(text)
    if not yes:
        if not sys.stdin.isatty():
            sys.exit("re-check the changed claims against their cited sources, then re-run with --yes")
        if input("Apply this to both guides? [y/N] ").strip().lower() != "y":
            print("left as it was; `refresh --discard` drops it")
            return 1
    if documents(reference.GUIDES) != old:
        sys.exit("the guides changed during review; refresh again")
    install(new, snapshot)
    print("applied to shared models.md, subscriptions.md and models.lock (uncommitted, see `git diff`)")
    return 0


def discard():
    reference.PENDING.unlink(missing_ok=True)
    print("dropped the waiting proposal")
    return 0
