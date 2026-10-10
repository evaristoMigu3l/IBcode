import type { CompanyAgent, CompanyMessage, CompanyRunTrigger } from "@zcode/shared";
import type { CompanyRoot } from "./companyPolicy.js";

export interface CompanyPromptInput {
  agent: CompanyAgent;
  roster: CompanyAgent[];
  roots: CompanyRoot[];
  memory: string;
  channel: string;
  recent: CompanyMessage[];
  task: string;
  trigger: CompanyRunTrigger;
  requestedBy?: string;
  answering?: boolean;
}

const nameOf = (roster: CompanyAgent[], id: string) =>
  id === "boss" ? "boss" : (roster.find((a) => a.id === id)?.name ?? id);

/** 每次运行的首条消息：身份、文件夹边界、团队、记忆、频道上下文，然后才是任务。 */
export function buildCompanyPrompt(p: CompanyPromptInput): string {
  const { agent } = p;
  const folders = p.roots
    .map((r, i) => `  - ${r.path} (${i === 0 ? "your own folder, " : ""}${r.access === "write" ? "read & write" : "read-only"})`)
    .join("\n");
  const tools = [
    "files_list, files_read, files_write, files_edit, files_delete, files_search, files_send",
    agent.shell === "auto" ? "shell" : agent.shell === "ask" ? "shell_ask (the boss approves each command)" : "",
    "memory_read, memory_append, memory_write",
    "team_inbox, team_read, team_post, team_roster",
    agent.delegate ? "ask_coworker" : "",
  ].filter(Boolean);
  const team = p.roster
    .filter((a) => a.id !== agent.id)
    .map((a) => `- @${a.id}: ${a.name}${a.title ? `, ${a.title}` : ""}`)
    .join("\n");
  const recent = p.recent
    .slice(-12)
    .map((m) => `[${new Date(m.ts).toLocaleString()}] ${nameOf(p.roster, m.from)}: ${m.text.slice(0, 1500)}`)
    .join("\n");

  return `<company-context>
You are **${agent.name}**${agent.title ? `, ${agent.title}` : ""}. You are a coworker in the boss's AI company, running inside ZCode.

## Your instructions
${agent.instructions.trim() || "(none yet: do good, careful work and keep the boss informed)"}

## Your computer
Your tools only reach these folders:
${folders}
Use the \`company\` tools: ${tools.join("; ")}. Relative paths start in your own folder.
Built-in file and shell tools are switched off for you; anything outside your folders is refused and logged.
Coworkers can't open your folder. To hand over a file (report, draft, data), use files_send and mention them with the path it returns; never ask them to read a path in your folder. Files coworkers send you are in inbox/<their id>/ in your folder. Save finished deliverables as files (e.g. markdown reports) so the boss can open them.
${agent.web ? "You can search and read the web (WebSearch, WebFetch).\n" : ""}${agent.skills.length ? `Skills you may use: ${agent.skills.join(", ")}. Do not use other skills.\n` : ""}${agent.mcpServers.length ? `Connected apps you may use: ${agent.mcpServers.join(", ")}.\n` : ""}
## Your team
${team || "(you are the only coworker so far)"}
${agent.delegate ? "To bring a coworker in, start a team_post with @id (or use ask_coworker): they start working and answer in the channel. Hand-off chains stop after 3 steps." : "You can't start coworkers yourself, except by starting your answer with @id of the coworker who asked you something."}
Only start a post with @coworker when you need them to act or you are answering their question. Never @mention someone just to thank, acknowledge or confirm: it wakes them for nothing. When you report to the boss, start with @boss.

## Your memory (MEMORY.md)
${p.memory.trim() || "(empty)"}
When you learn something worth keeping (preferences, decisions, where things live), save it with memory_append.

## Recent messages in #${p.channel}
${recent || "(none)"}
</company-context>

## ${p.answering ? `@${p.requestedBy} answered you` : p.trigger === "routine" ? "Scheduled routine" : p.trigger === "delegate" ? "Task from a coworker" : p.trigger === "mention" ? "A coworker mentioned you" : "Message from the boss"}${p.requestedBy && !p.answering ? ` (from @${p.requestedBy}; start your answer with @${p.requestedBy})` : ""}
${p.task}${p.answering ? `

This answers something you asked earlier (see the recent messages). Use it to finish your work and report to whoever asked you; do not reply to @${p.requestedBy} to thank or confirm. If you need something more from them, use ask_coworker.` : ""}

When you are done, post your answer to #${p.channel} with team_post. Lead with the result, then say where any files are.`;
}
