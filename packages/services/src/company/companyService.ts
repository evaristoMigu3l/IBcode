import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  companyAddressedMentions,
  companyDmChannel,
  type CompanyAgent,
  type CompanyMessage,
  type CompanyState,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import type { ICompanyService } from "./company.js";
import { normalizeAgent, starterAgents } from "./companyAgents.js";
import { ensureCompanyPermissions, listMcpServerNames, listSkillNames } from "./companyConfig.js";
import { deleteAgentFile, listAgentFiles, previewAgentFile } from "./companyFileBrowser.js";
import { CompanyGateway } from "./companyGateway.js";
import { CompanyIconLibrary } from "./companyIconLibrary.js";
import { CompanyRunner, type CompanyRunnerDeps } from "./companyRunner.js";
import { assertChannel, assertCompanyId, CompanyStore } from "./companyStore.js";

const MAX_ICON_BYTES = 256 * 1024;
const MAX_MEDIA_ICON_BYTES = 4 * 1024 * 1024;

export interface CreateCompanyServiceOptions {
  getTaskService(): IZCodeTaskService | undefined;
  getModelSelectionService(): Pick<IModelSelectionService, "getView"> | undefined;
  getWindowController?: CompanyRunnerDeps["getWindowController"];
  store?: CompanyStore;
  /** 测试里关掉例行任务计时器。 */
  routines?: boolean;
}

// 网关 server 与例行任务计时器都已 unref，不阻止进程退出，因此不暴露 dispose（整个对象会被代理给 renderer）。
export function createCompanyService(options: CreateCompanyServiceOptions): ICompanyService {
  const logger = createServiceLogger("company");
  const log = (message: string, error?: unknown) => logger.warn(undefined, message, error);
  const store = options.store ?? new CompanyStore();
  const icons = new CompanyIconLibrary(store.home);
  let runner: CompanyRunner;
  const gateway = new CompanyGateway({
    store,
    startDelegateRun: (p) => runner.start(p),
  });
  runner = new CompanyRunner({
    store,
    gateway,
    getTaskService: options.getTaskService,
    getModelSelectionService: options.getModelSelectionService,
    getWindowController: options.getWindowController,
    log,
  });

  // 启动只做一次：网关端口、权限白名单、起步同事；失败不影响 app 其他功能。
  const ready = (async () => {
    await store.ensureLayout();
    await gateway.start();
    await ensureCompanyPermissions().catch((e) => log("company permission sync failed", e));
    const marker = join(store.home, ".seeded");
    if (!existsSync(marker)) {
      const existing = await store.listAgents();
      if (existing.length === 0) {
        for (const input of starterAgents()) {
          await store.writeAgent(normalizeAgent(input, undefined, await store.listAgents()));
        }
      }
      await writeFile(marker, new Date().toISOString(), "utf8");
    }
    if (options.routines !== false) runner.startRoutines();
  })();
  ready.catch((e) => log("company startup failed", e));

  const appendMessage = async (channel: string, from: string, text: string) => {
    const body = text.trim();
    if (!body) throw new Error("Message is empty.");
    const message: CompanyMessage = {
      id: randomUUID(),
      ts: Date.now(),
      channel: assertChannel(channel),
      from,
      text: body.slice(0, 20_000),
    };
    await store.appendMessage(message);
    return message;
  };

  const requireAgent = async (id: string): Promise<CompanyAgent> => {
    const agent = await store.getAgent(assertCompanyId(id));
    if (!agent) throw new Error(`No coworker "${id}".`);
    return agent;
  };

  return {
    async getState(): Promise<CompanyState> {
      await ready;
      const [agents, channels, runs] = await Promise.all([
        store.listAgents(),
        store.listChannels(),
        runner.refreshStatuses(),
      ]);
      const ordered = [
        "general",
        ...agents.map((a) => companyDmChannel(a.id)),
        ...channels.filter((c) => c !== "general" && !c.startsWith("dm-")),
      ];
      return {
        home: store.home,
        folders: Object.fromEntries(agents.map((a) => [a.id, store.workspaceOf(a.id)])),
        agents,
        channels: [...new Set(ordered)],
        runs: runs.slice(0, 100),
      };
    },

    async getCapabilities() {
      const [mcpServers, skills] = await Promise.all([listMcpServerNames(), listSkillNames()]);
      return { mcpServers, skills };
    },

    async listMessages({ channel, since }) {
      return store.readMessages(assertChannel(channel), since ?? 0, 300);
    },

    async post({ channel, text }) {
      await ready;
      const message = await appendMessage(channel, "boss", text);
      const agents = await store.listAgents();
      const dmTarget = agents.find((a) => companyDmChannel(a.id) === message.channel)?.id;
      const targets = [
        ...new Set([...(dmTarget ? [dmTarget] : []), ...companyAddressedMentions(message.text, agents.map((a) => a.id))]),
      ];
      await Promise.all(
        targets.map((agentId) =>
          runner.start({ agentId, channel: message.channel, task: message.text, trigger: "message", depth: 0 }),
        ),
      );
      return { message, woke: targets };
    },

    async clearChannel({ channel }) {
      await store.clearChannel(assertChannel(channel));
    },

    async saveAgent(input) {
      await ready;
      const all = await store.listAgents();
      const existing = input.id ? all.find((a) => a.id === input.id) : undefined;
      if (input.id && !existing) throw new Error(`No coworker "${input.id}".`);
      const agent = normalizeAgent(input, existing, all);
      if (agent.icon.startsWith("custom:") && !(await icons.has(agent.icon))) {
        throw new Error("That icon is no longer in your icon library.");
      }
      await store.writeAgent(agent);
      return agent;
    },

    async deleteAgent({ id }) {
      await requireAgent(id);
      await store.removeAgent(id);
    },

    async readMemory({ id }) {
      await requireAgent(id);
      return store.readMemory(id);
    },

    async writeMemory({ id, text }) {
      await requireAgent(id);
      if (text.length > 32_000) throw new Error("Memory is limited to 32,000 characters.");
      await store.writeMemory(id, text);
    },

    async listAudit({ limit, agentId }) {
      return store.readAudit(Math.min(limit ?? 200, 1000), agentId);
    },

    async clearActivity({ agentId }) {
      if (agentId) assertCompanyId(agentId);
      await store.updateRuns((runs) =>
        runs.filter(
          (r) => !((r.status === "done" || r.status === "failed") && (!agentId || r.agentId === agentId)),
        ),
      );
      await store.clearAudit(agentId);
    },

    async runRoutineNow({ agentId, routineId }) {
      await ready;
      const agent = await requireAgent(agentId);
      const routine = agent.routines.find((r) => r.id === routineId);
      if (!routine) throw new Error("Routine not found.");
      await runner.start({ agentId, channel: routine.channel, task: routine.task, trigger: "routine", depth: 0 });
    },

    async listFiles({ agentId, path }) {
      await requireAgent(agentId);
      return listAgentFiles(store.workspaceOf(agentId), path);
    },

    async previewFile({ agentId, path }) {
      await requireAgent(agentId);
      return previewAgentFile(store.workspaceOf(agentId), path);
    },

    async deleteFile({ agentId, path }) {
      await requireAgent(agentId);
      await deleteAgentFile(store.workspaceOf(agentId), path);
    },

    async listIcons() {
      return icons.list();
    },

    async addIcon({ name, svg }) {
      const markup = String(svg ?? "").trim();
      if (markup.length > MAX_ICON_BYTES) throw new Error("SVG icons can be at most 256 KB.");
      if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(markup)) {
        throw new Error("That file isn't an SVG.");
      }
      const label = String(name ?? "").trim().slice(0, 40) || "Icon";
      return icons.addSvg(label, markup);
    },

    async addMediaIcon({ name, mime, base64 }) {
      const data = Buffer.from(String(base64 ?? ""), "base64");
      if (data.length > MAX_MEDIA_ICON_BYTES) throw new Error("Animated icons can be at most 4 MB.");
      const label = String(name ?? "").trim().slice(0, 40) || "Icon";
      return icons.addMedia(label, String(mime ?? ""), data);
    },

    async deleteIcon({ id }) {
      const users = (await store.listAgents()).filter((a) => a.icon === id).map((a) => a.name);
      if (users.length) throw new Error(`Still used by ${users.join(", ")}. Give them another icon first.`);
      await icons.remove(id);
    },
  };
}
