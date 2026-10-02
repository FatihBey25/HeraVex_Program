import { describe, expect, it, vi } from "vitest";
import { consumeCreate, requestCreate } from "../lib/createIntents";

// Tray / shortcut / "+" requests must survive the tab switch: the target
// page mounts AFTER the request is made and picks it up then.
describe("createIntents", () => {
  it("parks a request until the page consumes it, exactly once", () => {
    requestCreate("task", { title: "Fix jump bug" });
    expect(consumeCreate("note")).toBeNull();
    expect(consumeCreate("task")).toEqual({ title: "Fix jump bug" });
    expect(consumeCreate("task")).toBeNull();
  });

  it("notifies an already-mounted page via a window event", () => {
    const seen = vi.fn();
    window.addEventListener("heravex:new-note", seen);
    requestCreate("note");
    window.removeEventListener("heravex:new-note", seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(consumeCreate("note")).toEqual({});
  });
});
