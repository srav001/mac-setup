set -euo pipefail
eval "$(/opt/homebrew/bin/brew shellenv)"

sync_repo() { # url directory
    if [ -d "$2/.git" ]; then git -C "$2" pull --ff-only; else git clone "$1" "$2"; fi
}

sync_repo https://github.com/srav001/LazyVim-config.git "$HOME/.config/nvim"
sync_repo https://github.com/srav001/hush-macos.git "$HOME/.local/share/hush"
"$HOME/.local/share/hush/install.sh"
