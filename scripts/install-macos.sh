#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/device"
TARGET_DIR="$HOME/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/Luma Live Bridge"

echo ""
echo "Luma Live Bridge installer"
echo "--------------------------"
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"
echo ""

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: device folder not found."
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete   --exclude "*.amxd"   "$SOURCE_DIR/" "$TARGET_DIR/"

echo "Installed source files."
echo ""
echo "One-time Ableton step:"
echo "1. Open Live 12 and create a MIDI track."
echo "2. Drag a blank Max MIDI Effect onto it."
echo "3. Choose Edit in Max."
echo "4. In the blank Max-for-Live patcher, delete the default objects."
echo "5. Open:"
echo "   $TARGET_DIR/LumaLiveBridge.maxpat"
echo "6. Copy all objects from that source patch and paste them into the blank Max MIDI Effect patcher."
echo "7. Save the Max-for-Live device as:"
echo "   $TARGET_DIR/Luma Live Bridge.amxd"
echo ""
echo "After that, load 'Luma Live Bridge.amxd' on one MIDI track."
echo "The Max Console will print the secure LAN URL for your remote."
echo ""
