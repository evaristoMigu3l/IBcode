# Built-in terminal in Termux: compiling node-pty

> Status: **not tested on a real phone yet.** These steps follow how Termux usually builds native
> Node modules. If a step fails, the rest of ZCode still works (see below).

## Do you need this?
Only if you run the **ZCode server inside Termux** on your Android phone.

- **Phone browser → server on your PC or in the cloud** (`start-web.bat --lan`): you don't need
  this. The terminal runs on that machine.
- **Server inside Termux**: the built-in terminal needs `node-pty`, a native module. The copies
  that come prebuilt for Linux are made for normal Linux (glibc), and Android uses a different C
  library (bionic), so they won't load. You compile it on the phone once.

Without `node-pty`, ZCode starts normally. Chat, Company, files and coworkers all work, and only
the terminal panel shows "node-pty is unavailable in this runtime". ZCode loads `node-pty` only
when you open a terminal (`packages/services/src/terminal/terminalService.ts`).

## 1. Install the build tools
```
pkg update
pkg install nodejs git python make clang binutils
node -v        # ZCode needs Node 24
```

## 2. Work around node-gyp's Android check
On Termux, node-gyp often stops with an error about `android_ndk_path`. Give it an empty value
once:
```
mkdir -p ~/.gyp
echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
```

## 3. Install ZCode without downloading Electron
Electron is the desktop app and has no Android build, so skip its download:
```
git clone https://github.com/evaristoMigu3l/IBcode.git zcode
cd zcode
npm install -g pnpm
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install
```

## 4. Compile node-pty
```
pnpm --filter @zcode/server rebuild node-pty
pnpm --filter @zcode/services rebuild node-pty
```
Check it loads:
```
cd packages/server
node -e "require('node-pty').spawn('sh', [], {}).kill(); console.log('node-pty OK')"
cd ../..
```

## 5. Build and start
```
pnpm --filter @zcode/web build
cd packages/server && npx tsup && cd ../..
node scripts/start-web.mjs
```
Open http://127.0.0.1:3030 in Chrome on the same phone. Then choose **Add to Home screen** to
open it full-screen like an app.

## If it doesn't work
- `rebuild` prints `gyp ERR!` about `android_ndk_path`: redo step 2.
- `clang` or `make` not found: redo step 1.
- The web build runs out of memory on the phone: build `packages/web/dist` on your PC
  (`pnpm --filter @zcode/web build`) and copy that folder to the phone.
- You can always skip the terminal. Everything else works without `node-pty`.

Inside Termux, coworkers' shell tool runs `sh` (not PowerShell) in their own folder.
