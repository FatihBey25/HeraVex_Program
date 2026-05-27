import { useEffect } from "react";

/** Run `handler` whenever the user hits Escape while the component is mounted. */
export function useEscape(handler: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handler();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler, enabled]);
}

type ShortcutMap = Record<string, () => void>;

/** Global Cmd/Ctrl shortcuts. Keys are normalized lower-case letters or "/" etc.
 *  Modifier rules:
 *   - Ctrl on Windows/Linux, Cmd on macOS — accepts either
 *   - Shift required modifier can be encoded as "shift+k"
 *   - Ignored when focus is inside an editable element (input/textarea/contenteditable)
 *     UNLESS the shortcut starts with "force:" prefix.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;

      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      const key = e.key.toLowerCase();
      const combo = `${e.shiftKey ? "shift+" : ""}${key}`;

      // Try exact combo first, then plain key
      const handler = shortcuts[combo] ?? shortcuts[key];
      const forceHandler = shortcuts[`force:${combo}`] ?? shortcuts[`force:${key}`];
      const effective = forceHandler ?? (inEditable ? undefined : handler);
      if (!effective) return;
      e.preventDefault();
      e.stopPropagation();
      effective();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}
