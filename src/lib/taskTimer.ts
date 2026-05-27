// Pomodoro/zaman takibi yardımcı fonksiyonları.
//
// Davranış kuralları:
//  • Görev tamamlanmamışken `runningSince` set → süre otomatik akar.
//  • Görev tamamlandı işaretlendiğinde: kalan delta `timeSpentSeconds`'a yazılır,
//    `runningSince = null`.
//  • Görev tekrar açıldığında: `runningSince = now`.
//  • UI saniyede 1 tick atar ama disk yazımı sadece state değişimlerinde olur.

import type { TaskItem } from "../types";
import type { AppLanguage } from "./i18n";

/** Effective elapsed seconds including the current running window. */
export function effectiveSeconds(task: Pick<TaskItem, "timeSpentSeconds" | "runningSince" | "done">): number {
  const base = task.timeSpentSeconds ?? 0;
  if (task.done || !task.runningSince) return base;
  const startedAt = Date.parse(task.runningSince);
  if (Number.isNaN(startedAt)) return base;
  const delta = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return base + delta;
}

/** Format seconds as "1h 23m" / "23m 14s" / "14s". */
export function formatDuration(seconds: number, language: AppLanguage): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  const labels: Record<AppLanguage, { h: string; m: string; s: string; zero: string }> = {
    tr: { h: "sa", m: "dk", s: "sn", zero: "Hiç" },
    en: { h: "h", m: "m", s: "s", zero: "None" },
    fr: { h: "h", m: "min", s: "s", zero: "Aucun" },
    es: { h: "h", m: "min", s: "s", zero: "Ninguno" },
  };
  const L = labels[language];

  if (s === 0) return L.zero;
  if (h > 0) return `${h}${L.h} ${m}${L.m}`;
  if (m > 0) return `${m}${L.m} ${sec}${L.s}`;
  return `${sec}${L.s}`;
}

/** Compact "00:23:14" formatting for live HUD style. */
export function formatHms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Sum of effective seconds across a list of tasks (used for per-game totals). */
export function sumEffectiveSeconds(
  tasks: Array<Pick<TaskItem, "timeSpentSeconds" | "runningSince" | "done">>,
): number {
  return tasks.reduce((acc, t) => acc + effectiveSeconds(t), 0);
}

/** React hook: re-renders the caller once per second, but only while
 *  `enabled` is true. Use this to live-update timer displays without
 *  global tickers. */
import { useEffect, useState } from "react";

export function useSecondTicker(enabled: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return tick;
}

/** Patch helpers — return a partial TaskItem suitable for spreading. */

/** Start (or resume) the timer on a non-done task. */
export function timerStart(task: TaskItem): Partial<TaskItem> {
  if (task.done) return {};
  if (task.runningSince) return {}; // already running
  return { runningSince: new Date().toISOString() };
}

/** Pause/freeze the timer, flushing the current window into timeSpentSeconds. */
export function timerPause(task: TaskItem): Partial<TaskItem> {
  if (!task.runningSince) return {};
  const startedAt = Date.parse(task.runningSince);
  if (Number.isNaN(startedAt)) return { runningSince: null };
  const delta = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return {
    timeSpentSeconds: (task.timeSpentSeconds ?? 0) + delta,
    runningSince: null,
  };
}
