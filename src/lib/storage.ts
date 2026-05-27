import { invoke } from "@tauri-apps/api/core";
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

export async function createGame(input: CreateGameInput) {
  return invoke<GameRecord>("create_game", { input });
}

export async function saveGame(game: GameRecord) {
  return invoke<GameRecord>("save_game", { game });
}

export async function addVersionWithBuild(
  gameId: string,
  version: string,
  notes: string
) {
  return invoke<GameRecord>("add_version_with_build", {
    gameId,
    version,
    notes
  });
}

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

export async function saveExchangeRates(rates: Record<string, number>) {
  return invoke<void>("save_exchange_rates", { rates });
}

export async function saveCurrencyLabels(label1: string, label2: string) {
  return invoke<void>("save_currency_labels", { label1, label2 });
}

export async function deleteGame(gameId: string) {
  return invoke<void>("delete_game", { gameId });
}

export async function saveReleaseTemplate(template: ReleaseTemplateItem[]) {
  return invoke<ReleaseTemplateItem[]>("save_release_template", { template });
}

export async function exportBackup() {
  return invoke<string>("export_backup");
}

export async function importBackup() {
  return invoke<string>("import_backup");
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

/** Open an http(s):// or mailto: URL in the user's default OS handler.
 *  Required because Tauri's webview blocks `window.open` for external
 *  schemes — used for "Send feedback", "View releases", store links, etc. */
export async function openExternal(url: string) {
  return invoke<void>("open_external", { url });
}

export async function exportNotesPdf(gameId: string) {
  return invoke<string>("export_notes_pdf", { gameId });
}

export async function getAllNotes() {
  return invoke<NoteRecord[]>("get_all_notes");
}

export async function saveNote(note: NoteRecord) {
  return invoke<NoteRecord>("save_note", { note });
}

export async function deleteNote(noteId: string) {
  return invoke<void>("delete_note", { noteId });
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

export async function getWorkspacePath() {
  return invoke<string | null>("get_workspace_path");
}

export async function setWorkspacePath(newPath: string) {
  return invoke<string>("set_workspace_path", { newPath });
}

export async function clearWorkspacePath() {
  return invoke<void>("clear_workspace_path");
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
