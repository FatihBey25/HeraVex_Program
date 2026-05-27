import { describe, it, expect } from "vitest";
import { selectAllTasks } from "../store";
import type { GameRecord } from "../types";

const makeGame = (id: string, tasks: GameRecord["tasks"] = []): GameRecord => ({
  id,
  title: `Game ${id}`,
  summary: "",
  status: "Fikir",
  platforms: [],
  tags: [],
  notes: "",
  tasks,
  versions: [],
  expenses: [],
  releaseTimeline: [],
  moodboard: { categories: [], items: [] },
  stores: {
    itch:  { enabled: false, externalId: "", label: "" },
    steam: { enabled: false, externalId: "", label: "" },
    play:  { enabled: false, externalId: "", label: "" },
  },
  updatedAt: new Date().toISOString(),
});

describe("selectAllTasks", () => {
  it("returns empty array for no games", () => {
    expect(selectAllTasks([])).toEqual([]);
  });

  it("flattens tasks from multiple games", () => {
    const games = [
      makeGame("g1", [
        { id: "t1", title: "Task 1", description: "", done: false, priority: 3 },
        { id: "t2", title: "Task 2", description: "", done: false, priority: 2 },
      ]),
      makeGame("g2", [
        { id: "t3", title: "Task 3", description: "", done: true, priority: 1 },
      ]),
    ];
    const result = selectAllTasks(games);
    expect(result).toHaveLength(3);
    expect(result.every((t) => "gameId" in t)).toBe(true);
    expect(result.every((t) => "gameTitle" in t)).toBe(true);
  });

  it("sorts open tasks before done tasks", () => {
    const games = [
      makeGame("g1", [
        { id: "t1", title: "Done task",   description: "", done: true,  priority: 3 },
        { id: "t2", title: "Open task",   description: "", done: false, priority: 1 },
      ]),
    ];
    const result = selectAllTasks(games);
    expect(result[0].done).toBe(false);
    expect(result[1].done).toBe(true);
  });

  it("sorts open tasks by priority descending", () => {
    const games = [
      makeGame("g1", [
        { id: "t1", title: "Low",    description: "", done: false, priority: 1 },
        { id: "t2", title: "High",   description: "", done: false, priority: 3 },
        { id: "t3", title: "Medium", description: "", done: false, priority: 2 },
      ]),
    ];
    const result = selectAllTasks(games);
    const open = result.filter((t) => !t.done);
    expect(open[0].priority).toBe(3);
    expect(open[1].priority).toBe(2);
    expect(open[2].priority).toBe(1);
  });

  it("attaches correct gameId to each task", () => {
    const games = [
      makeGame("alpha", [{ id: "t1", title: "T1", description: "", done: false, priority: 2 }]),
      makeGame("beta",  [{ id: "t2", title: "T2", description: "", done: false, priority: 2 }]),
    ];
    const result = selectAllTasks(games);
    const t1 = result.find((t) => t.id === "t1");
    const t2 = result.find((t) => t.id === "t2");
    expect(t1?.gameId).toBe("alpha");
    expect(t2?.gameId).toBe("beta");
  });
});
