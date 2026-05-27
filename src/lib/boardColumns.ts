// Dinamik Kanban sütunları için yardımcılar.
//
// Her oyunun kendi `boardColumns` dizisi vardır. Eski oyunlarda bu alan yoktur;
// `ensureBoardColumns` çağrısı yapıldığında 4 default sütun (Backlog, In
// Progress, Review, Done) atanır ve geriye sütunlu oyun döner. Bu migration
// idempotent: zaten sütun varsa hiçbir şey yapmaz.

import type { BoardColumn, GameRecord, TaskItem } from "../types";
import type { AppLanguage } from "./i18n";

export const DONE_COLUMN_ID = "done";

/** Built-in column palette. Order = visual order on the board (left → right). */
export function defaultBoardColumns(lang: AppLanguage): BoardColumn[] {
  const titles: Record<AppLanguage, { backlog: string; progress: string; review: string; done: string }> = {
    en: { backlog: "Backlog", progress: "In Progress", review: "Review", done: "Done" },
    tr: { backlog: "Yapılacak", progress: "Devam Eden", review: "İnceleme", done: "Bitti" },
    fr: { backlog: "Backlog", progress: "En cours", review: "Revue", done: "Terminé" },
    es: { backlog: "Backlog", progress: "En curso", review: "Revisión", done: "Hecho" },
  };
  const t = titles[lang] ?? titles.en;
  return [
    { id: "backlog",  title: t.backlog,  color: "#60a5fa", order: 0 },
    { id: "progress", title: t.progress, color: "#f59e0b", order: 1 },
    { id: "review",   title: t.review,   color: "#a78bfa", order: 2 },
    { id: DONE_COLUMN_ID, title: t.done, color: "#34d399", order: 3, isDone: true },
  ];
}

/** Returns the game enriched with default columns if missing.
 *  Also auto-assigns `boardColumnId` to existing tasks based on `done`. */
export function ensureBoardColumns(game: GameRecord, lang: AppLanguage): GameRecord {
  let cols = game.boardColumns ?? [];
  let changed = false;

  if (cols.length === 0) {
    cols = defaultBoardColumns(lang);
    changed = true;
  } else if (!cols.some((c) => c.isDone)) {
    // Safety: a column model without a Done column would break drop-to-done.
    // Re-attach a Done column at the end.
    cols = [...cols, { id: DONE_COLUMN_ID, title: defaultBoardColumns(lang).find((c) => c.isDone)!.title, color: "#34d399", order: cols.length, isDone: true }];
    changed = true;
  }

  // Migrate tasks: if they don't have a boardColumnId, derive it from `done`.
  const doneColId = cols.find((c) => c.isDone)?.id ?? DONE_COLUMN_ID;
  const fallbackOpenColId = cols.find((c) => !c.isDone)?.id ?? cols[0].id;

  const migratedTasks: TaskItem[] = game.tasks.map((t) => {
    const validBoardCol = t.boardColumnId && cols.some((c) => c.id === t.boardColumnId);
    if (validBoardCol) return t;
    changed = true;
    return { ...t, boardColumnId: t.done ? doneColId : fallbackOpenColId };
  });

  if (!changed) return game;
  return { ...game, boardColumns: cols, tasks: migratedTasks };
}

/** Sort columns by `order` ascending, with Done always pinned to the end. */
export function sortedColumns(cols: BoardColumn[]): BoardColumn[] {
  return [...cols].sort((a, b) => {
    // Pin Done last regardless of `order`.
    if (a.isDone && !b.isDone) return 1;
    if (!a.isDone && b.isDone) return -1;
    return a.order - b.order;
  });
}

/** Generate a stable id for new user-added columns. */
export function newColumnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `col-${crypto.randomUUID()}`;
  }
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns the next color in a pleasant palette for a newly added column. */
export function nextColumnColor(existing: BoardColumn[]): string {
  const palette = ["#60a5fa", "#f59e0b", "#a78bfa", "#34d399", "#f87171", "#22d3ee", "#fb923c", "#c084fc"];
  const used = new Set(existing.map((c) => c.color));
  return palette.find((c) => !used.has(c)) ?? palette[existing.length % palette.length];
}
