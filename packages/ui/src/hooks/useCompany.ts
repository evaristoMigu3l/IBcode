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
export type CompanyIconWithSrc = CompanyCustomIcon & { src?: string };

export function useCompanyIcons() {
  const { companyService } = useServices();
  const [icons, setIcons] = useState<CompanyIconWithSrc[]>([]);
  // 动图图标转成 blob URL：多个头像共享同一份数据，而不是每个元素都带一份几 MB 的 data URL。
  const blobUrls = useRef(new Map<string, string>());
  const reload = useCallback(async () => {
    const list = await companyService.listIcons().catch(() => []);
    const next = await Promise.all(
      list.map(async (icon): Promise<CompanyIconWithSrc> => {
        if (!icon.dataUrl) return icon;
        let src = blobUrls.current.get(icon.id);
        if (!src) {
          src = URL.createObjectURL(await (await fetch(icon.dataUrl)).blob());
          blobUrls.current.set(icon.id, src);
        }
        return { ...icon, dataUrl: undefined, src };
      }),
    );
    for (const [id, url] of blobUrls.current) {
      if (!next.some((i) => i.id === id)) {
        URL.revokeObjectURL(url);
        blobUrls.current.delete(id);
      }
    }
    setIcons(next);
  }, [companyService]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const urls = blobUrls.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  return { icons, reload };
}
