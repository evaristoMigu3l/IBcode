#!/usr/bin/env node
// ZCode in the browser (same UI and data as the desktop app, Company included).
//   node scripts/start-web.mjs          -> http://127.0.0.1:3030, this PC only
//   node scripts/start-web.mjs --lan    -> reachable from your Wi-Fi (phone), protected by a token
// Build first (once, and after pulling changes):
//   pnpm --filter @zcode/web build && cd packages/server && npx tsup
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = resolve(root, "packages/server/dist/entry-http.js");
const webDist = resolve(root, "packages/web/dist");
for (const [path, hint] of [
  [server, "cd packages/server && npx tsup"],
  [webDist, "pnpm --filter @zcode/web build"],
]) {
  if (!existsSync(path)) {
    console.error(`Missing ${path}\nBuild it first: ${hint}`);
    process.exit(1);
  }
}

const lan = process.argv.includes("--lan");
const port = process.env.PORT || "3030";
// Coworkers can run commands, so anything reachable from the network must require a token.
const token = process.env.ZCODE_SERVER_AUTH_TOKEN || (lan ? randomBytes(18).toString("base64url") : "");

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    ZCODE_SERVER_HOST: lan ? "0.0.0.0" : "127.0.0.1",
    ZCODE_WEB_STATIC_ROOT: webDist,
    ...(token ? { ZCODE_SERVER_AUTH_TOKEN: token } : {}),
  },
});

if (lan) {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
  console.log("\nZCode web is reachable on your network. Open on any device:");
  for (const ip of ips) console.log(`  http://${ip}:${port}/?token=${token}`);
  console.log("Keep this link private: it gives full access to your ZCode and coworkers.\n");
} else {
  console.log(`\nZCode web: http://127.0.0.1:${port}  (this PC only; add --lan for your phone)\n`);
}
child.on("exit", (code) => process.exit(code ?? 0));
