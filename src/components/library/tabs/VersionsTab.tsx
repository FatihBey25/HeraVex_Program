import { useMemo, useRef, useState } from "react";
import { FolderOpen, Trash2, Rocket } from "lucide-react";
import { useAppStore } from "../../../store";
import { revealBuildFile, resolveBuildFolder } from "../../../lib/storage";
import { formatFileSize, localeForLanguage } from "../../../lib/i18n";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { ButlerPanel, type ButlerPanelHandle } from "../ButlerPanel";

export function VersionsTab({ gameId }: { gameId: string }) {
  const { games, handleAddVersion, handleDeleteVersion, language, ui, showError } = useAppStore();
  const game = games.find((g) => g.id === gameId);

  const [versionDraft, setVersionDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDel, setConfirmDel] = useState<{ id: string; version: string } | null>(null);

  // v0.8.5: imperative handle for prefilling the Butler folder field
  // when a user clicks "Push this version with Butler" on a version
  // card. We resolve the build folder via Rust (workspace-relative →
  // absolute path) then call into the panel.
  const butlerRef = useRef<ButlerPanelHandle>(null);

  const filtered = useMemo(() => {
    if (!game) return [];
    const q = searchQuery.trim().toLocaleLowerCase(language);
    if (!q) return game.versions;
    return game.versions.filter((v) =>
      [v.version, v.notes, v.buildFileName ?? ""].join(" ").toLocaleLowerCase(language).includes(q)
    );
  }, [game, searchQuery, language]);

  if (!game) return null;

  const addVersion = async () => {
    if (!versionDraft.trim()) return;
    const result = await handleAddVersion(game.id, versionDraft.trim(), notesDraft);
    if (result) { setVersionDraft(""); setNotesDraft(""); }
  };

  const revealBuild = async (relPath: string | undefined) => {
    if (!relPath) return;
    try {
      // `relPath` is workspace-relative (e.g. "<gameId>/v1.0.0/game.zip").
      // Rust resolves it against the active library dir; calling the generic
      // `revealInFolder` would feed Windows a relative path and fail with
      // "system cannot find the path specified".
      await revealBuildFile(relPath);
    } catch (err) {
      showError(err);
    }
  };

  const pushVersionWithButler = async (relPath: string | undefined) => {
    if (!relPath) return;
    try {
      const folder = await resolveBuildFolder(relPath);
      butlerRef.current?.setBuildFolder(folder);
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div key="versions" className="tab-panel tab-content">
      <div className="inline-grid version-inputs">
        <input
          className="input"
          placeholder={ui.versionNumberPlaceholder}
          value={versionDraft}
          onChange={(e) => setVersionDraft(e.target.value)}
        />
        <button className="primary-button" onClick={() => void addVersion()}>
          {ui.pickBuildAndAttach}
        </button>
      </div>
      <textarea className="textarea" placeholder={ui.versionNotesPlaceholder} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
      <div className="build-note">{ui.buildNote}</div>

      {/* v0.8.5: Butler lives between the add-version form and the
       *  saved version list — closer to where a build is created.
       *  Each version row exposes a "Push with Butler" button that
       *  prefills the local folder field on this panel. */}
      <ButlerPanel ref={butlerRef} game={game} />

      <input className="input" placeholder={ui.searchVersions} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

      <div className="stack-list">
        {!filtered.length && <div className="empty-inline-state">{ui.noVersionsFound}</div>}
        {filtered.map((item) => (
          <div key={item.id} className="version-card">
            <div className="version-head">
              <strong>{item.version}</strong>
              <span>{new Date(item.createdAt).toLocaleDateString(localeForLanguage(language))}</span>
            </div>
            <p>{item.notes || ui.noNotes}</p>
            {item.buildFileName && (
              <small className="version-file">
                {item.buildFileName}
                {item.buildFileSizeBytes ? ` · ${formatFileSize(item.buildFileSizeBytes)}` : ""}
              </small>
            )}
            <div className="button-row version-card-actions">
              {item.buildRelativePath && (
                <>
                  <button
                    type="button"
                    className="secondary-button compact-button version-reveal-btn"
                    onClick={() => void revealBuild(item.buildRelativePath)}
                    title={language === "tr" ? "Build dosyasını klasörde göster" : "Reveal build file in folder"}
                  >
                    <FolderOpen size={13} style={{ marginRight: 6 }} />
                    {language === "tr" ? "Build'i Aç" : "Reveal Build"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => void pushVersionWithButler(item.buildRelativePath)}
                    title={language === "tr" ? "Bu sürümü Butler ile gönder" : "Push this version with Butler"}
                  >
                    <Rocket size={13} style={{ marginRight: 6 }} />
                    {language === "tr" ? "Butler ile Gönder" : "Push with Butler"}
                  </button>
                </>
              )}
              <button
                className="secondary-button compact-button version-delete-btn"
                onClick={() => setConfirmDel({ id: item.id, version: item.version })}
              >
                <Trash2 size={12} style={{ marginRight: 6 }} />
                {ui.deleteVersion}
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDel && (
        <ConfirmDialog
          title={language === "tr" ? "Sürümü Sil" : "Delete Version"}
          body={
            language === "tr"
              ? `"v${confirmDel.version}" sürümü ve bağlı build dosyası silinecek. Bu işlem geri alınabilir.`
              : `Version "v${confirmDel.version}" and its build file will be removed. You can undo this action.`
          }
          confirmLabel={language === "tr" ? "Sil" : "Delete"}
          cancelLabel={language === "tr" ? "Vazgeç" : "Cancel"}
          danger
          onConfirm={() => {
            void handleDeleteVersion(game.id, confirmDel.id);
            setConfirmDel(null);
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
