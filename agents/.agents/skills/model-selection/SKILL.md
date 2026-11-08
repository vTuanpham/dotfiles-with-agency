---
name: model-selection
description: Choose a model, harness and effort using task context, native access, account constraints and current model evidence. Use for model comparisons or task-to-model selection.
---

# Model selection

Use the conversation and current session to make the decision. The tool supplies
execution facts and scoped observations; it does not choose through a leaderboard
or require a maintained per-model role table.

1. Establish the actual job: scope, ambiguity, verification, consequences,
   urgency and expected volume. Include account access, remaining allowance,
   competing work, required tools/modalities and existing session context. Use
   what is already known; distinguish constraints from assumptions. Continuing
   in the current session is an option when delegation adds no value.
2. For general model lookup use `model-guide suggest` or `--query MODEL`.
   When task-specific evidence would change the choice, add `--task "TASK"`;
   it suggests a focus and retains other evidence in `--json` and `--choice`.
   Check its fit; use `--domain AREA` only to limit the evidence when needed.
   It compares harnesses by default; `--backend` restricts one.
   Supply known constraints and task/session facts
   with `--context PATH|-` JSON; `suggest --help` owns the format. The context is
   per request, not a file the user must maintain. Native worker controls and
   selected-session access outrank a general catalog or cached account hint.
3. Use the compact comparison, which includes different access pools and
   observed quality/cost/time tradeoffs, then inspect `--choice ROUTE` when exact
   settings matter. Compare the relevant model/effort combinations and routes. Weigh likely
   usefulness against allowance, completion time, verification and rework.
   Read the reported reset windows, shared pools and model-specific limits;
   follow local policy drill-downs when plan conditions could change the choice.
   A remaining percentage or plan name alone does not establish capacity.
   Free access, higher scores, lower tier, newer releases and faster tokens do
   not independently establish the better choice. Keep source versions,
   workload, provider and harness scope attached; missing evidence is not poor
   performance. Public API prices do not measure subscription consumption.
4. Choose a concrete available model, harness and supported effort, or keep the
   current session. Explain the decisive tradeoff briefly. Name an alternative
   or a verification step when uncertainty could change the choice. Preserve
   explicit selections and do not change billing routes to get around an error.

Use `--query` for partial model names/families/aliases and `--json` for full
observations. Drill into relevant options rather than loading every provider's
catalog. `benchmarks` exposes individual source measurements; `read models`
explains their scope. When access, pool sharing or billing needs interpretation,
use `model-guide policy --backend BACKEND` for cached official policy evidence.
It refreshes missing/due policy sources separately from faster-changing model
and usage observations. Resolve a material mismatch against the selected native
session; do not turn a dated plan example into a standing eligibility rule.

Use validated cached evidence normally, with dates and source failures visible.
Research a material gap or changed contract rather than repeating general web
research for each choice. Fetched observations and reviewed guide changes are
separate; selection does not require approving a numeric proposal. Read `sources`
and `maintenance` before changing adapters or applying reference updates.
