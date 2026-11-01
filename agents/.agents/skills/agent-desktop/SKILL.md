---
name: agent-desktop
description: Operate Windows desktop apps and native dialogs from WSL using agent-desktop. Use for desktop UI inspection, form controls, menus, screenshots and native app verification; existing Chrome tools own browser page tasks.
---

# Windows desktop control

Run `agent-desktop status`, then read `agent-desktop skills get desktop` and
`agent-desktop skills get platform`. These bundled guides match the installed
binary; command help owns flags and the guides route to detailed references.
If missing, follow the [host setup](../../../../computer-use/README.md).

Use a fresh session for this task (`session start --help`), and pass its returned
ID through `--session` on every observation and action. Observe the exact app and
window, act on qualified refs from that session, then verify the resulting state.
Refresh refs after UI changes. Read delivery/retry dispositions before retrying;
an uncertain action may already have landed. Do not switch drivers and repeat it
without readback. Use Cua's installed `describe` schemas when choosing that driver.

Stay in semantic mode. Physical input, focus changes and `--headed` require the
user's explicit permission; a semantic failure does not supply it. Windows apps
can still raise themselves after semantic input: this was reproduced locally.
The Windows executable launched from WSL shares the user's Windows desktop.
Neither driver guarantees uninterrupted use while the human clicks elsewhere;
use a separate interactive VM or machine when isolation is required.

One coordinator owns a desktop workflow at a time, including any delegated Cua
steps. Driver command locks and separate sessions do not serialize whole tasks
or isolate the human's input. Do not launch parallel GUI workers on this desktop.

The launcher checks Agent Baton before every call, including screenshots. Use
Baton's secret-entry workflow for credentials; never put secrets in desktop CLI
arguments, UI snapshots or traces. While a human-only login handoff is held, wait
for its return before observing or acting. Baton still owns approved-window focus
and secret injection; desktop automation does not replace those checks.

For a visible demonstration, use the session's `cursor-overlay` with size `0.85`
(read `skills get desktop commands-system` for syntax). The overlay is separate
from the real pointer. At completion, end only this task's session to remove its
overlay and seal its trace; close only task-created apps/documents. Leave Cua's
shared daemon running. Keep screenshots/traces private; Windows file paths must
be deliberately mapped with `wslpath` before attaching local images to a harness.
