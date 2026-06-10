// Side-by-side conflict dialog for Team Mode → manualMerge.
//
// When the workspace fingerprint changes and the user has selected
// `manualMerge`, App.tsx opens this dialog instead of the simple
// "Refresh" toast. Users see what's on disk (remote) versus what's
// in memory (local) and pick one. `autoMerge` reuses the same
// reload path silently — its UI affordance is just the toast.
//
// We deliberately don't merge JSON automatically — the prompt is
// "Discord/Linear seviyesi" sync, not 3-way text merging. Future
// CRDT layer (M5) is the right answer for true field-level merge.

import { useEffect, useState } from "react";
import { X, GitMerge, RefreshCcw, CloudDownload, HardDrive } from "lucide-react";
import { useAppStore } from "../../store";

interface Props {
  /** The fingerprint string we just saw from disk. */
  remoteSig: string;
  /** The fingerprint we saw immediately before. */
  localSig: string;
  onResolve: (choice: "keepLocal" | "takeRemote") => void;
  onClose: () => void;
}

export function ConflictDialog({ remoteSig, localSig, onResolve, onClose }: Props) {
  const { ui, language, games, refreshGames } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const [busy, setBusy] = useState(false);

  // Esc closes — treats it as "keep local" (no destructive default).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parse = (sig: string) => {
    const [count, size, mtime] = sig.split(":");
    return {
      count: Number(count) || 0,
      size: Number(size) || 0,
      mtime: Number(mtime) || 0,
    };
  };
  const local  = parse(localSig);
  const remote = parse(remoteSig);
  const fmtSize = (b: number) =>
    b < 1024 ? `${b}B`
    : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1024 / 1024).toFixed(2)} MB`;
  const fmtTime = (s: number) => {
    if (!s) return "—";
    const d = new Date(s * 1000);
    return d.toLocaleString();
  };

  const handleKeep = async () => {
    setBusy(true);
    onResolve("keepLocal");
    setBusy(false);
  };
  const handleTake = async () => {
    setBusy(true);
    try { await refreshGames(); } catch { /* surfaced upstream */ }
    onResolve("takeRemote");
    setBusy(false);
  };

  return (
    <div className="mb-modal-backdrop conflict-backdrop" onClick={onClose}>
      <div className="mb-modal conflict-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mb-modal-close" onClick={onClose} aria-label={ui.mbClose}>
          <X size={16} />
        </button>

        <div className="mb-modal-side" style={{ borderLeft: "none", padding: 28 }}>
          <header className="conflict-head">
            <GitMerge size={20} />
            <div>
              <h2>{tr("Sync conflict", "Senkron çakışması")}</h2>
              <p>{tr(
                "Another user changed the shared workspace. Pick which version to keep.",
                "Başka bir kullanıcı paylaşılan workspace'i değiştirdi. Hangi sürümü tutalım?",
              )}</p>
            </div>
          </header>

          <div className="conflict-grid">
            <button
              type="button"
              className="conflict-card"
              onClick={() => void handleKeep()}
              disabled={busy}
            >
              <div className="conflict-card-icon"><HardDrive size={18} /></div>
              <h3>{tr("Keep local", "Yereli koru")}</h3>
              <p>{tr(
                "Your changes will overwrite the remote on next save.",
                "Yerel değişiklikleriniz sonraki kayıtta uzaktakini ezecek.",
              )}</p>
              <dl>
                <div><dt>{tr("Games in memory", "Bellekteki oyunlar")}</dt><dd>{games.length}</dd></div>
                <div><dt>{tr("Last seen sig", "Son görülen imza")}</dt><dd>{local.count} · {fmtSize(local.size)}</dd></div>
              </dl>
            </button>

            <button
              type="button"
              className="conflict-card is-recommended"
              onClick={() => void handleTake()}
              disabled={busy}
            >
              <div className="conflict-card-icon"><CloudDownload size={18} /></div>
              <h3>{tr("Take remote", "Uzaktakini al")} <span className="conflict-rec">{tr("recommended", "önerilen")}</span></h3>
              <p>{tr(
                "Reloads from disk. In-memory unsaved edits are discarded.",
                "Diskten yeniden yüklenir. Bellekteki kaydedilmemiş düzenlemeler kaybolur.",
              )}</p>
              <dl>
                <div><dt>{tr("Files on disk", "Diskteki dosyalar")}</dt><dd>{remote.count}</dd></div>
                <div><dt>{tr("Disk size", "Disk boyutu")}</dt><dd>{fmtSize(remote.size)}</dd></div>
                <div><dt>{tr("Newest mtime", "En yeni mtime")}</dt><dd>{fmtTime(remote.mtime)}</dd></div>
              </dl>
            </button>
          </div>

          <footer className="conflict-foot">
            <button type="button" className="setting-compact-btn" onClick={onClose}>
              <RefreshCcw size={11} style={{ marginRight: 4 }} />
              {tr("Decide later", "Sonra karar ver")}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
