// Flow Center canvas (v0.9.8 — Blueprint overhaul).
//
// Interaction model is now Unreal-Blueprint-style and right-click-first:
//   • right-click empty pane          → node-add menu at that spot
//   • drag a wire from a port to empty → node-add menu, new node auto-wires
//   • right-click a node              → context menu (edit / add-connected /
//                                        recolour / delete)
//   • right-click a wire              → straighten / curve / delete
//   • drop a node onto a group        → it becomes a child of that group
//
// The old top toolbar palette is gone. Persistence is still write-only
// into useFlowStore (debounced); the component never re-derives nodes
// from the store, so there's no feedback loop. NoteCenter-style: keyed
// by flow id so switching remounts cleanly.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, Controls, Panel, SelectionMode,
  applyNodeChanges, applyEdgeChanges, addEdge, reconnectEdge, useReactFlow, MarkerType,
  getNodesBounds, getViewportForBounds,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type Viewport,
  type FinalConnectionState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createPortal } from "react-dom";
import {
  Square, StickyNote, Calendar, GitFork, BoxSelect, Link2, X,
  ListChecks, FileText, Image as ImageIcon, Spline, Minus, Trash2, Plus, Pencil,
  MessageSquare, Gauge, List, Search, Tag, Download, LayoutGrid, Sparkles, Layers,
} from "lucide-react";
import * as dagre from "@dagrejs/dagre";
import { toPng } from "html-to-image";
import { flowNodeTypes } from "./FlowNodes";
import { useFlowStore } from "../../store/flowStore";
import { useAppStore } from "../../store";
import {
  makeNode, flowId, NODE_DEFAULTS, FLOW_PALETTE, CONTAINER_TYPES,
  type Flow, type FlowNode, type FlowNodeType, type FlowEdge, type FlowNodeData, type RefModule,
} from "../../lib/flow";
import { FLOW_TEMPLATES, buildTemplate, type FlowTemplateId } from "../../lib/flowTemplates";

type DataCb = (id: string, patch: Partial<FlowNodeData>) => void;

// Explicit arrowhead colour so PNG export renders it — the default
// marker inherits `context-stroke`, which resolves to transparent inside
// html-to-image's detached clone (that's why exported arrows vanished).
const ARROW = { type: MarkerType.ArrowClosed, color: "#93b4ff" };

// ── persistence ⇄ React Flow mapping ──────────────────────────────────
function toRFNode(n: FlowNode, onData: DataCb): Node {
  const isGroup = CONTAINER_TYPES.has(n.type);
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data, onData: (patch: Partial<FlowNodeData>) => onData(n.id, patch) },
    // Choice nodes grow with their option list — let content drive height.
    style: { width: n.width, height: n.type === "choice" ? undefined : n.height },
    ...(n.parentId ? { parentId: n.parentId, extent: "parent" as const } : {}),
    ...(isGroup ? { zIndex: 0 } : {}),
  };
}
function toRFNodes(flow: Flow, onData: DataCb): Node[] {
  // Groups MUST come before their children in the array (React Flow
  // requires parent-before-child) and render behind everything else.
  const groups = flow.nodes.filter((n) => CONTAINER_TYPES.has(n.type));
  const rest = flow.nodes.filter((n) => !CONTAINER_TYPES.has(n.type));
  return [...groups, ...rest].map((n) => toRFNode(n, onData));
}
function fromRFNodes(nodes: Node[]): FlowNode[] {
  return nodes.map((n) => {
    const d = (n.data ?? {}) as FlowNodeData;
    const style = (n.style ?? {}) as { width?: number; height?: number };
    return {
      id: n.id,
      type: (n.type ?? "card") as FlowNodeType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      // Prefer measured so NodeResizer changes (groups) persist.
      width: n.measured?.width ?? (style.width as number),
      height: n.measured?.height ?? (style.height as number),
      parentId: (n.parentId as string | undefined) ?? null,
      data: { label: d.label, body: d.body, color: d.color, date: d.date, refModule: d.refModule, refId: d.refId },
    };
  });
}
function toRFEdges(flow: Flow): Edge[] {
  return flow.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined,
    type: e.type ?? "smoothstep", label: e.label, animated: e.animated,
    markerEnd: ARROW,
  }));
}
function fromRFEdges(edges: Edge[]): FlowEdge[] {
  return edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
    type: typeof e.type === "string" ? e.type : "smoothstep",
    label: typeof e.label === "string" ? e.label : undefined,
    animated: e.animated,
  }));
}

// Node geometry helpers (for group hit-testing).
function dimOf(n: Node): { w: number; h: number } {
  const style = (n.style ?? {}) as { width?: number; height?: number };
  const def = NODE_DEFAULTS[(n.type ?? "card") as FlowNodeType];
  return {
    w: n.measured?.width ?? (style.width as number) ?? def.w,
    h: n.measured?.height ?? (style.height as number) ?? def.h,
  };
}
function absPos(n: Node, all: Node[]): { x: number; y: number } {
  if (n.parentId) {
    const p = all.find((x) => x.id === n.parentId);
    if (p) return { x: p.position.x + n.position.x, y: p.position.y + n.position.y };
  }
  return { x: n.position.x, y: n.position.y };
}

type Menu =
  | { kind: "add"; clientX: number; clientY: number; flowX: number; flowY: number; connect?: { source: string; sourceHandle?: string | null } }
  | { kind: "node"; clientX: number; clientY: number; nodeId: string }
  | { kind: "edge"; clientX: number; clientY: number; edgeId: string };

const ADD_ITEMS: { type: FlowNodeType; icon: typeof Square; label: [string, string] }[] = [
  { type: "card",     icon: Square,        label: ["Node", "Düğüm"] },
  { type: "decision", icon: GitFork,       label: ["Decision", "Karar"] },
  { type: "sticky",   icon: StickyNote,    label: ["Sticky note", "Yapışkan not"] },
  { type: "date",     icon: Calendar,      label: ["Date", "Tarih"] },
  { type: "choice",   icon: List,          label: ["Choice (multi)", "Seçim (çoklu)"] },
  { type: "lane",     icon: Layers,        label: ["Swimlane", "Kulvar"] },
  { type: "comment",  icon: MessageSquare, label: ["Comment", "Yorum"] },
  { type: "image",    icon: ImageIcon,     label: ["Image", "Görsel"] },
  { type: "link",     icon: Link2,         label: ["Link", "Bağlantı"] },
  { type: "progress", icon: Gauge,         label: ["Progress", "İlerleme"] },
];

function FlowCanvasInner({ flow, language }: { flow: Flow; language: string }) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const games = useAppStore((s) => s.games);
  const appearance = useAppStore((s) => s.appearance);
  const showToast = useAppStore((s) => s.showToast);
  const showMinimap = useAppStore((s) => s.layout.flowMinimap) ?? true;
  const multiKey = useAppStore((s) => s.layout.flowMultiSelectKey) ?? "Shift";
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const flowBg = appearance.flowBg ?? "dots";
  // "auto" follows the active theme accent so the canvas matches the app.
  const flowBgColor = (appearance.flowBgColor === "auto" || !appearance.flowBgColor)
    ? appearance.accentColor : appearance.flowBgColor;
  const refNotes = useFlowStore((s) => s.refNotes);
  const loadRefNotes = useFlowStore((s) => s.loadRefNotes);
  useEffect(() => { void loadRefNotes(); }, [loadRefNotes]);

  const onDataRef = useRef<DataCb>(() => {});
  const [nodes, setNodes] = useState<Node[]>(() => toRFNodes(flow, (id, p) => onDataRef.current(id, p)));
  const [edges, setEdges] = useState<Edge[]>(() => toRFEdges(flow));

  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<{ tab: RefModule } | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const clipboardRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  useEffect(() => { if (!menu) setAddQuery(""); }, [menu]);

  const groupsFirst = (list: Node[]) => [...list.filter((n) => CONTAINER_TYPES.has(n.type as FlowNodeType)), ...list.filter((n) => !CONTAINER_TYPES.has(n.type as FlowNodeType))];

  // ── Undo / redo history (Ctrl+Z / Ctrl+Y) ───────────────────────────
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  const histRef = useRef<{ past: string[]; future: string[]; last: string | null; applying: boolean }>({ past: [], future: [], last: null, applying: false });
  const histTimerRef = useRef<number | null>(null);
  const serializeCurrent = () => JSON.stringify({ nodes: fromRFNodes(nodesRef.current), edges: fromRFEdges(edgesRef.current) });
  // Coalesce rapid changes (drag, typing) into ~one history entry.
  const recordHistory = () => {
    if (histRef.current.applying) return;
    if (histTimerRef.current) clearTimeout(histTimerRef.current);
    histTimerRef.current = window.setTimeout(() => {
      const cur = serializeCurrent();
      const h = histRef.current;
      if (h.last !== null && cur !== h.last) {
        h.past.push(h.last);
        if (h.past.length > 80) h.past.shift();
        h.future = [];
      }
      h.last = cur;
    }, 350);
  };
  useEffect(() => { histRef.current.last = serializeCurrent(); /* baseline */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistNodes = useCallback((next: Node[]) => {
    useFlowStore.getState().updateGraph(flow.id, { nodes: fromRFNodes(next) });
    recordHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.id]);
  const persistEdges = useCallback((next: Edge[]) => {
    useFlowStore.getState().updateGraph(flow.id, { edges: fromRFEdges(next) });
    recordHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.id]);

  const onPatchData = useCallback<DataCb>((id, patch) => {
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      persistNodes(next);
      return next;
    });
  }, [persistNodes]);
  useEffect(() => { onDataRef.current = onPatchData; }, [onPatchData]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => { const next = applyNodeChanges(changes, prev); persistNodes(next); return next; });
  }, [persistNodes]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => { const next = applyEdgeChanges(changes, prev); persistEdges(next); return next; });
  }, [persistEdges]);
  const onConnect = useCallback((conn: Connection) => {
    setEdges((prev) => {
      const next = addEdge({ ...conn, type: "smoothstep", markerEnd: ARROW }, prev);
      persistEdges(next);
      return next;
    });
  }, [persistEdges]);
  const onReconnect = useCallback((oldEdge: Edge, newConn: Connection) => {
    setEdges((prev) => { const next = reconnectEdge(oldEdge, newConn, prev); persistEdges(next); return next; });
  }, [persistEdges]);
  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    useFlowStore.getState().updateGraph(flow.id, { viewport: vp });
  }, [flow.id]);

  // Drag a wire to empty space → open the add-menu wired to the source.
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
    if (conn.isValid) return; // landed on a handle; onConnect handled it
    const from = conn.fromNode?.id;
    if (!from) return;
    const me = event as MouseEvent;
    const p = rf.screenToFlowPosition({ x: me.clientX, y: me.clientY });
    setMenu({
      kind: "add", clientX: me.clientX, clientY: me.clientY, flowX: p.x, flowY: p.y,
      connect: { source: from, sourceHandle: conn.fromHandle?.id ?? null },
    });
  }, [rf]);

  // ── node / edge creation + mutation ─────────────────────────────────
  const pushNode = (fn: FlowNode, connectSource?: { source: string; sourceHandle?: string | null }) => {
    setNodes((prev) => {
      let next = [...prev, toRFNode(fn, (id, p) => onDataRef.current(id, p))];
      // keep groups first
      next = [...next.filter((n) => n.type === "group"), ...next.filter((n) => n.type !== "group")];
      persistNodes(next);
      return next;
    });
    if (connectSource) {
      setEdges((prev) => {
        const next = addEdge(
          { source: connectSource.source, sourceHandle: connectSource.sourceHandle ?? null, target: fn.id, targetHandle: null, type: "smoothstep", markerEnd: ARROW },
          prev,
        );
        persistEdges(next);
        return next;
      });
    }
  };

  const createFromAdd = (type: FlowNodeType) => {
    if (menu?.kind !== "add") return;
    const def = NODE_DEFAULTS[type];
    const fn = makeNode(type, menu.flowX, menu.flowY - def.h / 2, defaultLabel(type, tr));
    if (type === "group") {
      // Wrap the current selection if there is one; else drop an empty group.
      const sel = nodes.filter((n) => n.selected && !CONTAINER_TYPES.has(n.type as FlowNodeType)).map((n) => n.id);
      if (sel.length > 0) groupNodes(sel);
      else pushNode(fn);
      setMenu(null);
      return;
    }
    if (type === "lane") { pushNode(fn); setMenu(null); return; }
    if (menu.connect) { pushNode(fn, menu.connect); setMenu(null); return; }
    // No explicit source → if nodes are multi-selected, wire the new node
    // to every selected node (item 10: ops affect the whole selection).
    const selected = nodes.filter((n) => n.selected && n.type !== "group").map((n) => n.id);
    pushNode(fn);
    if (selected.length > 0) {
      setEdges((prev) => {
        let next = prev;
        for (const s of selected) {
          next = addEdge({ source: s, sourceHandle: null, target: fn.id, targetHandle: null, type: "smoothstep", markerEnd: ARROW }, next);
        }
        persistEdges(next);
        return next;
      });
    }
    setMenu(null);
  };

  // Wrap a SET of nodes in one group sized to their bounding box.
  const groupNodes = (ids: string[]) => {
    setNodes((prev) => {
      const targets = prev.filter((n) => ids.includes(n.id) && !CONTAINER_TYPES.has(n.type as FlowNodeType));
      if (targets.length === 0) return prev;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of targets) {
        const a = absPos(n, prev);
        const d = dimOf(n);
        minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
        maxX = Math.max(maxX, a.x + d.w); maxY = Math.max(maxY, a.y + d.h);
      }
      const pad = 44, top = 40;
      const gx = Math.round(minX - pad), gy = Math.round(minY - pad - top);
      const gw = Math.round(maxX - minX + pad * 2), gh = Math.round(maxY - minY + pad * 2 + top);
      const gfn = makeNode("group", gx, gy, "");
      const group = toRFNode({ ...gfn, width: gw, height: gh }, (id, p) => onDataRef.current(id, p));
      const idset = new Set(targets.map((t) => t.id));
      const mapped = prev.map((n) => {
        if (!idset.has(n.id)) return n;
        const a = absPos(n, prev);
        return { ...n, parentId: group.id, extent: "parent" as const, position: { x: a.x - gx, y: a.y - gy }, selected: false };
      });
      const next = groupsFirst([group, ...mapped]);
      persistNodes(next);
      return next;
    });
  };

  // From the node menu: group the whole multi-selection if there is one,
  // otherwise just the clicked node (item 4).
  const wrapInGroup = (nodeId: string) => {
    const selected = nodes.filter((n) => n.selected && !CONTAINER_TYPES.has(n.type as FlowNodeType)).map((n) => n.id);
    groupNodes(selected.length > 1 ? selected : [nodeId]);
  };

  const addRefNode = (refModule: RefModule, refId: string, at?: { x: number; y: number }, connect?: { source: string; sourceHandle?: string | null }) => {
    const def = NODE_DEFAULTS.ref;
    const x = at?.x ?? 200;
    const y = (at?.y ?? 200) - def.h / 2;
    pushNode(makeNode("ref", x, y, "", { refModule, refId }), connect);
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => {
      const next = prev.filter((n) => n.id !== id && n.parentId !== id);
      persistNodes(next);
      return next;
    });
    setEdges((prev) => { const next = prev.filter((e) => e.source !== id && e.target !== id); persistEdges(next); return next; });
  };
  const recolorNode = (id: string, color: string) => onPatchData(id, { color });
  const startEditNode = (id: string) => {
    // Toggle into label-edit by dispatching a synthetic double-click on
    // the node's DOM — keeps the editor logic entirely inside the node.
    const el = wrapRef.current?.querySelector(`.react-flow__node[data-id="${id}"] .flow-node, .react-flow__node[data-id="${id}"] .flow-group-title`) as HTMLElement | null;
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };

  const setEdgeType = (id: string, type: string) => {
    setEdges((prev) => { const next = prev.map((e) => (e.id === id ? { ...e, type } : e)); persistEdges(next); return next; });
  };
  const deleteEdge = (id: string) => {
    setEdges((prev) => { const next = prev.filter((e) => e.id !== id); persistEdges(next); return next; });
  };

  // ── grouping: drop a node into a group ──────────────────────────────
  const onNodeDragStop = useCallback((_e: unknown, dragged: Node) => {
    if (CONTAINER_TYPES.has(dragged.type as FlowNodeType)) return;
    setNodes((prev) => {
      const groups = prev.filter((n) => CONTAINER_TYPES.has(n.type as FlowNodeType));
      const d = dimOf(dragged);
      const a = absPos(dragged, prev);
      const center = { x: a.x + d.w / 2, y: a.y + d.h / 2 };
      const hit = groups.find((g) => {
        const gd = dimOf(g);
        return center.x >= g.position.x && center.x <= g.position.x + gd.w &&
               center.y >= g.position.y && center.y <= g.position.y + gd.h;
      });
      let changed = false;
      let next = prev.map((n) => {
        if (n.id !== dragged.id) return n;
        if (hit) {
          changed = true;
          return { ...n, parentId: hit.id, extent: "parent" as const, position: { x: a.x - hit.position.x, y: a.y - hit.position.y } };
        }
        if (n.parentId) {
          changed = true;
          const { parentId: _p, extent: _e, ...restNode } = n;
          void _p; void _e;
          return { ...restNode, position: a };
        }
        return n;
      });
      if (!changed) return prev;
      next = groupsFirst(next);
      persistNodes(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistNodes]);

  // ── context menus ───────────────────────────────────────────────────
  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const me = e as React.MouseEvent;
    const p = rf.screenToFlowPosition({ x: me.clientX, y: me.clientY });
    setMenu({ kind: "add", clientX: me.clientX, clientY: me.clientY, flowX: p.x, flowY: p.y });
  }, [rf]);
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setMenu({ kind: "node", clientX: e.clientX, clientY: e.clientY, nodeId: node.id });
  }, []);
  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setMenu({ kind: "edge", clientX: e.clientX, clientY: e.clientY, edgeId: edge.id });
  }, []);

  // Close menus on the next outside press. Uses mousedown (not click) so
  // the wire-drop that OPENS the add-menu — whose own mouseup already
  // fired — doesn't immediately close it. Menu interior stops
  // propagation, so clicks inside stay open.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  // "Add connected node" from a node menu → reopen as add-menu near it.
  const addConnectedFrom = (nodeId: string, clientX: number, clientY: number) => {
    const n = nodes.find((x) => x.id === nodeId);
    const d = n ? dimOf(n) : { w: 190, h: 78 };
    const a = n ? absPos(n, nodes) : { x: 0, y: 0 };
    setMenu({
      kind: "add", clientX, clientY,
      flowX: a.x + d.w + 60, flowY: a.y + d.h / 2,
      connect: { source: nodeId, sourceHandle: null },
    });
  };

  // ── Edge labels (item: edge labels) ─────────────────────────────────
  const editEdgeLabel = (id: string) => {
    const cur = edges.find((e) => e.id === id);
    const val = window.prompt(tr("Connection label", "Bağlantı etiketi"), typeof cur?.label === "string" ? cur.label : "");
    if (val === null) return;
    setEdges((prev) => { const next = prev.map((e) => (e.id === id ? { ...e, label: val || undefined } : e)); persistEdges(next); return next; });
  };

  // ── Copy / paste / duplicate (Ctrl+C/V/D) ───────────────────────────
  const copySelection = () => {
    const sel = nodes.filter((n) => n.selected);
    if (sel.length === 0) return false;
    const ids = new Set(sel.map((n) => n.id));
    const selEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    clipboardRef.current = { nodes: fromRFNodes(sel), edges: fromRFEdges(selEdges) };
    return true;
  };
  const pasteClipboard = () => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;
    const idMap = new Map<string, string>();
    const newRF = clip.nodes.map((fn) => {
      const nid = flowId("n");
      idMap.set(fn.id, nid);
      const rfn = toRFNode({ ...fn, id: nid, parentId: null, position: { x: fn.position.x + 36, y: fn.position.y + 36 } }, (i, p) => onDataRef.current(i, p));
      rfn.selected = true;
      return rfn;
    });
    const newEdges: Edge[] = clip.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        id: flowId("e"), source: idMap.get(e.source)!, target: idMap.get(e.target)!,
        sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined,
        type: e.type ?? "smoothstep", label: e.label, markerEnd: ARROW,
      }));
    setNodes((prev) => { const next = groupsFirst([...prev.map((n) => ({ ...n, selected: false })), ...newRF]); persistNodes(next); return next; });
    if (newEdges.length) setEdges((prev) => { const next = [...prev, ...newEdges]; persistEdges(next); return next; });
  };
  const duplicateSelection = () => { if (copySelection()) pasteClipboard(); };

  // ── apply an undo/redo snapshot ─────────────────────────────────────
  const applySnapshot = (snap: string) => {
    let parsed: { nodes: FlowNode[]; edges: FlowEdge[] };
    try { parsed = JSON.parse(snap); } catch { return; }
    histRef.current.applying = true;
    const rfNodes = groupsFirst(parsed.nodes.map((fn) => toRFNode(fn, (i, p) => onDataRef.current(i, p))));
    const rfEdges: Edge[] = parsed.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined,
      type: e.type ?? "smoothstep", label: e.label, markerEnd: ARROW,
    }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    useFlowStore.getState().updateGraph(flow.id, { nodes: parsed.nodes, edges: parsed.edges });
    window.setTimeout(() => { histRef.current.applying = false; }, 0);
  };
  const undo = () => {
    const h = histRef.current;
    if (histTimerRef.current) {
      clearTimeout(histTimerRef.current); histTimerRef.current = null;
      const cur = serializeCurrent();
      if (h.last !== null && cur !== h.last) h.past.push(h.last);
      h.last = cur;
    }
    if (h.past.length === 0) return;
    h.future.push(h.last!);
    const prev = h.past.pop()!;
    h.last = prev;
    applySnapshot(prev);
  };
  const redo = () => {
    const h = histRef.current;
    if (h.future.length === 0) return;
    h.past.push(h.last!);
    const nxt = h.future.pop()!;
    h.last = nxt;
    applySnapshot(nxt);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "c") copySelection();
      else if (k === "v") pasteClipboard();
      else if (k === "d") { e.preventDefault(); duplicateSelection(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // ── Starter templates ───────────────────────────────────────────────
  const insertTemplate = (id: FlowTemplateId) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const c = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + 140, y: (rect?.top ?? 0) + 120 });
    const built = buildTemplate(id, Math.round(c.x), Math.round(c.y), tr);
    const rfNodes = built.nodes.map((fn) => toRFNode(fn, (i, p) => onDataRef.current(i, p)));
    const rfEdges: Edge[] = built.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined,
      type: e.type ?? "smoothstep", label: e.label, markerEnd: ARROW,
    }));
    setNodes((prev) => { const next = groupsFirst([...prev, ...rfNodes]); persistNodes(next); return next; });
    setEdges((prev) => { const next = [...prev, ...rfEdges]; persistEdges(next); return next; });
  };

  // ── Export PNG + auto-layout (dagre) ────────────────────────────────
  // Capture the `.react-flow__viewport` but re-frame it to the nodes'
  // bounds via an explicit width/height + transform — capturing the live
  // viewport as-is yields an empty/clipped image. (SVG export removed —
  // it dropped foreignObject-rendered node content.)
  const exportImage = async () => {
    const ns = rf.getNodes();
    if (ns.length === 0) {
      showToast?.(tr("Nothing to export yet.", "Henüz dışa aktarılacak bir şey yok."), "info");
      return;
    }
    const el = wrapRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return;
    const bounds = getNodesBounds(ns);
    const w = Math.min(4000, Math.max(360, Math.round(bounds.width)));
    const h = Math.min(4000, Math.max(280, Math.round(bounds.height)));
    const vp = getViewportForBounds(bounds, w, h, 0.2, 2, 0.14);
    const opts = {
      backgroundColor: "#0a0f1c",
      width: w,
      height: h,
      cacheBust: true,
      style: {
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    };
    try {
      const url = await toPng(el, opts);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(flow.name || "flow").replace(/[^\w-]+/g, "_")}.png`;
      a.click();
    } catch {
      showToast?.(tr("Export failed — an image node may block it.", "Dışa aktarma başarısız — bir görsel node engelliyor olabilir."), "error");
    }
  };
  const autoLayout = () => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 90 });
    const tops = nodes.filter((n) => !n.parentId);
    tops.forEach((n) => { const d = dimOf(n); g.setNode(n.id, { width: d.w, height: d.h }); });
    edges.forEach((e) => { if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target); });
    dagre.layout(g);
    setNodes((prev) => {
      const next = prev.map((n) => {
        const p = g.node(n.id);
        if (!p) return n;
        const d = dimOf(n);
        return { ...n, position: { x: Math.round(p.x - d.w / 2), y: Math.round(p.y - d.h / 2) } };
      });
      persistNodes(next);
      return next;
    });
    window.setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 30);
  };

  // ── Middle-mouse marquee selection ──────────────────────────────────
  // React Flow has no native middle-button box-select, so we roll our
  // own: middle-drag on empty pane draws a rect and selects the nodes it
  // covers. Left/right drag stays panning.
  const onWrapMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    if (!(e.target as HTMLElement).closest(".react-flow__pane")) return;
    e.preventDefault();
    const wrapRect = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const onMove = (ev: MouseEvent) => {
      setMarquee({
        left: Math.min(sx, ev.clientX) - wrapRect.left,
        top: Math.min(sy, ev.clientY) - wrapRect.top,
        width: Math.abs(ev.clientX - sx),
        height: Math.abs(ev.clientY - sy),
      });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setMarquee(null);
      const a = rf.screenToFlowPosition({ x: sx, y: sy });
      const b = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const rx0 = Math.min(a.x, b.x), ry0 = Math.min(a.y, b.y), rx1 = Math.max(a.x, b.x), ry1 = Math.max(a.y, b.y);
      if (rx1 - rx0 < 4 && ry1 - ry0 < 4) return;
      setNodes((prev) => prev.map((n) => {
        if (CONTAINER_TYPES.has(n.type as FlowNodeType)) return n;
        const abs = absPos(n, prev); const d = dimOf(n);
        const hit = abs.x < rx1 && abs.x + d.w > rx0 && abs.y < ry1 && abs.y + d.h > ry0;
        return n.selected === hit ? n : { ...n, selected: hit };
      }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="flow-canvas-wrap"
      ref={wrapRef}
      onMouseDownCapture={onWrapMouseDown}
      // item 1: the picker controls the canvas BACKGROUND tint (a dark
      // wash of the chosen hue), not the grid-shape colour.
      style={{ background: `linear-gradient(0deg, rgba(8,11,20,0.9), rgba(8,11,20,0.9)), ${flowBgColor}` }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onNodeDragStop={onNodeDragStop}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        onMoveEnd={onMoveEnd}
        defaultViewport={flow.viewport}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode={[multiKey, "Meta"]}
        selectionKeyCode={multiKey}
        selectionMode={SelectionMode.Partial}
        panOnDrag={[0, 2]}
        connectionRadius={34}
        fitView={flow.nodes.length > 0 && flow.viewport.zoom === 1 && flow.viewport.x === 0 && flow.viewport.y === 0}
      >
        {flowBg !== "plain" && (
          <Background
            variant={flowBg === "lines" ? BackgroundVariant.Lines : flowBg === "cross" ? BackgroundVariant.Cross : BackgroundVariant.Dots}
            gap={flowBg === "lines" ? 28 : 22}
            size={flowBg === "dots" ? 2 : 1}
            color="rgba(255,255,255,0.09)"
          />
        )}
        {showMinimap && <MiniMap pannable zoomable nodeColor={(n) => (n.data?.color as string) ?? "#4f8cff"} />}
        <Controls />
        <Panel position="top-right" className="flow-actions">
          <button type="button" className="flow-action-btn" title={tr("Auto layout", "Otomatik yerleşim")} onClick={autoLayout}>
            <LayoutGrid size={14} />
          </button>
          <button type="button" className="flow-action-btn" title={tr("Export PNG", "PNG dışa aktar")} onClick={() => void exportImage()}>
            <Download size={14} />PNG
          </button>
        </Panel>
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="flow-empty">
          <p className="flow-empty-title"><Sparkles size={15} />{tr("Start from a template", "Bir şablonla başla")}</p>
          <div className="flow-empty-grid">
            {FLOW_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="flow-empty-card" onClick={() => insertTemplate(t.id)}>
                <strong>{tr(t.label[0], t.label[1])}</strong>
                <small>{tr(t.hint[0], t.hint[1])}</small>
              </button>
            ))}
          </div>
          <p className="flow-empty-hint">{tr("…or right-click anywhere to add nodes.", "…ya da node eklemek için herhangi bir yere sağ tıkla.")}</p>
        </div>
      )}

      {marquee && <div className="flow-marquee" style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />}

      <p className="flow-hint">{tr("Right-click to add · drag a wire to branch · middle-drag to select · Ctrl+Z/C/V/D", "Sağ tık ekle · bağlantıyı sürükle · orta-tuş ile seç · Ctrl+Z/C/V/D")}</p>

      {/* ── unified context / add menu ── */}
      {menu && createPortal(
        <div className="flow-menu" style={clampMenu(menu.clientX, menu.clientY)} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {menu.kind === "add" && (() => {
            const q = addQuery.trim().toLowerCase();
            const match = (en: string, t: string) => !q || en.toLowerCase().includes(q) || t.toLowerCase().includes(q);
            const items = ADD_ITEMS.filter((it) => match(it.label[0], it.label[1]));
            const showGroup = match("Group", "Grup");
            const showRef = match("Linked entity ref", "Bağlı öğe ref");
            return (
              <>
                <div className="flow-menu-search">
                  <Search size={13} />
                  <input
                    autoFocus
                    className="flow-menu-search-input"
                    placeholder={tr("Search nodes…", "Node ara…")}
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { const all = [...(showGroup ? ["group" as FlowNodeType] : []), ...items.map((i) => i.type)]; if (all[0]) createFromAdd(all[0]); }
                      if (e.key === "Escape") setMenu(null);
                    }}
                  />
                </div>
                {showGroup && (
                  <button type="button" className="flow-menu-item flow-menu-group" onClick={() => createFromAdd("group")}>
                    <BoxSelect size={13} />{tr("Group", "Grup")}
                  </button>
                )}
                {items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <button key={it.type} type="button" className="flow-menu-item" onClick={() => createFromAdd(it.type)}>
                      <Icon size={13} />{tr(it.label[0], it.label[1])}
                    </button>
                  );
                })}
                {showRef && (
                  <>
                    <div className="flow-menu-sep" />
                    <button type="button" className="flow-menu-item" onClick={() => { setPicker({ tab: "task" }); }}>
                      <Link2 size={13} />{tr("Linked entity (ref)…", "Bağlı öğe (ref)…")}
                    </button>
                  </>
                )}
                {items.length === 0 && !showGroup && !showRef && (
                  <div className="flow-menu-empty">{tr("No match", "Eşleşme yok")}</div>
                )}
              </>
            );
          })()}

          {menu.kind === "node" && (() => {
            const n = nodes.find((x) => x.id === menu.nodeId);
            const isGroup = n?.type === "group";
            return (
              <>
                <button type="button" className="flow-menu-item" onClick={() => { startEditNode(menu.nodeId); setMenu(null); }}>
                  <Pencil size={13} />{tr("Edit text", "Metni düzenle")}
                </button>
                {!isGroup && (
                  <button type="button" className="flow-menu-item" onClick={() => addConnectedFrom(menu.nodeId, menu.clientX, menu.clientY)}>
                    <Plus size={13} />{tr("Add connected node", "Bağlı node ekle")}
                  </button>
                )}
                {!isGroup && !n?.parentId && (
                  <button type="button" className="flow-menu-item" onClick={() => { wrapInGroup(menu.nodeId); setMenu(null); }}>
                    <BoxSelect size={13} />{tr("Group this node", "Bu node'u grupla")}
                  </button>
                )}
                <div className="flow-menu-colors">
                  {FLOW_PALETTE.map((c) => (
                    <button key={c} type="button" className="flow-menu-swatch" style={{ background: c }} onClick={() => { recolorNode(menu.nodeId, c); setMenu(null); }} />
                  ))}
                </div>
                <div className="flow-menu-sep" />
                <button type="button" className="flow-menu-item flow-menu-danger" onClick={() => { deleteNode(menu.nodeId); setMenu(null); }}>
                  <Trash2 size={13} />{tr("Delete", "Sil")}
                </button>
              </>
            );
          })()}

          {menu.kind === "edge" && (
            <>
              <button type="button" className="flow-menu-item" onClick={() => { editEdgeLabel(menu.edgeId); setMenu(null); }}>
                <Tag size={13} />{tr("Label…", "Etiket…")}
              </button>
              <div className="flow-menu-sep" />
              <button type="button" className="flow-menu-item" onClick={() => { setEdgeType(menu.edgeId, "straight"); setMenu(null); }}>
                <Minus size={13} />{tr("Straighten", "Düzleştir")}
              </button>
              <button type="button" className="flow-menu-item" onClick={() => { setEdgeType(menu.edgeId, "smoothstep"); setMenu(null); }}>
                <Spline size={13} />{tr("Smooth step", "Yumuşak köşe")}
              </button>
              <button type="button" className="flow-menu-item" onClick={() => { setEdgeType(menu.edgeId, "bezier"); setMenu(null); }}>
                <Spline size={13} />{tr("Curved", "Eğri")}
              </button>
              <div className="flow-menu-sep" />
              <button type="button" className="flow-menu-item flow-menu-danger" onClick={() => { deleteEdge(menu.edgeId); setMenu(null); }}>
                <Trash2 size={13} />{tr("Delete connection", "Bağlantıyı sil")}
              </button>
            </>
          )}
        </div>,
        document.body,
      )}

      {/* ── ref entity picker (opened from the add-menu) ── */}
      {picker && createPortal(
        <div className="flow-ref-picker-backdrop" onMouseDown={() => setPicker(null)}>
          <div className="flow-ref-picker" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flow-ref-picker-head">
              <strong>{tr("Link an entity", "Bir öğeye bağla")}</strong>
              <button type="button" className="flow-ref-picker-close" onClick={() => setPicker(null)}><X size={16} /></button>
            </div>
            <div className="flow-ref-picker-tabs">
              <button type="button" className={picker.tab === "task" ? "is-active" : ""} onClick={() => setPicker({ tab: "task" })}><ListChecks size={13} />{tr("Tasks", "Görevler")}</button>
              <button type="button" className={picker.tab === "note" ? "is-active" : ""} onClick={() => setPicker({ tab: "note" })}><FileText size={13} />{tr("Notes", "Notlar")}</button>
              <button type="button" className={picker.tab === "moodboard" ? "is-active" : ""} onClick={() => setPicker({ tab: "moodboard" })}><ImageIcon size={13} />{tr("Moodboard", "Moodboard")}</button>
            </div>
            <div className="flow-ref-picker-list">
              {picker.tab === "task" && games.flatMap((g) => g.tasks.map((t) => (
                <button key={t.id} type="button" className="flow-ref-picker-item" onClick={() => { addRefNode("task", t.id, menuFlowPoint()); setPicker(null); setMenu(null); }}>
                  <span className="flow-ref-picker-item-title">{t.title}</span>
                  <span className="flow-ref-picker-item-sub">{g.title}{t.done ? " · done" : ""}</span>
                </button>
              )))}
              {picker.tab === "note" && refNotes.map((n) => (
                <button key={n.id} type="button" className="flow-ref-picker-item" onClick={() => { addRefNode("note", n.id, menuFlowPoint()); setPicker(null); setMenu(null); }}>
                  <span className="flow-ref-picker-item-title">{n.title || tr("Untitled", "Adsız")}</span>
                </button>
              ))}
              {picker.tab === "moodboard" && games.flatMap((g) => (g.moodboard?.items ?? []).map((it) => (
                <button key={it.id} type="button" className="flow-ref-picker-item" onClick={() => { addRefNode("moodboard", it.id, menuFlowPoint()); setPicker(null); setMenu(null); }}>
                  <span className="flow-ref-picker-item-title">{it.title || it.filename}</span>
                  <span className="flow-ref-picker-item-sub">{g.title}</span>
                </button>
              )))}
              {((picker.tab === "task" && games.every((g) => g.tasks.length === 0)) ||
                (picker.tab === "note" && refNotes.length === 0) ||
                (picker.tab === "moodboard" && games.every((g) => (g.moodboard?.items ?? []).length === 0))) && (
                <p className="flow-ref-picker-empty">{tr("Nothing to link here yet.", "Burada bağlanacak bir şey yok.")}</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );

  // The flow-space point where the add-menu was opened (for ref placement).
  function menuFlowPoint() {
    return menu?.kind === "add" ? { x: menu.flowX, y: menu.flowY } : undefined;
  }
}

// Keep the context/add menu inside the viewport (item 1: no off-screen).
function clampMenu(x: number, y: number): React.CSSProperties {
  const MW = 230, MH = 392, pad = 8;
  const left = Math.max(pad, Math.min(x, window.innerWidth - MW - pad));
  const top = Math.max(pad, Math.min(y, window.innerHeight - MH - pad));
  return { top, left };
}

function defaultLabel(type: FlowNodeType, tr: (en: string, t: string) => string): string {
  switch (type) {
    case "card": return tr("Node", "Düğüm");
    case "sticky": return tr("Note", "Not");
    case "date": return tr("Date", "Tarih");
    case "decision": return tr("Decision?", "Karar?");
    case "group": return tr("Group", "Grup");
    case "lane": return tr("Lane", "Kulvar");
    case "comment": return tr("Comment…", "Yorum…");
    case "link": return tr("Link", "Bağlantı");
    case "progress": return tr("Progress", "İlerleme");
    case "choice": return tr("Choice", "Seçim");
    default: return "";
  }
}

export function FlowCanvas({ flow, language }: { flow: Flow; language: string }) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner flow={flow} language={language} />
    </ReactFlowProvider>
  );
}
