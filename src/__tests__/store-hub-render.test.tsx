import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

// Store Center smoke test: real component, mocked store API.
// Guards the rules the simplified layout depends on:
//   1. only metrics a store really reports are counted (Google Play's
//      review count in `views`, Steam's recommendations in `purchases`
//      never surface);
//   2. a game linked to several stores is ONE row in the games list;
//   3. the comparison ranks games and shows each one's share.

const DATA: Record<string, Record<string, unknown>> = {
  "itch:1": { views: 1000, downloads: 250, purchases: 20, earnings: 80, currency: "USD", ratingAverage: 4.5, ratingCount: 10 },
  "play:7": { views: 999, purchases: 999, downloads: 400, activeInstalls: 400, uninstalls: 100, ratingAverage: 4, ratingCount: 990 },
  "steam:9": { wishlist: 321, purchases: 77, currentPlayers: 12 },
};

vi.mock("../lib/storage", () => ({
  fetchStoreData: vi.fn(async (provider: string, id: string) => {
    const d = DATA[`${provider}:${id}`];
    if (!d) throw new Error("401 Unauthorized");
    return d;
  }),
  getCachedWorkspacePath: () => null,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));

import { useAppStore } from "../store";
import { copy } from "../lib/i18n";
import { StoreHub } from "../components/pages/StoreHub";

function game(id: string, title: string, mappings: Record<string, string>) {
  const storeMappings: Record<string, { id: string; title: string }> = {};
  for (const [k, v] of Object.entries(mappings)) storeMappings[k] = { id: v, title };
  return {
    id, title, coverDataUrl: null, storeMappings, tasks: [], versions: [], expenses: [], tags: [],
    platforms: [], moodboard: { categories: [], items: [] }, updatedAt: "2026-09-30T10:00:00Z",
  };
}

const summary = () => screen.getByRole("region", { name: "Summary" });

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => localStorage.clear());

describe("StoreHub", () => {
  it("sums only real metrics and shows one card per game", async () => {
    useAppStore.setState({
      games: [game("g1", "Ashen Lantern", { itch: "1", play: "7", steam: "9" })] as never,
      language: "en",
      ui: copy.en as never,
    });
    render(<StoreHub />);
    await waitFor(() => expect(within(summary()).getByText("Downloads")).toBeInTheDocument());

    // Downloads = Itch 250 + Play 400; views = Itch only (Play's 999 is a review count).
    expect(within(summary()).getByText("650")).toBeInTheDocument();
    expect(within(summary()).getByText("1,000")).toBeInTheDocument();
    expect(screen.queryByText("999")).toBeNull();
    // Steam "purchases" (recommendations) never surface anywhere.
    expect(screen.queryByText("77")).toBeNull();

    // One row in the games list, linked to all three stores.
    const list = document.querySelector(".sh-game-list") as HTMLElement;
    const rowsInList = within(list).getAllByRole("button");
    expect(rowsInList).toHaveLength(1);
    expect(within(rowsInList[0]).getByText("Itch.io")).toBeInTheDocument();
    expect(within(rowsInList[0]).getByText("Steam")).toBeInTheDocument();
    expect(within(rowsInList[0]).getByText("Google Play")).toBeInTheDocument();
    // Steam-only figures are shown on the game (wishlists, players now).
    expect(within(rowsInList[0]).getByText("321")).toBeInTheDocument();
    expect(within(rowsInList[0]).getByText("12")).toBeInTheDocument();
  });

  it("explains a failed store on the game card instead of showing zeros", async () => {
    useAppStore.setState({
      games: [game("g2", "Kiln Runner", { itch: "404" })] as never,
      language: "en",
      ui: copy.en as never,
    });
    render(<StoreHub />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const list = document.querySelector(".sh-game-list") as HTMLElement;
    expect(within(list).getByText(/could not be read/)).toBeInTheDocument();
  });

  it("ranks games in the comparison with their share of the total", async () => {
    useAppStore.setState({
      games: [game("a", "Big Game", { itch: "1" }), game("b", "Small Game", { play: "7" })] as never,
      language: "en",
      ui: copy.en as never,
    });
    render(<StoreHub />);
    const compare = await waitFor(() => {
      const el = document.querySelector(".sh-bars");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(within(compare).getAllByRole("listitem")).toHaveLength(2));
    const items = within(compare).getAllByRole("listitem");
    // Downloads: Play 400 ranks above Itch 250; shares 61.5% / 38.5%.
    expect(items[0]).toHaveTextContent("Small Game");
    expect(items[0]).toHaveTextContent("61.5%");
    expect(items[1]).toHaveTextContent("Big Game");
    expect(screen.getByText("650", { selector: ".sh-compare-total strong" })).toBeInTheDocument();
  });
});
