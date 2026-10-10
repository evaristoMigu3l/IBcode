import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CompanyAgent,
  CompanyAuditEntry,
  CompanyCustomIcon,
  CompanyMessage,
  CompanyRun,
} from "@zcode/shared";

const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,60}$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_RUNS = 200;
const AUDIT_ROTATE_BYTES = 5 * 1024 * 1024;
const MEMORY_FILE = "MEMORY.md";

export function companyHome(): string {
  return process.env.ZCODE_COMPANY_HOME?.trim() || join(homedir(), ".zcode", "company");
}

export function assertCompanyId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Invalid coworker id: ${JSON.stringify(id)}`);
  return id;
}

export function assertChannel(channel: string): string {
  if (!CHANNEL_RE.test(channel)) throw new Error(`Invalid channel: ${JSON.stringify(channel)}`);
  return channel;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** 先写临时文件再 rename，进程中断时不会留下半截 JSON。 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
}

function parseJsonLines<T>(text: string): T[] {
  return text.split("\n").flatMap((line) => {
    if (!line) return [];
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });
}

export class CompanyStore {
  /** runs.json 是读改写；同一 host 内串行化，避免并发唤醒互相覆盖。 */
  private runsChain: Promise<unknown> = Promise.resolve();

  constructor(readonly home: string = companyHome()) {}

  workspaceOf(id: string): string {
    return join(this.home, "workspaces", assertCompanyId(id));
  }

  async ensureLayout(): Promise<void> {
    for (const dir of ["agents", "workspaces", "channels", "locks"]) {
      await mkdir(join(this.home, dir), { recursive: true });
    }
  }

  // ---------- agents ----------

  async listAgents(): Promise<CompanyAgent[]> {
    let files: string[] = [];
    try {
      files = (await readdir(join(this.home, "agents"))).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const agents = await Promise.all(
      files.map((f) => readJson<CompanyAgent | null>(join(this.home, "agents", f), null)),
    );
    return agents
      .filter((a): a is CompanyAgent => Boolean(a && ID_RE.test(a.id)))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getAgent(id: string): Promise<CompanyAgent | undefined> {
    return (
      (await readJson<CompanyAgent | null>(
        join(this.home, "agents", `${assertCompanyId(id)}.json`),
        null,
      )) ?? undefined
    );
  }

  async writeAgent(agent: CompanyAgent): Promise<void> {
    await this.ensureLayout();
    await mkdir(this.workspaceOf(agent.id), { recursive: true });
    await writeJsonAtomic(join(this.home, "agents", `${assertCompanyId(agent.id)}.json`), agent);
  }

  /** 只删配置；同事文件夹里的工作成果保留，避免误删数据。 */
  async removeAgent(id: string): Promise<void> {
    await rm(join(this.home, "agents", `${assertCompanyId(id)}.json`), { force: true });
  }

  // ---------- channels ----------
  // ponytail: 每次读取都解析整个频道文件；几万条消息内足够，再大就按偏移量增量读取或换 node:sqlite。

  async appendMessage(message: CompanyMessage): Promise<void> {
    await this.ensureLayout();
    await appendFile(
      join(this.home, "channels", `${assertChannel(message.channel)}.jsonl`),
      `${JSON.stringify(message)}\n`,
      "utf8",
    );
  }

  async readMessages(channel: string, since = 0, limit = 200): Promise<CompanyMessage[]> {
    let text = "";
    try {
      text = await readFile(join(this.home, "channels", `${assertChannel(channel)}.jsonl`), "utf8");
    } catch {
      return [];
    }
    return parseJsonLines<CompanyMessage>(text)
      .filter((m) => m.ts > since)
      .slice(-limit);
  }

  /** 清空频道：删掉整个频道文件（不影响同事的文件、记忆与运行记录）。 */
  async clearChannel(channel: string): Promise<void> {
    await rm(join(this.home, "channels", `${assertChannel(channel)}.jsonl`), { force: true });
  }

  async listChannels(): Promise<string[]> {
    try {
      return (await readdir(join(this.home, "channels")))
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.slice(0, -".jsonl".length));
    } catch {
      return [];
    }
  }

  // ---------- runs ----------

  async readRuns(): Promise<CompanyRun[]> {
    return readJson<CompanyRun[]>(join(this.home, "runs.json"), []);
  }

  updateRuns(mutate: (runs: CompanyRun[]) => CompanyRun[] | void): Promise<CompanyRun[]> {
    const next = this.runsChain.then(async () => {
      await this.ensureLayout();
      const runs = await this.readRuns();
      const updated = (mutate(runs) ?? runs).slice(0, MAX_RUNS);
      await writeJsonAtomic(join(this.home, "runs.json"), updated);
      return updated;
    });
    this.runsChain = next.catch(() => undefined);
    return next;
  }

  // ---------- audit ----------

  async appendAudit(entry: CompanyAuditEntry): Promise<void> {
    await this.ensureLayout();
    const path = join(this.home, "audit.jsonl");
    try {
      if ((await stat(path)).size > AUDIT_ROTATE_BYTES) await rename(path, `${path}.1`);
    } catch {
      // 文件还不存在。
    }
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async readAudit(limit = 200, agentId?: string): Promise<CompanyAuditEntry[]> {
    let text = "";
    try {
      text = await readFile(join(this.home, "audit.jsonl"), "utf8");
    } catch {
      return [];
    }
    return parseJsonLines<CompanyAuditEntry>(text)
      .filter((e) => !agentId || e.agentId === agentId)
      .slice(-limit)
      .reverse();
  }

  // ---------- memory ----------

  async readMemory(id: string): Promise<string> {
    try {
      return await readFile(join(this.workspaceOf(id), MEMORY_FILE), "utf8");
    } catch {
      return "";
    }
  }

  async writeMemory(id: string, text: string): Promise<void> {
    await mkdir(this.workspaceOf(id), { recursive: true });
    await writeFile(join(this.workspaceOf(id), MEMORY_FILE), text, "utf8");
  }

  // ---------- icon library ----------
  // 按内容寻址：同一个 SVG 只存一份；index.json 记名字与上传时间。

  private iconIndexPath(): string {
    return join(this.home, "icons", "index.json");
  }

  async listIcons(): Promise<CompanyCustomIcon[]> {
    const index = await readJson<Record<string, { name: string; createdAt: number }>>(this.iconIndexPath(), {});
    const icons = await Promise.all(
      Object.entries(index)
        .sort(([, a], [, b]) => a.createdAt - b.createdAt)
        .map(async ([hex, meta]) => {
          try {
            const svg = await readFile(join(this.home, "icons", `${hex}.svg`), "utf8");
            return { id: `custom:${hex}`, name: meta.name, svg };
          } catch {
            return null;
          }
        }),
    );
    return icons.filter((i): i is CompanyCustomIcon => i !== null);
  }

  async addIcon(name: string, svg: string): Promise<CompanyCustomIcon> {
    const hex = createHash("sha256").update(svg).digest("hex").slice(0, 16);
    await mkdir(join(this.home, "icons"), { recursive: true });
    await writeFile(join(this.home, "icons", `${hex}.svg`), svg, "utf8");
    const index = await readJson<Record<string, { name: string; createdAt: number }>>(this.iconIndexPath(), {});
    index[hex] = { name, createdAt: index[hex]?.createdAt ?? Date.now() };
    await writeJsonAtomic(this.iconIndexPath(), index);
    return { id: `custom:${hex}`, name, svg };
  }

  async hasIcon(id: string): Promise<boolean> {
    const hex = id.replace(/^custom:/, "");
    const index = await readJson<Record<string, unknown>>(this.iconIndexPath(), {});
    return /^[a-f0-9]{16}$/.test(hex) && hex in index;
  }

  async removeIcon(id: string): Promise<void> {
    const hex = id.replace(/^custom:/, "");
    if (!/^[a-f0-9]{16}$/.test(hex)) throw new Error("Invalid icon id.");
    const index = await readJson<Record<string, unknown>>(this.iconIndexPath(), {});
    delete index[hex];
    await writeJsonAtomic(this.iconIndexPath(), index);
    await rm(join(this.home, "icons", `${hex}.svg`), { force: true });
  }

  // ---------- inbox cursors ----------

  async readCursor(agentId: string): Promise<number> {
    const cursors = await readJson<Record<string, number>>(join(this.home, "cursors.json"), {});
    return cursors[agentId] ?? 0;
  }

  async writeCursor(agentId: string, ts: number): Promise<void> {
    await this.ensureLayout();
    const path = join(this.home, "cursors.json");
    const cursors = await readJson<Record<string, number>>(path, {});
    await writeJsonAtomic(path, { ...cursors, [agentId]: ts });
  }

  // ---------- routines ----------

  async readRoutineState(): Promise<Record<string, { nextRunAt: number }>> {
    return readJson(join(this.home, "routine-state.json"), {});
  }

  async writeRoutineState(state: Record<string, { nextRunAt: number }>): Promise<void> {
    await this.ensureLayout();
    await writeJsonAtomic(join(this.home, "routine-state.json"), state);
  }

  /**
   * 多个窗口各有一个 host，都会跑例行任务计时器；用原子 mkdir 抢占「例行任务 + 时间槽」，
   * 保证同一时刻只触发一次。
   */
  async claimRoutineSlot(routineId: string, slot: number): Promise<boolean> {
    await this.ensureLayout();
    try {
      await mkdir(join(this.home, "locks", `${routineId}-${slot}`));
      return true;
    } catch {
      return false;
    }
  }
}
