// Tests for the team-mode 3-way note merge (lib/mergeNotes.ts).
//
// The whole point of the merge is "never lose a teammate's work". These
// lock in the guarantees that are otherwise only observable across two
// machines over a cloud folder — exactly the kind of thing we could
// never click-test.

import { describe, it, expect } from "vitest";
import { merge3, splitBlocks } from "../lib/mergeNotes";

describe("splitBlocks", () => {
  it("splits top-level block elements and round-trips via join", () => {
    const html = "<h1>Title</h1><p>one</p><p>two</p>";
    const blocks = splitBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks.join("")).toBe(html);
  });

  it("returns the whole string as one block when there is no markup", () => {
    expect(splitBlocks("plain text")).toEqual(["plain text"]);
  });
});

describe("merge3", () => {
  const base = "<p>a</p><p>b</p><p>c</p>";

  it("no-ops when both sides equal base", () => {
    const r = merge3(base, base, base);
    expect(r.merged).toBe(base);
    expect(r.conflicts).toBe(0);
    expect(r.changed).toBe(false);
  });

  it("adopts theirs when only they changed", () => {
    const theirs = "<p>a</p><p>B-edited</p><p>c</p>";
    const r = merge3(base, base, theirs);
    expect(r.merged).toBe(theirs);
    expect(r.conflicts).toBe(0);
  });

  it("keeps ours when only we changed", () => {
    const ours = "<p>a</p><p>b</p><p>c-edited</p>";
    const r = merge3(base, ours, base);
    expect(r.merged).toBe(ours);
    expect(r.conflicts).toBe(0);
  });

  it("merges edits to DIFFERENT blocks with no conflict (the common case)", () => {
    const ours = "<p>a-mine</p><p>b</p><p>c</p>";     // changed block 1
    const theirs = "<p>a</p><p>b</p><p>c-theirs</p>";  // changed block 3
    const r = merge3(base, ours, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.merged).toContain("a-mine");
    expect(r.merged).toContain("c-theirs");
    expect(r.merged).toContain("<p>b</p>");
  });

  it("NEVER loses data on a same-block conflict — keeps both sides", () => {
    const ours = "<p>a</p><p>b-MINE</p><p>c</p>";
    const theirs = "<p>a</p><p>b-THEIRS</p><p>c</p>";
    const r = merge3(base, ours, theirs);
    expect(r.conflicts).toBe(1);
    // Both survive — the whole point: no silent data loss.
    expect(r.merged).toContain("b-MINE");
    expect(r.merged).toContain("b-THEIRS");
  });

  it("merges a teammate's appended block with our appended block", () => {
    const ours = base + "<p>mine-new</p>";
    const theirs = base + "<p>theirs-new</p>";
    const r = merge3(base, ours, theirs);
    expect(r.merged).toContain("mine-new");
    expect(r.merged).toContain("theirs-new");
  });

  it("identical change on both sides is taken once, not duplicated", () => {
    const changed = "<p>a</p><p>b-same</p><p>c</p>";
    const r = merge3(base, changed, changed);
    expect(r.merged).toBe(changed);
    expect(r.conflicts).toBe(0);
  });
});
