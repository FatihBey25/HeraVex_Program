import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));

import { useAppStore } from "../store";
import { BreakLockOverlay } from "../components/BreakLockOverlay";
import { resetPomodoro, skipPhase } from "../lib/pomodoro";

// Settings → Pomodoro → "Lock app during break".
describe("BreakLockOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPomodoro();
    useAppStore.setState((s) => ({ language: "en", pomodoroPrefs: { ...s.pomodoroPrefs, lockAppDuringBreak: true } }));
  });
  afterEach(() => {
    resetPomodoro();
    vi.useRealTimers();
  });

  it("covers the app only during a break, and only when enabled", () => {
    render(<BreakLockOverlay />);
    expect(screen.queryByRole("dialog")).toBeNull(); // focus phase

    act(() => skipPhase()); // focus -> short break
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => useAppStore.setState((s) => ({ pomodoroPrefs: { ...s.pomodoroPrefs, lockAppDuringBreak: false } })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("blocks app shortcuts while locked", () => {
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    render(<BreakLockOverlay />);
    act(() => skipPhase());
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(shortcut).not.toHaveBeenCalled();
    window.removeEventListener("keydown", shortcut);
  });

  it("needs a hold, not a click, to skip the break", () => {
    render(<BreakLockOverlay />);
    act(() => skipPhase());
    const skip = screen.getByText("Hold to skip break").closest("button")!;

    // A quick press does nothing.
    fireEvent.pointerDown(skip);
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(skip);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Holding long enough ends the break and unlocks.
    fireEvent.pointerDown(skip);
    act(() => { vi.advanceTimersByTime(1600); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
