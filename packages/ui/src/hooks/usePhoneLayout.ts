import { useSyncExternalStore } from "react";

// 手机布局阈值：与 Tailwind md 断点一致（<768px 时侧栏变抽屉、侧边面板全屏）。
const PHONE_QUERY = "(max-width: 767px)";

export function isPhoneLayout(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_QUERY).matches
    : false;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhoneLayout, () => false);
}
