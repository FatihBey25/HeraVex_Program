// Tests for the plugin hook bus (lib/pluginHooks.ts) — the interception
// point wired into every core game/note write. These lock in the
// contract that matters most for safety: a plugin can transform or
// block an operation, but a BUGGY plugin can never break saving.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addHookFilter, addHookListener, applyHookFilters, emitHookEvent,
  removePluginHooks, hasHookFilters,
} from "../lib/pluginHooks";
import type { NoteRecord } from "../types";

const note = (over: Partial<NoteRecord> = {}): NoteRecord => ({
  id: "n1", title: "T", content: "body", updatedAt: "2026-01-01T00:00:00Z", ...over,
} as NoteRecord);

describe("pluginHooks", () => {
  beforeEach(() => {
    // Each plugin id is torn down between tests to keep them isolated.
    removePluginHooks("a");
    removePluginHooks("b");
  });

  it("passes the payload through untouched when no filter is registered", async () => {
    const n = note();
    expect(await applyHookFilters("note:beforeSave", n)).toBe(n);
    expect(hasHookFilters("note:beforeSave")).toBe(false);
  });

  it("lets a filter transform the payload", async () => {
    addHookFilter("a", "note:beforeSave", (n) => ({ ...n, title: n.title.toUpperCase() }));
    const out = await applyHookFilters("note:beforeSave", note({ title: "hi" }));
    expect(out?.title).toBe("HI");
  });

  it("chains multiple filters in registration order", async () => {
    addHookFilter("a", "note:beforeSave", (n) => ({ ...n, content: n.content + "-a" }));
    addHookFilter("b", "note:beforeSave", (n) => ({ ...n, content: n.content + "-b" }));
    const out = await applyHookFilters("note:beforeSave", note({ content: "x" }));
    expect(out?.content).toBe("x-a-b");
  });

  it("returns null (block) when a filter returns null", async () => {
    addHookFilter("a", "note:beforeDelete", () => null);
    expect(await applyHookFilters("note:beforeDelete", "n1")).toBeNull();
  });

  it("a THROWING filter is skipped — it never aborts the chain", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    addHookFilter("a", "note:beforeSave", () => { throw new Error("boom"); });
    addHookFilter("b", "note:beforeSave", (n) => ({ ...n, title: "survived" }));
    const out = await applyHookFilters("note:beforeSave", note());
    expect(out?.title).toBe("survived"); // second filter still ran
    spy.mockRestore();
  });

  it("removePluginHooks drops only that plugin's registrations", async () => {
    addHookFilter("a", "note:beforeSave", (n) => ({ ...n, content: n.content + "-a" }));
    addHookFilter("b", "note:beforeSave", (n) => ({ ...n, content: n.content + "-b" }));
    removePluginHooks("a");
    const out = await applyHookFilters("note:beforeSave", note({ content: "x" }));
    expect(out?.content).toBe("x-b");
  });

  it("fires after-event listeners and contains their exceptions", () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    addHookListener("a", "note:afterSave", () => { throw new Error("noisy"); });
    addHookListener("b", "note:afterSave", (n) => { seen.push(n.id); });
    expect(() => emitHookEvent("note:afterSave", note({ id: "z" }))).not.toThrow();
    expect(seen).toEqual(["z"]); // healthy listener still ran
    spy.mockRestore();
  });
});
