import { beforeEach, describe, expect, it, vi } from "vitest";

const DATA: Record<string, Record<string, unknown>> = {
  "itch:1": { views: 100, downloads: 10, earnings: 5, purchases: 1 },
  "steam:9": { wishlist: 50, currentPlayers: 3, purchases: 999 },
};
let failSteam = false;
vi.mock("../lib/storage", () => ({
  fetchStoreData: vi.fn(async (provider: string, id: string) => {
    if (provider === "steam" && failSteam) throw new Error("offline");
    return DATA[`${provider}:${id}`];
  }),
}));

import { _resetStoreSyncCache, cachedRows, dueProviders, syncTargets, type StoreTarget } from "../lib/storeSync";
import { loadHistory } from "../lib/storeHubHistory";

const targets: StoreTarget[] = [
  { gameId: "g", title: "G", cover: null, provider: "itch", id: "1" },
  { gameId: "g", title: "G", cover: null, provider: "steam", id: "9" },
];

beforeEach(() => {
  localStorage.clear();
  _resetStoreSyncCache();
  failSteam = false;
});

describe("store sync schedule", () => {
  it("is due per store only when that store's interval has passed", () => {
    const now = 10 * 60 * 60_000;
    const prefs = { itch: 60, steam: 0, play: 15 };
    expect(dueProviders(prefs, {}, now)).toEqual(["itch", "play"]);           // never synced
    expect(dueProviders(prefs, { itch: now - 30 * 60_000, play: now - 15 * 60_000 }, now)).toEqual(["play"]);
    expect(dueProviders({ itch: 0, steam: 0, play: 0 }, {}, now)).toEqual([]); // all off
  });
});

describe("syncTargets", () => {
  it("keeps only real metrics and records a trend point when every store answered", async () => {
    const rows = await syncTargets(targets);
    expect(rows[1].purchases).toBeNull(); // Steam recommendations never count
    expect(loadHistory()).toHaveLength(1);
    expect(loadHistory()[0]).toMatchObject({ views: 100, downloads: 10, wishlist: 50 });
  });

  it("does not record a trend point when a store failed (no fake drop)", async () => {
    failSteam = true;
    const rows = await syncTargets(targets);
    expect(rows[1].error).toContain("offline");
    expect(loadHistory()).toHaveLength(0);
  });

  it("a background sync of one store completes the set with cached numbers", async () => {
    await syncTargets([targets[0]], targets);   // only itch known so far
    expect(loadHistory()).toHaveLength(0);
    expect(cachedRows(targets)).toBeNull();
    await syncTargets([targets[1]], targets);   // steam arrives later
    expect(cachedRows(targets)!.rows).toHaveLength(2);
    expect(loadHistory()).toHaveLength(1);
  });

  it("tells open pages that new numbers arrived", async () => {
    const seen = vi.fn();
    window.addEventListener("heravex:store-sync", seen);
    await syncTargets(targets);
    window.removeEventListener("heravex:store-sync", seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
