# ZCode web version: how to run it (and use it on your phone)

Double-click `start-web.bat` to run ZCode in the browser (http://127.0.0.1:3030).

## Rebuild after code changes
The launcher serves the **last build**, not the source code. After you change any code,
rebuild first or the web version won't show the changes:

```
pnpm --filter @zcode/web build
cd packages/server && npx tsup
```

Then double-click `start-web.bat` again.

## Use it on your phone
The whole app adapts to phone screens (under 768px wide). The server runs on your PC or in the
cloud, and the phone is the screen.

1. On the PC: `node scripts/start-web.mjs --lan` (or `start-web.bat --lan` from a terminal).
   It prints a link like `http://192.168.1.20:3030/?token=...`.
2. Open that link on the phone (same Wi-Fi). Away from home, use a VPN like Tailscale.
3. In Chrome: menu → **Add to Home screen**. ZCode then opens full-screen like an app.
   The token is remembered, and it stays the same across restarts (it's saved in
   `~/.zcode/web-lan-token`). Delete that file to sign every device out.

What changes on a phone:
- The sidebar is a slide-in drawer (button at the top left; tap outside to close it).
- Preview, Git, terminal and other side panes open full-screen; the button at the top right
  closes them.
- In the chat box, Enter adds a new line. Send with the arrow button.
- Picking a folder (open project, coworker folder access, data folder) opens a folder browser
  of the server's disk. Attaching files uploads them from the phone (gallery, files app).
- The terminal has an extra key row: Esc, Tab, Ctrl+C, Ctrl+D, Ctrl+L and arrows.
- Buttons that only appear on mouse hover on a computer are always visible on touch screens.
- The embedded web browser pane is a desktop-app feature and is not available in the web version.

## Troubleshooting
- "Port in use" / exit code 4: an old server is still running. Close its window (or end the
  leftover `node` process on port 3030) and start again.
- The desktop app needs its own rebuild (see `ZCODE_PATCH_NOTES.md`).

## Running the server inside Termux (experimental, not tested)
The usual setup is phone browser → server on your PC or a cloud machine. Running the server on
the phone itself in Termux should be possible, but nobody has tested it yet. Step-by-step guide
for the terminal part: `TERMUX_NODE_PTY.md`. What's known:
- Node.js 24 is needed (`pkg install nodejs`, then check `node -v`).
- Installing the repo pulls in Electron. Skip its download with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.
- The built-in terminal needs `node-pty`. The prebuilt Linux copies don't load on Android, so it
  must be compiled: `pkg install python make clang`, then reinstall. Chat, Company and files
  work without it.
- On Linux and Android, coworkers' shell tool runs `sh` instead of PowerShell.
