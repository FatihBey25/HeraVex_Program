import { useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import { useAppStore } from "../../store";
import { pickDirectory } from "../../lib/storage";
import { addWorkspace, switchToWorkspace } from "../../lib/workspaces";
import { useEscape } from "../../lib/keyboard";

interface Props {
  onClose: () => void;
}

export function NewWorkspaceModal({ onClose }: Props) {
  const { language, showToast, showError } = useAppStore();
  useEscape(onClose);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const handlePickDir = async () => {
    try {
      const dir = await pickDirectory();
      setPath(dir);
      // If the user hasn't named the workspace yet, suggest the folder name
      if (!name.trim()) {
        const leaf = dir.split(/[\\/]/).filter(Boolean).pop() || "";
        if (leaf) setName(leaf);
      }
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showToast(msg, "error");
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !path.trim()) return;
    setBusy(true);
    try {
      const ws = addWorkspace(name, path);
      showToast(
        tr(
          `Workspace "${ws.name}" created. Reloading…`,
          `"${ws.name}" çalışma alanı oluşturuldu. Yeniden yükleniyor…`,
        ),
        "success",
      );
      // Switch to the new workspace and reload. The existing reload pattern
      // (used by Profile.tsx) is what guarantees a clean state slate.
      await switchToWorkspace(ws);
      setTimeout(() => { window.location.reload(); }, 700);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="modal-box new-workspace-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tr("New workspace", "Yeni çalışma alanı")}
      >
        <header className="new-workspace-head">
          <div className="new-workspace-icon" aria-hidden="true">
            <FolderPlus size={22} strokeWidth={2} />
          </div>
          <div>
            <p className="eyebrow">{tr("WORKSPACE", "ÇALIŞMA ALANI")}</p>
            <h3 style={{ margin: "2px 0 0" }}>
              {tr("Create a new workspace", "Yeni bir çalışma alanı oluştur")}
            </h3>
          </div>
        </header>

        <p className="section-copy" style={{ marginTop: 8, marginBottom: 18 }}>
          {tr(
            "A workspace is an isolated folder of games, notes, tasks and builds. Switching workspaces reloads HeraVex with that folder's data.",
            "Bir çalışma alanı; oyunlar, notlar, görevler ve build'lerin tutulduğu izole bir klasördür. Çalışma alanı değiştirildiğinde HeraVex bu klasörün verisiyle yeniden açılır.",
          )}
        </p>

        <label className="new-workspace-field">
          <span>{tr("Workspace name", "Çalışma Alanı Adı")}</span>
          <input
            className="input"
            placeholder={tr("e.g. Mobile Studio", "Örn. Mobil Stüdyo")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <label className="new-workspace-field">
          <span>{tr("Folder", "Klasör")}</span>
          <div className="new-workspace-folder-row">
            <input
              className="input"
              readOnly
              placeholder={tr("Pick an empty or existing folder…", "Boş veya mevcut bir klasör seç…")}
              value={path}
              title={path}
            />
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => void handlePickDir()}
              disabled={busy}
            >
              <FolderOpen size={13} style={{ marginRight: 6 }} />
              {tr("Choose folder", "Klasör seç")}
            </button>
          </div>
        </label>

        <p className="new-workspace-note">
          {tr(
            "Existing workspace files in the chosen folder are loaded; an empty folder starts fresh. Your current data is never deleted.",
            "Seçilen klasördeki mevcut çalışma alanı dosyaları yüklenir; boş klasör sıfırdan başlar. Mevcut veriniz hiçbir zaman silinmez.",
          )}
        </p>

        <div className="new-workspace-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={busy}
          >
            {tr("Cancel", "Vazgeç")}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || !path.trim() || busy}
          >
            {busy
              ? tr("Creating…", "Oluşturuluyor…")
              : tr("Create & Switch", "Oluştur ve Geç")}
          </button>
        </div>
      </div>
    </div>
  );
}
