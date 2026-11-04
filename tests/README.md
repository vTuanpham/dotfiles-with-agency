# tests

[← Packages](../README.md#packages) · **Repository checks** · nothing is installed

Checks for the repository itself, run from the repository root:

```sh
python3 -B tests/test_shell_startup.py   # Bash and Zsh start quietly, keep cwd and PATH, find their tools
python3 -B tests/test_install.py         # install.sh against a throwaway HOME: dry runs, links, conflicts
uv run --no-project --python '>=3.11' python -B tests/test_chatgpt_browser.py # browser transport and doctor
python3 -B tests/test_github_mcp.py      # credential handoff without token output or command-line arguments
python3 -B tests/test_agent_desktop.py   # guarded desktop transport and verified installer, without a real GUI
python3 -B tests/test_rtk_filters.py     # isolated filter fixtures, actual dispatch and failure exit status
python3 -B tests/test_claude_mod_runner.py # focused native mod staging, selection, cleanup and failure status
python3 -B tests/test_public.py          # the public-facing check: what it refuses, and that this repo passes it
python3 -B tests/test_docs.py            # Wake catalog descriptions and maintained README links, anchors and images
```

`tests/check_public.py` is the check itself, run by the pre-commit and commit-msg hooks (`.githooks/`, enabled
with `./install.sh --apply githooks`) and by hand as `python3 tests/check_public.py`.

Neither sources credentials or touches your real `$HOME`. The tools have their own suites:
`uv run pytest` in `agent-bridge/` and `agent-baton/`, and Ranger's plugin check under `ranger/`.

## Opt-in agent decisions

`agent_evals.py` builds nine next-action cases from the **current maintained**
skills, native backend guide and Inbox README, recording each source's hash.
Cases cover exact native model selection, API-versus-CLI context, steering races,
uncertain delivery, native question ownership, peer authority and WSLg geometry,
plus ordinary-read and supported-steering controls. No model is selected or called
by the script.

```sh
umask 077
python3 tests/agent_evals.py prompts > /tmp/agent-eval-prompts.jsonl
python3 tests/agent_evals.py grade /tmp/agent-eval-responses.jsonl
python3 -B tests/test_agent_evals.py
```

For a live evaluation, explicitly choose an authorized native harness/model and
billing mode, give it each prompt in a fresh context, and collect one JSON line
per case: `{"case":"native-model","choice":"A","reason":"..."}`. Keep the
prompt file, model/harness/version/effort, response file, timing and errors
together in private experiment storage. An endpoint error does not authorize a
model or billing substitution. These runs are optional and never part of CI.

The grader checks choice correctness and response completeness; explanations
need human review. It never executes returned text. This is a bounded routing
evaluation, not evidence of real tool execution or end-to-end task success.
`test_agent_evals.py` checks the grader offline; it is not a model-quality score.
