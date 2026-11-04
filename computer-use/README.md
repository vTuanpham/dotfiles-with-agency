# computer-use

[← Packages](../README.md#packages) · **Live launcher and skill** · **User-local Windows binary**

Windows native app control from WSL, alongside the existing Cua installation.
Use [Chrome tools](../chrome/README.md) for browser pages; agent-desktop covers
native dialogs, accessibility controls and desktop verification.

```sh
./install.sh desktop-tools links          # preview
./install.sh --apply desktop-tools links  # install the pinned release and live links
agent-desktop version
agent-desktop status
agent-desktop skills get desktop
agent-desktop skills get platform
```

The `desktop-tools` step supports x64 and ARM64 WSL. It downloads the Windows
release pinned in `install.sh`, checks its SHA256 and GitHub build attestation,
and installs under `${XDG_DATA_HOME:-$HOME/.local/share}/agent-desktop/windows/`.
It needs `curl`, `gh`, `tar` and `sha256sum`; authenticate `gh` if it requests it.
It publishes the verified executable with an atomic rename and leaves an existing
binary alone. For a deliberate upgrade, review the new
release, pin, launcher parser and inventory schema, remove the installed directory,
then rerun this step. Do not
install the Linux npm package in WSL to control Windows applications.

`~/.local/bin/agent-desktop` links to this package's launcher. It checks
`agent-baton guard` before every call, fails if Baton cannot run, and forwards
arguments, stdin, native stdout and exit status without a PowerShell quoting
layer. No service, MCP registration, global approval or Windows PATH change is
needed. The shared `agent-desktop` skill is linked into Codex/OpenCode, Claude
and Antigravity discovery paths by the `links` step. It loads the binary's own
version-matched guides instead of maintaining a copied upstream manual.

The launcher refuses `move-window` and `resize-window` for `msrdc.exe` windows
(including WSLg). Windows-only geometry changes can leave the Linux app's click
coordinates behind even when the driver's `window_position` readback succeeds.
Other remote windows hosted by the same executable are conservatively refused
too. Native Windows geometry commands require an explicit `--app` or
`--window-id` and a successful live process-name check; unavailable or unknown
inventory fails before dispatch. This checks the current target, not an atomic
lock across desktop changes.

Run move/resize commands separately: batches containing either are refused
before any entry runs, since earlier entries could replace the checked target.
Other commands and batches retain their native transport. Guard refusals use
the native JSON error envelope with `ACTION_NOT_SUPPORTED`,
`details.kind: wslg_geometry_guard` and `not_delivered` / `safe`. WSLg movement
needs a separately validated Linux/compositor-owned path. Switching Windows
drivers or using physical input does not supply that validation. This boundary
is stricter than the pinned [upstream geometry verification contract](https://github.com/vercel-labs/agent-desktop/blob/v1.0.2/docs/json-output.md);
it prevents the reproduced [WSLg coordinate-sync failure](https://github.com/microsoft/wslg/issues/1116).

Windows interoperability can fail inside a restricted WSL sandbox before the
driver runs (`UtilBindVsockAnyPort ... socket failed`). Retry only the authorized
operation in the harness's host execution context. This does not require Windows
administrator rights or relaxed global sandbox/approval policy. Windows still
requires the signed-in user's unlocked interactive desktop; secure desktops and
Session 0 are unsupported.

Semantic actions can cause an application to take focus. Sessions scope refs,
traces and overlays; they do not isolate input. The skill requires one coordinator
for desktop workflows, but there is no cross-driver workflow lock. Use a VM or
another machine for reliably independent computer use. Physical input remains
an explicitly authorized step. Secret entry stays with [Agent Baton](../agent-baton/README.md).

Cua remains independently installed and updated through its
[official updater](https://cua.ai/docs/cua-driver/guides/operate). Read its installed
`describe` schemas after an upgrade: 0.35 changed the default window-state tree.
Keep its daemon permission mode and existing startup choices; do not add an
unrestricted daemon to recover an unavailable action.

Verify with `python3 -B tests/test_agent_desktop.py` and the installer/Baton checks.
Remove only the live launcher/skill links and the installed binary directory to
uninstall; leave Cua, Baton, user apps and any wanted private traces in place.

Sources: [upstream installation](https://github.com/vercel-labs/agent-desktop/blob/main/docs/install.md),
[desktop guide](https://github.com/vercel-labs/agent-desktop/blob/main/skills/agent-desktop/SKILL.md),
[Windows guide](https://github.com/vercel-labs/agent-desktop/blob/main/skills/agent-desktop-windows/SKILL.md).
