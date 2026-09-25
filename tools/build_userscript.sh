#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODS_DIR="$ROOT/third_party/TizenTube/mods"
if [[ ! -f "$MODS_DIR/package.json" ]]; then
  echo "error: initialize the TizenTube submodule: git submodule update --init" >&2
  exit 1
fi
npm --prefix "$MODS_DIR" ci --legacy-peer-deps
npm --prefix "$MODS_DIR" run build
echo "Built: $ROOT/third_party/TizenTube/dist/userScript.js"
