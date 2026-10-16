set -euo pipefail
rex="/Applications/Rex Beta.app"
app="$HOME/Applications/Rex Neovim.app"
build="$(mktemp -d)/Rex Neovim.app"

if [ ! -e "$rex" ]; then
    echo "Rex is not installed yet: install it (see MANUAL.md), then re-run ./setup.sh."
    exit 0
fi

osacompile -o "$build" launcher/rex-neovim.applescript
plutil -replace CFBundleIdentifier -string com.sravan.rex-neovim "$build/Contents/Info.plist"
plutil -replace LSUIElement -bool true "$build/Contents/Info.plist"
plutil -replace CFBundleDocumentTypes -json \
    '[{"CFBundleTypeName":"Text","CFBundleTypeRole":"Editor","LSHandlerRank":"Alternate","LSItemContentTypes":["public.text","public.data"]}]' \
    "$build/Contents/Info.plist"
cp "$rex/Contents/Resources/App Icon Beta.icns" "$build/Contents/Resources/applet.icns"
codesign --force -s - "$build"
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build" "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"

swift launcher/text-defaults.swift
