import type { CompanyAgent, CompanyState } from "@zcode/shared";
import { Plus } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyAvatar } from "./CompanyAvatar.js";
import { activeRunFor } from "./CompanyChannels.js";

interface Props {
  state: CompanyState;
  onEdit(agentId: string | "new"): void;
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-ui-xs text-foreground-subtle">{children}</span>
  );
}

export function CompanyTeam({ state, onEdit }: Props) {
  const { intl } = useZCodeIntl();

  const badges = (a: CompanyAgent) =>
    [
      a.web && intl.formatMessage({ id: "company.badge.web" }),
      a.shell === "auto" && intl.formatMessage({ id: "company.badge.shellAuto" }),
      a.shell === "ask" && intl.formatMessage({ id: "company.badge.shellAsk" }),
      a.delegate && intl.formatMessage({ id: "company.badge.delegate" }),
      a.folders.length > 0 && intl.formatMessage({ id: "company.badge.folders" }, { count: a.folders.length }),
      a.mcpServers.length > 0 && intl.formatMessage({ id: "company.badge.apps" }, { count: a.mcpServers.length }),
      a.routines.length > 0 && intl.formatMessage({ id: "company.badge.routines" }, { count: a.routines.length }),
    ].filter((b): b is string => Boolean(b));

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {state.agents.map((agent) => {
        const run = activeRunFor(state.runs, agent.id);
        const statusId = !run
          ? "company.status.idle"
          : run.status === "needs-you"
            ? "company.status.needsYou"
            : "company.status.running";
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => onEdit(agent.id)}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-border-hover hover:bg-surface-hover"
          >
            <div className="flex items-center gap-3">
              <CompanyAvatar icon={agent.icon} color={agent.color} size={48} active={Boolean(run)} />
              <div className="min-w-0">
                <div className="truncate text-ui-lg font-medium text-foreground">{agent.name}</div>
                <div className="truncate text-ui-sm text-foreground-subtle">{agent.title || `@${agent.id}`}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {badges(agent).map((b) => (
                <Badge key={b}>{b}</Badge>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-ui-sm">
              <span
                className={cn(
                  "size-2 rounded-full",
                  !run ? "bg-foreground-subtlest/40" : run.status === "needs-you" ? "bg-amber-500" : "bg-emerald-500",
                )}
                aria-hidden
              />
              <span className="text-foreground-subtle">{intl.formatMessage({ id: statusId })}</span>
            </div>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onEdit("new")}
        className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-center text-foreground-subtle transition-colors hover:border-border-hover hover:text-foreground"
      >
        <Plus className="size-6" />
        <span className="text-ui-base font-medium">{intl.formatMessage({ id: "company.team.new" })}</span>
        <span className="text-ui-sm">{intl.formatMessage({ id: "company.team.newHint" })}</span>
      </button>
    </div>
  );
}
