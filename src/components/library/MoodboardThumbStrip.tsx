import { useMemo } from "react";
import { useAppStore } from "../../store";
import { imgSrc } from "../../lib/images";
import { openMoodboardItem, findMoodboardOwnerByImageId } from "../../lib/moodboardNavigate";

interface Props {
  /** Optional — when the caller knows the owning game (e.g. a task
   *  card that already has the gameId). Notes don't have a gameId,
   *  so they pass undefined and we look it up per image. */
  gameId?: string;
  imageIds: string[];
  /** Max thumbnails to show before collapsing the rest to "+N". */
  max?: number;
  /** Aria label / tooltip for the strip wrapper. */
  label?: string;
  /** Stops the click from bubbling to parent (e.g. task card onClick). */
  stopPropagation?: boolean;
}

/** Inline strip of small moodboard thumbnails rendered on a task
 *  card / note list item. Clicking a thumb jumps the user to the
 *  Library → that game → Moodboard tab → item modal. */
export function MoodboardThumbStrip({
  gameId,
  imageIds,
  max = 3,
  label,
  stopPropagation = true,
}: Props) {
  const games = useAppStore((s) => s.games);

  // Resolve each id to a { gameId, path, title } record. We do it
  // lazily inside the memo so the component is happy with stale lists
  // during cascade cleanup (a missing id just renders fewer thumbs).
  const resolved = useMemo(() => {
    const owningGame = gameId ? games.find((g) => g.id === gameId) : null;
    return imageIds
      .map((id) => {
        if (owningGame) {
          const it = owningGame.moodboard.items.find((m) => m.id === id);
          if (it) {
            return { id, gameId: owningGame.id, path: it.path, title: it.title || it.filename };
          }
          return null;
        }
        const owner = findMoodboardOwnerByImageId(id);
        return owner ? { id, ...owner } : null;
      })
      .filter((x): x is { id: string; gameId: string; path: string; title: string } => !!x);
    // `games` reference is the dep we care about — the inner items
    // list changes via `applySavedGame` which produces a new array.
  }, [imageIds, gameId, games]);

  if (resolved.length === 0) return null;

  const shown = resolved.slice(0, max);
  const extra = resolved.length - shown.length;

  return (
    <div
      className="mb-thumb-strip"
      aria-label={label}
      onMouseDown={(e) => stopPropagation && e.stopPropagation()}
      onClick={(e) => stopPropagation && e.stopPropagation()}
    >
      {shown.map((r) => {
        const src = imgSrc(r.path);
        if (!src) return null;
        return (
          <button
            key={r.id}
            type="button"
            className="mb-thumb-strip-item"
            title={r.title}
            onClick={() => openMoodboardItem(r.gameId, r.id)}
          >
            <img src={src} alt={r.title} loading="lazy" />
          </button>
        );
      })}
      {extra > 0 && (
        <button
          type="button"
          className="mb-thumb-strip-more"
          title={label}
          onClick={() => {
            // "+N" jumps to the first hidden thumbnail's parent game
            // so the user still ends up in the moodboard tab where
            // the full set is visible.
            const next = resolved[max];
            if (next) openMoodboardItem(next.gameId, next.id);
          }}
        >
          +{extra}
        </button>
      )}
    </div>
  );
}
