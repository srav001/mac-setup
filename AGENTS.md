# Agent guide

This repo sets up the user's Mac. `./setup.sh` runs `steps/*.sh` in order and logs to `setup.log`. Every step is safe to re-run and skips work that is already done.

## Running it

1. Ask the user to run `~/mac-setup/setup.sh` in their own terminal. It needs their administrator password, browser sign-ins for GitHub, and clicks on macOS dialogs, none of which an agent can do.
2. Watch `setup.log`. Each step starts with a `==> <step> <time>` line.
3. When a step fails, read its script in `steps/`, find the root cause, fix the script, and ask the user to re-run `./setup.sh`.
4. When it finishes, walk the user through `MANUAL.md` and check each item.

## What needs the user

- **Password**: once, at the start.
- **Command Line Tools**: an Install dialog on the first run.
- **GitHub**: a browser sign-in per account whose SSH key is not yet on GitHub (`steps/2-github.sh`). Personal `srav001` uses `~/.ssh/github_personal` on `github.com`; work `sravan-fb` uses `~/.ssh/github_work` on the `github-work` host, which `~/.gitconfig-work` applies inside `~/Cohesiv/`.
- **File types**: one "Change" click per text file type not yet set to Rex Neovim (`steps/5-rex-neovim.sh`). macOS has no silent way to change a default app.
- **Rex Remote Control**: the user enables it in Rex > Settings > Server. It allows connected Rex clients to perform app actions and is required for selecting a newly opened file automatically. Do not silently enable it.

## Checks

- `ssh -T git@github.com` greets `srav001`; `ssh -T git@github-work` greets `sravan-fb`.
- `mdutil -as` reports indexing disabled on every volume.
- `ls -l ~/.claude/CLAUDE.md ~/.codex/AGENTS.md` shows links into `home/`.
- `bash -n steps/5-rex-neovim.sh` and `swift launcher/text-defaults.swift --dry-run` check the file-opening setup without changing defaults. Never claim `public.data` or bind a video/image type to Neovim just because an extension also represents code.

Files in `home/` are linked into the home folder, so edits on the Mac change this repo. Never add tokens, `~/.codex/auth.json`, `~/.claude.json` or SSH private keys to it.
