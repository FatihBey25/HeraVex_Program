// Dynamic Quick Actions for the dashboard. Replaces the static four
// cards (New project / Add expense / Add task / Quick note) with up
// to four context-aware suggestions, evaluated in priority order:
//
//   1. No games yet                   → "Create your first project"
//   2. No store ever connected        → "Connect a store"
//   3. 3+ overdue tasks               → "Review overdue tasks (N)"
//   4. Has build, no press kit yet    → "Generate press kit"
//   5. No budget defined on any game  → "Set a budget"
//   6. (fallback) the original 4 static cards
//
// `computeDashboardSuggestions` returns the chosen set; the caller
// renders them as cards. The fallback is exposed separately so callers
// can show it when fewer than 4 contextual suggestions match.

import type { GameRecord } from "../types";
import { dueDateTimestamp } from "./i18n";
import { isGeneralGame } from "./general-game";

export type SuggestionKind =
  | "create-game"
  | "connect-store"
  | "overdue-tasks"
  | "press-kit"
  | "set-budget"
  | "static-new-project"
  | "static-add-expense"
  | "static-add-task"
  | "static-add-note";

export interface DashboardSuggestion {
  kind: SuggestionKind;
  /** Optional payload — overdue count, game id for press kit, etc. */
  count?: number;
  gameId?: string;
  gameTitle?: string;
}

export interface SuggestionInput {
  games: GameRecord[];
  /** True when at least one store mapping has been saved across the
   *  workspace (we don't check per-game `stores.*.enabled` because a
   *  user can have ALL games marked enabled with no real bindings;
   *  the absence of any mapping is the stronger signal). */
  hasAnyStoreConnected: boolean;
  /** True when at least one press kit file has been generated. The
   *  caller resolves this from disk; defaulting to true is safe
   *  because a press-kit suggestion is the LOWEST-impact false negative. */
  hasAnyPressKit: boolean;
}

const OVERDUE_THRESHOLD = 3;

function overdueCount(games: GameRecord[]): number {
  const now = Date.now();
  let n = 0;
  for (const game of games) {
    for (const task of game.tasks) {
      if (task.done) continue;
      const due = dueDateTimestamp(task);
      if (due !== null && due < now) n++;
    }
  }
  return n;
}

/** Return the first game (in update-order) that has at least one
 *  version with a build file but no press kit anywhere on disk.
 *  We can't peek at disk from here, so the caller passes `hasAnyPressKit`
 *  as a workspace-wide flag — when true, this rule is skipped. */
function firstGameWithBuildButNoPressKit(
  games: GameRecord[],
  hasAnyPressKit: boolean,
): GameRecord | null {
  if (hasAnyPressKit) return null;
  for (const game of games) {
    if (isGeneralGame(game)) continue;
    const hasBuild = game.versions.some((v) => !!v.buildRelativePath);
    if (hasBuild) return game;
  }
  return null;
}

function anyBudgetSet(games: GameRecord[]): boolean {
  return games.some((g) => !isGeneralGame(g) && (g.budget ?? 0) > 0);
}

export function computeDashboardSuggestions(
  input: SuggestionInput,
): DashboardSuggestion[] {
  const { games, hasAnyStoreConnected, hasAnyPressKit } = input;

  // Strip the "Studio General" marker so it doesn't count as a real
  // project for the empty-games suggestion.
  const realGames = games.filter((g) => !isGeneralGame(g));

  const out: DashboardSuggestion[] = [];

  if (realGames.length === 0) {
    out.push({ kind: "create-game" });
  }

  if (realGames.length > 0 && !hasAnyStoreConnected) {
    out.push({ kind: "connect-store" });
  }

  const overdue = overdueCount(realGames);
  if (overdue >= OVERDUE_THRESHOLD) {
    out.push({ kind: "overdue-tasks", count: overdue });
  }

  const pressKitGame = firstGameWithBuildButNoPressKit(realGames, hasAnyPressKit);
  if (pressKitGame) {
    out.push({
      kind: "press-kit",
      gameId: pressKitGame.id,
      gameTitle: pressKitGame.title,
    });
  }

  if (realGames.length > 0 && !anyBudgetSet(realGames)) {
    out.push({ kind: "set-budget" });
  }

  // Cap at 4. Fill the rest with the static fallbacks so the panel
  // never collapses to a single card on a freshly-onboarded workspace.
  const fallbacks: SuggestionKind[] = [
    "static-new-project",
    "static-add-expense",
    "static-add-task",
    "static-add-note",
  ];
  for (const k of fallbacks) {
    if (out.length >= 4) break;
    // Don't duplicate the "create your first project" rule with the
    // static new-project card.
    if (k === "static-new-project" && out.some((s) => s.kind === "create-game")) {
      continue;
    }
    out.push({ kind: k });
  }

  return out.slice(0, 4);
}
