import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseItem } from "../types";

// The wallet is per workspace (wallet.json) since v0.9.9. These guard the
// upgrade rules on the frontend side:
//   * a team folder never adopts the old (pre-workspace) wallet;
//   * the workspace that adopts it keeps the old currency list;
//   * general expenses are written one at a time, never by saving the
//     in-memory list (an empty list after a failed load would wipe the file).

const wallet = {
  load: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  setCurrencies: vi.fn(async (_c: string[]) => undefined),
  saveAll: vi.fn(),
  path: null as string | null,
};

vi.mock("../lib/storage", () => ({
  loadWallet: (claim: boolean) => wallet.load(claim),
  walletUpsertExpense: (e: ExpenseItem) => wallet.upsert(e),
  walletDeleteExpense: (id: string) => wallet.remove(id),
  walletSetCurrencies: (c: string[]) => wallet.setCurrencies(c),
  saveGlobalExpenses: (l: ExpenseItem[]) => wallet.saveAll(l),
  importLegacyWallet: vi.fn(async () => []),
  getWorkspacePath: async () => wallet.path,
  getCachedWorkspacePath: () => wallet.path,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));

import { useAppStore } from "../store";

const exp = (id: string, currency = "USD"): ExpenseItem => ({
  id, title: id, amount: 5, category: "Tools", spentAt: "2026-09-01", notes: "", currency,
});

beforeEach(() => {
  localStorage.clear();
  wallet.load.mockReset();
  wallet.upsert.mockReset();
  wallet.remove.mockReset();
  wallet.setCurrencies.mockClear();
  wallet.saveAll.mockReset();
  wallet.path = null;
  useAppStore.setState({ globalExpenses: [], activeCurrencies: ["USD"], walletLegacyAvailable: 0 });
});

describe("workspace wallet", () => {
  it("lets a local workspace adopt the old wallet but never a team folder", async () => {
    wallet.load.mockResolvedValue({ globalExpenses: [], activeCurrencies: null, legacyAvailable: 0, migrated: false });

    await useAppStore.getState().loadWallet();
    expect(wallet.load).toHaveBeenLastCalledWith(true);

    wallet.path = "G:/My Drive/Studio";
    localStorage.setItem("heravex_workspaces", JSON.stringify([
      { id: "default", name: "Default", path: null, createdAt: "2024-01-01T00:00:00.000Z" },
      { id: "ws_team", name: "Studio", path: "G:/My Drive/Studio", createdAt: "2026-01-01T00:00:00.000Z", mode: "team" },
    ]));
    await useAppStore.getState().loadWallet();
    expect(wallet.load).toHaveBeenLastCalledWith(false);
  });

  it("keeps the old currency list in the workspace that adopted the old wallet", async () => {
    localStorage.setItem("studiohub_active_currencies", JSON.stringify(["USD", "TRY", "EUR"]));
    wallet.load.mockResolvedValue({ globalExpenses: [exp("a")], activeCurrencies: null, legacyAvailable: 0, migrated: true });

    await useAppStore.getState().loadWallet();
    expect(useAppStore.getState().activeCurrencies).toEqual(["USD", "TRY", "EUR"]);
    expect(wallet.setCurrencies).toHaveBeenCalledWith(["USD", "TRY", "EUR"]);
    expect(useAppStore.getState().globalExpenses.map((e) => e.id)).toEqual(["a"]);
  });

  it("starts a new workspace with its own currencies, not the old global list", async () => {
    localStorage.setItem("studiohub_active_currencies", JSON.stringify(["USD", "TRY", "EUR"]));
    wallet.load.mockResolvedValue({ globalExpenses: [exp("b", "GBP")], activeCurrencies: null, legacyAvailable: 2, migrated: false });

    await useAppStore.getState().loadWallet();
    expect(useAppStore.getState().activeCurrencies).toEqual(["USD", "GBP"]);
    expect(useAppStore.getState().walletLegacyAvailable).toBe(2);
    expect(wallet.setCurrencies).not.toHaveBeenCalled();
  });

  it("writes general expenses one at a time, never the whole in-memory list", async () => {
    wallet.upsert.mockResolvedValue([exp("new"), exp("on-disk")]);
    await useAppStore.getState().handleAddExpense(exp("new"), null);
    expect(wallet.upsert).toHaveBeenCalledWith(exp("new"));
    expect(wallet.saveAll).not.toHaveBeenCalled();
    // The list comes back from disk, so expenses the failed/stale memory
    // state didn't know about are kept.
    expect(useAppStore.getState().globalExpenses.map((e) => e.id)).toEqual(["new", "on-disk"]);

    wallet.remove.mockResolvedValue([exp("on-disk")]);
    await useAppStore.getState().handleDeleteExpense("new", null);
    expect(wallet.remove).toHaveBeenCalledWith("new");
    expect(useAppStore.getState().globalExpenses.map((e) => e.id)).toEqual(["on-disk"]);
  });

  it("keeps the old data visible when the wallet can't be read", async () => {
    useAppStore.setState({ globalExpenses: [exp("kept")] });
    wallet.load.mockRejectedValue(new Error("wallet.json bozuk"));
    await useAppStore.getState().loadWallet({ silent: true });
    expect(useAppStore.getState().globalExpenses.map((e) => e.id)).toEqual(["kept"]);
  });
});
