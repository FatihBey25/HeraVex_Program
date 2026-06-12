// Lazy syntax-highlighter bridge for the Notes editor.
//
// We import highlight.js's *core* bundle (no auto-detection registry,
// no built-in language pack) and register only the languages indie
// game devs actually reach for. That keeps the chunk under ~80kb
// gzipped — adding every language would balloon to ~600kb.
//
// The whole module is loaded through a dynamic `import()` in
// MarkdownWorkspace so a user who never opens a code block doesn't
// pay the cost on first paint. Subsequent highlights reuse the
// cached promise.

import hljs from "highlight.js/lib/core";

// Core languages — chosen for the gamedev / config-file overlap.
import csharp     from "highlight.js/lib/languages/csharp";
import cpp        from "highlight.js/lib/languages/cpp";
import rust       from "highlight.js/lib/languages/rust";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python     from "highlight.js/lib/languages/python";
import json       from "highlight.js/lib/languages/json";
import yaml       from "highlight.js/lib/languages/yaml";
import xml        from "highlight.js/lib/languages/xml";
import bash       from "highlight.js/lib/languages/bash";
import markdown   from "highlight.js/lib/languages/markdown";
import ini        from "highlight.js/lib/languages/ini";
import lua        from "highlight.js/lib/languages/lua";
import shell      from "highlight.js/lib/languages/shell";

hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini); // close enough for HeraVex's purposes
hljs.registerLanguage("lua", lua);

// GDScript is Godot's bespoke language. We register python's grammar
// under the gdscript alias because the keywords and indentation rules
// overlap closely enough to give the indie dev useful colouring without
// pulling a separate dictionary.
hljs.registerLanguage("gdscript", python);
hljs.registerLanguage("gd", python);

export interface SupportedLanguage {
  id: string;
  label: string;
}

/** The list the editor's language picker renders. Order is the
 *  order they appear in the popover. Add new entries here whenever
 *  we register another grammar above. */
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
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

/** Returns the highlighted HTML for `source` in the given `language`.
 *  Unknown / "plaintext" languages return an escaped passthrough so
 *  the caller can drop the result straight into the code element. */
export function highlight(source: string, language: string): string {
  if (!language || language === "plaintext" || !hljs.getLanguage(language)) {
    return escapeHtml(source);
  }
  try {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(source);
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
