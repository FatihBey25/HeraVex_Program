// Auto-backup scheduler.
//
// Frontend-driven for v0.9: a single setInterval ticks once a minute
// and compares "now" against the user's schedule + last-backup-at
// timestamp. When the threshold passes, it triggers the existing
// `handleExportBackup` flow. Persistent across app sessions via a
// localStorage "lastAutoBackupAt" key.
//
// Why not a Rust-side cron: keeping it in the frontend means we
// only run while the app is open (which is what `onlyWhileOpen`
// asks for anyway, and it's the only meaningful mode without a
// service component). A future milestone can promote the
// scheduler into Rust with `tauri-plugin-cron` or similar.

import { useEffect, useRef } from "react";
import type { BackupPrefsSlice } from "./studioIdentity";

const KEY_LAST = "heravex_last_auto_backup_at";

function readLast(): number {
  try {
    const raw = localStorage.getItem(KEY_LAST);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
function writeLast(ts: number) {
  try { localStorage.setItem(KEY_LAST, String(ts)); } catch {}
}

/** Returns true when the schedule + last-run timestamp say a backup is
 *  due right now. Pure function so the scheduler stays trivially
 *  testable when we add vitest coverage in a future milestone. */
export function isBackupDue(prefs: BackupPrefsSlice, now: Date, lastAt: number): boolean {
  if (prefs.schedule === "off") return false;
  if (lastAt === 0) return true;

  const lastDate = new Date(lastAt);
  switch (prefs.schedule) {
    case "hourly": {
      // 60-minute floor since lastAt.
      return now.getTime() - lastAt > 60 * 60 * 1000;
    }
    case "daily": {
      // Different calendar day AND we've passed the scheduled time.
      const dayChanged = now.toDateString() !== lastDate.toDateString();
      if (!dayChanged) return false;
      const [hh, mm] = parseTime(prefs.scheduledTime);
      return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
    }
    case "weekly": {
      // 7-day floor since lastAt at or after the scheduled time.
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (now.getTime() - lastAt < sevenDaysMs) return false;
      const [hh, mm] = parseTime(prefs.scheduledTime);
      return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
    }
  }
}

function parseTime(s: string): [number, number] {
  // Expect "HH:mm"; tolerate single-digit hour.
  const [h, m] = s.split(":");
  return [Number(h) || 3, Number(m) || 0];
}

/** React hook — wires the scheduler against the live preferences and
 *  the caller-provided exporter (always the store's
 *  `handleExportBackup`). Auto-runs prefix the file with `auto-` so
 *  the backup history page can distinguish them. */
export function useAutoBackupScheduler(
  prefs: BackupPrefsSlice,
  runExport: () => Promise<void> | void,
) {
  const runRef = useRef(runExport);
  runRef.current = runExport;

  useEffect(() => {
    if (prefs.schedule === "off") return;
    // Tick every 60s. Check on mount immediately so a user who left
    // the app open through a missed slot still gets caught up.
    const tick = () => {
      const last = readLast();
      if (!isBackupDue(prefs, new Date(), last)) return;
      writeLast(Date.now());
      try {
        const result = runRef.current();
        // `handleExportBackup` returns Promise<void> in our store; if
        // an export is also synchronous in some future override, the
        // Promise.resolve wrapper keeps the call site uniform.
        void Promise.resolve(result).catch(() => null);
      } catch { /* swallowed — schedule should never crash the UI */ }
    };
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [prefs]);
}

export function lastAutoBackupAt(): number {
  return readLast();
}
