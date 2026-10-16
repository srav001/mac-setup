set -euo pipefail

# Tinycast keeps its own file index, so Spotlight indexing is only background work.
sudo mdutil -a -i off >/dev/null
sudo mdutil -a -E >/dev/null

store="$HOME/Library/Application Support/com.apple.wallpaper/Store"
mkdir -p "$store"
cp macos/wallpaper.plist "$store/Index.plist"
killall WallpaperAgent 2>/dev/null || true
