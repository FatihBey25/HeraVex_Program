// Self-contained Itch.io Butler deployment panel.
//
// Lived inside ReleaseTab until v0.8.5; moved here so it can render
// from VersionsTab — Butler pushes a build, so it belongs in the
// version flow rather than the release-checklist screen. Keeping the
// state local makes it portable without leaking persistent state into
// the parent (the only persisted bits, `butlerTarget` and
// `butlerBuildPath`, still live on `GameRecord` and are read/written
// through the store's `handleSaveGame`).
//
// The panel exposes an imperative-ish prop pair for prefilling the
// folder field — when a version row clicks "Push with Butler", the
// VersionsTab resolves the absolute path and pushes it in via
// `prefillFolder`. We use a key on the prefill string so React
// remounts the input state if the same path is sent twice in a row.

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Rocket, Save, AlertTriangle, Terminal, Eraser, X,
  CheckCircle2, ExternalLink, Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../../store";
import { pickDirectory } from "../../lib/storage";
import type { GameRecord } from "../../types";

type ButlerLog =
  | { kind: "stdout"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "info"; line: string }
  | { kind: "done"; code: number }
  | { kind: "error"; message: string; errorKind: "not-installed" | "spawn-failed" | "io-failure" | "non-zero-exit" };

type ConsoleLine = {
  id: number;
  tone: "stdout" | "stderr" | "info" | "ok" | "err";
  text: string;
};

let consoleLineCounter = 0;

export interface ButlerPanelHandle {
  /** Programmatic prefill from a version row's "Push with Butler" click. */
  setBuildFolder: (path: string) => void;
}

interface Props {
  game: GameRecord;
}

export const ButlerPanel = forwardRef<ButlerPanelHandle, Props>(function ButlerPanel(
  { game },
  ref,
) {
  const { handleSaveGame, language, showToast, showError } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const [butlerTarget, setButlerTarget] = useState(game.butlerTarget ?? "");
  const [butlerPath, setButlerPath] = useState(game.butlerBuildPath ?? "");

  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [notInstalled, setNotInstalled] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Pull saved values back when the game switches or the parent
  // refreshes the saved record (e.g. after handleSaveGame returns).
  useEffect(() => {
    setButlerTarget(game.butlerTarget ?? "");
    setButlerPath(game.butlerBuildPath ?? "");
  }, [game.id, game.butlerTarget, game.butlerBuildPath]);

  // Auto-scroll console as logs arrive.
  useEffect(() => {
    const el = consoleRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  // Subscribe to butler-log events. Same payload contract as before
  // the move — backend isn't aware of the relocation.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      unlisten = await listen<ButlerLog>("butler-log", (event) => {
        const p = event.payload;
        if (p.kind === "stdout") {
          appendLine("stdout", p.line);
        } else if (p.kind === "stderr") {
          appendLine("stderr", p.line);
        } else if (p.kind === "info") {
          appendLine("info", p.line);
        } else if (p.kind === "done") {
          if (p.code === 0) {
            appendLine("ok", `[✓] DEPLOYMENT SUCCESSFUL (exit ${p.code})`);
          } else {
            appendLine("err", `[✗] DEPLOYMENT FAILED (exit ${p.code})`);
          }
        } else if (p.kind === "error") {
          appendLine("err", `[!] ${p.message}`);
          if (p.errorKind === "not-installed") setNotInstalled(true);
        }
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    setBuildFolder: (path: string) => {
      setButlerPath(path);
      // Scroll the panel into view so the user sees the prefill happen.
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
  }));

  const butlerDirty =
    butlerTarget !== (game.butlerTarget ?? "") || butlerPath !== (game.butlerBuildPath ?? "");
  const butlerReady = butlerTarget.trim().length > 0 && butlerPath.trim().length > 0;

  const appendLine = (tone: ConsoleLine["tone"], text: string) => {
    setConsoleLines((prev) => [...prev, { id: ++consoleLineCounter, tone, text }]);
  };

  const pickFolder = async () => {
    try {
      const dir = await pickDirectory();
      setButlerPath(dir);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    }
  };

  const saveButler = async () => {
    await handleSaveGame(
      { ...game, butlerTarget: butlerTarget.trim() || null, butlerBuildPath: butlerPath.trim() || null },
      tr("Butler configuration saved.", "Butler ayarları kaydedildi.")
    );
  };

  const deploy = async () => {
    if (!butlerReady || deploying) return;
    setConsoleOpen(true);
    setNotInstalled(false);
    setConsoleLines([]);
    setDeploying(true);
    appendLine("info", tr("→ Initializing butler push…", "→ butler push başlatılıyor…"));
    try {
      await invoke("deploy_to_itch", {
        directory: butlerPath.trim(),
        target: butlerTarget.trim(),
      });
      showToast(tr("Build pushed to Itch.io.", "Build Itch.io'ya gönderildi."), "success");
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("butler bulunamadi")) {
        showError(err);
      }
    } finally {
      setDeploying(false);
    }
  };

  const clearConsole = () => {
    setConsoleLines([]);
    setNotInstalled(false);
  };

  const closeConsole = () => {
    if (deploying) return;
    setConsoleOpen(false);
  };

  return (
    <motion.section
      ref={rootRef}
      className="butler-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="butler-head">
        <div className="butler-head-icon">
          <Rocket size={22} strokeWidth={2} />
        </div>
        <div>
          <p className="eyebrow">{tr("DEPLOYMENT ENGINE", "DAĞITIM MOTORU")}</p>
          <h3 style={{ margin: "2px 0 4px" }}>{tr("Itch.io Butler Integration", "Itch.io Butler Entegrasyonu")}</h3>
          <p className="section-copy" style={{ maxWidth: 520 }}>
            {tr(
              "Push a new build to your itch.io page in one shot. Butler must be installed and authenticated on this machine.",
              "Yeni bir build'i tek hamlede itch.io sayfana gönder. Butler bu makinede kurulu ve giriş yapmış olmalı."
            )}
          </p>
        </div>
      </div>

      <div className="butler-form">
        <div className="butler-field">
          <label className="butler-label">{tr("Itch.io target", "Itch.io hedefi")}</label>
          <input
            className="input"
            placeholder="username/game-slug:channel"
            value={butlerTarget}
            onChange={(e) => setButlerTarget(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            disabled={deploying}
          />
          <small className="butler-hint">
            {tr("Example: sarmal/lost-memories:windows", "Örnek: sarmal/lost-memories:windows")}
          </small>
        </div>

        <div className="butler-field">
          <label className="butler-label">{tr("Local build folder", "Yerel build klasörü")}</label>
          <div className="butler-folder-row">
            <input
              className="input"
              placeholder={tr("Pick a folder with the build…", "Build klasörünü seç…")}
              value={butlerPath}
              onChange={(e) => setButlerPath(e.target.value)}
              spellCheck={false}
              disabled={deploying}
            />
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => void pickFolder()}
              disabled={deploying}
            >
              <FolderOpen size={14} style={{ marginRight: 6 }} />
              {tr("Browse", "Gözat")}
            </button>
          </div>
        </div>
      </div>

      <div className="butler-actions">
        <button
          className="secondary-button compact-button"
          onClick={() => void saveButler()}
          disabled={!butlerDirty || deploying}
          style={{ opacity: butlerDirty && !deploying ? 1 : 0.55 }}
        >
          <Save size={14} style={{ marginRight: 6 }} />
          {tr("Save configuration", "Yapılandırmayı kaydet")}
        </button>
        <button
          className="butler-deploy-cta"
          onClick={() => void deploy()}
          disabled={!butlerReady || deploying}
          style={{ opacity: butlerReady && !deploying ? 1 : 0.7 }}
        >
          {deploying ? (
            <>
              <Loader2 size={18} className="spin" strokeWidth={2.1} />
              <span>{tr("Pushing…", "Yükleniyor…")}</span>
            </>
          ) : (
            <>
              <Rocket size={18} strokeWidth={2.1} />
              <span>{tr("Push to Itch.io with Butler", "Butler ile Itch.io'ya Gönder")}</span>
            </>
          )}
        </button>
      </div>

      {!butlerReady && !consoleOpen && (
        <div className="butler-warn">
          <AlertTriangle size={13} />
          <span>
            {tr(
              "Set both the target and folder to enable deploy.",
              "Dağıtımı etkinleştirmek için hem hedefi hem klasörü doldur."
            )}
          </span>
        </div>
      )}

      {/* ── Live Console ─────────────────────────────────────────── */}
      <AnimatePresence>
        {consoleOpen && (
          <motion.div
            key="terminal"
            className="butler-terminal"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
          >
            <div className="butler-terminal-head">
              <div className="butler-terminal-title">
                <Terminal size={14} />
                <span>butler push</span>
                <span className={`butler-terminal-status ${deploying ? "is-running" : ""}`}>
                  {deploying ? tr("RUNNING", "ÇALIŞIYOR") : tr("IDLE", "BEKLİYOR")}
                </span>
              </div>
              <div className="butler-terminal-actions">
                <button
                  type="button"
                  className="terminal-icon-btn"
                  onClick={clearConsole}
                  title={tr("Clear", "Temizle")}
                >
                  <Eraser size={13} />
                </button>
                <button
                  type="button"
                  className="terminal-icon-btn"
                  onClick={closeConsole}
                  title={tr("Close", "Kapat")}
                  disabled={deploying}
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {notInstalled && (
              <div className="butler-install-help">
                <AlertTriangle size={14} />
                <div style={{ flex: 1 }}>
                  <strong>{tr("Butler not found on PATH", "Sistemde butler bulunamadı")}</strong>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#cbd5e1" }}>
                    {tr(
                      "Install Itch.io Butler and authenticate once before deploying.",
                      "Önce Itch.io Butler'ı kurup bir kez giriş yapman gerekiyor."
                    )}
                  </p>
                </div>
                <a
                  className="butler-install-link"
                  href="https://itch.io/docs/butler/installing.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("How to install", "Nasıl kurulur")}
                  <ExternalLink size={12} style={{ marginLeft: 4 }} />
                </a>
              </div>
            )}

            <div ref={consoleRef} className="butler-terminal-body">
              {consoleLines.length === 0 ? (
                <span className="terminal-placeholder">
                  {tr("Logs will stream here…", "Loglar buraya akacak…")}
                </span>
              ) : (
                consoleLines.map((l) => (
                  <pre key={l.id} className={`terminal-line line-${l.tone}`}>
                    {l.tone === "ok" && <CheckCircle2 size={12} style={{ verticalAlign: -1, marginRight: 6 }} />}
                    {l.text}
                  </pre>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
});
