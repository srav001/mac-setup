set -euo pipefail
eval "$(/opt/homebrew/bin/brew shellenv)"
repo="$(pwd)/home"

link() { # repo file, home file
    mkdir -p "$(dirname "$2")"
    if [ -e "$2" ] && [ ! -L "$2" ]; then mv "$2" "$2.before-mac-setup"; fi
    ln -sfn "$repo/$1" "$2"
}

link claude/CLAUDE.md "$HOME/.claude/CLAUDE.md"
link claude/settings.json "$HOME/.claude/settings.json"
link codex/AGENTS.md "$HOME/.codex/AGENTS.md"
link codex/instructions/minimal-codex.md "$HOME/.codex/instructions/minimal-codex.md"
# EDGE_CASE: Codex rewrites config.toml itself, so it gets a copy of the basics once.
[ -e "$HOME/.codex/config.toml" ] || sed "s#__HOME__#$HOME#g" "$repo/codex/config.toml" > "$HOME/.codex/config.toml"

if [ -x "$HOME/.local/bin/claude" ]; then
    "$HOME/.local/bin/claude" update
else
    curl -fsSL https://claude.ai/install.sh | bash
fi
path_line='export PATH="$HOME/.local/bin:$PATH"'
grep -qxF "$path_line" "$HOME/.zprofile" 2>/dev/null || echo "$path_line" >> "$HOME/.zprofile"
if brew list --cask codex >/dev/null 2>&1; then brew upgrade --cask codex; fi
