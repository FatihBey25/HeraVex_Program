// Flow Center store (v0.9.8 — Faz 1).
//
// Holds the flow list + the active flow, and owns persistence. Graph
// mutations (node drag, edge add) land in memory instantly and are
// written to disk on a 500ms debounce so a drag doesn't hammer the
// filesystem (and, over a cloud folder, the team-sync manifest).
//
// Kept as its own Zustand store rather than a slice of the giant app
// store so Flow Center stays self-contained and lazy-loadable with its
// route chunk.

import { create } from "zustand";
import { loadFlows as apiLoadFlows, saveFlow as apiSaveFlow, deleteFlow as apiDeleteFlow, getAllNotes } from "../lib/storage";
import { makeFlow, type Flow, type FlowKind, type FlowNode, type FlowEdge } from "../lib/flow";
import type { NoteRecord } from "../types";

const SAVE_DEBOUNCE_MS = 500;

// Per-flow debounce timers (module scope so they survive re-renders).
const timers = new Map<string, ReturnType<typeof setTimeout>>();

interface GraphPatch {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  viewport?: Flow["viewport"];
}

interface FlowState {
  flows: Flow[];
  activeFlowId: string | null;
  loaded: boolean;
  /** Cache of global notes, loaded once so `ref` nodes can resolve note
   *  titles live without each node firing its own IPC. */
  refNotes: NoteRecord[];

  loadFlows: () => Promise<void>;
  loadRefNotes: () => Promise<void>;
  setActiveFlow: (id: string | null) => void;
  createFlow: (name: string, type: FlowKind, gameId?: string | null) => Promise<Flow | null>;
  renameFlow: (id: string, name: string) => void;
  /** Assign sidebar order from a scope's ordered id list (drag-reorder,
   *  mirroring NoteCenter). Each listed flow's `order` becomes its index. */
  reorderFlows: (orderedIds: string[]) => void;
  updateGraph: (id: string, patch: GraphPatch) => void;
  deleteFlow: (id: string) => Promise<void>;
  /** Force any pending debounced write for `id` to flush now (used on
   *  flow switch / unmount so nothing is lost). */
  flush: (id: string) => void;
  /** Merge on-disk flows back in WITHOUT clobbering the flow the user is
   *  currently editing — called when team-sync reports a flows file
   *  changed on disk. */
  syncExternal: () => Promise<void>;
}

function scheduleSave(get: () => FlowState, id: string) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    const flow = get().flows.find((f) => f.id === id);
    if (flow) void apiSaveFlow(flow).catch(() => { /* surfaced by next user action */ });
  }, SAVE_DEBOUNCE_MS));
}

export const useFlowStore = create<FlowState>((set, get) => ({
  flows: [],
  activeFlowId: null,
  loaded: false,
  refNotes: [],

  loadFlows: async () => {
    try {
      const flows = await apiLoadFlows();
      set({ flows, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  loadRefNotes: async () => {
    try {
      const notes = await getAllNotes();
      set({ refNotes: notes });
    } catch { /* ref notes stay empty; note refs render as orphaned */ }
  },

  setActiveFlow: (id) => {
    // Flush the previously-active flow before switching away.
    const prev = get().activeFlowId;
    if (prev && prev !== id) get().flush(prev);
    set({ activeFlowId: id });
  },

  createFlow: async (name, type, gameId = null) => {
    try {
      const draft = makeFlow(name, type, gameId);
      const saved = await apiSaveFlow(draft);
      set((s) => ({ flows: [saved, ...s.flows], activeFlowId: saved.id }));
      return saved;
    } catch {
      return null;
    }
  },

  renameFlow: (id, name) => {
    set((s) => ({
      flows: s.flows.map((f) => (f.id === id ? { ...f, name, updatedAt: new Date().toISOString() } : f)),
    }));
    scheduleSave(get, id);
  },

  reorderFlows: (orderedIds) => {
    set((s) => ({
      flows: s.flows.map((f) => {
        const idx = orderedIds.indexOf(f.id);
        return idx >= 0 ? { ...f, order: idx } : f;
      }),
    }));
    // Persist each reordered flow now (reorders are infrequent).
    const flows = get().flows;
    for (const id of orderedIds) {
      const f = flows.find((x) => x.id === id);
      if (f) void apiSaveFlow(f).catch(() => {});
    }
  },

  updateGraph: (id, patch) => {
    set((s) => ({
      flows: s.flows.map((f) =>
        f.id === id
          ? {
              ...f,
              nodes: patch.nodes ?? f.nodes,
              edges: patch.edges ?? f.edges,
              viewport: patch.viewport ?? f.viewport,
              updatedAt: new Date().toISOString(),
            }
          : f,
      ),
    }));
    scheduleSave(get, id);
  },

  deleteFlow: async (id) => {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
    try {
      await apiDeleteFlow(id);
    } catch { /* best-effort */ }
    set((s) => {
      const flows = s.flows.filter((f) => f.id !== id);
      const activeFlowId = s.activeFlowId === id ? (flows[0]?.id ?? null) : s.activeFlowId;
      return { flows, activeFlowId };
    });
  },

  flush: (id) => {
    const t = timers.get(id);
    if (!t) return;
    clearTimeout(t);
    timers.delete(id);
    const flow = get().flows.find((f) => f.id === id);
    if (flow) void apiSaveFlow(flow).catch(() => {});
  },

  syncExternal: async () => {
    try {
      const disk = await apiLoadFlows();
      const activeId = get().activeFlowId;
      set((s) => {
        // Keep the in-memory version of the flow being edited; adopt the
        // disk version for every other flow (and any newly-created ones).
        const active = s.flows.find((f) => f.id === activeId);
        const merged = disk.map((f) => (f.id === activeId && active ? active : f));
        if (active && !merged.some((f) => f.id === activeId)) merged.unshift(active);
        return { flows: merged };
      });
    } catch { /* ignore — next user action retries */ }
  },
}));
