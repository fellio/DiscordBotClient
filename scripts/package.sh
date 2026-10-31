#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/desktop"

if [ ! -d node_modules ]; then
  npm install
fi

rm -rf "$ROOT/dist-desktop"
npm run package

APP="$ROOT/dist-desktop/BotClient-darwin-arm64/BotClient.app"
if [ ! -d "$APP" ]; then
  echo "パッケージが見つかりません: $APP" >&2
  exit 1
fi

RESOURCES="$APP/Contents/Resources"
if [ -f "$RESOURCES/electron.icns" ]; then
  mv "$RESOURCES/electron.icns" "$RESOURCES/AppIcon.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon.icns" "$APP/Contents/Info.plist"
fi

codesign --force --deep --sign - "$APP"

mkdir -p "$ROOT/dist"
rm -rf "$ROOT/dist/BotClient.app"
ditto "$APP" "$ROOT/dist/BotClient.app"

echo "完成: $ROOT/dist/BotClient.app"
