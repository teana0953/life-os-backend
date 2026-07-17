#!/usr/bin/env bash
# Static validation for GitHub Actions workflow files (YAML + expressions).
#
# actionlint isn't published to npm, so it can't be run via a plain `npx`
# package install. Instead this uses actionlint's own official install
# script to fetch a prebuilt binary (same method the actionlint docs
# recommend for CI use without Go installed), caching it in a gitignored
# local directory so repeat runs (and CI, with npm caching) are fast.
set -euo pipefail

cd "$(dirname "$0")/.."

BIN_DIR=".actionlint"
BIN="$BIN_DIR/actionlint"

if [ ! -x "$BIN" ]; then
  mkdir -p "$BIN_DIR"
  curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash \
    | bash -s -- latest "$BIN_DIR"
fi

"$BIN" -color .github/workflows/*.yml
