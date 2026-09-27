#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/device"
TARGET_PARENT="$HOME/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect"
TARGET_LINK="$TARGET_PARENT/Luma Live Bridge"

echo ""
echo "Luma Live Bridge installer"
echo "--------------------------"
echo "Repo:   $ROOT_DIR"
echo "Device: $SOURCE_DIR"
echo "Live:   $TARGET_LINK"
echo ""

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: device folder not found."
  exit 1
fi

mkdir -p "$TARGET_PARENT"

if [ -L "$TARGET_LINK" ]; then
  rm "$TARGET_LINK"
elif [ -e "$TARGET_LINK" ]; then
  BACKUP="$TARGET_LINK.backup-$(date +%Y%m%d-%H%M%S)"
  echo "Existing non-symlink install found."
  echo "Moving it to: $BACKUP"
  mv "$TARGET_LINK" "$BACKUP"
fi

ln -s "$SOURCE_DIR" "$TARGET_LINK"

echo "Linked the GitHub checkout directly into Ableton's User Library."
echo "Future git pulls update the bridge source immediately."
echo ""
echo "One-time Ableton step:"
echo "1. Open Live 12 and create a MIDI track."
echo "2. Drag a blank Max MIDI Effect onto it."
echo "3. Choose Edit in Max."
echo "4. In the blank Max-for-Live patcher, delete the default objects."
echo "5. Open:"
echo "   $TARGET_LINK/LumaLiveBridge.maxpat"
echo "6. Copy all objects from that source patch and paste them into the blank Max MIDI Effect patcher."
echo "7. Save the Max-for-Live device as:"
echo "   $TARGET_LINK/Luma Live Bridge.amxd"
echo ""
echo "The .amxd is ignored by git, so pulls will not overwrite it."
echo "After that, load 'Luma Live Bridge.amxd' on one MIDI track."
echo "The Max Console will print the secure LAN URL for your remote."
echo ""
