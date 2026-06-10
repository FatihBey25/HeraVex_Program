// Notes editor — WYSIWYG single-pane (rewritten v0.9.x).
//
// The previous design split the screen into a markdown textarea and
// a rendered preview. The user wanted the inverse: one pane, the
// formatted text directly editable, no Markdown syntax leaking
// through. Implementation:
//
//   * The visible surface is a `contentEditable` div. Whatever it
//     shows IS what gets saved. No round-trip to markdown.
//   * Toolbar buttons run `document.execCommand("bold"|"italic"|"…")`
//     on the current selection. execCommand is deprecated by the
//     spec but every shipped browser (and Tauri's WebView2) still
//     supports it, and it's the only zero-dep way to mutate a
//     selection without rolling our own Selection/Range surgery.
//   * Heading buttons use `formatBlock` (H1/H2/etc.).
//   * Lists use `insertUnorderedList` / `insertOrderedList`.
//   * Table button inserts a 3×3 starter table via `insertHTML`.
//   * Legacy markdown content is auto-converted to HTML on first
//     mount of each note (keyed by the parent component) using a
//     small regex-based renderer — covers headings, bold, italic,
//     code, lists, blockquotes, links, hr. Complex markdown that
//     misses these patterns is rendered as plain paragraphs.

import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Link as LinkIcon, FileDown, ListChecks, Code2,
  Heading1, Heading2, Quote, Sparkles, Save, List, ListOrdered,
  Table as TableIcon, Image as ImageIcon,
} from "lucide-react";

export type MarkdownTemplate = {
  id: string;
  label: string;
  build: () => string;
};

export type SaveStatus = "idle" | "saving" | "saved";

export type MarkdownWorkspaceProps = {
  /** May be HTML (new notes) or markdown (legacy). Auto-detected. */
  value: string;
  onChange: (value: string) => void;
  language: string;
  ui: Record<string, unknown>;
  saveStatus: SaveStatus;
  templates: MarkdownTemplate[];
  onExportPdf?: () => void | Promise<void>;
  exportLabel?: string;
  placeholder?: string;
  templateLabel?: string;
  extraToolbar?: React.ReactNode;
};

export function MarkdownWorkspace({
  value,
  onChange,
  language,
  ui,
  saveStatus,
  templates,
  onExportPdf,
  exportLabel,
  placeholder,
  templateLabel,
  extraToolbar,
}: MarkdownWorkspaceProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  // Track the value seen on the LAST render so we know when the parent
  // swapped the note we're editing (e.g. user clicked a different note
  // in the sidebar) versus when our own contentEditable input is just
  // bubbling its change back up. Without this guard the editor would
  // stomp the user's caret on every keystroke.
  const lastExternalValueRef = useRef<string>(value);
  // The HTML we've already pushed into the DOM. Lets us skip writes
  // that would just re-render the same content.
  const lastWrittenHtmlRef = useRef<string>("");

  // Convert whatever the parent passed (markdown or HTML) into the
  // HTML we'll mount inside the contentEditable.
  const toHtml = (raw: string): string => {
    if (!raw) return "";
    // Trivial heuristic: if it already contains a tag, treat as HTML.
    if (/<\/?[a-z][\s\S]*?>/i.test(raw)) return raw;
    return markdownToHtml(raw);
  };

  // Push value into the editor on mount + whenever the parent hands
  // us a different note. We bypass React's reconciliation here because
  // a contentEditable + React + caret tracking would all argue with
  // each other.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastExternalValueRef.current && lastWrittenHtmlRef.current === el.innerHTML) {
      return; // local edit echo — leave the DOM alone
    }
    const nextHtml = toHtml(value);
    if (el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml;
      lastWrittenHtmlRef.current = nextHtml;
    }
    lastExternalValueRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ── Toolbar actions ────────────────────────────────────────────────
  const focusEditor = () => editorRef.current?.focus();
  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastWrittenHtmlRef.current = html;
    lastExternalValueRef.current = html;
    onChange(html);
  };

  // `document.execCommand` is the simplest way to apply a format to
  // the current Selection without writing custom Range surgery. All
  // shipped Tauri WebView2 / WKWebView builds still honour it.
  const exec = (cmd: string, val?: string) => {
    focusEditor();
    try { document.execCommand(cmd, false, val); } catch { /* no-op */ }
    emitChange();
  };

  const formatBlock = (tag: string) => exec("formatBlock", tag);
  const toggleBold      = () => exec("bold");
  const toggleItalic    = () => exec("italic");
  const insertBullet    = () => exec("insertUnorderedList");
  const insertNumbered  = () => exec("insertOrderedList");
  const insertQuote     = () => formatBlock("blockquote");
  const insertCode      = () => exec("insertHTML",
    `<pre><code>${tr("code", "kod")}</code></pre>`);

  const insertLink = () => {
    const url = window.prompt(tr("Enter URL", "URL gir"), "https://");
    if (!url) return;
    exec("createLink", url);
  };

  const insertTable = (rows = 3, cols = 3) => {
    let html = `<table class="note-table"><thead><tr>`;
    for (let c = 0; c < cols; c++) {
      html += `<th>${tr("Col", "Sütun")} ${c + 1}</th>`;
    }
    html += `</tr></thead><tbody>`;
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) html += "<td>&nbsp;</td>";
      html += "</tr>";
    }
    html += `</tbody></table><p></p>`;
    exec("insertHTML", html);
  };

  const insertChecklist = () => {
    exec("insertHTML",
      `<ul class="note-checklist"><li><input type="checkbox" disabled> ${tr("Task", "Görev")}</li></ul>`);
  };

  // ── Template menu ──────────────────────────────────────────────────
  const [templateOpen, setTemplateOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTemplateOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyTemplate = (tpl: MarkdownTemplate) => {
    const el = editorRef.current;
    const hasContent = (el?.textContent ?? "").trim().length > 0;
    if (hasContent) {
      const ok = window.confirm(
        tr(
          "This will replace your existing content. Continue?",
          "Mevcut içeriğin üstüne yazılacak. Devam edilsin mi?"
        )
      );
      if (!ok) return;
    }
    const next = toHtml(tpl.build());
    if (el) {
      el.innerHTML = next;
      lastWrittenHtmlRef.current = next;
      lastExternalValueRef.current = next;
    }
    onChange(next);
  };

  const savedLabel = tr("Saved", "Kaydedildi");
  const savingLabel = tr("Saving…", "Kaydediliyor…");
  const placeholderTxt = placeholder ?? tr(
    "Start typing. Use the toolbar to format — your content stays clean.",
    "Yazmaya başla. Biçimlendirmek için araç çubuğunu kullan — içeriğin temiz kalır."
  );

  return (
    <div className="notes-tab markdown-workspace">
      <div className="notes-toolbar">
        <div className="notes-toolbar-group">
          <ToolbarButton title={tr("Bold", "Kalın")} onClick={toggleBold}>
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Italic", "İtalik")} onClick={toggleItalic}>
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Link", "Bağlantı")} onClick={insertLink}>
            <LinkIcon size={14} />
          </ToolbarButton>
        </div>
        <div className="notes-toolbar-divider" />
        <div className="notes-toolbar-group">
          <ToolbarButton title="H1" onClick={() => formatBlock("h1")}>
            <Heading1 size={14} />
          </ToolbarButton>
          <ToolbarButton title="H2" onClick={() => formatBlock("h2")}>
            <Heading2 size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Paragraph", "Paragraf")} onClick={() => formatBlock("p")}>
            <span style={{ fontSize: 10, fontWeight: 700 }}>P</span>
          </ToolbarButton>
          <ToolbarButton title={tr("Quote", "Alıntı")} onClick={insertQuote}>
            <Quote size={14} />
          </ToolbarButton>
        </div>
        <div className="notes-toolbar-divider" />
        <div className="notes-toolbar-group">
          <ToolbarButton title={tr("Bullet list", "Madde işareti")} onClick={insertBullet}>
            <List size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Numbered list", "Numaralı liste")} onClick={insertNumbered}>
            <ListOrdered size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Checklist", "Görev listesi")} onClick={insertChecklist}>
            <ListChecks size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Table", "Tablo")} onClick={() => insertTable()}>
            <TableIcon size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Code block", "Kod bloğu")} onClick={insertCode}>
            <Code2 size={14} />
          </ToolbarButton>
        </div>
        <div className="notes-toolbar-divider" />
        <div className="notes-toolbar-group notes-toolbar-grow">
          {templates.length > 0 && (
            <div className="notes-template-menu-wrap">
              <button
                className="notes-toolbar-template"
                onClick={() => setTemplateOpen((o) => !o)}
              >
                <Sparkles size={13} style={{ marginRight: 5 }} />
                {templateLabel ?? tr("Use Template", "Şablon Kullan")}
              </button>
              {templateOpen && (
                <div className="notes-template-menu">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      className="notes-template-menu-item"
                      onClick={() => {
                        applyTemplate(tpl);
                        setTemplateOpen(false);
                      }}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {onExportPdf && (
            <button
              className="notes-toolbar-export"
              onClick={() => void onExportPdf()}
            >
              <FileDown size={13} style={{ marginRight: 5 }} />
              {exportLabel ?? tr("Export PDF", "PDF Olarak Dışa Aktar")}
            </button>
          )}
          {extraToolbar}
        </div>
      </div>

      <div className="notes-single-pane">
        <div className="notes-pane-head">
          <ImageIcon size={13} />
          <span>{tr("Document", "Belge")}</span>
          <div className="notes-pane-status">
            {saveStatus === "saving" && (
              <span className="save-status saving">
                <span className="save-dot" />
                {savingLabel}
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="save-status saved">
                <Save size={11} />
                {savedLabel}
              </span>
            )}
          </div>
        </div>
        <div
          ref={editorRef}
          className="notes-rich-editor"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={placeholderTxt}
          onInput={emitChange}
          onBlur={emitChange}
          onKeyDown={(e) => {
            // Some sane defaults: Tab inserts a real tab character
            // rather than navigating focus away from the editor.
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              try { document.execCommand("insertHTML", false, "&#9;"); } catch { /* no-op */ }
              emitChange();
            }
          }}
        />
      </div>
      {/* Suppress the ui param's typed shape — the consumer uses
          `as { notesPreviewEmpty?: string }` style access elsewhere
          but we don't need it here any more. */}
      {void ui}
    </div>
  );
}

// ── Markdown → HTML (lightweight, regex-based) ──────────────────────
// Handles the syntax we used to author with: ATX headings, bold,
// italic, inline code, fenced code, blockquote, ordered/unordered
// lists, links, hr, and paragraph wrapping. Inputs that don't match
// fall back to a plain paragraph so the user can re-format with the
// toolbar.
function markdownToHtml(src: string): string {
  const esc = (s: string) => s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Fenced code first so its interior isn't mangled by other passes.
  const fenced: string[] = [];
  src = src.replace(/```([\s\S]*?)```/g, (_, body) => {
    fenced.push(`<pre><code>${esc(body)}</code></pre>`);
    return ` FENCED${fenced.length - 1} `;
  });

  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listKind) { out.push(`</${listKind}>`); listKind = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    // Fenced placeholder
    const fm = /^ FENCED(\d+) $/.exec(line);
    if (fm) { closeList(); out.push(fenced[Number(fm[1])]); continue; }
    // Headings
    const hm = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hm) {
      closeList();
      const level = hm[1].length;
      out.push(`<h${level}>${inline(hm[2])}</h${level}>`);
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line)) { closeList(); out.push("<hr>"); continue; }
    // Blockquote
    const qm = /^>\s+(.*)$/.exec(line);
    if (qm) { closeList(); out.push(`<blockquote>${inline(qm[1])}</blockquote>`); continue; }
    // Ordered list
    const om = /^\d+\.\s+(.*)$/.exec(line);
    if (om) {
      if (listKind !== "ol") { closeList(); out.push("<ol>"); listKind = "ol"; }
      out.push(`<li>${inline(om[1])}</li>`); continue;
    }
    // Unordered list (including task list)
    const um = /^[-*+]\s+(.*)$/.exec(line);
    if (um) {
      if (listKind !== "ul") { closeList(); out.push("<ul>"); listKind = "ul"; }
      const item = um[1];
      const tm = /^\[([ xX])\]\s+(.*)$/.exec(item);
      if (tm) {
        const checked = tm[1].toLowerCase() === "x" ? "checked" : "";
        out.push(`<li><input type="checkbox" disabled ${checked}> ${inline(tm[2])}</li>`);
      } else {
        out.push(`<li>${inline(item)}</li>`);
      }
      continue;
    }
    // Blank
    if (!line.trim()) { closeList(); out.push(""); continue; }
    // Paragraph
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");

  function inline(s: string): string {
    // Order matters: code → bold → italic → link.
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
    s = s.replace(/_([^_]+)_/g, (_, c) => `<em>${c}</em>`);
    s = s.replace(/\*([^*]+)\*/g, (_, c) => `<em>${c}</em>`);
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return s;
  }
}

function ToolbarButton({
  title, onClick, children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="note-tool-btn"
      title={title}
      onMouseDown={(e) => e.preventDefault() /* keep editor selection */}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
