"""Task routing and freshness around the existing bounded, source-separated queries."""

import re
from datetime import UTC, datetime

from . import benchmarks, coverage, reference


def resolve(requested=None, task=None):
    if requested:
        return {"domains": list(dict.fromkeys(requested)), "method": "explicit domains"}
    result = {"domains": ["overall"], "method": "overall reference"}
    if task:
        result["note"] = ("Task retained as context; overall evidence shown. "
                          "Use --domain for task-specific evidence.")
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
