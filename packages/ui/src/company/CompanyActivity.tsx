import { useCallback, useEffect, useState } from "react";
import type { CompanyAuditEntry, CompanyRun, CompanyState } from "@zcode/shared";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { cn } from "@/components/lib/utils.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyAvatar } from "./CompanyAvatar.js";
import { Section, SelectField } from "./CompanyEditorSections.js";

const ALL = "__all__";

const STATUS_STYLE: Record<CompanyRun["status"], string> = {
  running: "bg-emerald-500/15 text-emerald-600",
  "needs-you": "bg-amber-500/15 text-amber-600",
  done: "bg-surface text-foreground-subtle",
  failed: "bg-destructive/15 text-destructive",
};
const STATUS_ID: Record<CompanyRun["status"], string> = {
  running: "company.status.running",
  "needs-you": "company.status.needsYou",
  done: "company.status.done",
  failed: "company.status.failed",
};
const DECISION_STYLE: Record<CompanyAuditEntry["decision"], string> = {
  allowed: "bg-emerald-500/15 text-emerald-600",
  refused: "bg-amber-500/15 text-amber-600",
  failed: "bg-destructive/15 text-destructive",
};

export function CompanyActivity({
  state,
  onOpenRun,
  onRefresh,
}: {
  state: CompanyState;
  onOpenRun(run: CompanyRun): void;
  onRefresh(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { companyService } = useServices();
  const [agentId, setAgentId] = useState(ALL);
  const [audit, setAudit] = useState<CompanyAuditEntry[]>([]);
  const confirm = useConfirmDialog();
  const agents = new Map(state.agents.map((a) => [a.id, a]));

  const load = useCallback(
    () =>
      companyService
        .listAudit({ limit: 300, ...(agentId === ALL ? {} : { agentId }) })
        .then(setAudit)
        .catch(() => undefined),
    [agentId, companyService],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  // 清空当前视图（全部或某位同事）的已结束运行与动作日志；进行中的运行保留。
  const clear = async () => {
    const who = agentId === ALL ? t("company.activity.allAgents") : (agents.get(agentId)?.name ?? agentId);
    const ok = await confirm({
      title: intl.formatMessage({ id: "company.activity.clearTitle" }, { who }),
      description: t("company.activity.clearDescription"),
      confirmVariant: "destructive",
      confirmLabel: t("company.activity.clear"),
    });
    if (!ok) return;
    try {
      await companyService.clearActivity(agentId === ALL ? {} : { agentId });
      await load();
      onRefresh();
      toast(t("company.activity.cleared"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const runs = state.runs.filter((r) => agentId === ALL || r.agentId === agentId);
  const who = (id: string) => {
    const a = agents.get(id);
    return a ? (
      <span className="flex min-w-0 items-center gap-1.5">
        <CompanyAvatar icon={a.icon} color={a.color} size={18} />
        <span className="truncate">{a.name}</span>
      </span>
    ) : (
      <span className="truncate">{id}</span>
    );
  };

  return (
    <div className="flex flex-col gap-3 pb-8">
      <div className="flex items-center gap-2">
        <SelectField
          label={t("company.activity.allAgents")}
          value={agentId}
          onChange={setAgentId}
          options={[{ value: ALL, label: t("company.activity.allAgents") }, ...state.agents.map((a) => ({ value: a.id, label: a.name }))]}
          className="w-full max-w-56"
        />
        <Button
          variant="ghost"
          size="sm"
          data-icon="inline-start"
          className="ml-auto text-foreground-subtle"
          disabled={runs.every((r) => r.status === "running" || r.status === "needs-you") && audit.length === 0}
          onClick={() => void clear()}
        >
          <Trash2 className="size-3.5" />
          {t("company.activity.clear")}
        </Button>
      </div>

      <Section title={t("company.activity.runs")}>
        {runs.length === 0 ? <p className="text-ui-sm text-foreground-subtle">{t("company.activity.noRuns")}</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {runs.slice(0, 50).map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-ui-sm text-foreground md:flex-nowrap">
              <span className="shrink-0 font-medium md:w-40 md:font-normal">{who(run.agentId)}</span>
              <span className="shrink-0 text-foreground-subtle md:w-24">{t(`company.trigger.${run.trigger}`)}</span>
              <span className="min-w-0 max-w-28 shrink truncate text-foreground-subtle md:w-28 md:shrink-0">#{run.channel}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-ui-xs", STATUS_STYLE[run.status])} title={run.error}>
                {t(STATUS_ID[run.status])}
              </span>
              <time className="text-ui-xs text-foreground-subtlest md:ml-auto">{new Date(run.startedAt).toLocaleString()}</time>
              <Button variant="ghost" size="sm" className="ml-auto md:ml-0" disabled={!run.taskId} onClick={() => onOpenRun(run)}>
                {t("company.openTask")}
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("company.activity.audit")} hint={t("company.activity.auditHint")}>
        {audit.length === 0 ? <p className="text-ui-sm text-foreground-subtle">{t("company.activity.noAudit")}</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {audit.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-ui-sm text-foreground md:flex-nowrap" title={e.detail}>
              <time className="shrink-0 text-ui-xs text-foreground-subtlest md:w-36">{new Date(e.ts).toLocaleString()}</time>
              <span className="shrink-0 md:w-36">{who(e.agentId)}</span>
              <span className="shrink-0 font-mono text-ui-xs md:w-28">{e.tool}</span>
              <span className="order-last min-w-0 basis-full truncate font-mono text-ui-xs text-foreground-subtle md:order-none md:basis-auto md:flex-1">{e.target}</span>
              <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-ui-xs md:ml-0", DECISION_STYLE[e.decision])}>
                {t(`company.activity.${e.decision}`)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
