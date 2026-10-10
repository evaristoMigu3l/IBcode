import { useEffect, useMemo, useState } from "react";
import {
  COMPANY_COLORS,
  COMPANY_DEFAULT_DAILY_RUN_LIMIT,
  companyDmChannel,
  type CompanyAgentInput,
  type CompanyCapabilities,
  type CompanyState,
  type ModelSelection,
} from "@zcode/shared";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyAvatar } from "./CompanyAvatar.js";
import { activeRunFor } from "./CompanyChannels.js";
import { CompanyIconPicker } from "./CompanyIconPicker.js";
import { ChecklistSection, FoldersSection, MemorySection, RoutinesSection, Section, SelectField } from "./CompanyEditorSections.js";

const BLANK: CompanyAgentInput = {
  name: "",
  title: "",
  instructions: "",
  icon: "spark",
  color: COMPANY_COLORS[1],
  web: true,
  shell: "ask",
  delegate: false,
  dailyRunLimit: COMPANY_DEFAULT_DAILY_RUN_LIMIT,
  skills: [],
  mcpServers: [],
  folders: [],
  routines: [],
};

const DEFAULT_MODEL = "__default__";
const modelKey = (m?: ModelSelection) => (m ? JSON.stringify([m.providerId, m.modelId]) : DEFAULT_MODEL);

interface Props {
  state: CompanyState;
  agentId: string | "new";
  onDone(): void;
  onSaved(): void;
}

export function CompanyAgentEditor({ state, agentId, onDone, onSaved }: Props) {
  const { intl } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { companyService, modelSelectionService } = useServices();
  const confirm = useConfirmDialog();
  const existing = agentId === "new" ? undefined : state.agents.find((a) => a.id === agentId);
  const [form, setForm] = useState<CompanyAgentInput>(() => (existing ? { ...existing } : { ...BLANK }));
  const [caps, setCaps] = useState<CompanyCapabilities>({ mcpServers: [], skills: [] });
  const [models, setModels] = useState<Array<{ value: string; label: string; selection?: ModelSelection }>>([]);
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<CompanyAgentInput>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    void companyService.getCapabilities().then(setCaps).catch(() => undefined);
    void modelSelectionService
      .getView()
      .then((view) =>
        setModels(
          view.providers.flatMap((p) =>
            p.models.map((m) => {
              const config = m.config as { displayName?: string; name?: string };
              return {
                value: modelKey({ providerId: p.providerId, modelId: m.modelId }),
                label: `${p.providerName ?? p.providerId} · ${config.displayName ?? config.name ?? m.modelId}`,
                selection: { providerId: p.providerId, modelId: m.modelId },
              };
            }),
          ),
        ),
      )
      .catch(() => undefined);
  }, [companyService, modelSelectionService]);

  const channelOptions = useMemo(
    () =>
      state.channels.map((c) => {
        const agent = state.agents.find((a) => companyDmChannel(a.id) === c);
        return { value: c, label: agent ? `@ ${agent.name}` : `# ${c}` };
      }),
    [state.agents, state.channels],
  );

  const save = async () => {
    setSaving(true);
    try {
      await companyService.saveAgent(form);
      toast(t("company.editor.saved"));
      onSaved();
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: t("company.editor.delete"),
      description: t("company.editor.deleteConfirm", { name: existing.name }),
      confirmVariant: "destructive",
      confirmLabel: t("company.editor.delete"),
    });
    if (!ok) return;
    try {
      await companyService.deleteAgent({ id: existing.id });
      onSaved();
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const active = existing ? Boolean(activeRunFor(state.runs, existing.id)) : false;

  return (
    <div className="flex flex-col gap-3 pb-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" data-icon="inline-start" onClick={onDone}>
          <ArrowLeft className="size-3.5" />
          {t("company.editor.back")}
        </Button>
      </div>

      <section className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <CompanyAvatar icon={form.icon} color={form.color} size={72} active={active} />
        <div className="grid flex-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-ui-sm text-foreground-subtle">
            {t("company.editor.name")}
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t("company.editor.namePlaceholder")} maxLength={40} />
          </label>
          <label className="flex flex-col gap-1 text-ui-sm text-foreground-subtle">
            {t("company.editor.role")}
            <Input value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("company.editor.rolePlaceholder")} maxLength={80} />
          </label>
        </div>
      </section>

      <CompanyIconPicker icon={form.icon} color={form.color} onChange={patch} />

      <Section title={t("company.editor.instructions")}>
        <Textarea
          value={form.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
          rows={7}
          placeholder={t("company.editor.instructionsPlaceholder")}
          aria-label={t("company.editor.instructions")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui-sm text-foreground-subtle">{t("company.editor.model")}</span>
          <SelectField
            label={t("company.editor.model")}
            value={modelKey(form.model)}
            onChange={(v) => patch({ model: models.find((m) => m.value === v)?.selection })}
            options={[{ value: DEFAULT_MODEL, label: t("company.editor.modelDefault") }, ...models.map(({ value, label }) => ({ value, label }))]}
            className="w-full sm:w-auto sm:min-w-64"
          />
        </div>
      </Section>

      <Section title={t("company.editor.abilities")}>
        {(
          [
            ["web", "company.editor.web", "company.editor.webHint"],
            ["delegate", "company.editor.delegate", "company.editor.delegateHint"],
          ] as const
        ).map(([key, label, hint]) => (
          <label key={key} className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-ui-base text-foreground">{t(label)}</span>
              <span className="block text-ui-sm text-foreground-subtle">{t(hint)}</span>
            </span>
            <Switch checked={form[key]} onCheckedChange={(v) => patch({ [key]: v })} />
          </label>
        ))}
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <span>
            <span className="block text-ui-base text-foreground">{t("company.editor.shell")}</span>
            <span className="block text-ui-sm text-foreground-subtle">{t("company.editor.shellHint")}</span>
          </span>
          <SelectField
            label={t("company.editor.shell")}
            value={form.shell}
            onChange={(shell) => patch({ shell: shell as CompanyAgentInput["shell"] })}
            options={(["off", "ask", "auto"] as const).map((v) => ({ value: v, label: t(`company.editor.shell.${v}`) }))}
            className="w-full shrink-0 sm:w-44"
          />
        </div>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-ui-base text-foreground">{t("company.editor.dailyRunLimit")}</span>
            <span className="block text-ui-sm text-foreground-subtle">{t("company.editor.dailyRunLimitHint")}</span>
          </span>
          <Input
            type="number"
            min={0}
            max={1000}
            value={form.dailyRunLimit ?? COMPANY_DEFAULT_DAILY_RUN_LIMIT}
            onChange={(e) => patch({ dailyRunLimit: Math.max(0, Number(e.target.value) || 0) })}
            className="w-24 shrink-0"
            aria-label={t("company.editor.dailyRunLimit")}
          />
        </label>
      </Section>

      <FoldersSection ownFolder={existing ? state.folders[existing.id] : undefined} folders={form.folders} onChange={patch} />
      <ChecklistSection title={t("company.editor.apps")} empty={t("company.editor.appsEmpty")} options={caps.mcpServers} selected={form.mcpServers} onChange={(mcpServers) => patch({ mcpServers })} />
      <ChecklistSection title={t("company.editor.skills")} empty={t("company.editor.skillsEmpty")} options={caps.skills} selected={form.skills} onChange={(skills) => patch({ skills })} />
      <RoutinesSection agentId={existing?.id} routines={form.routines} channels={channelOptions} onChange={patch} />
      {existing ? <MemorySection agentId={existing.id} /> : null}

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        <Button onClick={() => void save()} disabled={saving || !form.name.trim()} size="lg">
          {t(existing ? "company.editor.save" : "company.editor.create")}
        </Button>
        <Button variant="ghost" size="lg" onClick={onDone}>
          {t("company.editor.cancel")}
        </Button>
        {existing ? (
          <Button variant="ghost" size="lg" className="ml-auto text-destructive" onClick={() => void remove()}>
            {t("company.editor.delete")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
