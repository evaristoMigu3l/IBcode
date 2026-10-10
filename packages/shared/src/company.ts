import type { ModelSelection } from "./model-selection.js";

// ---- Company：OpenBot 式 AI 同事 ----
// 每个同事 = 一份配置 + 一个专属文件夹；所有文件/命令动作都经过 host 内的 Company Gateway
// （按同事授权的文件夹裁决并写审计），再以普通 ZCode task 的形式运行。

export const COMPANY_ICON_IDS = [
  "orbit",
  "pulse",
  "radar",
  "wave",
  "gear",
  "spark",
  "atom",
  "prism",
  "helix",
  "cube",
  "compass",
  "bolt",
] as const;
export type CompanyIconId = (typeof COMPANY_ICON_IDS)[number];
/** 内置图标 id，或用户上传到图标库的 "custom:<16 位 hex>"。 */
export type CompanyAgentIcon = CompanyIconId | `custom:${string}`;

export const COMPANY_CUSTOM_ICON_RE = /^custom:[a-f0-9]{16}$/;

/**
 * 用户上传到图标库的图标：SVG（已清洗，渲染时再清洗一次），或 MP4/WebM/GIF/WebP/PNG 动图（data URL）。
 */
export interface CompanyCustomIcon {
  id: string;
  name: string;
  kind: "svg" | "video" | "image";
  svg?: string;
  dataUrl?: string;
}

/** 来自例行任务和同事（非老板消息）的每日自主运行上限默认值。 */
export const COMPANY_DEFAULT_DAILY_RUN_LIMIT = 30;

export const COMPANY_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#06b6d4",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#f43f5e",
  "#64748b",
] as const;

/** off = 无 shell；ask = 每条命令都需要你在 task 里批准；auto = 守卫检查通过即执行。 */
export type CompanyShellMode = "off" | "ask" | "auto";

export interface CompanyFolderGrant {
  path: string;
  access: "read" | "write";
}

export interface CompanyRoutine {
  id: string;
  /** 5 段 cron，本地时区；最短间隔 15 分钟。 */
  cron: string;
  task: string;
  channel: string;
  enabled: boolean;
}

export interface CompanyAgent {
  id: string;
  name: string;
  title: string;
  instructions: string;
  icon: CompanyAgentIcon;
  color: string;
  /** 缺省跟随桌面端当前首选模型。 */
  model?: ModelSelection;
  web: boolean;
  shell: CompanyShellMode;
  delegate: boolean;
  /** 例行任务/同事每天最多能唤醒它几次；0 = 只有老板发消息才工作。旧配置缺省按默认值。 */
  dailyRunLimit?: number;
  skills: string[];
  mcpServers: string[];
  folders: CompanyFolderGrant[];
  routines: CompanyRoutine[];
  createdAt: number;
  updatedAt: number;
}

export type CompanyAgentInput = Omit<CompanyAgent, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export interface CompanyMessage {
  id: string;
  ts: number;
  channel: string;
  /** "boss" | "system" | 同事 id */
  from: string;
  text: string;
  runId?: string;
}

export type CompanyRunTrigger = "message" | "routine" | "delegate" | "mention";
export type CompanyRunStatus = "running" | "needs-you" | "done" | "failed";

export interface CompanyRun {
  id: string;
  agentId: string;
  channel: string;
  trigger: CompanyRunTrigger;
  depth: number;
  /** 由哪位同事唤醒（转交或 @提及）；老板消息与例行任务为空。 */
  requestedBy?: string;
  taskId?: string;
  workspacePath: string;
  status: CompanyRunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export type CompanyAuditDecision = "allowed" | "refused" | "failed";

export interface CompanyAuditEntry {
  ts: number;
  agentId: string;
  runId: string;
  tool: string;
  target?: string;
  decision: CompanyAuditDecision;
  detail?: string;
}

export interface CompanyState {
  home: string;
  /** 同事 id -> 它自己的文件夹 */
  folders: Record<string, string>;
  agents: CompanyAgent[];
  channels: string[];
  runs: CompanyRun[];
}

/** 同事文件夹里的一项（路径相对于同事自己的文件夹，用 / 分隔）。 */
export interface CompanyFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  modifiedAt: number;
}

/** 文件预览：文本直接给内容，图片给 data URL，其他类型只给绝对路径（用系统默认程序打开）。 */
export interface CompanyFilePreview {
  path: string;
  absolutePath: string;
  size: number;
  kind: "text" | "image" | "other";
  text?: string;
  truncated?: boolean;
  dataUrl?: string;
}

export interface CompanyCapabilities {
  mcpServers: string[];
  skills: string[];
}

export const COMPANY_RESERVED_IDS = new Set(["boss", "system", "general", "all"]);

/** 名字 -> 稳定 id（文件夹名、频道名、@提及都用它）。 */
export function companySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function companyDmChannel(agentId: string): string {
  return `dm-${agentId}`;
}

/**
 * 这条消息「点名」的同事：消息以 @ 开头时只算开头连续的那几个（"@chief-of-staff 去问 @researcher"
 * 只叫 chief-of-staff）；不以 @ 开头时文中所有 @ 都算。
 */
export function companyAddressedMentions(
  text: string,
  agentIds: readonly string[],
  options: { leadingOnly?: boolean } = {},
): string[] {
  const lead = /^\s*((?:@[a-z0-9_-]+[\s,;:]*)+)/i.exec(text);
  if (lead) return companyMentions(lead[1]!, agentIds);
  // 同事发言只认开头点名（汇报里顺带提到谁不唤醒）；老板随口一句 "hey @researcher" 也算。
  return options.leadingOnly ? [] : companyMentions(text, agentIds);
}

/** 文本里被 @ 到的同事 id（@all 展开为全部）。 */
export function companyMentions(text: string, agentIds: readonly string[]): string[] {
  const lower = text.toLowerCase();
  if (/(^|[^a-z0-9_-])@all(?![a-z0-9_-])/.test(lower)) return [...agentIds];
  return agentIds.filter((id) =>
    new RegExp(`(^|[^a-z0-9_-])@${id.replace(/[-]/g, "\\-")}(?![a-z0-9_-])`).test(lower),
  );
}
