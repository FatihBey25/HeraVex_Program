import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));

import { CustomWidgetPanel, daysUntil, parseLinks } from "../components/CustomWidgets";

describe("custom widgets", () => {
  it("counts whole days to a date, negative when past", () => {
    const today = new Date(2026, 9, 2, 23, 30); // late evening must not shift the count
    expect(daysUntil("2026-10-02", today)).toBe(0);
    expect(daysUntil("2026-10-03", today)).toBe(1);
    expect(daysUntil("2026-12-25", today)).toBe(84);
    expect(daysUntil("2026-09-30", today)).toBe(-2);
    expect(daysUntil("not a date", today)).toBeNull();
  });

  it("reads links one per line and skips lines without a URL", () => {
    expect(parseLinks("Steam | https://store.steampowered.com/app/1\nhttps://discord.gg/x\njust text\nBad | ftp://x")).toEqual([
      { label: "Steam", url: "https://store.steampowered.com/app/1" },
      { label: "discord.gg/x", url: "https://discord.gg/x" },
    ]);
  });

  it("renders a note and a countdown in the dashboard panel chrome", () => {
    const { container } = render(
      <>
        <CustomWidgetPanel language="en" widget={{ id: "1", type: "note", title: "Goals", text: "Ship demo\nPost devlog" }} />
        <CustomWidgetPanel language="tr" widget={{ id: "2", type: "countdown", title: "Çıkış", date: "2099-01-01" }} />
      </>,
    );
    expect(container.querySelectorAll(".panel.dashboard-panel")).toHaveLength(2);
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText(/Ship demo/)).toBeInTheDocument();
    expect(screen.getByText("gün kaldı")).toBeInTheDocument();
  });
});
