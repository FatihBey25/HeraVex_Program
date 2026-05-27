// Cross-tab navigation helpers for the moodboard relation.
//
// When the user clicks a moodboard thumbnail on a task card or in
// the notes sidebar, we want to jump to Library → that game →
// Moodboard tab → that item's detail modal — all from a context that
// doesn't otherwise know the moodboard's component tree.
//
// We solved this with two custom DOM events instead of pushing
// transient navigation state into Zustand:
//   - `heravex:focus-detail-tab` — picked up by GameDetail so it
//     switches its internal detailTab state.
//   - `heravex:open-moodboard-item` — picked up by MoodboardTab
//     so it sets `detailItemId` and opens the modal.
//
// Events are filtered by `gameId` so listeners on inactive games stay
// idle. Both events carry a `gameId` for that reason.

import { useAppStore } from "../store";
import type { DetailTab } from "./i18n";

export interface FocusDetailTabDetail {
  gameId: string;
  tab: DetailTab;
}

export interface OpenMoodboardItemDetail {
  gameId: string;
  itemId: string;
}

/** Jump to Library → game → moodboard tab → item detail modal. */
export function openMoodboardItem(gameId: string, itemId: string) {
  const store = useAppStore.getState();
  store.setWorkspaceTab("library");
  store.setSelectedId(gameId);
  try {
    window.dispatchEvent(
      new CustomEvent<FocusDetailTabDetail>("heravex:focus-detail-tab", {
        detail: { gameId, tab: "moodboard" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent<OpenMoodboardItemDetail>("heravex:open-moodboard-item", {
        detail: { gameId, itemId },
      }),
    );
  } catch {
    // Non-browser context (e.g. SSR). The store tab/selectedId changes
    // above are enough to land the user on the right screen; the
    // modal-open hint is a nice-to-have.
  }
}

/** Find which game owns a given moodboard image id by scanning every
 *  game's `moodboard.items`. Used by NoteCenter where we know an
 *  imageId but not the parent gameId. Returns null if the image was
 *  deleted but the linking note is still being rendered (stale state
 *  during the cascade window).
 *
 *  O(games × items). Notes typically link to a handful of images, so
 *  the cost stays small in practice. Promote to a per-image lookup
 *  table if profiling ever flags this. */
export function findMoodboardOwnerByImageId(
  imageId: string,
): { gameId: string; path: string; title: string } | null {
  const { games } = useAppStore.getState();
  for (const game of games) {
    const it = game.moodboard.items.find((m) => m.id === imageId);
    if (it) {
      return { gameId: game.id, path: it.path, title: it.title || it.filename };
    }
  }
  return null;
}
