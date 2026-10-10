import { useCallback, useEffect, useState } from "react";
import type { CompanyFileEntry, CompanyFilePreview, CompanyState } from "@zcode/shared";
import { ChevronRight, Download, ExternalLink, FileText, Folder, FolderOpen, Trash2 } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyAvatar } from "./CompanyAvatar.js";

const POLL_MS = 5000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);
const parentOf = (absolute: string) => absolute.replace(/[\\/][^\\/]*$/, "");

/** 每位同事的成果（报告、演示文稿、代码…）：浏览、预览、用系统程序打开、删除。 */
export function CompanyFiles({ state, isDesktop }: { state: CompanyState; isDesktop: boolean }) {
  const { intl } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { companyService } = useServices();
  const platform = usePlatform();
  const confirm = useConfirmDialog();
  const [agentId, setAgentId] = useState(state.agents[0]?.id ?? "");
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<CompanyFileEntry[]>([]);
  const [preview, setPreview] = useState<CompanyFilePreview | null>(null);
  const agent = state.agents.find((a) => a.id === agentId);
  // 浏览器版的 platform 也有 openExternalFile，但只会返回「不支持」：只在桌面端显示「打开」。
  const canOpenNatively = isDesktop && typeof platform.openExternalFile === "function";

  const load = useCallback(async () => {
    if (!agentId) return;
    setEntries(await companyService.listFiles({ agentId, path: dir }).catch(() => []));
  }, [agentId, dir, companyService]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const chooseAgent = (id: string) => {
    setAgentId(id);
    setDir("");
    setPreview(null);
  };

  const openEntry = async (entry: CompanyFileEntry) => {
    if (entry.type === "dir") {
      setDir(entry.path);
      setPreview(null);
      return;
    }
    try {
      setPreview(await companyService.previewFile({ agentId, path: entry.path }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (entry: { name: string; path: string }) => {
    const ok = await confirm({
      title: t("company.files.deleteTitle", { name: entry.name }),
      description: t("company.files.deleteDescription", { agent: agent?.name ?? agentId }),
      confirmVariant: "destructive",
      confirmLabel: t("company.files.delete"),
    });
    if (!ok) return;
    try {
      await companyService.deleteFile({ agentId, path: entry.path });
      if (preview && (preview.path === entry.path || preview.path.startsWith(`${entry.path}/`))) setPreview(null);
      toast(t("company.files.deleted", { name: entry.name }));
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  // 浏览器版没有「用系统程序打开」：文本/图片可以直接下载。
  const download = (p: CompanyFilePreview) => {
    const href = p.dataUrl ?? URL.createObjectURL(new Blob([p.text ?? ""], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href, download: p.path.split("/").at(-1) ?? "file" });
    a.click();
    if (!p.dataUrl) setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const crumbs = dir ? dir.split("/") : [];
  const previewName = preview?.path.split("/").at(-1) ?? "";

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2" aria-label={t("company.tab.team")}>
        {state.agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => chooseAgent(a.id)}
            aria-current={a.id === agentId}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-base text-foreground hover:bg-hover",
              a.id === agentId && "bg-selected",
            )}
          >
            <CompanyAvatar icon={a.icon} color={a.color} size={22} />
            <span className="truncate">{a.name}</span>
          </button>
        ))}
      </nav>

      <section className="flex w-80 shrink-0 flex-col border-r border-border">
        <header className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2.5 text-ui-sm">
          <button type="button" className="font-medium text-foreground hover:underline" onClick={() => { setDir(""); setPreview(null); }}>
            {agent?.name ?? "-"}
          </button>
          {crumbs.map((part, i) => (
            <span key={`${part}-${i}`} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-foreground-subtlest" />
              <button type="button" className="text-foreground-subtle hover:underline" onClick={() => { setDir(crumbs.slice(0, i + 1).join("/")); setPreview(null); }}>
                {part}
              </button>
            </span>
          ))}
          {canOpenNatively && agent ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={t("company.files.showInFolder")}
              title={t("company.files.showInFolder")}
              onClick={() => void platform.openInFileManager(dir ? `${state.folders[agentId]}/${dir}` : state.folders[agentId]!)}
            >
              <FolderOpen />
            </Button>
          ) : null}
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {entries.length === 0 ? (
            <li className="px-3 py-6 text-center text-ui-sm text-foreground-subtle">{t("company.files.empty")}</li>
          ) : (
            entries.map((entry) => (
              <li key={entry.path} className="group flex items-center rounded-lg hover:bg-hover">
                <button
                  type="button"
                  onClick={() => void openEntry(entry)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left",
                    preview?.path === entry.path && "font-medium",
                  )}
                >
                  {entry.type === "dir" ? (
                    <Folder className="size-4 shrink-0 text-foreground-subtle" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-foreground-subtle" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">{entry.name}</span>
                  {entry.type === "file" ? (
                    <span className="shrink-0 text-ui-xs text-foreground-subtlest">{formatSize(entry.size)}</span>
                  ) : null}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t("company.files.deleteTitle", { name: entry.name })}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        {preview ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground">{previewName}</span>
              <span className="text-ui-xs text-foreground-subtlest">{formatSize(preview.size)}</span>
              {canOpenNatively ? (
                <>
                  <Button variant="outline" size="sm" data-icon="inline-start" onClick={() => void platform.openExternalFile?.(preview.absolutePath)}>
                    <ExternalLink className="size-3.5" />
                    {t("company.files.open")}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t("company.files.showInFolder")} title={t("company.files.showInFolder")} onClick={() => void platform.openInFileManager(parentOf(preview.absolutePath))}>
                    <FolderOpen />
                  </Button>
                </>
              ) : preview.kind !== "other" ? (
                <Button variant="outline" size="sm" data-icon="inline-start" onClick={() => download(preview)}>
                  <Download className="size-3.5" />
                  {t("company.files.download")}
                </Button>
              ) : null}
              <Button variant="ghost" size="icon-sm" aria-label={t("company.files.delete")} title={t("company.files.delete")} onClick={() => void remove({ name: previewName, path: preview.path })}>
                <Trash2 />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {preview.truncated ? <p className="mb-2 text-ui-xs text-foreground-subtle">{t("company.files.truncated")}</p> : null}
              {preview.kind === "image" && preview.dataUrl ? (
                <img src={preview.dataUrl} alt={previewName} className="max-h-full max-w-full object-contain" />
              ) : preview.kind === "text" && isMarkdown(preview.path) ? (
                <MessageResponse className="w-full min-w-0 break-words text-foreground">{preview.text ?? ""}</MessageResponse>
              ) : preview.kind === "text" ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm text-foreground">{preview.text}</pre>
              ) : (
                <p className="py-10 text-center text-ui-base text-foreground-subtle">{t("company.files.noPreview")}</p>
              )}
            </div>
          </>
        ) : (
          <p className="m-auto px-6 text-center text-ui-base text-foreground-subtle">{t("company.files.pick")}</p>
        )}
      </section>
    </div>
  );
}
