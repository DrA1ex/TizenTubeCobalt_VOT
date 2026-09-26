#!/usr/bin/env bash
set -euo pipefail

echo "This compatibility command now fetches all supported Cobalt Android ABIs."
exec "$(cd "$(dirname "$0")" && pwd)/fetch_cobalt_27_lts3_android.sh" "$@"
