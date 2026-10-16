# mac-setup

Sets up a Mac the way I use it. Safe to re-run.

```sh
git clone https://github.com/srav001/mac-setup.git ~/mac-setup
~/mac-setup/setup.sh
```

Enter the administrator password once, sign in to GitHub in the browser when asked, and click **Change** on each file-type dialog. Progress goes to `setup.log`. An agent can watch it: see [AGENTS.md](AGENTS.md).

1. `1-tools.sh`: Command Line Tools, Homebrew and the `Brewfile` tools, OpenCode first.
2. `2-github.sh`: links the git config and SSH config, creates any missing SSH key for the personal and work GitHub accounts, and adds it to GitHub.
3. `3-repos.sh`: clones the Neovim config and [hush-macos](https://github.com/srav001/hush-macos), then runs its installer.
4. `4-agents.sh`: links the Claude Code and Codex instructions and settings, copies the basic Codex `config.toml` if none exists, and installs or updates Claude Code, Codex and OpenCode.
5. `5-rex-neovim.sh`: builds `~/Applications/Rex Neovim.app` and makes it the default app for text files.
6. `6-macos.sh`: turns Spotlight indexing off, deletes its index, and sets the wallpaper.

Files under `home/` are linked, not copied, so editing them on the Mac edits this repo. Commit those changes.

## A new SSH key

To replace a key, delete it (`rm ~/.ssh/github_personal*` or `~/.ssh/github_work*`), remove the old key at github.com/settings/keys, and re-run `./setup.sh`. It creates a new key and adds it to the right account.

See [MANUAL.md](MANUAL.md) for what a script cannot do.
