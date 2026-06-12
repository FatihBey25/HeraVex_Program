// Note PDF export (v0.9.7 rewrite).
//
// The previous PDF pipeline rendered through Rust + printpdf with a
// `BuiltinFont::Helvetica` font. That font only supports Latin-1 —
// every Turkish character (ş, ğ, ı, ç, İ, ü, ö) came out as `?` or
// got dropped. Worse, the editor stores HTML now (the markdown PDF
// renderer expected markdown), so even ASCII notes were ending up
// empty.
//
// This module replaces the Rust path with browser-native printing:
//   1. Open a hidden iframe with the note's HTML wrapped in a
//      print-tuned stylesheet (A4 page, modern typography, table
//      borders, callouts, code blocks, checkbox SVG glyphs).
//   2. Trigger `window.print()` inside the iframe.
//   3. The user picks "Save as PDF" from the system print dialog.
//
// The webview is Chromium / WebKit on every Tauri target, so font
// rendering, line-breaking, kerning, and table layout match what the
// user sees on screen — UTF-8 just works.

export interface NotePdfMeta {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  meta?: string;
}

/** Export the given HTML as a print-ready PDF via the OS print dialog.
 *
 *  Returns once the print dialog has been requested. The iframe is
 *  cleaned up on a delay so the browser has time to read the content
 *  before tearing it down. */
export async function exportNoteAsPdf(html: string, meta: NotePdfMeta, language: string): Promise<void> {
  const doc = buildPrintDocument(html, meta, language);

  // Hidden iframe so the print dialog doesn't open a visible tab.
  // The dimensions are 0 — the document inside still flows at A4
  // because the @page rule in the stylesheet pins it.
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);

  // Wait one frame so the iframe is in the DOM before we write to it.
  await new Promise((r) => requestAnimationFrame(r));

  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error("Print iframe unavailable");
  }
  win.document.open();
  win.document.write(doc);
  win.document.close();

  // The print iframe needs a moment to lay out its content; without
  // this, `print()` can fire before fonts / images have settled and
  // the resulting PDF clips the first page. The 250ms cushion was
  // tuned against Tauri's WebView2 on Windows — Chromium and WebKit
  // are faster but the delay isn't perceptible.
  await new Promise((r) => setTimeout(r, 250));

  win.focus();
  try {
    win.print();
  } finally {
    // Remove the iframe after the print dialog had time to capture
    // the document. Leaving it would leak DOM nodes on heavy users.
    setTimeout(() => frame.remove(), 1500);
  }
}

/** Pull document.title-style metadata + a print stylesheet around the
 *  caller-provided body HTML. The stylesheet is intentionally not in
 *  the global app CSS — print rules are only ever needed here and we
 *  don't want @page bleeding into the regular UI. */
function buildPrintDocument(bodyHtml: string, meta: NotePdfMeta, language: string): string {
  const escTitle = escapeHtml(meta.title);
  const escSubtitle = escapeHtml(meta.subtitle ?? "");
  const escEyebrow = escapeHtml(meta.eyebrow ?? "HERAVEX");
  const escMeta = escapeHtml(meta.meta ?? "");
  const generatedLabel = language === "tr" ? "Oluşturuldu"
                       : language === "fr" ? "Généré"
                       : language === "es" ? "Generado"
                       : "Generated";
  const generatedAt = new Date().toLocaleDateString(
    language === "tr" ? "tr-TR" : language === "fr" ? "fr-FR" : language === "es" ? "es-ES" : "en-US",
    { dateStyle: "long" },
  );

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<title>${escTitle}</title>
<style>
${printStylesheet()}
</style>
</head>
<body>
  <header class="cover">
    <p class="eyebrow">${escEyebrow}</p>
    <h1>${escTitle}</h1>
    ${escSubtitle ? `<p class="subtitle">${escSubtitle}</p>` : ""}
    ${escMeta ? `<p class="meta">${escMeta}</p>` : ""}
  </header>
  <main class="note-body">${bodyHtml}</main>
  <footer class="page-footer">
    <span>${escEyebrow}</span>
    <span>${escTitle}</span>
    <span>${generatedLabel} ${escapeHtml(generatedAt)}</span>
  </footer>
</body>
</html>`;
}

/** Stylesheet for the printed page. Everything is keyed off the
 *  A4 page size — change `@page` and the rest of the rules will
 *  scale. The body font is the system stack so the PDF picks up
 *  whatever the OS has installed (Inter / SF / Segoe / Roboto). */
function printStylesheet(): string {
  return `
@page {
  size: A4;
  margin: 22mm 20mm 24mm 20mm;
}
@page :first {
  margin: 0;
}

:root {
  --ink: #1a1d24;
  --ink-muted: #5c6473;
  --ink-soft: #8a93a3;
  --accent: #a78bfa;
  --accent-soft: #ede9fe;
  --rule: #e4e7ee;
  --warn: #f59e0b;
  --warn-soft: #fef3c7;
  --info: #4f8cff;
  --info-soft: #dbeafe;
  --danger: #ef4444;
  --danger-soft: #fee2e2;
  --ok: #10b981;
  --ok-soft: #d1fae5;
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: "Inter", "Segoe UI", "SF Pro Text", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  color: var(--ink);
  font-size: 11pt;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* ── Cover page ── full-bleed, breaks before body ── */
.cover {
  padding: 40mm 30mm 30mm;
  height: 297mm;
  width: 210mm;
  page-break-after: always;
  break-after: page;
  background:
    radial-gradient(circle at 0% 0%, rgba(167, 139, 250, 0.18), transparent 50%),
    radial-gradient(circle at 100% 100%, rgba(79, 140, 255, 0.12), transparent 55%),
    linear-gradient(180deg, #ffffff 0%, #f8f6ff 100%);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  position: relative;
}
.cover::before {
  content: "";
  position: absolute;
  top: 30mm;
  left: 30mm;
  right: 30mm;
  height: 3pt;
  background: linear-gradient(90deg, var(--accent), transparent);
  border-radius: 99px;
}
.cover .eyebrow {
  margin: 0;
  font-size: 9pt;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: var(--ink-muted);
  text-transform: uppercase;
}
.cover h1 {
  margin: 18pt 0 0;
  font-size: 38pt;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ink);
  line-height: 1.05;
  max-width: 145mm;
}
.cover .subtitle {
  margin: 14pt 0 0;
  font-size: 14pt;
  font-weight: 500;
  color: var(--ink-muted);
}
.cover .meta {
  margin: 12pt 0 0;
  font-size: 10pt;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  text-transform: uppercase;
  font-weight: 600;
}

/* ── Body ── */
.note-body {
  padding-top: 4mm;
}

h1, h2, h3, h4 {
  color: var(--ink);
  font-weight: 700;
  page-break-after: avoid;
  break-after: avoid;
  margin-top: 18pt;
}
h1 {
  font-size: 22pt;
  letter-spacing: -0.015em;
  padding-bottom: 6pt;
  border-bottom: 1.5pt solid var(--rule);
  margin-top: 8pt;
}
h2 {
  font-size: 16pt;
  letter-spacing: -0.01em;
}
h3 { font-size: 13pt; }
h4 { font-size: 11.5pt; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.08em; }

p { margin: 8pt 0; }
strong { font-weight: 700; }
em { font-style: italic; }

a {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: rgba(167, 139, 250, 0.4);
}

ul, ol { padding-left: 20pt; margin: 8pt 0; }
li { margin: 3pt 0; }

/* Checklist — no bullet, custom SVG glyphs for the box. The disc
   bullet was leaking through because the markdown parser used to
   emit task lists inside a vanilla <ul>; the v0.9.7 fix tags them
   with .note-checklist, and this rule kills the leftover spacing. */
ul.note-checklist {
  list-style: none;
  padding-left: 0;
}
ul.note-checklist li {
  position: relative;
  padding-left: 22pt;
  margin: 4pt 0;
}
ul.note-checklist input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 12pt;
  height: 12pt;
  border: 1.2pt solid var(--ink-soft);
  border-radius: 3pt;
  display: inline-block;
  margin: 0 6pt 0 -22pt;
  vertical-align: -2pt;
  background: #ffffff;
  position: relative;
}
ul.note-checklist input[type="checkbox"][checked]::after,
ul.note-checklist input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 3pt;
  top: -1pt;
  width: 4pt;
  height: 7pt;
  border: solid var(--accent);
  border-width: 0 1.6pt 1.6pt 0;
  transform: rotate(45deg);
}

blockquote {
  margin: 12pt 0;
  padding: 6pt 12pt;
  border-left: 3pt solid var(--accent);
  background: var(--accent-soft);
  border-radius: 0 4pt 4pt 0;
  color: var(--ink);
  font-style: italic;
}

code {
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.9em;
  padding: 1pt 4pt;
  background: #f3f4f7;
  border-radius: 3pt;
  border: 0.5pt solid var(--rule);
}
pre {
  margin: 12pt 0;
  padding: 10pt 12pt;
  background: #f3f4f7;
  border: 1pt solid var(--rule);
  border-radius: 5pt;
  page-break-inside: avoid;
  break-inside: avoid;
  white-space: pre-wrap;
  word-break: break-word;
}
pre code { background: transparent; border: none; padding: 0; font-size: 9.5pt; }

/* Syntax-highlighted code blocks (v0.9.7) — hljs tokens repainted
   for the light print background. The copy chip is removed in
   print since clicking PDFs is generally not a thing. */
.note-code {
  position: relative;
  background: #f5f3ff;
  border: 0.7pt solid #e4dffb;
  margin: 14pt 0;
  padding: 22pt 14pt 12pt;
}
.note-code-meta {
  position: absolute;
  top: 5pt;
  left: 12pt;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7c3aed;
}
.note-code-copy { display: none; }
.hljs              { color: #1f2937; }
.hljs-comment,
.hljs-quote        { color: #6b7280; font-style: italic; }
.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-built_in,
.hljs-type         { color: #6d28d9; font-weight: 600; }
.hljs-string,
.hljs-symbol,
.hljs-bullet,
.hljs-attr,
.hljs-template-tag { color: #047857; }
.hljs-number,
.hljs-meta,
.hljs-link         { color: #b45309; }
.hljs-title,
.hljs-section,
.hljs-function .hljs-title,
.hljs-class .hljs-title { color: #0369a1; font-weight: 600; }
.hljs-variable,
.hljs-property,
.hljs-attribute,
.hljs-params       { color: #b91c1c; }
.hljs-tag,
.hljs-selector-class,
.hljs-selector-id  { color: #1d4ed8; }
.hljs-regexp       { color: #be185d; }
.hljs-emphasis     { font-style: italic; }
.hljs-strong       { font-weight: 700; }

/* Toggle blocks — always open in print so the reader sees every
   detail regardless of editor state. */
.note-toggle {
  margin: 12pt 0;
  padding: 10pt 14pt;
  border: 0.7pt solid var(--rule);
  border-radius: 5pt;
}
.note-toggle > summary {
  font-weight: 700;
  list-style: none;
  margin-bottom: 6pt;
}
.note-toggle > summary::before { content: "▾ "; color: var(--accent); }
.note-toggle[open] > *:not(summary) { margin-top: 4pt; }

hr {
  border: none;
  border-top: 1pt solid var(--rule);
  margin: 14pt 0;
}

/* Tables — GitHub-flavoured look with zebra rows. The markdown
   parser already emits .note-table; we also style bare <table> for
   tables inserted via the toolbar. */
table, table.note-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
  font-size: 10pt;
}
th, td {
  border: 0.7pt solid var(--rule);
  padding: 6pt 8pt;
  text-align: left;
  vertical-align: top;
}
thead th {
  background: var(--accent-soft);
  color: var(--ink);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 9pt;
}
tbody tr:nth-child(even) td { background: #fafbfd; }

img { max-width: 100%; height: auto; border-radius: 4pt; }

/* Callout-style blocks. If the editor later emits these via a
   dedicated insert action, this CSS already renders them in print. */
.callout {
  margin: 12pt 0;
  padding: 10pt 14pt;
  border-left: 4pt solid var(--info);
  background: var(--info-soft);
  border-radius: 0 6pt 6pt 0;
  page-break-inside: avoid;
}
.callout-warn  { border-left-color: var(--warn);   background: var(--warn-soft); }
.callout-danger{ border-left-color: var(--danger); background: var(--danger-soft); }
.callout-ok    { border-left-color: var(--ok);     background: var(--ok-soft); }
.callout strong { display: block; margin-bottom: 3pt; }

/* Page footer — anchored with @bottom on print engines that support
   it. Chrome / Edge / Safari ignore @bottom unless we use the @page
   margin boxes API, which printpdf-style PDFs need. We render a
   simple flex footer at the bottom of every body page via fixed
   position; modern print pipelines extend it across pages
   automatically. */
.page-footer {
  position: fixed;
  bottom: -16mm;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  padding: 4mm 20mm;
  font-size: 8pt;
  color: var(--ink-soft);
  letter-spacing: 0.04em;
  border-top: 0.5pt solid var(--rule);
}
.page-footer span:first-child { font-weight: 700; }

/* Avoid headings stranded at the bottom of a page. */
h1, h2 { page-break-before: auto; }

@media print {
  html, body { background: #ffffff !important; }
  a { color: var(--accent) !important; }
}
`;
}

/** Convert the editor's HTML — which we just store in `note.content` —
 *  into a markdown-style intermediate that the legacy Rust path can
 *  consume. Currently unused (the print path renders HTML directly)
 *  but kept exported so a future "Plain Text" export can reuse it. */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return walk(tmp).trim();

  function walk(node: Node): string {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      switch (tag) {
        case "h1": out += `\n# ${walk(el)}\n`; break;
        case "h2": out += `\n## ${walk(el)}\n`; break;
        case "h3": out += `\n### ${walk(el)}\n`; break;
        case "h4": out += `\n#### ${walk(el)}\n`; break;
        case "strong":
        case "b":  out += `**${walk(el)}**`; break;
        case "em":
        case "i":  out += `_${walk(el)}_`; break;
        case "code": out += `\`${walk(el)}\``; break;
        case "pre":  out += `\n\`\`\`\n${el.textContent ?? ""}\n\`\`\`\n`; break;
        case "blockquote": out += `\n> ${walk(el).trim()}\n`; break;
        case "a":    out += `[${walk(el)}](${el.getAttribute("href") ?? ""})`; break;
        case "ul": {
          let lo = "\n";
          for (const li of Array.from(el.children)) {
            const cb = li.querySelector("input[type=checkbox]");
            if (cb) {
              const checked = (cb as HTMLInputElement).checked || cb.hasAttribute("checked");
              lo += `- [${checked ? "x" : " "}] ${walk(li).trim()}\n`;
            } else {
              lo += `- ${walk(li).trim()}\n`;
            }
          }
          out += lo;
          break;
        }
        case "ol": {
          let lo = "\n";
          let i = 1;
          for (const li of Array.from(el.children)) {
            lo += `${i++}. ${walk(li).trim()}\n`;
          }
          out += lo;
          break;
        }
        case "li": out += walk(el); break;
        case "br": out += "\n"; break;
        case "hr": out += "\n---\n"; break;
        case "table": {
          let mt = "\n";
          const headRow = el.querySelector("thead tr");
          const headers: string[] = [];
          if (headRow) {
            for (const cell of Array.from(headRow.children)) {
              headers.push((cell.textContent ?? "").trim());
            }
            mt += `| ${headers.join(" | ")} |\n`;
            mt += `| ${headers.map(() => "---").join(" | ")} |\n`;
          }
          for (const row of Array.from(el.querySelectorAll("tbody tr"))) {
            const cells: string[] = [];
            for (const cell of Array.from(row.children)) {
              cells.push((cell.textContent ?? "").trim());
            }
            mt += `| ${cells.join(" | ")} |\n`;
          }
          out += mt + "\n";
          break;
        }
        case "img": out += `![](${el.getAttribute("src") ?? ""})`; break;
        default: out += walk(el); break;
      }
    }
    return out;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
