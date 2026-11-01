# npm

[← Packages](../README.md#packages) · **Snapshot** · `./install.sh --apply snapshots`

`~/.npmrc`: one line, `prefix=${HOME}/.npm-global` (npm expands `${HOME}`), the same global prefix
`shell/.config/shell/env.sh` exports as `NPM_CONFIG_PREFIX`. Global packages therefore survive Node upgrades
and land in the same place whether or not a process sourced the shell environment (systemd units, hooks).

Node itself is pinned by `install.sh`'s npm step: it links `~/.local/bin/{node,npm,npx}` to the newest Node
under `$NVM_DIR/versions/node`, and re-points those links after you install a newer one. See
[Node and NVM](../shell/README.md#node-and-nvm).

Global packages the other tools expect (Claude Code, Codex, `codex-auth`) are installed by `install.sh`.
