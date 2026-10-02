// Daily store-metric snapshots for the Store Center trend chart.
//
// Store APIs (Steam, Itch.io, Google Play) give HeraVex current totals,
// not history. To draw a trend we keep one snapshot per calendar day on
// THIS machine (localStorage), written after every fully successful sync.
// Nothing leaves the device. A partial sync (one store failed) is never
// recorded, otherwise the chart would show a fake dip.

export interface StoreSnapshot {
  /** Local calendar day, `YYYY-MM-DD`. One snapshot per day (last sync wins). */
  day: string;
  views: number;
  downloads: number;
  purchases: number;
  earnings: number;
  wishlist: number;
  currentPlayers: number;
}

export type SnapshotMetrics = Omit<StoreSnapshot, "day">;

const KEY = "heravex_storehub_history_v1";
const MAX_DAYS = 180;

export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSnapshot(v: unknown): v is StoreSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.day === "string" && typeof s.views === "number" && typeof s.downloads === "number";
}

export function loadHistory(): StoreSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSnapshot)
      .map((s) => ({
        day: s.day,
        views: s.views,
        downloads: s.downloads,
        purchases: s.purchases ?? 0,
        earnings: s.earnings ?? 0,
        wishlist: s.wishlist ?? 0,
        currentPlayers: s.currentPlayers ?? 0,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
  } catch {
    return [];
  }
}

/** Upsert today's snapshot and return the full, sorted history. */
export function recordSnapshot(metrics: SnapshotMetrics, now: Date = new Date()): StoreSnapshot[] {
  const today = dayKey(now);
  const next = loadHistory().filter((s) => s.day !== today);
  next.push({ day: today, ...metrics });
  next.sort((a, b) => a.day.localeCompare(b.day));
  const trimmed = next.slice(-MAX_DAYS);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / storage blocked: the chart just won't grow */
  }
  return trimmed;
}

/** Latest snapshot from a day BEFORE today (the delta baseline), if any. */
export function previousSnapshot(history: StoreSnapshot[], now: Date = new Date()): StoreSnapshot | null {
  const today = dayKey(now);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].day < today) return history[i];
  }
  return null;
}
