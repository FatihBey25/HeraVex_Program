// "Create a task / note" requests from outside the target page.
//
// The tray menu, Ctrl+Shift+N style shortcuts, the floating "+" button
// and the Dashboard quick-capture box all switch tab and ask the Tasks /
// Notes page to open its creator. The pages are mounted conditionally,
// so a bare window event fired right after the tab switch arrived
// BEFORE the page existed and was lost: the user landed on the page and
// nothing was created. The request is now parked here and the page
// consumes it on mount (or immediately, if it's already mounted).

export type CreateKind = "task" | "note";

export interface CreateIntent {
  /** Optional prefilled title (Dashboard quick capture). */
  title?: string;
}

const pending = new Map<CreateKind, CreateIntent>();

export function requestCreate(kind: CreateKind, intent: CreateIntent = {}): void {
  pending.set(kind, intent);
  window.dispatchEvent(new CustomEvent(`heravex:new-${kind}`, { detail: intent }));
}

/** Take the pending request for `kind`, if any. Each request is consumed once. */
export function consumeCreate(kind: CreateKind): CreateIntent | null {
  const intent = pending.get(kind);
  if (!intent) return null;
  pending.delete(kind);
  return intent;
}
