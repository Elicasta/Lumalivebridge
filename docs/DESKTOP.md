# Luma Live Desktop v0.4

Luma Live.app is the single public application and LAN host.

## Runtime shape

```text
iPad / browser
      |
      v
Luma Live.app :7878
      |
      | localhost only
      v
127.0.0.1:17878
      |
Luma Live.amxd
      |
Ableton LiveAPI
```

The iPad never talks directly to Max.

## Offline-first behavior

Internet is not required for:

- opening Luma Live
- song/library editing
- setlist building
- Arrangement mapping
- the same-network remote
- live control between the Mac and Ableton

SQLite lives in the normal macOS application data directory. The resolved path is shown under **Settings → Local Database**.

## Network roles

Luma Live.app binds publicly to port `7878`.

The Max adapter binds only to:

```text
127.0.0.1:17878
```

The remote uses a persistent local token stored beside the desktop application data.

## Desktop pages

- **Song Control**: Arrangement navigation, track mixer, transport, plain-language commands
- **Busk**: Session View scenes and Stop All
- **Library**: reusable songs and sections
- **Setlists**: service order and Ableton sync
- **Settings**: local database, remote URL, adapter status

## Legacy migration

If SQLite is empty on first launch, v0.4 looks for older Luma libraries under:

```text
~/Library/Application Support/LumaLiveBridge/library/
~/Library/Application Support/LumaLiveBridge/library.json
```

Existing SQLite data is never replaced by the migration.

## Development

```bash
npm install
npm run desktop:dev
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

Production development build:

```bash
npm run desktop:build
```

The GitHub macOS build also performs a launch smoke test before creating the DMG.

## Current runtime boundary

The unified code compiles in CI, but actual Ableton LiveAPI behavior must still be validated on a real Live set before release claims are made.
