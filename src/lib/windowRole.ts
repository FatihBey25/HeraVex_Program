// Multi-window support (v0.9.9, Settings → Startup).
//
// Extra windows load the same app with `?window=secondary`. They show
// and edit everything, but jobs that must run once per app (backup
// schedule, launch backup, store auto-sync, tray actions) stay in the
// main window. Saves in any window reach the others through Rust's
// `local-data-changed` event.

const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

export const isSecondaryWindow = params?.get("window") === "secondary";

/** Page a new window opens on (`?tab=notes`), if any. */
export const initialWindowTab = params?.get("tab") ?? null;
