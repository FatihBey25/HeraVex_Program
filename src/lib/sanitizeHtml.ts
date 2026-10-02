// Note HTML sanitizer (v0.9.9).
//
// Note content is HTML that goes straight into the editor's
// contentEditable. Notes can come from elsewhere: a teammate (team
// mode), or files imported from Notion / Obsidian / a Markdown folder.
// The app's CSP already blocks inline script, but this is defence in
// depth: anything that can run code or load active content is removed,
// while the editor's own markup (classes, data-*, style, links, images)
// is left alone.

const DROP_ELEMENTS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet",
  "link", "meta", "base", "style", "form", "noscript", "template",
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "srcset", "background", "poster"]);
const BAD_URL = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i;

export function sanitizeNoteHtml(html: string): string {
  if (!html || !/<[a-z!/]/i.test(html)) return html;
  const tpl = document.createElement("template"); // inert: nothing loads or runs
  tpl.innerHTML = html;
  const walk = (root: ParentNode) => {
    for (const el of Array.from(root.children)) {
      const tag = el.tagName.toLowerCase();
      if (DROP_ELEMENTS.has(tag)) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);
        else if (URL_ATTRS.has(name) && BAD_URL.test(attr.value.replace(/[\u0000-\u001f]/g, ""))) el.removeAttribute(attr.name);
        else if (name === "style" && /expression\s*\(|url\s*\(\s*['"]?\s*javascript/i.test(attr.value)) el.removeAttribute(attr.name);
      }
      walk(el);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
