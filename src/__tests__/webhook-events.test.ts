import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn(async (..._args: unknown[]) => 200);
vi.mock("../lib/invokeWrapper", () => ({ invoke: (cmd: string, args: unknown) => invokeMock(cmd, args) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));
const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 204 }));
vi.stubGlobal("fetch", fetchMock);

import { emitWebhookEvent, fillTemplate } from "../lib/webhookEvents";
import { useAppStore } from "../store";
import type { GameRecord } from "../types";

function setHooks(cfg: object) {
  localStorage.setItem("heravex_webhooks_v1", JSON.stringify(cfg));
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockClear();
  fetchMock.mockClear();
});

describe("webhook dispatch", () => {
  it("sends each event only to the targets that picked it", async () => {
    setHooks({
      discord: { webhookUrl: "https://discord.com/api/webhooks/x", events: ["versionPublished"], messageTemplate: "{game} v{version} by {user}" },
      custom: [
        { id: "a", name: "Zapier", url: "https://hooks.zapier.com/1", events: ["taskCompleted"], enabled: true },
        { id: "b", name: "Off", url: "https://example.com/off", events: ["taskCompleted"], enabled: false },
      ],
    });

    await emitWebhookEvent("versionPublished", { game: "Kiln", version: "1.2", user: "Ada" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).content).toBe("Kiln v1.2 by Ada");
    expect(invokeMock).not.toHaveBeenCalled();

    await emitWebhookEvent("taskCompleted", { game: "Kiln", task: "Boss", user: "Ada" });
    expect(invokeMock).toHaveBeenCalledTimes(1); // disabled hook skipped
    const [cmd, args] = invokeMock.mock.calls[0] as [string, { url: string; body: Record<string, unknown> }];
    expect(cmd).toBe("post_webhook");
    expect(args.url).toBe("https://hooks.zapier.com/1");
    expect(args.body).toMatchObject({ app: "HeraVex", event: "taskCompleted", game: "Kiln", task: "Boss", user: "Ada" });
    expect(args.body.text).toBe('✅ Ada completed "Boss" in Kiln');
  });

  it("reports a failed delivery instead of throwing", async () => {
    setHooks({ discord: { webhookUrl: "", events: [], messageTemplate: "" }, custom: [{ id: "a", name: "Mine", url: "https://x.test", events: ["buildReady"], enabled: true }] });
    invokeMock.mockRejectedValueOnce(new Error("Webhook 500 dondu"));
    const failed = vi.fn();
    window.addEventListener("heravex:webhook-failed", failed);
    await expect(emitWebhookEvent("buildReady", { game: "Kiln" })).resolves.toBeUndefined();
    window.removeEventListener("heravex:webhook-failed", failed);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("fills templates", () => {
    expect(fillTemplate("{user} shipped {game} {version}", { game: "G", version: "2" })).toBe("someone shipped G 2");
  });
});

describe("task completed event", () => {
  it("fires only when a task goes from open to done in a local save", async () => {
    setHooks({ discord: { webhookUrl: "", events: [], messageTemplate: "" }, custom: [{ id: "a", name: "n", url: "https://x.test", events: ["taskCompleted"], enabled: true }] });
    const base = {
      id: "g", title: "Kiln", tasks: [
        { id: "t1", title: "Boss", done: false, priority: 2, description: "" },
        { id: "t2", title: "Menu", done: true, priority: 2, description: "" },
      ],
    } as unknown as GameRecord;
    useAppStore.setState({ games: [base] });
    const saved = { ...base, tasks: [{ ...base.tasks[0], done: true }, base.tasks[1]] } as GameRecord;
    useAppStore.getState().applySavedGame(saved);
    useAppStore.getState().applySavedGame(saved); // saving again announces nothing new
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect((invokeMock.mock.calls[0][1] as { body: { task: string } }).body.task).toBe("Boss");
  });
});
