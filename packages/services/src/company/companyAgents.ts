import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  COMPANY_CUSTOM_ICON_RE,
  COMPANY_DEFAULT_DAILY_RUN_LIMIT,
  COMPANY_ICON_IDS,
  COMPANY_RESERVED_IDS,
  companySlug,
  modelSelectionSchema,
  type CompanyAgent,
  type CompanyAgentInput,
  type CompanyAgentIcon,
  type CompanyRoutine,
  type CompanyShellMode,
} from "@zcode/shared";
import { computeNextRunAt } from "../session/automationCron.js";
import { assertChannel } from "./companyStore.js";

const MIN_ROUTINE_GAP_MS = 15 * 60_000;
export const MAX_ENABLED_ROUTINES = 20;

const strings = (v: unknown, max = 100) =>
  Array.isArray(v) ? [...new Set(v.map(String).map((s) => s.trim()).filter(Boolean))].slice(0, max) : [];

function validateRoutine(raw: CompanyRoutine): CompanyRoutine {
  const cron = String(raw.cron ?? "").trim();
  let first: number | null;
  try {
    first = computeNextRunAt(cron);
  } catch {
    throw new Error(`Invalid schedule "${cron}".`);
  }
  const second = first === null ? null : computeNextRunAt(cron, first);
  if (first === null) throw new Error(`Schedule "${cron}" never runs.`);
  if (second !== null && second - first < MIN_ROUTINE_GAP_MS) {
    throw new Error("Routines can run at most every 15 minutes.");
  }
  const task = String(raw.task ?? "").trim();
  if (!task) throw new Error("Every routine needs something to do.");
  return {
    id: raw.id?.trim() || randomUUID(),
    cron,
    task: task.slice(0, 4000),
    channel: assertChannel(String(raw.channel || "general")),
    enabled: raw.enabled !== false,
  };
}

/** UI 提交的同事配置在这里统一校验与归一化（信任边界）。 */
export function normalizeAgent(
  input: CompanyAgentInput,
  existing: CompanyAgent | undefined,
  others: CompanyAgent[],
): CompanyAgent {
  const name = String(input.name ?? "").trim().slice(0, 40);
  if (!name) throw new Error("A coworker needs a name.");
  const id = existing?.id ?? companySlug(name);
  if (!id || COMPANY_RESERVED_IDS.has(id)) throw new Error(`"${name}" can't be used as a coworker name.`);
  if (!existing && others.some((a) => a.id === id)) throw new Error(`A coworker called "${name}" already exists.`);
  const icon: CompanyAgentIcon =
    (COMPANY_ICON_IDS as readonly string[]).includes(input.icon) || COMPANY_CUSTOM_ICON_RE.test(input.icon)
      ? input.icon
      : "orbit";
  const limit = Number(input.dailyRunLimit ?? COMPANY_DEFAULT_DAILY_RUN_LIMIT);
  const shell: CompanyShellMode = input.shell === "auto" || input.shell === "ask" ? input.shell : "off";
  const model = input.model ? modelSelectionSchema.safeParse(input.model) : undefined;
  const folders = (Array.isArray(input.folders) ? input.folders : []).slice(0, 20).map((f) => {
    const path = String(f.path ?? "").trim();
    if (!isAbsolute(path)) throw new Error(`Folder "${path}" must be a full path.`);
    return { path: resolve(path), access: f.access === "write" ? ("write" as const) : ("read" as const) };
  });
  const routines = (Array.isArray(input.routines) ? input.routines : []).slice(0, 20).map(validateRoutine);
  const enabledElsewhere = others
    .filter((a) => a.id !== id)
    .reduce((n, a) => n + a.routines.filter((r) => r.enabled).length, 0);
  if (enabledElsewhere + routines.filter((r) => r.enabled).length > MAX_ENABLED_ROUTINES) {
    throw new Error(`The whole company can have at most ${MAX_ENABLED_ROUTINES} active routines.`);
  }
  const now = Date.now();
  return {
    id,
    name,
    title: String(input.title ?? "").trim().slice(0, 80),
    instructions: String(input.instructions ?? "").slice(0, 20_000),
    icon,
    color: /^#[0-9a-f]{6}$/i.test(String(input.color)) ? String(input.color) : "#8b5cf6",
    ...(model?.success ? { model: model.data } : {}),
    web: input.web === true,
    shell,
    delegate: input.delegate === true,
    dailyRunLimit: Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 0), 1000) : COMPANY_DEFAULT_DAILY_RUN_LIMIT,
    skills: strings(input.skills),
    mcpServers: strings(input.mcpServers),
    folders,
    routines,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** 首次打开 Company 时的三位起步同事；删掉后不会再自动生成。 */
export function starterAgents(): CompanyAgentInput[] {
  const base = { skills: [], mcpServers: [], folders: [], routines: [] };
  return [
    {
      ...base,
      name: "Chief of Staff",
      title: "Runs the team for you",
      icon: "orbit",
      color: "#8b5cf6",
      web: true,
      shell: "off",
      delegate: true,
      instructions:
        "Turn the boss's requests into finished work. Split big requests into clear tasks, hand them to the right coworker with ask_coworker, check what comes back, and report the outcome to the boss. Do small things yourself.",
    },
    {
      ...base,
      name: "Researcher",
      title: "Finds and verifies information",
      icon: "radar",
      color: "#06b6d4",
      web: true,
      shell: "off",
      delegate: false,
      instructions:
        "Find out what is true and say how sure you are. Open primary sources, cross-check what matters, and write short briefs: the answer first, then evidence with links, then what you could not confirm. Save longer reports as markdown files in your folder.",
    },
    {
      ...base,
      name: "Engineer",
      title: "Builds and runs code",
      icon: "gear",
      color: "#22c55e",
      web: true,
      shell: "ask",
      delegate: false,
      instructions:
        "Build things that work and prove it by running them. Keep each project in its own subfolder. Never report something as working until you ran it, and say exactly how to run it.",
    },
  ];
}
