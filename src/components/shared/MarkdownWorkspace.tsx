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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold, Italic, Link as LinkIcon, FileDown, Sparkles, Save,
  Image as ImageIcon, ListTree, Plus,
} from "lucide-react";
import {
  buildDatabasePlaceholder, encodeDb, makeDatabase,
  mountDatabases, unmountDatabases,
} from "../../lib/noteDatabase";
import {
  assetKindFromPath, buildAssetHtml, pickAssetFile, resolveAssetSrcs,
} from "../../lib/noteAssets";
import { getPluginSlashCommands } from "../../lib/plugins";
import { sanitizeNoteHtml } from "../../lib/sanitizeHtml";
// Inline mirror of the language list to keep the heavy highlight.js
// bundle out of the main chunk — the editor only paid the cost
// before because the import here pulled the whole highlighter graph.
const SUPPORTED_LANGUAGES: { id: string; label: string }[] = [
  { id: "csharp",     label: "C#" },
  { id: "cpp",        label: "C++" },
  { id: "rust",       label: "Rust" },
  { id: "gdscript",   label: "GDScript" },
  { id: "lua",        label: "Lua" },
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "python",     label: "Python" },
  { id: "json",       label: "JSON" },
  { id: "yaml",       label: "YAML" },
  { id: "toml",       label: "TOML" },
  { id: "ini",        label: "INI" },
  { id: "xml",        label: "XML / HTML" },
  { id: "bash",       label: "Bash" },
  { id: "markdown",   label: "Markdown" },
  { id: "plaintext",  label: "Plain text" },
];

export type MarkdownTemplate = {
  id: string;
  label: string;
  build: () => string;
  /** When true the template was created by the user (stored in
   *  localStorage) and the menu shows a delete affordance next to
   *  the row. Built-in templates from `lib/noteTemplates.ts` ship
   *  without this flag. */
  custom?: boolean;
  /** Called when the user clicks the delete chip on a custom template
   *  row. Only meaningful for `custom: true` entries. */
  onDelete?: () => void;
};

/** localStorage payload + helpers for user-defined templates. The
 *  templates are scoped to the editor instance — passing
 *  `scope="global"` keeps studio-level notes separate from per-game
 *  notes so a GDD-flavoured template doesn't clutter the global
 *  notes menu and vice-versa. */
type StoredCustomTemplate = { id: string; name: string; content: string; createdAt: string };
const CUSTOM_TEMPLATE_KEY = (scope: string) => `heravex_custom_note_templates_${scope}_v1`;
function loadCustomTemplates(scope: string): StoredCustomTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATE_KEY(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveCustomTemplates(scope: string, list: StoredCustomTemplate[]) {
  try { localStorage.setItem(CUSTOM_TEMPLATE_KEY(scope), JSON.stringify(list)); } catch {}
}

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
  /** Optional scope id for the user's custom-template store. The
   *  `Save as template` button appears only when this prop is set.
   *  Two scopes ship today: `"global"` (studio knowledge base notes)
   *  and `"game"` (per-game GDD notes), so each surface keeps its
   *  own user library. */
  customTemplateScope?: string;
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
  customTemplateScope,
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
    // Sanitised: notes can come from teammates or imported files.
    if (/<\/?[a-z][\s\S]*?>/i.test(raw)) return sanitizeNoteHtml(raw);
    return sanitizeNoteHtml(markdownToHtml(raw));
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
      // External-value swap (note picker change, template apply,
      // markdown→HTML conversion). Re-highlight any code blocks that
      // came in unhighlighted — the lazy module is loaded only when
      // the editor actually has code blocks to render.
      if (el.querySelector("pre.note-code")) {
        queueHighlight();
      }
      // Re-mount database placeholders — `data-mounted` was cleared
      // by writing innerHTML.
      if (el.querySelector(".note-db[data-db]")) {
        unmountDatabases(el);
        queueDatabaseMount();
      }
      // Re-point local asset references at the current asset:// host.
      // Saved HTML carries the absolute path in data-asset-path; the
      // src is re-resolved here so references survive across reloads
      // and Tauri version bumps.
      if (el.querySelector("[data-asset-path]")) {
        resolveAssetSrcs(el);
      }
    }
    lastExternalValueRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ── Toolbar actions ────────────────────────────────────────────────
  const focusEditor = () => editorRef.current?.focus();
  // emitChange also bumps the TOC re-evaluation tick so the side rail
  // refreshes whenever the user adds, removes, or renames a heading.
  const tocTickRef = useRef(0);
  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastWrittenHtmlRef.current = html;
    lastExternalValueRef.current = html;
    onChange(html);
    tocTickRef.current++;
    setTocTick(tocTickRef.current);
  };

  // `document.execCommand` is the simplest way to apply a format to
  // the current Selection without writing custom Range surgery. All
  // shipped Tauri WebView2 / WKWebView builds still honour it.
  const exec = (cmd: string, val?: string) => {
    focusEditor();
    try { document.execCommand(cmd, false, val); } catch { /* no-op */ }
    emitChange();
  };

  // ── Selection persistence (v0.9.7) ──────────────────────────────
  //
  // Some toolbar actions need to ask the user for input (link URL,
  // future picker dialogs) which pops a modal / window.prompt and
  // wipes the editor's Selection. We snapshot the live Range on
  // every toolbar `mousedown` and restore it just before applying
  // the command so "select text, click format" works for prompts
  // too.
  const savedRangeRef = useRef<Range | null>(null);
  const captureSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    const r = savedRangeRef.current;
    if (!r) return;
    focusEditor();
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  const formatBlock = (tag: string) => exec("formatBlock", tag);
  const toggleBold      = () => exec("bold");
  const toggleItalic    = () => exec("italic");
  const insertBullet    = () => exec("insertUnorderedList");
  const insertNumbered  = () => exec("insertOrderedList");
  const insertQuote     = () => formatBlock("blockquote");
  // Code block now wraps the current Selection so users can select
  // some text and click the code button to put it in a `<pre><code>`.
  // Empty selection falls back to inserting an editable placeholder
  // (the previous behaviour) so the toolbar still works at a fresh
  // caret. The wrapper carries `data-lang` so the editor-root blur
  // delegate can re-run highlight.js on the literal text after the
  // user finishes typing.
  const insertCode = (lang: string = "plaintext") => {
    const sel = window.getSelection();
    const txt = sel && !sel.isCollapsed ? sel.toString() : "";
    const safe = (txt || tr("code", "kod"))
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // The .note-code-meta + .note-code-copy spans are marked
    // contenteditable=false so they're non-editable inside the
    // contentEditable shell. The editor-root click delegate (below)
    // handles the copy button.
    const langLabel = SUPPORTED_LANGUAGES.find((l) => l.id === lang)?.label ?? lang;
    exec("insertHTML",
      `<pre class="note-code" data-lang="${lang}"><span class="note-code-meta" contenteditable="false">${langLabel}</span><span class="note-code-copy" contenteditable="false" data-action="copy-code">${tr("Copy", "Kopyala")}</span><code class="hljs language-${lang}">${safe}</code></pre><p><br></p>`);
    // Highlight the freshly-inserted block on the next tick — the
    // lazy module will be in cache after the first code block.
    queueHighlight();
  };

  // Toggle / collapsible block — native <details>/<summary>. Works
  // in the editor, in the PDF (open by default), and in the markdown
  // parser via the `??? Title` shorthand. The empty <p> after keeps
  // the caret from being trapped inside the details element.
  const insertToggle = () => {
    const title = tr("Toggle title", "Açılır başlık");
    const body  = tr("Hidden content — click to expand.", "Gizli içerik — açmak için tıkla.");
    exec("insertHTML",
      `<details class="note-toggle" open><summary>${title}</summary><p>${body}</p></details><p><br></p>`);
  };

  // Insert a new typed-table database. Schema + rows live as JSON in
  // a `data-db` attribute on the placeholder, so the entire database
  // travels with the note — backup/portability is automatic.
  const insertDatabase = () => {
    const name = window.prompt(
      tr("Database name", "Tablo adı"),
      tr("New Database", "Yeni Tablo"),
    );
    if (!name) return;
    const db = makeDatabase(name);
    exec("insertHTML", buildDatabasePlaceholder(db) + "<p><br></p>");
    queueDatabaseMount();
  };

  // Database mount runner — finds placeholders + stamps interactive
  // tables. Debounced through `databaseMountRef` so a burst of input
  // events doesn't trigger N re-mounts.
  const databaseMountRef = useRef(false);
  const queueDatabaseMount = () => {
    if (databaseMountRef.current) return;
    databaseMountRef.current = true;
    setTimeout(() => {
      databaseMountRef.current = false;
      const el = editorRef.current;
      if (!el) return;
      mountDatabases(el, {
        language,
        onPersist: (placeholder, db) => {
          placeholder.setAttribute("data-db", encodeDb(db));
          emitChange();
        },
      });
    }, 30);
  };

  const insertLink = () => {
    // Snapshot the selection BEFORE prompt() steals focus. The prompt
    // collapses the selection to nothing; without the snapshot the
    // subsequent execCommand has no Range to write into and the link
    // silently vanishes.
    captureSelection();
    const url = window.prompt(tr("Enter URL", "URL gir"), "https://");
    if (!url) return;
    restoreSelection();
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
    // v0.9.7 bug fix: `disabled` was killing user interaction (couldn't
    // tick the box). Removed. Click handling lives on the editor root
    // (delegated below) so a freshly-inserted checkbox is interactive
    // immediately without needing a per-list listener.
    exec("insertHTML",
      `<ul class="note-checklist"><li><input type="checkbox"> ${tr("Task", "Görev")}</li></ul>`);
  };

  // ── Callouts (v0.9.7) ───────────────────────────────────────────────
  //
  // Four flavours sharing one container shape:
  //   info    — neutral facts, default
  //   warn    — soft warning the reader should mind
  //   danger  — hard "don't do this", lost-data territory
  //   ok      — tips / "this is the easy path"
  //
  // The inserted markup is plain HTML the contentEditable can edit
  // freely — title is a <strong>, body is one <p>. Print stylesheet
  // already styles these; the editor sheet (styles.css addition
  // below) mirrors the look in the WYSIWYG view.
  type CalloutKind = "info" | "warn" | "danger" | "ok";
  const calloutLabels: Record<CalloutKind, [string, string]> = {
    info:   ["Note", "Not"],
    warn:   ["Warning", "Uyarı"],
    danger: ["Danger", "Tehlike"],
    ok:     ["Tip", "İpucu"],
  };
  const calloutBodies: Record<CalloutKind, [string, string]> = {
    info:   ["Add a short explanatory note here.", "Açıklayıcı bir not ekle."],
    warn:   ["Heads-up — read before continuing.", "Devam etmeden önce dikkat et."],
    danger: ["Critical — this can lose data.", "Kritik — veri kaybına yol açabilir."],
    ok:     ["Easy path — recommended approach.", "Tavsiye edilen yaklaşım."],
  };
  const insertCallout = (kind: CalloutKind) => {
    const [titleEn, titleTr] = calloutLabels[kind];
    const [bodyEn, bodyTr] = calloutBodies[kind];
    const title = tr(titleEn, titleTr);
    const body  = tr(bodyEn,  bodyTr);
    exec("insertHTML",
      `<div class="callout callout-${kind}"><strong>${title}</strong><p>${body}</p></div><p><br></p>`);
  };

  // ── Table of Contents (v0.9.7) ──────────────────────────────────────
  //
  // The TOC scans h1/h2/h3 from the live editor DOM and renders a
  // small side rail next to the editor. Clicking a heading scrolls
  // it into view inside the editor — IDs are attached on the fly so
  // the rail isn't tied to specific heading text. Toggled via the
  // ListTree toolbar button; persists per-component (not stored on
  // disk).
  const [tocOpen, setTocOpen] = useState(false);
  const [tocTick, setTocTick] = useState(0);
  const tocHeadings = useMemo(() => {
    // `tocTick` is a re-evaluation knob — emitChange bumps it so the
    // memo recomputes against the freshly-edited DOM.
    void tocTick;
    const el = editorRef.current;
    if (!el || !tocOpen) return [] as { id: string; level: number; text: string }[];
    const items: { id: string; level: number; text: string }[] = [];
    const nodes = el.querySelectorAll("h1, h2, h3");
    nodes.forEach((n, idx) => {
      const h = n as HTMLElement;
      let id = h.id;
      if (!id) {
        id = `toc-h-${idx}-${(h.textContent || "").slice(0, 24).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        h.id = id;
      }
      items.push({
        id,
        level: Number(h.tagName.slice(1)),
        text: (h.textContent ?? "").trim() || `Heading ${idx + 1}`,
      });
    });
    return items;
  }, [tocOpen, tocTick]);
  const scrollToHeading = (id: string) => {
    const el = editorRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("toc-target-flash");
    setTimeout(() => el.classList.remove("toc-target-flash"), 1200);
  };

  // ── Code-block highlight runner (v0.9.7) ───────────────────────────
  //
  // Lazy-imports the highlight.js bridge the first time it's needed
  // and reuses the cached module for every subsequent call. Re-runs
  // against every `pre.note-code > code` in the editor — re-painting
  // is idempotent (same text → same HTML).
  const highlightRunRef = useRef(false);
  const queueHighlight = () => {
    if (highlightRunRef.current) return;
    highlightRunRef.current = true;
    setTimeout(() => {
      highlightRunRef.current = false;
      void runHighlightSweep();
    }, 60);
  };

  const runHighlightSweep = async () => {
    const el = editorRef.current;
    if (!el) return;
    const codes = el.querySelectorAll("pre.note-code > code");
    if (codes.length === 0) return;
    const { highlight } = await import("../../lib/codeHighlight");
    let changed = false;
    codes.forEach((codeEl) => {
      const code = codeEl as HTMLElement;
      const pre = code.parentElement;
      const lang = pre?.getAttribute("data-lang") || "plaintext";
      // Use textContent so a previously-highlighted block (full of
      // <span>s) is re-flattened to its raw source before painting.
      const raw = code.textContent ?? "";
      const next = highlight(raw, lang);
      if (code.innerHTML !== next) {
        code.innerHTML = next;
        changed = true;
      }
    });
    if (changed) emitChange();
  };

  // ── Local asset insertion (v0.9.8) ──────────────────────────────────
  //
  // Three entry points, all converging on `insertAssetByPath`:
  //   • toolbar Image button
  //   • the `/asset` inline trigger (typed in the editor)
  //   • OS drag-and-drop (handled by the Tauri webview event below)
  // The file is never copied — only its absolute path is referenced.
  const insertAssetByPath = (path: string) => {
    const html = buildAssetHtml(path);
    if (!html) {
      window.alert(tr(
        "Unsupported file type. Pick an image (png/jpg/gif/webp/svg) or audio (wav/mp3/ogg…).",
        "Desteklenmeyen dosya türü. Bir görsel (png/jpg/gif/webp/svg) ya da ses (wav/mp3/ogg…) seç.",
      ));
      return;
    }
    exec("insertHTML", html + "<p><br></p>");
    resolveAssetSrcs(editorRef.current);
  };
  const triggerAssetPicker = async () => {
    // Snapshot the caret BEFORE the native dialog steals focus, then
    // restore it so the asset lands where the user was typing.
    captureSelection();
    const path = await pickAssetFile();
    if (!path) return;
    restoreSelection();
    insertAssetByPath(path);
  };

  // ── Slash command menu (v0.9.8) ─────────────────────────────────────
  //
  // Typing "/" anywhere opens a Notion-style command palette at the
  // caret. Every block-level insert that used to clutter the toolbar
  // lives here now; the toolbar keeps only inline format + global
  // actions. The menu filters as the user types ("/tab" → Table,
  // "/csharp" → C# code block) and is driven by keyboard (↑/↓/Enter/Esc)
  // or click.
  type SlashCmd = { id: string; label: string; hint: string; keywords: string; run: () => void };
  const [slash, setSlash] = useState<{ query: string; top: number; left: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRangeRef = useRef<Range | null>(null);

  const insertDivider = () => exec("insertHTML", "<hr><p><br></p>");

  const buildSlashCommands = (): SlashCmd[] => {
    const cmds: SlashCmd[] = [
      { id: "h1",   label: tr("Heading 1", "Başlık 1"),       hint: "H1",  keywords: "h1 heading title baslik",            run: () => formatBlock("h1") },
      { id: "h2",   label: tr("Heading 2", "Başlık 2"),       hint: "H2",  keywords: "h2 heading subtitle baslik",         run: () => formatBlock("h2") },
      { id: "h3",   label: tr("Heading 3", "Başlık 3"),       hint: "H3",  keywords: "h3 heading baslik",                  run: () => formatBlock("h3") },
      { id: "p",    label: tr("Paragraph", "Paragraf"),       hint: "¶",   keywords: "p paragraph text metin",             run: () => formatBlock("p") },
      { id: "quote",label: tr("Quote", "Alıntı"),             hint: "❝",   keywords: "quote blockquote alinti",            run: insertQuote },
      { id: "ul",   label: tr("Bullet list", "Madde listesi"),hint: "•",   keywords: "bullet list ul madde liste",         run: insertBullet },
      { id: "ol",   label: tr("Numbered list", "Numaralı liste"), hint: "1.", keywords: "numbered ordered ol liste numarali", run: insertNumbered },
      { id: "todo", label: tr("Checklist", "Görev listesi"),  hint: "☑",   keywords: "checklist todo task gorev kutu",     run: insertChecklist },
      { id: "table",label: tr("Table", "Tablo"),              hint: "▦",   keywords: "table tablo grid izgara",            run: () => insertTable() },
      { id: "toggle",label: tr("Toggle list", "Açılır liste"),hint: "▸",   keywords: "toggle details acilir collapsible",  run: insertToggle },
      { id: "db",   label: tr("Database", "Tablo (database)"),hint: "▤",   keywords: "database db tablo veritabani",        run: insertDatabase },
      { id: "callout-info",  label: tr("Callout: Note", "Kutu: Not"),       hint: "ℹ", keywords: "callout note info bilgi not",   run: () => insertCallout("info") },
      { id: "callout-ok",    label: tr("Callout: Tip", "Kutu: İpucu"),      hint: "✓", keywords: "callout tip ok ipucu",         run: () => insertCallout("ok") },
      { id: "callout-warn",  label: tr("Callout: Warning", "Kutu: Uyarı"),  hint: "▲", keywords: "callout warning warn uyari",   run: () => insertCallout("warn") },
      { id: "callout-danger",label: tr("Callout: Danger", "Kutu: Tehlike"), hint: "⛔", keywords: "callout danger tehlike",       run: () => insertCallout("danger") },
      { id: "divider", label: tr("Divider", "Ayraç"),         hint: "—",   keywords: "divider hr rule ayrac cizgi",        run: insertDivider },
      { id: "asset", label: tr("Image / Audio", "Görsel / Ses"), hint: "🖼", keywords: "asset image audio gorsel ses media resim", run: () => { void triggerAssetPicker(); } },
    ];
    // One entry per code language so "/code" or "/python" both work.
    for (const l of SUPPORTED_LANGUAGES) {
      cmds.push({
        id: `code-${l.id}`,
        label: tr(`Code: ${l.label}`, `Kod: ${l.label}`),
        hint: "</>",
        keywords: `code kod block ${l.id} ${l.label.toLowerCase()}`,
        run: () => insertCode(l.id),
      });
    }
    // Plugin-contributed slash commands (v0.9.9) — read live so a
    // freshly-enabled plugin appears without an editor remount.
    for (const pc of getPluginSlashCommands()) {
      cmds.push({
        id: `plugin-${pc.id}`,
        label: pc.label,
        hint: pc.hint ?? "🧩",
        keywords: `${pc.label.toLowerCase()} ${pc.pluginName.toLowerCase()} plugin eklenti`,
        run: () => {
          pc.onSelect((html) => exec("insertHTML", html));
        },
      });
    }
    return cmds;
  };

  const filteredSlash = (): SlashCmd[] => {
    if (!slash) return [];
    const all = buildSlashCommands();
    const q = slash.query.trim().toLowerCase();
    if (!q) {
      // No query yet → show the common blocks; collapse the long
      // per-language code list down to a single generic entry.
      return all.filter((c) => !c.id.startsWith("code-") || c.id === "code-plaintext");
    }
    return all
      .filter((c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q))
      .slice(0, 9);
  };

  // Locate a "/token" immediately before the collapsed caret. Returns the
  // query text + a range covering the token (for deletion + positioning).
  const getSlashContext = (): { query: string; rect: DOMRect; range: Range } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    if (!editorRef.current?.contains(node)) return null;
    const text = node.textContent ?? "";
    const caret = range.startOffset;
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "/") break;
      if (/\s/.test(ch)) return null; // any whitespace ends the token
      i--;
    }
    if (i < 0) return null;
    // The "/" must start a word — beginning of node or preceded by space.
    if (i > 0) {
      const prev = text[i - 1];
      if (!/\s/.test(prev)) return null;
    }
    const query = text.slice(i + 1, caret);
    if (/\s/.test(query)) return null;
    const tokenRange = document.createRange();
    tokenRange.setStart(node, i);
    tokenRange.setEnd(node, caret);
    return { query, rect: tokenRange.getBoundingClientRect(), range: tokenRange };
  };

  const updateSlashFromCaret = () => {
    const ctx = getSlashContext();
    if (!ctx) { setSlash(null); slashRangeRef.current = null; return; }
    slashRangeRef.current = ctx.range;
    setSlash({ query: ctx.query, top: ctx.rect.bottom + 4, left: ctx.rect.left });
    setSlashIndex(0);
  };

  const runSlashCommand = (cmd: SlashCmd) => {
    // Strip the "/query" token before running so it never lingers.
    const r = slashRangeRef.current;
    if (r) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      try { document.execCommand("delete"); } catch { /* no-op */ }
    }
    setSlash(null);
    slashRangeRef.current = null;
    cmd.run();
  };

  // Toolbar "+" button — seeds a "/" at the caret and opens the menu so
  // the command palette stays discoverable without knowing the shortcut.
  const openSlashMenu = () => {
    focusEditor();
    try { document.execCommand("insertText", false, "/"); } catch { /* no-op */ }
    updateSlashFromCaret();
  };

  // onInput wrapper: refresh the slash menu, then flush the change.
  const handleEditorInput = () => {
    updateSlashFromCaret();
    emitChange();
  };

  // OS drag-and-drop of files. Tauri intercepts native file drops (the
  // DOM `drop` event never sees the paths), so we subscribe to the
  // webview's drag-drop event, which hands us absolute paths directly —
  // exactly what the copy-free asset model needs.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type !== "drop") return;
          const el = editorRef.current;
          if (!el) return;
          // Drop position is in physical pixels; map to CSS px for DOM.
          const dpr = window.devicePixelRatio || 1;
          const cssX = p.position.x / dpr;
          const cssY = p.position.y / dpr;
          const rect = el.getBoundingClientRect();
          const inside =
            cssX >= rect.left && cssX <= rect.right &&
            cssY >= rect.top && cssY <= rect.bottom;
          if (!inside) return;
          // Place the caret where the file was dropped (best-effort).
          const caret = (document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          }).caretRangeFromPoint?.(cssX, cssY);
          if (caret) {
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(caret);
          }
          focusEditor();
          const media = p.paths.filter((path) => assetKindFromPath(path) != null);
          if (media.length === 0) return;
          for (const path of media) {
            const html = buildAssetHtml(path);
            if (html) {
              try { document.execCommand("insertHTML", false, html + "<p><br></p>"); } catch { /* no-op */ }
            }
          }
          resolveAssetSrcs(el);
          emitChange();
        });
        if (disposed) un(); else unlisten = un;
      } catch {
        // Not running under Tauri (e.g. plain `vite` preview) — drag-drop
        // simply stays inert; the toolbar button + /asset still work.
      }
    })();
    return () => { disposed = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── User-created templates (v0.9.7) ─────────────────────────────────
  //
  // The user can press "Save as template" to drop their current note
  // into a per-scope library. Stored entries become MarkdownTemplate
  // rows that join the built-in set in the dropdown — each one ships
  // a deleter so the menu stays curatable.
  const [customTemplates, setCustomTemplates] = useState<StoredCustomTemplate[]>(() =>
    customTemplateScope ? loadCustomTemplates(customTemplateScope) : [],
  );
  useEffect(() => {
    if (!customTemplateScope) { setCustomTemplates([]); return; }
    setCustomTemplates(loadCustomTemplates(customTemplateScope));
  }, [customTemplateScope]);
  const persistCustomTemplates = (list: StoredCustomTemplate[]) => {
    setCustomTemplates(list);
    if (customTemplateScope) saveCustomTemplates(customTemplateScope, list);
  };
  const handleSaveAsTemplate = () => {
    if (!customTemplateScope) return;
    const el = editorRef.current;
    const content = el?.innerHTML?.trim() ?? "";
    if (!content) {
      window.alert(tr(
        "Editor is empty — nothing to save as a template.",
        "Editör boş — şablon olarak kaydedilecek bir şey yok.",
      ));
      return;
    }
    const name = window.prompt(
      tr("Template name", "Şablon adı"),
      tr("My Template", "Şablonum"),
    );
    if (!name || !name.trim()) return;
    const next: StoredCustomTemplate[] = [
      ...customTemplates,
      {
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim(),
        content,
        createdAt: new Date().toISOString(),
      },
    ];
    persistCustomTemplates(next);
  };
  const handleDeleteCustomTemplate = (id: string) => {
    if (!window.confirm(tr("Delete this template?", "Bu şablon silinsin mi?"))) return;
    persistCustomTemplates(customTemplates.filter((t) => t.id !== id));
  };

  // Merge the built-in templates with the user-defined ones. Custom
  // entries sit at the bottom under their own subheader, separated by
  // a divider in the menu (rendered below).
  const mergedTemplates: MarkdownTemplate[] = useMemo(() => {
    const fromUser: MarkdownTemplate[] = customTemplates.map((t) => ({
      id: t.id,
      label: t.name,
      build: () => t.content,
      custom: true,
      onDelete: () => handleDeleteCustomTemplate(t.id),
    }));
    return [...templates, ...fromUser];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, customTemplates]);

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
    // Templates ship as markdown source. Convert to HTML *before*
    // touching the editor so the user sees the rendered output and
    // never the raw `# Heading` / `- bullet` syntax.
    const rawMarkdown = tpl.build();
    const html = markdownToHtml(rawMarkdown);
    if (el) {
      el.innerHTML = html;
      // Sync both refs to the actual DOM-normalised HTML so the
      // useEffect below doesn't try to re-write the editor on the next
      // render and stomp the user's caret.
      const normalised = el.innerHTML;
      lastWrittenHtmlRef.current = normalised;
      lastExternalValueRef.current = normalised;
      onChange(normalised);
    } else {
      onChange(html);
    }
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
          {/* v0.9.8 — block inserts moved into the slash command menu.
              This button seeds a "/" and opens it; users can also just
              type "/" anywhere in the document. */}
          <button
            type="button"
            className="note-tool-btn note-tool-insert"
            title={tr("Insert block — or type / in the editor", "Blok ekle — ya da editörde / yaz")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openSlashMenu}
          >
            <Plus size={14} />
            <span className="note-tool-insert-text">{tr("Insert", "Ekle")}</span>
            <kbd className="note-tool-insert-kbd">/</kbd>
          </button>
          <ToolbarButton
            title={tr("Table of Contents", "İçindekiler")}
            onClick={() => setTocOpen((o) => !o)}
          >
            <ListTree size={14} />
          </ToolbarButton>
        </div>
        <div className="notes-toolbar-divider" />
        <div className="notes-toolbar-group notes-toolbar-grow">
          {mergedTemplates.length > 0 && (
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
                  {/* Built-in templates first. */}
                  {mergedTemplates.filter((t) => !t.custom).map((tpl) => (
                    <button
                      key={tpl.id}
                      className="notes-template-menu-item"
                      onClick={() => { applyTemplate(tpl); setTemplateOpen(false); }}
                    >
                      {tpl.label}
                    </button>
                  ))}
                  {/* Custom templates sit under a labelled divider so the
                      user can tell them apart at a glance; each row gets
                      a trailing × delete affordance. */}
                  {mergedTemplates.some((t) => t.custom) && (
                    <>
                      <div className="notes-template-menu-divider">
                        {tr("YOUR TEMPLATES", "BENİM ŞABLONLARIM")}
                      </div>
                      {mergedTemplates.filter((t) => t.custom).map((tpl) => (
                        <div key={tpl.id} className="notes-template-menu-row">
                          <button
                            className="notes-template-menu-item notes-template-menu-item-custom"
                            onClick={() => { applyTemplate(tpl); setTemplateOpen(false); }}
                          >
                            {tpl.label}
                          </button>
                          <button
                            className="notes-template-menu-delete"
                            title={tr("Delete template", "Şablonu sil")}
                            onClick={(e) => { e.stopPropagation(); tpl.onDelete?.(); }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {customTemplateScope && (
            <button
              className="notes-toolbar-template notes-toolbar-template-save"
              onClick={handleSaveAsTemplate}
              title={tr("Save current note as a reusable template.", "Mevcut notu yeniden kullanılabilir şablon olarak kaydet.")}
            >
              <Save size={13} style={{ marginRight: 5 }} />
              {tr("Save as Template", "Şablon Olarak Kaydet")}
            </button>
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

      <div className={`notes-single-pane ${tocOpen ? "has-toc" : ""}`}>
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
        {tocOpen && (
          <aside className="notes-toc-rail" aria-label={tr("Table of contents", "İçindekiler")}>
            <p className="notes-toc-rail-label">{tr("CONTENTS", "İÇİNDEKİLER")}</p>
            {tocHeadings.length === 0 ? (
              <p className="notes-toc-rail-empty">
                {tr("Add headings (H1, H2, H3) to see them here.", "H1, H2, H3 başlık ekle, burada görüneceler.")}
              </p>
            ) : (
              <ol className="notes-toc-rail-list">
                {tocHeadings.map((h) => (
                  <li key={h.id} className={`toc-level-${h.level}`}>
                    <button
                      type="button"
                      className="notes-toc-rail-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => scrollToHeading(h.id)}
                      title={h.text}
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        )}
        <div
          ref={editorRef}
          className="notes-rich-editor"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={placeholderTxt}
          onInput={handleEditorInput}
          onBlur={(e) => {
            emitChange();
            // Re-highlight code after the user stops editing. Skip if
            // the blur came from focus jumping to a child of the editor
            // (e.g. between toolbar buttons) — those are handled by
            // their own onMouseDown preventDefault.
            if (!editorRef.current?.contains(e.relatedTarget as Node | null)) {
              queueHighlight();
            }
            // Close the slash menu when focus genuinely leaves the editor.
            if (!editorRef.current?.contains(e.relatedTarget as Node | null)) {
              setSlash(null);
            }
          }}
          // Click delegate for in-editor widgets:
          //   • Checkbox tick (toggles `checked` attr so HTML round-trip
          //     preserves it; property would be lost on innerHTML read).
          //   • Copy button inside code blocks — grabs the inner code's
          //     textContent and pushes it to the OS clipboard.
          onClick={(e) => {
            const target = e.target as HTMLElement;
            // Code-block copy chip
            const copyBtn = target.closest('[data-action="copy-code"]') as HTMLElement | null;
            if (copyBtn) {
              e.preventDefault();
              const pre = copyBtn.closest("pre.note-code") as HTMLElement | null;
              const code = pre?.querySelector("code");
              const txt = code?.textContent ?? "";
              if (txt) {
                navigator.clipboard?.writeText(txt).catch(() => {});
                copyBtn.classList.add("is-copied");
                window.setTimeout(() => copyBtn.classList.remove("is-copied"), 1200);
              }
              return;
            }
            // Checkbox toggle
            if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
              const cb = target as HTMLInputElement;
              if (cb.checked) cb.setAttribute("checked", "");
              else cb.removeAttribute("checked");
              emitChange();
            }
          }}
          onKeyDown={(e) => {
            // Slash menu navigation takes priority while it's open.
            if (slash) {
              const items = filteredSlash();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => (items.length ? (i + 1) % items.length : 0));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
                return;
              }
              if (e.key === "Enter") {
                if (items.length) {
                  e.preventDefault();
                  runSlashCommand(items[Math.min(slashIndex, items.length - 1)]);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlash(null);
                return;
              }
            }
            // Some sane defaults: Tab inserts a real tab character
            // rather than navigating focus away from the editor.
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              try { document.execCommand("insertHTML", false, "&#9;"); } catch { /* no-op */ }
              emitChange();
            }
          }}
        />

        {/* ── Slash command palette (v0.9.8) ──────────────────────── */}
        {/* Portaled to <body> so the fixed positioning is relative to the
            viewport, not to NoteCenter's transformed (framer-motion)
            ancestor — which would otherwise offset the menu. */}
        {slash && createPortal((() => {
          const items = filteredSlash();
          return (
            <div
              className="note-slash-menu"
              style={{ top: slash.top, left: slash.left }}
              role="listbox"
            >
              {items.length === 0 ? (
                <div className="note-slash-empty">
                  {tr("No matching command", "Eşleşen komut yok")}
                </div>
              ) : (
                items.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={i === slashIndex}
                    className={`note-slash-item ${i === slashIndex ? "is-active" : ""}`}
                    // Keep the editor selection alive so runSlashCommand can
                    // delete the "/token" and insert at the right caret.
                    onMouseDown={(ev) => ev.preventDefault()}
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => runSlashCommand(cmd)}
                  >
                    <span className="note-slash-hint">{cmd.hint}</span>
                    <span className="note-slash-label">{cmd.label}</span>
                  </button>
                ))
              )}
            </div>
          );
        })(), document.body)}
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
  // GFM-style language tag after the opening ``` becomes the data-lang
  // and code's hljs class so the editor's lazy highlighter knows what
  // grammar to apply on blur.
  const fenced: string[] = [];
  src = src.replace(/```([a-zA-Z0-9+#-]*)\r?\n?([\s\S]*?)```/g, (_, lang, body) => {
    const l = (lang || "plaintext").toLowerCase();
    const langLabel = l;
    fenced.push(
      `<pre class="note-code" data-lang="${l}">` +
      `<span class="note-code-meta" contenteditable="false">${langLabel}</span>` +
      `<span class="note-code-copy" contenteditable="false" data-action="copy-code">Copy</span>` +
      `<code class="hljs language-${l}">${esc(body)}</code>` +
      `</pre>`
    );
    return `FENCED${fenced.length - 1}`;
  });

  // Toggle (collapsible) blocks — `>>>` opens a `<details>` with the
  // line after the marker as the summary. The body continues until a
  // blank line. Closes with `<<<` or the next blank line.
  src = src.replace(/(?:^|\n)>>>\s*(.*?)\n([\s\S]*?)(?:\n<<<|\n\n|$)/g, (_, title, body) => {
    const t = (title || "Toggle").trim();
    const b = body.trim();
    return `\n\n<details class="note-toggle" open><summary>${esc(t)}</summary><div>${esc(b)}</div></details>\n\n`;
  });

  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listKind) { out.push(`</${listKind}>`); listKind = null; }
  };

  // GFM table detection. A markdown table is:
  //   | h1 | h2 |
  //   | --- | --- |       <- separator row, dashes optionally with :
  //   | a  | b  |          <- zero or more body rows
  //
  // We look one line ahead for the separator row, so the line loop is
  // index-based. The toolbar's `insertTable` already produces inline
  // HTML, but templates ship as markdown and were silently degrading
  // to paragraphs of pipes.
  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
  const isSeparatorRow = (s: string) =>
    /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/.test(s);
  const splitRow = (s: string) =>
    s.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    // Fenced placeholder
    const fm = /^FENCED(\d+)$/.exec(line);
    if (fm) { closeList(); out.push(fenced[Number(fm[1])]); continue; }
    // GFM table
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      closeList();
      const header = splitRow(line);
      const sepCells = splitRow(lines[i + 1]);
      const aligns = sepCells.map((c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return "";
      });
      let html = `<table class="note-table"><thead><tr>`;
      header.forEach((h, ci) => {
        const a = aligns[ci];
        html += a
          ? `<th style="text-align:${a}">${inline(h)}</th>`
          : `<th>${inline(h)}</th>`;
      });
      html += `</tr></thead><tbody>`;
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        const cells = splitRow(lines[j]);
        html += "<tr>";
        for (let ci = 0; ci < header.length; ci++) {
          const text = cells[ci] ?? "";
          const a = aligns[ci];
          html += a
            ? `<td style="text-align:${a}">${inline(text)}</td>`
            : `<td>${inline(text)}</td>`;
        }
        html += "</tr>";
        j++;
      }
      html += `</tbody></table>`;
      out.push(html);
      i = j - 1;
      continue;
    }
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
    // GitHub-style callout: a blockquote whose first line is `> [!TYPE]`
    // becomes a `<div class="callout callout-...">` block. The body
    // continues over subsequent `> ` lines. Supports the canonical
    // GFM set (NOTE/TIP/IMPORTANT/WARNING/CAUTION) plus the shorter
    // synonyms HeraVex uses (INFO/OK/WARN/DANGER).
    const co = /^>\s*\[!(NOTE|INFO|TIP|OK|SUCCESS|IMPORTANT|WARNING|WARN|CAUTION|DANGER)\]\s*$/i.exec(line);
    if (co) {
      closeList();
      const raw = co[1].toUpperCase();
      const kind =
        raw === "NOTE" || raw === "INFO" || raw === "IMPORTANT" ? "info" :
        raw === "TIP"  || raw === "OK"   || raw === "SUCCESS"   ? "ok"   :
        raw === "WARNING" || raw === "WARN"                     ? "warn" :
        "danger";
      const titleMap: Record<string, string> = {
        info: "Note", ok: "Tip", warn: "Warning", danger: "Danger",
      };
      const bodyLines: string[] = [];
      let j2 = i + 1;
      while (j2 < lines.length) {
        const lk = lines[j2].trimEnd();
        const km = /^>\s?(.*)$/.exec(lk);
        if (!km) break;
        bodyLines.push(km[1]);
        j2++;
      }
      const body = bodyLines.map((l) => inline(l)).join("<br>");
      out.push(`<div class="callout callout-${kind}"><strong>${titleMap[kind]}</strong><p>${body}</p></div>`);
      i = j2 - 1;
      continue;
    }
    // Blockquote (plain)
    const qm = /^>\s+(.*)$/.exec(line);
    if (qm) { closeList(); out.push(`<blockquote>${inline(qm[1])}</blockquote>`); continue; }
    // Ordered list
    const om = /^\d+\.\s+(.*)$/.exec(line);
    if (om) {
      if (listKind !== "ol") { closeList(); out.push("<ol>"); listKind = "ol"; }
      out.push(`<li>${inline(om[1])}</li>`); continue;
    }
    // Unordered list (including task list)
    //
    // v0.9.7 bug fix: task lists were being emitted inside a plain
    // `<ul>` which keeps the disc bullet AND a `disabled` checkbox
    // that the user couldn't tick. Both are wrong.
    //
    // The fix is two-part:
    //   1. Detect that THIS line is a task item and lookahead at
    //      contiguous task-style siblings; if any item in the run is
    //      a task, the whole list opens as `<ul class="note-checklist">`
    //      so CSS kills the bullet.
    //   2. Drop `disabled` from the checkbox so the user can tick it.
    //      The editor-root click delegate (see useEffect below) toggles
    //      the DOM `checked` attribute and flushes the change.
    const um = /^[-*+]\s+(.*)$/.exec(line);
    if (um) {
      const item = um[1];
      const tm = /^\[([ xX])\]\s+(.*)$/.exec(item);
      // Decide the opening tag the first time we enter a UL: peek at the
      // current line and following sibling lines to see if this is a
      // task-bearing list. The peek is cheap; we stop at any non-list
      // line (blank lines also break the run).
      if (listKind !== "ul") {
        closeList();
        let isTaskList = !!tm;
        for (let k = i + 1; k < lines.length; k++) {
          const lk = lines[k].trimEnd();
          if (!lk.trim()) break;
          const umk = /^[-*+]\s+(.*)$/.exec(lk);
          if (!umk) break;
          if (/^\[([ xX])\]\s+/.test(umk[1])) { isTaskList = true; break; }
        }
        out.push(isTaskList ? `<ul class="note-checklist">` : `<ul>`);
        listKind = "ul";
      }
      if (tm) {
        const checked = tm[1].toLowerCase() === "x" ? "checked" : "";
        out.push(`<li><input type="checkbox" ${checked}> ${inline(tm[2])}</li>`);
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
