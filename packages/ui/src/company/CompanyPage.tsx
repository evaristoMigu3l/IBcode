import { useMemo, useState } from "react";
import type { CompanyRun } from "@zcode/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useCompanyIcons, useCompanyState } from "@/hooks/useCompany.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyActivity } from "./CompanyActivity.js";
import { CompanyAgentEditor } from "./CompanyAgentEditor.js";
import { CompanyAvatar, CompanyIconLibraryContext, CompanyIconsContext } from "./CompanyAvatar.js";
import { CompanyChannels, activeRunFor } from "./CompanyChannels.js";
import { CompanyTeam } from "./CompanyTeam.js";

type Tab = "channels" | "team" | "activity";

export interface CompanyPageProps {
  /** 打开某次运行对应的 ZCode task（同事的工作过程、等你批准的动作都在那里）。 */
  onOpenTask(workspacePath: string, taskId: string): void;
}

/** Company 主视图：频道 / 团队 / 动态。OpenBot 式 AI 同事，每位都有自己的文件夹与工具授权。 */
export function CompanyPage({ onOpenTask }: CompanyPageProps) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { state, error, refresh } = useCompanyState();
  const library = useCompanyIcons();
  const iconMap = useMemo(() => new Map(library.icons.map((i) => [i.id, i.svg])), [library.icons]);
  const [tab, setTab] = useState<Tab>("channels");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const openRun = (run: CompanyRun) => {
    if (run.taskId) onOpenTask(run.workspacePath, run.taskId);
  };

  if (!state) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-ui-base text-foreground-subtle">
        {error ? intl.formatMessage({ id: "company.error" }, { message: error }) : t("company.loading")}
      </div>
    );
  }

  const working = state.agents.filter((a) => activeRunFor(state.runs, a.id));

  return (
    <CompanyIconLibraryContext.Provider value={library}>
    <CompanyIconsContext.Provider value={iconMap}>
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-4 md:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-ui-xl font-semibold text-foreground">{t("company.title")}</h1>
          <p className="text-ui-sm text-foreground-subtle">{t("company.subtitle")}</p>
        </div>
        <div className="flex -space-x-1.5" aria-hidden>
          {working.map((a) => (
            <CompanyAvatar key={a.id} icon={a.icon} color={a.color} size={26} active />
          ))}
        </div>
        <Tabs
          value={editing ? "team" : tab}
          onValueChange={(v) => {
            setEditing(null);
            setTab(v as Tab);
          }}
          className="ml-auto"
        >
          <TabsList>
            <TabsTrigger value="channels">{t("company.tab.channels")}</TabsTrigger>
            <TabsTrigger value="team">{t("company.tab.team")}</TabsTrigger>
            <TabsTrigger value="activity">{t("company.tab.activity")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {editing ? (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-4xl">
            <CompanyAgentEditor
              key={editing}
              state={state}
              agentId={editing}
              onDone={() => setEditing(null)}
              onSaved={() => void refresh()}
            />
          </div>
        </div>
      ) : tab === "channels" ? (
        <CompanyChannels state={state} onRefresh={() => void refresh()} onOpenRun={openRun} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-5xl">
            {tab === "team" ? (
              <CompanyTeam
                state={state}
                onEdit={(id) => {
                  setTab("team");
                  setEditing(id);
                }}
              />
            ) : (
              <CompanyActivity state={state} onOpenRun={openRun} />
            )}
          </div>
        </div>
      )}
    </div>
    </CompanyIconsContext.Provider>
    </CompanyIconLibraryContext.Provider>
  );
}
