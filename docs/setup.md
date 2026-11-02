# Setup, flow and checks

[← Dotfiles](../README.md) · **Setup** · [Packages](packages.md)

Everything here is routine: how to restore the repository onto a machine, how files flow in each direction, what
starts on its own, and how to check it. The tools themselves are in the [main README](../README.md).

## Restore

It runs on WSL2 Ubuntu; check paths, the distro and Windows fonts before restoring.

```sh
git clone https://github.com/vTuanpham/dotfiles-with-agency ~/dotfiles-with-agency && cd ~/dotfiles-with-agency
./install.sh                 # preview missing tools, links and config differences
./install.sh --apply         # apply the listed steps
./install.sh --apply links   # or choose specific steps
```

Existing files that differ are preserved; hook/plugin merges retain live settings and leave a backup under
`~/.local/state/backups/dotfiles-with-agency/`. Python tools are editable `uv` tools, and `~/.local/bin/node`
follows the newest nvm Node. Codex asks you to trust new hooks: open it and run `/hooks` after applying them.

Still manual:

- Node via nvm, `rtk`, `agy`, harness logins and `sudo tailscale up`.
- The private secrets file, described in [shell](../shell/README.md#credentials).
- [Chrome extension registration](../chrome/README.md) and [Windows terminal setup](../windows/README.md).
- The external plugins and preview tools listed in [shell](../shell/README.md),
  [Neovim](../nvim/README.md) and [Ranger](../ranger/README.md), before using those configs.

Credentials and machine-local state stay outside Git.

## Configuration flow

![Configuration paths: live links share the working-tree file, snapshots copy only into missing destinations, and hook entries merge on request. Credentials and machine-local state stay outside Git.](images/file-flow.gif)

Snapshots never flow back automatically; generated changes stay uncommitted.
[Handling and publication rules](../AGENTS.md) · [Public-data checks](../tests/README.md).

## What starts on its own

[Timers, catalog refresh, lab cleanup and startup tasks](../systemd/README.md#startup-and-timers)
· [Codex reset tracker](https://github.com/vTuanpham/codex-reset-tracker).

## Checks

From the repository root:

```sh
python3 -B tests/check_public.py
python3 -B tests/test_public.py
python3 -B tests/test_install.py
python3 -B tests/test_shell_startup.py
```

[Test scope](../tests/README.md); package READMEs list their own checks (`uv run pytest` in `agent-bridge/`,
`agent-baton/` and `codex-wake/`; `claude plugin test` in the Wake mod). [Ponytail](https://github.com/DietrichGebert/ponytail)
is enabled in the Claude/Codex snapshots; its setup and hook trust live in those harness READMEs.

## License

Original files: [MIT](../LICENSE). Third-party parts keep their own licenses:
Ghostty's Zsh integration (`ghostty/`, GPL-3.0), ranger-devicons (`ranger/`, with the
Nerd Fonts notice), and the LazyVim starter (`nvim/.config/nvim/LICENSE`, Apache-2.0).
[Harness marks](../agent-inbox/src/agent_inbox/assets/NOTICE.md) keep their owners' terms.
