import { randomUUID } from "node:crypto";
import {
  companyAddressedMentions,
  companyDmChannel,
  companyMentions,
  type CompanyAgent,
  type CompanyMessage,
  type CompanyRun,
} from "@zcode/shared";
import {
  deletePath,
  editTextFile,
  listFiles,
  readTextFile,
  runShell,
  searchFiles,
  writeTextFile,
} from "./companyFiles.js";
import { CompanyRefusal, type CompanyRoot } from "./companyPolicy.js";
import { assertChannel, type CompanyStore } from "./companyStore.js";

export const COMPANY_MCP_SERVER_NAME = "company";
const MAX_DELEGATION_DEPTH = 3;
const MAX_MEMORY_CHARS = 32_000;

export interface CompanyToolContext {
  runId: string;
  depth: number;
  channel: string;
  requestedBy?: string;
  answering?: boolean;
  agent: CompanyAgent;
  roster: CompanyAgent[];
  roots: CompanyRoot[];
  ownFolder: string;
  store: CompanyStore;
  startDelegateRun(params: {
    agentId: string;
    channel: string;
    task: string;
    depth: number;
    trigger: "delegate" | "mention";
    requestedBy: string;
    answering?: boolean;
  }): Promise<CompanyRun>;
}

type Args = Record<string, unknown>;

export interface CompanyTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  readOnly?: boolean;
  /** 审计里展示的目标（路径/命令/频道）。 */
  target?: (args: Args) => string | undefined;
  run(args: Args, ctx: CompanyToolContext): Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
});
const pathArg = (a: Args) => (a.path === undefined ? "." : String(a.path));

async function post(ctx: CompanyToolContext, channel: string, text: string) {
  const message: CompanyMessage = {
    id: randomUUID(),
    ts: Date.now(),
    channel: assertChannel(channel),
    from: ctx.agent.id,
    text: text.trim().slice(0, 20_000),
    runId: ctx.runId,
  };
  if (!message.text) throw new CompanyRefusal("text is empty.");
  await ctx.store.appendMessage(message);
  return message;
}

/**
 * 同事在 team_post 里 @ 到的同事会被唤醒（链路最多 MAX_DELEGATION_DEPTH 步；@all 不算）。
 * 没有 hand-off 权限的同事只能唤醒「找它干活的那位」，用来回话。
 */
async function wakeMentioned(ctx: CompanyToolContext, message: CompanyMessage): Promise<string> {
  const targets = companyAddressedMentions(
    message.text.replace(/@all(?![a-z0-9_-])/gi, ""),
    ctx.roster.map((a) => a.id),
    { leadingOnly: true },
  ).filter(
    (id) =>
      id !== ctx.agent.id &&
      (ctx.agent.delegate || id === ctx.requestedBy) &&
      // 回答别人之后再 @ 回提问者只是确认/道谢，不唤醒，避免两位同事来回刷消息。
      !(ctx.answering && id === ctx.requestedBy),
  );
  if (!targets.length) return "";
  if (ctx.depth + 1 > MAX_DELEGATION_DEPTH) {
    return ` Not started (the hand-off chain is already ${ctx.depth} steps long): ${targets.join(", ")}. Finish or report back.`;
  }
  const runs = await Promise.all(
    targets.map((agentId) =>
      ctx.startDelegateRun({
        agentId,
        channel: message.channel,
        task: message.text,
        depth: ctx.depth + 1,
        trigger: "mention",
        requestedBy: ctx.agent.id,
        answering: agentId === ctx.requestedBy,
      }),
    ),
  );
  const started = runs.filter((r) => r.status !== "failed").map((r) => r.agentId);
  const notStarted = runs.filter((r) => r.status === "failed").map((r) => `${r.agentId} (${r.error ?? "failed"})`);
  return [
    started.length ? ` Started: ${started.join(", ")}; they will answer in #${message.channel}.` : "",
    notStarted.length ? ` Not started: ${notStarted.join("; ")}.` : "",
  ].join("");
}

const TEAM_TOOLS: CompanyTool[] = [
  {
    name: "team_roster",
    description: "List your coworkers (id, name, role).",
    inputSchema: schema({}),
    readOnly: true,
    run: async (_a, ctx) =>
      ctx.roster.map((a) => ({ id: a.id, name: a.name, title: a.title, isYou: a.id === ctx.agent.id })),
  },
  {
    name: "team_inbox",
    description: "Your unread messages: your DM channel with the boss plus any @mention of you. Marks them read.",
    inputSchema: schema({}),
    readOnly: true,
    run: async (_a, ctx) => {
      const since = await ctx.store.readCursor(ctx.agent.id);
      const all = (
        await Promise.all((await ctx.store.listChannels()).map((c) => ctx.store.readMessages(c, since, 500)))
      ).flat();
      const mine = all
        .filter(
          (m) =>
            m.from !== ctx.agent.id &&
            (m.channel === companyDmChannel(ctx.agent.id) ||
              companyMentions(m.text, [ctx.agent.id]).length > 0),
        )
        .sort((a, b) => a.ts - b.ts);
      if (mine.length) await ctx.store.writeCursor(ctx.agent.id, mine.at(-1)!.ts);
      return mine.map(({ channel, from, text, ts }) => ({ channel, from, text, at: new Date(ts).toISOString() }));
    },
  },
  {
    name: "team_read",
    description: "Read the latest messages of a channel (general, or dm-<coworker id>).",
    inputSchema: schema({ channel: str("Channel name."), limit: num("Default 30, max 200.") }, ["channel"]),
    readOnly: true,
    target: (a) => `#${String(a.channel)}`,
    run: async (a, ctx) =>
      (await ctx.store.readMessages(String(a.channel), 0, Math.min(Number(a.limit) || 30, 200))).map(
        ({ from, text, ts }) => ({ from, text, at: new Date(ts).toISOString() }),
      ),
  },
  {
    name: "team_post",
    description:
      "Post a message as yourself (markdown). Starting the post with @coworker starts them on it (they answer in the channel); @mentions later in the text don't wake anyone.",
    inputSchema: schema({ channel: str("Channel name."), text: str("Message.") }, ["channel", "text"]),
    target: (a) => `#${String(a.channel)}`,
    run: async (a, ctx) => {
      const m = await post(ctx, String(a.channel), String(a.text ?? ""));
      return `Posted to #${m.channel}.${await wakeMentioned(ctx, m)}`;
    },
  },
];

const DELEGATE_TOOL: CompanyTool = {
  name: "ask_coworker",
  description:
    "Hand a task to a coworker. They start working right away in their own run and post the result in the channel.",
  inputSchema: schema(
    { coworker: str("Coworker id."), task: str("What they should do, with context and what done means."), channel: str("Where they should answer (default: your channel).") },
    ["coworker", "task"],
  ),
  target: (a) => String(a.coworker),
  run: async (a, ctx) => {
    const target = ctx.roster.find((x) => x.id === String(a.coworker));
    if (!target) throw new CompanyRefusal(`No coworker "${String(a.coworker)}". Call team_roster.`);
    if (target.id === ctx.agent.id) throw new CompanyRefusal("You cannot delegate to yourself.");
    if (ctx.depth + 1 > MAX_DELEGATION_DEPTH) {
      throw new CompanyRefusal(`Delegation chain is already ${ctx.depth} deep; finish the work yourself or report back.`);
    }
    const channel = String(a.channel || ctx.channel);
    const task = String(a.task ?? "").trim();
    if (!task) throw new CompanyRefusal("task is empty.");
    await post(ctx, channel, `@${target.id} ${task}`);
    const run = await ctx.startDelegateRun({
      agentId: target.id,
      channel,
      task,
      depth: ctx.depth + 1,
      trigger: "delegate",
      requestedBy: ctx.agent.id,
    });
    if (run.status === "failed") throw new CompanyRefusal(`${target.name} could not start: ${run.error ?? "unknown error"}`);
    return `${target.name} is on it and will post in #${channel}.`;
  },
};

const FILE_TOOLS: CompanyTool[] = [
  {
    name: "files_list",
    description: "List a folder. Paths are relative to your own folder unless absolute (granted folders).",
    inputSchema: schema({ path: str("Folder, default '.'.") }),
    readOnly: true,
    target: pathArg,
    run: (a, ctx) => listFiles(ctx.roots, a.path),
  },
  {
    name: "files_read",
    description: "Read a text file. For big files pass offset/limit (line numbers).",
    inputSchema: schema({ path: str("File path."), offset: num("First line (0-based)."), limit: num("Number of lines.") }, ["path"]),
    readOnly: true,
    target: pathArg,
    run: (a, ctx) => readTextFile(ctx.roots, a.path, a.offset, a.limit),
  },
  {
    name: "files_write",
    description: "Create or overwrite a text file (parent folders are created).",
    inputSchema: schema({ path: str("File path."), content: str("Full file content.") }, ["path", "content"]),
    target: pathArg,
    run: (a, ctx) => writeTextFile(ctx.roots, a.path, a.content),
  },
  {
    name: "files_edit",
    description: "Replace exact text in a file.",
    inputSchema: schema(
      { path: str("File path."), old_text: str("Exact text to find."), new_text: str("Replacement."), replace_all: { type: "boolean" } },
      ["path", "old_text", "new_text"],
    ),
    target: pathArg,
    run: (a, ctx) => editTextFile(ctx.roots, a),
  },
  {
    name: "files_delete",
    description: "Delete a file, or a folder with recursive=true.",
    inputSchema: schema({ path: str("Path."), recursive: { type: "boolean" } }, ["path"]),
    target: pathArg,
    run: (a, ctx) => deletePath(ctx.roots, a.path, a.recursive),
  },
  {
    name: "files_search",
    description: "Find text in files (case-insensitive). Returns path:line: text.",
    inputSchema: schema({ query: str("Text to find."), path: str("Folder to search, default '.'.") }, ["query"]),
    readOnly: true,
    target: (a) => `${String(a.query)} in ${pathArg(a)}`,
    run: (a, ctx) => searchFiles(ctx.roots, a.query, a.path),
  },
];

const shellTool = (name: "shell" | "shell_ask"): CompanyTool => ({
  name,
  description:
    `Run a ${process.platform === "win32" ? "PowerShell" : "sh"} script in your own folder. Use relative paths; anything outside your folders is refused.` +
    (name === "shell_ask" ? " The boss approves each command." : ""),
  inputSchema: schema({ command: str("Script to run."), timeout_sec: num("Default 120, max 1800.") }, ["command"]),
  target: (a) => String(a.command ?? "").slice(0, 300),
  run: (a, ctx) =>
    runShell({ command: a.command, ownFolder: ctx.ownFolder, roots: ctx.roots, timeoutSec: a.timeout_sec }),
});

const MEMORY_TOOLS: CompanyTool[] = [
  {
    name: "memory_read",
    description: "Read your long-term memory (MEMORY.md).",
    inputSchema: schema({}),
    readOnly: true,
    run: async (_a, ctx) => (await ctx.store.readMemory(ctx.agent.id)) || "(empty)",
  },
  {
    name: "memory_append",
    description: "Add a durable fact to your memory: preferences, decisions, where things live.",
    inputSchema: schema({ note: str("One short line.") }, ["note"]),
    run: async (a, ctx) => {
      const current = await ctx.store.readMemory(ctx.agent.id);
      const next = `${current.trimEnd()}\n- ${String(a.note ?? "").trim()}\n`.trimStart();
      if (next.length > MAX_MEMORY_CHARS) throw new CompanyRefusal("Memory is full; rewrite it shorter with memory_write.");
      await ctx.store.writeMemory(ctx.agent.id, next);
      return "Remembered.";
    },
  },
  {
    name: "memory_write",
    description: "Rewrite your whole memory (to reorganize or drop stale lines).",
    inputSchema: schema({ content: str("New MEMORY.md content.") }, ["content"]),
    run: async (a, ctx) => {
      const content = String(a.content ?? "");
      if (content.length > MAX_MEMORY_CHARS) throw new CompanyRefusal(`Memory is limited to ${MAX_MEMORY_CHARS} characters.`);
      await ctx.store.writeMemory(ctx.agent.id, content);
      return "Memory saved.";
    },
  },
];

/** 同事当前能看到的工具：随配置即时变化（每次 tools/list 都重新计算）。 */
export function companyToolsFor(agent: CompanyAgent): CompanyTool[] {
  return [
    ...TEAM_TOOLS,
    ...(agent.delegate ? [DELEGATE_TOOL] : []),
    ...FILE_TOOLS,
    ...(agent.shell === "auto" ? [shellTool("shell")] : agent.shell === "ask" ? [shellTool("shell_ask")] : []),
    ...MEMORY_TOOLS,
  ];
}

/** 免确认的 Gateway 工具（shell_ask 故意不在内：它就是「逐条批准」）。 */
export const COMPANY_AUTO_APPROVED_TOOLS = [
  ...TEAM_TOOLS,
  DELEGATE_TOOL,
  ...FILE_TOOLS,
  shellTool("shell"),
  ...MEMORY_TOOLS,
].map((t) => `mcp__${COMPANY_MCP_SERVER_NAME}__${t.name}`);
