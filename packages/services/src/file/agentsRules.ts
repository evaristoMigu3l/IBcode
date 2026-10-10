import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { atomicWriteText } from "../fs/atomicFileUtils.js";

export type AgentsRulesScope = "workspace" | "global";

export interface AgentsRulesResult {
  content: string;
  filePath: string;
  exists: boolean;
}

export const DEFAULT_AGENTS_RULES_TEMPLATE = `# Agent Instructions

## Core Principles
- Always understand project context and requirements before modifying code.
- Write clean, type-safe, and idiomatic code adhering to existing project conventions.
- Verify changes with available typecheck and test commands before completion.

## Project Rules
<!-- Add your project-specific conventions, commands, and requirements here -->
`;

function resolveUserHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

export function resolveAgentsRulesPath(params: {
  scope: AgentsRulesScope;
  workspacePath?: string;
}): string {
  if (params.scope === "workspace") {
    if (!params.workspacePath || params.workspacePath.trim().length === 0) {
      throw new Error("Workspace path is required to resolve workspace AGENTS.md");
    }
    return resolve(params.workspacePath, "AGENTS.md");
  }
  return resolve(resolveUserHomeDir(), ".zcode", "AGENTS.md");
}

/**
 * 读取工作区或全局 AGENTS.md 规则文件。
 * 文件不存在时返回默认模板（exists: false），不执行自动落盘。
 */
export async function readAgentsRules(params: {
  scope: AgentsRulesScope;
  workspacePath?: string;
}): Promise<AgentsRulesResult> {
  const filePath = resolveAgentsRulesPath(params);
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      const content = await readFile(filePath, "utf-8");
      return { content, filePath, exists: true };
    }
  } catch {
    // 文件不存在或不可访问，回退至模板
  }
  return {
    content: DEFAULT_AGENTS_RULES_TEMPLATE,
    filePath,
    exists: false,
  };
}

/**
 * 保存工作区或全局 AGENTS.md 规则文件。
 * 使用 atomicWriteText 保证原子写入并自动递归创建父目录。
 */
export async function writeAgentsRules(params: {
  scope: AgentsRulesScope;
  workspacePath?: string;
  content: string;
}): Promise<{ filePath: string }> {
  const filePath = resolveAgentsRulesPath(params);
  await atomicWriteText(filePath, params.content);
  return { filePath };
}
