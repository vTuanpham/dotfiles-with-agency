"""Task routing and freshness around the existing bounded, source-separated queries."""

import re
from datetime import UTC, datetime

from . import benchmarks, coverage, reference

# These are retrieval cues, not a model capability table or a decision score.
TASK_CUES = {
    "debugging": r"\b(?:debug\w*|bug\w*|regression\w*|flak\w*|crash\w*|race condition\w*|"
                 r"deadlock\w*|incorrect|fail\w*|fix(?:es|ed|ing)?|errors?|exceptions?|"
                 r"broken|fault\w*|vanish\w*|disappear\w*)\b",
    "coding": r"\b(?:code|coding|program\w*|implement\w*|refactor\w*|tests?|pytest|"
              r"repository|codebase|software|function\w*|script\w*|patch\w*)\b",
    "backend": r"\b(?:backend|back.end|database\w*|sql|endpoint\w*|server.side|service architecture)\b",
    "design": r"\b(?:design\w*|ui|ux|interface\w*|layout\w*|responsive|css|typography|visual\w*)\b",
    "browser": r"\b(?:browser\w*|web ?app\w*|website\w*|web ?page\w*|web interface\w*|"
               r"computer use|desktop interaction|click\w*|screenshots?)\b",
    "vision": r"\b(?:image\w*|photos?|pictures?|screenshots?|vision|video\w*)\b",
    "research": r"\b(?:research\w*|literature|citations?|sources?|fact.check\w*)\b",
    "writing": r"\b(?:write|writes|writing|written|rewrite|rewrites|rewriting|draft(?:ed|ing)?|"
               r"prose|copyedit\w*)\b",
    "documents": r"\b(?:document\w*|reports?|papers?|pdf\w*|readme\w*|documentation)\b",
    "long-context": r"\b(?:long.context|large document\w*|long document\w*|entire codebase|"
                    r"whole codebase|large codebase|many files)\b",
    "data": r"\b(?:data analy\w*|dataset\w*|spreadsheet\w*|csv|statistics|data processing)\b",
    "performance": r"\b(?:performance|profil\w*|optimi[sz]\w*|latency|throughput|bottleneck\w*)\b",
    "terminal": r"\b(?:terminal|shell|command.line|bash|zsh|cli)\b",
    "tools": r"\b(?:tool.call\w*|tool.use|function.call\w*|mcp)\b",
    "finance": r"\b(?:financ\w*|invest(?:ed|ing|ors?|ments?)?|portfolio\w*|stock\w*|budget\w*)\b",
    "legal": r"\b(?:legal|laws?|contract\w*|regulat\w*|litigation)\b",
    "tax": r"\b(?:tax\w*|deductible|deduction\w*|quarterly filing)\b",
    "reasoning": r"\b(?:mathemat\w*|logic\w*|theorem\w*|proof\w*|reasoning)\b",
}


def positive_task(task):
    clauses = re.split(r"[.;\n]|\b(?:but|however|instead)\b", task.casefold())
    positive = []
    for clause in clauses:
        before = re.split(r"\b(?:do not|don't|does not|doesn't|without|avoid|exclude|not)\b",
                          clause, maxsplit=1)[0]
        positive.append(before)
    return " ".join(positive).strip()


def task_domains(task):
    """Retrieve candidate domains from positive task clauses; callers may override them."""
    text = positive_task(task)
    domains = [domain for domain, pattern in TASK_CUES.items() if re.search(pattern, text)]
    if ("design" in domains or "browser" in domains) and re.search(
            r"\b(?:build|implement\w*|develop\w*|creat\w*)\b", text) and "coding" not in domains:
        domains.append("coding")
    return domains


def resolve(requested=None, task=None):
    if requested:
        return {"domains": list(dict.fromkeys(requested)), "method": "explicit domains"}
    domains = task_domains(task) if task else []
    lexical = bool(domains)
    semantic_unavailable = False
    if task and (text := positive_task(task)):
        from . import semantic

        try:
            inferred = semantic.domains(text, download=not lexical)
        except (ImportError, OSError, ValueError, RuntimeError):
            inferred = []
            semantic_unavailable = True
        domains = list(dict.fromkeys([*domains, *inferred]))
        if inferred and lexical:
            method = "task cues and local semantic similarity"
        elif inferred:
            method = "local semantic similarity"
        else:
            method = "task cues"
        if domains:
            return {"domains": domains, "method": method,
                    "note": "Evidence areas are inferred suggestions; review their fit."}
    result = {"domains": ["overall"], "method": "overall reference"}
    if task:
        result["note"] = ("Semantic evidence routing unavailable; overall evidence shown. "
                          "Use --domain to specify areas." if semantic_unavailable else
                          "No clear task evidence areas found; overall evidence shown. "
                          "Use --domain to specify them.")
    return result


def age(stamp, now):
    parsed = datetime.fromisoformat(stamp)
    if parsed.tzinfo is None:
        raise ValueError("snapshot retrieval timestamp requires timezone")
    return (now - parsed).total_seconds() / 86400


def search(domains, query="", limit=5, catalog=None, *, now=None, include_effort=False, complete=False,
           data=None):
    data = benchmarks.snapshot() if data is None else data
    now = now or datetime.now(UTC)
    days = age(data["retrieved"], now)
    notes = []
    review = reference.review_status(data)
    if review["status"] != "reviewed":
        notes.append("Benchmark review: " + review["status"] + "; fetched data is not source approval.")
    if days < 0:
        notes.append("Snapshot retrieval is in the future; freshness Unverified.")
    elif days > reference.MAX_AGE_DAYS:
        notes.append(f"Stale snapshot: over {reference.MAX_AGE_DAYS} days old; refresh evidence.")
    result = {}
    catalog = None if catalog is None else coverage.canonical_catalog(catalog, query)
    native = coverage.summarize(catalog, data, query) if catalog is not None else None
    for domain in domains:
        found = benchmarks.search(domain, query, limit, catalog, data=data, include_speed=include_effort,
                                  complete=complete, native_catalog=native)
        found["warnings"] = notes.copy()
        found["review"] = review
        if found["missing_sources"]:
            found["warnings"].append("Unverified: snapshot lacks " + ", ".join(found["missing_sources"]))
        if found["unsupported_effort_count"]:
            found["warnings"].append(
                f"Excluded {found['unsupported_effort_count']} measurements at unsupported native efforts.")
        for name, source in found["sources"].items():
            if source.get("coverage_gap"):
                found["warnings"].append(name + ": " + source["coverage_gap"])
            if source.get("retrieved") and age(source["retrieved"], now) > reference.MAX_AGE_DAYS:
                found["warnings"].append(f"{name}: cached source retrieval is stale ({source['retrieved']}).")
            stamp = source.get("published", source.get("release", "")) or ""
            if re.fullmatch(r"\d{8}", stamp):
                stamp = datetime.strptime(stamp, "%Y%m%d").date().isoformat()
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp):
                source["age_days"] = (now.date() - datetime.fromisoformat(stamp).date()).days
                if source["age_days"] > reference.MAX_AGE_DAYS:
                    found["warnings"].append(f"{name}: source publication is stale ({stamp}).")
            dates = source.pop("run_dates", None)
            if dates:
                known = [stamp for stamp in dates if stamp is not None]
                old = sum((now.date() - datetime.fromisoformat(stamp).date()).days
                          > reference.MAX_AGE_DAYS for stamp in known)
                newest = max(known) if known else "Unverified"
                source["run_freshness"] = {"newest": newest, "rows": len(dates),
                    "older_rows": old, "unknown_dates": len(dates) - len(known)}
                scope = "matching run" if catalog is not None or query else "run"
                note = (f"{name}: newest {scope} {newest}; {old / len(dates):.0%} of rows "
                        f"older than {reference.MAX_AGE_DAYS} days")
                if not known:
                    note = f"{name}: run dates Unverified for {len(dates)} matching rows"
                    if source.get("published"):
                        note += "; source updated " + source["published"]
                elif len(known) < len(dates):
                    note += f"; {len(dates) - len(known)} run dates Unverified"
                if any(datetime.fromisoformat(stamp).date() > now.date() for stamp in known):
                    note += "; future run dates: freshness Unverified"
                found["warnings"].append(note + ".")
        result[domain] = found
    return result
