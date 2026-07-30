// Plugin hook bus (v0.9.9 — "unlimited power" pass).
//
// Central interception point for core data operations. Plugins register
// FILTERS (can transform the payload or return null to BLOCK the
// operation) and LISTENERS (notified after the fact). The bus is wired
// into `lib/storage.ts` — the single choke point every game/note write
// already flows through (store actions, NoteCenter, quick capture, and
// plugins' own hv.saveNote all end up there), so instrumenting it once
// covers the whole app.
//
// This module is deliberately dependency-free (type-only imports) so it
// can sit BELOW storage.ts in the import graph without cycles:
//   pluginHooks  ←  storage  ←  store / plugins / UI
//
// Failure containment: a throwing filter is skipped (logged), it does
// NOT abort the chain — a buggy plugin must never brick saving. Only an
// explicit `null` return blocks.

import type { GameRecord, NoteRecord } from "../types";

/** Hook name → payload type. `before*` hooks run as filters; `after*`
 *  hooks are notify-only events. Delete hooks carry the record id. */
export interface HookPayloads {
  "game:beforeSave": GameRecord;
  "game:afterSave": GameRecord;
  "game:beforeDelete": string;
  "game:afterDelete": string;
  "note:beforeSave": NoteRecord;
  "note:afterSave": NoteRecord;
  "note:beforeDelete": string;
  "note:afterDelete": string;
}
export type HookName = keyof HookPayloads;

type FilterFn<T> = (payload: T) => T | null | Promise<T | null>;
type ListenFn<T> = (payload: T) => void;

interface Registration<F> { pluginId: string; fn: F }

const filterMap = new Map<HookName, Registration<FilterFn<unknown>>[]>();
const listenMap = new Map<HookName, Registration<ListenFn<unknown>>[]>();

function push<F>(map: Map<HookName, Registration<F>[]>, hook: HookName, reg: Registration<F>): () => void {
  const list = map.get(hook) ?? [];
  list.push(reg);
  map.set(hook, list);
  return () => {
    const cur = map.get(hook);
    if (!cur) return;
    const i = cur.indexOf(reg);
    if (i >= 0) cur.splice(i, 1);
  };
}

export function addHookFilter<K extends HookName>(
  pluginId: string,
  hook: K,
  fn: FilterFn<HookPayloads[K]>,
): () => void {
  return push(filterMap, hook, { pluginId, fn: fn as FilterFn<unknown> });
}

export function addHookListener<K extends HookName>(
  pluginId: string,
  hook: K,
  fn: ListenFn<HookPayloads[K]>,
): () => void {
  return push(listenMap, hook, { pluginId, fn: fn as ListenFn<unknown> });
}

/** Drop every registration a plugin made — called on deactivate. */
export function removePluginHooks(pluginId: string): void {
  for (const map of [filterMap, listenMap] as const) {
    for (const [hook, list] of map) {
      map.set(hook, list.filter((r) => r.pluginId !== pluginId));
    }
  }
}

/** Run the filter chain. Returns the (possibly transformed) payload, or
 *  `null` when a filter explicitly blocked the operation. */
export async function applyHookFilters<K extends HookName>(
  hook: K,
  payload: HookPayloads[K],
): Promise<HookPayloads[K] | null> {
  const list = filterMap.get(hook);
  if (!list || list.length === 0) return payload;
  let current: unknown = payload;
  for (const reg of [...list]) {
    try {
      const next = await reg.fn(current);
      if (next === null) return null; // explicit block
      if (next !== undefined) current = next;
    } catch (err) {
      // A crashing plugin must never break saving — skip it.
      console.warn(`[plugin-hooks] ${reg.pluginId} filter (${hook}) threw:`, err);
    }
  }
  return current as HookPayloads[K];
}

/** Fire-and-forget notification after an operation completed. */
export function emitHookEvent<K extends HookName>(hook: K, payload: HookPayloads[K]): void {
  const list = listenMap.get(hook);
  if (!list) return;
  for (const reg of [...list]) {
    try { reg.fn(payload); }
    catch (err) { console.warn(`[plugin-hooks] ${reg.pluginId} listener (${hook}) threw:`, err); }
  }
}

/** True when at least one filter is registered — lets hot paths skip
 *  the async ceremony entirely when no plugin cares. */
export function hasHookFilters(hook: HookName): boolean {
  return (filterMap.get(hook)?.length ?? 0) > 0;
}
