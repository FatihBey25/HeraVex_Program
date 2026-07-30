// Flow Center model (v0.9.8 — Faz 1).
//
// A "flow" is a node/edge graph stored as one atomic file at
// `workspace/flows/{id}.json`. The shapes below are the *persistence*
// contract — deliberately decoupled from React Flow's own Node/Edge
// types so we never serialise its transient runtime fields (selected,
// dragging, measured, …). FlowCanvas maps between these and React
// Flow's types at the edges of the component.
//
// Scope: a flow optionally carries `gameId` (null = studio-level),
// mirroring NoteCenter's Studio / Projects split.

export type FlowKind = "gamedesign" | "narrative" | "taskgraph" | "freeform";
export type FlowNodeType =
  | "card" | "sticky" | "group" | "lane" | "ref" | "date" | "decision"
  | "comment" | "image" | "link" | "progress" | "choice";

/** Container nodes that hold child nodes via parentId. */
export const CONTAINER_TYPES = new Set<FlowNodeType>(["group", "lane"]);
export type RefModule = "task" | "note" | "moodboard";

export interface FlowNodeData {
  label?: string;
  /** Body / content text shown under the header (card + decision). */
  body?: string;
  /** Accent hex; border/title tint derive from it. */
  color?: string;
  /** Date nodes: ISO yyyy-mm-dd value. */
  date?: string;
  /** Image src (path or URL) for image nodes; href for link nodes. */
  url?: string;
  /** Progress nodes: 0..100. */
  progress?: number;
  /** Choice nodes: branch labels (each gets its own source handle). */
  choices?: string[];
  // ── ref nodes only (Faz 2) ──
  refModule?: RefModule;
  refId?: string;
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  /** When set, this node lives inside a group node (React Flow sub-flow);
   *  position is then relative to the parent. */
  parentId?: string | null;
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  label?: string;
  animated?: boolean;
}

export interface Flow {
  id: string;
  name: string;
  type: FlowKind;
  /** null / undefined = studio-level; otherwise the owning game's id. */
  gameId?: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: { x: number; y: number; zoom: number };
  /** Manual sidebar order within a scope (lower first); ties break on
   *  updatedAt desc. Set by drag-reorder, mirroring NoteCenter. */
  order?: number;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
}

export const FLOW_PALETTE = [
  "#4f8cff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b",
] as const;

/** Default size per node kind — sticky notes are squarer, groups large. */
export const NODE_DEFAULTS: Record<FlowNodeType, { w: number; h: number; color: string }> = {
  card:     { w: 200, h: 104, color: FLOW_PALETTE[0] },
  sticky:   { w: 180, h: 130, color: FLOW_PALETTE[2] },
  group:    { w: 420, h: 280, color: FLOW_PALETTE[5] },
  lane:     { w: 720, h: 200, color: FLOW_PALETTE[0] },
  ref:      { w: 210, h: 90,  color: FLOW_PALETTE[1] },
  date:     { w: 170, h: 84,  color: FLOW_PALETTE[4] },
  decision: { w: 200, h: 96,  color: FLOW_PALETTE[3] },
  comment:  { w: 210, h: 86,  color: FLOW_PALETTE[2] },
  image:    { w: 210, h: 170, color: FLOW_PALETTE[5] },
  link:     { w: 220, h: 72,  color: FLOW_PALETTE[1] },
  progress: { w: 210, h: 90,  color: FLOW_PALETTE[1] },
  choice:   { w: 210, h: 120, color: FLOW_PALETTE[4] },
};

export function flowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const ts = () => new Date().toISOString();

export function makeFlow(name: string, type: FlowKind = "freeform", gameId: string | null = null): Flow {
  const now = ts();
  return {
    id: "",
    name,
    type,
    gameId,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeNode(
  type: FlowNodeType,
  x: number,
  y: number,
  label: string,
  data: Partial<FlowNodeData> = {},
): FlowNode {
  const d = NODE_DEFAULTS[type];
  const seeded: Partial<FlowNodeData> =
    type === "date" ? { date: new Date().toISOString().slice(0, 10) } :
    type === "progress" ? { progress: 50 } :
    type === "choice" ? { choices: ["A", "B", "C"] } : {};
  return {
    id: flowId("n"),
    type,
    position: { x: Math.round(x), y: Math.round(y) },
    width: d.w,
    height: d.h,
    data: { label, color: d.color, ...seeded, ...data },
  };
}

/** Tolerant parse — bad / partial JSON yields null so the caller can
 *  skip or recover rather than crashing the list. */
export function parseFlow(raw: string | null | undefined): Flow | null {
  if (!raw || !raw.trim()) return null;
  try {
    const f = JSON.parse(raw) as Partial<Flow>;
    if (!f || typeof f.id !== "string" || !Array.isArray(f.nodes) || !Array.isArray(f.edges)) {
      return null;
    }
    return normalizeFlow(f as Flow);
  } catch {
    return null;
  }
}

/** Fill in any fields an older / hand-edited file may be missing so the
 *  canvas always receives a complete document. */
export function normalizeFlow(f: Flow): Flow {
  return {
    id: f.id,
    name: f.name ?? "",
    type: f.type ?? "freeform",
    gameId: f.gameId ?? null,
    nodes: Array.isArray(f.nodes) ? f.nodes : [],
    edges: Array.isArray(f.edges) ? f.edges : [],
    viewport: f.viewport ?? { x: 0, y: 0, zoom: 1 },
    order: typeof f.order === "number" ? f.order : 0,
    schemaVersion: 1,
    createdAt: f.createdAt ?? ts(),
    updatedAt: f.updatedAt ?? ts(),
  };
}
