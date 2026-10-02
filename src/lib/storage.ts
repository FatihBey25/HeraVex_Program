// v0.9 M8 — route through the wrapper so the experimental
// "Log API calls" toggle can intercept every IPC call.
import { invoke } from "./invokeWrapper";
import type {
  ActivityEntry,
  AppSettingsRecord,
  CreateGameInput,
  ExpenseItem,
  GameRecord,
  GameStatus,
  NoteRecord,
  PressKitInput,
  ReleaseTemplateItem,
  StoreData,
  StoreGameInfo,
  StoreProvider
} from "../types";
import type { Flow } from "./flow";

export const STATUSES: GameStatus[] = [
  "Fikir",
  "Prototip",
  "Demo",
  "Alpha",
  "Beta",
  "Yayina Hazir",
  "Yayinda"
];

export const PLATFORMS = ["Windows", "macOS", "Linux", "Android", "Web", "iOS"];

export async function loadGames() {
  return invoke<GameRecord[]>("load_games");
}

/** Team sync: re-read only the given game files. Missing ids are absent
 *  from the result. */
export async function loadGamesByIds(ids: string[]) {
  return invoke<GameRecord[]>("load_games_by_ids", { ids });
}

export async function createGame(input: CreateGameInput) {
  return invoke<GameRecord>("create_game", { input });
}

// Plugin hook bus — storage.ts is the single choke point every
// game/note write flows through (store actions, NoteCenter, quick
// capture, plugins' own hv.saveNote), so intercepting here covers the
// whole app. `before*` filters may transform the payload or return
// null to BLOCK; blocking throws so each caller's existing error
// toast surfaces the reason instead of failing silently.
import { applyHookFilters, emitHookEvent } from "./pluginHooks";

const BLOCKED_MSG = "Islem bir eklenti tarafindan engellendi (plugin blocked).";

export async function saveGame(game: GameRecord) {
  const filtered = await applyHookFilters("game:beforeSave", game);
  if (filtered === null) throw new Error(BLOCKED_MSG);
  const saved = await invoke<GameRecord>("save_game", { game: filtered });
  emitHookEvent("game:afterSave", saved);
  return saved;
}

/** `keepBuilds`: Settings → Storage auto-prune — keep this many newest
 *  build files for the game (null = keep all). */
export async function addVersionWithBuild(
  gameId: string,
  version: string,
  notes: string,
  keepBuilds: number | null = null,
) {
  return invoke<GameRecord>("add_version_with_build", {
    gameId,
    version,
    notes,
    keepBuilds,
  });
}

// ── Storage maintenance (Settings → Storage, v0.9.9) ───────────────────
export type CleanResult = { files: number; bytes: number };
export type OrphanImage = { path: string; relative: string; sizeBytes: number };
export type IntegrityProblem = {
  kind: "unreadable" | "corrupt" | "missingCover" | "missingImage" | "missingBuild" | "duplicateId" | "tempLeftover";
  file: string;
  detail: string;
};
export type IntegrityReport = { checkedFiles: number; problems: IntegrityProblem[] };
export type PruneResult = { games: number; files: number; bytes: number };

export const storageClearCache = () => invoke<CleanResult>("storage_clear_cache");
export const storageRemoveTemp = () => invoke<CleanResult>("storage_remove_temp");
export const storageFindOrphanImages = () => invoke<OrphanImage[]>("storage_find_orphan_images");
export const storageDeleteOrphanImages = (paths: string[]) =>
  invoke<CleanResult>("storage_delete_orphan_images", { paths });
export const storageIntegrityCheck = () => invoke<IntegrityReport>("storage_integrity_check");
export const storagePruneBuilds = (keep: number) => invoke<PruneResult>("storage_prune_builds", { keep });

export async function openCurrentBuild(gameId: string) {
  return invoke<void>("open_current_build", { gameId });
}

export async function deleteVersion(gameId: string, versionId: string) {
  return invoke<GameRecord>("delete_version", { gameId, versionId });
}

export async function openStorePage(gameId: string, storeKey: "itch" | "steam" | "play") {
  return invoke<void>("open_store_page", { gameId, storeKey });
}

export async function getPreferredLanguage() {
  return invoke<string | null>("get_preferred_language");
}

export async function setPreferredLanguage(language: string) {
  return invoke<void>("set_preferred_language", { language });
}

export async function loadAppSettings() {
  return invoke<AppSettingsRecord>("load_app_settings");
}

export async function saveGlobalExpenses(expenses: ExpenseItem[]) {
  return invoke<void>("save_global_expenses", { expenses });
}

/** The active workspace's wallet (`<workspace>/wallet.json`, v0.9.9).
 *  `legacyAvailable` = expenses from the pre-workspace wallet that this
 *  workspace can still copy in; `migrated` = this load just adopted them. */
export type WalletLoad = {
  globalExpenses: ExpenseItem[];
  activeCurrencies: string[] | null;
  legacyAvailable: number;
  migrated: boolean;
};

/** `claimLegacy`: may this workspace adopt the old wallet? False for team
 *  folders so personal expenses never land in a shared folder. */
export async function loadWallet(claimLegacy: boolean) {
  return invoke<WalletLoad>("load_wallet", { claimLegacy });
}

/** Add or replace one general expense on disk; returns the saved list. */
export async function walletUpsertExpense(expense: ExpenseItem) {
  return invoke<ExpenseItem[]>("wallet_upsert_expense", { expense });
}

export async function walletDeleteExpense(expenseId: string) {
  return invoke<ExpenseItem[]>("wallet_delete_expense", { expenseId });
}

export async function walletSetCurrencies(currencies: string[]) {
  return invoke<void>("wallet_set_currencies", { currencies });
}

/** Copy the pre-workspace expenses into the active workspace. */
export async function importLegacyWallet() {
  return invoke<ExpenseItem[]>("import_legacy_wallet");
}

export async function saveExchangeRates(rates: Record<string, number>) {
  return invoke<void>("save_exchange_rates", { rates });
}

/** Pulls live FX from the Rust side. Rust tries multiple providers,
 *  returns "USD per CUR" so the renderer can multiply amounts directly.
 *  Throws if every source fails — callers should swallow + keep last
 *  cached rates rather than blocking the user. */
export async function fetchLiveExchangeRates() {
  return invoke<Record<string, number>>("fetch_live_exchange_rates");
}

export async function saveCurrencyLabels(label1: string, label2: string) {
  return invoke<void>("save_currency_labels", { label1, label2 });
}

export async function deleteGame(gameId: string) {
  const filtered = await applyHookFilters("game:beforeDelete", gameId);
  if (filtered === null) throw new Error(BLOCKED_MSG);
  await invoke<void>("delete_game", { gameId });
  emitHookEvent("game:afterDelete", gameId);
}

export async function saveReleaseTemplate(template: ReleaseTemplateItem[]) {
  return invoke<ReleaseTemplateItem[]>("save_release_template", { template });
}

export async function exportBackup() {
  return invoke<string>("export_backup");
}

/** Restore a backup. Pass a path to restore directly from disk (used by
 *  the BackupPage history-row "Restore" button); omit it to fall back
 *  to the OS file picker (used by Import & Export → Restore from file). */
export async function importBackup(path?: string) {
  return invoke<string>("import_backup", { path });
}

export async function exportCsvReport(csvContent: string) {
  return invoke<string>("export_csv_report", { csvContent });
}

export type FinancialExportRow = {
  date: string;
  kind: "income" | "expense";
  category: string;
  project: string;
  description: string;
  amount: number;
  currency: string;
};

export type FinancialReportPayload = {
  rangeLabel: string;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  totalIncome: number;
  totalExpense: number;
  net: number;
  baseCurrency: string;
  categoryBreakdown: { category: string; amount: number; color: string }[];
  rows: FinancialExportRow[];
  generatedAt: string;
};

export async function exportFinancialCsv(report: FinancialReportPayload) {
  return invoke<string>("export_financial_csv", { report });
}

export async function exportFinancialJson(report: FinancialReportPayload) {
  return invoke<string>("export_financial_json", { report });
}

export async function exportFinancialPdf(report: FinancialReportPayload) {
  return invoke<string>("export_financial_pdf", { report });
}

export async function revealInFolder(path: string) {
  return invoke<void>("reveal_in_folder", { path });
}

/** Reveal a build file by its workspace-relative path
 *  (`VersionItem.buildRelativePath`). Rust resolves it against the active
 *  library directory; calling `revealInFolder` with the raw relative segment
 *  would fail because Windows resolves it from the app's CWD. */
export async function revealBuildFile(relative: string) {
  return invoke<void>("reveal_build_file", { relative });
}

/** Resolve a workspace-relative build path to the absolute containing
 *  folder. Used by the Versions tab to pre-fill the Butler panel
 *  when the user clicks "Push this version with Butler". */
export async function resolveBuildFolder(relative: string) {
  return invoke<string>("resolve_build_folder", { relative });
}

// ── v0.9 M5: Storage stats + backup history ───────────────────────────

export interface StorageStats {
  totalBytes: number;
  fileCount: number;
  gamesBytes: number;
  notesBytes: number;
  moodboardBytes: number;
  backupsBytes: number;
  otherBytes: number;
}

export async function computeStorageStats(): Promise<StorageStats> {
  return invoke<StorageStats>("compute_storage_stats");
}

export interface BackupEntry {
  path: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  isAuto: boolean;
}

export async function listBackups(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>("list_backups");
}

export async function deleteBackup(path: string): Promise<void> {
  return invoke<void>("delete_backup", { path });
}

export type BackupVerifyReport = {
  ok: boolean;
  formatVersion: number;
  games: number;
  notes: number;
  files: number;
  hasWallet: boolean;
  problems: string[];
};

/** Read a backup end to end (checksums, records, paths). Changes nothing. */
export async function verifyBackup(path: string): Promise<BackupVerifyReport> {
  return invoke<BackupVerifyReport>("verify_backup", { path });
}

/** v0.9 M7 — Destructive workspace wipe. Frontend MUST gate this
 *  behind a typed-confirmation prompt. The backend does no validation
 *  of the caller's intent. */
export async function deleteAllData(): Promise<void> {
  return invoke<void>("delete_all_data");
}

/** Reveal the platform log directory in the OS file manager. */
export async function openLogDirectory(): Promise<void> {
  return invoke<void>("open_log_directory");
}

/** Thin file IO helpers — used by the v0.9 M7 export-redaction pass.
 *  The Tauri fs plugin isn't a hard dependency yet, so we route
 *  through a tiny Rust command that calls std::fs. */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}
export async function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { path, contents });
}

/** Open an http(s):// or mailto: URL in the user's default OS handler.
 *  Required because Tauri's webview blocks `window.open` for external
 *  schemes — used for "Send feedback", "View releases", store links, etc. */
export async function openExternal(url: string) {
  return invoke<void>("open_external", { url });
}

export async function exportNotesPdf(gameId: string) {
  return invoke<string>("export_notes_pdf", { gameId });
}

// ── Import / export files (Settings → Import & Export, v0.9.9) ────────
export type TextFileIn = { relative: string; contents: string; modifiedAt: string };

/** Save dialog → writes `contents`. Returns the path. */
export async function saveTextFileDialog(defaultName: string, filterName: string, extensions: string[], contents: string) {
  return invoke<string>("save_text_file_dialog", { defaultName, filterName, extensions, contents });
}

/** Writes the files into a NEW folder inside `dir` (never overwrites). */
export async function writeTextFilesToNewFolder(dir: string, folderName: string, files: { name: string; contents: string }[]) {
  return invoke<string>("write_text_files_to_new_folder", { dir, folderName, files });
}

/** Pick a folder (or a .zip with `allowZip`) and read its text files. */
export async function pickAndReadTextFiles(extensions: string[], allowZip = false, title?: string) {
  return invoke<[string, TextFileIn[]]>("pick_and_read_text_files", { extensions, allowZip, title: title ?? null });
}

export async function pickAndReadTextFile(filterName: string, extensions: string[]) {
  return invoke<TextFileIn>("pick_and_read_text_file", { filterName, extensions });
}

/** One game + its images as `<title>.heravex-game.zip` (save dialog). */
export async function exportGameBundle(gameId: string) {
  return invoke<string>("export_game_bundle", { gameId });
}

/** Add a game from a `.heravex-game.zip` as a NEW game. */
export async function importGameBundle() {
  return invoke<GameRecord>("import_game_bundle");
}

export async function getAllNotes() {
  return invoke<NoteRecord[]>("get_all_notes");
}

export async function saveNote(note: NoteRecord) {
  const filtered = await applyHookFilters("note:beforeSave", note);
  if (filtered === null) throw new Error(BLOCKED_MSG);
  const saved = await invoke<NoteRecord>("save_note", { note: filtered });
  emitHookEvent("note:afterSave", saved);
  return saved;
}

/** Read one note straight off disk (for the team-mode 3-way merge). */
export async function readNote(noteId: string) {
  return invoke<NoteRecord | null>("read_note", { noteId });
}

export async function deleteNote(noteId: string) {
  const filtered = await applyHookFilters("note:beforeDelete", noteId);
  if (filtered === null) throw new Error(BLOCKED_MSG);
  await invoke<void>("delete_note", { noteId });
  emitHookEvent("note:afterDelete", noteId);
}

// ── Flow Center (v0.9.8) ────────────────────────────────────────────
export async function loadFlows() {
  return invoke<Flow[]>("load_flows");
}

export async function saveFlow(flow: Flow) {
  return invoke<Flow>("save_flow", { flow });
}

export async function deleteFlow(flowId: string) {
  return invoke<void>("delete_flow", { flowId });
}

export async function exportGlobalNotePdf(noteId: string) {
  return invoke<string>("export_global_note_pdf", { noteId });
}

// ── Press Kit ──────────────────────────────────────────────────────────

export async function generatePressKit(
  gameId: string,
  outputDir: string,
  input: PressKitInput
) {
  return invoke<string>("generate_press_kit", { gameId, outputDir, input });
}

// ── Workspace / Cloud Sync ─────────────────────────────────────────────

// Last known workspace root, kept in sync by every get/set/clear below.
// Synchronous readers (image path remapping in lib/images.ts) use it to
// re-anchor teammate-written absolute paths without an IPC round trip.
let cachedWorkspacePath: string | null = null;

/** Synchronous snapshot of the workspace root (null = default local
 *  data dir, or not fetched yet). Refreshed by `getWorkspacePath()`,
 *  which team sync calls every poll tick. */
export function getCachedWorkspacePath(): string | null {
  return cachedWorkspacePath;
}

export async function getWorkspacePath() {
  const p = await invoke<string | null>("get_workspace_path");
  cachedWorkspacePath = p && p.trim() ? p : null;
  return p;
}

export async function setWorkspacePath(newPath: string) {
  const saved = await invoke<string>("set_workspace_path", { newPath });
  cachedWorkspacePath = saved || newPath;
  return saved;
}

export async function clearWorkspacePath() {
  await invoke<void>("clear_workspace_path");
  cachedWorkspacePath = null;
}

export async function readActivityLog() {
  return invoke<ActivityEntry[]>("read_activity_log");
}

export async function pickAndSaveAvatar() {
  return invoke<string>("pick_and_save_avatar");
}

export async function pickDirectory() {
  return invoke<string>("pick_directory");
}

export async function pickGooglePlayJson() {
  return invoke<string>("pick_google_play_json");
}

/** Settings → Studio logo: pick an image, copy it into app data.
 *  `previous` (our own copy) is deleted. Returns the new path. */
export async function pickAndSaveStudioLogo(previous: string) {
  return invoke<string>("pick_and_save_studio_logo", { previous: previous || null });
}

export async function clearStudioLogo(path: string) {
  return invoke<void>("clear_studio_logo", { path });
}

export async function clearAvatar() {
  return invoke<void>("clear_avatar");
}

export async function saveApiKeys(payload: {
  steamApiKey?: string | null;
  itchApiKey?: string | null;
  steamUserId?: string | null;
  googlePlayJsonPath?: string | null;
}) {
  return invoke<void>("save_api_keys", payload);
}

export async function saveStoreMapping(
  gameId: string,
  storeKey: StoreProvider,
  mappedId: string,
  mappedTitle: string
) {
  return invoke<GameRecord>("save_store_mapping", {
    gameId,
    storeKey,
    mappedId,
    mappedTitle,
  });
}

export async function unlinkStoreMapping(gameId: string, storeKey: StoreProvider) {
  return invoke<GameRecord>("unlink_store_mapping", { gameId, storeKey });
}

export async function fetchStoreGames(
  provider: StoreProvider,
  apiKey: string,
  userId?: string
) {
  return invoke<StoreGameInfo[]>("fetch_store_games", {
    provider,
    apiKey,
    userId: userId ?? null,
  });
}

export async function fetchStoreData(provider: StoreProvider, externalId: string) {
  return invoke<StoreData>("fetch_store_data", { provider, externalId });
}
