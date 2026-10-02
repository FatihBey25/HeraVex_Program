import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Release gate for the plugin system: the example plugins shipped in
// plugin-sdk/ are loaded through the REAL runtime (lib/plugins.ts) with
// the real `hv` API — only the Tauri file/list commands are faked. Each
// must activate cleanly, register what its manifest promises, and leave
// zero residue when disabled.

const manifests = import.meta.glob("../../plugin-sdk/*/heravex.plugin.json", { eager: true, import: "default" }) as
  Record<string, { id: string; entry?: string; contributes?: Record<string, { id: string }[]> }>;
const modules = import.meta.glob("../../plugin-sdk/*/index.js");

const EXAMPLES = ["example-plugin", "god-mode", "theme-pack", "color-kit", "deadline-heatmap"];
const listed = EXAMPLES.map((d) => {
  const manifest = manifests[`../../plugin-sdk/${d}/heravex.plugin.json`];
  const entryPath = `../../plugin-sdk/${d}/${manifest.entry ?? "index.js"}`;
  return { manifest, entryPath, dir: `../../plugin-sdk/${d}` };
});

let readDelay = 0;
vi.mock("../lib/invokeWrapper", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "plugins_list") return listed;
    if (cmd === "read_text_file") {
      if (readDelay) await new Promise((r) => setTimeout(r, readDelay));
      return String(args.path); // the loader below imports by path
    }
    if (cmd === "get_all_notes") return [];
    return null;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));

import {
  _setPluginModuleLoader, getPluginCommands, getPluginList, getPluginPages,
  getPluginSettingsPanels, getPluginSlashCommands, initPlugins, setPluginEnabled,
} from "../lib/plugins";
import { listPluginThemes } from "../lib/pluginThemes";
import { hasHookFilters } from "../lib/pluginHooks";

beforeAll(async () => {
  localStorage.clear();
  // Slots the core renders, so mountToSlot has somewhere to go.
  document.body.innerHTML = '<aside><div data-hv-slot="sidebar-nav-end"></div></aside><div data-hv-slot="dashboard-top"></div>';
  _setPluginModuleLoader((entryPath) => modules[entryPath]() as Promise<Record<string, unknown>>);
  await initPlugins();
});

afterAll(async () => {
  // Tear everything down (observers included) before jsdom goes away.
  localStorage.setItem("heravex_plugins_enabled_v1", JSON.stringify(
    Object.fromEntries(listed.map((l) => [l.manifest.id, false])),
  ));
  await initPlugins();
});

describe("plugin-sdk examples on the real runtime", () => {
  it("every example activates without an error", () => {
    const list = getPluginList();
    expect(list).toHaveLength(EXAMPLES.length);
    for (const p of list) {
      expect({ id: p.manifest.id, status: p.status, error: p.error }).toEqual({ id: p.manifest.id, status: "active", error: undefined });
    }
  });

  it("registers the pages, commands and settings its manifest declares", () => {
    const pages = getPluginPages().map((p) => p.key);
    const commands = getPluginCommands().map((c) => c.id);
    const settings = getPluginSettingsPanels().map((s) => s.key);
    for (const { manifest } of listed) {
      for (const pg of manifest.contributes?.pages ?? []) expect(pages).toContain(`plugin:${manifest.id}/${pg.id}`);
      for (const c of manifest.contributes?.commands ?? []) expect(commands).toContain(`${manifest.id}:${c.id}`);
      for (const st of manifest.contributes?.settings ?? []) expect(settings).toContain(`${manifest.id}:${st.id}`);
    }
  });

  it("leaves nothing behind when every plugin is disabled", async () => {
    localStorage.setItem("heravex_plugins_enabled_v1", JSON.stringify(
      Object.fromEntries(listed.map((l) => [l.manifest.id, false])),
    ));
    await initPlugins();
    expect(getPluginList().every((p) => p.status === "disabled")).toBe(true);
    expect(document.querySelectorAll("style[data-hv-plugin]")).toHaveLength(0);
    expect(document.querySelector("style[data-hv-plugin-theme]")).toBeNull();
    expect(document.querySelectorAll("[data-hv-plugin]")).toHaveLength(0);
    expect(listPluginThemes()).toHaveLength(0);
    expect(getPluginPages()).toHaveLength(0);
    expect(getPluginCommands()).toHaveLength(0);
    expect(getPluginSlashCommands()).toHaveLength(0);
    for (const h of ["game:beforeSave", "note:beforeSave", "game:beforeDelete", "note:beforeDelete"] as const) {
      expect(hasHookFilters(h)).toBe(false);
    }
  });

  it("a toggle made while a load is running is not lost", async () => {
    localStorage.setItem("heravex_plugins_enabled_v1", "{}");
    readDelay = 20;
    const first = initPlugins();                 // pass 1: reads "all enabled", then loads slowly
    await new Promise((r) => setTimeout(r, 30)); // ...the enabled map was already read
    setPluginEnabled("god-mode", false);         // toggled while plugins are still loading
    await first;                                 // includes the follow-up pass
    readDelay = 0;
    const god = getPluginList().find((p) => p.manifest.id === "god-mode");
    expect(god?.status).toBe("disabled");
    expect(getPluginList().filter((p) => p.manifest.id !== "god-mode").every((p) => p.status === "active")).toBe(true);
  });
});
