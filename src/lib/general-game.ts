import type { GameRecord } from "../types";

/** Marker tag attached to the internal game that holds "general" (non-project)
 *  tasks. The marker is the data-model migration path: we reuse the existing
 *  GameRecord schema instead of adding a new top-level collection.
 *
 *  Any UI that lists projects to the user must filter this game out. */
export const GENERAL_GAME_TAG = "__general_tasks__";

/** Stable virtual id used in pickers (e.g. the AddTaskModal project chips)
 *  before the marker game has actually been created on disk. */
export const GENERAL_GAME_ID = "__general__";

/** Returns true for the internal marker game so call-sites can hide it. */
export function isGeneralGame<T extends { tags?: string[] }>(g: T): boolean {
  return (g.tags ?? []).includes(GENERAL_GAME_TAG);
}

/** Convenience: strip the marker game out of a project list before render. */
export function visibleGames<T extends { tags?: string[] }>(games: T[]): T[] {
  return games.filter((g) => !isGeneralGame(g));
}

/** Look up the marker game (if it exists). Lets the AddTaskModal resolve the
 *  virtual `__general__` id to the actual GameRecord on save. */
export function findGeneralGame<T extends { tags?: string[] }>(games: T[]): T | undefined {
  return games.find(isGeneralGame);
}

export type { GameRecord };
