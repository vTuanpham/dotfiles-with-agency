"""Task routing and freshness around the existing bounded, source-separated queries."""

import re
from datetime import UTC, datetime

from . import benchmarks, coverage, reference

TASK_DOMAINS = {
    "design": r"\b(ui|ux|visual|layout|front[- ]?end|react|css|design)\b",
    "coding": r"\b(code|coding|refactor|implement|repository|repo|tests?)\b",
    "debugging": r"\b(debug\w*|bugs?|fix(?:es|ing)?|fail(?:s|ed|ing)?|flaky|regressions?|diagnos\w*)\b",
    "performance": r"\b(gpu|cuda|triton|roofline|kernels?|optimi[sz]\w*|latency|throughput|profil\w*)\b",
    "backend": r"\b(backend|database|sql|server|api)\b",
    "writing": r"\b(writing|prose|copywriting|editorial|essays?|blogs?|articles?|memos?|poems?)\b",
    "research": r"\b(research|browse|sources|citations)\b",
    "documents": r"\b(pdf|documents?)\b",
    "vision": r"\b(images?|screenshots?|vision)\b",
    "reasoning": r"\b(math|proof|reasoning|science)\b",
}


def domains(requested=None, task=None):
    if requested:
        return list(dict.fromkeys(requested))
    if task:
        found = [name for name, pattern in TASK_DOMAINS.items() if re.search(pattern, task, re.I)]
        if "debugging" in found and "coding" not in found:
            found.insert(found.index("debugging"), "coding")
        if not found:
            raise ValueError("task mapping Unverified; specify one or more --domain values")
        return found
    return ["overall"]


def age(stamp, now):
    parsed = datetime.fromisoformat(stamp)
    if parsed.tzinfo is None:
        raise ValueError("snapshot retrieval timestamp requires timezone")
    return (now - parsed).total_seconds() / 86400


def search(domains, query="", limit=5, catalog=None, *, now=None, include_effort=False):
    data = benchmarks.snapshot()
    now = now or datetime.now(UTC)
    days = age(data["retrieved"], now)
    notes = []
    if days < 0:
        notes.append("Snapshot retrieval is in the future; freshness Unverified.")
    elif days > reference.MAX_AGE_DAYS:
        notes.append(f"Stale snapshot: over {reference.MAX_AGE_DAYS} days old; refresh evidence.")
    result = {}
    catalog = None if catalog is None else coverage.canonical_catalog(catalog, query)
    for domain in domains:
        found = benchmarks.search(domain, query, limit, catalog, data=data)
        if include_effort:
            aa = data["sources"].get("Artificial Analysis", {})
            found["effort_curves"] = {key: aa[key] for key in (
                "status", "effort_tradeoffs", "metadata", "url") if key in aa}
        found["warnings"] = notes.copy()
        if found["missing_sources"]:
            found["warnings"].append("Unverified: snapshot lacks " + ", ".join(found["missing_sources"]))
        if found["unsupported_effort_count"]:
            found["warnings"].append(
                f"Excluded {found['unsupported_effort_count']} measurements at unsupported native efforts.")
        for name, source in found["sources"].items():
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
