# Luma Live Ableton Adapter

The `device/` directory contains the Max for Live side of Luma Live.

In the unified v0.4 architecture this device is **not** a second application and it does not host the iPad remote.

It binds only to:

```text
127.0.0.1:17878
```

Its responsibilities are intentionally limited to:

- reading Ableton LiveAPI state
- executing allowlisted Ableton commands
- relaying transport, tracks, scenes, mixer state, and locator operations to Luma Live.app

The public LAN UI is in `remote/` and is served only by Luma Live.app on port `7878`.

The permanent song/setlist library lives in the desktop SQLite database, not inside Max.
