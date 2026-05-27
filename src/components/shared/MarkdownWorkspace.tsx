import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold, Italic, Link as LinkIcon, FileDown, ListChecks, Code2,
  Heading1, Heading2, Quote, Sparkles, Save, FileText,
} from "lucide-react";

export type MarkdownTemplate = {
  id: string;
  label: string;
  build: () => string;
};

export type SaveStatus = "idle" | "saving" | "saved";

export type MarkdownWorkspaceProps = {
  value: string;
  onChange: (value: string) => void;
  language: string;
  ui: Record<string, unknown>;
  saveStatus: SaveStatus;
  templates: MarkdownTemplate[];
  onExportPdf?: () => void | Promise<void>;
  exportLabel?: string;
  placeholder?: string;
  /** Optional override for the template-button label */
  templateLabel?: string;
  /** Optional: render extra controls at the right end of the toolbar */
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  // ── Editor helpers ────────────────────────────────────────────────────────
  type WrapOpts = { prefix: string; suffix?: string; placeholder?: string };
  const wrap = ({ prefix, suffix = "", placeholder = "" }: WrapOpts) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: ss, selectionEnd: se } = ta;
    const selected = value.slice(ss, se) || placeholder;
    const inserted = `${prefix}${selected}${suffix}`;
    const next = value.slice(0, ss) + inserted + value.slice(se);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const start = ss + prefix.length;
      const end = start + selected.length;
      ta.setSelectionRange(start, end);
    });
  };

  const wrapLines = (linePrefix: string, fallback: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: ss, selectionEnd: se } = ta;
    const selected = value.slice(ss, se);
    const block = (selected || fallback)
      .split("\n")
      .map((l) => (l.startsWith(linePrefix) ? l : `${linePrefix}${l}`))
      .join("\n");
    const next = value.slice(0, ss) + block + value.slice(se);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ss, ss + block.length);
    });
  };

  const insertCodeFence = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: ss, selectionEnd: se } = ta;
    const selected = value.slice(ss, se);
    const fenced = `\n\`\`\`rust\n${selected || "fn main() {\n    println!(\"hello, world\");\n}"}\n\`\`\`\n`;
    const next = value.slice(0, ss) + fenced + value.slice(se);
    onChange(next);
  };

  const insertLink = () => {
    const url = window.prompt(tr("Enter URL", "URL gir"), "https://");
    if (!url) return;
    wrap({ prefix: "[", suffix: `](${url})`, placeholder: tr("link text", "bağlantı metni") });
  };

  const applyTemplate = (tpl: MarkdownTemplate) => {
    if (value.trim().length > 0) {
      const ok = window.confirm(
        tr(
          "This will replace your existing content. Continue?",
          "Mevcut içeriğin üstüne yazılacak. Devam edilsin mi?"
        )
      );
      if (!ok) return;
    }
    onChange(tpl.build());
  };

  // Close the template dropdown if user clicks outside — simple controlled state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTemplateOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // (template menu state lives here, declared near use to keep file shallow)
  const [templateOpen, setTemplateOpen] = useTemplateMenuState();

  const savedLabel = tr("Saved", "Kaydedildi");
  const savingLabel = tr("Saving…", "Kaydediliyor…");

  return (
    <div className="notes-tab markdown-workspace">
      <div className="notes-toolbar">
        <div className="notes-toolbar-group">
          <ToolbarButton title={tr("Bold", "Kalın")} onClick={() => wrap({ prefix: "**", suffix: "**", placeholder: tr("strong", "kalın") })}>
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Italic", "İtalik")} onClick={() => wrap({ prefix: "_", suffix: "_", placeholder: tr("italic", "italik") })}>
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Link", "Bağlantı")} onClick={insertLink}>
            <LinkIcon size={14} />
          </ToolbarButton>
        </div>
        <div className="notes-toolbar-divider" />
        <div className="notes-toolbar-group">
          <ToolbarButton title="H1" onClick={() => wrapLines("# ", tr("Heading 1", "Başlık 1"))}>
            <Heading1 size={14} />
          </ToolbarButton>
          <ToolbarButton title="H2" onClick={() => wrapLines("## ", tr("Heading 2", "Başlık 2"))}>
            <Heading2 size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Quote", "Alıntı")} onClick={() => wrapLines("> ", tr("Quote", "Alıntı"))}>
            <Quote size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Checklist", "Görev listesi")} onClick={() => wrapLines("- [ ] ", tr("Task", "Görev"))}>
            <ListChecks size={14} />
          </ToolbarButton>
          <ToolbarButton title={tr("Code block", "Kod bloğu")} onClick={insertCodeFence}>
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

      <div className="notes-split">
        <div className="notes-editor-wrap notes-editor-pane">
          <div className="notes-pane-head">
            <FileText size={13} />
            <span>{tr("Editor", "Editör")}</span>
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
          <textarea
            ref={textareaRef}
            className="notes-textarea"
            value={value}
            placeholder={
              placeholder ??
              tr(
                "Start typing — Markdown supported: # H1, ## H2, **bold**, *italic*, - [ ] todo, ```rust code blocks…",
                "Yazmaya başla — Markdown destekli: # H1, ## H2, **kalın**, *italik*, - [ ] yapılacak, ```rust kod blokları…"
              )
            }
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="notes-preview-pane notes-editor-pane">
          <div className="notes-pane-head">
            <Sparkles size={13} />
            <span>{tr("Preview", "Önizleme")}</span>
          </div>
          <div className="notes-preview-body">
            {value.trim() ? (
              <div className="markdown-render">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
              </div>
            ) : (
              <p className="notes-preview-empty">{String((ui as { notesPreviewEmpty?: string }).notesPreviewEmpty ?? "")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  title, onClick, children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="note-tool-btn" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

// Tiny inline state hook (saves importing useState at top, keeps component self-contained)
import { useState } from "react";
function useTemplateMenuState() {
  return useState(false);
}
