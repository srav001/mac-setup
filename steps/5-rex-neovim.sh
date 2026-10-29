set -euo pipefail
rex="/Applications/Rex Beta.app"
app="$HOME/Applications/Rex Neovim.app"

if [ ! -e "$rex" ]; then
    echo "Rex is not installed yet: install it (see MANUAL.md), then re-run ./setup.sh."
    exit 0
fi

open -a "Rex Beta"
echo "Enable Remote Control in Rex > Settings > Server so opened files become visible automatically."
build_dir="$(mktemp -d)"
trap 'rm -r "$build_dir"' EXIT
build="$build_dir/Rex Neovim.app"
osacompile -o "$build" launcher/rex-neovim.applescript
plutil -replace CFBundleIdentifier -string com.sravan.rex-neovim "$build/Contents/Info.plist"
plutil -replace LSUIElement -bool true "$build/Contents/Info.plist"
plutil -replace CFBundleDocumentTypes -json \
    '[{"CFBundleTypeName":"Text","CFBundleTypeRole":"Editor","LSHandlerRank":"Alternate","LSItemContentTypes":["public.text"]}]' \
    "$build/Contents/Info.plist"
cp "$rex/Contents/Resources/App Icon Beta.icns" "$build/Contents/Resources/applet.icns"
codesign --force -s - "$build"
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build" "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"

swift launcher/text-defaults.swift
