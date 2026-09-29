#!/bin/bash
# Downloads the v86 emulator and its BIOS images into web/ (or $1) and
# pre-compresses them for nginx gzip_static.
set -euo pipefail

V86_VERSION=0.5.462
DEST=${1:-$(dirname "$0")/../web}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://registry.npmjs.org/v86/-/v86-$V86_VERSION.tgz" | tar xz -C "$tmp"
cp "$tmp/package/build/libv86.js" "$tmp/package/build/v86.wasm" "$DEST/"
cp "$tmp/package/LICENSE" "$DEST/v86-LICENSE.txt"
for f in seabios.bin vgabios.bin; do
    curl -fsSL -o "$DEST/$f" "https://raw.githubusercontent.com/copy/v86/master/bios/$f"
done

cd "$DEST"
for f in libv86.js v86.wasm seabios.bin vgabios.bin index.html app.js i18n.js kmouse.js kkeys.js; do
    gzip -9 -k -f "$f"
done
echo "v86 $V86_VERSION -> $DEST"
