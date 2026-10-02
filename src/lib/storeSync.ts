// Store data sync (v0.9.9).
//
// One place that fetches store numbers, shared by:
//   * Store Center (its Refresh button and first load);
//   * the background sync from Settings → API keys → "Sync interval",
//     which refreshes each store on its own schedule while the app is
//     open, so Store Center opens on fresh numbers and the daily trend
//     fills even on days the page isn't visited.
//
// Results are kept in memory per store target; listeners hear about
// updates through the `heravex:store-sync` window event.

import { useEffect, useRef } from "react";
import { fetchStoreData } from "./storage";
import { recordSnapshot } from "./storeHubHistory";
import type { GameRecord, StoreProvider } from "../types";

export type MetricKey = "views" | "downloads" | "purchases" | "earnings" | "wishlist" | "currentPlayers";

export type AggregateRow = {
  gameId: string;
  title: string;
  cover: string | null;
  provider: StoreProvider;
  // null = this store does not report the metric
  views: number | null;
  downloads: number | null;
  purchases: number | null;
  wishlist: number | null;
  earnings: number | null;
  currency: string | null;
  currentPlayers: number | null;
  ratingAverage: number | null;
  ratingCount: number | null;
  lastNewsTitle: string | null;
  lastNewsUrl: string | null;
  lastNewsAt: string | null;
  activeInstalls: number | null;
  uninstalls: number | null;
  error?: string;
};

export type StoreTarget = { gameId: string; title: string; cover: string | null; provider: StoreProvider; id: string };

/** Metrics each store REALLY reports. The backend fills some fields with
 *  stand-ins (Google Play puts the review count into views/purchases,
 *  Steam puts recommendations into purchases); counting those would
 *  invent numbers, so they are dropped here. */
export const REPORTS: Record<StoreProvider, ReadonlySet<MetricKey>> = {
  itch: new Set<MetricKey>(["views", "downloads", "purchases", "earnings"]),
  steam: new Set<MetricKey>(["wishlist", "currentPlayers"]),
  play: new Set<MetricKey>(["downloads"]),
};

export const STORE_PROVIDERS: StoreProvider[] = ["itch", "steam", "play"];

export function mappedStoreTargets(games: GameRecord[]): StoreTarget[] {
  const out: StoreTarget[] = [];
  for (const g of games) {
    const m = g.storeMappings ?? {};
    const cover = g.coverDataUrl ?? null;
    if (m.itch?.id) out.push({ gameId: g.id, title: g.title, cover, provider: "itch", id: m.itch.id });
    if (m.steam?.id) out.push({ gameId: g.id, title: g.title, cover, provider: "steam", id: m.steam.id });
    if (m.play?.id) out.push({ gameId: g.id, title: g.title, cover, provider: "play", id: m.play.id });
  }
  return out;
}

const n0 = (v: number | null | undefined) => v ?? 0;
const keyOf = (t: { provider: StoreProvider; id: string }) => `${t.provider}:${t.id}`;

async function fetchRow(target: StoreTarget): Promise<AggregateRow> {
  const base = { gameId: target.gameId, title: target.title, cover: target.cover, provider: target.provider };
  try {
    const data = await fetchStoreData(target.provider, target.id);
    const reports = REPORTS[target.provider];
    const pick = (k: MetricKey, v: number | null | undefined) => (reports.has(k) ? v ?? 0 : null);
    // Play: "downloads" is only real when the reporting API returned
    // active installs; otherwise the backend fell back to reviews.
    const playFallback = target.provider === "play" && data.activeInstalls == null;
    return {
      ...base,
      views: pick("views", data.views),
      downloads: playFallback ? null : pick("downloads", data.downloads),
      purchases: pick("purchases", data.purchases),
      wishlist: pick("wishlist", data.wishlist),
      earnings: pick("earnings", data.earnings),
      currency: data.currency ?? null,
      currentPlayers: pick("currentPlayers", data.currentPlayers),
      ratingAverage: data.ratingAverage ?? null,
      ratingCount: data.ratingCount ?? null,
      lastNewsTitle: data.lastNewsTitle ?? null,
      lastNewsUrl: data.lastNewsUrl ?? null,
      lastNewsAt: data.lastNewsAt ?? null,
      activeInstalls: data.activeInstalls ?? null,
      uninstalls: data.uninstalls ?? null,
    };
  } catch (err) {
    return {
      ...base,
      views: null, downloads: null, purchases: null, wishlist: null, earnings: null,
      currency: null, currentPlayers: null, ratingAverage: null, ratingCount: null,
      lastNewsTitle: null, lastNewsUrl: null, lastNewsAt: null,
      activeInstalls: null, uninstalls: null,
      error: String(err),
    };
  }
}

// ── In-memory results ──────────────────────────────────────────────────

const cache = new Map<string, { row: AggregateRow; at: number }>();

/** Cached rows for these targets (title / cover from the current game),
 *  or null when any target has never been fetched. */
export function cachedRows(targets: StoreTarget[]): { rows: AggregateRow[]; at: number } | null {
  if (targets.length === 0) return null;
  const rows: AggregateRow[] = [];
  let at = Infinity;
  for (const t of targets) {
    const hit = cache.get(keyOf(t));
    if (!hit) return null;
    rows.push({ ...hit.row, gameId: t.gameId, title: t.title, cover: t.cover });
    at = Math.min(at, hit.at);
  }
  return { rows, at };
}

/** Fetch these targets, update the cache, and record the day's history
 *  point when every mapped store has a good number. */
export async function syncTargets(targets: StoreTarget[], allTargets: StoreTarget[] = targets): Promise<AggregateRow[]> {
  const rows = await Promise.all(targets.map(fetchRow));
  const now = Date.now();
  rows.forEach((r, i) => cache.set(keyOf(targets[i]), { row: r, at: now }));
  const all = cachedRows(allTargets);
  // Only a complete, error-free set becomes a history point; a failed
  // store would otherwise show up as a fake drop in the trend.
  if (all && all.rows.every((r) => !r.error)) {
    const sum = (k: MetricKey) => all.rows.reduce((acc, r) => acc + n0(r[k]), 0);
    recordSnapshot({
      views: sum("views"),
      downloads: sum("downloads"),
      purchases: sum("purchases"),
      earnings: sum("earnings"),
      wishlist: sum("wishlist"),
      currentPlayers: sum("currentPlayers"),
    });
  }
  window.dispatchEvent(new CustomEvent("heravex:store-sync", { detail: { providers: [...new Set(targets.map((t) => t.provider))] } }));
  return rows;
}

/** Test helper. */
export function _resetStoreSyncCache() {
  cache.clear();
}

// ── Background schedule (Settings → API keys → Sync interval) ──────────

/** Minutes between background syncs per store; 0 = only when Store
 *  Center refreshes. */
export type StoreSyncPrefs = Record<StoreProvider, number>;
export const SYNC_INTERVAL_OPTIONS = [0, 15, 60, 360, 1440] as const;
const KEY_PREFS = "heravex_store_sync_v1";
const KEY_LAST = "heravex_store_sync_last_v1";
export const DEFAULT_STORE_SYNC: StoreSyncPrefs = { itch: 0, steam: 0, play: 0 };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function loadStoreSyncPrefs(): StoreSyncPrefs {
  return readJson(KEY_PREFS, DEFAULT_STORE_SYNC);
}
export function saveStoreSyncPrefs(p: StoreSyncPrefs) {
  try { localStorage.setItem(KEY_PREFS, JSON.stringify(p)); } catch { /* quota */ }
}

/** Providers whose interval has passed. Pure for testing. */
export function dueProviders(prefs: StoreSyncPrefs, last: Partial<Record<StoreProvider, number>>, now: number): StoreProvider[] {
  return STORE_PROVIDERS.filter((p) => prefs[p] > 0 && now - (last[p] ?? 0) >= prefs[p] * 60_000);
}

/** Run the schedule: checks once a minute while the app is open. */
export function useStoreAutoSync(games: GameRecord[], enabled: boolean) {
  // Read games through a ref: saving any game must not restart the timers.
  const gamesRef = useRef(games);
  gamesRef.current = games;
  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      const targets = mappedStoreTargets(gamesRef.current);
      if (targets.length === 0) return;
      const last = readJson<Partial<Record<StoreProvider, number>>>(KEY_LAST, {});
      const now = Date.now();
      const due = dueProviders(loadStoreSyncPrefs(), last, now)
        .filter((p) => targets.some((t) => t.provider === p));
      if (due.length === 0) return;
      running = true;
      try {
        await syncTargets(targets.filter((t) => due.includes(t.provider)), targets);
        const next = { ...last };
        for (const p of due) next[p] = now;
        try { localStorage.setItem(KEY_LAST, JSON.stringify(next)); } catch { /* quota */ }
      } finally {
        running = false;
      }
    };
    // First check shortly after launch, then every minute.
    const first = window.setTimeout(() => void tick(), 20_000);
    const id = window.setInterval(() => void tick(), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [enabled]);
}
