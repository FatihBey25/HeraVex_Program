// Plugin theme registry (v0.9.9 — stable extension point).
//
// The SAFE replacement for "inject a theme by mutating Settings via
// onElement" (which fought React and crashed the app). Here the CORE
// owns everything React-side: a plugin only DECLARES a theme
// ({id, label, css}); the Theme settings page renders its pill as a
// native React element, and this module applies/persists/reverts the
// CSS via a single core-managed <style>. Zero React fighting, zero
// crash, clean revert.

export interface PluginTheme {
  /** Registry key: `${pluginId}:${id}` — also the persisted selection. */
  key: string;
  id: string;
  label: string;
  css: string;
  pluginId: string;
  pluginName: string;
  /** Preview swatch colours for the quick-theme picker card. */
  preview?: string;        // main background
  previewAccent?: string;  // accent / sidebar highlight
}

const registry = new Map<string, PluginTheme>();
const ACTIVE_KEY = "heravex_active_plugin_theme";
let styleEl: HTMLStyleElement | null = null;

function notify() {
  window.dispatchEvent(new CustomEvent("heravex:plugin-themes-changed"));
}

export function getActivePluginThemeKey(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}

function applyStyle(css: string) {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-hv-plugin-theme", "true");
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
function clearStyle() {
  styleEl?.remove();
  styleEl = null;
}

/** Select a plugin theme (or null → revert to the app's own theme). */
export function applyPluginTheme(key: string | null): void {
  if (!key) {
    clearStyle();
    try { localStorage.removeItem(ACTIVE_KEY); } catch { /* quota */ }
    notify();
    return;
  }
  const theme = registry.get(key);
  if (!theme) return;
  applyStyle(theme.css);
  try { localStorage.setItem(ACTIVE_KEY, key); } catch { /* quota */ }
  notify();
}

/** Called by hv.themes.register. Auto-applies if this theme is the
 *  persisted-active one (restart / re-enable path). Returns an
 *  unregister disposer. */
export function registerPluginTheme(theme: PluginTheme): () => void {
  registry.set(theme.key, theme);
  if (getActivePluginThemeKey() === theme.key) applyStyle(theme.css);
  notify();
  return () => {
    registry.delete(theme.key);
    if (getActivePluginThemeKey() === theme.key) applyPluginTheme(null);
    notify();
  };
}

/** Drop every theme a plugin registered (on disable/uninstall). If the
 *  active theme belonged to it, revert cleanly. */
export function unregisterPluginThemesFor(pluginId: string): void {
  let revert = false;
  for (const [key, theme] of [...registry]) {
    if (theme.pluginId !== pluginId) continue;
    if (getActivePluginThemeKey() === key) revert = true;
    registry.delete(key);
  }
  if (revert) applyPluginTheme(null);
  notify();
}

export function listPluginThemes(): PluginTheme[] {
  return [...registry.values()];
}
