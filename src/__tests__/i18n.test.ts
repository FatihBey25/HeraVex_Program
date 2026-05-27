import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compareTasks,
  dueToneClass,
  taskDeadlineLabel,
  statusToneClass,
  formatFileSize,
  priorityLabel,
  localeForLanguage,
} from "../lib/i18n";
import type { TaskItem } from "../types";

const makeTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: "t1",
  title: "Test task",
  description: "",
  done: false,
  priority: 2,
  ...overrides,
});

// ── compareTasks ──────────────────────────────────────────────────────────────

describe("compareTasks", () => {
  it("puts done tasks after open tasks", () => {
    const open = makeTask({ done: false });
    const done = makeTask({ done: true });
    expect(compareTasks(open, done)).toBeLessThan(0);
    expect(compareTasks(done, open)).toBeGreaterThan(0);
  });

  it("sorts by priority descending when no due dates", () => {
    const high = makeTask({ priority: 3 });
    const low = makeTask({ priority: 1 });
    expect(compareTasks(high, low)).toBeLessThan(0);
  });

  it("sorts by due date ascending", () => {
    const earlier = makeTask({ dueDate: "2024-01-01" });
    const later = makeTask({ dueDate: "2024-12-31" });
    expect(compareTasks(earlier, later)).toBeLessThan(0);
  });

  it("puts task with due date before task without", () => {
    const withDue = makeTask({ dueDate: "2024-06-01" });
    const noDue = makeTask({ dueDate: undefined });
    expect(compareTasks(withDue, noDue)).toBeLessThan(0);
  });
});

// ── dueToneClass ──────────────────────────────────────────────────────────────

describe("dueToneClass", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns neutral for no due date", () => {
    expect(dueToneClass(makeTask())).toBe("due-chip-neutral");
  });

  it("returns done for completed tasks", () => {
    expect(dueToneClass(makeTask({ done: true, dueDate: "2024-01-01" }))).toBe("due-chip-done");
  });

  it("returns overdue for past date", () => {
    vi.setSystemTime(new Date("2024-12-01"));
    expect(dueToneClass(makeTask({ dueDate: "2024-01-01" }))).toBe("due-chip-overdue");
  });

  it("returns soon for date within 3 days", () => {
    vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
    expect(dueToneClass(makeTask({ dueDate: "2024-06-03" }))).toBe("due-chip-soon");
  });
});

// ── taskDeadlineLabel ─────────────────────────────────────────────────────────

describe("taskDeadlineLabel", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns noDeadline when no dueDate", () => {
    const label = taskDeadlineLabel(makeTask(), "en");
    expect(label).toBe("No deadline");
  });

  it("returns overdue when past deadline", () => {
    vi.setSystemTime(new Date("2024-12-01"));
    const label = taskDeadlineLabel(makeTask({ dueDate: "2024-01-01" }), "en");
    expect(label).toBe("Overdue");
  });

  it("returns dueToday when due date is today", () => {
    vi.setSystemTime(new Date("2024-06-15T00:00:00Z"));
    const label = taskDeadlineLabel(makeTask({ dueDate: "2024-06-15" }), "en");
    expect(label).toBe("Due today");
  });
});

// ── statusToneClass ───────────────────────────────────────────────────────────

describe("statusToneClass", () => {
  it("returns live for Yayinda", () => {
    expect(statusToneClass("Yayinda")).toBe("status-tag-live");
  });
  it("returns ready for Yayina Hazir", () => {
    expect(statusToneClass("Yayina Hazir")).toBe("status-tag-ready");
  });
  it("returns beta for Beta", () => {
    expect(statusToneClass("Beta")).toBe("status-tag-beta");
  });
  it("returns alpha for Alpha", () => {
    expect(statusToneClass("Alpha")).toBe("status-tag-alpha");
  });
  it("returns demo for Demo", () => {
    expect(statusToneClass("Demo")).toBe("status-tag-demo");
  });
  it("returns proto for Prototip", () => {
    expect(statusToneClass("Prototip")).toBe("status-tag-proto");
  });
  it("returns idea for Fikir", () => {
    expect(statusToneClass("Fikir")).toBe("status-tag-idea");
  });
});

// ── formatFileSize ────────────────────────────────────────────────────────────

describe("formatFileSize", () => {
  it("formats bytes", () => { expect(formatFileSize(512)).toBe("512 B"); });
  it("formats kilobytes", () => { expect(formatFileSize(2048)).toBe("2.0 KB"); });
  it("formats megabytes", () => { expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB"); });
  it("formats gigabytes", () => { expect(formatFileSize(2 * 1024 ** 3)).toBe("2.00 GB"); });
});

// ── priorityLabel ─────────────────────────────────────────────────────────────

describe("priorityLabel", () => {
  it("returns High for priority 3 in en", () => { expect(priorityLabel(3, "en")).toBe("High"); });
  it("returns Medium for priority 2", () => { expect(priorityLabel(2, "en")).toBe("Medium"); });
  it("returns Low for priority 1", () => { expect(priorityLabel(1, "en")).toBe("Low"); });
  it("works in Turkish", () => {
    expect(priorityLabel(3, "tr")).toBeTruthy();
    expect(priorityLabel(2, "tr")).toBeTruthy();
  });
});

// ── localeForLanguage ─────────────────────────────────────────────────────────

describe("localeForLanguage", () => {
  it("maps en to en-US", () => { expect(localeForLanguage("en")).toBe("en-US"); });
  it("maps tr to tr-TR", () => { expect(localeForLanguage("tr")).toBe("tr-TR"); });
  it("maps fr to fr-FR", () => { expect(localeForLanguage("fr")).toBe("fr-FR"); });
  it("maps es to es-ES", () => { expect(localeForLanguage("es")).toBe("es-ES"); });
});
