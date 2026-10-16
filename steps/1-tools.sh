set -euo pipefail

if ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install
    until xcode-select -p >/dev/null 2>&1; do sleep 5; done
fi

if [ ! -x /opt/homebrew/bin/brew ]; then
    installer="$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    NONINTERACTIVE=1 /bin/bash -c "$installer"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"
brew bundle --file=Brewfile
