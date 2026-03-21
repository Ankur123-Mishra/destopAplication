# Photographer desktop app (Electron + Vite + React)

Same commands work on **Windows**, **macOS**, and **Linux**.

## Prerequisites

- Node.js 18+ and npm

## Parent collection flow (admin → web → desktop)

1. **Admin (web)** uses **Photographer parent collection** on the dashboard — **app-wide** only. Photographers cannot toggle this. **Schools do not** disable standalone links; the school toggle is only for legacy **fixed-class** links.
2. **Parents** open the shared URL on the **web** app: `/c/:token` (not inside Electron). The desktop app only **generates** that link.
3. **Photographer (desktop)** uses **Parent forms** in the sidebar: standalone (default) or school-bound. Set `VITE_PUBLIC_PARENT_ORIGIN` to your deployed web origin so copied links work on phones.

See `docs/PARENT_COLLECTION_PERMISSIONS.md` in the repo root.

## Development (hot reload + Electron)

Starts Vite on port **5173**, then opens Electron pointed at that URL.

```bash
npm install
npm run dev
```

- **Windows:** DevTools: `Ctrl+Shift+I` or `F12`
- **macOS:** DevTools: `Cmd+Option+I`

## Run the built app (production UI from `dist/`)

```bash
npm run start:prod
```

Or step by step:

```bash
npm run build
npm start
```

## Create installers (optional)

Requires `npm run build` first (bundles the Vite `dist/` folder).

| Platform | Command | Notes |
|----------|---------|--------|
| Windows | `npm run pack:win` | Produces NSIS installer under `release/` |
| macOS | `npm run pack:mac` | Produces `.dmg` under `release/` — run on a Mac (Apple code signing may apply) |
| Current OS | `npm run pack` | Builds for the OS you run the command on |

## macOS vs Windows behavior

- **Dock / taskbar:** On macOS, closing all windows does not quit the app by default; use **Quit** from the menu or `Cmd+Q`. On Windows, closing the window exits the app.
- **Re-open window:** On macOS, clicking the dock icon creates a new window again (`activate` handler). Same codebase path for both platforms.
- **Packaging:** Run `npm run pack:win` on Windows for an NSIS installer. Run `npm run pack:mac` on a Mac for a `.dmg` (electron-builder cannot build macOS installers on Windows).

## Troubleshooting

- **`npm install` fails on Windows with `EBADPLATFORM` / `darwin`:** Do not list macOS-only packages (for example `dmg-license`, `iconv-corefoundation`) as direct `dependencies` in `package.json`. Let `electron-builder` install them on macOS only.
