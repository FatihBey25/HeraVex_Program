async function j(l,n,t){const d=v(l,n,t),e=document.createElement("iframe");e.style.position="fixed",e.style.right="0",e.style.bottom="0",e.style.width="0",e.style.height="0",e.style.border="0",e.setAttribute("aria-hidden","true"),document.body.appendChild(e),await new Promise(i=>requestAnimationFrame(i));const r=e.contentWindow;if(!r)throw e.remove(),new Error("Print iframe unavailable");r.document.open(),r.document.write(d),r.document.close(),await new Promise(i=>setTimeout(i,250)),r.focus();try{r.print()}finally{setTimeout(()=>e.remove(),1500)}}function v(l,n,t){var f,h,p;const d=b(n.title),e=b((f=n.subtitle)!=null?f:""),r=b((h=n.eyebrow)!=null?h:"HERAVEX"),i=b((p=n.meta)!=null?p:""),g=t==="tr"?"Oluşturuldu":t==="fr"?"Généré":t==="es"?"Generado":"Generated",u=new Date().toLocaleDateString(t==="tr"?"tr-TR":t==="fr"?"fr-FR":t==="es"?"es-ES":"en-US",{dateStyle:"long"});return`<!DOCTYPE html>
<html lang="${t}">
<head>
<meta charset="utf-8">
<title>${d}</title>
<style>
${w()}
</style>
</head>
<body>
  <header class="cover">
    <p class="eyebrow">${r}</p>
    <h1>${d}</h1>
    ${e?`<p class="subtitle">${e}</p>`:""}
    ${i?`<p class="meta">${i}</p>`:""}
  </header>
  <main class="note-body">${l}</main>
  <footer class="page-footer">
    <span>${r}</span>
    <span>${d}</span>
    <span>${g} ${b(u)}</span>
  </footer>
</body>
</html>`}function w(){return`
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
`}function $(l){if(!l)return"";const n=document.createElement("div");return n.innerHTML=l,t(n).trim();function t(d){var r,i,g,u,f,h;let e="";for(const p of Array.from(d.childNodes)){if(p.nodeType===Node.TEXT_NODE){e+=(r=p.textContent)!=null?r:"";continue}if(p.nodeType!==Node.ELEMENT_NODE)continue;const o=p;switch(o.tagName.toLowerCase()){case"h1":e+=`
# ${t(o)}
`;break;case"h2":e+=`
## ${t(o)}
`;break;case"h3":e+=`
### ${t(o)}
`;break;case"h4":e+=`
#### ${t(o)}
`;break;case"strong":case"b":e+=`**${t(o)}**`;break;case"em":case"i":e+=`_${t(o)}_`;break;case"code":e+=`\`${t(o)}\``;break;case"pre":e+=`
\`\`\`
${(i=o.textContent)!=null?i:""}
\`\`\`
`;break;case"blockquote":e+=`
> ${t(o).trim()}
`;break;case"a":e+=`[${t(o)}](${(g=o.getAttribute("href"))!=null?g:""})`;break;case"ul":{let a=`
`;for(const c of Array.from(o.children)){const s=c.querySelector("input[type=checkbox]");if(s){const m=s.checked||s.hasAttribute("checked");a+=`- [${m?"x":" "}] ${t(c).trim()}
`}else a+=`- ${t(c).trim()}
`}e+=a;break}case"ol":{let a=`
`,c=1;for(const s of Array.from(o.children))a+=`${c++}. ${t(s).trim()}
`;e+=a;break}case"li":e+=t(o);break;case"br":e+=`
`;break;case"hr":e+=`
---
`;break;case"table":{let a=`
`;const c=o.querySelector("thead tr"),s=[];if(c){for(const m of Array.from(c.children))s.push(((u=m.textContent)!=null?u:"").trim());a+=`| ${s.join(" | ")} |
`,a+=`| ${s.map(()=>"---").join(" | ")} |
`}for(const m of Array.from(o.querySelectorAll("tbody tr"))){const k=[];for(const y of Array.from(m.children))k.push(((f=y.textContent)!=null?f:"").trim());a+=`| ${k.join(" | ")} |
`}e+=a+`
`;break}case"img":e+=`![](${(h=o.getAttribute("src"))!=null?h:""})`;break;default:e+=t(o);break}}return e}}function b(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}export{j as exportNoteAsPdf,$ as htmlToMarkdown};
