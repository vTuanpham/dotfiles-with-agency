## Where the reference facts come from (first-hand access notes)
Benchmark sources checked 2026-10-30; vendor/plan recipes below retain their 2026-10-27 review unless separately dated. Use the current release and methodology, not cached snippets or an older project README. Record fetch failures rather than substituting an older benchmark. Sources never establish the selected session's account state.

### Capability coverage and current releases

| Primary source | Current version/release checked | Use and limits |
|---|---|---|
| [Artificial Analysis models](https://artificialanalysis.ai/leaderboards/models) / [API](https://artificialanalysis.ai/api-reference) / [method](https://artificialanalysis.ai/methodology/intelligence-benchmarking) | Website: Intelligence Index v5.0; free API does not identify its methodology version | With ARTIFICIAL_ANALYSIS_API_KEY, ingest every free-API record, keyed by stable id; effort comes from the name, never an unsuffixed slug. Keep fallback configuration. Unrounded scores and token prices are published; task cost/effort curves, run dates and agent scaffolds are absent from this endpoint. Attribution: Artificial Analysis. Manual keyless refresh retains the page adapter. |
| [AA coding agents](https://artificialanalysis.ai/agents/coding-agents) / [method](https://artificialanalysis.ai/methodology/coding-agents-benchmarking) | Coding Agent Index v2.0; reviewed, not ingested | FrontierCode v1.1, Terminal-Bench 4.0, SWE-Atlas-QnA-AA. No documented free-API agent/scaffold export established; the models endpoint's Coding Index is not this agent board. Do not invent harness attribution or scrape gated charts. |
| [Arena](https://arena.ai/leaderboard) / [method](https://arena.ai/how-it-works) / [official dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) | Dynamic, modality-specific publication dates | Text categories, WebDev, Vision, Document, Search and Agent. Preserve effort, counts, confidence intervals, adjustment filters and preliminary status. Preference differs from correctness; Agent uses a different scale. |
| [LiveBench](https://livebench.ai/#/) / [method](https://livebench.ai/#/methodology) | 2.0, release 2026-10-25 | Long agentic, design, coding, browser, data analysis, research, reasoning; one run/suite. Read current CSVs, weights, costs and effort metadata. Old LiveBench 1.0 categories and repository/paper are not the 2.0 method. |
| [Vals Index](https://www.vals.ai/benchmarks/vals_index) / [method](https://www.vals.ai/methodology) | 2.2, board updated 2026-10-29 | Discover the linked benchmark_view JSON, not the filtered chart. Retain all nine components, model IDs, effort controls, harness and provider/sampling configuration. Keep Cost/Test and Duration/Test; null effort/harness is Unverified. GDP weighting is not a domain score. |
| [Terminal-Bench](https://www.tbench.ai/) / [Vals run](https://www.vals.ai/benchmarks/terminal-bench-4) | 4.0 | Vals: mini-swe-agent, three pass@1 runs, 66 tasks, eight-hour task limit, duration/cost. Task/harness changes make 2.1 incomparable. |
| [SWE-bench](https://www.swebench.com/) / [official JSON](https://github.com/SWE-bench/swe-bench.github.io/blob/master/data/leaderboards.json) | All five published tracks, not default Bash Only | Keep submission, model_display, agent, published scaffold version and reasoning_effort. Warning-marked scores remain Unverified. Named agents with no explicit base model stay unmatched; submission date is not model release date. |
| [LiveCodeBench](https://livecodebench.github.io/) / [generation JSON](https://livecodebench.github.io/performances_generation.json) | Full currently linked generation dataset; all question dates | Keep every question/model result, not the default slider window. Preserve the official UI's contamination exclusion for questions before model release; unknown cutoffs cannot establish a clean rank. Question publication is not a run date. Other scenarios/archived v5 are not this export; harness versions/costs are absent. Contest scores do not establish repository/UI ability. |
| [LongBench v2](https://longbench2.github.io/) / [method and tasks](https://github.com/THUDM/LongBench) | v2; reviewed, not ingested | Official scores are a static table with CoT and length bins; no stable structured model-result export verified. The 503-question task JSON is not model results. Sparse current-family coverage; unknown scores stay Unverified. |
| [BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html) / [CSV](https://gorilla.cs.berkeley.edu/data_overall.csv) | V4, eval f7cf735 / 2025.12.17; site dated 2026-04-12 | Full current CSV, FC and Prompt scaffolds separate. Total benchmark cost differs from mean response latency. Effort and run date are not published; current families may be absent. Raw component scores retained. |
| [OSWorld](https://osworld-v2.xlang.ai/) / [official JSON](https://osworld-v2.xlang.ai/static/data/leaderboard/official-results.json) | 2.0, dataset updated 2026-10-15 | Every release, full/offline subset, step budget, reasoning and tool mode; binary and partial metrics separate. Explicit basePlannerModel is evidence for an agent scaffold, not a native CLI score. Estimated total cost is not cost/task; only explicit costPerTaskUsd supports that claim. |
| [kernelbench.com](https://kernelbench.com/) / [official JSON](https://raw.githubusercontent.com/Infatoshi/kernelbench.com/master/public/data/models.json) / [contract and units](https://github.com/Infatoshi/kernelbench.com/blob/master/app/_lib/models.ts) | Unversioned methodology; dated JSON plus content/method digests | `performance`: independent of Stanford KernelBench; single-maintainer, small decks. Read every audit outcome, not only each model's selected cells; retain per-run effort, harness/version when explicit, GPU and operation. Roofline %, baseline speedup and geomean latency never share a rank. Manifests curate publishable runs; catalog and Mega CSV are chosen cells/sweep receipts, not an effort catalog. Unaudited/retired/missing/ambiguous measurements stay Unverified. Astra Pro is distinct from Astra. |
| [Bug Hunt](https://bughunt.productcompass.pm/) / [method](https://bughunt.productcompass.pm/method) / [canonical receipts](https://github.com/phuryn/bug-hunt-bench/blob/main/results/runs.csv) | Unversioned methodology; all 308 receipts, 296 live, newest 2026-10-27 at review | `debugging`: 105 planted bugs in two repos, no bug report, hidden answer key and blind judge; single maintainer. Preserve every effort, harness and harness_version; average only identical configurations. Site JSON is a 207-row summary and omits newer replicate dates. Superseded receipts stay raw, not ranked. Routed aliases reused for dated models stay unmatched. Bill/list/floor/free costs are separate; missing or disputed per-run costs are never repaired from a summary. |

Cover reasoning/math/science, repository/terminal work, UI/design, writing and instruction following, vision/documents, long context, tool use, research and professional/data work. Missing current evidence is Unverified, not zero. Compare cost-quality and completion-time frontiers within a source and domain; never merge unlike scores into a universal rating.

Specialist sources reviewed 2026-11-01: both pass the ingestion bar as limited,
descriptive evidence, not independent replications or universal rankings. Both
publish structured data and an inspectable scoring procedure; neither provides
a stable numbered methodology release, so that version remains Unverified and
method/data digests expose changes. Individual publishers are separate from
vendor boards; funding/affiliations and independent replication are not verified.
KernelBench's index supplies all audit outcomes and explicit operation units.
Reconcile its catalog, CUDA/Hard published-run manifests and Mega receipts;
inventory-only runs remain Unverified. Available run details add harness metadata,
not eligibility. Source run dates differ from index generation.
Run IDs can be reused across GPU folders: retain the hardware context, and keep
contradictory audit/board pairings Unverified rather than borrowing another GPU's score.
Bug Hunt's CSV and [run notes](https://github.com/phuryn/bug-hunt-bench/blob/main/results/run-notes.md)
own receipt identities, versions and supersession. Extras never enter its score.

### Automatic preprocessing and rechecks

`model-guide refresh --prepare` fetches public data, provenance and calculated frontiers into private tool state. Normal refresh then generates a pending numeric proposal in code. `model-guide benchmarks --backend BACKEND --domain DOMAIN --query MODEL --limit 5` matches bounded evidence to native inventory and local account hints. Omit the backend for unrestricted evidence. It reports limits, dates, settings and available time/cost; the snapshot retains full rows. Neither command selects a model, changes defaults or switches accounts.

`benchmarks --coverage --backend BACKEND --brief` audits full exports, effort/configuration
coverage, dates, harness fields and unmapped identities; JSON retains the details.
Available means published in that export, not private trials or every historical release.

Query results retain separate quality and efficiency views. The efficiency
frontier is recalculated within the filtered candidate set, source and release;
Vals execution harnesses remain separate. Backend queries use coding/terminal
proxies, not a measured database/security/architecture score. `--brief` renders
compact evidence without removing confidence intervals or account freshness.

- LiveBench's HTML links its current frontend script; read its release catalog and effort metadata, never execute downloaded code. Fetch the release's table.csv, categories.json and cost.csv. Validate schemas, finite values, counts and weights. Cost/success is estimated; overall cost divided by weighted quality is a proxy, not a retry guarantee. Time is not published in those CSVs.
- Arena publishes a CC-BY-4.0 dataset through Hugging Face's documented [Parquet export API](https://huggingface.co/docs/dataset-viewer/parquet). Capture all 17 language/vision/agent configurations and every category in latest shards; historical full splits and five image/video-generation exports are outside selectable worker-model evidence. Six core views keep models.md bounded. Raw suffixes without a separate setting field remain Unverified; quantization/release annotations are not effort. Per-row dates and intervals survive; duplicate evaluations are flagged.
- Vals links a structured benchmark_view export; discover its hashed URL from the release page and retain every task/model/configuration, not the chart's default selection.
- AA's [official free API](https://artificialanalysis.ai/api-reference) uses x-api-key, permits 1,000 requests/day and requires caching and attribution. The optional private environment supplies it; no credential belongs in a snapshot/error/report. Its free endpoint does not supply task-cost curves, coding-agent scaffolds or a methodology version; these remain Unverified. Parenthetical effort is authoritative even when the slug has no suffix.
- Agents review missing sources and changed schemas/methodologies, recheck primary links and interpret recommendations. Preprocessing never proves subscription entitlement, authorizes paid calls or makes role changes automatically.

Polling contracts reviewed 2026-11-01: [AA API](https://artificialanalysis.ai/api-reference),
[AA terms](https://artificialanalysis.ai/terms-of-use), [data terms](https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf),
[GitHub caching/backoff](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api),
[HF limits](https://huggingface.co/docs/hub/en/rate-limits) and the source contracts above.
Local polling is serial, at most once per source per 36h; 429/Retry-After and host
backoff suppress further requests. Arena checks small shard manifests before Parquet.
Other structured sources use conditional GET or parsed-row digests. Vals discovery
ignores HTML churn. No additional automated quota is published by those source
contracts; the local interval is a budget, not an asserted allowance. AA website
terms prohibit scraping, so keyless scheduled polling skips AA; the requested
manual page adapter remains available. No source terms were treated as API access.

### Reached and useful
| Source | URL | What it gives | How to read it |
|---|---|---|---|
| OpenAI model guide | `https://learn.chatgpt.com/docs/models.md` | each model's one-line positioning (`description="..."`), a Capability and a Speed rating, surfaces and API availability, reasoning-effort advice | Fetch the `.md` form with curl (some web readers reject its `text/markdown` type). The ratings are icon lists, so count the entries after `title: "Capability"` and `title: "Speed"` for each `name="gpt-..."` block; the rendered HTML shows them only as JavaScript icons. The counts have no stated maximum: compare them only with each other. |
| OpenAI pricing | `https://learn.chatgpt.com/docs/pricing.md` | plan list, per-plan message estimates per five hours, credit rates per model, availability notes for new models | Read the tables by row name; tier names are the vendor's ("Pro" for the $100, $200 and $500 tiers, no multipliers published). |
| Anthropic model overview | `https://docs.anthropic.com/en/docs/about-claude/models/overview` | one-line positioning, "Comparative latency" row, list prices, model IDs, the "start with ..." recommendation | Server-rendered HTML: strip tags and read the text. The latency words (Slower, Moderate, Fast, Fastest) come in the same order as the model columns. |
| OpenRouter model page (measured speed) | `https://openrouter.ai/<vendor>/<slug>` (e.g. `openai/gpt-6.1-terra`) | per-provider 30-minute stats: median output tokens per second, median latency, request counts | Fetch with curl and a browser user agent, unescape `\"`, then regex each `"stats":{"endpoint_id":...,"p50_latency":ms,...,"p50_throughput":tokens_per_s,...,"throughput_request_count":n,...}` object. Drop endpoints with few requests and weight by `throughput_request_count`. A snapshot that varies by provider and load; it does not say how many tokens a task needs. |
| OpenRouter model list | `https://openrouter.ai/api/v1/models` | list price per token for every model and alias, context length, `:batch` variants at half price, `~vendor/name-latest` aliases | Public JSON, no key. Multiply `pricing.prompt` and `pricing.completion` by 1,000,000 for dollars per million tokens. Prices are OpenRouter's pass-through list prices. |
| Artificial Analysis leaderboard | `https://artificialanalysis.ai/leaderboards/models` | Current-index score, task cost and timing per model/effort | Read the HTML table with its methodology version. Preserve "with fallback"; response time is not agent duration. |
| OpenCode Zen and Go | `https://opencode.ai/docs/zen`, `https://opencode.ai/docs/go` | which provider models Zen routes, their prices; Go limits, retention and the models trained on (`*-contributor`) | HTML text; read the tables by model name. |
| Claude plans | `https://support.claude.com/en/articles/11145838` | Pro, Max 5x and Max 20x limits | Article text; it publishes no per-plan model list. |

### Reached but empty or not usable for this
- **OpenRouter public endpoints API** (`/api/v1/models/<vendor>/<slug>/endpoints`): provider list and uptime work, but `throughput_last_30m` and `latency_last_30m` are null without credentials. Read the model page instead (the OpenRouter model page row above).
- **Artificial Analysis speed**: the leaderboard HTML contains no output-speed or time-to-first-token fields. Take measured speed from OpenRouter's model pages and vendor ratings (labelled as claims).
- **Antigravity model page** (`https://antigravity.google/docs/models`): client-rendered; the fetched page has no model rows. Use `model-guide models --backend agy` for what an account can start, and `https://antigravity.google/pricing` and `/docs/plans` for plan facts.
- **OpenAI HTML model page**: ratings and some tables render in JavaScript; use the `.md` form.

### Rules for what a source may support
- Vendor ratings and positioning are claims. Label them "advertised" and keep them apart from benchmark rows and from measured numbers.
- A price on one site is not an allowance: dollars per token say nothing about plan quota.
- A model ID in a live list proves it can be started, not that a plan includes it.
- A number no fetched source confirms stays as it was or is marked Unverified.
