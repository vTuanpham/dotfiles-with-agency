---
name: model-selection
description: Choose a model and reasoning effort for a main session or worker using maintained strengths and allowance references. Use for model comparisons or task-to-model selection.
---

# Model selection

Read `model-guide read models` for the dated strengths, measurements and effort
advice. This reference is independent of delegation and Agent Bridge.

- Establish the target session's account, selectable models/efforts, billing mode
  and required tools/modalities first. Benchmark search automatically reads local
  profile hints; an active machine profile is not proof of session identity.
- Use overall scores to shortlist, then compare the task's domain: models have
  jagged strengths. Read the current benchmark version, effort/harness and
  uncertainty; missing results are unknown. Compare cost-performance frontiers
  within that domain, including success cost and latency when available.
- Use `model-guide benchmarks --backend BACKEND --domain DOMAIN --query MODEL --limit 5 --brief`
  for bounded evidence matched to native identities/efforts and local account context.
  `--query` is optional; omit the backend for unrestricted evidence. Inspect
  quality leaders and cost-efficient choices separately; a score-only shortlist
  can hide useful smaller workers. `--domain backend` combines coding/terminal
  proxies with explicit coverage gaps. Omit `--brief` for structured JSON.
  Inspect `model-guide models --backend BACKEND --json` for generated coverage and unmatched IDs.
  Unknown effort ranges remain unknown; never borrow another model's controls.
  `model-guide refresh --prepare` fetches evidence; `refresh` generates a pending
  numeric proposal in code. Follow source links for gaps or rechecks.
  `model-guide suggest --backend BACKEND --task "UI refactor"` returns alternatives; repeat `--domain` for scope.
  Preserve user/project choices with `--choice MODEL --effort LEVEL`; `--json` explains evidence and constraints.
  Compare model × harness/version × effort; prefer the target backend's scaffold and label cross-harness evidence.
  Curves show quality and value effort alternatives, never a default maximum; the agent makes the final call.
- Separate model positioning, measured performance, effort and account allowance.
  A benchmark or advertised model does not establish access in this session.
- Select only models and effort levels exposed by the current harness/tool.
  Preserve an explicit user choice; investigate unsupported choices rather than
  silently substituting another model. Verify lighter-model results proportionally.
- Read `model-guide read subscriptions` only when a published plan or retention
  policy affects the choice. Account state comes from the selected native session;
  `agent-accounts snapshot` is a separate machine-wide cache inventory.
- Check the reference date and `model-guide check` when freshness matters. Before
  updating claims, read `model-guide read sources` and `model-guide read maintenance`.
  Numbers are generated; qualitative advice stays hand-written and source-reviewed.
  Never turn a reference update into a model default or account-policy change.
