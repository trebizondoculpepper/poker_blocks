#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -x node_modules/.bin/vp ]]; then
  npm ci
fi

exec npm run dev -- --host 0.0.0.0 "$@"
