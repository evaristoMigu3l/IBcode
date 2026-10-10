// 用户上传的同事图标：用浏览器自带的 XML 解析器解析，再按白名单清洗。
// 保留绘图、渐变、滤镜、<style> 和 SMIL 动画（CSS 动画与 :hover 交互照常工作）；
// 去掉脚本、foreignObject、外部图片/链接、所有 on* 事件和指向文件外部的 url()。
// 渲染时放进独立的 shadow root，图标里的 CSS 不会影响 app 其他部分。

const SVG_NS = "http://www.w3.org/2000/svg";

const ALLOWED_TAGS = new Set(
  [
    "svg", "g", "defs", "symbol", "use", "title", "desc", "style", "switch", "view",
    "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
    "text", "tspan", "textPath",
    "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
    "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
    "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood",
    "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feMerge", "feMergeNode",
    "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile",
    "feTurbulence",
    "animate", "animateMotion", "animateTransform", "set", "mpath",
  ].map((t) => t.toLowerCase()),
);

const ANIMATION_TAGS = new Set(["animate", "animatemotion", "animatetransform", "set"]);

/** 外链资源（追踪/泄露）、旧式脚本注入：一律视为不安全。 */
export function isUnsafeSvgValue(value: string): boolean {
  return /@import|url\(\s*['"]?\s*(?!#)|expression\s*\(|(java|vb)script\s*:|data\s*:/i.test(value);
}

function cleanElement(el: Element): void {
  // 遍历时会删除属性/子节点：先拷贝成数组，避免 live 集合跳项。
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const isLink = attr.localName.toLowerCase() === "href";
    if (
      name.startsWith("on") ||
      (isLink && !attr.value.trim().startsWith("#")) ||
      (!isLink && isUnsafeSvgValue(attr.value))
    ) {
      el.removeAttributeNode(attr);
    }
  }
  if (el.localName.toLowerCase() === "style" && isUnsafeSvgValue(el.textContent ?? "")) {
    el.textContent = "";
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      const tag = child.localName.toLowerCase();
      const animatesLink =
        ANIMATION_TAGS.has(tag) && /^\s*(xlink:)?href\s*$|^\s*on/i.test(child.getAttribute("attributeName") ?? "");
      if (child.namespaceURI !== SVG_NS || !ALLOWED_TAGS.has(tag) || animatesLink) child.remove();
      else cleanElement(child);
    } else if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.CDATA_SECTION_NODE) {
      node.remove(); // 注释、处理指令（如 xml-stylesheet）
    }
  }
}

const cache = new Map<string, SVGSVGElement | null>();

/** 返回清洗后的 <svg>（每次调用拿到独立副本），无效输入返回 null。 */
export function sanitizeCompanySvg(markup: string): SVGSVGElement | null {
  if (!cache.has(markup)) {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = doc.documentElement;
    const ok =
      !doc.getElementsByTagName("parsererror").length &&
      root.localName === "svg" &&
      root.namespaceURI === SVG_NS;
    if (ok) cleanElement(root);
    if (cache.size > 200) cache.clear();
    cache.set(markup, ok ? (root as unknown as SVGSVGElement) : null);
  }
  const clean = cache.get(markup);
  return clean ? (document.importNode(clean, true) as SVGSVGElement) : null;
}

export function serializeCompanySvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}
