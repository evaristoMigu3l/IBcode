import { useContext, useRef, type ChangeEvent } from "react";
import { COMPANY_COLORS, COMPANY_ICON_IDS, type CompanyAgentIcon } from "@zcode/shared";
import { Check, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CompanyAvatar, CompanyIconLibraryContext } from "./CompanyAvatar.js";
import { Section } from "./CompanyEditorSections.js";
import { sanitizeCompanySvg, serializeCompanySvg } from "./companySvg.js";

const MAX_ICON_BYTES = 256 * 1024;

interface Props {
  icon: CompanyAgentIcon;
  color: string;
  onChange(patch: { icon?: CompanyAgentIcon; color?: string }): void;
}

/** 内置动态图标 + 你的图标库（上传的 SVG）+ 颜色。 */
export function CompanyIconPicker({ icon, color, onChange }: Props) {
  const { intl } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { companyService } = useServices();
  const library = useContext(CompanyIconLibraryContext);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_ICON_BYTES) return void toast(t("company.editor.iconTooBig"));
    // 先在本地清洗：存进图标库的就是干净的 SVG（渲染时还会再清洗一次）。
    const clean = sanitizeCompanySvg(await file.text());
    if (!clean) return void toast(t("company.editor.iconInvalid"));
    try {
      const added = await companyService.addIcon({
        name: file.name.replace(/\.svg$/i, ""),
        svg: serializeCompanySvg(clean),
      });
      await library.reload();
      onChange({ icon: added.id as CompanyAgentIcon });
      toast(t("company.editor.iconAdded"));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (id: string) => {
    try {
      await companyService.deleteIcon({ id });
      await library.reload();
      if (icon === id) onChange({ icon: "orbit" });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  };

  const tile = (id: CompanyAgentIcon, label: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={icon === id}
      aria-label={label}
      title={label}
      onClick={() => onChange({ icon: id })}
      className={cn(
        "rounded-xl p-1 ring-offset-2 transition-shadow",
        icon === id ? "ring-2 ring-foreground/60" : "hover:bg-hover",
      )}
    >
      <CompanyAvatar icon={id} color={color} size={40} />
    </button>
  );

  return (
    <Section title={t("company.editor.icon")} hint={t("company.editor.iconHint")}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("company.editor.icon")}>
        {COMPANY_ICON_IDS.map((id) => tile(id, id))}
      </div>
      {library.icons.length > 0 ? (
        <>
          <div className="text-ui-sm text-foreground-subtle">{t("company.editor.yourIcons")}</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("company.editor.yourIcons")}>
            {library.icons.map((custom) => (
              <span key={custom.id} className="group relative">
                {tile(custom.id as CompanyAgentIcon, custom.name)}
                <button
                  type="button"
                  aria-label={t("company.editor.deleteIcon", { name: custom.name })}
                  title={t("company.editor.deleteIcon", { name: custom.name })}
                  onClick={() => void remove(custom.id)}
                  className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-foreground text-background group-hover:flex focus-visible:flex"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div>
        <input ref={fileInput} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => void upload(e)} />
        <Button variant="outline" size="sm" data-icon="inline-start" onClick={() => fileInput.current?.click()}>
          <Upload className="size-3.5" />
          {t("company.editor.uploadIcon")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("company.editor.color")}>
        <span className="text-ui-sm text-foreground-subtle">{t("company.editor.color")}</span>
        {COMPANY_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => onChange({ color: c })}
            className="flex size-7 items-center justify-center rounded-full"
            style={{ background: c }}
          >
            {color === c ? <Check className="size-4 text-white" /> : null}
          </button>
        ))}
      </div>
    </Section>
  );
}
