#!/usr/bin/env bash
# Copies the web app into the Android assets and bundles MediaPipe (lib + wasm + models)
# so the APK works fully offline.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
WWW="$HERE/app/src/main/assets/www"
CACHE="$HERE/.vendor-cache"
VER=0.10.14

rm -rf "$WWW" && mkdir -p "$WWW/vendor/models" "$CACHE"
cp -r "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$WWW/"

if [ ! -f "$CACHE/package/vision_bundle.mjs" ]; then
  (cd "$CACHE" && npm pack "@mediapipe/tasks-vision@$VER" --silent >/dev/null && tar xzf "mediapipe-tasks-vision-$VER.tgz")
fi
mkdir -p "$WWW/vendor/tasks-vision/wasm"
cp "$CACHE/package/vision_bundle.mjs" "$WWW/vendor/tasks-vision/"
cp "$CACHE/package/wasm/"* "$WWW/vendor/tasks-vision/wasm/"

for m in face_landmarker hand_landmarker; do
  [ -f "$CACHE/$m.task" ] || curl -fsSL -o "$CACHE/$m.task" \
    "https://storage.googleapis.com/mediapipe-models/$m/$m/float16/1/$m.task"
  cp "$CACHE/$m.task" "$WWW/vendor/models/"
done
echo ok > "$WWW/vendor/ok.txt"
du -sh "$WWW"
