// Flow Center reference resolution (v0.9.8 — Faz 2).
//
// A `ref` node binds to a real HeraVex entity (task / note / moodboard
// item) by `refModule` + `refId`. Nothing about that entity is copied
// into the flow — the node resolves its live title/status from the app
// store AT RENDER TIME. So a task renamed in Task Center instantly shows
// the new name on the canvas, and a deleted entity surfaces as an
// "orphaned" node (lazy detection, no eager cascade — see
// [[flow-center-roadmap]]).

import type { GameRecord, NoteRecord } from "../types";
import type { RefModule } from "./flow";

export interface ResolvedRef {
  exists: boolean;
  title: string;
  /** Owning game name (task/moodboard) — shown as the node subtitle. */
  subtitle?: string;
  /** Short status chip text, e.g. a task's done/priority. */
  status?: string;
  /** Game the entity belongs to, for navigation. null for global notes. */
  gameId?: string | null;
}

export function resolveRef(
  module: RefModule,
  refId: string,
  games: GameRecord[],
  notes: NoteRecord[],
): ResolvedRef {
  if (module === "task") {
    for (const g of games) {
      const t = g.tasks.find((x) => x.id === refId);
      if (t) {
        return {
          exists: true,
          title: t.title,
          subtitle: g.title,
          status: t.done ? "done" : `P${t.priority}`,
          gameId: g.id,
        };
      }
    }
    return { exists: false, title: refId };
  }

  if (module === "moodboard") {
    for (const g of games) {
      const it = g.moodboard?.items?.find((x) => x.id === refId);
      if (it) {
        return { exists: true, title: it.title || it.filename, subtitle: g.title, gameId: g.id };
      }
    }
    return { exists: false, title: refId };
  }

  // note
  const n = notes.find((x) => x.id === refId);
  if (n) return { exists: true, title: n.title || "Untitled", gameId: null };
  return { exists: false, title: refId };
}
