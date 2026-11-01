# Specialist benchmark fixtures

Fetched 2026-11-01 from the official JSON below. These are fixture subsets, not
complete benchmark snapshots. Values and selected records are copied unchanged.

- `kernelbench.json`: `https://raw.githubusercontent.com/Infatoshi/kernelbench.com/master/public/data/models.json`;
  retains Sonnet 5.5 and Sol 6.1, canonical board cells; drops audit histories,
  flags and secondary GPU blocks. The decoder reads no cross-problem aggregate.
- `bughunt.json`: `https://bughunt.productcompass.pm/data/benchmark.json`;
  first three current records with null caveats; drops display fields, prose notes
  and unused receipt fields. Task totals and publication date remain unchanged.

Contract/method sources: KernelBench's `app/_lib/models.ts` and each bench's
`SPEC.md`; Bug Hunt's `/method`, JSON glossary and `results/run-notes.md`.

The full-run decoder fixtures use the same official sources, fetched 2026-11-01:
`kernelbench-runs.json` retains Astra Pro and Sol 6.1 including audit outcomes,
dropping only free-form audit summaries; `bughunt-runs.csv` retains every Opus
5.5 effort/replicate plus two superseded/current DeepSeek receipts, unchanged.

`boards.json` contains small unchanged record subsets from Vals's discovered
benchmark_view_vals_index JSON, SWE-bench's data/leaderboards.json (per-instance
details omitted), OSWorld's official-results.json, BFCL's data_overall.csv and
LiveCodeBench's performances_generation.json. Their URLs are defined in boards.py.

`kernel-inventories.json` projects real catalog/Mega/manifest receipts and their
detail metadata. `kernel-collision.json` retains the two Opus 4.8 audit records
sharing a run ID across RTX PRO 6000 and B200, with their conflicting selected
cell; unrelated cells and free-form summaries are omitted. No values are repaired.
