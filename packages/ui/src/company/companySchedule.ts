// 例行任务的友好排程 <-> 5 段 cron。

export type SchedulePreset = "hourly" | "every4h" | "daily" | "weekdays" | "weekly" | "custom";

export const SCHEDULE_PRESETS: SchedulePreset[] = ["hourly", "every4h", "daily", "weekdays", "weekly", "custom"];

export interface ScheduleParts {
  preset: SchedulePreset;
  hour: number;
  minute: number;
  weekday: number;
  cron: string;
}

export function cronFromParts(p: ScheduleParts): string {
  const m = p.minute;
  const h = p.hour;
  switch (p.preset) {
    case "hourly":
      return `${m} * * * *`;
    case "every4h":
      return `${m} */4 * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${p.weekday}`;
    default:
      return p.cron;
  }
}

export function partsFromCron(cron: string): ScheduleParts {
  const base = { hour: 9, minute: 0, weekday: 1, cron };
  const f = cron.trim().split(/\s+/);
  const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined);
  if (f.length !== 5 || num(f[0]) === undefined || f[2] !== "*" || f[3] !== "*") {
    return { ...base, preset: "custom" };
  }
  const minute = num(f[0])!;
  if (f[1] === "*" && f[4] === "*") return { ...base, minute, preset: "hourly" };
  if (f[1] === "*/4" && f[4] === "*") return { ...base, minute, preset: "every4h" };
  const hour = num(f[1]);
  if (hour === undefined) return { ...base, preset: "custom" };
  if (f[4] === "*") return { ...base, minute, hour, preset: "daily" };
  if (f[4] === "1-5") return { ...base, minute, hour, preset: "weekdays" };
  const weekday = num(f[4]);
  return weekday !== undefined && weekday <= 6
    ? { ...base, minute, hour, weekday, preset: "weekly" }
    : { ...base, preset: "custom" };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
