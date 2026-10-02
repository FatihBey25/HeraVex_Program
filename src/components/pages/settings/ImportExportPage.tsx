// Settings → Import & Export (v0.9.9).
//
// Export: everything (backup), one game (bundle with images), notes as
// Markdown, tasks as CSV. Import: Notion, Trello, Obsidian, a Markdown
// folder, a CSV task list, a HeraVex game bundle.
//
// Conversion lives in lib/importExport.ts (tested). Every import shows
// what it found and asks before writing anything; notes are added as new
// notes and tasks are added to the game picked here — nothing existing
// is overwritten.

import { useMemo, useState } from "react";
import { useAppStore } from "../../../store";
import { SettingGroup } from "./rows/SettingGroup";
import { SettingRow } from "./rows/SettingRow";
import { CompactButton, Dropdown } from "./rows/controls";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { visibleGames } from "../../../lib/general-game";
import { defaultBoardColumns } from "../../../lib/boardColumns";
import {
  addTasksToGame, csvToTasks, markdownFilesToNotes, notesToMarkdownFiles, parseCsv,
  tasksToCsv, trelloToTasks, type MarkdownSource,
} from "../../../lib/importExport";
import {
  exportGameBundle, getAllNotes, importGameBundle, pickAndReadTextFile, pickAndReadTextFiles,
  pickDirectory, revealInFolder, saveGame, saveNote, saveTextFileDialog, writeTextFilesToNewFolder,
} from "../../../lib/storage";
import type { NoteRecord, TaskItem } from "../../../types";

type Pending =
  | { kind: "notes"; source: string; notes: NoteRecord[] }
  | { kind: "tasks"; source: string; tasks: TaskItem[]; skipped: number };

const isCancel = (err: unknown) => /iptal|cancel/i.test(String(err));
const today = () => new Date().toISOString().slice(0, 10);

export function ImportExportPage() {
  const { ui, language, games, handleExportBackup, showToast, showError, applySavedGame, refreshGames } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const projects = useMemo(() => visibleGames(games), [games]);
  const [exportGameId, setExportGameId] = useState("");
  const [targetGameId, setTargetGameId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const exportId = exportGameId || projects[0]?.id || "";
  const targetId = targetGameId || projects[0]?.id || "";
  const targetGame = projects.find((g) => g.id === targetId);
  const gameOptions = projects.map((g) => ({ id: g.id, label: g.title }));

  const run = async (id: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    try { await fn(); } catch (err) { if (!isCancel(err)) showError(err); } finally { setBusy(null); }
  };
  const savedToast = (path: string) =>
    showToast(tr(`Saved: ${path}`, `Kaydedildi: ${path}`), "success", () => { void revealInFolder(path); }, tr("Open folder", "Klasörü aç"));

  // ── Export ──────────────────────────────────────────────────────────
  const exportGame = () => run("game", async () => {
    if (!exportId) return;
    savedToast(await exportGameBundle(exportId));
  });
  const exportNotes = () => run("notes", async () => {
    const notes = await getAllNotes();
    if (notes.length === 0) { showToast(tr("There are no notes to export.", "Dışa aktarılacak not yok."), "info"); return; }
    const dir = await pickDirectory();
    if (!dir) return;
    const folder = await writeTextFilesToNewFolder(dir, `HeraVex Notes ${today()}`, notesToMarkdownFiles(notes));
    savedToast(folder);
  });
  const exportTasks = () => run("tasks", async () => {
    const withTasks = games.filter((g) => g.tasks.length > 0);
    if (withTasks.length === 0) { showToast(tr("There are no tasks to export.", "Dışa aktarılacak görev yok."), "info"); return; }
    savedToast(await saveTextFileDialog(`heravex-tasks-${today()}.csv`, "CSV", ["csv"], tasksToCsv(withTasks, language)));
  });

  // ── Import: read + preview ──────────────────────────────────────────
  const readNotes = (id: string, source: MarkdownSource, zip: boolean) => run(id, async () => {
    const [path, files] = await pickAndReadTextFiles(["md", "markdown", "txt"], zip,
      source === "notion" ? tr("Pick the Notion export (.zip)", "Notion dışa aktarımını seç (.zip)") : undefined);
    const notes = markdownFilesToNotes(files, source);
    if (notes.length === 0) {
      showToast(tr("No Markdown files found there.", "Orada Markdown dosyası bulunamadı."), "warning");
      return;
    }
    setPending({ kind: "notes", source: path, notes });
  });
  const readCsv = () => run("csv", async () => {
    const file = await pickAndReadTextFile("CSV", ["csv", "txt"]);
    const parsed = csvToTasks(parseCsv(file.contents));
    if (!parsed) {
      showToast(tr("No task / title column found in the CSV.", "CSV'de görev / başlık sütunu bulunamadı."), "warning");
      return;
    }
    if (parsed.tasks.length === 0) { showToast(tr("The CSV has no tasks.", "CSV'de görev yok."), "info"); return; }
    setPending({ kind: "tasks", source: file.relative, tasks: parsed.tasks, skipped: parsed.skipped });
  });
  const readTrello = () => run("trello", async () => {
    const file = await pickAndReadTextFile("Trello JSON", ["json"]);
    let json: unknown;
    try { json = JSON.parse(file.contents); } catch { json = null; }
    const parsed = trelloToTasks(json);
    if (!parsed) {
      showToast(tr("This isn't a Trello board export.", "Bu bir Trello pano dışa aktarımı değil."), "warning");
      return;
    }
    setPending({ kind: "tasks", source: `Trello: ${parsed.boardName}`, tasks: parsed.tasks, skipped: parsed.archivedSkipped });
  });
  const importBundle = () => run("bundle", async () => {
    const game = await importGameBundle();
    await refreshGames(game.id, { silent: true });
    showToast(tr(`"${game.title}" was added.`, `"${game.title}" eklendi.`), "success");
  });

  // ── Import: write after confirmation ────────────────────────────────
  const confirmImport = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    void run("write", async () => {
      if (p.kind === "notes") {
        let done = 0;
        for (const n of p.notes) {
          await saveNote(n);
          done++;
        }
        window.dispatchEvent(new CustomEvent("heravex:notes-file-changed"));
        showToast(tr(`${done} notes imported.`, `${done} not içe aktarıldı.`), "success");
      } else {
        const g = useAppStore.getState().games.find((x) => x.id === targetId);
        if (!g) { showToast(tr("Pick a game for the tasks first.", "Önce görevlerin ekleneceği oyunu seç."), "warning"); return; }
        const next = addTasksToGame(g, p.tasks, defaultBoardColumns(language));
        applySavedGame(await saveGame(next));
        showToast(tr(`${p.tasks.length} tasks added to ${g.title}.`, `${p.tasks.length} görev ${g.title} oyununa eklendi.`), "success");
      }
    });
  };

  const btn = (id: string, label: string, onClick: () => void, disabled = false) => (
    <CompactButton onClick={onClick} disabled={!!busy || disabled}>{busy === id ? "…" : label}</CompactButton>
  );
  const needsGame = projects.length === 0;

  return (
    <>
      <SettingGroup label={ui.ieGroupExport}>
        <SettingRow
          title={ui.ieExportAll}
          description={ui.ieExportAllDesc}
          control={<CompactButton onClick={() => void handleExportBackup()}>{ui.ieExportBtn}</CompactButton>}
        />
        <SettingRow
          title={ui.ieExportGame}
          description={tr("One project with its tasks, notes, versions and images, as a .zip. Build files are not included.",
                          "Tek projeyi görevleri, notları, sürümleri ve görselleriyle .zip olarak paketler. Build dosyaları dahil edilmez.")}
          control={
            <div className="setting-inline-pair">
              {projects.length > 0 && <Dropdown value={exportId} options={gameOptions} onChange={setExportGameId} />}
              {btn("game", tr("Export", "Dışa aktar"), () => void exportGame(), needsGame)}
            </div>
          }
        />
        <SettingRow
          title={ui.ieExportNotesMd}
          description={tr("One .md file per note in a new folder. Works with Obsidian and any Markdown editor.",
                          "Her not yeni bir klasörde ayrı bir .md dosyası olur. Obsidian ve tüm Markdown editörleriyle açılır.")}
          control={btn("notes", tr("Export", "Dışa aktar"), () => void exportNotes())}
        />
        <SettingRow
          title={ui.ieExportTasksCsv}
          description={tr("Every task of every game in one table. Opens in Excel and Google Sheets.",
                          "Tüm oyunların tüm görevleri tek tabloda. Excel ve Google Sheets'te açılır.")}
          control={btn("tasks", tr("Export", "Dışa aktar"), () => void exportTasks())}
        />
      </SettingGroup>

      <SettingGroup
        label={ui.ieGroupImport}
        hint={tr("You see what was found before anything is added. Nothing existing is overwritten.",
                 "Bir şey eklenmeden önce ne bulunduğunu görürsün. Var olan hiçbir şeyin üzerine yazılmaz.")}
      >
        <SettingRow
          title={tr("Add imported tasks to", "İçe aktarılan görevler şuraya eklensin")}
          description={needsGame
            ? tr("Create a game first; Trello and CSV tasks are added to a game.", "Önce bir oyun oluştur; Trello ve CSV görevleri bir oyuna eklenir.")
            : tr("Used by Trello and CSV. Their lists / columns become board columns.", "Trello ve CSV için. Listeleri / sütunları pano sütunu olur.")}
          control={projects.length > 0 ? <Dropdown value={targetId} options={gameOptions} onChange={setTargetGameId} /> : undefined}
        />
        <SettingRow
          title="Notion"
          description={tr("Notion → Settings → Export → Markdown & CSV. Pick the .zip; pages become notes.",
                          "Notion → Ayarlar → Dışa aktar → Markdown & CSV. .zip dosyasını seç; sayfalar not olur.")}
          control={btn("notion", tr("Pick .zip", ".zip seç"), () => void readNotes("notion", "notion", true))}
        />
        <SettingRow
          title="Trello"
          description={tr("Board menu → Print, export and share → Export as JSON. Cards become tasks.",
                          "Pano menüsü → Yazdır, dışa aktar ve paylaş → JSON olarak dışa aktar. Kartlar görev olur.")}
          control={btn("trello", tr("Pick JSON", "JSON seç"), () => void readTrello(), needsGame)}
        />
        <SettingRow
          title="Obsidian"
          description={tr("Pick the vault folder. [[Links]] become plain text; the .obsidian folder is skipped.",
                          "Kasa (vault) klasörünü seç. [[Bağlantılar]] düz metne döner; .obsidian klasörü atlanır.")}
          control={btn("obsidian", tr("Pick folder", "Klasör seç"), () => void readNotes("obsidian", "obsidian", false))}
        />
        <SettingRow
          title={ui.ieImportMd}
          description={tr("Every .md file in the folder and its subfolders becomes a note; folder names become categories.",
                          "Klasör ve alt klasörlerdeki her .md dosyası not olur; klasör adları kategori olur.")}
          control={btn("md", tr("Pick folder", "Klasör seç"), () => void readNotes("md", "markdown", false))}
        />
        <SettingRow
          title={ui.ieImportCsv}
          description={tr("Needs a title column (Task / Title / Name / Görev). Status, due date, priority and tags are read if present.",
                          "Bir başlık sütunu gerekir (Görev / Başlık / Task / Title). Durum, son tarih, öncelik ve etiketler varsa okunur.")}
          control={btn("csv", tr("Pick CSV", "CSV seç"), () => void readCsv(), needsGame)}
        />
        <SettingRow
          title={ui.ieImportJson}
          description={tr("A game exported with \"Export a single game\". It is added as a new game; nothing is replaced.",
                          "\"Tek bir oyunu dışa aktar\" ile alınmış bir oyun. Yeni oyun olarak eklenir, hiçbir şeyin yerine geçmez.")}
          control={btn("bundle", tr("Pick file", "Dosya seç"), () => void importBundle())}
        />
      </SettingGroup>

      {pending && (
        <ConfirmDialog
          title={pending.kind === "notes"
            ? tr(`Import ${pending.notes.length} notes?`, `${pending.notes.length} not içe aktarılsın mı?`)
            : tr(`Add ${pending.tasks.length} tasks to ${targetGame?.title ?? "?"}?`, `${pending.tasks.length} görev ${targetGame?.title ?? "?"} oyununa eklensin mi?`)}
          body={
            <div className="ie-preview">
              <span className="ie-preview-source">{pending.source}</span>
              <ul>
                {(pending.kind === "notes" ? pending.notes.map((n) => n.title) : pending.tasks.map((t) => t.title))
                  .slice(0, 6)
                  .map((t, i) => <li key={i}>{t}</li>)}
              </ul>
              {(pending.kind === "notes" ? pending.notes.length : pending.tasks.length) > 6 && (
                <span className="ie-preview-more">
                  {tr(`+${(pending.kind === "notes" ? pending.notes.length : pending.tasks.length) - 6} more`,
                      `+${(pending.kind === "notes" ? pending.notes.length : pending.tasks.length) - 6} tane daha`)}
                </span>
              )}
              {pending.kind === "tasks" && pending.skipped > 0 && (
                <span className="ie-preview-more">
                  {tr(`${pending.skipped} rows / archived cards skipped.`, `${pending.skipped} satır / arşivlenmiş kart atlandı.`)}
                </span>
              )}
            </div>
          }
          confirmLabel={tr("Import", "İçe aktar")}
          cancelLabel={tr("Cancel", "Vazgeç")}
          onConfirm={confirmImport}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
