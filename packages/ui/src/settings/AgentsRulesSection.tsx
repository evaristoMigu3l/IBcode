import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  FileCode2,
  FolderOpen,
  RotateCcw,
  Save,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { cn } from "@/components/lib/utils.js";
import { logger } from "@/logger.js";

type RulesScope = "workspace" | "global";

interface AgentsRulesSectionProps {
  workspacePath?: string | null;
  workspaceIdentity?: string;
}

interface LoadedRulesState {
  content: string;
  filePath: string;
  exists: boolean;
}

const TEMPLATES = [
  {
    id: "standard",
    labelKey: "settings.agentsRules.template.standard",
    content: `# Agent Instructions

## Core Principles
- Always understand project context and requirements before modifying code.
- Write clean, type-safe, and modular code matching existing architecture.
- Verify changes using available lint, typecheck, and test commands before completion.

## Code Standards
- Adhere to the established styling, imports, and naming patterns in this repository.
- Avoid introducing unnecessary dependencies or duplicate states.
`,
  },
  {
    id: "strictReview",
    labelKey: "settings.agentsRules.template.strictReview",
    content: `# Strict Engineering Standards

## Quality Gates
- Zero warnings: All code must pass typecheck and linting without errors.
- Never bypass authentication, permission checks, or sanitize boundaries.
- Provide clear explanatory comments for non-obvious algorithms or complex logic.

## Safety Constraints
- Never log credentials, API keys, or raw secrets.
- Double-check destructive operations and file deletes.
`,
  },
  {
    id: "minimal",
    labelKey: "settings.agentsRules.template.minimal",
    content: `# Agent Guidelines

## Directives
- Keep responses concise, direct, and focused on code.
- Test and verify all modifications before finishing tasks.
`,
  },
];

export function AgentsRulesSection({
  workspacePath,
  workspaceIdentity,
}: AgentsRulesSectionProps) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const theme = useZCodeStore((state) => state.theme);
  const codePreviewSettings = useZCodeStore((state) => state.codePreviewSettings);

  const resolution = useWorkspaceServicesResolution(workspacePath ?? undefined, undefined, workspaceIdentity);
  const optionalServices = useOptionalServices();
  const services = resolution.services ?? optionalServices;
  const rpcReady = resolution.rpcReady;

  const [scope, setScope] = useState<RulesScope>(workspacePath ? "workspace" : "global");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [copiedPath, setCopiedPath] = useState(false);

  const [workspaceLoaded, setWorkspaceLoaded] = useState<LoadedRulesState | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [globalLoaded, setGlobalLoaded] = useState<LoadedRulesState | null>(null);
  const [globalDraft, setGlobalDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadVersionRef = useRef(0);

  const loadRules = useCallback(async (targetScope: RulesScope) => {
    if (!services?.fileService) return;
    if (targetScope === "workspace" && (!workspacePath || !rpcReady)) return;

    const version = ++loadVersionRef.current;
    setLoading(true);
    try {
      const result = await services.fileService.readAgentsRules({
        scope: targetScope,
        workspacePath: workspacePath ?? undefined,
      });
      if (loadVersionRef.current !== version) return;

      if (targetScope === "workspace") {
        setWorkspaceLoaded(result);
        setWorkspaceDraft(result.content);
      } else {
        setGlobalLoaded(result);
        setGlobalDraft(result.content);
      }
    } catch (error) {
      if (loadVersionRef.current !== version) return;
      logger.warn("[AgentsRulesSection] 读取 AGENTS.md 失败", {
        scope: targetScope,
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "settings.agentsRules.loadFailed" }));
    } finally {
      if (loadVersionRef.current === version) {
        setLoading(false);
      }
    }
  }, [intl, rpcReady, services, workspacePath]);

  useEffect(() => {
    void loadRules(scope);
  }, [loadRules, scope]);

  const currentLoaded = scope === "workspace" ? workspaceLoaded : globalLoaded;
  const currentDraft = scope === "workspace" ? workspaceDraft : globalDraft;
  const setCurrentDraft = useCallback((value: string) => {
    if (scope === "workspace") {
      setWorkspaceDraft(value);
    } else {
      setGlobalDraft(value);
    }
  }, [scope]);

  const isDirty = useMemo(() => {
    if (!currentLoaded) return false;
    return currentDraft !== currentLoaded.content;
  }, [currentDraft, currentLoaded]);

  const canSave = useMemo(() => {
    if (!currentLoaded) return false;
    return !currentLoaded.exists || isDirty;
  }, [currentLoaded, isDirty]);

  const handleSave = useCallback(async () => {
    if (!services?.fileService || saving) return;
    if (scope === "workspace" && !workspacePath) return;

    setSaving(true);
    try {
      const res = await services.fileService.writeAgentsRules({
        scope,
        workspacePath: workspacePath ?? undefined,
        content: currentDraft,
      });
      const nextLoaded: LoadedRulesState = {
        content: currentDraft,
        filePath: res.filePath,
        exists: true,
      };
      if (scope === "workspace") {
        setWorkspaceLoaded(nextLoaded);
      } else {
        setGlobalLoaded(nextLoaded);
      }
      toast(intl.formatMessage({ id: "settings.agentsRules.saveSuccess" }));
    } catch (error) {
      logger.warn("[AgentsRulesSection] 保存 AGENTS.md 失败", {
        scope,
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "settings.agentsRules.saveFailed" }));
    } finally {
      setSaving(false);
    }
  }, [currentDraft, intl, saving, scope, services, workspacePath]);

  const handleReset = useCallback(() => {
    if (!currentLoaded) return;
    setCurrentDraft(currentLoaded.content);
  }, [currentLoaded, setCurrentDraft]);

  const handleCopyPath = useCallback(() => {
    if (!currentLoaded?.filePath) return;
    void navigator.clipboard.writeText(currentLoaded.filePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  }, [currentLoaded?.filePath]);

  const handleReveal = useCallback(async () => {
    if (!currentLoaded?.filePath) return;
    const targetDir = currentLoaded.filePath.replace(/[\\/][^\\/]+$/u, "");
    const result = await platform.openInFileManager(targetDir);
    if (!result.success) {
      toast(intl.formatMessage({ id: "appHeader.openInFileManagerFailed" }));
    }
  }, [currentLoaded?.filePath, intl, platform]);

  const handleInsertTemplate = useCallback((templateContent: string) => {
    setCurrentDraft(templateContent);
    toast(intl.formatMessage({ id: "settings.agentsRules.templateInserted" }));
  }, [setCurrentDraft, intl]);

  return (
    <div className="space-y-4">
      <div className="text-ui-base font-medium text-foreground-subtle">
        {intl.formatMessage({ id: "settings.agentsRules.description" })}
      </div>

      {/* 作用域切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-ui-base font-medium transition-colors",
              scope === "workspace"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-subtle hover:text-foreground",
            )}
            onClick={() => setScope("workspace")}
          >
            <FileCode2 className="size-4" />
            {intl.formatMessage({ id: "settings.agentsRules.scope.workspace" })}
          </button>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-ui-base font-medium transition-colors",
              scope === "global"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-subtle hover:text-foreground",
            )}
            onClick={() => setScope("global")}
          >
            <ScrollText className="size-4" />
            {intl.formatMessage({ id: "settings.agentsRules.scope.global" })}
          </button>
        </div>

        {/* 编辑 / 预览切换 */}
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-ui-sm font-medium transition-colors",
              viewMode === "edit"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-subtle hover:text-foreground",
            )}
            onClick={() => setViewMode("edit")}
          >
            {intl.formatMessage({ id: "settings.agentsRules.edit" })}
          </button>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-ui-sm font-medium transition-colors",
              viewMode === "preview"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-subtle hover:text-foreground",
            )}
            onClick={() => setViewMode("preview")}
          >
            <Eye className="size-3.5" />
            {intl.formatMessage({ id: "settings.agentsRules.preview" })}
          </button>
        </div>
      </div>

      {scope === "workspace" && !workspacePath ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.agentsRules.noWorkspace" })}
          </p>
        </div>
      ) : (
        <SettingsGroupCard>
          <div className="space-y-3 px-4 py-3">
            {/* 文件路径及状态行 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate rounded border border-border bg-surface px-2 py-0.5 font-mono text-ui-caption text-foreground-subtle">
                  {currentLoaded?.filePath ?? "..."}
                </span>
                <button
                  type="button"
                  title="Copy path"
                  onClick={handleCopyPath}
                  className="rounded p-1 text-foreground-subtle hover:bg-surface-hover hover:text-foreground"
                >
                  {copiedPath ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {currentLoaded?.exists ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-ui-xs font-medium text-emerald-500">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {intl.formatMessage({ id: "settings.agentsRules.status.saved" })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                    <span className="size-1.5 rounded-full bg-foreground-subtle" />
                    {intl.formatMessage({ id: "settings.agentsRules.status.notCreated" })}
                  </span>
                )}
                {isDirty ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-ui-xs font-medium text-amber-500">
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    {intl.formatMessage({ id: "settings.agentsRules.status.unsaved" })}
                  </span>
                ) : null}
              </div>
            </div>

            {/* 编辑器 / 预览 */}
            {viewMode === "edit" ? (
              <Textarea
                value={currentDraft}
                onChange={(e) => setCurrentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                    e.preventDefault();
                    if (canSave && !saving && !loading) {
                      void handleSave();
                    }
                  }
                }}
                spellCheck={false}
                disabled={loading || saving}
                className="min-h-[460px] w-full font-mono text-ui-base leading-relaxed"
                placeholder={intl.formatMessage({ id: "settings.agentsRules.placeholder" })}
              />
            ) : (
              <div className="min-h-[460px] w-full overflow-y-auto rounded-md border border-border bg-background p-4">
                <MessageResponse
                  className="min-w-0 break-words"
                  workspacePath={workspacePath ?? undefined}
                  theme={theme}
                  codePreviewSettings={codePreviewSettings}
                >
                  {currentDraft}
                </MessageResponse>
              </div>
            )}

            {/* 操作工具栏 */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  disabled={!canSave || saving || loading}
                  onClick={() => void handleSave()}
                >
                  <Save className="size-4" />
                  {intl.formatMessage({ id: "settings.agentsRules.save" })}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isDirty || loading || saving}
                  onClick={handleReset}
                >
                  <RotateCcw className="size-4" />
                  {intl.formatMessage({ id: "settings.agentsRules.discard" })}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={loading || saving}>
                      <Sparkles className="size-4" />
                      {intl.formatMessage({ id: "settings.agentsRules.template.select" })}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {TEMPLATES.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => handleInsertTemplate(item.content)}
                      >
                        {intl.formatMessage({ id: item.labelKey })}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {currentLoaded?.filePath ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading || saving}
                  onClick={() => void handleReveal()}
                >
                  <FolderOpen className="size-4" />
                  {intl.formatMessage({ id: "settings.agentsRules.openFile" })}
                </Button>
              ) : null}
            </div>
          </div>
        </SettingsGroupCard>
      )}
    </div>
  );
}
