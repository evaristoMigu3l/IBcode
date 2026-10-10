import { createContext, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { CompanyAgentIcon, CompanyCustomIcon, CompanyIconId } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { sanitizeCompanySvg } from "./companySvg.js";

// 同事头像：手绘的 40×40 SVG，动画由 styles.css 的 .cmp-* 类驱动（工作中加速 + 发光）。
const d = (seconds: number, delay = 0): CSSProperties =>
  ({ "--d": `${seconds}s`, animationDelay: `${delay}s` }) as CSSProperties;

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<CompanyIconId, ReactNode> = {
  orbit: (
    <>
      <circle cx="20" cy="20" r="5" fill="currentColor" />
      <ellipse cx="20" cy="20" rx="14" ry="6" {...stroke} opacity="0.45" transform="rotate(-25 20 20)" />
      <g className="cmp-spin" style={d(4)}>
        <circle cx="34" cy="20" r="2.8" fill="currentColor" />
      </g>
      <g className="cmp-spin" style={d(7)}>
        <circle cx="20" cy="7" r="1.6" fill="currentColor" opacity="0.6" />
      </g>
    </>
  ),
  pulse: (
    <>
      <circle className="cmp-ring" style={d(2.4)} cx="20" cy="20" r="11" {...stroke} />
      <circle className="cmp-ring" style={d(2.4, 1.2)} cx="20" cy="20" r="11" {...stroke} />
      <circle cx="20" cy="20" r="6" fill="currentColor" />
    </>
  ),
  radar: (
    <>
      <circle cx="20" cy="20" r="14" {...stroke} opacity="0.35" />
      <circle cx="20" cy="20" r="7.5" {...stroke} opacity="0.35" />
      <g className="cmp-spin" style={d(3)}>
        <path d="M20 20 L20 6 A14 14 0 0 1 32.1 13 Z" fill="currentColor" opacity="0.35" />
        <line x1="20" y1="20" x2="20" y2="6" {...stroke} />
      </g>
      <circle className="cmp-twinkle" style={d(3, 0.7)} cx="27" cy="12" r="2" fill="currentColor" />
      <circle cx="20" cy="20" r="2" fill="currentColor" />
    </>
  ),
  wave: (
    <>
      {[8, 14, 20, 26, 32].map((x, i) => (
        <rect
          key={x}
          className="cmp-bar"
          style={d(1.1, i * 0.15)}
          x={x - 1.75}
          y="9"
          width="3.5"
          height="22"
          rx="1.75"
          fill="currentColor"
        />
      ))}
    </>
  ),
  gear: (
    <>
      <g className="cmp-spin" style={d(9)}>
        <circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="5" strokeDasharray="4.3 4.34" />
        <circle cx="20" cy="20" r="9" fill="none" stroke="currentColor" strokeWidth="3" />
      </g>
      <circle cx="20" cy="20" r="3.2" fill="currentColor" opacity="0.6" />
    </>
  ),
  spark: (
    <>
      <path
        className="cmp-breathe"
        style={d(3)}
        d="M20 5 L23.2 16.8 L35 20 L23.2 23.2 L20 35 L16.8 23.2 L5 20 L16.8 16.8 Z"
        fill="currentColor"
      />
      <circle className="cmp-twinkle" style={d(1.8)} cx="31" cy="9" r="1.8" fill="currentColor" />
      <circle className="cmp-twinkle" style={d(1.8, 0.9)} cx="9" cy="31" r="1.4" fill="currentColor" />
    </>
  ),
  atom: (
    <>
      <g className="cmp-spin" style={d(10)}>
        {[0, 60, 120].map((angle) => (
          <ellipse key={angle} cx="20" cy="20" rx="15" ry="5.5" {...stroke} strokeWidth="1.6" opacity="0.7" transform={`rotate(${angle} 20 20)`} />
        ))}
        <circle cx="35" cy="20" r="2" fill="currentColor" />
        <circle cx="12.5" cy="7" r="2" fill="currentColor" />
      </g>
      <circle className="cmp-twinkle" style={d(2)} cx="20" cy="20" r="3.4" fill="currentColor" />
    </>
  ),
  prism: (
    <>
      <line x1="3" y1="23" x2="15" y2="20" {...stroke} opacity="0.6" />
      <path d="M20 7 L33 30 H7 Z" {...stroke} fill="currentColor" fillOpacity="0.15" />
      {[14, 20, 26].map((y, i) => (
        <line key={y} className="cmp-dash" style={d(1.2, i * 0.2)} x1="26" y1="20" x2="38" y2={y} {...stroke} opacity={1 - i * 0.25} />
      ))}
    </>
  ),
  helix: (
    <>
      <path className="cmp-dash" style={d(1.6)} d="M6 12 C13 12 13 28 20 28 S27 12 34 12" {...stroke} />
      <path className="cmp-dash" style={d(1.6, 0.4)} d="M6 28 C13 28 13 12 20 12 S27 28 34 28" {...stroke} opacity="0.6" />
      {[10, 20, 30].map((x) => (
        <line key={x} x1={x} y1="15" x2={x} y2="25" {...stroke} strokeWidth="1.4" opacity="0.35" />
      ))}
    </>
  ),
  cube: (
    <>
      <path d="M20 6 L32 13 V27 L20 34 L8 27 V13 Z" {...stroke} fill="currentColor" fillOpacity="0.12" />
      <path className="cmp-dash" style={d(1.8)} d="M8 13 L20 20 L32 13 M20 20 V34" {...stroke} />
      <circle className="cmp-twinkle" style={d(2.2)} cx="20" cy="20" r="1.8" fill="currentColor" />
    </>
  ),
  compass: (
    <>
      <circle cx="20" cy="20" r="14" {...stroke} opacity="0.45" />
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1="20" y1="7" x2="20" y2="9.5" {...stroke} transform={`rotate(${a} 20 20)`} />
      ))}
      <g className="cmp-swing" style={d(3.2)}>
        <path d="M20 9 L23 20 L17 20 Z" fill="currentColor" />
        <path d="M20 31 L23 20 L17 20 Z" fill="currentColor" opacity="0.35" />
      </g>
      <circle cx="20" cy="20" r="1.8" fill="currentColor" />
    </>
  ),
  bolt: (
    <>
      <circle className="cmp-ring" style={d(2.6)} cx="20" cy="20" r="12" {...stroke} strokeWidth="1.5" />
      <path className="cmp-flicker" style={d(2.4)} d="M22.5 5 L10.5 22.5 H19 L16.5 35 L29.5 16.5 H21 Z" fill="currentColor" />
    </>
  ),
};

/** 图标库列表与刷新（编辑器上传/删除后调用 reload）。由 CompanyPage 提供。 */
export const CompanyIconLibraryContext = createContext<{
  icons: CompanyCustomIcon[];
  reload(): Promise<void>;
}>({ icons: [], reload: async () => undefined });

/** 图标库：custom:<id> -> 已清洗的 SVG 文本。由 CompanyPage 提供。 */
export const CompanyIconsContext = createContext<ReadonlyMap<string, string>>(new Map());

const SHADOW_STYLE =
  ":host{display:block;width:100%;height:100%}svg{display:block;width:100%;height:100%;overflow:visible}" +
  "@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}";

/** 自定义图标放进独立 shadow root：图标里的 <style> 只作用于自己，:hover 等交互照常生效。 */
function CustomSvgIcon({ markup }: { markup: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const svg = sanitizeCompanySvg(markup);
    const style = document.createElement("style");
    style.textContent = SHADOW_STYLE;
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      root.replaceChildren(style, svg);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) svg.pauseAnimations?.();
    } else {
      root.replaceChildren(style);
    }
  }, [markup]);
  return <span ref={host} className="cmp-custom" />;
}

export interface CompanyAvatarProps {
  icon: CompanyAgentIcon;
  color: string;
  size?: number;
  active?: boolean;
  className?: string;
  label?: string;
}

export function CompanyAvatar({ icon, color, size = 32, active = false, className, label }: CompanyAvatarProps) {
  const icons = useContext(CompanyIconsContext);
  const custom = icon.startsWith("custom:") ? icons.get(icon) : undefined;
  return (
    <span
      className={cn("cmp-avatar", className)}
      data-active={active}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ "--cmp-color": color, width: size, height: size } as CSSProperties}
    >
      {custom ? (
        <CustomSvgIcon markup={custom} />
      ) : (
        <svg viewBox="0 0 40 40" focusable="false">
          {ICONS[icon as CompanyIconId] ?? ICONS.orbit}
        </svg>
      )}
    </span>
  );
}
