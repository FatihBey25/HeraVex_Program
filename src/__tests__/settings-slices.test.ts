// v0.9 M8 — Smoke tests for the Settings slices.
//
// Confirms that each load*() helper returns the DEFAULT_* slice
// when localStorage is empty, and that the shallow-merge upgrade
// path doesn't drop fields when a partial payload is on disk. The
// real value here is catching the day someone adds a slice field
// without a default — the test would explode on the missing key.

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_APPEARANCE, DEFAULT_LAYOUT, DEFAULT_TYPOGRAPHY,
  loadAppearance, loadLayout, loadTypography,
} from "../lib/appearance";
import {
  DEFAULT_NOTIFICATIONS, DEFAULT_POMODORO_PREFS, DEFAULT_STARTUP,
  loadNotifications, loadPomodoroPrefs, loadStartup,
} from "../lib/preferences";
import {
  DEFAULT_PROFILE, DEFAULT_GENERAL,
  loadProfile, loadGeneral,
} from "../lib/userProfile";
import {
  DEFAULT_BACKUP_PREFS, DEFAULT_STUDIO_IDENTITY,
  loadBackupPrefs, loadStudioIdentity,
} from "../lib/studioIdentity";
import {
  DEFAULT_TEAM_MODE, DEFAULT_WEBHOOKS,
  loadTeamMode, loadWebhooks,
} from "../lib/teamWebhooks";
import {
  DEFAULT_PRIVACY, DEFAULT_EXPERIMENTAL,
  loadPrivacy, loadExperimental,
} from "../lib/privacyExperimental";

beforeEach(() => {
  // jsdom's localStorage is per-test by default in vitest, but
  // belt-and-suspenders the wipe so partial state from a prior
  // file can't leak in.
  localStorage.clear();
});

describe("settings slices — empty localStorage falls back to DEFAULT_*", () => {
  it("appearance / typography / layout", () => {
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(loadTypography()).toEqual(DEFAULT_TYPOGRAPHY);
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("profile / general", () => {
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
    expect(loadGeneral()).toEqual(DEFAULT_GENERAL);
  });

  it("notifications / startup / pomodoro", () => {
    expect(loadNotifications()).toEqual(DEFAULT_NOTIFICATIONS);
    expect(loadStartup()).toEqual(DEFAULT_STARTUP);
    expect(loadPomodoroPrefs()).toEqual(DEFAULT_POMODORO_PREFS);
  });

  it("studio identity / backup prefs", () => {
    expect(loadStudioIdentity()).toEqual(DEFAULT_STUDIO_IDENTITY);
    expect(loadBackupPrefs()).toEqual(DEFAULT_BACKUP_PREFS);
  });

  it("team mode / webhooks", () => {
    expect(loadTeamMode()).toEqual(DEFAULT_TEAM_MODE);
    expect(loadWebhooks()).toEqual(DEFAULT_WEBHOOKS);
  });

  it("privacy / experimental", () => {
    expect(loadPrivacy()).toEqual(DEFAULT_PRIVACY);
    expect(loadExperimental()).toEqual(DEFAULT_EXPERIMENTAL);
  });
});

describe("settings slices — partial localStorage payload is shallow-merged with defaults", () => {
  it("preserves saved keys and fills missing ones", () => {
    // Pre-v0.9 settings.json knew about base font size but not
    // about heading scale; the merge must fill `headingScale`
    // from the default while honouring the saved `baseSize`.
    localStorage.setItem(
      "heravex_typography_v1",
      JSON.stringify({ baseSize: 16 }),
    );
    const got = loadTypography();
    expect(got.baseSize).toBe(16);
    expect(got.headingScale).toBe(DEFAULT_TYPOGRAPHY.headingScale);
  });

  it("survives malformed JSON without throwing", () => {
    localStorage.setItem("heravex_privacy_v1", "{ not json");
    expect(() => loadPrivacy()).not.toThrow();
    expect(loadPrivacy()).toEqual(DEFAULT_PRIVACY);
  });
});

describe("settings slices — sensible defaults", () => {
  // Quick sanity gate so a future "let's flip privacy to opt-out"
  // PR loud-fails this test instead of silently shipping telemetry.
  it("telemetry + crash reports default OFF", () => {
    expect(DEFAULT_PRIVACY.anonymousTelemetry).toBe(false);
    expect(DEFAULT_PRIVACY.crashReports).toBe(false);
  });

  it("auto-lock defaults to off", () => {
    expect(DEFAULT_PRIVACY.autoLock).toBe("off");
  });

  it("mask values in UI defaults ON", () => {
    expect(DEFAULT_PRIVACY.maskValuesInUi).toBe(true);
  });

  it("redact keys on export defaults ON", () => {
    expect(DEFAULT_PRIVACY.redactKeysOnExport).toBe(true);
  });

  it("pomodoro defaults match classic 25/5/15", () => {
    expect(DEFAULT_POMODORO_PREFS.focusMinutes).toBe(25);
    expect(DEFAULT_POMODORO_PREFS.shortBreakMinutes).toBe(5);
    expect(DEFAULT_POMODORO_PREFS.longBreakMinutes).toBe(15);
  });

  it("backup defaults to daily with 7 retained", () => {
    expect(DEFAULT_BACKUP_PREFS.schedule).toBe("daily");
    expect(DEFAULT_BACKUP_PREFS.retentionCount).toBe(7);
  });
});
