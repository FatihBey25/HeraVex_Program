import { describe, expect, it } from "vitest";
import {
  addTasksToGame, csvToTasks, markdownFileToNote, notesToMarkdownFiles,
  parseCsv, tasksToCsv, trelloToTasks,
} from "../lib/importExport";
import { defaultBoardColumns } from "../lib/boardColumns";
import type { GameRecord, TaskItem } from "../types";

function game(tasks: TaskItem[] = []): GameRecord {
  return {
    id: "g1", title: "Moth, \"Meadow\"", summary: "", status: "Demo", platforms: [], tags: [], notes: "",
    tasks, versions: [], expenses: [], releaseTimeline: [],
    moodboard: { categories: [], items: [] }, stores: {} as never, customLinks: [],
    updatedAt: "2026-01-01T00:00:00Z", boardColumns: defaultBoardColumns("en"),
  } as unknown as GameRecord;
}
const task = (p: Partial<TaskItem>): TaskItem => ({ id: "t", title: "T", description: "", done: false, priority: 2, ...p });

describe("export", () => {
  it("writes tasks as CSV that survives commas, quotes and newlines, and reads back", () => {
    const g = game([
      task({ id: "1", title: "Fix jump, then dash", description: "Line 1\nLine \"2\"", priority: 3, dueDate: "2026-10-20", tags: ["Bug", "Movement"], boardColumnId: "progress" }),
      task({ id: "2", title: "Ship demo", done: true, priority: 1, boardColumnId: "done" }),
    ]);
    const csv = tasksToCsv([g], "tr");
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe("Oyun");
    expect(rows[1][0]).toBe('Moth, "Meadow"');
    expect(rows[1][2]).toBe('Line 1\nLine "2"');
    expect(rows[1][3]).toBe("In Progress"); // column titles come from the game

    // The exported file imports back with the same facts.
    const back = csvToTasks(rows)!;
    expect(back.tasks).toHaveLength(2);
    expect(back.tasks[0]).toMatchObject({ title: "Fix jump, then dash", priority: 3, dueDate: "2026-10-20", tags: ["Bug", "Movement"], done: false });
    expect(back.tasks[1]).toMatchObject({ title: "Ship demo", done: true, priority: 1 });
  });

  it("writes notes as Markdown with front matter that imports back", () => {
    const [file] = notesToMarkdownFiles([
      { id: "n", title: "Boss: \"Kiln\"", content: "## Phase 1\nSlam", updatedAt: "2026-09-01T10:00:00.000Z", category: "Design" },
    ]);
    expect(file.name).toBe('Boss: "Kiln".md');
    const note = markdownFileToNote({ relative: file.name, contents: file.contents, modifiedAt: "2026-10-01T00:00:00.000Z" }, "markdown");
    expect(note).toMatchObject({ title: 'Boss: "Kiln"', category: "Design", updatedAt: "2026-09-01T10:00:00.000Z" });
    expect(note.content).toBe("## Phase 1\nSlam");
  });
});

describe("CSV import", () => {
  it("detects ; delimiters and Turkish headers, skips rows without a title", () => {
    const rows = parseCsv("Görev;Durum;Son tarih;Öncelik\r\nKarakter animasyonu;Bitti;05.11.2026;Yüksek\r\n;;;\r\n;x;;\r\nMüzik;;;\r\n");
    const r = csvToTasks(rows)!;
    expect(r.tasks.map((t) => t.title)).toEqual(["Karakter animasyonu", "Müzik"]);
    expect(r.tasks[0]).toMatchObject({ done: true, dueDate: "2026-11-05", priority: 3 });
    expect(r.skipped).toBe(1);
  });

  it("returns null when there is no title column", () => {
    expect(csvToTasks(parseCsv("foo,bar\n1,2\n"))).toBeNull();
  });
});

describe("adding imported tasks to a game", () => {
  it("maps columns by title, creates missing ones before Done, keeps done in Done", () => {
    const g = game([task({ id: "old" })]);
    const out = addTasksToGame(g, [
      task({ id: "a", boardColumnId: "review" }),          // matches "Review" case-insensitively
      task({ id: "b", boardColumnId: "QA" }),              // new column
      task({ id: "c", boardColumnId: "QA", done: true }),  // done wins → Done column
      task({ id: "d", boardColumnId: "Done" }),            // the Done column marks it done
      task({ id: "e", boardColumnId: null }),              // first open column
    ], defaultBoardColumns("en"));
    const col = (id: string) => out.boardColumns!.find((c) => c.id === out.tasks.find((t) => t.id === id)!.boardColumnId)!;
    expect(col("a").title).toBe("Review");
    expect(col("b").title).toBe("QA");
    expect(col("c").isDone).toBe(true);
    expect(col("d").isDone).toBe(true);
    expect(out.tasks.find((t) => t.id === "d")!.done).toBe(true);
    expect(col("e").title).toBe("Backlog");
    expect(out.boardColumns!.map((c) => c.title)).toEqual(["Backlog", "In Progress", "Review", "QA", "Done"]);
    expect(out.boardColumns!.map((c) => c.order)).toEqual([0, 1, 2, 3, 4]);
    expect(out.tasks[out.tasks.length - 1].id).toBe("old"); // existing tasks are kept
  });
});

describe("Markdown / Obsidian / Notion import", () => {
  it("takes the title from the first heading and the category from the folder", () => {
    const n = markdownFileToNote({ relative: "Lore/factions.md", contents: "# The Kiln Order\n\nThey guard fire.", modifiedAt: "2026-10-01T00:00:00.000Z" }, "markdown");
    expect(n).toMatchObject({ title: "The Kiln Order", category: "Lore", content: "They guard fire.", updatedAt: "2026-10-01T00:00:00.000Z" });
  });

  it("turns Obsidian links and embeds into plain text", () => {
    const n = markdownFileToNote({ relative: "Vault/Boss.md", contents: "See [[Phase plan|the plan]] and [[Arena#Layout]].\n![[sketch.png]]", modifiedAt: "x" }, "obsidian");
    expect(n.title).toBe("Boss");
    expect(n.content).toBe("See the plan and Arena.\n*(sketch.png)*");
  });

  it("strips Notion page ids from titles, folders and links", () => {
    const n = markdownFileToNote({
      relative: "Game Wiki 0123456789abcdef0123456789abcdef/Enemies 89abcdef0123456789abcdef01234567.md",
      contents: "Links: [Bosses](Bosses%20fedcba9876543210fedcba9876543210.md)",
      modifiedAt: "2026-10-01T00:00:00.000Z",
    }, "notion");
    expect(n.title).toBe("Enemies");
    expect(n.category).toBe("Game Wiki");
    expect(n.content).toBe("Links: Bosses");
  });
});

describe("Trello import", () => {
  const board = {
    name: "Ashen Lantern",
    lists: [
      { id: "l1", name: "To do", pos: 1 },
      { id: "l2", name: "Done", pos: 3 },
      { id: "l3", name: "Old", pos: 2, closed: true },
    ],
    cards: [
      { id: "c1", name: "Boss fight", desc: "Two phases", idList: "l1", due: "2026-11-01T12:00:00.000Z", labels: [{ name: "Design" }, { color: "red" }], pos: 1 },
      { id: "c2", name: "Menu", idList: "l2", pos: 2 },
      { id: "c3", name: "Archived card", idList: "l1", closed: true },
      { id: "c4", name: "In archived list", idList: "l3" },
    ],
    checklists: [{ idCard: "c1", name: "Steps", checkItems: [{ name: "Slam", state: "complete" }, { name: "Roar", state: "incomplete" }] }],
  };

  it("turns lists into columns and cards into tasks, skipping archived ones", () => {
    const r = trelloToTasks(board)!;
    expect(r.boardName).toBe("Ashen Lantern");
    expect(r.tasks.map((t) => t.title)).toEqual(["Boss fight", "Menu"]);
    expect(r.archivedSkipped).toBe(2);
    expect(r.tasks[0]).toMatchObject({ dueDate: "2026-11-01", tags: ["Design", "red"], boardColumnId: "To do", done: false });
    expect(r.tasks[0].description).toBe("Two phases\n\n**Steps**\n- [x] Slam\n- [ ] Roar");
    expect(r.tasks[1].done).toBe(true); // "Done" list
  });

  it("rejects JSON that isn't a Trello board", () => {
    expect(trelloToTasks({ hello: 1 })).toBeNull();
    expect(trelloToTasks(null)).toBeNull();
  });
});
