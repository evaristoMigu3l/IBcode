import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { companyDmChannel, type CompanyAgent, type CompanyRun, type CompanyState } from "@zcode/shared";
import { Hash, Send, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useCompanyMessages } from "@/hooks/useCompany.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyAvatar } from "./CompanyAvatar.js";

export function activeRunFor(runs: CompanyRun[], agentId: string): CompanyRun | undefined {
  return runs.find((r) => r.agentId === agentId && (r.status === "running" || r.status === "needs-you"));
}

interface Props {
  state: CompanyState;
  onRefresh(): void;
  onOpenRun(run: CompanyRun): void;
}

export function CompanyChannels({ state, onRefresh, onOpenRun }: Props) {
  const { intl } = useZCodeIntl();
  const { companyService } = useServices();
  const [channel, setChannel] = useState("general");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const { messages, poll, reset } = useCompanyMessages(channel);
  const confirm = useConfirmDialog();
  const listRef = useRef<HTMLDivElement>(null);
  const agentsById = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const dmAgent = state.agents.find((a) => companyDmChannel(a.id) === channel);
  const channelRuns = state.runs.filter(
    (r) => r.channel === channel && (r.status === "running" || r.status === "needs-you"),
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, channel]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // 立即清空输入框：唤醒同事要等任务创建完成（几秒），期间留着原文容易被重复发送。
    setDraft("");
    try {
      const pending = companyService.post({ channel, text });
      // 消息在唤醒同事之前就已写入频道：先拉一次，让它马上出现。
      setTimeout(() => void poll(), 300);
      const { woke } = await pending;
      if (woke.length) {
        const names = woke.map((id) => agentsById.get(id)?.name ?? id).join(", ");
        toast(intl.formatMessage({ id: "company.composer.woke" }, { names }));
      }
      await poll();
      onRefresh();
    } catch (e) {
      // 发送失败时把原文还回去（除非用户已经开始写下一条）。
      setDraft((current) => current || text);
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  // 消息太多时一键清空当前频道（不可撤销，先确认）。
  const clear = async () => {
    const label = channelLabel(channel);
    const ok = await confirm({
      title: intl.formatMessage({ id: "company.channel.clearTitle" }, { channel: label }),
      description: intl.formatMessage({ id: "company.channel.clearDescription" }, { count: messages.length }),
      confirmVariant: "destructive",
      confirmLabel: intl.formatMessage({ id: "company.channel.clear" }),
    });
    if (!ok) return;
    try {
      await companyService.clearChannel({ channel });
      reset();
      toast(intl.formatMessage({ id: "company.channel.cleared" }, { channel: label }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const channelLabel = (c: string) => {
    const agent = state.agents.find((a) => companyDmChannel(a.id) === c);
    return agent ? agent.name : c;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card md:flex-row">
      <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-2 md:flex-col md:overflow-y-auto md:overflow-x-visible md:border-b-0 md:border-r md:w-56" aria-label={intl.formatMessage({ id: "company.tab.channels" })}>
        {state.channels.map((c) => {
          const agent = state.agents.find((a) => companyDmChannel(a.id) === c);
          const run = agent ? activeRunFor(state.runs, agent.id) : undefined;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              aria-current={c === channel}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-base text-foreground hover:bg-hover",
                c === channel && "bg-selected",
              )}
            >
              {agent ? (
                <CompanyAvatar icon={agent.icon} color={agent.color} size={22} active={Boolean(run)} />
              ) : (
                <Hash className="size-4 text-foreground-subtle" />
              )}
              <span className="truncate">{channelLabel(c)}</span>
              {run?.status === "needs-you" ? <ShieldAlert className="ml-auto size-3.5 text-amber-500" /> : null}
            </button>
          );
        })}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          {dmAgent ? (
            <CompanyAvatar icon={dmAgent.icon} color={dmAgent.color} size={24} active={Boolean(activeRunFor(state.runs, dmAgent.id))} />
          ) : (
            <Hash className="size-4 text-foreground-subtle" />
          )}
          <span className="text-ui-base font-medium text-foreground">{channelLabel(channel)}</span>
          {dmAgent?.title ? <span className="truncate text-ui-sm text-foreground-subtle">{dmAgent.title}</span> : null}
          <Button
            variant="ghost"
            size="sm"
            data-icon="inline-start"
            className="ml-auto text-foreground-subtle"
            disabled={messages.length === 0}
            onClick={() => void clear()}
          >
            <Trash2 className="size-3.5" />
            {intl.formatMessage({ id: "company.channel.clear" })}
          </Button>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-ui-base text-foreground-subtle">
              {dmAgent
                ? intl.formatMessage({ id: "company.channel.dmEmpty" }, { name: dmAgent.name })
                : intl.formatMessage({ id: "company.channel.empty" })}
            </p>
          ) : (
            messages.map((m) => (
              <MessageRow key={m.id} message={m} agent={agentsById.get(m.from)} runs={state.runs} onOpenRun={onOpenRun} />
            ))
          )}
        </div>

        {channelRuns.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
            {channelRuns.map((run) => {
              const agent = agentsById.get(run.agentId);
              if (!agent) return null;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onOpenRun(run)}
                  className="flex items-center gap-2 rounded-full border border-border px-2 py-1 text-ui-sm text-foreground hover:bg-hover"
                >
                  <CompanyAvatar icon={agent.icon} color={agent.color} size={18} active />
                  {intl.formatMessage(
                    { id: run.status === "needs-you" ? "company.needsYou" : "company.working" },
                    { name: agent.name },
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-wrap gap-1">
            {state.agents.map((a) => (
              <button
                key={a.id}
                type="button"
                title={intl.formatMessage({ id: "company.composer.mention" }, { name: a.name })}
                onClick={() => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${a.id} `)}
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-ui-xs text-foreground-subtle hover:bg-hover hover:text-foreground"
              >
                <CompanyAvatar icon={a.icon} color={a.color} size={14} />@{a.id}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              aria-label={intl.formatMessage({ id: "company.composer.placeholder" }, { channel: channelLabel(channel) })}
              placeholder={intl.formatMessage({ id: "company.composer.placeholder" }, { channel: channelLabel(channel) })}
              className="min-h-[52px] flex-1 resize-none"
            />
            <Button onClick={() => void send()} disabled={!draft.trim() || sending} size="lg" data-icon="inline-start">
              <Send className="size-4" />
              {intl.formatMessage({ id: "company.composer.send" })}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MessageRow({
  message,
  agent,
  runs,
  onOpenRun,
}: {
  message: { from: string; text: string; ts: number; runId?: string };
  agent: CompanyAgent | undefined;
  runs: CompanyRun[];
  onOpenRun(run: CompanyRun): void;
}) {
  const { intl } = useZCodeIntl();
  const run = message.runId ? runs.find((r) => r.id === message.runId) : undefined;
  const isBoss = message.from === "boss";
  const name = agent?.name ?? intl.formatMessage({ id: isBoss ? "company.message.boss" : "company.message.system" });
  return (
    <div className="flex gap-3">
      {agent ? (
        <CompanyAvatar icon={agent.icon} color={agent.color} size={32} still active={Boolean(activeRunFor(runs, agent.id))} />
      ) : (
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[30%] text-ui-sm font-semibold",
            isBoss ? "bg-selected text-foreground" : "bg-amber-500/15 text-amber-600",
          )}
          aria-hidden
        >
          {isBoss ? name.slice(0, 1).toUpperCase() : "!"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-ui-base font-medium text-foreground">{name}</span>
          <time className="text-ui-xs text-foreground-subtlest">{new Date(message.ts).toLocaleString()}</time>
          {run?.taskId ? (
            <button type="button" onClick={() => onOpenRun(run)} className="text-ui-xs text-foreground-subtle underline-offset-2 hover:underline">
              {intl.formatMessage({ id: "company.message.openRun" })}
            </button>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-ui-base text-foreground">{message.text}</p>
      </div>
    </div>
  );
}
