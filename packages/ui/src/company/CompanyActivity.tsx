import { useEffect, useState } from "react";
import type { CompanyAuditEntry, CompanyRun, CompanyState } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
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

export function CompanyActivity({ state, onOpenRun }: { state: CompanyState; onOpenRun(run: CompanyRun): void }) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { companyService } = useServices();
  const [agentId, setAgentId] = useState(ALL);
  const [audit, setAudit] = useState<CompanyAuditEntry[]>([]);
  const agents = new Map(state.agents.map((a) => [a.id, a]));

  useEffect(() => {
    const load = () =>
      void companyService
        .listAudit({ limit: 300, ...(agentId === ALL ? {} : { agentId }) })
        .then(setAudit)
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [agentId, companyService]);

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
          className="w-56"
        />
      </div>

      <Section title={t("company.activity.runs")}>
        {runs.length === 0 ? <p className="text-ui-sm text-foreground-subtle">{t("company.activity.noRuns")}</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {runs.slice(0, 50).map((run) => (
            <li key={run.id} className="flex items-center gap-3 py-2 text-ui-sm text-foreground">
              <span className="w-40 shrink-0">{who(run.agentId)}</span>
              <span className="w-24 shrink-0 text-foreground-subtle">{t(`company.trigger.${run.trigger}`)}</span>
              <span className="w-28 shrink-0 truncate text-foreground-subtle">#{run.channel}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-ui-xs", STATUS_STYLE[run.status])} title={run.error}>
                {t(STATUS_ID[run.status])}
              </span>
              <time className="ml-auto text-ui-xs text-foreground-subtlest">{new Date(run.startedAt).toLocaleString()}</time>
              <Button variant="ghost" size="sm" disabled={!run.taskId} onClick={() => onOpenRun(run)}>
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
            <li key={`${e.ts}-${i}`} className="flex items-center gap-3 py-1.5 text-ui-sm text-foreground" title={e.detail}>
              <time className="w-36 shrink-0 text-ui-xs text-foreground-subtlest">{new Date(e.ts).toLocaleString()}</time>
              <span className="w-36 shrink-0">{who(e.agentId)}</span>
              <span className="w-28 shrink-0 font-mono text-ui-xs">{e.tool}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-foreground-subtle">{e.target}</span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-ui-xs", DECISION_STYLE[e.decision])}>
                {t(`company.activity.${e.decision}`)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
