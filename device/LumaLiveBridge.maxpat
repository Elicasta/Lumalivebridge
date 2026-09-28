{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 0,
      "revision": 0,
      "architecture": "arm64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [120.0, 120.0, 760.0, 420.0],
    "openinpresentation": 1,
    "default_fontsize": 12.0,
    "default_fontface": 0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [15.0, 15.0],
    "boxes": [
      {
        "box": {
          "id": "obj-title",
          "maxclass": "comment",
          "text": "LUMA LIVE ABLETON ADAPTER",
          "fontsize": 18.0,
          "fontface": 1,
          "patching_rect": [30.0, 24.0, 260.0, 28.0],
          "presentation": 1,
          "presentation_rect": [18.0, 14.0, 250.0, 28.0]
        }
      },
      {
        "box": {
          "id": "obj-subtitle",
          "maxclass": "comment",
          "text": "Ableton Live 12 ↔ Luma Live.app · localhost only",
          "patching_rect": [30.0, 56.0, 320.0, 22.0],
          "presentation": 1,
          "presentation_rect": [18.0, 44.0, 320.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-node",
          "maxclass": "newobj",
          "text": "node.script node-bridge.js @autostart 1",
          "patching_rect": [30.0, 150.0, 255.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-js",
          "maxclass": "newobj",
          "text": "js live-api.js",
          "patching_rect": [360.0, 150.0, 100.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-load",
          "maxclass": "newobj",
          "text": "loadbang",
          "patching_rect": [30.0, 104.0, 60.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-start",
          "maxclass": "message",
          "text": "script start",
          "patching_rect": [110.0, 104.0, 75.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-midiin",
          "maxclass": "newobj",
          "text": "midiin",
          "patching_rect": [30.0, 250.0, 45.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-midiout",
          "maxclass": "newobj",
          "text": "midiout",
          "patching_rect": [30.0, 295.0, 50.0, 22.0]
        }
      },
      {
        "box": {
          "id": "obj-note",
          "maxclass": "comment",
          "text": "Keep one adapter loaded on a MIDI track. Luma Live.app owns the iPad remote; this device listens only on 127.0.0.1:17878.",
          "patching_rect": [30.0, 345.0, 650.0, 42.0],
          "presentation": 1,
          "presentation_rect": [18.0, 78.0, 500.0, 40.0]
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": ["obj-load", 0],
          "destination": ["obj-start", 0]
        }
      },
      {
        "patchline": {
          "source": ["obj-start", 0],
          "destination": ["obj-node", 0]
        }
      },
      {
        "patchline": {
          "source": ["obj-node", 0],
          "destination": ["obj-js", 0]
        }
      },
      {
        "patchline": {
          "source": ["obj-js", 0],
          "destination": ["obj-node", 0]
        }
      },
      {
        "patchline": {
          "source": ["obj-midiin", 0],
          "destination": ["obj-midiout", 0]
        }
      }
    ]
  }
}
