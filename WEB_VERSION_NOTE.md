# ZCode web version: rebuild note

Double-click `start-web.bat` to run ZCode in the browser (http://127.0.0.1:3030).

The launcher serves the **last build**, not the source code. After you change any code,
rebuild first or the web version won't show the changes:

```
pnpm --filter @zcode/web build
cd packages/server && npx tsup
```

Then double-click `start-web.bat` again.

- Phone/Wi-Fi access: run `start-web.bat --lan` from a terminal (prints a link with a token).
- "Port in use" / exit code 4: an old server is still running. Close its window (or end the leftover `node` process on port 3030) and start again.
- The desktop app needs its own rebuild (see `ZCODE_PATCH_NOTES.md`).
