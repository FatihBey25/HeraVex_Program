// Vim-style list navigation hook.
//
// Pages opting in pass an array of item ids in display order plus
// callbacks for "open" and "delete". The hook installs a window-level
// keydown listener that ignores keystrokes when an input/textarea has
// focus (so typing 'j' in a note title doesn't navigate away), then
// maps:
//
//   j / ArrowDown → next item
//   k / ArrowUp   → previous item
//   Enter         → onOpen(current id)
//   x / Delete    → onDelete(current id)
//
// The current id is owned by the caller (selectedId state). The hook
// only emits intents — it never mutates state itself.

import { useEffect } from "react";

interface Options {
  /** Ordered list of item ids. Empty / undefined disables navigation. */
  ids: string[] | undefined;
  /** Currently focused id; null when nothing is selected. */
  currentId: string | null;
  /** Move focus to this id. */
  setCurrentId: (next: string) => void;
  /** Press Enter / 'o' to open the focused row's detail view. */
  onOpen?: (id: string) => void;
  /** Press x / Delete to remove. Caller is responsible for any confirm. */
  onDelete?: (id: string) => void;
  /** Set to false to disable the listener entirely. */
  enabled?: boolean;
}

export function useListKeyNav({
  ids, currentId, setCurrentId, onOpen, onDelete, enabled = true,
}: Options): void {
  useEffect(() => {
    if (!enabled || !ids || ids.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (editable) return;
      // Modifier-laden shortcuts (Ctrl+J etc.) belong to other features.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const idx = currentId ? ids.indexOf(currentId) : -1;
      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const next = idx < 0 ? ids[0] : ids[Math.min(idx + 1, ids.length - 1)];
          if (next) setCurrentId(next);
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = idx < 0 ? ids[0] : ids[Math.max(idx - 1, 0)];
          if (prev) setCurrentId(prev);
          break;
        }
        case "Enter":
        case "o": {
          if (currentId && onOpen) {
            e.preventDefault();
            onOpen(currentId);
          }
          break;
        }
        case "x":
        case "Delete": {
          if (currentId && onDelete) {
            e.preventDefault();
            onDelete(currentId);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, currentId, setCurrentId, onOpen, onDelete, enabled]);
}
