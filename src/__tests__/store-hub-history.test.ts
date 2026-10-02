import { beforeEach, describe, expect, it } from "vitest";
import { dayKey, loadHistory, previousSnapshot, recordSnapshot } from "../lib/storeHubHistory";

const metrics = (downloads: number) => ({
  views: downloads * 10,
  downloads,
  purchases: 0,
  earnings: downloads * 1.5,
  wishlist: 0,
  currentPlayers: 0,
});

describe("storeHubHistory", () => {
  beforeEach(() => localStorage.clear());

  it("keeps one snapshot per day, last sync wins", () => {
    const day = new Date(2026, 8, 30, 10);
    recordSnapshot(metrics(10), day);
    recordSnapshot(metrics(14), new Date(2026, 8, 30, 18));
    const h = loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ day: "2026-09-30", downloads: 14 });
  });

  it("uses the latest EARLIER day as the delta baseline", () => {
    recordSnapshot(metrics(5), new Date(2026, 8, 28));
    recordSnapshot(metrics(9), new Date(2026, 8, 29));
    const today = new Date(2026, 8, 30);
    const h = recordSnapshot(metrics(12), today);
    expect(previousSnapshot(h, today)?.downloads).toBe(9);
    expect(previousSnapshot([], today)).toBeNull();
  });

  it("ignores corrupt storage instead of throwing", () => {
    localStorage.setItem("heravex_storehub_history_v1", "{not json");
    expect(loadHistory()).toEqual([]);
    localStorage.setItem("heravex_storehub_history_v1", JSON.stringify([{ nope: 1 }, { day: "2026-01-02", views: 1, downloads: 2 }]));
    expect(loadHistory()).toEqual([
      { day: "2026-01-02", views: 1, downloads: 2, purchases: 0, earnings: 0, wishlist: 0, currentPlayers: 0 },
    ]);
  });

  it("formats local calendar days", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
