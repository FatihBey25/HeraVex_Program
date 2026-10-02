import { describe, expect, it } from "vitest";
import { sanitizeNoteHtml } from "../lib/sanitizeHtml";

describe("sanitizeNoteHtml", () => {
  it("removes anything that can run code", () => {
    const out = sanitizeNoteHtml(
      '<p onclick="x()">Hi<img src="a.png" onerror="steal()"></p><script>bad()</script>' +
      '<a href="javascript:bad()">link</a><a href=" JaVaScRiPt:bad()">2</a><iframe src="https://x"></iframe>' +
      '<svg><a xlink:href="javascript:1">s</a></svg><style>body{display:none}</style>',
    );
    expect(out).not.toMatch(/onclick|onerror|<script|javascript:|<iframe|<style/i);
    expect(out).toContain('<img src="a.png">');
    expect(out).toContain(">link</a>");
  });

  it("keeps the editor's own markup untouched", () => {
    const html = '<h2 class="note-h2">Title</h2><pre class="note-code" data-lang="ts"><code>let a = 1;</code></pre>' +
      '<p style="color: red">x <a href="https://heravex.app" target="_blank">site</a></p><ul data-type="checklist"><li data-checked="true">done</li></ul>';
    expect(sanitizeNoteHtml(html)).toBe(html);
  });

  it("leaves plain text alone", () => {
    expect(sanitizeNoteHtml("just text, 2 < 3")).toBe("just text, 2 < 3");
  });
});
