// Tiny wrapper that prints only in dev builds. Production users get
// no console spam; crashes still bubble through ErrorBoundary which
// keeps its own console.error so a clean app/console doesn't mean a
// silent crash. Use this for non-fatal warnings ("save retry failed",
// "linked-id mutated directly"), not user-visible errors.

const isDev = import.meta.env.DEV;

export function devWarn(...args: unknown[]): void {
  if (isDev) console.warn(...args);
}

export function devLog(...args: unknown[]): void {
  if (isDev) console.log(...args);
}
