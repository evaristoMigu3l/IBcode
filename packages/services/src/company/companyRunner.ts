import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  COMPANY_DEFAULT_DAILY_RUN_LIMIT,
  formatModelPickerValue,
  type CompanyAgent,
  type CompanyRun,
  type CompanyRunStatus,
  type CompanyRunTrigger,
  type ModelSelection,
  type TraceId,
} from "@zcode/shared";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import type { IWindowControllerService } from "../window-controller/windowController.js";
import { computeNextRunAt } from "../session/automationCron.js";
import { grantedMcpServers } from "./companyConfig.js";
import type { CompanyGateway } from "./companyGateway.js";
import { companyRoots } from "./companyPolicy.js";
import { buildCompanyPrompt } from "./companyPrompt.js";
import type { CompanyStore } from "./companyStore.js";
import { COMPANY_MCP_SERVER_NAME } from "./companyTools.js";

/** 原生文件/命令/编排工具一律关掉：同事只能经 Gateway 触达磁盘。 */
const DENIED_NATIVE_TOOLS = [
  "Bash", "PowerShell", "BashOutput", "KillShell",
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "LS",
  "Agent", "Task", "TaskOutput", "TaskStop", "SendMessage",
  "CronCreate", "CronUpdate", "CronDelete", "CronList", "OffPeakCreate", "OffPeakList",
  "CreateWorkflow", "AmendWorkflow", "EvalWorkflowSnippet", "SaveWorkflow", "ResumeWorkflowRun",
  "mcp__node_repl__js",
];

export function companyToolDenylist(agent: CompanyAgent): string[] {
  return [
    ...DENIED_NATIVE_TOOLS,
    ...(agent.web ? [] : ["WebSearch", "WebFetch", "web_search"]),
    ...(agent.skills.length ? [] : ["Skill"]),
  ];
}

export interface CompanyRunnerDeps {
  store: CompanyStore;
  gateway: CompanyGateway;
  getTaskService(): IZCodeTaskService | undefined;
  getModelSelectionService(): Pick<IModelSelectionService, "getView"> | undefined;
  /** 侧栏同源的任务行实时活动（含待批准/待回答计数）；host 外（测试、web）可缺省。 */
  getWindowController?(): Pick<IWindowControllerService, "listTaskList"> | undefined;
  log(message: string, error?: unknown): void;
}

export interface CompanyStartParams {
  agentId: string;
  channel: string;
  task: string;
  trigger: CompanyRunTrigger;
  depth: number;
  /** 唤醒它的同事（转交/@提及）。 */
  requestedBy?: string;
  /** 这是对 requestedBy 提问的回答。 */
  answering?: boolean;
}

const DAILY_LIMIT_PREFIX = "Daily limit reached";

const ROUTINE_TICK_MS = 60_000;
const ROUTINE_MAX_LATE_MS = 60 * 60_000;
/** 刚建的 task 在首条 prompt 之前可能短暂显示为 idle，宽限后才按 completed 结算。 */
const STATUS_GRACE_MS = 20_000;
const MISSING_TASK_GRACE_MS = 2 * 60_000;
/** 上次运行遗留且始终没有终态的 run，6 小时后不再显示为「工作中」。 */
const ORPHAN_MAX_MS = 6 * 60 * 60_000;

export class CompanyRunner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly tracked = new Map<string, () => void>();

  constructor(private readonly deps: CompanyRunnerDeps) {}

  async start(params: CompanyStartParams): Promise<CompanyRun> {
    const { store, gateway } = this.deps;
    const agent = await store.getAgent(params.agentId);
    if (!agent) throw new Error(`No coworker "${params.agentId}".`);
    const ownFolder = store.workspaceOf(agent.id);
    await mkdir(ownFolder, { recursive: true });
    const limited = await this.overDailyLimit(agent, params);
    if (limited) return limited;
    const run: CompanyRun = {
      id: randomUUID(),
      agentId: agent.id,
      channel: params.channel,
      trigger: params.trigger,
      depth: params.depth,
      ...(params.requestedBy ? { requestedBy: params.requestedBy } : {}),
      workspacePath: ownFolder,
      status: "running",
      startedAt: Date.now(),
    };
    await store.updateRuns((runs) => [run, ...runs]);
    try {
      const taskService = this.deps.getTaskService();
      const modelService = this.deps.getModelSelectionService();
      if (!taskService || !modelService) throw new Error("ZCode is still starting; try again in a moment.");
      const selection = await resolveSelection(modelService, agent.model);
      const endpoint = gateway.register({
        runId: run.id,
        agentId: agent.id,
        depth: params.depth,
        channel: params.channel,
        ...(params.requestedBy ? { requestedBy: params.requestedBy } : {}),
        ...(params.answering ? { answering: true } : {}),
      });
      const [roster, memory, recent, granted] = await Promise.all([
        store.listAgents(),
        store.readMemory(agent.id),
        store.readMessages(params.channel, 0, 12),
        grantedMcpServers(agent.mcpServers),
      ]);
      const task = await taskService.createTask({
        workspacePath: ownFolder,
        model: formatModelPickerValue(selection),
        thoughtLevel: selection.options?.reasoningLevel,
        // 修复原因：新建空 session 后立即 sendText，session_input 外键要求 session 主记录先落库；
        // 与 automation/闲时任务一致，交给首条 V4 admission 统一持久化，否则必现 FOREIGN KEY constraint failed。
        deferPersistenceUntilFirstPrompt: true,
        mcpServers: [
          {
            name: COMPANY_MCP_SERVER_NAME,
            type: "http",
            url: endpoint.url,
            headers: [{ name: "Authorization", value: endpoint.authorization }],
            timeoutMs: 1_900_000,
          },
          ...granted,
        ],
      });
      await store.updateRuns((runs) => runs.map((r) => (r.id === run.id ? { ...r, taskId: task.taskId } : r)));
      // 与定时任务一致：首条 prompt 用独立的 run id 作为 inputId，终态事件按它精确匹配。
      const traceId = run.id as TraceId;
      this.track(run.id, taskService, task.taskId, traceId);
      await taskService.sendPrompt({
        taskId: task.taskId,
        traceId,
        content: buildCompanyPrompt({
          agent,
          roster,
          roots: companyRoots(agent, ownFolder),
          memory,
          channel: params.channel,
          recent,
          task: params.task,
          trigger: params.trigger,
          requestedBy: params.requestedBy,
          answering: params.answering,
        }),
        clientMode: "desktop-continuous",
        toolDenylist: companyToolDenylist(agent),
      });
      // 侧栏标题默认取首条 prompt 开头（<company-context>…），改成「同事 · 任务」便于辨认。
      const title = `${agent.name} · ${params.task.replace(/\s+/g, " ").trim()}`.slice(0, 80);
      void taskService
        .renameTask({ taskId: task.taskId, workspacePath: ownFolder, title })
        .catch((e) => this.deps.log(`company run rename failed agent=${agent.id}`, e));
      return { ...run, taskId: task.taskId };
    } catch (error) {
      this.tracked.get(run.id)?.();
      const message = String((error as Error)?.message ?? error);
      this.deps.log(`company run failed agent=${agent.id}`, error);
      await store.updateRuns((runs) =>
        runs.map((r) => (r.id === run.id ? { ...r, status: "failed", endedAt: Date.now(), error: message } : r)),
      );
      await store.appendMessage({
        id: randomUUID(),
        ts: Date.now(),
        channel: params.channel,
        from: "system",
        text: `${agent.name} could not start: ${message}`,
        runId: run.id,
      });
      return { ...run, status: "failed", error: message };
    }
  }

  /**
   * 你不在时的护栏：例行任务与同事唤醒（非老板消息）每天最多 dailyRunLimit 次。
   * 超限时记一条失败 run；当天第一次超限才在频道里发提示，避免刷屏。
   */
  private async overDailyLimit(agent: CompanyAgent, params: CompanyStartParams): Promise<CompanyRun | undefined> {
    if (params.trigger === "message") return undefined;
    const limit = agent.dailyRunLimit ?? COMPANY_DEFAULT_DAILY_RUN_LIMIT;
    const { ok, notify } = await this.deps.store.claimDailyRun(agent.id, limit);
    if (ok) return undefined;
    const error = `${DAILY_LIMIT_PREFIX}: ${agent.name} can be started by routines and coworkers ${limit} times a day.`;
    const run: CompanyRun = {
      id: randomUUID(),
      agentId: agent.id,
      channel: params.channel,
      trigger: params.trigger,
      depth: params.depth,
      ...(params.requestedBy ? { requestedBy: params.requestedBy } : {}),
      workspacePath: this.deps.store.workspaceOf(agent.id),
      status: "failed",
      startedAt: Date.now(),
      endedAt: Date.now(),
      error,
    };
    await this.deps.store.updateRuns((runs) => [run, ...runs]);
    if (notify) {
      await this.deps.store.appendMessage({
        id: randomUUID(),
        ts: Date.now(),
        channel: params.channel,
        from: "system",
        text: `${error} It works again tomorrow, or right away when you message it. Change the limit in Team → ${agent.name}.`,
        runId: run.id,
      });
    }
    return run;
  }

  /** 只改仍在进行中的 run；终态（done/failed）永远不会被迟到的事件或过期快照改回去。 */
  private setStatus(runId: string, status: CompanyRunStatus, error?: string): Promise<CompanyRun[]> {
    const terminal = status === "done" || status === "failed";
    return this.deps.store.updateRuns((runs) =>
      runs.map((r) =>
        r.id === runId && (r.status === "running" || r.status === "needs-you")
          ? { ...r, status, ...(terminal ? { endedAt: Date.now() } : {}), ...(error ? { error } : {}) }
          : r,
      ),
    );
  }

  /**
   * 实时跟踪本进程派发的 run 的终态：task 的 terminal outcome（与定时任务同一权威来源，按 inputId
   * 精确匹配本次派发）。「等你处理」见 refreshNeedsYou。
   */
  private track(runId: string, taskService: IZCodeTaskService, taskId: string, traceId: string): void {
    const terminal = taskService.onDynamicTaskTerminalOutcome(taskId)((o) => {
      if (o.inputId && o.inputId !== traceId) return;
      void this.setStatus(runId, o.outcome === "succeeded" ? "done" : "failed", o.outcome === "stopped" ? "Stopped." : o.error);
      dispose();
    });
    const dispose = () => {
      terminal.dispose();
      this.tracked.delete(runId);
    };
    this.tracked.set(runId, dispose);
  }

  /**
   * 实时状态以侧栏同源的任务行活动为准：会话 phase 给出完成/失败/被打断；有待批准的权限或待回答的
   * 问题就是 needs-you，处理完回到 running。task 的流事件只在有人观看时才转发，后台拿不到，所以不能用它。
   */
  private async refreshNeedsYou(runs: CompanyRun[]): Promise<CompanyRun[]> {
    const active = runs.filter((r) => r.taskId && (r.status === "running" || r.status === "needs-you"));
    const controller = this.deps.getWindowController?.();
    if (!active.length || !controller) return runs;
    const result = await controller
      .listTaskList({
        kind: "active",
        sortBy: "updated",
        workspaceScopes: [...new Set(active.map((r) => r.workspacePath))].map((workspacePath) => ({ workspacePath })),
      })
      .catch(() => undefined);
    if (!result) return runs;
    // 会话已结束（含 app 中途退出被打断的）直接结算；仍在进行时按待处理交互切换 needs-you/running。
    const live = new Map(
      result.items.map((item) => {
        const p = item.activity?.pendingInteractions;
        const phase = item.activity?.phase;
        const status: CompanyRunStatus =
          phase === "completedSuccess"
            ? "done"
            : phase === "error" || phase === "completedInterrupted"
              ? "failed"
              : (p?.permissionCount ?? 0) + (p?.userInputCount ?? 0) > 0
                ? "needs-you"
                : "running";
        return [item.taskId, { status, interrupted: phase === "completedInterrupted" }] as const;
      }),
    );
    let latest = runs;
    for (const r of active) {
      const next = live.get(r.taskId!);
      if (!next || next.status === r.status) continue;
      // 刚建的会话短暂处于上一态，宽限期内不按「已完成」结算。
      if (next.status === "done" && Date.now() - r.startedAt < STATUS_GRACE_MS) continue;
      latest = await this.setStatus(r.id, next.status, next.interrupted ? "Interrupted." : undefined);
    }
    return latest;
  }

  /**
   * 兜底：上次 app 运行时留下、本进程没有实时订阅的 run。tasks-index 的 status 可能残留 running，
   * 所以只采信终态；找不到 task 或长时间无结果的一律结算，避免永远显示「工作中」。
   */
  async refreshStatuses(): Promise<CompanyRun[]> {
    const { store } = this.deps;
    const runs = await this.refreshNeedsYou(await store.readRuns());
    const orphans = runs.filter(
      (r) => (r.status === "running" || r.status === "needs-you") && !this.tracked.has(r.id),
    );
    const taskService = this.deps.getTaskService();
    if (!orphans.length || !taskService) return runs;
    const byWorkspace = new Map<string, Map<string, string | undefined>>();
    for (const path of new Set(orphans.map((r) => r.workspacePath))) {
      const tasks = await taskService.listTasks({ workspacePath: path }).catch(() => []);
      byWorkspace.set(path, new Map(tasks.map((t) => [t.taskId, t.status])));
    }
    const now = Date.now();
    const next = (r: CompanyRun): CompanyRunStatus | undefined => {
      if (r.status !== "running" && r.status !== "needs-you") return undefined;
      if (this.tracked.has(r.id)) return undefined;
      // 记录了启动错误的 run 必然失败（旧版刷新逻辑曾把它们改回 running，这里顺带修复）。
      if (r.error) return "failed";
      const tasks = byWorkspace.get(r.workspacePath);
      if (!tasks) return undefined;
      const status = tasks.get(r.taskId ?? "");
      if (status === "error") return "failed";
      if (status === "completed" && now - r.startedAt > STATUS_GRACE_MS) return "done";
      if (!tasks.has(r.taskId ?? "")) return now - r.startedAt > MISSING_TASK_GRACE_MS ? "failed" : undefined;
      return now - r.startedAt > ORPHAN_MAX_MS ? "done" : undefined;
    };
    if (!orphans.some((r) => next(r))) return runs;
    return store.updateRuns((all) =>
      all.map((r) => {
        const status = next(r);
        if (!status) return r;
        return { ...r, status, ...(status === "done" || status === "failed" ? { endedAt: now } : {}) };
      }),
    );
  }

  startRoutines(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tickRoutines().catch((e) => this.deps.log("routine tick failed", e)), ROUTINE_TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tickRoutines(now = Date.now()): Promise<void> {
    const { store } = this.deps;
    const agents = await store.listAgents();
    const state = await store.readRoutineState();
    const next: typeof state = {};
    for (const agent of agents) {
      for (const routine of agent.routines.filter((r) => r.enabled)) {
        // cron 改了 key 就变，旧的下次时间自然作废。
        const key = `${routine.id}:${routine.cron}`;
        const due = state[key]?.nextRunAt;
        const upcoming = computeNextRunAt(routine.cron, now) ?? Number.MAX_SAFE_INTEGER;
        if (due === undefined || now < due) {
          next[key] = { nextRunAt: due ?? upcoming };
          continue;
        }
        next[key] = { nextRunAt: upcoming };
        // App 关着时错过的触发不补跑一大串，只跑最近一小时内到期的那次。
        if (now - due > ROUTINE_MAX_LATE_MS) continue;
        if (await store.claimRoutineSlot(routine.id, due)) {
          void this.start({ agentId: agent.id, channel: routine.channel, task: routine.task, trigger: "routine", depth: 0 });
        }
      }
    }
    await store.writeRoutineState(next);
    await pruneLocks(join(store.home, "locks"), now);
  }
}

async function resolveSelection(
  service: Pick<IModelSelectionService, "getView">,
  model: ModelSelection | undefined,
): Promise<ModelSelection> {
  if (model) {
    const view = await service.getView({ selection: model });
    if (view.effectiveSelection && !view.selectionIssue) return view.effectiveSelection;
  }
  const preferred = (await service.getView()).preferredSelection;
  if (!preferred) throw new Error("ZCode has no model available. Sign in to your model provider (or add one in Settings → Model Provider), then try again.");
  return preferred;
}

async function pruneLocks(dir: string, now: number): Promise<void> {
  for (const name of await readdir(dir).catch(() => [])) {
    const full = join(dir, name);
    const age = now - (await stat(full).then((s) => s.mtimeMs, () => now));
    if (age > 2 * 24 * 60 * 60_000) await rm(full, { recursive: true, force: true });
  }
}
