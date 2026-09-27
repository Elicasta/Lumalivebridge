#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

git pull --ff-only

echo ""
echo "Luma Live Bridge source updated."
echo "Because the Ableton User Library points at this checkout, no reinstall is needed."
echo "Reload the Max for Live device if Max does not autowatch a changed source file."
