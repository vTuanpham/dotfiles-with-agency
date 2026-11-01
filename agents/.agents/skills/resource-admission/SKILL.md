---
name: resource-admission
description: Run sustained CPU- or memory-heavy work through the host resource queue. Use for inference, benchmarks, dataset extraction, full suites or long-lived local servers; ordinary lightweight commands run directly.
---

# Resource admission

Read `agent-resources guide` before a heavy run. Declare the expected peak with
`agent-resources run --mem SIZE -- COMMAND ARGS...`; use measured needs when
available. Estimates coordinate admission and do not enforce a memory limit.

Never detach the command (`&`, `nohup`, `setsid`, daemonizing); the wrapper must
stay its own process. Do not wrap worker runners, nest admission calls or queue
ordinary reads, Git, edits, lint or targeted tests.
Use `--exclusive` for timing isolation only, never for test suites.

Start a run that may queue or last long as the harness's native background job
and collect it through its completion notice; a blocking call holds back steers
until it returns. Queue waits and root pauses are normal; inspect/report a dead holder or an
unpaused wait over 30 minutes. Root controls live requests with list, cancel,
pause and resume; workers ask their root. Keep inherited caps and sandbox rules.
