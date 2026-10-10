import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ZCodeAgentMcpServer } from "@zcode/shared";
import { COMPANY_AUTO_APPROVED_TOOLS, COMPANY_MCP_SERVER_NAME } from "./companyTools.js";

type RawServer = Record<string, unknown>;

const cliConfigPath = () => join(homedir(), ".zcode", "cli", "config.json");

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const entries = (v: unknown) =>
  Object.entries(asRecord(v)).map(([name, value]) => ({ name, value: String(value) }));

/** 用户在 ZCode 里装好的 MCP 服务器（.zcode/cli/config.json 与 .agents/mcp.json），共同组成授权池。 */
async function readRawServers(): Promise<Map<string, RawServer>> {
  const zcode = asRecord(asRecord((await readJsonObject(cliConfigPath())).mcp).servers);
  const agents = asRecord((await readJsonObject(join(homedir(), ".agents", "mcp.json"))).mcpServers);
  const servers = new Map<string, RawServer>();
  for (const [name, raw] of Object.entries({ ...agents, ...zcode })) {
    const server = asRecord(raw);
    if (name === COMPANY_MCP_SERVER_NAME || server.enabled === false || server.enable === false) continue;
    servers.set(name, server);
  }
  return servers;
}

function toAgentServer(name: string, raw: RawServer): ZCodeAgentMcpServer | undefined {
  const timeoutMs = typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined;
  if (typeof raw.command === "string") {
    return {
      name,
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
      env: entries(raw.env),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  }
  if (typeof raw.url === "string") {
    return {
      name,
      type: raw.type === "sse" ? "sse" : "http",
      url: raw.url,
      headers: entries(raw.headers),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  }
  return undefined;
}

export async function listMcpServerNames(): Promise<string[]> {
  return [...(await readRawServers()).keys()].sort();
}

/** 只把授权给该同事的服务器交给它的 task（task 级列表会替换全局列表，未授权的根本连不上）。 */
export async function grantedMcpServers(names: readonly string[]): Promise<ZCodeAgentMcpServer[]> {
  const raw = await readRawServers();
  return names.flatMap((name) => {
    const server = raw.get(name);
    const converted = server ? toAgentServer(name, server) : undefined;
    return converted ? [converted] : [];
  });
}

export async function listSkillNames(): Promise<string[]> {
  const roots = [join(homedir(), ".zcode", "skills"), join(homedir(), ".agents", "skills")];
  const names = new Set<string>();
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md"))) names.add(entry.name);
    }
  }
  return [...names].sort();
}

/**
 * Gateway 自身的工具免确认（shell_ask 除外），否则后台运行的同事每一步都要等批准。
 * 同时清理旧版独立 company.mjs 留下的全局 stdio 条目，避免每个普通会话都多拉一个进程。
 */
export async function ensureCompanyPermissions(): Promise<void> {
  const path = cliConfigPath();
  const config = await readJsonObject(path);
  const permission = asRecord(config.permission);
  const allowed = Array.isArray(permission.allowedTools) ? permission.allowedTools.map(String) : [];
  const legacyTools = new Set(["mcp__company__computer_exec", "mcp__company__computer_reset"]);
  const nextAllowed = [...new Set([...allowed.filter((t) => !legacyTools.has(t)), ...COMPANY_AUTO_APPROVED_TOOLS])];
  const servers = asRecord(asRecord(config.mcp).servers);
  const legacy = asRecord(servers[COMPANY_MCP_SERVER_NAME]);
  const hasLegacyServer = Array.isArray(legacy.args) && legacy.args.some((a) => String(a).endsWith("company.mjs"));
  if (nextAllowed.length === allowed.length && nextAllowed.every((t, i) => t === allowed[i]) && !hasLegacyServer) {
    return;
  }
  if (hasLegacyServer) delete servers[COMPANY_MCP_SERVER_NAME];
  const next = {
    ...config,
    ...(hasLegacyServer ? { mcp: { ...asRecord(config.mcp), servers } } : {}),
    permission: { ...permission, allowedTools: nextAllowed },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
