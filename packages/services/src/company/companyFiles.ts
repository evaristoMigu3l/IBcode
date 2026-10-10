import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  CompanyRefusal,
  checkShellCommand,
  companyShellEnv,
  isInside,
  resolveCompanyPath,
  type CompanyRoot,
} from "./companyPolicy.js";

const MAX_READ_BYTES = 256 * 1024;
const MAX_OUTPUT = 20_000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".home", ".tmp", "__pycache__", ".venv"]);

export const clip = (s: string, n = MAX_OUTPUT) =>
  s.length > n ? `${s.slice(0, n)}\n…[${s.length - n} more characters]` : s;

export async function listFiles(roots: CompanyRoot[], path: unknown) {
  const dir = await resolveCompanyPath(path, roots, "read");
  const entries = await readdir(dir, { withFileTypes: true });
  return Promise.all(
    entries.slice(0, 500).map(async (e) => {
      if (e.isDirectory()) return { name: `${e.name}/`, type: "dir" };
      const size = await stat(join(dir, e.name)).then((s) => s.size, () => 0);
      return { name: e.name, type: "file", size };
    }),
  );
}

export async function readTextFile(
  roots: CompanyRoot[],
  path: unknown,
  offset?: unknown,
  limit?: unknown,
): Promise<string> {
  const file = await resolveCompanyPath(path, roots, "read");
  const info = await stat(file);
  if (info.isDirectory()) throw new CompanyRefusal("That is a folder; use files_list.");
  if (info.size > MAX_READ_BYTES && offset === undefined) {
    throw new CompanyRefusal(
      `File is ${info.size} bytes; read it in parts with offset/limit (line numbers).`,
    );
  }
  const text = await readFile(file, "utf8");
  if (text.includes("\0")) return `(binary file, ${info.size} bytes)`;
  if (offset === undefined && limit === undefined) return clip(text, MAX_READ_BYTES);
  const lines = text.split("\n");
  const start = Math.max(0, Number(offset) || 0);
  const count = Math.min(Math.max(1, Number(limit) || 400), 2000);
  return clip(lines.slice(start, start + count).join("\n"), MAX_READ_BYTES);
}

export async function writeTextFile(roots: CompanyRoot[], path: unknown, content: unknown) {
  const file = await resolveCompanyPath(path, roots, "write");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, String(content ?? ""), "utf8");
  return `Saved ${file}`;
}

export async function editTextFile(
  roots: CompanyRoot[],
  args: { path?: unknown; old_text?: unknown; new_text?: unknown; replace_all?: unknown },
) {
  const file = await resolveCompanyPath(args.path, roots, "write");
  const oldText = String(args.old_text ?? "");
  if (!oldText) throw new CompanyRefusal("old_text is empty.");
  const text = await readFile(file, "utf8");
  const count = text.split(oldText).length - 1;
  if (count === 0) throw new CompanyRefusal("old_text was not found in the file.");
  if (count > 1 && args.replace_all !== true) {
    throw new CompanyRefusal(`old_text appears ${count} times; add context or set replace_all.`);
  }
  await writeFile(file, text.split(oldText).join(String(args.new_text ?? "")), "utf8");
  return `Edited ${file} (${count} replacement${count > 1 ? "s" : ""})`;
}

export async function deletePath(roots: CompanyRoot[], path: unknown, recursive: unknown) {
  const target = await resolveCompanyPath(path, roots, "write");
  if (roots.some((r) => isInside(target, r.path) && isInside(r.path, target))) {
    throw new CompanyRefusal("You cannot delete one of your root folders.");
  }
  const info = await stat(target);
  if (info.isDirectory() && recursive !== true) {
    throw new CompanyRefusal("That is a folder; set recursive to delete it with its contents.");
  }
  await rm(target, { recursive: info.isDirectory(), force: true });
  return `Deleted ${target}`;
}

export async function searchFiles(roots: CompanyRoot[], query: unknown, path: unknown) {
  const needle = String(query ?? "").toLowerCase();
  if (!needle) throw new CompanyRefusal("query is empty.");
  const start = await resolveCompanyPath(path, roots, "read");
  const matches: string[] = [];
  let scanned = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (matches.length >= 200 || scanned >= 2000) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full);
        continue;
      }
      scanned++;
      if ((await stat(full).then((s) => s.size, () => Infinity)) > 1024 * 1024) continue;
      const text = await readFile(full, "utf8").catch(() => "");
      if (text.includes("\0")) continue;
      text.split("\n").forEach((line, i) => {
        if (matches.length < 200 && line.toLowerCase().includes(needle)) {
          matches.push(`${relative(start, full)}:${i + 1}: ${line.trim().slice(0, 240)}`);
        }
      });
    }
  };
  await walk(start);
  return matches.length ? matches.join("\n") : "No matches.";
}

export async function runShell(params: {
  command: unknown;
  ownFolder: string;
  roots: CompanyRoot[];
  timeoutSec: unknown;
}): Promise<{ exitCode: number; timedOut: boolean; stdout: string; stderr: string }> {
  const command = String(params.command ?? "");
  if (!command.trim()) throw new CompanyRefusal("command is empty.");
  const writeRoots = params.roots.filter((r) => r.access === "write").map((r) => r.path);
  const refusal = checkShellCommand(command, writeRoots, params.ownFolder);
  if (refusal) throw new CompanyRefusal(refusal);

  const tmp = join(params.ownFolder, ".tmp");
  await mkdir(tmp, { recursive: true });
  await mkdir(join(params.ownFolder, ".home"), { recursive: true });
  const isWin = process.platform === "win32";
  let cmd = "/bin/sh";
  let args = ["-c", command];
  let script: string | undefined;
  if (isWin) {
    // 写成 .ps1 再 -File 执行：多行脚本、引号都不需要再经过一层命令行转义。
    script = join(tmp, `cmd-${randomUUID()}.ps1`);
    await writeFile(
      script,
      `﻿[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ProgressPreference='SilentlyContinue'\n${command}\n`,
      "utf8",
    );
    cmd = "powershell.exe";
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script];
  }
  const timeoutMs = Math.min(Math.max(Number(params.timeoutSec) || 120, 1), 1800) * 1000;
  try {
    return await new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: params.ownFolder,
        env: companyShellEnv(params.ownFolder),
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // 只杀 powershell 本身会留下它启动的子进程；按进程树结束。
        if (isWin && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        if (stdout.length < 1_000_000) stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 1_000_000) stderr += d.toString("utf8");
      });
      const finish = (exitCode: number) => {
        clearTimeout(timer);
        resolve({ exitCode, timedOut, stdout: clip(stdout), stderr: clip(stderr, 8000) });
      };
      child.on("error", (e) => {
        stderr += e.message;
        finish(-1);
      });
      child.on("close", (code) => finish(code ?? -1));
    });
  } finally {
    if (script) await rm(script, { force: true });
  }
}
