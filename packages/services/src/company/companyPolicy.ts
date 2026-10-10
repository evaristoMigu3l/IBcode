import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CompanyAgent } from "@zcode/shared";

/** Gateway 拒绝动作时抛出；消息会原样回给模型并写入审计。 */
export class CompanyRefusal extends Error {}

export interface CompanyRoot {
  path: string;
  access: "read" | "write";
}

const caseFold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

export function isInside(child: string, parent: string): boolean {
  const rel = relative(caseFold(parent), caseFold(child));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** 同事可触达的根：自己的文件夹（读写）在前，然后是老板授权的文件夹。 */
export function companyRoots(agent: CompanyAgent, ownFolder: string): CompanyRoot[] {
  return [
    { path: ownFolder, access: "write" },
    ...agent.folders.filter((f) => f.path.trim()).map((f) => ({ path: f.path, access: f.access })),
  ];
}

/**
 * 解析最深的已存在祖先的真实路径再拼回剩余部分：
 * 目录联接(junction)/符号链接指向外部时，按真实位置裁决，无法借链接逃出授权文件夹。
 */
async function canonical(p: string): Promise<string> {
  let current = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(p);
      tail.push(basename(current));
      current = parent;
    }
  }
}

export async function resolveCompanyPath(
  input: unknown,
  roots: CompanyRoot[],
  need: "read" | "write",
): Promise<string> {
  const raw = String(input ?? "").trim() || ".";
  if (/^\\\\|^\/\//.test(raw)) throw new CompanyRefusal("Network paths are not allowed.");
  const target = await canonical(isAbsolute(raw) ? raw : resolve(roots[0]!.path, raw));
  for (const root of roots) {
    if (!isInside(target, await canonical(root.path))) continue;
    if (need === "write" && root.access !== "write") {
      throw new CompanyRefusal(`${root.path} is read-only for you.`);
    }
    return target;
  }
  throw new CompanyRefusal(`"${raw}" is outside the folders you are allowed to use.`);
}

const PATH_CHARS = "[^\\s'\"`;|&<>(){},]";

const BANNED: Array<[RegExp, string]> = [
  [
    /\$env:|%[a-z_][a-z0-9_]*%|\$home\b|\[(system\.)?environment\]|getfolderpath|\$pshome|\$profile\b/i,
    "environment and home-directory variables",
  ],
  [/(^|[\s;|&(=])~(?=[\\/\s]|$)/, "~ (the home directory)"],
  [
    /-enc(odedcommand)?\b|frombase64string|\biex\b|invoke-expression|\bstart-process\b|\brunas\b|\bschtasks\b|\breg(\.exe)?\s+(add|delete|import)|new-psdrive|\bsubst\b|\bmklink\b|-itemtype\s+(symboliclink|junction|hardlink)/i,
    "commands that can escape the folder",
  ],
  [/\\\\[^\\\s]+\\|(^|[\s'"(=])\/\/[^/\s]+\//, "network paths"],
];

/**
 * Agent shell 的命令守卫：拒绝引用授权可写文件夹之外的路径，以及常见的逃逸手段。
 *
 * ponytail: 这是静态检查而非沙箱，Windows 上没有容器/VM 就无法真正隔离一个 shell，
 * 拼接字符串等写法可能绕过。可信度要求高的同事请把 shell 设为 "ask"（逐条批准）或 "off"；
 * 需要硬隔离时的升级路径是 WSL + bubblewrap 或 AppContainer 进程。
 */
export function checkShellCommand(
  command: string,
  writeRoots: string[],
  cwd: string,
): string | null {
  for (const [re, what] of BANNED) {
    if (re.test(command)) return `Refused: ${what} are not allowed in your shell.`;
  }
  const allowed = (p: string) => writeRoots.some((root) => isInside(p, root));
  const drivePaths = new RegExp(`(?<![a-z0-9])[a-z]:(?:[\\\\/]${PATH_CHARS}*)?`, "gi");
  for (const m of command.matchAll(drivePaths)) {
    const p = m[0].length === 2 ? `${m[0]}\\` : m[0];
    if (!allowed(resolve(p))) return `Refused: ${m[0]} is outside your folders.`;
  }
  const rooted = new RegExp(`(?<=^|[\\s'"(=])[\\\\/](?![\\\\/\\s])${PATH_CHARS}+`, "g");
  for (const m of command.matchAll(rooted)) {
    if (!allowed(resolve(cwd, m[0]))) {
      return `Refused: ${m[0]} points outside your folder (use paths relative to your folder).`;
    }
  }
  const parentRefs = new RegExp(`${PATH_CHARS}*\\.\\.${PATH_CHARS}*`, "g");
  for (const m of command.matchAll(parentRefs)) {
    if (!allowed(resolve(cwd, m[0]))) return `Refused: ${m[0]} leaves your folder.`;
  }
  return null;
}

/** Shell 只继承 PATH、语言、代理等变量；主目录/临时目录都指回同事自己的文件夹。 */
export function companyShellEnv(ownFolder: string): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "windir",
    "ComSpec",
    "SystemDrive",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "ProgramData",
    "CommonProgramFiles",
    "PSModulePath",
    "OS",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "LANG",
    "LC_ALL",
    "TERM",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  const home = join(ownFolder, ".home");
  const tmp = join(ownFolder, ".tmp");
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    TEMP: tmp,
    TMP: tmp,
    TMPDIR: tmp,
  };
}
