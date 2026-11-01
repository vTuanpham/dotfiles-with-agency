# Maintaining the shared model reference

`model-guide check` reads document drift and review age as JSON without provider
processes. Add `--live` to query native inventory. `stale --live` also caches
inventory warnings; a missing or signed-out provider does not prove disappearance.

The daily timer adds 2h jitter; `refresh --poll` checks sources when due (36h).
Conditional validators or parsed-row digests skip unchanged data; only changed
sources refresh. Private poll state retains validators and exponential backoff,
honouring Retry-After/429. Pending review pauses polling. AA uses the official
keyed API via ARTIFICIAL_ANALYSIS_API_KEY (optional service EnvironmentFile);
without a key its automatic poll is disabled under the website terms. Manual
refresh retains the public-page adapter. Keys never enter reports or snapshots.
`model-guide refresh --force` fetches the snapshot and replaces only the
delimited numeric sections in a pending models.md proposal. No agent is launched,
no prose or subscription facts are reviewed, and nothing auto-applies.
Manual force also honours server backoff. `benchmarks --coverage --backend BACKEND --brief`
shows export/configuration/harness gaps and unmatched current-family names.

Read report.md for digests/methodology notes; models.md contains bounded decision views.
Inspect source failures, release identities, retrieval dates, settings and frontier scope.
Missing measurements stay Unverified; versions, harnesses and cost definitions
must not be blended. Then `model-guide refresh --apply --yes`, or `--discard`.
Apply regenerates the sections from the saved snapshot and rejects tampering or
intervening guide edits. Only apply/record advances models.lock; edits stay uncommitted.

`model-guide refresh --prepare` only fetches evidence and computes frontiers.
Search it with `model-guide benchmarks --domain design --query sonnet --limit 5 --brief`;
inspect quality and efficiency separately. Omit `--brief` for JSON.
`model-guide models --backend BACKEND --json` shows native coverage and unmatched IDs.
Account hints do not establish the selected session's identity, access or billing mode.

Qualitative advice, class mapping and domain limits stay hand-written. For chosen
prose/subscription changes, read `model-guide read sources`, source-check claims,
retain unresolved Unverified markers and update the document's Checked date.
`model-guide refresh --record --yes` validates against the committed baseline and
records hashes without editing text. It cannot bless hand edits to generated sections.
Benchmark-only application does not advance the prose's Checked date.

Sources not fetched by the snapshot (including vendor token prices, throughput
and additional domain boards) stay Unverified here. Adding one needs a reviewed
decoder and methodology, not a transcription worker. Reference maintenance never
changes accounts, model defaults, delegation permissions or the OpenCode privacy gate.

When publishing benchmark figures, regenerate their README assets from the reviewed
snapshot and inspect the render; `docs/tools/README.md` owns those generators.
