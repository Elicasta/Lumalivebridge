# Luma Live Desktop

Luma Live v0.3 moves the permanent library and local-network host out of the Max for Live device and into a real macOS application.

## Offline-first behavior

The desktop app does not require internet access for:

- opening Luma Live
- reading or editing the song library
- reading or editing saved setlists
- running the built-in LAN remote server
- serving the iPad/iPhone remote over the local network

The local database is SQLite and is stored inside the normal macOS application data directory:

```text
~/Library/Application Support/com.eccreative.lumalive/luma-live.db
```

The exact resolved path is shown in **Settings → Local Database**.

## Same-network remote

When Luma Live opens it starts a local HTTP server.

The preferred port is `7878`. If that port is already occupied, Luma Live automatically tries the next available port through `7897`.

That is intentional during the bridge migration because the older Max/Node bridge may already be using port 7878.

The desktop app displays the actual remote address, for example:

```text
http://192.168.1.42:7879/
```

The full copyable link also contains a persistent local token. Open that full link on an iPad or iPhone connected to the same LAN.

The remote UI is bundled into the Mac application. It does not fetch its interface from the internet.

## Local authentication

A random remote token is created on first launch and stored beside the SQLite database:

```text
remote-token
```

The token is included in the full remote URL shown by the Mac app and is required for local API requests.

## Development

Install the Tauri CLI dependency:

```bash
npm install
```

Run the desktop app:

```bash
npm run desktop:dev
```

Build the macOS app and DMG:

```bash
npm run desktop:build
```

Tauri source lives in:

```text
src-tauri/
```

The desktop webview is:

```text
app/
```

The same-network remote is:

```text
remote/
```

## Current bridge boundary

The original Max for Live bridge remains in `device/`.

v0.3 deliberately establishes the permanent application boundary first:

```text
Luma Live.app
  ├─ SQLite library
  ├─ local song/setlist management
  ├─ LAN server
  └─ remote UI

Ableton
  └─ existing Luma Live Bridge Max device
```

The next bridge step is to make the Tauri app the only LAN-facing server and move Ableton communication to a private localhost connection between Luma Live.app and the Max device.

At that point the iPad will never talk directly to Max. It will talk only to Luma Live.app.
