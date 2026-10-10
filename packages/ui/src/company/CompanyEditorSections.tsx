import { useEffect, useState, type ReactNode } from "react";
import type { CompanyAgentInput, CompanyFolderGrant, CompanyRoutine } from "@zcode/shared";
import { FolderOpen, FolderPlus, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cronFromParts, pad2, partsFromCron, SCHEDULE_PRESETS, type ScheduleParts } from "./companySchedule.js";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-ui-base font-medium text-foreground">{title}</h3>
        {hint ? <p className="text-ui-sm text-foreground-subtle">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Patch = (patch: Partial<CompanyAgentInput>) => void;

export function FoldersSection({ ownFolder, folders, onChange }: { ownFolder?: string; folders: CompanyFolderGrant[]; onChange: Patch }) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const t = (id: string) => intl.formatMessage({ id });
  const set = (next: CompanyFolderGrant[]) => onChange({ folders: next });
  const add = async () => {
    const path = await platform.selectDirectory();
    if (path && !folders.some((f) => f.path === path)) set([...folders, { path, access: "read" }]);
  };
  return (
    <Section title={t("company.editor.folders")} hint={t("company.editor.foldersHint")}>
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-ui-sm text-foreground-subtle">{t("company.editor.ownFolder")}</div>
          <div className="truncate font-mono text-ui-sm text-foreground">{ownFolder ?? t("company.editor.ownFolderAfterSave")}</div>
        </div>
        {ownFolder ? (
          <Button variant="ghost" size="sm" data-icon="inline-start" onClick={() => void platform.openInFileManager(ownFolder)}>
            <FolderOpen className="size-3.5" />
            {t("company.editor.openFolder")}
          </Button>
        ) : null}
      </div>
      {folders.map((f, i) => (
        <div key={f.path} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-foreground" title={f.path}>
            {f.path}
          </span>
          <SelectField
            label={f.path}
            value={f.access}
            onChange={(access) => set(folders.map((x, j) => (j === i ? { ...x, access: access as CompanyFolderGrant["access"] } : x)))}
            options={[
              { value: "read", label: t("company.editor.access.read") },
              { value: "write", label: t("company.editor.access.write") },
            ]}
            className="w-36"
          />
          <Button variant="ghost" size="icon-sm" aria-label={t("company.editor.remove")} onClick={() => set(folders.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" data-icon="inline-start" onClick={() => void add()}>
          <FolderPlus className="size-3.5" />
          {t("company.editor.addFolder")}
        </Button>
      </div>
    </Section>
  );
}

export function ChecklistSection({
  title,
  empty,
  options,
  selected,
  onChange,
}: {
  title: string;
  empty: string;
  options: string[];
  selected: string[];
  onChange(next: string[]): void;
}) {
  // 已授权但当前未安装的也显示出来，方便取消勾选。
  const all = [...new Set([...options, ...selected])];
  return (
    <Section title={title}>
      {all.length === 0 ? <p className="text-ui-sm text-foreground-subtle">{empty}</p> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {all.map((name) => (
          <label key={name} className="flex cursor-pointer items-center gap-2 text-ui-base text-foreground">
            <Checkbox
              checked={selected.includes(name)}
              onCheckedChange={(checked) =>
                onChange(checked === true ? [...selected, name] : selected.filter((s) => s !== name))
              }
            />
            <span className="truncate">{name}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

export function RoutinesSection({
  agentId,
  routines,
  channels,
  onChange,
}: {
  agentId?: string;
  routines: CompanyRoutine[];
  channels: Array<{ value: string; label: string }>;
  onChange: Patch;
}) {
  const { intl, locale } = useZCodeIntl();
  const { companyService } = useServices();
  const t = (id: string) => intl.formatMessage({ id });
  const set = (next: CompanyRoutine[]) => onChange({ routines: next });
  const update = (i: number, patch: Partial<CompanyRoutine>) => set(routines.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    value: String(d),
    label: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(2024, 0, 7 + d)),
  }));
  const runNow = async (r: CompanyRoutine) => {
    if (!agentId || !r.id) return void toast(t("company.editor.runNowSaveFirst"));
    try {
      await companyService.runRoutineNow({ agentId, routineId: r.id });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Section title={t("company.editor.routines")} hint={t("company.editor.routinesHint")}>
      {routines.map((r, i) => {
        const parts = partsFromCron(r.cron);
        const setParts = (patch: Partial<ScheduleParts>) => update(i, { cron: cronFromParts({ ...parts, ...patch }) });
        return (
          <div key={r.id || i} className="flex flex-col gap-2 rounded-lg bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SelectField
                label={t("company.editor.routines")}
                value={parts.preset}
                onChange={(preset) => setParts({ preset: preset as ScheduleParts["preset"] })}
                options={SCHEDULE_PRESETS.map((p) => ({ value: p, label: t(`company.editor.schedule.${p}`) }))}
                className="w-40"
              />
              {parts.preset === "weekly" ? (
                <SelectField label="weekday" value={String(parts.weekday)} onChange={(w) => setParts({ weekday: Number(w) })} options={weekdays} className="w-36" />
              ) : null}
              {parts.preset === "custom" ? (
                <Input value={r.cron} onChange={(e) => update(i, { cron: e.target.value })} className="w-40 font-mono" aria-label="cron" />
              ) : (
                <Input
                  type="time"
                  aria-label="time"
                  value={`${pad2(parts.hour)}:${pad2(parts.minute)}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    setParts({ hour: h ?? 9, minute: m ?? 0 });
                  }}
                  className="w-28"
                />
              )}
              <span className="text-ui-sm text-foreground-subtle">{t("company.editor.routineChannel")}</span>
              <SelectField label={t("company.editor.routineChannel")} value={r.channel} onChange={(channel) => update(i, { channel })} options={channels} className="w-40" />
              <label className="ml-auto flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
                <Switch size="sm" checked={r.enabled} onCheckedChange={(enabled) => update(i, { enabled })} />
                {t("company.editor.routineEnabled")}
              </label>
              <Button variant="ghost" size="icon-sm" aria-label={t("company.editor.runNow")} title={t("company.editor.runNow")} onClick={() => void runNow(r)}>
                <Play />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t("company.editor.remove")} onClick={() => set(routines.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
            <Input value={r.task} onChange={(e) => update(i, { task: e.target.value })} placeholder={t("company.editor.routineTaskPlaceholder")} aria-label={t("company.editor.routineTaskPlaceholder")} />
          </div>
        );
      })}
      <div>
        <Button
          variant="outline"
          size="sm"
          data-icon="inline-start"
          onClick={() => set([...routines, { id: "", cron: "0 9 * * 1-5", task: "", channel: channels[0]?.value ?? "general", enabled: true }])}
        >
          <Plus className="size-3.5" />
          {t("company.editor.addRoutine")}
        </Button>
      </div>
    </Section>
  );
}

export function MemorySection({ agentId }: { agentId: string }) {
  const { intl } = useZCodeIntl();
  const { companyService } = useServices();
  const t = (id: string) => intl.formatMessage({ id });
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    void companyService.readMemory({ id: agentId }).then((m) => {
      setText(m);
      setDirty(false);
    });
  }, [agentId, companyService]);
  const save = async () => {
    try {
      await companyService.writeMemory({ id: agentId, text });
      setDirty(false);
      toast(t("company.editor.memorySaved"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Section title={t("company.editor.memory")} hint={t("company.editor.memoryHint")}>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        rows={6}
        className="font-mono text-ui-sm"
        aria-label={t("company.editor.memory")}
      />
      <div>
        <Button variant="outline" size="sm" disabled={!dirty} onClick={() => void save()}>
          {t("company.editor.saveMemory")}
        </Button>
      </div>
    </Section>
  );
}
