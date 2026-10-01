#!/usr/bin/env bash
# Builds the Windows x64 installer (NSIS .exe) on Linux.
#
# The app's native pieces are per-platform, so this stages a copy of the app
# whose production node_modules hold the Windows builds of sharp/libvips,
# ffprobe and ffmpeg, then runs electron-builder against it with the
# Windows Electron distribution. The dev tree is left untouched.
#
# Needs Wine with 32-bit support on PATH: electron-builder runs the NSIS
# stub once to produce the uninstaller. Ubuntu: dpkg --add-architecture i386 &&
# apt-get install wine wine64 wine32:i386
#
# Usage: npm run build && bash scripts/dist-win-from-linux.sh
# Output: dist/Loupe-Setup-<version>-x64.exe
set -euo pipefail
cd "$(dirname "$0")/.."

command -v wine > /dev/null || { echo "Wine is required (see header)." >&2; exit 1; }

ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version")
FFMPEG_TAG=$(node -p "require('./node_modules/ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag']")
CACHE=.cache/win
STAGE=$CACHE/stage
mkdir -p "$CACHE"

[ -f out/main/index.js ] || { echo "Run 'npm run build' first." >&2; exit 1; }

# 1. Windows Electron, checked against the release's SHA-256 list.
ZIP="electron-v$ELECTRON_VERSION-win32-x64.zip"
if [ ! -f "$CACHE/$ZIP" ]; then
  curl -sSfL -o "$CACHE/$ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/$ZIP"
fi
curl -sSfL "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/SHASUMS256.txt" \
  | grep " \*$ZIP\$" | sed "s/ \*/  /" | (cd "$CACHE" && sha256sum -c -)
rm -rf "$CACHE/electron-dist"
unzip -q "$CACHE/$ZIP" -d "$CACHE/electron-dist"
rm -f "$CACHE/electron-dist/resources/default_app.asar"

# 2. ffmpeg.exe for ffmpeg-static (its installer only fetches the host platform's binary).
if [ ! -f "$CACHE/ffmpeg-win32-x64.gz" ]; then
  curl -sSfL -o "$CACHE/ffmpeg-win32-x64.gz" "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_TAG/ffmpeg-win32-x64.gz"
fi

# 3. Stage the app with Windows production dependencies from the lockfile.
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r package.json package-lock.json electron-builder.yml out resources build "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --os=win32 --cpu=x64 --ignore-scripts --no-audit --no-fund)
gunzip -c "$CACHE/ffmpeg-win32-x64.gz" > "$STAGE/node_modules/ffmpeg-static/ffmpeg.exe"
for f in node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64*.node node_modules/@ffprobe-installer/win32-x64/ffprobe.exe node_modules/ffmpeg-static/ffmpeg.exe; do
  compgen -G "$STAGE/$f" > /dev/null || { echo "missing $f" >&2; exit 1; }
done

# 4. Build. The exe's icon and version info are set by the afterPack hook,
#    since electron-builder's own editor (rcedit) needs Wine on Linux.
npx electron-builder --projectDir "$STAGE" --win nsis --x64 --publish never \
  -c.electronDist="$(pwd)/$CACHE/electron-dist" \
  -c.electronVersion="$ELECTRON_VERSION" \
  -c.directories.output="$(pwd)/dist" \
  -c.win.signAndEditExecutable=false \
  -c.afterPack="$(pwd)/scripts/win-exe-resources.cjs"

ls -lh dist/*.exe
