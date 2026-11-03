# Packages

[← Dotfiles](../README.md) · [Setup](setup.md) · **Packages**

One folder per package; paths mirror `$HOME`. Each README states its install flow.

## Built here

| Package | Kind | Contents |
| --- | --- | --- |
| [claude](../claude/README.md) | Snapshot + live | Wake mod, hooks, native account CLI (`cswap`), skills |
| [codex](../codex/README.md), [codex-wake](../codex-wake/README.md) | Snapshot + live, uv tool | Codex preferences, hooks, skills, native task notifications and the bounded condition monitor |
| [agent-bridge](../agent-bridge/README.md) | uv tool | Cross-harness jobs and direct native session messages |
| [agent-baton](../agent-baton/README.md) | uv tool | Human handoff: questions, secrets and approved commands |
| [agent-inbox](../agent-inbox/README.md) | uv tool + user service | Phone chat for existing root conversations |
| [agent-models](../agent-models/README.md) | uv tool + timer | Model references, benchmark evidence and task shortlists |
| [agent-resources](../agent-resources/README.md) | uv tool | Cooperative host resource queue |
| [agent-accounts](../agent-accounts/README.md) | uv tool | Independent cached account observations |
| [agent-lab](../agent-lab/README.md) | uv tool + live skill and timer | Persistent experiment folders and provenance |
| [agent-session](../agent-session/README.md) | Library | The calling conversation's identity, shared by the tools above |
| [portlink](../portlink/README.md) | uv tool | Private preview URLs, QR codes and route expiry |
| [agents](../agents/README.md) | Live | Shared instructions, engineering skills and the feedback workflow |
| [computer-use](../computer-use/README.md) | Live + user-local binary | Baton-guarded Windows agent-desktop launcher and shared desktop skill |
| [opencode](../opencode/README.md), [gemini](../gemini/README.md) | Snapshot + live | Harness preferences, shared instructions and native hooks |
| [systemd](../systemd/README.md), [tests](../tests/README.md) | Live + reference, n/a | User timers and service PATH; installer, shell and public-facing checks |

## Ordinary dotfiles

| Package | Kind | Contents |
| --- | --- | --- |
| [shell](../shell/README.md), [starship](../starship/README.md) | Live | Bash/Zsh startup, aliases, prompt and private credential include |
| [git](../git/README.md), [npm](../npm/README.md), [rtk](../rtk/README.md), [desktop](../desktop/README.md) | Snapshot | Git, npm prefix, tool and MIME preferences |
| [nvim](../nvim/README.md), [ranger](../ranger/README.md) | Snapshot | LazyVim config; inline previews |
| [ghostty](../ghostty/README.md), [windows](../windows/README.md) | Manual | Terminal integration; Windows Terminal and GhostInTheWSL configs |
| [chrome](../chrome/README.md), [github](../github/README.md) | Live + manual | Chrome extensions; GitHub CLI tools |
