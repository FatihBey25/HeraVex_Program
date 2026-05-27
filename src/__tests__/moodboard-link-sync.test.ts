// M6 — Moodboard link sync invariants.
//
// `mutateLinkArray` is the single mutation point for every link
// array in the moodboard relation (MoodboardItem.linkedTaskIds /
// linkedNoteIds, TaskItem.moodboardImageIds, NoteRecord.moodboardImageIds).
// Pin its dedupe + idempotency contract here so a regression breaks
// the build before it has a chance to drop a back-reference at
// runtime.
//
// We deliberately test the pure helper rather than spinning up the
// full Zustand store. The store actions (`linkMoodboardItemToTask`,
// `deleteMoodboardItem`, …) all funnel through this helper for every
// write, so if the helper's contract holds, the bidirectional
// invariant follows. The Rust side has its own migration test suite
// in `main.rs` covering the on-disk format.

import { describe, it, expect } from "vitest";
import { mutateLinkArray } from "../store";

describe("mutateLinkArray", () => {
  it("adds a new id to an empty undefined array", () => {
    const out = mutateLinkArray(undefined, "id1", true);
    expect(out).toEqual(["id1"]);
  });

  it("adds a new id to an existing array", () => {
    const out = mutateLinkArray(["a", "b"], "c", true);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("is idempotent when attaching an already-present id", () => {
    // Two link calls for the same pair must NOT double-record. This
    // is what keeps the bidirectional invariant honest when a user
    // double-clicks the link picker.
    const after1 = mutateLinkArray(["a"], "a", true);
    const after2 = mutateLinkArray(after1, "a", true);
    expect(after1).toEqual(["a"]);
    expect(after2).toEqual(["a"]);
  });

  it("removes an existing id", () => {
    const out = mutateLinkArray(["a", "b", "c"], "b", false);
    expect(out).toEqual(["a", "c"]);
  });

  it("is idempotent when removing an absent id", () => {
    // Cascade cleanup hits the same item multiple times during a
    // deleteTask → deleteMoodboardItem chain. Each pass after the
    // first must be a no-op.
    const out1 = mutateLinkArray(["a", "b"], "x", false);
    const out2 = mutateLinkArray(out1, "x", false);
    expect(out1).toEqual(["a", "b"]);
    expect(out2).toEqual(["a", "b"]);
  });

  it("handles undefined removal without throwing", () => {
    expect(mutateLinkArray(undefined, "x", false)).toEqual([]);
  });

  it("returns a fresh array (never mutates the input)", () => {
    // Zustand relies on referential changes to trigger re-renders.
    // If we ever shipped a version that mutated in place, half the
    // UI would silently miss link-state changes.
    const input = ["a"];
    const out = mutateLinkArray(input, "b", true);
    expect(out).not.toBe(input);
    expect(input).toEqual(["a"]);
  });

  it("preserves insertion order on attach", () => {
    // Tests that rely on chronological ordering (e.g. "most-recently
    // linked first" UI) need this — adding via Set must not reshuffle.
    const out = mutateLinkArray(["a", "b"], "c", true);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("dedupes pre-existing duplicates in the input", () => {
    // A migrated record with stale duplicates should heal itself on
    // the next link operation. We don't promise this aggressively
    // anywhere else, so pin it here.
    const out = mutateLinkArray(["a", "a", "b"], "c", true);
    expect(out).toEqual(["a", "b", "c"]);
  });
});

// ─── Bidirectional invariant scenarios ─────────────────────────────────
//
// Simulate the four-array dance that the store's link helpers
// orchestrate. We're not invoking the store actions here — those
// touch storage and Tauri IPC — but we ARE proving the math that
// the helpers rely on: every link-side update has a symmetric
// other-side update, and removing one side never strands the other.

describe("link invariant (helper composition)", () => {
  it("attach in both directions yields a symmetric pair", () => {
    // Before: item.linkedTaskIds=[], task.moodboardImageIds=[]
    const itemLinks = mutateLinkArray([], "task-1", true);
    const taskLinks = mutateLinkArray(undefined, "image-1", true);
    expect(itemLinks).toContain("task-1");
    expect(taskLinks).toContain("image-1");
  });

  it("detach in both directions yields a symmetric removal", () => {
    const itemLinks = mutateLinkArray(["task-1", "task-2"], "task-1", false);
    const taskLinks = mutateLinkArray(["image-1", "image-9"], "image-1", false);
    expect(itemLinks).not.toContain("task-1");
    expect(itemLinks).toContain("task-2");
    expect(taskLinks).not.toContain("image-1");
    expect(taskLinks).toContain("image-9");
  });

  it("cascade cleanup of a deleted item across multiple tasks", () => {
    // `deleteMoodboardItem` strips the item id from every linked
    // task. Three tasks all referenced this image; the cleanup walks
    // each one through the helper.
    const taskAIds = mutateLinkArray(["img-A", "img-X"], "img-A", false);
    const taskBIds = mutateLinkArray(["img-A"], "img-A", false);
    const taskCIds = mutateLinkArray(["img-Y", "img-A"], "img-A", false);
    expect(taskAIds).toEqual(["img-X"]);
    expect(taskBIds).toEqual([]);
    expect(taskCIds).toEqual(["img-Y"]);
  });

  it("cascade cleanup of a deleted task across multiple moodboard items", () => {
    // The mirror situation — `deleteTask` runs through every
    // moodboard item and strips the task id from `linkedTaskIds`.
    const item1 = mutateLinkArray(["t1"], "t1", false);
    const item2 = mutateLinkArray(["t1", "t9"], "t1", false);
    expect(item1).toEqual([]);
    expect(item2).toEqual(["t9"]);
  });
});
