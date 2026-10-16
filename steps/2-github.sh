set -euo pipefail
eval "$(/opt/homebrew/bin/brew shellenv)"
repo="$(pwd)/home"

link() { # repo file, home file
    if [ -e "$2" ] && [ ! -L "$2" ]; then mv "$2" "$2.before-mac-setup"; fi
    ln -sfn "$repo/$1" "$2"
}

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
link git/.gitconfig "$HOME/.gitconfig"
link git/.gitconfig-personal "$HOME/.gitconfig-personal"
link git/.gitconfig-work "$HOME/.gitconfig-work"
link ssh/config "$HOME/.ssh/config"

connect_github() { # ssh host, GitHub account, key name
    local host="$1" account="$2" key="$HOME/.ssh/$3" greeting
    if [[ "$(gh auth status 2>&1 || true)" != *"account $account "* ]]; then
        echo "Sign in to GitHub as $account in the browser that opens."
        gh auth login -h github.com -p ssh -s admin:public_key --skip-ssh-key -w
    fi
    greeting="$(ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new "git@$host" 2>&1 || true)"
    [[ "$greeting" == *"Hi $account!"* ]] && return
    [ -e "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "$account@$(scutil --get LocalHostName)" -f "$key"
    gh auth switch -h github.com -u "$account"
    gh ssh-key add "$key.pub" --title "$(scutil --get LocalHostName)"
}

connect_github github.com srav001 github_personal
connect_github github-work sravan-fb github_work
gh auth switch -h github.com -u sravan-fb
