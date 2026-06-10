// Tauri invoke wrapper that honours the
// `experimental.logApiCalls` toggle.
//
// We install a single proxy around `@tauri-apps/api/core`'s
// `invoke` at module-load time. The proxy reads the preference
// from localStorage (cheap — small string) on every call so the
// toggle is hot: flip it and the next IPC call gets logged. We
// don't go through Zustand to read the pref because invoke calls
// fire all over the app, including from non-React modules.

import { invoke as rawInvoke } from "@tauri-apps/api/core";

const KEY_EXPERIMENTAL = "heravex_experimental_v1";

function isLogEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_EXPERIMENTAL);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { logApiCalls?: boolean };
    return Boolean(parsed.logApiCalls);
  } catch {
    return false;
  }
}

/** Replacement for `invoke`. Same signature, same return shape. When
 *  the user has the toggle on, it console.groups the command name
 *  with its argument payload and the resolved value (or error). */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isLogEnabled()) {
    return rawInvoke<T>(cmd, args);
  }
  const t0 = performance.now();
  try {
    const result = await rawInvoke<T>(cmd, args);
    const ms = (performance.now() - t0).toFixed(1);
    // Collapsed group keeps the console scannable when there are
    // many calls per second.
    console.groupCollapsed(`%c[invoke]%c ${cmd} %c${ms}ms`,
      "color:#a78bfa;font-weight:700", "color:inherit", "color:#94a3b8");
    if (args) console.log("args:", args);
    console.log("→", result);
    console.groupEnd();
    return result;
  } catch (err) {
    const ms = (performance.now() - t0).toFixed(1);
    console.groupCollapsed(`%c[invoke ✗]%c ${cmd} %c${ms}ms`,
      "color:#f87171;font-weight:700", "color:inherit", "color:#94a3b8");
    if (args) console.log("args:", args);
    console.log("error:", err);
    console.groupEnd();
    throw err;
  }
}
