# ZCode patch: built-in file editor + stable MCP connections

## 1. Edit files yourself (file preview pane)
Open any text file from the file tree -> click **Edit** (top right of the preview).

- Type, delete, paste anywhere; **Save** button or **Ctrl/Cmd+S** writes it to disk.
- **Done** / **Esc** leaves edit mode (asks before discarding unsaved changes).
- Dot next to the file name = unsaved changes. Closing the window with unsaved edits warns you.
- Shortcuts: Tab / Shift+Tab (indent/outdent, multi-line), auto-indent on Enter,
  Ctrl/Cmd+D duplicate line, Ctrl/Cmd+Shift+K delete line, Ctrl/Cmd+/ toggle comment.
- Keeps the file's original line endings (CRLF/LF) and indentation style.
- Conflict safety: if the agent changes the file while you're editing, Save won't clobber it.
  You get a banner with **Reload from disk** or **Overwrite**.
- Limits: files over 256 KB (existing viewer limit) and binary files stay read-only.

Files:
- `packages/services/src/file/file.ts` - new `writeTextFile()` on IFileService
- `packages/services/src/file/fileService.ts` - implementation (existing files only, mtime check)
- `packages/ui/src/components/ui/code-editor.tsx` - NEW dependency-free editor component
- `packages/ui/src/PreviewPane.tsx` - Edit / Save / Done buttons, conflict + error banners
- `packages/ui/src/i18n/locales/en-US.ts`, `zh-CN.ts` - new strings

Remote workspaces: the remote server also needs this build (same repo) to support saving.

## 2. MCP connections no longer drop and stay dead
`apps/zcode-cli/packages/adapters/src/mcp/index.ts`

Before: after a drop, a server stayed "disconnected" until a tool call happened, reconnect was
tried once only for the exact error "Not connected", HTTP/SSE servers could die silently, a
single slow ping marked a server dead, and a server in "failed" state never came back.

Now:
- **Auto-reconnect in the background** with exponential backoff + jitter (1s -> 30s max,
  12 attempts) after an unexpected close, a lost heartbeat, or a transport error.
- **Heartbeat for HTTP/SSE servers** every 25s (keeps Streamable HTTP sessions warm and
  detects dead links). Needs 3 misses in a row before reconnecting; skipped while a tool call
  is running. Expired HTTP sessions ("session not found"/404) reconnect immediately.
  stdio servers aren't pinged (crashes are already detected via process exit).
- **Smarter tool-call recovery**: reconnects on any transport-level failure (not connected,
  refused, send failed, expired session, connection reset, socket hang up, fetch failed...).
  The call is retried automatically only when it provably never reached the server, so a
  non-idempotent tool is never run twice.
- Servers in a retryable **failed** state (network/timeout/5xx...) are reconnected before a
  tool call instead of erroring forever. Auth/config problems are NOT retried (need you).
- A failed initial connect due to network/timeout keeps retrying in the background
  (useful when a local MCP server starts after ZCode).
- `pingServer()` retries once before declaring a server dead (no more flapping).
- Explicit disconnect / session close cancels all timers; timers are unref'd.

Tunables (env vars): `ZCODE_MCP_HEARTBEAT_MS` (default 25000, 0 = off),
`ZCODE_MCP_RECONNECT_MAX_ATTEMPTS` (default 12, 0 = off).

## 3. Company: AI coworkers (OpenBot-style, built in)
Sidebar → **Company**. A team of AI coworkers, each with its own folder, tools, memory and
schedule, who talk with you and each other in channels. Inspired by
[CopilotKit OpenBot](https://github.com/CopilotKit/OpenBot) (none of its code is used). No Docker, no extra processes, nothing runs while the page is closed
except scheduled routines.

- **Channels**: `#general` plus a DM per coworker. `@name` (or writing in its DM) starts that
  coworker as a normal ZCode task with your current model; open the run to watch it or approve
  things. Its answer comes back to the channel.
- **Team**: create and edit coworkers without code. Set the name, role, 12 animated icons + colors,
  instructions, model, web access, shell (off / ask me / allowed), hand-offs to coworkers, extra
  folders (read-only or read & write), MCP servers and skills granted from your installed pool,
  routines (every hour, every 4 hours, daily, weekdays, weekly or cron; at least 15 min apart,
  20 max) and memory (MEMORY.md).
- **Activity**: every run, and every file/shell action each coworker attempted, allowed or refused.
- **Your own icons**: in Team → coworker → Icon, **Upload icon** adds it to your icon library
  (`~/.zcode/company/icons/`), reusable by any coworker.
  - **SVG** (up to 256 KB): CSS/SMIL animations and `:hover` effects work. Each icon renders in
    its own shadow root, so its CSS can't affect the app. Scripts, `on*` handlers,
    `<foreignObject>`, `<image>`, `<a>`, links outside the file and external `url()` are
    stripped, both at upload and again at render.
  - **Animated MP4 / WebM / GIF / WebP / PNG** (up to 4 MB), e.g. icon-pack animations exported
    as video. They play muted and looped and look exactly like the file (original
    background and colors), cropped to the rounded tile. Message rows
    show a still first frame, so long channels don't play dozens of videos. The real format is
    checked from the file's bytes.
- **Coworkers wake each other**: a post that *starts* with `@coworker` starts them (mentions
  mid-sentence don't). Without "hand work to coworkers" a coworker can only answer whoever asked
  it. Once an answer has woken the asker, the asker can't @ the answerer back just to
  thank or confirm. Chains stop after 3 steps. For your own messages, the leading `@`s decide
  who is addressed ("@chief-of-staff ask @researcher…" wakes only Chief of Staff).
- **While you're away**: closing the window hides ZCode to the tray and everything keeps running
  (routines, hand-off chains). Turn on *Settings → keep awake while running* so the PC doesn't
  idle-sleep. Each coworker has **Runs on its own per day** (default 30; routines + coworkers,
  not your messages). When it's hit, one notice is posted and it resumes the next day.
  Coworkers whose shell is "Ask me" will wait for you; set "Allowed" for trusted ones.
- **Isolation**: a coworker's built-in file/shell tools (Bash, Read, Write, Edit, Glob, Grep,
  node REPL, workflows, cron…) are switched off. It can only touch files through the in-app
  **Company Gateway**: an MCP server on 127.0.0.1 with a random port and a secret token for each
  run. The gateway resolves real paths (junctions and symlinks can't escape), allows only the
  agent's own folder plus the folders you granted, and logs every action. Only granted MCP
  servers are passed to its task. Shell runs PowerShell in its folder with home/temp redirected
  there, and refuses commands that reference other paths, env/home variables or escape tricks.
  Limit: that check is static, not a sandbox (Windows has no shell sandbox without a VM or
  container). Keep the shell on "Ask me" for anything sensitive.
- Data lives in `~/.zcode/company/` (`agents/`, `workspaces/<id>/`, `channels/`, `audit.jsonl`,
  `runs.json`). Deleting a coworker keeps its folder.
- On startup the app adds the gateway's tools (not `shell_ask`) to `permission.allowedTools` in
  `~/.zcode/cli/config.json`, so coworkers don't stop at every step.

- **Clear a channel**: the **Clear** button in any channel's header deletes all its messages
  (after a confirmation). Coworkers' files, memory and run history are kept.
- **Files tab**: pick a coworker and browse its folder. Reports, markdown, code and images preview
  in place; **Open** uses the file's default program on desktop (Download in the browser);
  **Show in folder**; **Delete** after a confirmation. `.home` and `.tmp` are hidden.
- **Handing files to each other**: coworkers can't read each other's folders, so a `files_send`
  tool copies a file into the recipient's `inbox/<sender>/` (duplicate names get "(2)",
  max 50 MB, audited). The prompt tells them to hand over deliverables this way and to save
  finished work as files.
- **Clear activity**: the **Clear** button on the Activity tab deletes finished runs and the
  action log, for everyone or just the coworker selected in the filter. Runs in progress stay.
  Daily run limits are counted separately (`usage.json`), so clearing doesn't reset them.

## 4. Web version
ZCode also runs in a browser: the same UI and the same data (`~/.zcode`), Company included.
```
pnpm --filter @zcode/web build          # once, and after code changes
cd packages/server && npx tsup && cd ../..
node scripts/start-web.mjs              # http://127.0.0.1:3030, this PC only
node scripts/start-web.mjs --lan        # phone/laptop on your Wi-Fi, prints a link with a token
```
The browser version still runs on this PC; the browser is just the window. If the desktop app
is also open, both share the same coworkers and messages, and a routine fires only once. Don't
expose port 3030 to the internet: coworkers can run commands. For access away from home, use a
VPN like Tailscale with `--lan`, or the desktop app's built-in mobile remote control.

**Phones:** the whole app adapts to phone screens. The sidebar becomes a drawer, side panes open
full-screen, there's a folder browser instead of the native picker, the terminal gets an extra key
row, and "Add to Home screen" works. Setup and details: `WEB_VERSION_NOTE.md`. Code:
`ui/src/hooks/usePhoneLayout.ts`, `ui/src/lib/directoryPickerBridge.ts` (+ `ui/test/directoryPicker.test.ts`),
the `data-phone-shell` rules at the end of `ui/src/styles.css`, `WorkspaceShellLayout.tsx`.

Files: `packages/services/src/company/*` (service, gateway, policy, tools, runner, store),
`packages/shared/src/company.ts`, `packages/ui/src/company/*`, `packages/ui/src/hooks/useCompany.ts`,
the sidebar/layout wiring, locale strings, `.cmp-*` animations in `packages/ui/src/styles.css`.
Test: `cd packages/services && node --import tsx --test test/company.test.ts`.

## Build
Same as upstream README: Node 24.14.0 + pnpm 10.33.2, then
```
pnpm bootstrap
pnpm dev:desktop          # run
pnpm typecheck            # recommended first after patching
```
No new dependencies were added, so the existing lockfile still works.

Note: some existing unit tests that assert the old behavior (e.g. "one failed ping = dead",
"only 'Not connected' triggers reconnect") may need their expectations updated.
