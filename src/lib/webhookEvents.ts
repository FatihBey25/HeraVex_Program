// Webhook dispatch (v0.9.9).
//
// Settings → Webhooks lets the user pick events for Discord and for
// their own endpoints ("custom webhooks"). The flows call
// `emitWebhookEvent` and this module sends to every target that wants
// that event. Sending never blocks or breaks the flow that triggered
// it; a failure is reported through `heravex:webhook-failed`, which
// App turns into a toast.
//
//   versionPublished — a version was added (store.handleAddVersion)
//   taskCompleted    — a task went from open to done (store.applySavedGame)
//   pressKitGenerated— a press kit was written (PressKitModal)
//   buildReady       — a build was pushed to itch.io (ButlerPanel)
//
// Custom webhooks get a JSON POST (see `customPayload`), sent from Rust
// because the app's CSP only allows a fixed list of hosts.

import { invoke } from "./invokeWrapper";
import { loadWebhooks, postDiscordWebhook, type WebhookEvent } from "./teamWebhooks";

export type WebhookEventData = {
  game?: string;
  version?: string;
  task?: string;
  user?: string;
};

const DISCORD_DEFAULTS: Record<WebhookEvent, string> = {
  versionPublished: "🎮 {game} v{version} just shipped by {user}",
  taskCompleted: "✅ {user} completed \"{task}\" in {game}",
  pressKitGenerated: "📰 Press kit ready for {game}",
  buildReady: "📦 {game} {version} was pushed to itch.io",
};

export function fillTemplate(template: string, d: WebhookEventData): string {
  return template
    .replace(/\{game\}/g, d.game ?? "")
    .replace(/\{version\}/g, d.version ?? "")
    .replace(/\{task\}/g, d.task ?? "")
    .replace(/\{user\}/g, d.user || "someone");
}

/** The JSON body custom webhooks receive. Stable: documented in the UI. */
export function customPayload(event: WebhookEvent, d: WebhookEventData, at = new Date()) {
  return {
    app: "HeraVex",
    event,
    game: d.game ?? null,
    version: d.version ?? null,
    task: d.task ?? null,
    user: d.user ?? null,
    timestamp: at.toISOString(),
    // Slack / Discord-compatible text, so a plain chat webhook URL works too.
    text: fillTemplate(DISCORD_DEFAULTS[event], d),
    content: fillTemplate(DISCORD_DEFAULTS[event], d),
  };
}

export async function postCustomWebhook(url: string, body: unknown): Promise<void> {
  await invoke<number>("post_webhook", { url, body });
}

function reportFailure(target: string, err: unknown) {
  window.dispatchEvent(new CustomEvent("heravex:webhook-failed", { detail: { target, message: String(err) } }));
}

/** Fire-and-forget. Returns a promise only so tests can await it. */
export function emitWebhookEvent(event: WebhookEvent, data: WebhookEventData): Promise<void> {
  const cfg = loadWebhooks();
  const jobs: Promise<void>[] = [];
  const d = cfg.discord;
  if (d.webhookUrl.trim() && d.events.includes(event)) {
    // The user's template is written for releases; other events use
    // their own sentence so "{version}" never comes out empty.
    const template = event === "versionPublished" && d.messageTemplate.trim() ? d.messageTemplate : DISCORD_DEFAULTS[event];
    jobs.push(postDiscordWebhook(d.webhookUrl.trim(), fillTemplate(template, data)).catch((e) => reportFailure("Discord", e)));
  }
  for (const hook of cfg.custom ?? []) {
    if (!hook.enabled || !hook.url.trim() || !hook.events.includes(event)) continue;
    jobs.push(postCustomWebhook(hook.url.trim(), customPayload(event, data)).catch((e) => reportFailure(hook.name || hook.url, e)));
  }
  return Promise.all(jobs).then(() => undefined);
}
