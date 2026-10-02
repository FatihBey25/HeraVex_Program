// Settings → Import & Export (v0.9.9): format conversion.
//
// Pure functions only — Rust picks / reads / writes the files and the
// store saves the records. Everything here is covered by
// `src/__tests__/import-export.test.ts`.
//
//   export: notes → Markdown files, tasks → CSV
//   import: CSV task list, Markdown folder, Obsidian vault, Notion
//           export, Trello board JSON

import type { BoardColumn, GameRecord, NoteRecord, TaskItem } from "../types";

// ── Shared ─────────────────────────────────────────────────────────────

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/** `2026-10-02` from a date-ish string, or undefined. */
function toIsoDay(raw: string | null | undefined): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  // dd.mm.yyyy / dd/mm/yyyy (Turkish / European spreadsheets)
  const eu = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (eu) {
    const [, d, m, y] = eu;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

// ── Export: notes → Markdown ───────────────────────────────────────────

function yamlString(s: string): string {
  return JSON.stringify(s); // valid YAML double-quoted scalar
}

/** One `.md` file per note, with a small front-matter block so a later
 *  import (or Obsidian) keeps the title and category. */
export function notesToMarkdownFiles(notes: NoteRecord[]): { name: string; contents: string }[] {
  return notes.map((n) => {
    const title = n.title.trim() || "Untitled";
    const front = [
      "---",
      `title: ${yamlString(title)}`,
      n.category ? `category: ${yamlString(n.category)}` : null,
      `updated: ${n.updatedAt}`,
      "---",
      "",
    ].filter((l) => l !== null).join("\n");
    return { name: `${title}.md`, contents: `${front}${n.content ?? ""}\n` };
  });
}

// ── Export: tasks → CSV ────────────────────────────────────────────────

function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADERS = {
  en: ["Game", "Task", "Description", "Column", "Done", "Priority", "Due date", "Tags", "Completed at", "Time spent (min)"],
  tr: ["Oyun", "Görev", "Açıklama", "Sütun", "Bitti", "Öncelik", "Son tarih", "Etiketler", "Bitiş zamanı", "Harcanan süre (dk)"],
};

/** All tasks of the given games as CSV (UTF-8 with BOM so Excel reads
 *  Turkish characters; CRLF line ends). The header row is in the UI
 *  language and is understood by `csvToTasks` in either language. */
export function tasksToCsv(games: GameRecord[], language: string): string {
  const tr = language === "tr";
  const header = tr ? CSV_HEADERS.tr : CSV_HEADERS.en;
  const pr = (p: number) => (p === 3 ? (tr ? "Yüksek" : "High") : p === 2 ? (tr ? "Orta" : "Medium") : tr ? "Düşük" : "Low");
  const rows: string[] = [header.map(csvCell).join(",")];
  for (const g of games) {
    const cols = g.boardColumns ?? [];
    for (const t of g.tasks) {
      rows.push([
        g.title,
        t.title,
        t.description,
        cols.find((c) => c.id === t.boardColumnId)?.title ?? "",
        t.done ? (tr ? "Evet" : "Yes") : (tr ? "Hayır" : "No"),
        pr(t.priority),
        t.dueDate ?? "",
        (t.tags ?? []).join("; "),
        t.completedAt ?? "",
        t.timeSpentSeconds ? Math.round(t.timeSpentSeconds / 60) : "",
      ].map(csvCell).join(","));
    }
  }
  return "﻿" + rows.join("\r\n") + "\r\n";
}

// ── Import: CSV ────────────────────────────────────────────────────────

/** RFC 4180 CSV. The delimiter is detected from the header line (`,`
 *  or `;` — Excel in Turkish locale writes `;`). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Header synonyms (English, Turkish, Trello/Notion/Asana/Jira CSVs). */
const FIELD_NAMES: Record<string, string[]> = {
  title: ["task", "title", "name", "card name", "summary", "görev", "başlık", "ad", "isim", "görev adı"],
  description: ["description", "notes", "note", "details", "desc", "açıklama", "notlar", "not", "detay"],
  done: ["done", "completed", "complete", "status", "state", "bitti", "tamamlandı", "durum"],
  priority: ["priority", "öncelik", "importance", "önem"],
  due: ["due date", "due", "deadline", "date", "son tarih", "teslim", "tarih", "bitiş tarihi"],
  tags: ["tags", "labels", "tag", "label", "etiketler", "etiket"],
  column: ["column", "list", "list name", "sütun", "liste"],
};

const DONE_WORDS = new Set(["yes", "true", "1", "x", "done", "complete", "completed", "closed", "evet", "bitti", "tamamlandı", "tamam", "kapandı"]);

function parsePriority(raw: string): 1 | 2 | 3 {
  const s = norm(raw);
  if (!s) return 2;
  if (["high", "highest", "urgent", "critical", "yüksek", "acil", "kritik", "3", "p1"].includes(s)) return 3;
  if (["low", "lowest", "düşük", "1", "p3"].includes(s)) return 1;
  return 2;
}

export type CsvTaskImport = {
  tasks: TaskItem[];
  /** Column titles seen in the file (in order), to create on the board. */
  columnTitles: string[];
  skipped: number;
  /** Header → field mapping that was used, for the preview. */
  mapping: Partial<Record<keyof typeof FIELD_NAMES, string>>;
};

/** Turn CSV rows (first row = header) into tasks. Rows without a title
 *  are skipped. Returns null when no title column can be found. */
export function csvToTasks(rows: string[][]): CsvTaskImport | null {
  if (rows.length === 0) return null;
  const header = rows[0].map(norm);
  const find = (field: keyof typeof FIELD_NAMES) => {
    const names = FIELD_NAMES[field];
    let idx = header.findIndex((h) => names.includes(h));
    if (idx < 0) idx = header.findIndex((h) => names.some((n) => h.startsWith(n)));
    return idx;
  };
  const idx = {
    title: find("title"),
    description: find("description"),
    done: find("done"),
    priority: find("priority"),
    due: find("due"),
    tags: find("tags"),
    column: find("column"),
  };
  if (idx.title < 0) return null;
  const mapping: CsvTaskImport["mapping"] = {};
  for (const [k, i] of Object.entries(idx)) if (i >= 0) mapping[k as keyof typeof FIELD_NAMES] = rows[0][i].trim();

  const tasks: TaskItem[] = [];
  const columnTitles: string[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const title = get(idx.title);
    if (!title) { skipped++; continue; }
    const doneRaw = norm(get(idx.done));
    const done = DONE_WORDS.has(doneRaw);
    const column = get(idx.column);
    if (column && !columnTitles.includes(column)) columnTitles.push(column);
    tasks.push({
      id: newId(),
      title,
      description: get(idx.description),
      done,
      priority: parsePriority(get(idx.priority)),
      dueDate: toIsoDay(get(idx.due)),
      tags: get(idx.tags) ? get(idx.tags).split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [],
      // Column title for now; `addTasksToGame` maps it to a column id.
      boardColumnId: column || null,
      completedAt: done ? new Date().toISOString() : null,
    });
  }
  return { tasks, columnTitles, skipped, mapping };
}

// ── Adding imported tasks to a game ────────────────────────────────────

const COLUMN_COLORS = ["#60a5fa", "#f59e0b", "#a78bfa", "#f472b6", "#22d3ee", "#fb7185"];

/** Add tasks whose `boardColumnId` holds a column TITLE (from CSV or
 *  Trello) to a game: titles map to existing columns (case-insensitive)
 *  or become new columns before Done; tasks without one go to the first
 *  open column, done tasks to the Done column. */
export function addTasksToGame(game: GameRecord, tasks: TaskItem[], baseColumns: BoardColumn[]): GameRecord {
  let cols = [...(game.boardColumns && game.boardColumns.length ? game.boardColumns : baseColumns)];
  const doneCol = cols.find((c) => c.isDone);
  const firstOpen = cols.find((c) => !c.isDone) ?? cols[0];
  const byTitle = (title: string) => cols.find((c) => c.title.trim().toLocaleLowerCase("tr") === title.trim().toLocaleLowerCase("tr"));
  const create = (title: string): BoardColumn => {
    const col = { id: `col-${newId()}`, title, color: COLUMN_COLORS[cols.length % COLUMN_COLORS.length], order: 0 };
    // New columns go before Done so Done stays last.
    const at = doneCol ? cols.indexOf(doneCol) : cols.length;
    cols = [...cols.slice(0, at), col, ...cols.slice(at)];
    return col;
  };
  // A done task always sits in the Done column, and a task in the Done
  // column is done — the board and the checkbox must agree.
  const placed = tasks.map((t) => {
    const wanted = t.boardColumnId?.trim();
    let col: BoardColumn | undefined;
    if (t.done && doneCol) col = doneCol;
    else if (wanted) col = byTitle(wanted) ?? create(wanted);
    col = col ?? firstOpen;
    const done = t.done || col?.isDone === true;
    return {
      ...t,
      done,
      completedAt: done ? (t.completedAt ?? new Date().toISOString()) : null,
      boardColumnId: col?.id ?? null,
    };
  });
  cols = cols.map((c, i) => ({ ...c, order: i }));
  return { ...game, boardColumns: cols, tasks: [...placed, ...game.tasks] };
}

// ── Import: Markdown / Obsidian / Notion ───────────────────────────────

export type TextFileIn = { relative: string; contents: string; modifiedAt: string };
export type MarkdownSource = "markdown" | "obsidian" | "notion";

/** Notion appends a 32-hex id to every exported page name. */
const NOTION_ID = /\s+[0-9a-f]{32}$/i;

function parseFrontMatter(text: string): { data: Record<string, string>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    data[kv[1].toLowerCase()] = v;
  }
  return { data, body: text.slice(m[0].length) };
}

/** Obsidian-only syntax HeraVex doesn't render: `[[Page|alias]]`,
 *  `[[Page#Heading]]`, `![[embed.png]]`. Links become their text. */
function obsidianToMarkdown(body: string): string {
  return body
    .replace(/!\[\[([^\]]+)\]\]/g, (_, target: string) => `*(${target.split("|")[0].trim()})*`)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, _t, alias: string) => alias.trim())
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => target.split("#")[0].trim() || target);
}

/** One imported Markdown file → a note. Title: front matter, else the
 *  first `# Heading` (removed from the body), else the file name.
 *  Category: front matter, else the top folder. */
export function markdownFileToNote(file: TextFileIn, source: MarkdownSource): NoteRecord {
  const { data, body: rawBody } = parseFrontMatter(file.contents.replace(/\r\n/g, "\n"));
  let body = rawBody;
  const parts = file.relative.split("/");
  let fileTitle = (parts[parts.length - 1] ?? "").replace(/\.(md|markdown|txt)$/i, "");
  if (source === "notion") fileTitle = fileTitle.replace(NOTION_ID, "");
  let title = (data.title ?? "").trim();
  if (!title) {
    const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body);
    if (h1 && body.slice(0, h1.index).trim() === "") {
      title = h1[1].trim();
      body = body.slice(h1.index + h1[0].length).replace(/^\s*\n/, "");
    }
  }
  if (!title) title = fileTitle || "Untitled";
  if (source === "obsidian") body = obsidianToMarkdown(body);
  if (source === "notion") {
    // Notion links to other pages as `Page%20abc…123.md` — keep the text.
    body = body.replace(/\[([^\]]+)\]\(([^)]*?%20[0-9a-f]{32}\.md)\)/gi, "$1");
  }
  let folder = parts.length > 1 ? parts[0] : "";
  if (source === "notion") folder = folder.replace(NOTION_ID, "");
  const category = (data.category ?? data.folder ?? "").trim() || folder || null;
  const updated = data.updated ?? data.modified ?? data.date;
  const updatedAt = updated && !Number.isNaN(Date.parse(updated)) ? new Date(updated).toISOString() : file.modifiedAt;
  return { id: newId(), title, content: body.trimEnd(), updatedAt, category, order: 0 };
}

export function markdownFilesToNotes(files: TextFileIn[], source: MarkdownSource): NoteRecord[] {
  return files
    .filter((f) => /\.(md|markdown|txt)$/i.test(f.relative))
    .map((f) => markdownFileToNote(f, source));
}

// ── Import: Trello ─────────────────────────────────────────────────────

type TrelloBoard = {
  name?: string;
  lists?: { id: string; name: string; closed?: boolean; pos?: number }[];
  cards?: {
    id: string; name: string; desc?: string; closed?: boolean; idList: string;
    due?: string | null; dueComplete?: boolean; labels?: { name?: string; color?: string }[]; pos?: number;
  }[];
  checklists?: { idCard: string; name: string; checkItems?: { name: string; state: string }[] }[];
};

export type TrelloImport = { boardName: string; tasks: TaskItem[]; columnTitles: string[]; archivedSkipped: number };

/** A Trello board JSON export (Board menu → Print, export and share →
 *  Export as JSON). Lists become board columns, cards become tasks,
 *  labels become tags, checklists are appended to the description.
 *  Archived cards and lists are skipped. Returns null if it isn't one. */
export function trelloToTasks(json: unknown): TrelloImport | null {
  const b = json as TrelloBoard;
  if (!b || typeof b !== "object" || !Array.isArray(b.cards) || !Array.isArray(b.lists)) return null;
  const lists = [...b.lists].filter((l) => !l.closed).sort((a, z) => (a.pos ?? 0) - (z.pos ?? 0));
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  const doneList = (name: string) => /^(done|completed|complete|bitti|tamamlandı|tamamlanan)$/i.test(name.trim());
  let archivedSkipped = 0;
  const tasks: TaskItem[] = [];
  const cards = [...b.cards].sort((a, z) => (a.pos ?? 0) - (z.pos ?? 0));
  for (const c of cards) {
    const list = listName.get(c.idList);
    if (c.closed || list === undefined) { archivedSkipped++; continue; }
    const checklists = (b.checklists ?? []).filter((cl) => cl.idCard === c.id);
    const checklistText = checklists
      .map((cl) => `**${cl.name}**\n` + (cl.checkItems ?? []).map((it) => `- [${it.state === "complete" ? "x" : " "}] ${it.name}`).join("\n"))
      .join("\n\n");
    const done = c.dueComplete === true || doneList(list);
    tasks.push({
      id: newId(),
      title: c.name.trim() || "Untitled",
      description: [c.desc?.trim(), checklistText].filter(Boolean).join("\n\n"),
      done,
      priority: 2,
      dueDate: toIsoDay(c.due ?? undefined),
      tags: (c.labels ?? []).map((l) => (l.name || l.color || "").trim()).filter(Boolean),
      boardColumnId: list,
      completedAt: done ? new Date().toISOString() : null,
    });
  }
  return {
    boardName: b.name ?? "Trello",
    tasks,
    columnTitles: lists.map((l) => l.name),
    archivedSkipped,
  };
}
