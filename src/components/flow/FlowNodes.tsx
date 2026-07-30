// Flow Center node types (v0.9.8 — Blueprint overhaul, iteration 2).
//
// Unreal-Blueprint nodes with triangle in/out ports and a seamless
// inline editor. Cards now carry a header + content (like the date
// node). Decision nodes branch with Yes/No outputs. Ref nodes are
// recolourable like every other node.

import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import {
  ListChecks, FileText, Image as ImageIcon, AlertTriangle, Calendar, GitFork,
  MessageSquare, Link2, ExternalLink, Gauge,
} from "lucide-react";
import { useAppStore } from "../../store";
import { useFlowStore } from "../../store/flowStore";
import { resolveRef } from "../../lib/flowRefs";
import { imgSrc } from "../../lib/images";
import { pickAssetFile } from "../../lib/noteAssets";
import { invoke } from "../../lib/invokeWrapper";
import type { RefModule, FlowNodeData } from "../../lib/flow";

type NodeData = FlowNodeData & { onData?: (patch: Partial<FlowNodeData>) => void };
type Field = "label" | "body";

function useTr() {
  const language = useAppStore((s) => s.language);
  return (en: string, t: string) => (language === "tr" ? t : en);
}

// ── Triangle ports (Unreal-style, big grab area) ──────────────────────
function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="flow-port flow-port-in" />
      <Handle type="source" position={Position.Right} className="flow-port flow-port-out" />
    </>
  );
}

// ── Seamless inline field editor (label or body) ──────────────────────
function useFieldEditor(data: NodeData, field: Field) {
  const [editing, setEditing] = useState(false);
  const initial = (data[field] as string | undefined) ?? "";
  const [text, setText] = useState(initial);
  useEffect(() => { if (!editing) setText((data[field] as string | undefined) ?? ""); }, [data, field, editing]);
  const commit = () => { setEditing(false); data.onData?.({ [field]: text } as Partial<FlowNodeData>); };
  return { editing, setEditing, text, setText, commit };
}

function InlineField({
  ed, placeholder, multiline = false,
}: { ed: ReturnType<typeof useFieldEditor>; placeholder: string; multiline?: boolean }) {
  if (ed.editing) {
    const common = {
      className: "flow-edit nodrag",
      autoFocus: true,
      value: ed.text,
      placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => ed.setText(e.target.value),
      onBlur: ed.commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ed.commit(); }
        if (e.key === "Escape") { e.preventDefault(); ed.setEditing(false); }
      },
    };
    return multiline ? <textarea {...common} rows={2} /> : <input {...common} />;
  }
  return <span className="flow-label">{ed.text || placeholder}</span>;
}

// ── Card — header + content (item 13) ─────────────────────────────────
export function CardNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const title = useFieldEditor(d, "label");
  const body = useFieldEditor(d, "body");
  return (
    <div className={`flow-node flow-node-card ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <Ports />
      <div className="flow-card-head" style={{ background: hexFaint(d.color) }} onDoubleClick={() => title.setEditing(true)}>
        <span className="flow-card-dot" style={{ background: d.color }} />
        <InlineField ed={title} placeholder={tr("Node", "Düğüm")} />
      </div>
      <div className="flow-card-body" onDoubleClick={() => body.setEditing(true)}>
        <InlineField ed={body} placeholder={tr("Content…", "İçerik…")} multiline />
      </div>
    </div>
  );
}

// ── Sticky — paper tint + folded corner (item 10 prior) ───────────────
export function StickyNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const ed = useFieldEditor(d, "label");
  return (
    <div
      className={`flow-node flow-sticky ${selected ? "sel" : ""}`}
      style={{ background: d.color }}
      onDoubleClick={() => ed.setEditing(true)}
    >
      <Ports />
      <div className="flow-sticky-body"><InlineField ed={ed} placeholder="Note…" multiline /></div>
      <span className="flow-sticky-fold" />
    </div>
  );
}

// ── Date ──────────────────────────────────────────────────────────────
export function DateNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const ed = useFieldEditor(d, "label");
  const language = useAppStore((s) => s.language);
  const pretty = d.date
    ? new Date(d.date + "T00:00:00").toLocaleDateString(language === "tr" ? "tr-TR" : undefined,
        { day: "2-digit", month: "short", year: "numeric" })
    : "—";
  return (
    <div className={`flow-node flow-date ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <Ports />
      <div className="flow-date-head">
        <Calendar size={12} style={{ color: d.color }} />
        <span onDoubleClick={() => ed.setEditing(true)} style={{ flex: 1 }}>
          <InlineField ed={ed} placeholder={language === "tr" ? "Tarih" : "Date"} />
        </span>
      </div>
      <input type="date" className="flow-date-input nodrag" value={d.date ?? ""} onChange={(e) => d.onData?.({ date: e.target.value })} />
      <span className="flow-date-pretty">{pretty}</span>
    </div>
  );
}

// ── Decision — branching (item 14, replaces milestone) ────────────────
export function DecisionNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const q = useFieldEditor(d, "label");
  return (
    <div className={`flow-node flow-decision ${selected ? "sel" : ""}`} style={{ borderColor: d.color }} onDoubleClick={() => q.setEditing(true)}>
      <Handle type="target" position={Position.Left} className="flow-port flow-port-in" />
      <GitFork size={13} className="flow-decision-icon" style={{ color: d.color }} />
      <div className="flow-decision-q"><InlineField ed={q} placeholder={tr("Decision?", "Karar?")} /></div>
      <Handle type="source" id="yes" position={Position.Right} style={{ top: "34%" }} className="flow-port flow-port-out flow-port-yes" />
      <Handle type="source" id="no" position={Position.Right} style={{ top: "74%" }} className="flow-port flow-port-out flow-port-no" />
      <span className="flow-decision-lbl flow-decision-yes">{tr("Yes", "Evet")}</span>
      <span className="flow-decision-lbl flow-decision-no">{tr("No", "Hayır")}</span>
    </div>
  );
}

// ── Group (resizable container, renders behind, holds children) ───────
export function GroupNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const ed = useFieldEditor(d, "label");
  return (
    <div className={`flow-group ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <NodeResizer minWidth={220} minHeight={150} isVisible={selected} color={d.color ?? "#64748b"} />
      <div className="flow-group-title" onDoubleClick={() => ed.setEditing(true)}>
        <span className="flow-group-dot" style={{ background: d.color }} />
        <InlineField ed={ed} placeholder="Group" />
      </div>
    </div>
  );
}

// ── Swimlane — a wide horizontal band that contains nodes ─────────────
export function LaneNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const ed = useFieldEditor(d, "label");
  return (
    <div className={`flow-lane ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <NodeResizer minWidth={320} minHeight={120} isVisible={selected} color={d.color ?? "#4f8cff"} />
      <div className="flow-lane-title" onDoubleClick={() => ed.setEditing(true)}>
        <span className="flow-lane-dot" style={{ background: d.color }} />
        <InlineField ed={ed} placeholder={tr("Lane", "Kulvar")} />
      </div>
    </div>
  );
}

// ── Ref (live entity binding, recolourable — item 12) ─────────────────
const MODULE_META: Record<RefModule, { icon: typeof ListChecks; label: [string, string] }> = {
  task:      { icon: ListChecks, label: ["Task", "Görev"] },
  note:      { icon: FileText,   label: ["Note", "Not"] },
  moodboard: { icon: ImageIcon,  label: ["Moodboard", "Moodboard"] },
};

export function RefNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const language = useAppStore((s) => s.language);
  const games = useAppStore((s) => s.games);
  const setWorkspaceTab = useAppStore((s) => s.setWorkspaceTab);
  const setSelectedId = useAppStore((s) => s.setSelectedId);
  const setActiveTaskId = useAppStore((s) => s.setActiveTaskId);
  const notes = useFlowStore((s) => s.refNotes);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const module = d.refModule ?? "task";
  const meta = MODULE_META[module];
  const Icon = meta.icon;
  const r = resolveRef(module, d.refId ?? "", games, notes);
  const color = d.color ?? "#22c55e";

  // Open the SPECIFIC entity, not just its module (item 4).
  const navigate = () => {
    if (module === "task") {
      if (d.refId) setActiveTaskId(d.refId);
      setWorkspaceTab("tasks");
    } else if (module === "note") {
      setWorkspaceTab("notes");
      window.dispatchEvent(new CustomEvent("heravex:flow-open-note", { detail: { noteId: d.refId } }));
    } else if (module === "moodboard") {
      if (r.gameId) setSelectedId(r.gameId);
      setWorkspaceTab("library");
    }
  };

  return (
    <div
      className={`flow-node flow-ref ${r.exists ? "" : "is-orphan"} ${selected ? "sel" : ""}`}
      style={r.exists ? { borderColor: color, background: hexTint(color, 0.13) } : undefined}
      onDoubleClick={navigate}
      title={tr("Double-click to open in its module", "Modülünde açmak için çift tıkla")}
    >
      <Ports />
      <div className="flow-ref-head">
        <span className="flow-ref-badge" style={{ color }}><Icon size={11} />{tr(meta.label[0], meta.label[1])}</span>
        {r.status && <span className={`flow-ref-status status-${r.status}`}>{r.status}</span>}
        {!r.exists && <span className="flow-ref-orphan"><AlertTriangle size={11} />{tr("orphaned", "kopuk")}</span>}
      </div>
      <span className="flow-ref-title">{r.exists ? r.title : tr("Deleted entity", "Silinmiş öğe")}</span>
      {r.subtitle && <span className="flow-ref-sub">{r.subtitle}</span>}
    </div>
  );
}

// ── Comment — free annotation ─────────────────────────────────────────
export function CommentNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const ed = useFieldEditor(d, "label");
  return (
    <div className={`flow-node flow-comment ${selected ? "sel" : ""}`} style={{ borderColor: d.color, background: hexTint(d.color, 0.1) }} onDoubleClick={() => ed.setEditing(true)}>
      <Ports />
      <MessageSquare size={12} className="flow-comment-icon" style={{ color: d.color }} />
      <div className="flow-comment-body"><InlineField ed={ed} placeholder={tr("Comment…", "Yorum…")} multiline /></div>
    </div>
  );
}

// ── Image — pick a file from disk (no copy; item 5) ───────────────────
export function ImageNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const src = d.url ? imgSrc(d.url) : undefined;
  const pick = async () => {
    const path = await pickAssetFile();
    if (path) d.onData?.({ url: path });
  };
  return (
    <div className={`flow-node flow-image ${selected ? "sel" : ""}`} style={{ borderColor: d.color }} onDoubleClick={() => { void pick(); }}>
      <Ports />
      {src ? (
        <>
          <img src={src} alt={d.label ?? "image"} className="flow-image-img" draggable={false} />
          <button type="button" className="flow-image-change nodrag" title={tr("Change image", "Görseli değiştir")} onClick={() => { void pick(); }}>
            <ImageIcon size={13} />
          </button>
        </>
      ) : (
        <button type="button" className="flow-image-empty nodrag" onClick={() => { void pick(); }}>
          <ImageIcon size={20} />
          {tr("Choose image from PC", "Bilgisayardan görsel seç")}
        </button>
      )}
    </div>
  );
}

// ── Link — title + URL, opens externally ──────────────────────────────
export function LinkNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const title = useFieldEditor(d, "label");
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlText, setUrlText] = useState(d.url ?? "");
  useEffect(() => { if (!editingUrl) setUrlText(d.url ?? ""); }, [d.url, editingUrl]);
  const commitUrl = () => { setEditingUrl(false); d.onData?.({ url: urlText }); };
  const open = () => { if (d.url) void invoke("open_external", { url: d.url }).catch(() => {}); };
  return (
    <div className={`flow-node flow-link ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <Ports />
      <div className="flow-link-head">
        <Link2 size={12} style={{ color: d.color }} />
        <span style={{ flex: 1 }} onDoubleClick={() => title.setEditing(true)}><InlineField ed={title} placeholder={tr("Link", "Bağlantı")} /></span>
        <button type="button" className="flow-link-open nodrag" title={tr("Open", "Aç")} onClick={open}><ExternalLink size={12} /></button>
      </div>
      {editingUrl ? (
        <input className="flow-edit nodrag" autoFocus value={urlText} placeholder="https://"
          onChange={(e) => setUrlText(e.target.value)} onBlur={commitUrl}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitUrl(); } if (e.key === "Escape") setEditingUrl(false); }} />
      ) : (
        <span className="flow-link-url" onDoubleClick={() => setEditingUrl(true)}>{d.url || tr("double-click to set URL", "URL için çift tıkla")}</span>
      )}
    </div>
  );
}

// ── Progress — label + 0..100 bar ─────────────────────────────────────
export function ProgressNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const ed = useFieldEditor(d, "label");
  const pct = Math.max(0, Math.min(100, d.progress ?? 0));
  return (
    <div className={`flow-node flow-progress ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <Ports />
      <div className="flow-progress-head">
        <Gauge size={12} style={{ color: d.color }} />
        <span style={{ flex: 1 }} onDoubleClick={() => ed.setEditing(true)}><InlineField ed={ed} placeholder={tr("Progress", "İlerleme")} /></span>
        <span className="flow-progress-pct">{pct}%</span>
      </div>
      <div className="flow-progress-track"><div className="flow-progress-fill" style={{ width: `${pct}%`, background: d.color }} /></div>
      <input type="range" min={0} max={100} value={pct} className="flow-progress-range nodrag"
        onChange={(e) => d.onData?.({ progress: Number(e.target.value) })} />
    </div>
  );
}

// ── Choice — N labelled outputs (dialogue branches) ──────────────────
const CHOICE_HEADER = 40;
const CHOICE_ROW = 30;
export function ChoiceNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const tr = useTr();
  const q = useFieldEditor(d, "label");
  const choices = d.choices ?? [];
  const setChoice = (i: number, val: string) => { const next = [...choices]; next[i] = val; d.onData?.({ choices: next }); };
  const addChoice = () => d.onData?.({ choices: [...choices, tr("Option", "Seçenek")] });
  const removeChoice = (i: number) => d.onData?.({ choices: choices.filter((_, j) => j !== i) });
  return (
    <div className={`flow-node flow-choice ${selected ? "sel" : ""}`} style={{ borderColor: d.color }}>
      <Handle type="target" position={Position.Left} className="flow-port flow-port-in" />
      <div className="flow-choice-head" onDoubleClick={() => q.setEditing(true)}>
        <GitFork size={12} style={{ color: d.color }} />
        <InlineField ed={q} placeholder={tr("Choice", "Seçim")} />
      </div>
      <div className="flow-choice-list">
        {choices.map((c, i) => (
          <div key={i} className="flow-choice-row" style={{ height: CHOICE_ROW }}>
            <input className="flow-choice-input nodrag" value={c} onChange={(e) => setChoice(i, e.target.value)} />
            <button type="button" className="flow-choice-del nodrag" title={tr("Remove", "Kaldır")} onClick={() => removeChoice(i)}>×</button>
            <Handle type="source" id={`c${i}`} position={Position.Right} className="flow-port flow-port-out"
              style={{ top: CHOICE_HEADER + i * CHOICE_ROW + CHOICE_ROW / 2 }} />
          </div>
        ))}
        <button type="button" className="flow-choice-add nodrag" onClick={addChoice}>+ {tr("Add option", "Seçenek ekle")}</button>
      </div>
    </div>
  );
}

/** Low-alpha tint of a hex for node backgrounds. */
function hexTint(hex: string | undefined, alpha: number): string {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function hexFaint(hex?: string): string { return hexTint(hex, 0.16); }

export const flowNodeTypes = {
  card: CardNode,
  sticky: StickyNode,
  date: DateNode,
  decision: DecisionNode,
  group: GroupNode,
  lane: LaneNode,
  ref: RefNode,
  comment: CommentNode,
  image: ImageNode,
  link: LinkNode,
  progress: ProgressNode,
  choice: ChoiceNode,
};
