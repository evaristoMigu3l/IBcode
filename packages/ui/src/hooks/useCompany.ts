import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanyCustomIcon, CompanyMessage, CompanyState } from "@zcode/shared";
import { useServices } from "./useServices.js";

const STATE_POLL_MS = 3000;
const MESSAGES_POLL_MS = 2000;

/** Company 页面打开期间轮询状态（同事、运行状态）；页面关闭即停止，后台不占资源。 */
export function useCompanyState() {
  const { companyService } = useServices();
  const [state, setState] = useState<CompanyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await companyService.getState());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [companyService]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), STATE_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { state, error, refresh };
}

/** 增量拉取一个频道的消息（按时间戳游标）。 */
export function useCompanyMessages(channel: string) {
  const { companyService } = useServices();
  const [messages, setMessages] = useState<CompanyMessage[]>([]);
  const cursor = useRef(0);
  // 切换频道后，上一个频道迟到的响应必须丢弃，不能混进新频道。
  const generation = useRef(0);

  const poll = useCallback(async () => {
    const started = generation.current;
    const next = await companyService.listMessages({ channel, since: cursor.current }).catch(() => []);
    if (started !== generation.current || next.length === 0) return;
    cursor.current = Math.max(cursor.current, ...next.map((m) => m.ts));
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...next.filter((m) => !seen.has(m.id))];
    });
  }, [channel, companyService]);

  /** 频道被清空后丢掉本地已加载的消息，从头重新拉取。 */
  const reset = useCallback(() => {
    generation.current += 1;
    cursor.current = 0;
    setMessages([]);
  }, []);

  useEffect(() => {
    reset();
    void poll();
    const timer = setInterval(() => void poll(), MESSAGES_POLL_MS);
    return () => clearInterval(timer);
  }, [poll, reset]);

  return { messages, poll, reset };
}

/** 图标库（自定义 SVG）。只在 Company 页面打开时加载；上传/删除后调用 reload。 */
export function useCompanyIcons() {
  const { companyService } = useServices();
  const [icons, setIcons] = useState<CompanyCustomIcon[]>([]);
  const reload = useCallback(async () => {
    setIcons(await companyService.listIcons().catch(() => []));
  }, [companyService]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { icons, reload };
}
