#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreConnection {
    enabled: bool,
    external_id: String,
    label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpenseItem {
    id: String,
    title: String,
    amount: f64,
    category: String,
    spent_at: String,
    notes: String,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    is_recurring: Option<bool>,
    /// General expenses split across games. The frontend has had this
    /// since v0.9, but without the field here serde dropped it on every
    /// save, so the split vanished after a restart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shared_with_game_ids: Option<Vec<String>>,
}

// Moodboard data model (v0.8+):
//
// Pre-v0.8 stored `moodboard` as a flat array of `{ id, imageDataUrl,
// caption, createdAt }`. v0.8 introduces categories, tags, per-item
// title/description, and bidirectional links to tasks/notes. Legacy
// records are detected at load time (array vs object) and migrated
// in-place — see custom `Deserialize` for `Moodboard` below.
//
// The deprecated `caption` field is preserved (`Option<String>`,
// `skip_serializing_if = None`) so a downgrade does not erase data,
// but new code never writes to it. Slated for removal in v0.9.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoodboardItem {
    id: String,
    #[serde(default)]
    filename: String,
    /// Disk path or data URL — frontend resolves via `imgSrc()`.
    /// Migrated from legacy `imageDataUrl`.
    #[serde(default, alias = "imageDataUrl")]
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category_id: Option<String>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    linked_task_ids: Vec<String>,
    #[serde(default)]
    linked_note_ids: Vec<String>,
    created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    /// DEPRECATED: legacy caption. Kept readable for safety; never
    /// serialized once None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    caption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoodboardCategory {
    id: String,
    name: String,
    order: i32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Moodboard {
    #[serde(default)]
    categories: Vec<MoodboardCategory>,
    #[serde(default)]
    items: Vec<MoodboardItem>,
}

// Legacy record shape (pre-v0.8). Only used as an intermediate during
// `Moodboard::deserialize` when the JSON value is an array.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMoodboardItem {
    id: String,
    image_data_url: String,
    #[serde(default)]
    caption: String,
    created_at: String,
}

/// Migration: split a legacy caption into (title, description) using a
/// 60-character cap. Anything beyond goes to description. Whitespace is
/// trimmed at the split boundary so we don't leave a leading space in
/// the description.
fn split_legacy_caption(raw: &str, max_title_chars: usize) -> (String, String) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (String::new(), String::new());
    }
    // Count by chars, not bytes — captions may contain multi-byte UTF-8.
    let char_count = trimmed.chars().count();
    if char_count <= max_title_chars {
        return (trimmed.to_string(), String::new());
    }
    let split_idx = trimmed
        .char_indices()
        .nth(max_title_chars)
        .map(|(i, _)| i)
        .unwrap_or(trimmed.len());
    let title = trimmed[..split_idx].trim_end().to_string();
    let description = trimmed[split_idx..].trim_start().to_string();
    (title, description)
}

/// Estimate the byte size of an image stored as a data URL
/// (`data:<mime>;base64,<payload>`). Base64 inflates ~4/3, so payload
/// bytes ≈ length * 3/4. Returns `None` for plain disk paths (size
/// can be filled in lazily from the frontend).
fn data_url_size_bytes(s: &str) -> Option<u64> {
    if !s.starts_with("data:") {
        return None;
    }
    let comma = s.find(',')?;
    let payload_len = s.len().saturating_sub(comma + 1) as u64;
    Some(payload_len.saturating_mul(3) / 4)
}

/// Best-effort filename extraction from a path or data URL. Data URLs
/// have no inherent filename, so we synthesize one from the MIME type.
fn filename_from_path_or_dataurl(s: &str) -> String {
    if s.starts_with("data:") {
        let mime = s
            .strip_prefix("data:")
            .and_then(|rest| rest.split(';').next())
            .unwrap_or("image/png");
        let ext = mime.rsplit('/').next().unwrap_or("png");
        return format!("reference.{ext}");
    }
    // Try both separators because we're cross-platform.
    let basename = s
        .rsplit(|c: char| c == '/' || c == '\\')
        .next()
        .unwrap_or(s);
    if basename.is_empty() {
        "reference".to_string()
    } else {
        basename.to_string()
    }
}

fn migrate_legacy_moodboard_item(legacy: LegacyMoodboardItem) -> MoodboardItem {
    let (title, description) = split_legacy_caption(&legacy.caption, 60);
    let size_bytes = data_url_size_bytes(&legacy.image_data_url);
    let filename = filename_from_path_or_dataurl(&legacy.image_data_url);
    MoodboardItem {
        id: legacy.id,
        filename,
        path: legacy.image_data_url,
        category_id: None, // → Uncategorized at runtime
        title,
        description,
        tags: Vec::new(),
        linked_task_ids: Vec::new(),
        linked_note_ids: Vec::new(),
        created_at: legacy.created_at,
        width: None,
        height: None,
        size_bytes,
        caption: None, // already migrated into title/description
    }
}

/// Peek at the raw game JSON without a full parse and return true if
/// the `moodboard` field is the pre-v0.8 array shape. Used by
/// `load_games_from_disk` to decide whether to write a `.bak` before
/// the migrated record is saved back to disk.
fn is_legacy_moodboard_json(raw: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return false;
    };
    matches!(value.get("moodboard"), Some(v) if v.is_array())
}

// Custom Deserialize: accept either the legacy array shape or the new
// `{ categories, items }` object. This is what makes the migration
// transparent — every code path that touches a `GameRecord` gets the
// new shape automatically.
impl<'de> Deserialize<'de> for Moodboard {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;
        let value = serde_json::Value::deserialize(deserializer)?;
        if value.is_array() {
            // Legacy: array of LegacyMoodboardItem.
            let legacy: Vec<LegacyMoodboardItem> =
                serde_json::from_value(value).map_err(D::Error::custom)?;
            let items = legacy.into_iter().map(migrate_legacy_moodboard_item).collect();
            return Ok(Moodboard {
                categories: Vec::new(),
                items,
            });
        }
        // New shape — defer to a private helper struct so we still pick
        // up `#[serde(default)]` semantics for missing fields.
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct NewShape {
            #[serde(default)]
            categories: Vec<MoodboardCategory>,
            #[serde(default)]
            items: Vec<MoodboardItem>,
        }
        let parsed: NewShape =
            serde_json::from_value(value).map_err(D::Error::custom)?;
        Ok(Moodboard {
            categories: parsed.categories,
            items: parsed.items,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReleaseTemplateItem {
    id: String,
    title: String,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReleaseTimelineItem {
    id: String,
    title: String,
    description: String,
    done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskItem {
    id: String,
    title: String,
    description: String,
    done: bool,
    priority: u8,
    due_date: Option<String>,
    #[serde(default)]
    related_note_heading: Option<String>,
    #[serde(default)]
    time_spent_seconds: Option<u64>,
    #[serde(default)]
    running_since: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    board_column_id: Option<String>,
    /// Moodboard images linked TO this task. Mutated only via the link
    /// helper in the frontend store — see `store/index.ts` for the
    /// invariant. Loaded as `[]` for any legacy task that predates v0.8.
    #[serde(default)]
    moodboard_image_ids: Vec<String>,
    /// ISO timestamp set when the task transitions to done. Cleared
    /// when the user reopens it. Used by the dashboard's "completed
    /// this week" stat. v0.8.5 onwards; pre-existing done tasks have
    /// `None` here — we deliberately do NOT backfill from `updated_at`
    /// because that field tracks any edit, not the completion moment.
    #[serde(default)]
    completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardColumn {
    id: String,
    title: String,
    color: String,
    order: i32,
    #[serde(default)]
    is_done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionItem {
    id: String,
    version: String,
    notes: String,
    created_at: String,
    build_file_name: Option<String>,
    build_relative_path: Option<String>,
    build_file_size_bytes: Option<u64>,
    /// Set when Settings → Storage pruned this version's build file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    build_pruned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameRecord {
    id: String,
    title: String,
    summary: String,
    status: String,
    platforms: Vec<String>,
    tags: Vec<String>,
    notes: String,
    tasks: Vec<TaskItem>,
    versions: Vec<VersionItem>,
    cover_data_url: Option<String>,
    current_build_relative_path: Option<String>,
    #[serde(default)]
    expenses: Vec<ExpenseItem>,
    #[serde(default)]
    release_timeline: Vec<ReleaseTimelineItem>,
    #[serde(default)]
    moodboard: Moodboard,
    stores: GameStores,
    #[serde(default)]
    custom_links: Vec<CustomLink>,
    #[serde(default)]
    store_mappings: StoreMappings,
    updated_at: String,
    #[serde(default)]
    budget: Option<f64>,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    butler_target: Option<String>,
    #[serde(default)]
    butler_build_path: Option<String>,
    #[serde(default)]
    board_columns: Vec<BoardColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameStores {
    itch: StoreConnection,
    steam: StoreConnection,
    play: StoreConnection,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CustomLink {
    label: String,
    url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoreMappingEntry {
    id: String,
    title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoreMappings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    steam: Option<StoreMappingEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    itch: Option<StoreMappingEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    play: Option<StoreMappingEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGameInput {
    title: String,
    summary: String,
    status: String,
    platforms: Vec<String>,
    tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    preferred_language: Option<String>,
    #[serde(default)]
    global_expenses: Vec<ExpenseItem>,
    #[serde(default = "default_release_template")]
    release_template: Vec<ReleaseTemplateItem>,
    #[serde(default)]
    exchange_rates: Option<std::collections::HashMap<String, f64>>,
    #[serde(default)]
    currency_label_1: Option<String>,
    #[serde(default)]
    currency_label_2: Option<String>,
    #[serde(default)]
    steam_api_key: Option<String>,
    #[serde(default)]
    itch_api_key: Option<String>,
    #[serde(default)]
    steam_user_id: Option<String>,
    #[serde(default)]
    avatar_path: Option<String>,
    #[serde(default)]
    google_play_json_path: Option<String>,
    #[serde(default)]
    workspace_path: Option<String>,
    /// Data root that adopted the pre-workspace wallet (`global_expenses`
    /// above). `global_expenses` itself is never cleared: it stays as a
    /// read-only backup so an upgrade can't lose anyone's expenses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    legacy_wallet_claimed_by: Option<String>,
    /// Settings → Privacy: API keys live in the OS keychain.
    #[serde(default)]
    secrets_in_keychain: bool,
    /// Runtime only: the keychain was read successfully on load.
    #[serde(skip)]
    secrets_loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreGameInfo {
    id: String,
    title: String,
    cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoreData {
    wishlist: Option<u64>,
    views: Option<u64>,
    downloads: Option<u64>,
    purchases: Option<u64>,
    earnings: Option<f64>,
    currency: Option<String>,
    // ── Deep scan fields ──
    current_players: Option<u64>,
    rating_average: Option<f64>,
    rating_count: Option<u64>,
    last_news_title: Option<String>,
    last_news_url: Option<String>,
    last_news_at: Option<String>,
    active_installs: Option<u64>,
    uninstalls: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    path: String,
    contents_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupSnapshot {
    version: u8,
    exported_at: String,
    settings: AppSettings,
    games: Vec<GameRecord>,
    files: Vec<BackupFile>,
    /// Studio-wide notes (NoteCenter). Optional for backwards compatibility:
    /// backups taken before v0.3.0 won't have this field — we treat absent
    /// as empty rather than rejecting the file.
    #[serde(default)]
    notes: Vec<NoteRecord>,
    /// Workspace wallet (v0.9.9+). Older files carry it only inside
    /// settings.global_expenses; the restore handles both.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wallet: Option<WalletFile>,
}

fn default_release_template() -> Vec<ReleaseTemplateItem> {
    vec![
        ReleaseTemplateItem {
            id: "capsule-art".into(),
            title: "Capsule art".into(),
            description: "Prepare capsule sizes and export final store art.".into(),
        },
        ReleaseTemplateItem {
            id: "store-copy".into(),
            title: "Store copy".into(),
            description: "Finalize the short and long store descriptions.".into(),
        },
        ReleaseTemplateItem {
            id: "screenshots".into(),
            title: "Screenshots".into(),
            description: "Capture and select store screenshots.".into(),
        },
        ReleaseTemplateItem {
            id: "trailer".into(),
            title: "Trailer".into(),
            description: "Upload trailer and verify embeds.".into(),
        },
        ReleaseTemplateItem {
            id: "build-upload".into(),
            title: "Release build".into(),
            description: "Upload and test the release candidate build.".into(),
        },
        ReleaseTemplateItem {
            id: "qa-pass".into(),
            title: "Final QA".into(),
            description: "Run the final launch checklist and smoke tests.".into(),
        },
    ]
}

// Kept for test coverage of the legacy auto-apply mapping even though
// v0.8.5 stopped seeding new games from the global template. Removing
// the function would lose the regression test for the data shape.
#[allow(dead_code)]
fn timeline_from_template(template: &[ReleaseTemplateItem]) -> Vec<ReleaseTimelineItem> {
    template
        .iter()
        .map(|item| ReleaseTimelineItem {
            id: item.id.clone(),
            title: item.title.clone(),
            description: item.description.clone(),
            done: false,
        })
        .collect()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("App data klasoru alinamadi: {err}"))?;
    let root = base.join("studio-data");
    fs::create_dir_all(root.join("library")).map_err(|err| err.to_string())?;
    Ok(root)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    // Settings always live in the app-local studio-data folder; workspace path is
    // stored *inside* settings, so we need a stable bootstrap location.
    Ok(root_dir(app)?.join("settings.json"))
}

/// Returns the active data root. If a workspace_path is configured (and exists),
/// games.json / notes.json / library/ live there; otherwise everything stays
/// under the default app-local studio-data folder.
fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings_p = settings_path(app)?;
    if settings_p.exists() {
        if let Ok(raw) = fs::read_to_string(&settings_p) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&raw) {
                if let Some(p) = settings.workspace_path.as_ref().filter(|s| !s.trim().is_empty()) {
                    let path = PathBuf::from(p);
                    if path.exists() && path.is_dir() {
                        // Make sure the library subdir exists too
                        let _ = fs::create_dir_all(path.join("library"));
                        return Ok(path);
                    }
                }
            }
        }
    }
    root_dir(app)
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("games.json"))
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("library"))
}

fn notes_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("notes.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteRecord {
    id: String,
    title: String,
    content: String,
    updated_at: String,
    #[serde(default)]
    category: Option<String>,
    /// Moodboard images linked to this note. See `MoodboardItem.linked_note_ids`
    /// for the other side of the relation — both arrays are kept in sync
    /// by a single store helper.
    #[serde(default)]
    moodboard_image_ids: Vec<String>,
    /// User-controlled display order in the Studio sidebar. Set by the
    /// `reorderNotes` store action when a note is dragged. Pre-v0.9
    /// records load with `0`; ties break on `updatedAt` desc so the
    /// list stays meaningful before the user has ever reordered.
    #[serde(default)]
    order: i32,
}

/// Flow Center document (v0.9.8). One graph per file under
/// `workspace/flows/{id}.json`, the atomic unit for save / .bak /
/// team-sync — exactly like a note or game.
///
/// Rust treats the graph body (nodes, edges, viewport, …) as an opaque
/// passthrough: only `id` (filename + identity), `name`, and
/// `updated_at` (server stamp) are read here. Everything else is
/// captured by `#[serde(flatten)]` and round-tripped untouched, so the
/// frontend owns the schema and Rust never drops a field it doesn't
/// know about.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Flow {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    updated_at: String,
    #[serde(flatten)]
    rest: serde_json::Map<String, serde_json::Value>,
}

// ═══ Atomic per-id storage ═══════════════════════════════════════════════
//
// Each game lives in workspace/games/{id}.json and each note in
// workspace/notes/{id}.json. Saving one record only rewrites its own file —
// minimising Dropbox/Drive merge conflicts. A legacy monolithic games.json /
// notes.json will be migrated on first read.

fn games_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_root(app)?.join("games");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_root(app)?.join("notes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn flows_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_root(app)?.join("flows");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_id_filename(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        next_id()
    } else {
        cleaned
    }
}

/// Snapshot the file at `path` into a sibling `.bak` BEFORE writing
/// the new payload. Closes the corruption window in the v0.9.7
/// review: if a power cut or disk-full event truncates the live
/// file, the loader can fall back to `.bak` and survive. Single-deep
/// backup ring — the previous `.bak` is overwritten on every save,
/// keeping disk overhead bounded.
fn snapshot_before_write(path: &PathBuf) {
    if !path.exists() { return; }
    let bak = path.with_extension("json.bak");
    let _ = fs::copy(path, &bak);
}

fn save_single_game_to_disk(app: &AppHandle, game: &GameRecord) -> Result<(), String> {
    let path = games_dir(app)?.join(format!("{}.json", safe_id_filename(&game.id)));
    snapshot_before_write(&path);
    let payload = serde_json::to_string_pretty(game).map_err(|e| e.to_string())?;
    atomic_write(&path, payload.as_bytes())?;
    notify_windows(app, "games", vec![game.id.clone()]);
    Ok(())
}

fn save_single_note_to_disk(app: &AppHandle, note: &NoteRecord) -> Result<(), String> {
    let path = notes_dir(app)?.join(format!("{}.json", safe_id_filename(&note.id)));
    snapshot_before_write(&path);
    let payload = serde_json::to_string_pretty(note).map_err(|e| e.to_string())?;
    atomic_write(&path, payload.as_bytes())?;
    notify_windows(app, "notes", vec![note.id.clone()]);
    Ok(())
}

fn migrate_legacy_games(app: &AppHandle) -> Result<Option<Vec<GameRecord>>, String> {
    let legacy = db_path(app)?;
    if !legacy.exists() { return Ok(None); }
    let raw = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
    let parsed: Vec<GameRecord> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    for g in &parsed { let _ = save_single_game_to_disk(app, g); }
    // Rename legacy file as backup (don't delete in case migration goes wrong)
    let backup = data_root(app)?.join("games.legacy.json");
    let _ = fs::rename(&legacy, &backup);
    Ok(Some(parsed))
}

fn migrate_legacy_notes(app: &AppHandle) -> Result<Option<Vec<NoteRecord>>, String> {
    let legacy = notes_path(app)?;
    if !legacy.exists() { return Ok(None); }
    let raw = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
    let parsed: Vec<NoteRecord> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    for n in &parsed { let _ = save_single_note_to_disk(app, n); }
    let backup = data_root(app)?.join("notes.legacy.json");
    let _ = fs::rename(&legacy, &backup);
    Ok(Some(parsed))
}

/// Strict loader for read-modify-write paths: fails if ANY game file
/// could not be read, because the follow-up `save_games_to_disk` would
/// otherwise delete it as an "orphan".
fn load_games_from_disk(app: &AppHandle) -> Result<Vec<GameRecord>, String> {
    let (games, unreadable) = scan_games_from_disk(app)?;
    if !unreadable.is_empty() {
        return Err(unreadable_error("Oyun", &unreadable));
    }
    Ok(games)
}

/// Load every game file, returning the records plus the names of files
/// that could not be read (I/O error or cloud-drive stall). Only the UI
/// listing (`load_games`) may use a partial result.
fn scan_games_from_disk(app: &AppHandle) -> Result<(Vec<GameRecord>, Vec<String>), String> {
    let dir = games_dir(app)?;
    let mut games: Vec<GameRecord> = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        match read_text_guarded(&path) {
            Ok(raw) => {
                // Pre-check for legacy moodboard format (array instead of
                // { categories, items }). Custom `Deserialize` for
                // `Moodboard` accepts both shapes transparently, but we
                // need to know *before* parsing whether to take a `.bak`
                // and rewrite the file in the new shape.
                let needs_moodboard_migration = is_legacy_moodboard_json(&raw);
                if needs_moodboard_migration {
                    // Best-effort backup — never block the load if it
                    // fails (e.g. read-only mount). The original file
                    // stays in place until the migrated write succeeds.
                    let bak = path.with_extension("json.bak");
                    if let Err(e) = fs::copy(&path, &bak) {
                        println!(
                            "[load_games] could not write .bak for {}: {e}",
                            path.display()
                        );
                    }
                }

                match parse_json_settled::<GameRecord>(&path, raw) {
                    Ok(game) => {
                        if needs_moodboard_migration {
                            // Migration already happened inside
                            // `Moodboard::deserialize`. Persist the new
                            // shape so subsequent loads are cheap.
                            if let Err(e) = save_single_game_to_disk(app, &game) {
                                println!(
                                    "[load_games] migration save failed for {}: {e}",
                                    path.display()
                                );
                            }
                        }
                        games.push(game);
                    }
                    Err(parse_err) => {
                        // v0.9.7 resilience pass — corruption recovery.
                        // The live file is half-written (power cut /
                        // disk full / cloud sync truncation). Don't
                        // silently drop the game: rename the bad copy
                        // to `.corrupt` so it isn't re-overwritten on
                        // the next save, then try `.bak` (snapshot
                        // taken before every write).
                        let corrupt = path.with_extension("json.corrupt");
                        let _ = fs::rename(&path, &corrupt);
                        let bak = path.with_extension("json.bak");
                        if bak.exists() {
                            if let Ok(bak_raw) = read_text_guarded(&bak) {
                                if let Ok(game) = serde_json::from_str::<GameRecord>(&bak_raw) {
                                    let _ = fs::copy(&bak, &path);
                                    println!(
                                        "[load_games] RECOVERY from .bak for {} — parse err was: {parse_err}",
                                        path.display()
                                    );
                                    games.push(game);
                                    continue;
                                }
                            }
                        }
                        // No usable backup. Log loudly so the user can
                        // investigate the `.corrupt` file by hand. The
                        // load continues with whatever remains so a
                        // single bad file doesn't take the whole
                        // workspace down.
                        eprintln!(
                            "[load_games] CORRUPT (no usable .bak): {} → {} ; original error: {parse_err}",
                            path.display(),
                            corrupt.display()
                        );
                    }
                }
            }
            Err(ReadFail::Io(e)) => {
                println!("[load_games] read err {}: {e}", path.display());
                unreadable.push(file_label(&path));
            }
            Err(ReadFail::TimedOut) => unreadable.push(file_label(&path)),
        }
    }

    if games.is_empty() && unreadable.is_empty() {
        if let Ok(Some(migrated)) = migrate_legacy_games(app) {
            return Ok((migrated, unreadable));
        }
    }

    // Stable order: most recently updated first
    games.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok((games, unreadable))
}

fn save_games_to_disk(app: &AppHandle, games: &[GameRecord]) -> Result<(), String> {
    let dir = games_dir(app)?;
    let mut keep: std::collections::HashSet<String> = std::collections::HashSet::new();
    for game in games {
        save_single_game_to_disk(app, game)?;
        keep.insert(format!("{}.json", safe_id_filename(&game.id)));
    }
    // Cleanup orphans (deleted records)
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.ends_with(".json") && !keep.contains(&fname) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

/// Strict loader for read-modify-write paths (see `load_games_from_disk`).
fn load_notes_from_disk(app: &AppHandle) -> Result<Vec<NoteRecord>, String> {
    let (notes, unreadable) = scan_notes_from_disk(app)?;
    if !unreadable.is_empty() {
        return Err(unreadable_error("Not", &unreadable));
    }
    Ok(notes)
}

fn scan_notes_from_disk(app: &AppHandle) -> Result<(Vec<NoteRecord>, Vec<String>), String> {
    let dir = notes_dir(app)?;
    let mut notes: Vec<NoteRecord> = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        let raw = match read_text_guarded(&path) {
            Ok(r) => r,
            Err(_) => {
                unreadable.push(file_label(&path));
                continue;
            }
        };
        match parse_json_settled::<NoteRecord>(&path, raw) {
            Ok(n) => notes.push(n),
            Err(parse_err) => {
                // v0.9.7 resilience pass — same recovery flow as
                // load_games_from_disk. Bad live file → .corrupt;
                // try .bak; if neither works, log + skip rather
                // than silently dropping the note from the list.
                let corrupt = path.with_extension("json.corrupt");
                let _ = fs::rename(&path, &corrupt);
                let bak = path.with_extension("json.bak");
                if bak.exists() {
                    if let Ok(bak_raw) = read_text_guarded(&bak) {
                        if let Ok(n) = serde_json::from_str::<NoteRecord>(&bak_raw) {
                            let _ = fs::copy(&bak, &path);
                            println!(
                                "[load_notes] RECOVERY from .bak for {} — parse err was: {parse_err}",
                                path.display()
                            );
                            notes.push(n);
                            continue;
                        }
                    }
                }
                eprintln!(
                    "[load_notes] CORRUPT (no usable .bak): {} → {} ; original error: {parse_err}",
                    path.display(),
                    corrupt.display()
                );
            }
        }
    }
    if notes.is_empty() && unreadable.is_empty() {
        if let Ok(Some(migrated)) = migrate_legacy_notes(app) {
            return Ok((migrated, unreadable));
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok((notes, unreadable))
}

fn save_notes_to_disk(app: &AppHandle, notes: &[NoteRecord]) -> Result<(), String> {
    let dir = notes_dir(app)?;
    let mut keep: std::collections::HashSet<String> = std::collections::HashSet::new();
    for n in notes {
        save_single_note_to_disk(app, n)?;
        keep.insert(format!("{}.json", safe_id_filename(&n.id)));
    }
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.ends_with(".json") && !keep.contains(&fname) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

// ═══ Activity log ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEntry {
    timestamp: String,
    user: String,
    action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target: Option<String>,
}

fn activity_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("activity.json"))
}

fn current_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "local".into())
}

fn append_activity(app: &AppHandle, action: &str, target: Option<String>) {
    let _activity = ACTIVITY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = match activity_log_path(app) {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut log: Vec<ActivityEntry> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    log.push(ActivityEntry {
        timestamp: now_iso(),
        user: current_user(),
        action: action.to_string(),
        target,
    });
    // Trim to last 500 entries to keep the file size bounded
    if log.len() > 500 {
        let cut = log.len() - 500;
        log = log.split_off(cut);
    }
    if let Ok(payload) = serde_json::to_string_pretty(&log) {
        let _ = atomic_write(&path, payload.as_bytes());
    }
}

#[tauri::command(async)]
fn read_activity_log(app: AppHandle) -> Result<Vec<ActivityEntry>, String> {
    let path = activity_log_path(&app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn load_settings_from_disk(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings {
            preferred_language: None,
            global_expenses: Vec::new(),
            release_template: default_release_template(),
            exchange_rates: None,
            currency_label_1: None,
            currency_label_2: None,
            steam_api_key: None,
            itch_api_key: None,
            steam_user_id: None,
            avatar_path: None,
            google_play_json_path: None,
            workspace_path: None,
            legacy_wallet_claimed_by: None,
            secrets_in_keychain: false,
            secrets_loaded: false,
        });
    }

    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut settings: AppSettings = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    fill_secrets(&mut settings);
    Ok(settings)
}

fn save_settings_to_disk(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let on_disk = strip_secrets(settings)?;
    let payload = serde_json::to_string_pretty(&on_disk).map_err(|err| err.to_string())?;
    atomic_write(&path, payload.as_bytes())
}

// ── OS keychain for API keys (v0.9.9, Settings → Privacy) ───────────────────
//
// With `secrets_in_keychain` on, the Steam / Itch API keys live in the OS
// credential store instead of settings.json (so they're also not in
// backups). `load_settings_from_disk` fills them back in and
// `save_settings_to_disk` moves them out again, so no caller changes.
// If the keychain can't be read, `secrets_loaded` stays false and a
// save never deletes what the keychain holds.

const KEYCHAIN_SERVICE: &str = "HeraVex";
const SECRET_STEAM: &str = "steam_api_key";
const SECRET_ITCH: &str = "itch_api_key";

#[cfg(any(windows, target_os = "macos"))]
mod os_secrets {
    pub fn supported() -> bool { true }
    pub fn get(name: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(super::KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn set(name: &str, value: Option<&str>) -> Result<(), String> {
        let entry = keyring::Entry::new(super::KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())?;
        match value {
            Some(v) => entry.set_password(v).map_err(|e| e.to_string()),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod os_secrets {
    pub fn supported() -> bool { false }
    pub fn get(_name: &str) -> Result<Option<String>, String> { Ok(None) }
    pub fn set(_name: &str, _value: Option<&str>) -> Result<(), String> {
        Err("Bu sistemde anahtar zinciri desteklenmiyor.".into())
    }
}

/// Fill the keychain-held secrets into freshly parsed settings.
fn fill_secrets(settings: &mut AppSettings) {
    if !settings.secrets_in_keychain {
        return;
    }
    let steam = os_secrets::get(SECRET_STEAM);
    let itch = os_secrets::get(SECRET_ITCH);
    match (steam, itch) {
        (Ok(s), Ok(i)) => {
            if settings.steam_api_key.is_none() { settings.steam_api_key = s; }
            if settings.itch_api_key.is_none() { settings.itch_api_key = i; }
            settings.secrets_loaded = true;
        }
        (s, i) => {
            eprintln!("[keychain] read failed: {:?} {:?}", s.err(), i.err());
        }
    }
}

/// Move secrets into the keychain before settings.json is written.
/// Returns the copy to write (without secrets).
fn strip_secrets(settings: &AppSettings) -> Result<AppSettings, String> {
    let mut out = settings.clone();
    if !settings.secrets_in_keychain {
        return Ok(out);
    }
    for (name, value) in [(SECRET_STEAM, settings.steam_api_key.as_deref()), (SECRET_ITCH, settings.itch_api_key.as_deref())] {
        match value {
            // Skip the write when the keychain already holds this value.
            Some(v) => {
                if os_secrets::get(name).ok().flatten().as_deref() != Some(v) {
                    os_secrets::set(name, Some(v))?;
                }
            }
            // Only a successful load proves the user cleared the key;
            // otherwise None just means "couldn't read it".
            None if settings.secrets_loaded => os_secrets::set(name, None)?,
            None => {}
        }
    }
    out.steam_api_key = None;
    out.itch_api_key = None;
    Ok(out)
}

/// Keys kept in the keychain stay out of backups too.
fn settings_for_backup(mut s: AppSettings) -> AppSettings {
    if s.secrets_in_keychain {
        s.steam_api_key = None;
        s.itch_api_key = None;
    }
    s
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeychainStatus {
    supported: bool,
    enabled: bool,
}

#[tauri::command]
fn keychain_status(app: AppHandle) -> Result<KeychainStatus, String> {
    let settings = load_settings_from_disk(&app)?;
    Ok(KeychainStatus { supported: os_secrets::supported(), enabled: settings.secrets_in_keychain })
}

#[tauri::command]
fn set_secrets_in_keychain(app: AppHandle, enabled: bool) -> Result<KeychainStatus, String> {
    if enabled && !os_secrets::supported() {
        return Err("Bu sistemde anahtar zinciri desteklenmiyor.".into());
    }
    let mut settings = load_settings_from_disk(&app)?;
    if settings.secrets_in_keychain == enabled {
        return Ok(KeychainStatus { supported: os_secrets::supported(), enabled });
    }
    if enabled {
        let steam = settings.steam_api_key.clone();
        let itch = settings.itch_api_key.clone();
        settings.secrets_in_keychain = true;
        settings.secrets_loaded = true;
        save_settings_to_disk(&app, &settings)?;
        // Read back; on any mismatch put the keys back in the file.
        let ok = os_secrets::get(SECRET_STEAM).ok() == Some(steam.clone())
            && os_secrets::get(SECRET_ITCH).ok() == Some(itch.clone());
        if !ok {
            settings.secrets_in_keychain = false;
            settings.steam_api_key = steam;
            settings.itch_api_key = itch;
            save_settings_to_disk(&app, &settings)?;
            return Err("Anahtarlar anahtar zincirine yazilamadi; dosyada birakildi.".into());
        }
    } else {
        if settings.secrets_in_keychain && !settings.secrets_loaded {
            return Err("Anahtar zinciri okunamadi; anahtarlar kaybolmasin diye ayar degistirilmedi.".into());
        }
        settings.secrets_in_keychain = false;
        save_settings_to_disk(&app, &settings)?; // keys back into the file
        let _ = os_secrets::set(SECRET_STEAM, None);
        let _ = os_secrets::set(SECRET_ITCH, None);
    }
    Ok(KeychainStatus { supported: os_secrets::supported(), enabled })
}


/// Team-mode responsiveness fix: the workspace commands used to be plain
/// `#[tauri::command]`, which Tauri runs ON THE MAIN THREAD. On a
/// cloud-synced folder (Google Drive / OneDrive virtual drives) a single
/// read can stall for hundreds of ms and `atomic_write` sleeps through
/// lock retries — every one of those froze the window, which users felt
/// as "typing stutters". Those commands now run on the async runtime.
///
/// Running on the main thread also gave us free serialization (no two
/// commands could interleave a read-modify-write of the same game file).
/// This process-wide lock preserves exactly that guarantee off the main
/// thread. No command calls another command, so it is never re-entered.
/// A poisoned lock (panic in a previous holder) is recovered, not fatal.
static IO_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn io_lock() -> std::sync::MutexGuard<'static, ()> {
    IO_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// `activity.json` is a shared read-modify-write file appended from many
/// commands; it gets its own lock so concurrent appends don't drop rows.
static ACTIVITY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Image paths (covers, moodboard) are stored as ABSOLUTE paths, so a
/// path written by a teammate points into THEIR machine's sync folder
/// (`C:\Users\ali\Google Drive\HeraVex\library\...`). Re-anchor any
/// `.../library/<game>/...` path onto this machine's workspace root when
/// the original doesn't exist here. Mirrors `remapWorkspaceAsset` in
/// `src/lib/images.ts`.
fn resolve_workspace_asset(app: &AppHandle, raw: &str) -> PathBuf {
    let original = PathBuf::from(raw);
    if original.is_absolute() && original.exists() {
        return original;
    }
    let norm = raw.replace('\\', "/");
    let tail = if norm.starts_with("library/") {
        Some(norm.clone())
    } else {
        norm.rfind("/library/").map(|i| norm[i + 1..].to_string())
    };
    if let (Some(tail), Ok(root)) = (tail, data_root(app)) {
        let mut candidate = root.clone();
        for seg in tail.split('/').filter(|s| !s.is_empty() && *s != "..") {
            candidate.push(seg);
        }
        if candidate.exists() {
            return candidate;
        }
    }
    original
}

/// Cloud-drive read guard. A virtual-drive client (Google Drive for
/// desktop, OneDrive Files-On-Demand) can block `read` FOREVER when it
/// cannot fetch a file's content — the directory lists fine, but opening
/// one file never returns. Seen in the field: the whole app sat on the
/// "Preparing HeraVex" screen because the first game file never loaded.
///
/// Reads therefore run on a helper thread with a deadline. On timeout the
/// helper thread is abandoned (it stays parked in the OS call; nothing we
/// can do about that) and the caller gets `ReadFail::TimedOut`. After one
/// stall the deadline drops sharply for the next minute so a stuck drive
/// costs seconds, not minutes, across many files.
enum ReadFail {
    Io(String),
    TimedOut,
}

static LAST_READ_STALL_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Paths whose abandoned read thread is still parked in the OS. A new
/// read of the same path fails fast instead of parking another thread,
/// so a stuck drive + the 30s heartbeat can't leak threads forever. The
/// reader removes its path once the OS call finally returns.
static STALLED_READS: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_text_guarded(path: &Path) -> Result<String, ReadFail> {
    use std::sync::atomic::{AtomicBool, Ordering};
    let recently_stalled = now_ms().saturating_sub(LAST_READ_STALL_MS.load(Ordering::Relaxed)) < 60_000;
    let deadline = std::time::Duration::from_millis(if recently_stalled { 1_500 } else { 12_000 });
    let owned = path.to_path_buf();
    {
        let stalled = STALLED_READS.lock().unwrap_or_else(|e| e.into_inner());
        if stalled.iter().any(|p| p == &owned) {
            return Err(ReadFail::TimedOut);
        }
    }
    // `done` and the stall marker are only touched under STALLED_READS,
    // so "reader finished" and "caller gave up" can't interleave badly:
    // either the reader clears the marker after the caller set it, or the
    // caller sees `done` and never sets it.
    let done = std::sync::Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel();
    let thread_path = owned.clone();
    let thread_done = done.clone();
    let spawned = std::thread::Builder::new()
        .name("hv-read".into())
        .spawn(move || {
            let res = fs::read_to_string(&thread_path);
            {
                let mut stalled = STALLED_READS.lock().unwrap_or_else(|e| e.into_inner());
                thread_done.store(true, Ordering::SeqCst);
                stalled.retain(|p| p != &thread_path);
            }
            let _ = tx.send(res);
        });
    if spawned.is_err() {
        // Couldn't spawn (resource exhaustion) — fall back to a plain read.
        return fs::read_to_string(path).map_err(|e| ReadFail::Io(e.to_string()));
    }
    match rx.recv_timeout(deadline) {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(ReadFail::Io(e.to_string())),
        Err(_) => {
            {
                let mut stalled = STALLED_READS.lock().unwrap_or_else(|e| e.into_inner());
                if !done.load(Ordering::SeqCst) && !stalled.iter().any(|p| p == &owned) {
                    stalled.push(owned.clone());
                }
            }
            // The read may have finished in the gap; use it if so.
            if let Ok(res) = rx.try_recv() {
                return res.map_err(|e| ReadFail::Io(e.to_string()));
            }
            LAST_READ_STALL_MS.store(now_ms(), Ordering::Relaxed);
            eprintln!("[read] TIMED OUT after {:?}: {}", deadline, path.display());
            Err(ReadFail::TimedOut)
        }
    }
}

fn file_label(path: &Path) -> String {
    path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string()
}

/// Turn a list of unreadable record files into the error a WRITE path
/// returns. Bulk writers (`save_games_to_disk`, `save_notes_to_disk`)
/// delete every file not in the list they were handed, so writing after a
/// partial load would DELETE the records we failed to read. Refuse instead.
fn unreadable_error(kind: &str, files: &[String]) -> String {
    format!(
        "{kind} dosyalari okunamadi (bulut esitleme istemcisi yanit vermiyor): {}. \
         Veri kaybini onlemek icin islem durduruldu. Google Drive / OneDrive'i yeniden baslatip tekrar dene.",
        files.join(", ")
    )
}

/// Parse a JSON record, re-reading once after a short pause when the
/// first parse fails. Cloud clients replace files in place while
/// downloading, so a read can catch a half-written file; treating that
/// as corruption would rename the live file and push an OLD `.bak` to
/// the whole team. Only a file that is still unparsable after the
/// pause goes through the corruption-recovery path.
fn parse_json_settled<T: serde::de::DeserializeOwned>(path: &Path, raw: String) -> Result<T, serde_json::Error> {
    match serde_json::from_str::<T>(&raw) {
        Ok(v) => Ok(v),
        Err(first_err) => {
            std::thread::sleep(std::time::Duration::from_millis(400));
            match read_text_guarded(path) {
                Ok(again) => serde_json::from_str::<T>(&again),
                Err(_) => Err(first_err),
            }
        }
    }
}

/// Process-wide counter for unique `.tmp` suffixes — combined with
/// the PID it guarantees that two concurrent `atomic_write` calls
/// (different threads OR different Tauri instances pointed at the
/// same workspace folder) don't collide on the temp file. The old
/// version always used `path.tmp` which let one writer's rename
/// pick up the other writer's half-flushed data.
static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn atomic_write(path: &PathBuf, data: &[u8]) -> Result<(), String> {
    let n = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id();
    let tmp = path.with_file_name(format!(
        "{}.{}.{}.tmp",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("hv"),
        pid,
        n,
    ));
    // v0.9.7 resilience pass — jittered retry for cloud-sync lock
    // windows. OneDrive / Dropbox briefly grab exclusive handles on
    // every save (typical 200–500ms). Without retry the first attempt
    // hits `ERROR_SHARING_VIOLATION` (kind: PermissionDenied) on
    // Windows or EBUSY on macOS, surfaces as "save failed" toast, and
    // the user loses the in-memory diff. Three attempts with 100ms /
    // 200ms / 400ms base + small per-call jitter so two clients in
    // the same workspace don't beat-frequency collide.
    let max_attempts = 3u32;
    for attempt in 0..max_attempts {
        let write_res = fs::write(&tmp, data);
        match write_res {
            Ok(_) => {}
            Err(e) if attempt + 1 < max_attempts
                && matches!(e.kind(), std::io::ErrorKind::PermissionDenied
                                    | std::io::ErrorKind::WouldBlock) =>
            {
                let base_ms = 100u64 * (1u64 << attempt);
                let jitter = (pid as u64 ^ n) % 50;
                std::thread::sleep(std::time::Duration::from_millis(base_ms + jitter));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        }
        // Best-effort cleanup: if rename fails partway through, leave
        // the tmp on disk for inspection rather than leaking silently.
        match fs::rename(&tmp, path) {
            Ok(_) => return Ok(()),
            Err(e) if attempt + 1 < max_attempts
                && matches!(e.kind(), std::io::ErrorKind::PermissionDenied
                                    | std::io::ErrorKind::WouldBlock) =>
            {
                let base_ms = 100u64 * (1u64 << attempt);
                let jitter = (pid as u64 ^ n) % 50;
                std::thread::sleep(std::time::Duration::from_millis(base_ms + jitter));
                continue;
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e.to_string());
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err("atomic_write: maksimum deneme sayisina ulasildi (dosya kilitli olabilir)".into())
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn next_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
}

fn game_folder_name(game: &GameRecord) -> String {
    format!("{}-{}", slugify(&game.title), game.id)
}

fn game_folder(app: &AppHandle, game: &GameRecord) -> Result<PathBuf, String> {
    Ok(library_dir(app)?.join(game_folder_name(game)))
}

fn collect_backup_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<BackupFile>,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(current).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            collect_backup_files(root, &path, output)?;
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|err| err.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = fs::read(&path).map_err(|err| err.to_string())?;

        output.push(BackupFile {
            path: relative,
            contents_base64: general_purpose::STANDARD.encode(bytes),
        });
    }

    Ok(())
}

fn validate_relative_backup_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        return Err("Yedek icinde gecersiz mutlak dosya yolu var.".into());
    }

    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err("Yedek icinde guvensiz dosya yolu bulundu.".into());
    }

    Ok(candidate)
}

#[tauri::command(async)]
fn load_games(app: AppHandle) -> Result<Vec<GameRecord>, String> {
    let _io = io_lock();
    // UI listing may show a partial library: better than an app that
    // never opens. The skipped files are reported so the shell can warn;
    // every WRITE path still uses the strict loader.
    let (games, unreadable) = scan_games_from_disk(&app)?;
    if !unreadable.is_empty() {
        let _ = app.emit("workspace-read-stalled", unreadable);
    }
    Ok(games)
}

/// Team-mode targeted reload: read only the game files a teammate just
/// changed instead of re-reading the whole library on every sync tick.
/// Ids whose file is missing are simply absent from the result; the
/// frontend falls back to a full reload in that case.
#[tauri::command(async)]
fn load_games_by_ids(app: AppHandle, ids: Vec<String>) -> Result<Vec<GameRecord>, String> {
    let _io = io_lock();
    let dir = games_dir(&app)?;
    let mut out = Vec::new();
    for id in ids {
        let path = dir.join(format!("{}.json", safe_id_filename(&id)));
        let raw = match read_text_guarded(&path) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if let Ok(game) = parse_json_settled::<GameRecord>(&path, raw) {
            out.push(game);
        }
    }
    Ok(out)
}

#[tauri::command(async)]
fn create_game(app: AppHandle, input: CreateGameInput) -> Result<GameRecord, String> {
    let _io = io_lock();
    if input.title.trim().is_empty() {
        return Err("Oyun basligi bos olamaz.".into());
    }

    let mut games = load_games_from_disk(&app)?;
    let game = GameRecord {
        id: next_id(),
        title: input.title.trim().to_string(),
        summary: input.summary.trim().to_string(),
        status: input.status,
        platforms: input.platforms,
        tags: input.tags,
        notes: String::new(),
        tasks: Vec::new(),
        versions: Vec::new(),
        cover_data_url: None,
        current_build_relative_path: None,
        expenses: Vec::new(),
        // v0.8.5 — new games start with an EMPTY release timeline.
        // Prior versions auto-applied the global checklist template on
        // creation, which was opt-OUT (the user had to clear a template
        // they never asked for). The ReleaseTab CTA now offers "Apply
        // template" and "Write from scratch" so the choice is explicit.
        release_timeline: Vec::new(),
        moodboard: Moodboard::default(),
        stores: GameStores {
            itch: StoreConnection {
                enabled: false,
                external_id: String::new(),
                label: "itch.io".into(),
            },
            steam: StoreConnection {
                enabled: false,
                external_id: String::new(),
                label: "Steam".into(),
            },
            play: StoreConnection {
                enabled: false,
                external_id: String::new(),
                label: "Play Store".into(),
            },
        },
        custom_links: Vec::new(),
        store_mappings: StoreMappings::default(),
        updated_at: now_iso(),
        budget: None,
        currency: Some("USD".to_string()),
        butler_target: None,
        butler_build_path: None,
        // Board columns are injected on the frontend during ensureBoardColumns()
        // so we keep this empty here — single source of truth for column
        // defaults lives in src/lib/boardColumns.ts.
        board_columns: Vec::new(),
    };

    let folder = game_folder(&app, &game)?;
    fs::create_dir_all(folder.join("versions")).map_err(|err| err.to_string())?;
    fs::create_dir_all(folder.join("assets")).map_err(|err| err.to_string())?;

    games.insert(0, game.clone());
    save_games_to_disk(&app, &games)?;
    append_activity(&app, "game.created", Some(game.title.clone()));
    Ok(game)
}

/// Per-process write lock for `save_game` / `save_notes` /
/// `save_global_expenses` / `save_settings` etc.
///
/// Closes the TOCTOU window from v0.9.7 review: two requests entering
/// `save_game` simultaneously both called `load_games_from_disk`
/// (seeing the same state), then both serialised their copy back —
/// last writer silently lost the other's diff. Per-process Mutex
/// serialises the load → modify → write sequence so each transaction
/// is atomic from the in-process perspective.
///
/// Cross-process atomicity (two Tauri instances against the same
/// cloud folder) still relies on the cloud client's last-writer-wins
/// merge. A future hardened version would optimistic-CAS against
/// games.json's mtime; the granular team-sync orchestrator already
/// limits the blast radius because conflicting writes touch separate
/// files for separate concerns (notes vs games vs members).
static WORKSPACE_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command(async)]
fn save_game(app: AppHandle, mut game: GameRecord) -> Result<GameRecord, String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let mut games = load_games_from_disk(&app)?;
    game.updated_at = now_iso();

    if let Some(index) = games.iter().position(|item| item.id == game.id) {
        let old_game = games[index].clone();
        games[index] = game.clone();

        let old_folder = game_folder(&app, &old_game)?;
        let new_folder = game_folder(&app, &game)?;
        if old_folder != new_folder && old_folder.exists() {
            fs::rename(old_folder, new_folder).map_err(|err| err.to_string())?;
        }
    } else {
        let folder = game_folder(&app, &game)?;
        fs::create_dir_all(folder.join("versions")).map_err(|err| err.to_string())?;
        fs::create_dir_all(folder.join("assets")).map_err(|err| err.to_string())?;
        games.push(game.clone());
    }

    save_games_to_disk(&app, &games)?;
    Ok(game)
}

#[tauri::command]
fn add_version_with_build(
    app: AppHandle,
    game_id: String,
    version: String,
    notes: String,
    keep_builds: Option<u32>,
) -> Result<GameRecord, String> {
    if version.trim().is_empty() {
        return Err("Surum bos olamaz.".into());
    }

    let selected_file = FileDialog::new()
        .set_title("Build dosyasini sec")
        .pick_file()
        .ok_or_else(|| "Build secimi iptal edildi.".to_string())?;

    let _io = io_lock();
    let mut games = load_games_from_disk(&app)?;
    let index = games
        .iter()
        .position(|item| item.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let mut game = games[index].clone();
    let version_id = next_id();
    let file_name = selected_file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Dosya adi alinamadi.".to_string())?
        .to_string();

    let target_dir = game_folder(&app, &game)?
        .join("versions")
        .join(format!("{}-{}", slugify(version.trim()), version_id.clone()));
    fs::create_dir_all(&target_dir).map_err(|err| err.to_string())?;

    let target_file = target_dir.join(&file_name);
    fs::copy(&selected_file, &target_file).map_err(|err| err.to_string())?;

    let relative = target_file
        .strip_prefix(library_dir(&app)?)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let version_item = VersionItem {
        id: version_id,
        version: version.trim().to_string(),
        notes: notes.trim().to_string(),
        created_at: now_iso(),
        build_file_name: Some(file_name),
        build_relative_path: Some(relative.clone()),
        build_file_size_bytes: Some(
            fs::metadata(&target_file)
                .map_err(|err| err.to_string())?
                .len(),
        ),
        build_pruned_at: None,
    };

    game.current_build_relative_path = Some(relative);
    game.updated_at = now_iso();
    game.versions.insert(0, version_item);
    // Settings → Storage "Auto-prune old versions".
    if let Some(keep) = keep_builds.filter(|k| *k > 0) {
        let mut res = PruneResult::default();
        prune_game_builds(&library_dir(&app)?, &mut game, keep as usize, &mut res);
    }
    games[index] = game.clone();
    save_games_to_disk(&app, &games)?;
    Ok(game)
}

#[tauri::command]
fn open_current_build(app: AppHandle, game_id: String) -> Result<(), String> {
    let games = load_games_from_disk(&app)?;
    let game = games
        .into_iter()
        .find(|item| item.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let relative = game
        .current_build_relative_path
        .ok_or_else(|| "Bu oyun icin build eklenmemis.".to_string())?;

    let full_path = library_dir(&app)?.join(relative);
    if !full_path.exists() {
        return Err("Build dosyasi bulunamadi.".into());
    }

    open_path(&full_path)
}

#[tauri::command]
fn delete_version(app: AppHandle, game_id: String, version_id: String) -> Result<GameRecord, String> {
    let _io = io_lock();
    let mut games = load_games_from_disk(&app)?;
    let index = games
        .iter()
        .position(|item| item.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let mut game = games[index].clone();
    let version = game
        .versions
        .iter()
        .find(|item| item.id == version_id)
        .cloned()
        .ok_or_else(|| "Surum bulunamadi.".to_string())?;

    if let Some(relative) = &version.build_relative_path {
        let full_path = library_dir(&app)?.join(relative);
        if full_path.exists() {
            if let Some(parent) = full_path.parent() {
                if parent.exists() {
                    fs::remove_dir_all(parent).map_err(|err| err.to_string())?;
                }
            }
        }
    }

    game.versions.retain(|item| item.id != version_id);
    game.current_build_relative_path = game
        .versions
        .iter()
        .find_map(|item| item.build_relative_path.clone());
    game.updated_at = now_iso();
    games[index] = game.clone();
    save_games_to_disk(&app, &games)?;
    Ok(game)
}

fn open_path(path: &Path) -> Result<(), String> {
    open::that(path).map_err(|err| err.to_string())
}

fn open_target(target: &str) -> Result<(), String> {
    open::that(target).map_err(|err| err.to_string())
}

#[tauri::command]
fn open_store_page(app: AppHandle, game_id: String, store_key: String) -> Result<(), String> {
    let games = load_games_from_disk(&app)?;
    let game = games
        .into_iter()
        .find(|item| item.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let store = match store_key.as_str() {
        "itch" => game.stores.itch,
        "steam" => game.stores.steam,
        "play" => game.stores.play,
        _ => return Err("Gecersiz magazaya baglanti denendi.".into()),
    };

    let target = store.external_id.trim();
    if target.is_empty() {
        return Err("Bu magaza icin link kaydedilmemis.".into());
    }

    open_target(target)
}

#[tauri::command]
fn get_preferred_language(app: AppHandle) -> Result<Option<String>, String> {
    Ok(load_settings_from_disk(&app)?.preferred_language)
}

#[tauri::command]
fn load_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings_from_disk(&app)
}

#[tauri::command]
fn set_preferred_language(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    settings.preferred_language = Some(language);
    save_settings_to_disk(&app, &settings)
}

/// Whole-list write, kept for older callers. Writes the ACTIVE
/// workspace's wallet; the app itself uses the per-item commands below.
#[tauri::command(async)]
fn save_global_expenses(app: AppHandle, expenses: Vec<ExpenseItem>) -> Result<(), String> {
    mutate_wallet(&app, |w| w.global_expenses = expenses).map(|_| ())
}

#[tauri::command]
fn save_exchange_rates(app: AppHandle, rates: std::collections::HashMap<String, f64>) -> Result<(), String> {
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let mut settings = load_settings_from_disk(&app)?;
    settings.exchange_rates = Some(rates);
    save_settings_to_disk(&app, &settings)
}

// ── Workspace wallet (v0.9.9) ───────────────────────────────────────────────
//
// General (non-project) expenses and the wallet's currency list belong to a
// workspace, in `<data root>/wallet.json`. Project expenses already live on
// each game. Before v0.9.9 the general expenses sat in the app-wide
// settings.json, so every workspace showed the same wallet.
//
// Upgrade safety:
//   * The first workspace that opens after the upgrade (and is not a team
//     folder: personal expenses must not leak to teammates) adopts the old
//     list. `settings.legacy_wallet_claimed_by` records which one.
//   * `settings.global_expenses` is never cleared. Another workspace can
//     still copy it in by hand (`import_legacy_wallet`) while nobody has
//     adopted it, or when the adopting folder is gone.
//   * Expenses are added / changed / removed one at a time against the
//     file on disk, never by overwriting the whole list from memory, so a
//     failed or stale load can't wipe the file. An unreadable wallet.json
//     is an error, never treated as empty.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WalletFile {
    #[serde(default = "wallet_file_version")]
    version: u32,
    #[serde(default)]
    global_expenses: Vec<ExpenseItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_currencies: Option<Vec<String>>,
}

fn wallet_file_version() -> u32 { 1 }

impl Default for WalletFile {
    fn default() -> Self {
        WalletFile { version: 1, global_expenses: Vec::new(), active_currencies: None }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletLoad {
    global_expenses: Vec<ExpenseItem>,
    active_currencies: Option<Vec<String>>,
    /// Old (pre-workspace) expenses this workspace could still copy in.
    legacy_available: usize,
    /// True when this load just adopted the old wallet.
    migrated: bool,
}

fn wallet_path(root: &Path) -> PathBuf {
    root.join("wallet.json")
}

/// `Ok(None)` = no wallet.json yet. Unreadable / corrupt = `Err`, so a
/// caller can never mistake it for an empty wallet and overwrite it.
fn read_wallet(root: &Path) -> Result<Option<WalletFile>, String> {
    let path = wallet_path(root);
    if !path.exists() {
        return Ok(None);
    }
    let raw = match read_text_guarded(&path) {
        Ok(raw) => raw,
        Err(ReadFail::TimedOut) => {
            return Err("wallet.json okunamadi (bulut surucusu yanit vermiyor).".into())
        }
        Err(ReadFail::Io(e)) => return Err(format!("wallet.json okunamadi: {e}")),
    };
    if raw.trim().is_empty() {
        return Ok(Some(WalletFile::default()));
    }
    serde_json::from_str::<WalletFile>(&raw)
        .map(Some)
        .map_err(|e| format!("wallet.json bozuk: {e}"))
}

fn write_wallet(root: &Path, wallet: &WalletFile) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(wallet).map_err(|e| e.to_string())?;
    atomic_write(&wallet_path(root), &payload)
}

fn same_root(a: &str, b: &Path) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(&b.to_string_lossy())
}

/// A team folder has a members file / folder at its root.
fn is_team_root(root: &Path) -> bool {
    root.join("heravex-members.json").exists() || root.join("heravex-members").is_dir()
}

/// Old expenses not yet in `wallet`, offered only while nobody adopted
/// them or the folder that did is gone.
fn legacy_offer(settings: &AppSettings, root: &Path, wallet: &WalletFile) -> usize {
    if settings.global_expenses.is_empty() {
        return 0;
    }
    if let Some(owner) = settings.legacy_wallet_claimed_by.as_deref() {
        if same_root(owner, root) || Path::new(owner).is_dir() {
            return 0;
        }
    }
    settings
        .global_expenses
        .iter()
        .filter(|e| !wallet.global_expenses.iter().any(|w| w.id == e.id))
        .count()
}

fn wallet_write_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    WORKSPACE_WRITE_LOCK.lock().map_err(|e| format!("write-lock zehirlendi: {e}"))
}

/// Load the wallet at `root`, adopting the old wallet when allowed. On
/// adoption `settings` gets the claim marker and `migrated` is true; the
/// caller must then save settings.
fn load_wallet_at(root: &Path, settings: &mut AppSettings, claim_legacy: bool) -> Result<WalletLoad, String> {
    let mut migrated = false;
    let wallet = match read_wallet(root)? {
        Some(w) => w,
        None => {
            let adopt = claim_legacy
                && settings.legacy_wallet_claimed_by.is_none()
                && !settings.global_expenses.is_empty()
                && !is_team_root(root);
            if adopt {
                let w = WalletFile {
                    version: 1,
                    global_expenses: settings.global_expenses.clone(),
                    active_currencies: None,
                };
                write_wallet(root, &w)?;
                settings.legacy_wallet_claimed_by = Some(root.to_string_lossy().to_string());
                migrated = true;
                w
            } else {
                WalletFile::default()
            }
        }
    };
    Ok(WalletLoad {
        legacy_available: legacy_offer(settings, root, &wallet),
        global_expenses: wallet.global_expenses,
        active_currencies: wallet.active_currencies,
        migrated,
    })
}

#[tauri::command(async)]
fn load_wallet(app: AppHandle, claim_legacy: Option<bool>) -> Result<WalletLoad, String> {
    let _io = io_lock();
    let _guard = wallet_write_guard()?;
    let root = data_root(&app)?;
    let mut settings = load_settings_from_disk(&app)?;
    let loaded = load_wallet_at(&root, &mut settings, claim_legacy.unwrap_or(false))?;
    if loaded.migrated {
        save_settings_to_disk(&app, &settings)?;
    }
    Ok(loaded)
}

/// Read-modify-write on the file; returns the wallet as saved.
fn mutate_wallet<F>(app: &AppHandle, f: F) -> Result<WalletFile, String>
where
    F: FnOnce(&mut WalletFile),
{
    let _io = io_lock();
    let _guard = wallet_write_guard()?;
    let root = data_root(app)?;
    let mut wallet = read_wallet(&root)?.unwrap_or_default();
    f(&mut wallet);
    write_wallet(&root, &wallet)?;
    notify_windows(app, "wallet", Vec::new());
    Ok(wallet)
}

/// Add (at the top) or replace by id.
#[tauri::command(async)]
fn wallet_upsert_expense(app: AppHandle, expense: ExpenseItem) -> Result<Vec<ExpenseItem>, String> {
    mutate_wallet(&app, |w| {
        if let Some(slot) = w.global_expenses.iter_mut().find(|e| e.id == expense.id) {
            *slot = expense;
        } else {
            w.global_expenses.insert(0, expense);
        }
    })
    .map(|w| w.global_expenses)
}

#[tauri::command(async)]
fn wallet_delete_expense(app: AppHandle, expense_id: String) -> Result<Vec<ExpenseItem>, String> {
    mutate_wallet(&app, |w| w.global_expenses.retain(|e| e.id != expense_id))
        .map(|w| w.global_expenses)
}

#[tauri::command(async)]
fn wallet_set_currencies(app: AppHandle, currencies: Vec<String>) -> Result<(), String> {
    mutate_wallet(&app, |w| w.active_currencies = Some(currencies)).map(|_| ())
}

/// Copy the old (pre-workspace) expenses into the active workspace,
/// skipping ids it already has. The old list itself stays untouched.
#[tauri::command(async)]
fn import_legacy_wallet(app: AppHandle) -> Result<Vec<ExpenseItem>, String> {
    let legacy = load_settings_from_disk(&app)?.global_expenses;
    let wallet = mutate_wallet(&app, |w| {
        for e in legacy.into_iter().rev() {
            if !w.global_expenses.iter().any(|x| x.id == e.id) {
                w.global_expenses.insert(0, e);
            }
        }
    })?;
    let _io = io_lock();
    let _guard = wallet_write_guard()?;
    let mut settings = load_settings_from_disk(&app)?;
    let owner_gone = settings
        .legacy_wallet_claimed_by
        .as_deref()
        .map_or(true, |o| !Path::new(o).is_dir());
    if owner_gone {
        settings.legacy_wallet_claimed_by = Some(data_root(&app)?.to_string_lossy().to_string());
        save_settings_to_disk(&app, &settings)?;
    }
    Ok(wallet.global_expenses)
}

/// A restored backup must not silently turn the keychain off (keys would
/// land back in settings.json) or on. Keys the backup carries in plain
/// text win over the keychain's (that is what the user restored).
fn keep_keychain_choice(restored: &mut AppSettings, current: Option<&AppSettings>) {
    let Some(cur) = current else { return };
    restored.secrets_in_keychain = cur.secrets_in_keychain;
    restored.secrets_loaded = cur.secrets_loaded;
    if restored.steam_api_key.is_none() { restored.steam_api_key = cur.steam_api_key.clone(); }
    if restored.itch_api_key.is_none() { restored.itch_api_key = cur.itch_api_key.clone(); }
}

/// Backup restore: write the backup's wallet into the active workspace.
/// Backups made before v0.9.9 carry it only as `settings.global_expenses`.
/// The adoption marker of the CURRENT install wins, so restoring an old
/// backup can't make a second workspace adopt the old list again.
fn restore_wallet_from_backup(
    app: &AppHandle,
    wallet: Option<WalletFile>,
    restored: AppSettings,
    current_claim: Option<String>,
) -> Result<AppSettings, String> {
    restore_wallet_at(&data_root(app)?, wallet, restored, current_claim)
}

fn restore_wallet_at(
    root: &Path,
    wallet: Option<WalletFile>,
    mut restored: AppSettings,
    current_claim: Option<String>,
) -> Result<AppSettings, String> {
    let wallet = match wallet {
        Some(w) => Some(w),
        None if !restored.global_expenses.is_empty() => Some(WalletFile {
            version: 1,
            global_expenses: restored.global_expenses.clone(),
            active_currencies: None,
        }),
        None => None,
    };
    let wrote = wallet.is_some();
    if let Some(w) = wallet {
        write_wallet(root, &w)?;
    }
    restored.legacy_wallet_claimed_by = current_claim
        .or(restored.legacy_wallet_claimed_by.take())
        .or_else(|| wrote.then(|| root.to_string_lossy().to_string()));
    Ok(restored)
}

// ── Team workspace members file (v0.9.7) ────────────────────────────────────
//
// `heravex-members.json` lives at the root of every team workspace. It
// records who has connected, when they joined, and their role. The
// frontend is the source of truth for the schema; Rust just reads/
// writes the file atomically (temp-then-rename) so a half-flushed
// write from one cloud client doesn't get picked up by another.
//
// Why the workspace path is passed by the caller instead of being read
// from settings: the call sites in the frontend already know whether
// the active workspace is a team folder, and pinning the path argument
// keeps these commands testable in isolation.

#[tauri::command(async)]
fn team_read_members(workspace_path: String) -> Result<String, String> {
    let _io = io_lock();
    let path = std::path::PathBuf::from(&workspace_path).join("heravex-members.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        // Missing file is normal — the first member to join writes it.
        // Return an empty JSON document so the caller can hand it
        // straight to JSON.parse without a special-case.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
        Err(e) => Err(format!("members.json okunamadi: {e}")),
    }
}

/// Members file metadata returned alongside the content so the
/// frontend can do optimistic CAS: read mtime + bytes, modify,
/// attempt write with `expected_mtime`. The Rust side rejects the
/// write if the file changed in between — the caller re-reads and
/// retries. Solves the leader race the review flagged: two clients
/// that both saw an empty members list and both wrote themselves
/// as leader; the second writer now gets a conflict error and
/// re-reads to find the first writer already there, accepting
/// member role instead.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MembersReadResult {
    content: String,
    mtime: u64,
}

#[tauri::command(async)]
fn team_read_members_versioned(workspace_path: String) -> Result<MembersReadResult, String> {
    let _io = io_lock();
    let path = std::path::PathBuf::from(&workspace_path).join("heravex-members.json");
    match std::fs::read(&path) {
        Ok(bytes) => {
            let mtime = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let content = String::from_utf8(bytes)
                .map_err(|e| format!("members.json UTF-8 değil: {e}"))?;
            Ok(MembersReadResult { content, mtime })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(MembersReadResult { content: "{}".into(), mtime: 0 }),
        Err(e) => Err(format!("members.json okunamadi: {e}")),
    }
}

#[tauri::command(async)]
fn team_write_members(workspace_path: String, content: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let dir = std::path::PathBuf::from(&workspace_path);
    if !dir.is_dir() {
        return Err(format!("workspace klasoru yok: {workspace_path}"));
    }
    let target = dir.join("heravex-members.json");
    // Use the shared atomic_write so the unique-tmp guarantee covers
    // members.json too (two cloud-synced instances writing at the
    // same instant won't clobber a shared .tmp file).
    atomic_write(&target, content.as_bytes())
        .map_err(|e| format!("members.json yazilamadi: {e}"))
}

/// Compare-And-Swap write: only succeeds if the current mtime
/// matches `expected_mtime`. Returns Err with a specific marker
/// string the frontend can detect and retry.
#[tauri::command(async)]
fn team_write_members_cas(workspace_path: String, content: String, expected_mtime: u64) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let dir = std::path::PathBuf::from(&workspace_path);
    if !dir.is_dir() {
        return Err(format!("workspace klasoru yok: {workspace_path}"));
    }
    let target = dir.join("heravex-members.json");
    // Verify the on-disk mtime matches the caller's expectation
    // BEFORE writing. If the file has been touched by another client
    // since the caller's read, the caller's planned modification is
    // based on stale state and must retry.
    let actual_mtime = std::fs::metadata(&target)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if actual_mtime != expected_mtime {
        return Err(format!("CAS_CONFLICT:{actual_mtime}"));
    }
    atomic_write(&target, content.as_bytes())
        .map_err(|e| format!("members.json yazilamadi: {e}"))
}

// ── Per-user team presence (v0.9.8 rewrite) ──────────────────────────────────
//
// The old model had every client read-modify-write a single shared
// `heravex-members.json`. Over a cloud-sync folder that races: two
// machines edit their local copy, the cloud merges last-writer-wins,
// and member rows get silently dropped (you'd only ever see the leader).
//
// The fix is presence-per-user: each client writes ONLY its own file at
// `heravex-members/<userId>.json` and never touches anyone else's, so
// the cloud never has to merge a shared document. The members list is
// the UNION of every file in that directory. Role overrides
// (ban / explicit leader) live in a single `_roles.json` written ONLY by
// the leader — again a one-writer file, so no race.

fn team_members_dir(workspace_path: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(workspace_path).join("heravex-members");
    fs::create_dir_all(&dir).map_err(|e| format!("members dizini olusturulamadi: {e}"))?;
    Ok(dir)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamReadResult {
    /// Raw JSON contents of every per-user presence file.
    members: Vec<String>,
    /// Raw JSON of `_roles.json`, or null when the leader has never set roles.
    roles: Option<String>,
}

/// Write the caller's OWN presence file. Atomic; never touches others'.
#[tauri::command(async)]
fn team_write_self(workspace_path: String, user_id: String, content: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock().map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let dir = team_members_dir(&workspace_path)?;
    let target = dir.join(format!("{}.json", safe_id_filename(&user_id)));
    atomic_write(&target, content.as_bytes())
        .map_err(|e| format!("presence yazilamadi: {e}"))
}

/// Leader-only: write the shared role-overrides file (single writer).
#[tauri::command(async)]
fn team_write_roles(workspace_path: String, content: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock().map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let dir = team_members_dir(&workspace_path)?;
    let target = dir.join("_roles.json");
    atomic_write(&target, content.as_bytes())
        .map_err(|e| format!("roles yazilamadi: {e}"))
}

/// Leader-only: remove a member's presence file (kick). If that member
/// is still active their next heartbeat re-creates it — banning via the
/// roles file is the permanent option.
#[tauri::command(async)]
fn team_remove_member_file(workspace_path: String, user_id: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock().map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let dir = team_members_dir(&workspace_path)?;
    let target = dir.join(format!("{}.json", safe_id_filename(&user_id)));
    if target.exists() { let _ = fs::remove_file(&target); }
    Ok(())
}

/// Read the whole team: every presence file + the roles file. Tolerant —
/// a half-written file (cloud mid-sync) is skipped, not fatal.
#[tauri::command(async)]
fn team_read_team(workspace_path: String) -> Result<TeamReadResult, String> {
    let _io = io_lock();
    let dir = PathBuf::from(&workspace_path).join("heravex-members");
    if !dir.is_dir() {
        return Ok(TeamReadResult { members: Vec::new(), roles: None });
    }
    let mut members = Vec::new();
    let mut roles = None;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let content = match read_text_guarded(&path) { Ok(c) => c, Err(_) => continue };
            if name == "_roles.json" {
                roles = Some(content);
            } else {
                members.push(content);
            }
        }
    }
    Ok(TeamReadResult { members, roles })
}

// ── Global notes search (v0.9.7 Tur 3b) ─────────────────────────────────────
//
// Scans every saved note (global studio notes + per-game GDD notes)
// and returns ranked matches for `query`. The ranking is intentionally
// simple — title hits weigh heaviest, body substring hits next, fuzzy
// character-order matches last — because note counts in HeraVex are
// always low-hundreds at most. A future heavy index (tantivy) can
// slot in behind the same command signature.

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    kind: String,        // "global" | "game"
    note_id: String,
    game_id: Option<String>,
    title: String,
    snippet: String,
    score: i32,
}

fn strip_html(s: &str) -> String {
    // Very small HTML-tag stripper — kept inline so we don't pull a
    // dependency just to render snippets. Handles the tags the editor
    // produces; anything more exotic falls through as plain text.
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
       .replace("&amp;", "&")
       .replace("&lt;", "<")
       .replace("&gt;", ">")
       .replace("&quot;", "\"")
}

fn score_match(query_l: &str, title_l: &str, body_l: &str) -> i32 {
    let mut score = 0i32;
    if title_l.contains(query_l) { score += 100; }
    if title_l.starts_with(query_l) { score += 30; }
    let body_hits = body_l.matches(query_l).count() as i32;
    score += body_hits.min(50) * 5;
    // Cheap "fuzzy" — every character of the query appears in order
    // somewhere in the title. Weakest signal so a typo still surfaces.
    if score == 0 {
        let mut it = title_l.chars();
        let mut all_in = true;
        for ch in query_l.chars() {
            if it.find(|c| *c == ch).is_none() { all_in = false; break; }
        }
        if all_in && !query_l.is_empty() { score += 10; }
    }
    score
}

fn build_snippet(body: &str, query_l: &str, max_len: usize) -> String {
    if query_l.is_empty() {
        return body.chars().take(max_len).collect();
    }
    let body_l = body.to_lowercase();
    let idx = body_l.find(query_l).unwrap_or(0);
    // Walk back ~30 chars from the match so the user gets context
    // before the highlighted term.
    let head_target = idx.saturating_sub(30);
    let start = body
        .char_indices()
        .map(|(i, _)| i)
        .find(|i| *i >= head_target)
        .unwrap_or(0);
    let mut end = start;
    let mut taken = 0usize;
    for (i, _) in body[start..].char_indices() {
        if taken >= max_len { break; }
        end = start + i;
        taken += 1;
    }
    let mut snippet = String::new();
    if start > 0 { snippet.push('…'); }
    snippet.push_str(&body[start..=end.min(body.len() - 1)]);
    if end < body.len() - 1 { snippet.push('…'); }
    snippet
}

/// Synchronous worker — the heavy disk + parse + scoring loop. Kept
/// non-`tauri::command` so the async wrapper below can hand it to
/// `spawn_blocking` and free the IPC thread pool while the work runs.
fn search_notes_blocking(app: &AppHandle, query: String, limit: Option<usize>) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let cap = limit.unwrap_or(20).min(100);

    let mut hits: Vec<SearchHit> = Vec::new();

    // Global notes
    let global = load_notes_from_disk(app).unwrap_or_default();
    for n in global.into_iter() {
        let body = strip_html(&n.content);
        let title_l = n.title.to_lowercase();
        let body_l = body.to_lowercase();
        let score = score_match(&q, &title_l, &body_l);
        if score > 0 {
            hits.push(SearchHit {
                kind: "global".into(),
                note_id: n.id,
                game_id: None,
                title: n.title,
                snippet: build_snippet(&body, &q, 120),
                score,
            });
        }
    }

    // Per-game notes (the legacy `game.notes` blob — one note per
    // game, used as the GDD)
    let games = load_games_from_disk(app).unwrap_or_default();
    for g in games.into_iter() {
        let body = strip_html(&g.notes);
        if body.trim().is_empty() { continue; }
        let title_l = g.title.to_lowercase();
        let body_l = body.to_lowercase();
        let score = score_match(&q, &title_l, &body_l);
        if score > 0 {
            hits.push(SearchHit {
                kind: "game".into(),
                note_id: g.id.clone(),
                game_id: Some(g.id),
                title: g.title,
                snippet: build_snippet(&body, &q, 120),
                score,
            });
        }
    }

    hits.sort_by(|a, b| b.score.cmp(&a.score));
    hits.truncate(cap);
    Ok(hits)
}

/// v0.9.7 resilience pass — async wrapper so a slow disk read (cloud
/// folder, big notes file) doesn't pin the Tauri IPC pool. Without
/// this every keystroke in CommandPalette could hold the IPC thread
/// for the duration of the disk scan, queueing every other invoke
/// behind it.
#[tauri::command]
async fn search_notes(app: AppHandle, query: String, limit: Option<usize>) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || search_notes_blocking(&app, query, limit))
        .await
        .map_err(|e| format!("search join failed: {e}"))?
}

/// Fetch live FX rates from the internet, tried in order so a single
/// provider hiccup doesn't leave the user with stale numbers.
///
/// Why this lives in Rust and not the renderer:
///   * The frontend's `connect-src` CSP would have to allow every
///     fallback host explicitly; piping through reqwest sidesteps
///     CSP entirely.
///   * Frankfurter (the only host the CSP previously allowed) dropped
///     TRY from its ECB-derived feed in March 2022, so TRY was
///     permanently stuck on the disk fallback. open.er-api.com still
///     carries TRY along with ~160 other currencies.
///
/// Returns a map shaped exactly like the frontend's `exchangeRates`
/// slice: `USD: 1` plus one entry per non-USD currency, where the
/// value is **USD per 1 unit of CUR** (inverse of the typical "1 USD
/// = X CUR" form). The renderer multiplies amounts by this number, so
/// every consumer downstream gets the conversion right.
#[tauri::command]
async fn fetch_live_exchange_rates() -> Result<std::collections::HashMap<String, f64>, String> {
    use serde_json::Value;

    let client = build_http_client()?;
    // Listed in preference order. open.er-api.com is the only one that
    // reliably ships TRY today; the others are kept as safety nets.
    let sources = [
        "https://open.er-api.com/v6/latest/USD",
        "https://api.exchangerate.host/latest?base=USD",
        "https://api.frankfurter.app/latest?base=USD",
    ];

    let mut last_err = String::from("Hicbir kur kaynagi cevap vermedi.");
    for url in sources {
        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_err = format!("{url} -> HTTP {}", resp.status());
                    continue;
                }
                let json: Value = match resp.json().await {
                    Ok(v) => v,
                    Err(e) => { last_err = format!("{url} -> JSON: {e}"); continue; }
                };
                let raw = json.get("rates").and_then(|v| v.as_object());
                let raw = match raw {
                    Some(o) => o,
                    None => { last_err = format!("{url} -> rates yok"); continue; }
                };

                let mut out: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
                out.insert("USD".into(), 1.0);
                for (code, val) in raw {
                    if code == "USD" { continue; }
                    let per_usd = val.as_f64().unwrap_or(0.0);
                    if per_usd.is_finite() && per_usd > 0.0 {
                        // API ships "1 USD = X CUR" → invert to "USD per CUR"
                        out.insert(code.clone(), 1.0 / per_usd);
                    }
                }
                if out.len() < 10 {
                    last_err = format!("{url} -> az veri ({} kur)", out.len());
                    continue;
                }
                return Ok(out);
            }
            Err(e) => { last_err = format!("{url} -> {e}"); continue; }
        }
    }
    Err(last_err)
}

#[tauri::command]
fn save_currency_labels(app: AppHandle, label1: String, label2: String) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    settings.currency_label_1 = Some(label1);
    settings.currency_label_2 = Some(label2);
    save_settings_to_disk(&app, &settings)
}

#[tauri::command(async)]
fn delete_game(app: AppHandle, game_id: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let mut games = load_games_from_disk(&app)?;
    let removed_title = games
        .iter()
        .find(|g| g.id == game_id)
        .map(|g| g.title.clone());
    if let Some(game) = games.iter().find(|g| g.id == game_id) {
        let folder = game_folder(&app, game)?;
        if folder.exists() {
            fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
        }
    }
    games.retain(|g| g.id != game_id);
    save_games_to_disk(&app, &games)?;
    append_activity(&app, "game.deleted", removed_title);
    notify_windows(&app, "games", Vec::new());
    Ok(())
}

#[tauri::command]
fn save_release_template(
    app: AppHandle,
    template: Vec<ReleaseTemplateItem>,
) -> Result<Vec<ReleaseTemplateItem>, String> {
    let mut settings = load_settings_from_disk(&app)?;
    settings.release_template = if template.is_empty() {
        default_release_template()
    } else {
        template
    };
    save_settings_to_disk(&app, &settings)?;
    Ok(settings.release_template)
}

/// Silent auto-backup written to `<AppData>/heravex/backups/`.
///
/// Differs from `export_backup` in two ways:
///   1. No file dialog — the caller (frontend auto-scheduler) opens
///      the app and we just persist a JSON next to the existing
///      settings.json without bothering the user.
///   2. Filenames are timestamped (`auto-YYYYMMDD-HHMM.json`) so the
///      Backup history view can sort + prune them.
///
/// The folder is created on first call. Returns the absolute path so
/// the frontend can show "saved to …" if anyone wants the read-out.
/// Internal worker that does the actual backup work. Pulled out of
/// the command so the async wrapper below can spawn it on a thread.
///
/// Output format is a ZIP archive containing:
///   manifest.json  — `BackupSnapshotLite` (no embedded files)
///   library/...    — raw files copied straight in (no base64)
///
/// The previous format wrapped every binary in base64 inside one huge
/// JSON string. With screenshot-heavy workspaces (10 games × 5 PNGs)
/// the resulting String + serde pretty-print easily peaked >1 GB of
/// memory and crashed the WebView process. The ZIP path streams each
/// file directly so peak memory stays in the tens of megabytes.
fn perform_silent_backup(app: &AppHandle, prefix: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    let saves_dir = root_dir(app)?.join("Saves");
    fs::create_dir_all(&saves_dir).map_err(|e| format!("Saves dir: {e}"))?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let final_path = saves_dir.join(format!("{}-{}.zip", prefix, stamp));
    let part_path = saves_dir.join(format!("{}-{}.zip.part", prefix, stamp));

    let games    = load_games_from_disk(app)?;
    let notes    = load_notes_from_disk(app).unwrap_or_default();
    let settings = settings_for_backup(load_settings_from_disk(app)?);
    let wallet   = read_wallet(&data_root(app)?)?;

    // Manifest carries everything except binary library content. The
    // matching import command reconstructs the workspace by writing
    // these blobs to disk and unzipping the `library/` entries.
    let manifest = serde_json::json!({
        "version": 2,
        "exportedAt": now_iso(),
        "settings": settings,
        "games":    games,
        "notes":    notes,
        "wallet":   wallet,
    });
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

    let file = fs::File::create(&part_path).map_err(|e| format!("create zip: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(3)); // mild — keeps CPU low

    zip.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(&manifest_bytes).map_err(|e| e.to_string())?;

    // Walk library/ and copy files in. Skip nothing — the user expects
    // their screenshots to come back when they restore.
    let library = library_dir(app)?;
    if library.exists() {
        zip_walk(&mut zip, &library, &library, opts)?;
    }

    zip.finish().map_err(|e| e.to_string())?;

    // Atomic rename so a kill mid-zip never leaves a half-written file
    // showing up in the history list.
    fs::rename(&part_path, &final_path).map_err(|err| err.to_string())?;

    return Ok(final_path.to_string_lossy().to_string());

    fn zip_walk(
        zip: &mut zip::ZipWriter<fs::File>,
        root: &Path,
        current: &Path,
        opts: SimpleFileOptions,
    ) -> Result<(), String> {
        use std::io::{Read, Write};
        let entries = match fs::read_dir(current) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                zip_walk(zip, root, &path, opts)?;
                continue;
            }
            let rel = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let entry_name = format!("library/{}", rel);
            zip.start_file(&entry_name, opts).map_err(|e| e.to_string())?;
            // 64 KB buffered copy — keeps memory flat on multi-MB
            // screenshot folders.
            let mut f = match fs::File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let mut buf = [0u8; 64 * 1024];
            loop {
                let n = match f.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(_) => break,
                };
                zip.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

/// Async-from-the-frontend silent backup. Runs the heavy IO on a
/// worker thread so the webview's IPC handler returns immediately and
/// the UI never freezes during a multi-megabyte serialisation. The
/// return value is the resolved file path or an error string.
#[tauri::command]
async fn export_backup_silent(
    app: AppHandle,
    prefix: Option<String>,
    housekeeping: Option<BackupHousekeeping>,
) -> Result<String, String> {
    let prefix = prefix.unwrap_or_else(|| "auto".into());
    // `tauri::async_runtime::spawn_blocking` parks the work on Tauri's
    // dedicated blocking pool — same one fs/sqlite use — so we don't
    // starve the small UI command thread pool. The await is cheap; the
    // frontend just sees a regular Promise that resolves when done.
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = perform_silent_backup(&app_clone, &prefix)?;
        if let Some(hk) = housekeeping {
            run_backup_housekeeping(&app_clone, Path::new(&path), &hk);
        }
        Ok(path)
    })
    .await
    .map_err(|e| format!("backup thread join failed: {e}"))?
}

#[tauri::command]
fn export_backup(app: AppHandle) -> Result<String, String> {
    let save_path = FileDialog::new()
        .set_title("Yedek dosyasi kaydet")
        .add_filter("JSON", &["json"])
        .set_file_name(&format!(
            "heravex-backup-{}.json",
            Utc::now().format("%Y%m%d-%H%M")
        ))
        .save_file()
        .ok_or_else(|| "Yedekleme iptal edildi.".to_string())?;

    let games = load_games_from_disk(&app)?;
    let notes = load_notes_from_disk(&app).unwrap_or_default();
    let settings = settings_for_backup(load_settings_from_disk(&app)?);
    let library = library_dir(&app)?;
    let mut files = Vec::new();

    collect_backup_files(&library, &library, &mut files)?;

    let snapshot = BackupSnapshot {
        version: 1,
        exported_at: now_iso(),
        settings,
        games,
        files,
        notes,
        wallet: read_wallet(&data_root(&app)?)?,
    };

    let payload = serde_json::to_string_pretty(&snapshot).map_err(|err| err.to_string())?;
    fs::write(&save_path, payload).map_err(|err| err.to_string())?;

    Ok(save_path.to_string_lossy().to_string())
}

/// Restore a backup file. Accepts either the new v2 `.zip` format or
/// the legacy v1 `.json` (base64-bundled) format. Behaviour:
///   - When `path` is provided, that file is read directly (used by
///     the BackupPage "Restore" button on history rows).
///   - When `path` is empty/none, falls back to a file picker so old
///     callers still work.
#[tauri::command]
fn import_backup(app: AppHandle, path: Option<String>) -> Result<String, String> {
    let backup_path = match path.filter(|p| !p.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => FileDialog::new()
            .set_title("Yedek dosyasini sec")
            .add_filter("Backup", &["zip", "json"])
            .pick_file()
            .ok_or_else(|| "Ice aktarma iptal edildi.".to_string())?,
    };

    let is_zip = backup_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);

    if is_zip {
        import_backup_zip(&app, &backup_path)?;
    } else {
        import_backup_legacy_json(&app, &backup_path)?;
    }
    Ok(backup_path.to_string_lossy().to_string())
}

/// New ZIP restore path — streams entries straight to disk without
/// holding the full archive in memory. Mirrors the layout produced by
/// `perform_silent_backup`.
fn import_backup_zip(app: &AppHandle, archive_path: &Path) -> Result<(), String> {
    use std::io::Read;
    let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    // 1. Parse manifest.json — must come first so we know the version.
    let mut manifest_bytes = Vec::new();
    {
        let mut m = archive.by_name("manifest.json").map_err(|e| e.to_string())?;
        m.read_to_end(&mut manifest_bytes).map_err(|e| e.to_string())?;
    }
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    let version = manifest.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    if version != 2 {
        return Err("Bu yedek surumu desteklenmiyor.".into());
    }

    // 2. Wipe library/ before restoring.
    let library = library_dir(app)?;
    if library.exists() {
        fs::remove_dir_all(&library).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&library).map_err(|err| err.to_string())?;

    // 3. Stream every entry under library/ into the workspace.
    let count = archive.len();
    for i in 0..count {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name == "manifest.json" { continue; }
        let Some(rel) = name.strip_prefix("library/") else { continue; };
        if rel.is_empty() { continue; }
        // Path-traversal hardening — reject `..`, drive letters, etc.
        let safe_rel = validate_relative_backup_path(rel)?;
        let target = library.join(safe_rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut out = fs::File::create(&target).map_err(|err| err.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|err| err.to_string())?;
    }

    // 4. Persist the games/notes/settings blobs from the manifest.
    if let Some(games_val) = manifest.get("games") {
        let games: Vec<GameRecord> = serde_json::from_value(games_val.clone())
            .map_err(|e| e.to_string())?;
        save_games_to_disk(app, &games)?;
    }
    if let Some(notes_val) = manifest.get("notes") {
        let notes: Vec<NoteRecord> = serde_json::from_value(notes_val.clone())
            .unwrap_or_default();
        save_notes_to_disk(app, &notes)?;
    }
    if let Some(settings_val) = manifest.get("settings") {
        let settings: AppSettings = serde_json::from_value(settings_val.clone())
            .map_err(|e| e.to_string())?;
        let current = load_settings_from_disk(app).ok();
        let current_claim = current.as_ref().and_then(|s| s.legacy_wallet_claimed_by.clone());
        let mut settings = settings;
        keep_keychain_choice(&mut settings, current.as_ref());
        let wallet: Option<WalletFile> = match manifest.get("wallet").filter(|v| !v.is_null()) {
            Some(v) => Some(serde_json::from_value(v.clone()).map_err(|e| format!("wallet: {e}"))?),
            None => None,
        };
        let settings = restore_wallet_from_backup(app, wallet, settings, current_claim)?;
        save_settings_to_disk(app, &settings)?;
    }
    Ok(())
}

/// Legacy v1 JSON restore — kept for users upgrading with old backups
/// still on disk. The base64 path stays expensive in memory; we just
/// don't recommend it for fresh backups any more.
fn import_backup_legacy_json(app: &AppHandle, json_path: &Path) -> Result<(), String> {
    let raw = fs::read_to_string(json_path).map_err(|err| err.to_string())?;
    let snapshot: BackupSnapshot = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    if snapshot.version != 1 {
        return Err("Bu yedek surumu desteklenmiyor.".into());
    }
    let library = library_dir(app)?;
    if library.exists() {
        fs::remove_dir_all(&library).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&library).map_err(|err| err.to_string())?;
    for file in snapshot.files {
        let relative_path = validate_relative_backup_path(&file.path)?;
        let target = library.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let bytes = general_purpose::STANDARD
            .decode(file.contents_base64)
            .map_err(|err| err.to_string())?;
        fs::write(target, bytes).map_err(|err| err.to_string())?;
    }
    save_games_to_disk(app, &snapshot.games)?;
    save_notes_to_disk(app, &snapshot.notes)?;
    let current = load_settings_from_disk(app).ok();
    let current_claim = current.as_ref().and_then(|s| s.legacy_wallet_claimed_by.clone());
    let mut restored = snapshot.settings;
    keep_keychain_choice(&mut restored, current.as_ref());
    let settings = restore_wallet_from_backup(app, snapshot.wallet, restored, current_claim)?;
    save_settings_to_disk(app, &settings)?;
    Ok(())
}

#[tauri::command(async)]
fn save_image_to_disk(app: AppHandle, base64_data: String, game_id: String) -> Result<String, String> {
    let _io = io_lock();
    // Strip the data-URL header (data:image/png;base64,...) if present
    let (raw_b64, ext) = if let Some(comma) = base64_data.find(',') {
        let header = &base64_data[..comma];
        let ext = if header.contains("jpeg") || header.contains("jpg") {
            "jpg"
        } else if header.contains("webp") {
            "webp"
        } else if header.contains("gif") {
            "gif"
        } else {
            "png"
        };
        (&base64_data[comma + 1..], ext)
    } else {
        (base64_data.as_str(), "png")
    };

    let bytes = general_purpose::STANDARD
        .decode(raw_b64)
        .map_err(|e| format!("Base64 decode hatasi: {e}"))?;

    let games = load_games_from_disk(&app)?;
    let game = games
        .iter()
        .find(|g| g.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let images_dir = game_folder(&app, game)?.join("assets").join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let ts = Utc::now().timestamp_millis();
    let file_path = images_dir.join(format!("{game_id}_{ts}.{ext}"));

    fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ButlerLogPayload {
    Stdout { line: String },
    Stderr { line: String },
    Info { line: String },
    Done { code: i32 },
    Error {
        message: String,
        #[serde(rename = "errorKind")]
        kind: ButlerErrorKind,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ButlerErrorKind {
    NotInstalled,
    SpawnFailed,
    IoFailure,
    NonZeroExit,
}

fn emit_log(window: &Window, payload: ButlerLogPayload) {
    let _ = window.emit("butler-log", &payload);
}

#[tauri::command]
async fn deploy_to_itch(
    window: Window,
    directory: String,
    target: String,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;
    use std::process::Stdio;

    let dir_trimmed = directory.trim();
    let target_trimmed = target.trim();
    if dir_trimmed.is_empty() {
        return Err("Build klasoru bos olamaz.".into());
    }
    if target_trimmed.is_empty() {
        return Err("Itch.io hedef bos olamaz.".into());
    }
    let dir_path = PathBuf::from(dir_trimmed);
    if !dir_path.exists() || !dir_path.is_dir() {
        return Err(format!("Klasor bulunamadi: {dir_trimmed}"));
    }

    emit_log(
        &window,
        ButlerLogPayload::Info {
            line: format!("$ butler push \"{dir_trimmed}\" {target_trimmed}"),
        },
    );

    let mut cmd = TokioCommand::new("butler");
    cmd.arg("push")
        .arg(dir_trimmed)
        .arg(target_trimmed)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // 0x08000000 = CREATE_NO_WINDOW — keeps the helper console hidden.
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            let kind = if err.kind() == std::io::ErrorKind::NotFound {
                ButlerErrorKind::NotInstalled
            } else {
                ButlerErrorKind::SpawnFailed
            };
            let message = match kind {
                ButlerErrorKind::NotInstalled =>
                    "butler bulunamadi. Once Itch.io Butler'i kur ve PATH'e ekle.".to_string(),
                _ => format!("butler baslatilamadi: {err}"),
            };
            emit_log(
                &window,
                ButlerLogPayload::Error {
                    message: message.clone(),
                    kind,
                },
            );
            return Err(message);
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let win_out = window.clone();
    let win_err = window.clone();

    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        emit_log(&win_out, ButlerLogPayload::Stdout { line });
                    }
                    Ok(None) => break,
                    Err(err) => {
                        emit_log(
                            &win_out,
                            ButlerLogPayload::Error {
                                message: format!("stdout okuma hatasi: {err}"),
                                kind: ButlerErrorKind::IoFailure,
                            },
                        );
                        break;
                    }
                }
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        if let Some(out) = stderr {
            let mut reader = BufReader::new(out).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        emit_log(&win_err, ButlerLogPayload::Stderr { line });
                    }
                    Ok(None) => break,
                    Err(err) => {
                        emit_log(
                            &win_err,
                            ButlerLogPayload::Error {
                                message: format!("stderr okuma hatasi: {err}"),
                                kind: ButlerErrorKind::IoFailure,
                            },
                        );
                        break;
                    }
                }
            }
        }
    });

    let status = match child.wait().await {
        Ok(s) => s,
        Err(err) => {
            let message = format!("butler beklenirken hata: {err}");
            emit_log(
                &window,
                ButlerLogPayload::Error {
                    message: message.clone(),
                    kind: ButlerErrorKind::IoFailure,
                },
            );
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(message);
        }
    };
    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let code = status.code().unwrap_or(-1);
    emit_log(&window, ButlerLogPayload::Done { code });

    if status.success() {
        Ok(())
    } else {
        let message = format!("butler exit code: {code}");
        emit_log(
            &window,
            ButlerLogPayload::Error {
                message: message.clone(),
                kind: ButlerErrorKind::NonZeroExit,
            },
        );
        Err(message)
    }
}

#[tauri::command]
fn pick_directory() -> Result<String, String> {
    let picked = FileDialog::new()
        .set_title("Klasor sec")
        .pick_folder()
        .ok_or_else(|| "Klasor secimi iptal edildi.".to_string())?;
    Ok(picked.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_and_save_avatar(app: AppHandle) -> Result<String, String> {
    let picked = FileDialog::new()
        .set_title("Profil fotografi sec")
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "gif"])
        .pick_file()
        .ok_or_else(|| "Avatar secimi iptal edildi.".to_string())?;

    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let avatars_dir = root_dir(&app)?.join("assets").join("avatars");
    fs::create_dir_all(&avatars_dir).map_err(|e| e.to_string())?;

    let ts = Utc::now().timestamp_millis();
    let target = avatars_dir.join(format!("avatar_{ts}.{ext}"));
    fs::copy(&picked, &target).map_err(|e| format!("Kopyalama hatasi: {e}"))?;

    let path_str = target.to_string_lossy().to_string();

    let mut settings = load_settings_from_disk(&app)?;

    // Best-effort cleanup of the prior avatar file
    if let Some(prev) = settings.avatar_path.as_ref() {
        let prev_path = PathBuf::from(prev);
        if prev_path.exists() && prev_path != target {
            let _ = fs::remove_file(&prev_path);
        }
    }

    settings.avatar_path = Some(path_str.clone());
    save_settings_to_disk(&app, &settings)?;
    Ok(path_str)
}

/// Settings → Studio → Studio logo. The image is copied into the
/// app-local `assets/studio/` folder (the studio identity is per machine,
/// like the avatar) so the original can be moved or deleted. The previous
/// logo file is removed when it lives in that folder.
#[tauri::command]
fn pick_and_save_studio_logo(app: AppHandle, previous: Option<String>) -> Result<String, String> {
    let picked = FileDialog::new()
        .set_title("Studyo logosu sec")
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "gif", "svg"])
        .pick_file()
        .ok_or_else(|| "Logo secimi iptal edildi.".to_string())?;
    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let dir = root_dir(&app)?.join("assets").join("studio");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("logo_{}.{ext}", Utc::now().timestamp_millis()));
    fs::copy(&picked, &target).map_err(|e| format!("Kopyalama hatasi: {e}"))?;
    if let Some(prev) = previous.filter(|p| !p.is_empty()) {
        remove_studio_logo_file(&dir, &prev);
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn clear_studio_logo(app: AppHandle, path: String) -> Result<(), String> {
    let dir = root_dir(&app)?.join("assets").join("studio");
    remove_studio_logo_file(&dir, &path);
    Ok(())
}

/// Only ever deletes files inside our own `assets/studio/` folder.
fn remove_studio_logo_file(dir: &Path, path: &str) {
    let p = PathBuf::from(path);
    if p.parent().map_or(false, |parent| parent == dir) && p.is_file() {
        let _ = fs::remove_file(p);
    }
}

#[tauri::command]
fn clear_avatar(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    if let Some(prev) = settings.avatar_path.take() {
        let p = PathBuf::from(&prev);
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }
    save_settings_to_disk(&app, &settings)
}

#[tauri::command]
fn save_api_keys(
    app: AppHandle,
    steam_api_key: Option<String>,
    itch_api_key: Option<String>,
    steam_user_id: Option<String>,
    google_play_json_path: Option<String>,
) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    let cleanup = |v: Option<String>| -> Option<String> {
        v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    };
    settings.steam_api_key = cleanup(steam_api_key);
    settings.itch_api_key = cleanup(itch_api_key);
    settings.steam_user_id = cleanup(steam_user_id);
    settings.google_play_json_path = cleanup(google_play_json_path);
    save_settings_to_disk(&app, &settings)
}

#[tauri::command]
fn pick_google_play_json() -> Result<String, String> {
    let picked = FileDialog::new()
        .set_title("Google Play Service Account JSON")
        .add_filter("JSON", &["json"])
        .pick_file()
        .ok_or_else(|| "JSON secimi iptal edildi.".to_string())?;
    Ok(picked.to_string_lossy().to_string())
}

/// v0.9.8 — Local asset reference picker for the notes editor.
///
/// Returns the **absolute path** of an image/audio file the user picks.
/// Crucially it does NOT copy the file anywhere: the renderer feeds this
/// path through `convertFileSrc` so the WebView streams the bytes
/// straight off the user's disk via the `asset:` protocol. This keeps a
/// 200 MB reference image out of the (cloud-synced) workspace folder —
/// the note only stores the path string.
///
/// The trade-off the caller must own: the reference breaks if the user
/// moves/renames the source file. That's an acceptable, well-understood
/// contract for a local-first tool (same as a Markdown `![](C:/…)` link).
#[tauri::command]
fn pick_asset_file() -> Result<String, String> {
    let picked = FileDialog::new()
        .set_title("Görsel veya ses dosyası seç")
        .add_filter(
            "Medya",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg",
                "wav", "mp3", "ogg", "flac", "m4a", "aac",
            ],
        )
        .add_filter("Tüm dosyalar", &["*"])
        .pick_file()
        .ok_or_else(|| "Dosya seçimi iptal edildi.".to_string())?;
    Ok(picked.to_string_lossy().to_string())
}

#[tauri::command]
fn save_store_mapping(
    app: AppHandle,
    game_id: String,
    store_key: String,
    mapped_id: String,
    mapped_title: String,
) -> Result<GameRecord, String> {
    let _io = io_lock();
    let mut games = load_games_from_disk(&app)?;
    let index = games
        .iter()
        .position(|item| item.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let mut game = games[index].clone();
    let id_trimmed = mapped_id.trim().to_string();
    if id_trimmed.is_empty() {
        return Err("Magaza ID bos olamaz.".into());
    }
    let title_trimmed = mapped_title.trim().to_string();
    let entry = StoreMappingEntry {
        id: id_trimmed,
        title: title_trimmed,
    };

    match store_key.as_str() {
        "steam" => game.store_mappings.steam = Some(entry),
        "itch" => game.store_mappings.itch = Some(entry),
        "play" => game.store_mappings.play = Some(entry),
        _ => return Err("Gecersiz magaza anahtari.".into()),
    }

    game.updated_at = now_iso();
    games[index] = game.clone();
    save_games_to_disk(&app, &games)?;
    Ok(game)
}

#[tauri::command]
fn unlink_store_mapping(
    app: AppHandle,
    game_id: String,
    store_key: String,
) -> Result<GameRecord, String> {
    let _io = io_lock();
    let mut games = load_games_from_disk(&app)?;
    let index = games
        .iter()
        .position(|item| item.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let mut game = games[index].clone();
    match store_key.as_str() {
        "steam" => game.store_mappings.steam = None,
        "itch" => game.store_mappings.itch = None,
        "play" => game.store_mappings.play = None,
        _ => return Err("Gecersiz magaza anahtari.".into()),
    }
    game.updated_at = now_iso();
    games[index] = game.clone();
    save_games_to_disk(&app, &games)?;
    Ok(game)
}

fn build_http_client() -> Result<reqwest::Client, String> {
    // v0.9.7 resilience pass — separate connect_timeout from the
    // overall request timeout. The previous `.timeout(15s)` only
    // covers "first byte received"; a DNS hang or unanswered SYN on
    // Windows can sit for the full TCP retry budget (~2 min) before
    // surfacing. `connect_timeout(8s)` makes "no network" feel like
    // 8 seconds instead of 2 minutes; overall `.timeout(20s)` then
    // bounds the slowest reasonable cold provider response.
    reqwest::Client::builder()
        .user_agent("HeraVex/0.1")
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP istemci hatasi: {e}"))
}

#[tauri::command]
async fn fetch_store_games(
    provider: String,
    api_key: String,
    user_id: Option<String>,
) -> Result<Vec<StoreGameInfo>, String> {
    let key = api_key.trim().to_string();
    if key.is_empty() {
        return Err("API anahtari bos.".into());
    }
    let client = build_http_client()?;

    match provider.as_str() {
        "itch" => {
            // itch.io: GET https://itch.io/api/1/{key}/my-games
            let url = format!("https://itch.io/api/1/{}/my-games", key);
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Itch.io istek hatasi: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("Itch.io API kod: {}", resp.status()));
            }
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Itch.io JSON hatasi: {e}"))?;
            let games_arr = json
                .get("games")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            Ok(games_arr
                .into_iter()
                .map(|g| StoreGameInfo {
                    id: g.get("id").map(|v| v.to_string()).unwrap_or_default(),
                    title: g
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled")
                        .to_string(),
                    cover_url: g
                        .get("cover_url")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                })
                .collect())
        }
        "steam" => {
            // Steam owned games — requires steamid (64-bit, 17-digit numeric)
            let steam_id = user_id
                .ok_or_else(|| "Steam icin steamid64 gerekli.".to_string())?;
            let sid = steam_id.trim();
            if sid.len() != 17 || !sid.chars().all(|c| c.is_ascii_digit()) {
                return Err("Steam: steamid64 17 haneli sayisal olmalidir (orn. 76561198XXXXXXXXX).".into());
            }
            let url = format!(
                "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_appinfo=1&format=json",
                key, sid
            );
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Steam: ag baglanti hatasi ({e})"))?;
            let status = resp.status();
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err("Steam: API anahtari yetkisi reddedildi. Web API key dogru mu?".into());
            }
            if status.as_u16() == 429 {
                return Err("Steam: cok fazla istek (rate limit).".into());
            }
            if !status.is_success() {
                return Err(format!("Steam API kod: {status}"));
            }
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Steam JSON hatasi: {e}"))?;
            let games_arr = json
                .pointer("/response/games")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            Ok(games_arr
                .into_iter()
                .map(|g| {
                    let appid = g.get("appid").map(|v| v.to_string()).unwrap_or_default();
                    let cover = g
                        .get("img_icon_url")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|hash| {
                            format!(
                                "https://media.steampowered.com/steamcommunity/public/images/apps/{}/{}.jpg",
                                appid, hash
                            )
                        });
                    StoreGameInfo {
                        id: appid,
                        title: g
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Untitled")
                            .to_string(),
                        cover_url: cover,
                    }
                })
                .collect())
        }
        _ => Err(format!("Bilinmeyen saglayici: {provider}")),
    }
}

/// Stale-cache wrapper around the live HTTP path. Closes the
/// resilience review's #4: offline / API down → infinite spinner →
/// crash. After every successful live fetch we drop the result into
/// `<data_root>/cache/store_<provider>_<id>.json`. On the next call,
/// if the live fetch fails for any reason, we return the cached
/// copy with no further error so the UI keeps rendering the last
/// known good numbers. The cache file is best-effort — disk failures
/// don't propagate.
#[tauri::command]
async fn fetch_store_data(
    app: AppHandle,
    provider: String,
    external_id: String,
) -> Result<StoreData, String> {
    let id = external_id.trim().to_string();
    if id.is_empty() {
        return Err("Magaza ID bos.".into());
    }
    let cache_path = (|| -> Option<PathBuf> {
        let root = data_root(&app).ok()?;
        Some(root.join("cache").join(format!(
            "store_{}_{}.json",
            provider, safe_id_filename(&id),
        )))
    })();

    match fetch_store_data_live(app.clone(), provider.clone(), id.clone()).await {
        Ok(data) => {
            if let Some(path) = cache_path.as_ref() {
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if let Ok(json) = serde_json::to_string(&data) {
                    let _ = atomic_write(path, json.as_bytes());
                }
            }
            Ok(data)
        }
        Err(live_err) => {
            // Live failed — try the stale cache so the UI doesn't
            // blank out a panel just because Steam is having a bad
            // afternoon. We log the original error so the user can
            // tell from the dev console why they're seeing stale.
            if let Some(path) = cache_path.as_ref() {
                if let Ok(raw) = fs::read_to_string(path) {
                    if let Ok(cached) = serde_json::from_str::<StoreData>(&raw) {
                        eprintln!(
                            "[fetch_store_data] live failed for {provider}/{id} ({live_err}); served cached copy"
                        );
                        return Ok(cached);
                    }
                }
            }
            Err(live_err)
        }
    }
}

async fn fetch_store_data_live(
    app: AppHandle,
    provider: String,
    external_id: String,
) -> Result<StoreData, String> {
    let id = external_id.trim().to_string();
    if id.is_empty() {
        return Err("Magaza ID bos.".into());
    }
    println!("[fetch_store_data] provider={provider} id={id}");

    let settings = load_settings_from_disk(&app)?;
    let client = build_http_client()?;

    match provider.as_str() {
        "steam" => {
            // ── AppID validation: must be numeric, 1..7 digits typically ──
            if !id.chars().all(|c| c.is_ascii_digit()) || id.is_empty() {
                return Err("Steam: AppID sadece rakam olmalidir (orn. 730).".into());
            }

            // appdetails — storefront descriptor
            let url = format!(
                "https://store.steampowered.com/api/appdetails?appids={id}&cc=us&l=en"
            );
            println!("[fetch_store_data] GET {url}");
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Steam: ag baglanti hatasi ({e})"))?;
            let status = resp.status();
            let body = resp
                .text()
                .await
                .map_err(|e| format!("Steam: yanit okuma hatasi ({e})"))?;
            if status.as_u16() == 429 {
                return Err("Steam: cok fazla istek (rate limit). Birkaç dakika sonra tekrar dene.".into());
            }
            if !status.is_success() {
                println!("[fetch_store_data] steam non-2xx: status={status} body={body}");
                return Err(format!("Steam storefront kod: {status}"));
            }

            let json: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| format!("Steam JSON parse hatasi: {e} | body={}",
                    truncate_for_log(&body, 200)))?;

            let app_obj = json.get(&id).cloned().unwrap_or(serde_json::Value::Null);
            let success = app_obj
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !success {
                println!("[fetch_store_data] steam appdetails success=false for id={id}");
                return Err(format!("Steam: AppID {id} icin veri bulunamadi (gizli ya da gecersiz)."));
            }

            let data = app_obj
                .get("data")
                .cloned()
                .unwrap_or(serde_json::Value::Null);

            // recommendations/total exists only for released titles
            let recs = data
                .pointer("/recommendations/total")
                .and_then(|v| v.as_u64());
            let coming_soon = data
                .pointer("/release_date/coming_soon")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            // ── Wishlist (public profile only, fragile endpoint) ──
            // Only attempt when game is coming_soon (Steam doesn't expose post-release wishlist publicly).
            let wishlist = if coming_soon {
                fetch_steam_wishlist(&client, &settings).await
            } else {
                None
            };

            println!(
                "[fetch_store_data] steam parsed: recs={:?} coming_soon={coming_soon} wishlist={:?}",
                recs, wishlist
            );

            // ── Reviews via appreviews (real user score + count) ──
            let (review_score, review_count) = fetch_steam_reviews(&client, &id).await;

            // Fall back to metacritic if no user reviews available
            let metacritic = data.pointer("/metacritic/score").and_then(|v| v.as_u64());
            let rating_average = review_score.or_else(|| metacritic.map(|s| (s as f64) / 20.0));
            let rating_count = review_count.or(recs);

            // ── Concurrent players (ISteamUserStats) ──
            let players_url = format!(
                "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={id}"
            );
            let current_players: Option<u64> = match client.get(&players_url).send().await {
                Ok(r) if r.status().is_success() => {
                    let body = r.text().await.unwrap_or_default();
                    serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| v.pointer("/response/player_count").and_then(|x| x.as_u64()))
                }
                Ok(r) => {
                    println!("[fetch_store_data] steam CCU non-2xx: {}", r.status());
                    None
                }
                Err(e) => {
                    println!("[fetch_store_data] steam CCU err: {e}");
                    None
                }
            };

            // ── Latest news (ISteamNews) ──
            let news_url = format!(
                "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={id}&count=1&maxlength=300&format=json"
            );
            let (last_news_title, last_news_url, last_news_at) =
                match client.get(&news_url).send().await {
                    Ok(r) if r.status().is_success() => {
                        let body = r.text().await.unwrap_or_default();
                        let v: serde_json::Value =
                            serde_json::from_str(&body).unwrap_or_default();
                        let item = v.pointer("/appnews/newsitems/0").cloned();
                        if let Some(n) = item {
                            let title =
                                n.get("title").and_then(|x| x.as_str()).map(|s| s.to_string());
                            let url =
                                n.get("url").and_then(|x| x.as_str()).map(|s| s.to_string());
                            let date_iso = n
                                .get("date")
                                .and_then(|x| x.as_i64())
                                .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
                                .map(|dt| dt.to_rfc3339());
                            (title, url, date_iso)
                        } else {
                            (None, None, None)
                        }
                    }
                    Ok(r) => {
                        println!("[fetch_store_data] steam news non-2xx: {}", r.status());
                        (None, None, None)
                    }
                    Err(e) => {
                        println!("[fetch_store_data] steam news err: {e}");
                        (None, None, None)
                    }
                };

            println!(
                "[fetch_store_data] steam deep: ccu={:?} news_title={:?}",
                current_players, last_news_title
            );

            Ok(StoreData {
                wishlist,
                views: None,
                downloads: None,
                purchases: recs,
                earnings: None,
                currency: None,
                current_players,
                rating_average,
                rating_count,
                last_news_title,
                last_news_url,
                last_news_at,
                active_installs: None,
                uninstalls: None,
            })
        }
        "itch" => {
            // Itch.io has no public /game/{id} endpoint with stats — we fetch /my-games and locate by id.
            let key = settings
                .itch_api_key
                .ok_or_else(|| "Itch.io API anahtari kayitli degil.".to_string())?;
            let url = format!("https://itch.io/api/1/{}/my-games", key);
            println!("[fetch_store_data] GET itch /my-games (key redacted)");
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Itch.io istek hatasi: {e}"))?;
            let status = resp.status();
            let body = resp
                .text()
                .await
                .map_err(|e| format!("Itch.io yanit okuma hatasi: {e}"))?;
            if !status.is_success() {
                println!("[fetch_store_data] itch non-2xx status={status} body={}",
                    truncate_for_log(&body, 200));
                return Err(format!("Itch.io API kod: {status}"));
            }
            let json: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| format!("Itch.io JSON parse hatasi: {e}"))?;

            if let Some(err) = json.get("errors").and_then(|v| v.as_array()) {
                if !err.is_empty() {
                    let msg = err.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ");
                    println!("[fetch_store_data] itch errors: {msg}");
                    return Err(format!("Itch.io hatasi: {msg}"));
                }
            }

            let games = json
                .get("games")
                .and_then(|v| v.as_array())
                .cloned()
                .ok_or_else(|| {
                    println!("[fetch_store_data] itch payload had no 'games' array: {}",
                        truncate_for_log(&body, 200));
                    "Veri okunamadi (JSON format uyumsuzlugu)".to_string()
                })?;

            // Match by id — itch returns numeric, our stored mapping is the stringified form.
            let target = games.into_iter().find(|g| {
                let candidate = g.get("id").map(|v| v.to_string());
                let trimmed = candidate
                    .as_deref()
                    .map(|s| s.trim_matches('"'))
                    .unwrap_or("");
                trimmed == id
            });

            let g = match target {
                Some(v) => v,
                None => {
                    println!("[fetch_store_data] itch: id={id} not found in /my-games");
                    return Err(format!(
                        "Itch.io: id={id} hesabinizdaki oyunlar arasinda bulunamadi."
                    ));
                }
            };
            println!("[fetch_store_data] itch matched payload: {}",
                truncate_for_log(&g.to_string(), 320));

            let parse_amount = |e: &serde_json::Value| -> Option<f64> {
                if let Some(s) = e.get("amount_formatted").and_then(|v| v.as_str()) {
                    return s.chars()
                        .filter(|c| c.is_ascii_digit() || *c == '.')
                        .collect::<String>()
                        .parse::<f64>()
                        .ok();
                }
                e.get("amount")
                    .and_then(|v| v.as_f64())
                    .map(|cents| cents / 100.0)
            };

            let views = g.get("views_count").and_then(|v| v.as_u64());
            let downloads = g.get("downloads_count").and_then(|v| v.as_u64());
            let purchases = g.get("purchases_count").and_then(|v| v.as_u64());
            let earnings_arr = g.get("earnings").and_then(|v| v.as_array()).cloned();
            let earnings = earnings_arr.as_ref().and_then(|arr| arr.first()).and_then(parse_amount);
            let currency = earnings_arr
                .as_ref()
                .and_then(|arr| arr.first())
                .and_then(|e| e.get("currency"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // ── Itch deep stats ──
            let rating_count = g.get("rating_count").and_then(|v| v.as_u64());
            let rating_average = g
                .get("rating")
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    g.get("rating")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                });

            if views.is_none()
                && downloads.is_none()
                && purchases.is_none()
                && earnings.is_none()
                && rating_count.is_none()
            {
                println!("[fetch_store_data] itch: all metrics None for id={id}");
                return Err("Veri okunamadi (JSON format uyumsuzlugu)".into());
            }

            let result = StoreData {
                wishlist: None,
                views,
                downloads,
                purchases,
                earnings,
                currency,
                current_players: None,
                rating_average,
                rating_count,
                last_news_title: None,
                last_news_url: None,
                last_news_at: None,
                active_installs: None,
                uninstalls: None,
            };
            println!("[fetch_store_data] itch parsed: {result:?}");
            Ok(result)
        }
        "play" => fetch_google_play(&client, &settings, &id).await,
        _ => Err(format!("Bilinmeyen saglayici: {provider}")),
    }
}

#[derive(Debug, Deserialize)]
struct GooglePlayServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: String,
}

#[derive(Debug, Serialize)]
struct GooglePlayJwtClaims {
    iss: String,
    scope: String,
    aud: String,
    iat: i64,
    exp: i64,
}

async fn google_play_access_token(
    client: &reqwest::Client,
    settings: &AppSettings,
) -> Result<String, String> {
    let path = settings
        .google_play_json_path
        .as_ref()
        .ok_or_else(|| "Google Play: Service Account JSON kayitli degil.".to_string())?;

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("Google Play: JSON okunamadi ({e})"))?;
    let sa: GooglePlayServiceAccount = serde_json::from_str(&raw)
        .map_err(|e| format!("Google Play: JSON yapisi gecersiz ({e})"))?;

    let now = Utc::now().timestamp();
    let claims = GooglePlayJwtClaims {
        iss: sa.client_email.clone(),
        scope: "https://www.googleapis.com/auth/androidpublisher".to_string(),
        aud: sa.token_uri.clone(),
        iat: now,
        exp: now + 3600,
    };

    let encoding_key = jsonwebtoken::EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .map_err(|e| format!("Google Play: Auth Error (private_key parse: {e})"))?;
    let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    let jwt = jsonwebtoken::encode(&header, &claims, &encoding_key)
        .map_err(|e| format!("Google Play: Auth Error (jwt sign: {e})"))?;

    let resp = client
        .post(&sa.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Google Play: token istek hatasi ({e})"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Google Play: token yanit okuma hatasi ({e})"))?;
    if !status.is_success() {
        println!("[google_play] token exchange failed {status}: {}",
            truncate_for_log(&body, 200));
        return Err(format!("Google Play: Auth Error ({status})"));
    }

    let token_json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Google Play: token JSON parse hatasi ({e})"))?;
    token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Google Play: access_token bulunamadi.".to_string())
}

async fn fetch_google_play(
    client: &reqwest::Client,
    settings: &AppSettings,
    package_name: &str,
) -> Result<StoreData, String> {
    let token = google_play_access_token(client, settings).await?;

    // Reviews endpoint — used as a downloads/engagement proxy.
    let url = format!(
        "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package_name}/reviews?maxResults=100"
    );
    println!("[fetch_google_play] GET {url}");

    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Google Play: istek hatasi ({e})"))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Google Play: yanit okuma hatasi ({e})"))?;
    if !status.is_success() {
        println!("[fetch_google_play] non-2xx {status}: {}",
            truncate_for_log(&body, 200));
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(format!("Google Play: Auth Error ({status})"));
        }
        return Err(format!("Google Play API kod: {status}"));
    }

    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Google Play: JSON parse hatasi ({e})"))?;

    let reviews = json
        .get("reviews")
        .and_then(|v| v.as_array())
        .map(|a| a.len() as u64)
        .unwrap_or(0);

    // Average star rating across the reviews we just pulled (best signal we have without
    // requiring access to the separate Reporting API).
    let mut star_sum = 0u64;
    let mut star_count = 0u64;
    if let Some(arr) = json.get("reviews").and_then(|v| v.as_array()) {
        for r in arr {
            if let Some(stars) = r
                .pointer("/comments/0/userComment/starRating")
                .and_then(|v| v.as_u64())
            {
                star_sum += stars;
                star_count += 1;
            }
        }
    }
    let avg_stars = if star_count > 0 {
        Some((star_sum as f64) / (star_count as f64))
    } else {
        None
    };

    // ── Optional installs/uninstalls via Reporting API (best-effort) ──
    let reporting_url = format!(
        "https://playdeveloperreporting.googleapis.com/v1beta1/apps/{package_name}/installsMetricSet:query"
    );
    let body = serde_json::json!({
        "timelineSpec": {
            "aggregationPeriod": "DAILY",
            "endTime": { "year": 9999 }
        },
        "metrics": ["activeDeviceInstalls", "userInstallsLast30Days", "userUninstallsLast30Days"]
    });
    let (active_installs, uninstalls): (Option<u64>, Option<u64>) = match client
        .post(&reporting_url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let raw = r.text().await.unwrap_or_default();
            let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
            let installs = v
                .pointer("/rows/0/metrics/activeDeviceInstalls/decimalValue/value")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| {
                    v.pointer("/rows/0/metrics/userInstallsLast30Days/decimalValue/value")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse::<u64>().ok())
                });
            let unins = v
                .pointer("/rows/0/metrics/userUninstallsLast30Days/decimalValue/value")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<u64>().ok());
            (installs, unins)
        }
        Ok(r) => {
            println!("[fetch_google_play] reporting non-2xx: {}", r.status());
            (None, None)
        }
        Err(e) => {
            println!("[fetch_google_play] reporting err: {e}");
            (None, None)
        }
    };

    println!(
        "[fetch_google_play] parsed reviews={reviews} avg_stars={:?} installs={:?} uninstalls={:?}",
        avg_stars, active_installs, uninstalls
    );

    Ok(StoreData {
        wishlist: None,
        views: Some(reviews),
        downloads: active_installs.or(Some(reviews)),
        purchases: Some(reviews),
        earnings: None,
        currency: None,
        current_players: None,
        rating_average: avg_stars,
        rating_count: Some(reviews),
        last_news_title: None,
        last_news_url: None,
        last_news_at: None,
        active_installs,
        uninstalls,
    })
}

fn truncate_for_log(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}…(+{} chars)", &s[..max], s.len() - max) }
}

// ── Steam helpers ───────────────────────────────────────────────────────
//
// `appreviews` is a public, documented endpoint returning `query_summary`
// with the real user score (0..1) and total review count. We map it to a
// 0..5 star scale to match the rest of the dashboard.
async fn fetch_steam_reviews(
    client: &reqwest::Client,
    appid: &str,
) -> (Option<f64>, Option<u64>) {
    let url = format!(
        "https://store.steampowered.com/appreviews/{appid}?json=1&purchase_type=all&language=all&review_type=all&num_per_page=0"
    );
    println!("[steam_reviews] GET {url}");
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => {
            let body = r.text().await.unwrap_or_default();
            let v: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => {
                    println!("[steam_reviews] JSON parse err: {e}");
                    return (None, None);
                }
            };
            let qs = v.get("query_summary").cloned().unwrap_or_default();
            let score = qs
                .get("review_score")           // 0..10 integer band
                .and_then(|x| x.as_u64())
                .map(|s| (s as f64) / 2.0);    // → 0..5
            let total = qs
                .get("total_reviews")
                .and_then(|x| x.as_u64());
            (score, total)
        }
        Ok(r) => {
            println!("[steam_reviews] non-2xx: {}", r.status());
            (None, None)
        }
        Err(e) => {
            println!("[steam_reviews] err: {e}");
            (None, None)
        }
    }
}

// Wishlist count from the legacy public `wishlistdata` endpoint.
// Requires the user's Steam profile to be public and a steam_user_id (steamid64) set.
// Endpoint is undocumented and may change — we retry once and surface clean None on failure.
async fn fetch_steam_wishlist(
    client: &reqwest::Client,
    settings: &AppSettings,
) -> Option<u64> {
    let sid = settings.steam_user_id.as_ref().filter(|s| !s.is_empty())?;
    // steamid64 sanity: 17 digit numeric (76561197960265728+)
    if sid.len() != 17 || !sid.chars().all(|c| c.is_ascii_digit()) {
        println!("[steam_wishlist] skipped — invalid steamid64 format");
        return None;
    }

    let url = format!(
        "https://store.steampowered.com/wishlist/profiles/{sid}/wishlistdata/?p=0"
    );
    for attempt in 0..2u8 {
        println!("[steam_wishlist] GET attempt {attempt} {url}");
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => {
                let body = r.text().await.unwrap_or_default();
                // Response is either {"...appid...": {...}} (success) or [] (private/no items)
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(obj) = v.as_object() {
                        return Some(obj.len() as u64);
                    }
                    if v.as_array().is_some() {
                        // Private profile or empty wishlist — distinguish at the UI layer if needed
                        return Some(0);
                    }
                }
                return None;
            }
            Ok(r) => {
                println!("[steam_wishlist] non-2xx: {}", r.status());
                if attempt == 1 { return None; }
            }
            Err(e) => {
                println!("[steam_wishlist] err: {e}");
                if attempt == 1 { return None; }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    None
}

#[tauri::command(async)]
fn get_all_notes(app: AppHandle) -> Result<Vec<NoteRecord>, String> {
    let _io = io_lock();
    // UI listing: a partial list beats a frozen screen. Write paths keep
    // the strict loader so a skipped note is never deleted as an orphan.
    let (mut notes, unreadable) = scan_notes_from_disk(&app)?;
    if !unreadable.is_empty() {
        let _ = app.emit("workspace-read-stalled", unreadable);
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

/// Read ONE note straight off disk (cheap single-file read) — used by the
/// team-mode 3-way merge to compare the current on-disk version against
/// the base the editor started from. Returns None when the file is
/// absent or unparseable.
#[tauri::command(async)]
fn read_note(app: AppHandle, note_id: String) -> Result<Option<NoteRecord>, String> {
    let _io = io_lock();
    let path = notes_dir(&app)?.join(format!("{}.json", safe_id_filename(&note_id)));
    if !path.exists() { return Ok(None); }
    let raw = match read_text_guarded(&path) { Ok(r) => r, Err(_) => return Ok(None) };
    Ok(serde_json::from_str::<NoteRecord>(&raw).ok())
}

#[tauri::command(async)]
fn save_note(app: AppHandle, mut note: NoteRecord) -> Result<NoteRecord, String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let is_new = note.id.trim().is_empty();
    if note.title.trim().is_empty() {
        note.title = "Yeni Not".into();
    }
    if is_new {
        note.id = next_id();
    }
    note.updated_at = now_iso();

    // Atomic per-id write: only this one file changes on disk.
    save_single_note_to_disk(&app, &note)?;
    if is_new {
        append_activity(&app, "note.created", Some(note.title.clone()));
    }
    Ok(note)
}

#[tauri::command(async)]
fn delete_note(app: AppHandle, note_id: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let mut notes = load_notes_from_disk(&app)?;
    let removed_title = notes.iter().find(|n| n.id == note_id).map(|n| n.title.clone());
    notes.retain(|n| n.id != note_id);
    save_notes_to_disk(&app, &notes)?;
    append_activity(&app, "note.deleted", removed_title);
    notify_windows(&app, "notes", Vec::new());
    Ok(())
}

// ── Flow Center storage (v0.9.8) ────────────────────────────────────────────
//
// Same atomic-per-id contract as notes: snapshot `.bak` before every
// write, `atomic_write` (tmp+rename, cloud-lock retry), and `.bak`
// recovery on a corrupt load. Flows therefore inherit the full v0.9.7
// resilience guarantees rather than being second-class.

fn save_single_flow_to_disk(app: &AppHandle, flow: &Flow) -> Result<(), String> {
    let path = flows_dir(app)?.join(format!("{}.json", safe_id_filename(&flow.id)));
    snapshot_before_write(&path);
    let payload = serde_json::to_string_pretty(flow).map_err(|e| e.to_string())?;
    atomic_write(&path, payload.as_bytes())
}

fn load_flows_from_disk(app: &AppHandle) -> Result<Vec<Flow>, String> {
    let dir = flows_dir(app)?;
    let mut flows: Vec<Flow> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        let raw = match read_text_guarded(&path) {
            Ok(r) => r,
            Err(_) => continue,
        };
        match serde_json::from_str::<Flow>(&raw) {
            Ok(f) => flows.push(f),
            Err(parse_err) => {
                // Mirror the notes/games recovery flow: quarantine the
                // bad live file, then try the `.bak` snapshot.
                let corrupt = path.with_extension("json.corrupt");
                let _ = fs::rename(&path, &corrupt);
                let bak = path.with_extension("json.bak");
                if bak.exists() {
                    if let Ok(bak_raw) = fs::read_to_string(&bak) {
                        if let Ok(f) = serde_json::from_str::<Flow>(&bak_raw) {
                            let _ = fs::copy(&bak, &path);
                            println!(
                                "[load_flows] RECOVERY from .bak for {} — parse err was: {parse_err}",
                                path.display()
                            );
                            flows.push(f);
                            continue;
                        }
                    }
                }
                eprintln!(
                    "[load_flows] CORRUPT (no usable .bak): {} → {} ; original error: {parse_err}",
                    path.display(),
                    corrupt.display()
                );
            }
        }
    }
    flows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(flows)
}

#[tauri::command(async)]
fn load_flows(app: AppHandle) -> Result<Vec<Flow>, String> {
    let _io = io_lock();
    load_flows_from_disk(&app)
}

#[tauri::command(async)]
fn save_flow(app: AppHandle, mut flow: Flow) -> Result<Flow, String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let is_new = flow.id.trim().is_empty();
    if flow.id.trim().is_empty() {
        flow.id = next_id();
    }
    if flow.name.trim().is_empty() {
        flow.name = "Yeni Flow".into();
    }
    flow.updated_at = now_iso();
    save_single_flow_to_disk(&app, &flow)?;
    if is_new {
        append_activity(&app, "flow.created", Some(flow.name.clone()));
    }
    notify_windows(&app, "flows", Vec::new());
    Ok(flow)
}

#[tauri::command(async)]
fn delete_flow(app: AppHandle, flow_id: String) -> Result<(), String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let dir = flows_dir(&app)?;
    let stem = safe_id_filename(&flow_id);
    for ext in ["json", "json.bak", "json.corrupt"] {
        let p = dir.join(format!("{stem}.{ext}"));
        if p.exists() { let _ = fs::remove_file(&p); }
    }
    append_activity(&app, "flow.deleted", None);
    notify_windows(&app, "flows", Vec::new());
    Ok(())
}

#[tauri::command]
fn export_global_note_pdf(app: AppHandle, note_id: String) -> Result<String, String> {
    let notes = load_notes_from_disk(&app)?;
    let note = notes
        .into_iter()
        .find(|n| n.id == note_id)
        .ok_or_else(|| "Not bulunamadi.".to_string())?;

    let save_path = FileDialog::new()
        .set_title("Notu PDF olarak kaydet")
        .add_filter("PDF", &["pdf"])
        .set_file_name(&format!(
            "{}-{}.pdf",
            slugify(&note.title),
            Utc::now().format("%Y%m%d")
        ))
        .save_file()
        .ok_or_else(|| "PDF disa aktarma iptal edildi.".to_string())?;

    render_markdown_pdf(MarkdownPdfRequest {
        title: note.title.clone(),
        subtitle: "Studio Knowledge Base".into(),
        eyebrow_top: "HERAVEX".into(),
        eyebrow_subtitle: "STUDIO KNOWLEDGE BASE".into(),
        meta_line: note
            .category
            .as_ref()
            .map(|c| format!("Category: {c}"))
            .unwrap_or_else(|| "Category: General".into()),
        summary: String::new(),
        body_markdown: note.content,
        save_path,
    })
}

#[tauri::command]
fn export_notes_pdf(app: AppHandle, game_id: String) -> Result<String, String> {
    let games = load_games_from_disk(&app)?;
    let game = games
        .iter()
        .find(|g| g.id == game_id)
        .cloned()
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    let save_path = FileDialog::new()
        .set_title("GDD PDF Kaydet")
        .add_filter("PDF", &["pdf"])
        .set_file_name(&format!(
            "{}-gdd-{}.pdf",
            slugify(&game.title),
            Utc::now().format("%Y%m%d")
        ))
        .save_file()
        .ok_or_else(|| "PDF disa aktarma iptal edildi.".to_string())?;

    let platforms = if game.platforms.is_empty() {
        "—".to_string()
    } else {
        game.platforms.join(", ")
    };

    render_markdown_pdf(MarkdownPdfRequest {
        title: game.title.clone(),
        subtitle: format!("Status: {}", game.status),
        eyebrow_top: "HERAVEX".into(),
        eyebrow_subtitle: "GAME DESIGN DOCUMENT".into(),
        meta_line: format!("PLATFORMS — {platforms}"),
        summary: game.summary,
        body_markdown: game.notes,
        save_path,
    })
}

struct MarkdownPdfRequest {
    title: String,
    subtitle: String,
    eyebrow_top: String,
    eyebrow_subtitle: String,
    meta_line: String,
    summary: String,
    body_markdown: String,
    save_path: PathBuf,
}

fn render_markdown_pdf(req: MarkdownPdfRequest) -> Result<String, String> {
    use printpdf::*;
    use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};

    let MarkdownPdfRequest {
        title,
        subtitle,
        eyebrow_top,
        eyebrow_subtitle,
        meta_line,
        summary,
        body_markdown,
        save_path,
    } = req;

    // ── Document setup ────────────────────────────────────────────────────
    let (doc, page1, layer1) = PdfDocument::new(
        &format!("{} — {}", title, eyebrow_subtitle),
        Mm(210.0),
        Mm(297.0),
        "Page 1",
    );
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Font hatasi: {e}"))?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Font hatasi: {e}"))?;
    let font_italic = doc
        .add_builtin_font(BuiltinFont::HelveticaOblique)
        .map_err(|e| format!("Font hatasi: {e}"))?;
    let font_mono = doc
        .add_builtin_font(BuiltinFont::Courier)
        .map_err(|e| format!("Font hatasi: {e}"))?;

    let mut current_page = page1;
    let mut current_layer = doc.get_page(current_page).get_layer(layer1);
    let mut y: f32 = 270.0;
    let left: f32 = 20.0;
    let max_width_chars: usize = 90;
    let page_bottom: f32 = 25.0;

    let new_page = |doc: &PdfDocumentReference| -> (PdfPageIndex, PdfLayerIndex) {
        let (p, l) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
        (p, l)
    };

    let mut ensure_space = |needed: f32,
                            doc: &PdfDocumentReference,
                            current_page: &mut PdfPageIndex,
                            current_layer_ref: &mut PdfLayerReference,
                            y: &mut f32| {
        if *y - needed < page_bottom {
            let (p, l) = new_page(doc);
            *current_page = p;
            *current_layer_ref = doc.get_page(p).get_layer(l);
            *y = 280.0;
        }
    };

    // ── Cover page ────────────────────────────────────────────────────────
    current_layer.use_text(&eyebrow_top, 11.0, Mm(left), Mm(280.0), &font_bold);
    current_layer.use_text(&eyebrow_subtitle, 9.0, Mm(left), Mm(274.0), &font_regular);

    // Title block
    current_layer.use_text(&title, 32.0, Mm(left), Mm(220.0), &font_bold);
    if !subtitle.is_empty() {
        current_layer.use_text(&subtitle, 11.0, Mm(left), Mm(210.0), &font_italic);
    }

    if !meta_line.is_empty() {
        current_layer.use_text(&meta_line, 10.0, Mm(left), Mm(192.0), &font_regular);
    }

    if !summary.is_empty() {
        current_layer.use_text("SUMMARY", 8.0, Mm(left), Mm(175.0), &font_bold);
        let summary_lines = wrap_text(&summary, max_width_chars);
        let mut sy: f32 = 170.0;
        for line in summary_lines.iter().take(8) {
            current_layer.use_text(line, 10.0, Mm(left), Mm(sy), &font_regular);
            sy -= 5.0;
        }
    }

    // Footer of cover
    current_layer.use_text("Version 1.0", 10.0, Mm(left), Mm(35.0), &font_bold);
    current_layer.use_text(
        &Utc::now().format("Generated %Y-%m-%d %H:%M UTC").to_string(),
        9.0,
        Mm(left),
        Mm(29.0),
        &font_italic,
    );

    // ── Body page ────────────────────────────────────────────────────────
    let (p, l) = new_page(&doc);
    current_page = p;
    current_layer = doc.get_page(p).get_layer(l);
    y = 280.0;

    // Parse markdown
    let parser = Parser::new(&body_markdown);
    let mut buffer = String::new();
    let mut current_font = font_regular.clone();
    let mut current_size: f32 = 11.0;
    let mut in_code = false;
    let mut in_list = false;
    let mut list_marker = "•";
    let mut list_index = 1u32;
    let mut is_ordered_list = false;

    let mut flush_paragraph =
        |buffer: &mut String,
         current_layer_ref: &mut PdfLayerReference,
         doc: &PdfDocumentReference,
         current_page: &mut PdfPageIndex,
         y: &mut f32,
         size: f32,
         font: &IndirectFontRef,
         indent: f32| {
            if buffer.trim().is_empty() {
                buffer.clear();
                return;
            }
            for line in wrap_text(buffer, max_width_chars) {
                if *y - 7.0 < page_bottom {
                    let (np, nl) = new_page(doc);
                    *current_page = np;
                    *current_layer_ref = doc.get_page(np).get_layer(nl);
                    *y = 280.0;
                }
                current_layer_ref.use_text(&line, size, Mm(left + indent), Mm(*y), font);
                *y -= size * 0.55;
            }
            buffer.clear();
        };

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    0.0,
                );
                current_font = font_bold.clone();
                current_size = match level {
                    HeadingLevel::H1 => 20.0_f32,
                    HeadingLevel::H2 => 16.0,
                    HeadingLevel::H3 => 13.5,
                    _ => 12.0,
                };
                y -= 5.0;
            }
            Event::End(TagEnd::Heading(_)) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    0.0,
                );
                current_font = font_regular.clone();
                current_size = 11.0;
                y -= 4.0;
            }
            Event::Start(Tag::CodeBlock(_)) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    0.0,
                );
                in_code = true;
                current_font = font_mono.clone();
                current_size = 9.5;
            }
            Event::End(TagEnd::CodeBlock) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    4.0,
                );
                in_code = false;
                current_font = font_regular.clone();
                current_size = 11.0;
                y -= 4.0;
            }
            Event::Start(Tag::List(start)) => {
                in_list = true;
                if let Some(start_num) = start {
                    is_ordered_list = true;
                    list_index = start_num as u32;
                    list_marker = "";
                } else {
                    is_ordered_list = false;
                    list_marker = "•";
                }
            }
            Event::End(TagEnd::List(_)) => {
                in_list = false;
                is_ordered_list = false;
                y -= 3.0;
            }
            Event::Start(Tag::Item) => {
                let marker = if is_ordered_list {
                    let m = format!("{}.", list_index);
                    list_index += 1;
                    m
                } else {
                    list_marker.to_string()
                };
                buffer.push_str(&marker);
                buffer.push(' ');
            }
            Event::End(TagEnd::Item) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    if in_list { 4.0 } else { 0.0 },
                );
            }
            Event::Start(Tag::BlockQuote(_)) => {
                buffer.push_str("| ");
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &font_italic,
                    4.0,
                );
            }
            Event::Text(t) => {
                buffer.push_str(&t);
                if in_code {
                    // Code blocks emit newlines in text — preserve them
                }
            }
            Event::Code(t) => {
                buffer.push('`');
                buffer.push_str(&t);
                buffer.push('`');
            }
            Event::SoftBreak => buffer.push(' '),
            Event::HardBreak => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    0.0,
                );
            }
            Event::End(TagEnd::Paragraph) => {
                flush_paragraph(
                    &mut buffer,
                    &mut current_layer,
                    &doc,
                    &mut current_page,
                    &mut y,
                    current_size,
                    &current_font,
                    0.0,
                );
                y -= 3.0;
            }
            Event::TaskListMarker(checked) => {
                buffer.push_str(if checked { "[x] " } else { "[ ] " });
            }
            _ => {}
        }
        // page-overflow guard
        ensure_space(
            10.0,
            &doc,
            &mut current_page,
            &mut current_layer,
            &mut y,
        );
    }

    // flush whatever remains
    flush_paragraph(
        &mut buffer,
        &mut current_layer,
        &doc,
        &mut current_page,
        &mut y,
        current_size,
        &current_font,
        0.0,
    );

    // ── Save ──────────────────────────────────────────────────────────────
    let file = fs::File::create(&save_path)
        .map_err(|e| format!("PDF olusturulamadi: {e}"))?;
    let mut writer = std::io::BufWriter::new(file);
    doc.save(&mut writer)
        .map_err(|e| format!("PDF kaydedilemedi: {e}"))?;

    Ok(save_path.to_string_lossy().to_string())
}

fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw_line in text.split('\n') {
        if raw_line.trim().is_empty() {
            out.push(String::new());
            continue;
        }
        let mut current = String::new();
        for word in raw_line.split_whitespace() {
            if current.is_empty() {
                current.push_str(word);
            } else if current.len() + 1 + word.len() <= max_chars {
                current.push(' ');
                current.push_str(word);
            } else {
                out.push(std::mem::take(&mut current));
                current.push_str(word);
            }
        }
        if !current.is_empty() {
            out.push(current);
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinancialExportRow {
    date: String,
    kind: String,    // "income" | "expense"
    category: String,
    project: String,
    description: String,
    amount: f64,
    currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinancialReport {
    range_label: String,
    range_from: Option<String>,
    range_to: Option<String>,
    total_income: f64,
    total_expense: f64,
    net: f64,
    base_currency: String,
    category_breakdown: Vec<CategoryBreakdownEntry>,
    rows: Vec<FinancialExportRow>,
    generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryBreakdownEntry {
    category: String,
    amount: f64,
    color: String,
}

fn escape_csv(value: &str) -> String {
    let needs_quote = value.contains(',') || value.contains('"') || value.contains('\n');
    if needs_quote {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[tauri::command]
fn export_financial_csv(report: FinancialReport) -> Result<String, String> {
    let save_path = FileDialog::new()
        .set_title("CSV raporunu kaydet")
        .add_filter("CSV", &["csv"])
        .set_file_name(&format!(
            "heravex-financials-{}.csv",
            Utc::now().format("%Y%m%d-%H%M")
        ))
        .save_file()
        .ok_or_else(|| "CSV disa aktarma iptal edildi.".to_string())?;

    let mut out = String::new();
    // UTF-8 BOM for Excel
    out.push('\u{FEFF}');
    out.push_str("Tarih,Tur,Kategori,Proje,Aciklama,Miktar,Para Birimi\n");

    for row in &report.rows {
        let line = format!(
            "{},{},{},{},{},{},{}\n",
            escape_csv(&row.date),
            escape_csv(if row.kind == "income" { "Gelir" } else { "Gider" }),
            escape_csv(&row.category),
            escape_csv(&row.project),
            escape_csv(&row.description),
            format!("{:.2}", row.amount),
            escape_csv(&row.currency),
        );
        out.push_str(&line);
    }

    // Trailing summary block (separated by blank line) — also picked up by Excel
    out.push('\n');
    out.push_str(&format!("Toplam Gelir,,,,,{:.2},{}\n", report.total_income, report.base_currency));
    out.push_str(&format!("Toplam Gider,,,,,{:.2},{}\n", report.total_expense, report.base_currency));
    out.push_str(&format!("Net,,,,,{:.2},{}\n", report.net, report.base_currency));

    fs::write(&save_path, out.as_bytes()).map_err(|e| e.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_financial_json(report: FinancialReport) -> Result<String, String> {
    let save_path = FileDialog::new()
        .set_title("JSON raporunu kaydet")
        .add_filter("JSON", &["json"])
        .set_file_name(&format!(
            "heravex-financials-{}.json",
            Utc::now().format("%Y%m%d-%H%M")
        ))
        .save_file()
        .ok_or_else(|| "JSON disa aktarma iptal edildi.".to_string())?;

    let payload = serde_json::to_string_pretty(&report)
        .map_err(|e| format!("JSON serileme hatasi: {e}"))?;
    fs::write(&save_path, payload).map_err(|e| e.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_financial_pdf(report: FinancialReport) -> Result<String, String> {
    use printpdf::*;

    let save_path = FileDialog::new()
        .set_title("PDF raporunu kaydet")
        .add_filter("PDF", &["pdf"])
        .set_file_name(&format!(
            "heravex-financials-{}.pdf",
            Utc::now().format("%Y%m%d-%H%M")
        ))
        .save_file()
        .ok_or_else(|| "PDF disa aktarma iptal edildi.".to_string())?;

    let (doc, page1, layer1) = PdfDocument::new(
        "HeraVex — Financial Report",
        Mm(210.0),
        Mm(297.0),
        "Page 1",
    );
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Font hatasi: {e}"))?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Font hatasi: {e}"))?;
    let font_italic = doc
        .add_builtin_font(BuiltinFont::HelveticaOblique)
        .map_err(|e| format!("Font hatasi: {e}"))?;

    let mut current_page = page1;
    let mut current_layer = doc.get_page(current_page).get_layer(layer1);
    let left: f32 = 20.0;

    // ── Cover ────────────────────────────────────────────────────────
    current_layer.use_text("HERAVEX", 11.0, Mm(left), Mm(280.0), &font_bold);
    current_layer.use_text(
        "FINANCIAL PERFORMANCE REPORT",
        9.0,
        Mm(left),
        Mm(274.0),
        &font_regular,
    );

    current_layer.use_text(
        "AYLIK MALI PERFORMANS RAPORU",
        24.0,
        Mm(left),
        Mm(248.0),
        &font_bold,
    );
    current_layer.use_text(
        &format!("Range: {}", report.range_label),
        12.0,
        Mm(left),
        Mm(240.0),
        &font_italic,
    );

    // ── Summary boxes ────────────────────────────────────────────────
    // Three colored boxes for Income / Expense / Net
    let box_top: f32 = 220.0;
    let box_height: f32 = 30.0;
    let box_w: f32 = 56.0;
    let gap: f32 = 4.0;

    let draw_box = |layer: &PdfLayerReference,
                    x: f32,
                    label: &str,
                    value: &str,
                    fill: (f32, f32, f32)| {
        // Background rectangle
        let points = vec![
            (Point::new(Mm(x), Mm(box_top)), false),
            (Point::new(Mm(x + box_w), Mm(box_top)), false),
            (Point::new(Mm(x + box_w), Mm(box_top - box_height)), false),
            (Point::new(Mm(x), Mm(box_top - box_height)), false),
        ];
        let line = Line {
            points,
            is_closed: true,
        };
        layer.set_fill_color(Color::Rgb(Rgb::new(fill.0, fill.1, fill.2, None)));
        layer.set_outline_color(Color::Rgb(Rgb::new(fill.0, fill.1, fill.2, None)));
        layer.add_line(line);
        // Reset
        layer.set_fill_color(Color::Rgb(Rgb::new(0.05, 0.05, 0.08, None)));

        layer.use_text(label, 9.0, Mm(x + 5.0), Mm(box_top - 8.0), &font_bold);
        layer.use_text(value, 16.0, Mm(x + 5.0), Mm(box_top - 22.0), &font_bold);

        // Reset fill for subsequent text
        layer.set_fill_color(Color::Rgb(Rgb::new(0.1, 0.1, 0.1, None)));
    };

    // Income (green), Expense (red), Net (blue/red depending on sign)
    draw_box(
        &current_layer,
        left,
        "TOPLAM GELIR",
        &format!("{:.2} {}", report.total_income, report.base_currency),
        (0.83, 0.94, 0.88),
    );
    draw_box(
        &current_layer,
        left + box_w + gap,
        "TOPLAM GIDER",
        &format!("{:.2} {}", report.total_expense, report.base_currency),
        (0.99, 0.89, 0.89),
    );
    let net_color = if report.net >= 0.0 {
        (0.90, 0.95, 1.00)
    } else {
        (1.00, 0.90, 0.90)
    };
    draw_box(
        &current_layer,
        left + 2.0 * (box_w + gap),
        "NET KAR / ZARAR",
        &format!("{:.2} {}", report.net, report.base_currency),
        net_color,
    );

    // Restore black text
    current_layer.set_fill_color(Color::Rgb(Rgb::new(0.05, 0.05, 0.08, None)));

    // ── Category breakdown ──────────────────────────────────────────
    current_layer.use_text(
        "EN COK HARCAMA YAPILAN KATEGORILER",
        10.0,
        Mm(left),
        Mm(box_top - box_height - 14.0),
        &font_bold,
    );

    let mut row_y: f32 = box_top - box_height - 22.0;
    let table_w: f32 = 170.0;

    for entry in report.category_breakdown.iter().take(8) {
        let pct = if report.total_expense > 0.0 {
            (entry.amount / report.total_expense * 100.0) as f32
        } else {
            0.0
        };
        let bar_w = (table_w * (pct / 100.0)).max(0.5);

        // Bar background
        let bg_points = vec![
            (Point::new(Mm(left), Mm(row_y)), false),
            (Point::new(Mm(left + table_w), Mm(row_y)), false),
            (Point::new(Mm(left + table_w), Mm(row_y - 4.5)), false),
            (Point::new(Mm(left), Mm(row_y - 4.5)), false),
        ];
        current_layer.set_fill_color(Color::Rgb(Rgb::new(0.95, 0.95, 0.96, None)));
        current_layer.add_line(Line { points: bg_points, is_closed: true });

        // Bar fill — use entry color (hex → rgb)
        let (r, g, b) = parse_hex_color(&entry.color).unwrap_or((0.31, 0.55, 1.0));
        let fill_points = vec![
            (Point::new(Mm(left), Mm(row_y)), false),
            (Point::new(Mm(left + bar_w), Mm(row_y)), false),
            (Point::new(Mm(left + bar_w), Mm(row_y - 4.5)), false),
            (Point::new(Mm(left), Mm(row_y - 4.5)), false),
        ];
        current_layer.set_fill_color(Color::Rgb(Rgb::new(r, g, b, None)));
        current_layer.add_line(Line { points: fill_points, is_closed: true });

        // Label & amount text
        current_layer.set_fill_color(Color::Rgb(Rgb::new(0.06, 0.07, 0.10, None)));
        current_layer.use_text(&entry.category, 9.5, Mm(left), Mm(row_y + 1.0), &font_bold);
        current_layer.use_text(
            &format!("{:.2} {} · {:.1}%", entry.amount, report.base_currency, pct),
            9.0,
            Mm(left + 100.0),
            Mm(row_y + 1.0),
            &font_regular,
        );

        row_y -= 12.0;
    }

    // ── Detail rows page ────────────────────────────────────────────
    if !report.rows.is_empty() {
        let (np, nl) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
        current_page = np;
        current_layer = doc.get_page(np).get_layer(nl);
        let mut y: f32 = 280.0;

        current_layer.use_text("DETAYLAR", 14.0, Mm(left), Mm(y), &font_bold);
        y -= 8.0;
        current_layer.use_text(
            "Tarih · Tur · Kategori · Proje · Tutar",
            9.0,
            Mm(left),
            Mm(y),
            &font_italic,
        );
        y -= 6.0;

        for r in &report.rows {
            if y < 25.0 {
                let (np, nl) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
                current_page = np;
                current_layer = doc.get_page(np).get_layer(nl);
                y = 280.0;
            }
            let line = format!(
                "{}  ·  {}  ·  {}  ·  {}  ·  {:.2} {}",
                r.date,
                if r.kind == "income" { "Gelir" } else { "Gider" },
                truncate_for_log(&r.category, 18),
                truncate_for_log(&r.project, 20),
                r.amount,
                r.currency
            );
            current_layer.use_text(&line, 9.0, Mm(left), Mm(y), &font_regular);
            y -= 4.6;
        }
    }

    let _ = current_page; // keep variable used after assignments
    let file = fs::File::create(&save_path)
        .map_err(|e| format!("PDF olusturulamadi: {e}"))?;
    let mut writer = std::io::BufWriter::new(file);
    doc.save(&mut writer)
        .map_err(|e| format!("PDF kaydedilemedi: {e}"))?;

    Ok(save_path.to_string_lossy().to_string())
}

fn parse_hex_color(hex: &str) -> Option<(f32, f32, f32)> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 { return None; }
    let r = u8::from_str_radix(&h[0..2], 16).ok()? as f32 / 255.0;
    let g = u8::from_str_radix(&h[2..4], 16).ok()? as f32 / 255.0;
    let b = u8::from_str_radix(&h[4..6], 16).ok()? as f32 / 255.0;
    Some((r, g, b))
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PressKitInput {
    #[serde(default)]
    description: String,
    #[serde(default)]
    features: Vec<String>,
    #[serde(default)]
    history: String,
    #[serde(default)]
    developer: String,
    #[serde(default)]
    release_date: String,
    #[serde(default)]
    website: String,
    #[serde(default)]
    press_contact: String,
    #[serde(default)]
    pricing: String,
    #[serde(default)]
    languages: String,
    #[serde(default)]
    social_links: Vec<CustomLink>,
    /// One of: "classic" (default, doPressKit-style), "minimal" (single column,
    /// shareable), "factsheet" (journalist-friendly, table-heavy), "indie"
    /// (bold hero, social-ready). Unknown values fall back to "classic".
    #[serde(default)]
    template_id: String,
    /// Opt-in dark palette for templates that ship as light by default
    /// (currently only `minimal` and `factsheet`). Ignored by `classic` and
    /// `indie` which are dark out of the box.
    #[serde(default)]
    dark_mode: bool,
    /// Settings → Studio logo; shown next to the developer name.
    #[serde(default)]
    studio_logo_path: String,
}

#[tauri::command]
fn generate_press_kit(
    app: AppHandle,
    game_id: String,
    output_dir: String,
    input: Option<PressKitInput>,
) -> Result<String, String> {
    let games = load_games_from_disk(&app)?;
    let mut game = games
        .into_iter()
        .find(|g| g.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

    // Image paths written by a teammate point into THEIR sync folder;
    // re-anchor them onto this machine's workspace before rendering.
    if let Some(cover) = game.cover_data_url.clone().filter(|c| !c.is_empty() && !c.starts_with("data:")) {
        game.cover_data_url = Some(resolve_workspace_asset(&app, &cover).to_string_lossy().into_owned());
    }
    for item in game.moodboard.items.iter_mut() {
        item.path = resolve_workspace_asset(&app, &item.path).to_string_lossy().into_owned();
    }

    let out = PathBuf::from(&output_dir);
    if !out.exists() || !out.is_dir() {
        return Err(format!("Klasor bulunamadi: {output_dir}"));
    }

    let input = input.unwrap_or_default();
    return render_press_kit(&game, &out, &input);
}

fn render_press_kit(
    game: &GameRecord,
    out: &Path,
    input: &PressKitInput,
) -> Result<String, String> {
    use std::io::Write as _;

    // ── Output structure (doPressKit standard) ─────────────────────────
    //   {slug}-press-kit/
    //     index.html
    //     assets/
    //       images/   (cover + screenshots)
    //       screenshots.zip
    let kit_dir = out.join(format!("{}-press-kit", slugify(&game.title)));
    let assets_dir = kit_dir.join("assets");
    let images_dir = assets_dir.join("images");
    fs::create_dir_all(&kit_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    // Cover image — handle three storage formats:
    //   • Absolute disk path (current scheme after save_image_to_disk)
    //   • data:image/png;base64,... (legacy inline storage from earlier builds)
    //   • Bare base64 (unlikely but defensive)
    // All three end up as cover.<ext> in assets/images/.
    let mut cover_filename: Option<String> = None;
    if let Some(cover) = game.cover_data_url.as_ref().filter(|s| !s.is_empty()) {
        if cover.starts_with("data:") {
            // Inline data URL — decode + write to disk so the press kit HTML
            // can reference it as a normal <img src>.
            if let Some(comma_idx) = cover.find(',') {
                let header = &cover[..comma_idx];
                let raw = &cover[comma_idx + 1..];
                let ext = if header.contains("jpeg") || header.contains("jpg") {
                    "jpg"
                } else if header.contains("webp") {
                    "webp"
                } else if header.contains("gif") {
                    "gif"
                } else {
                    "png"
                };
                if let Ok(bytes) = general_purpose::STANDARD.decode(raw) {
                    let fname = format!("cover.{ext}");
                    if fs::write(images_dir.join(&fname), &bytes).is_ok() {
                        cover_filename = Some(fname);
                    }
                }
            }
        } else {
            // Treat as filesystem path (re-anchored if a teammate wrote it).
            let src = PathBuf::from(cover);
            if src.exists() {
                let ext = src
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("png");
                // Normalise the destination name to `cover.<ext>` so press kit
                // markup is predictable regardless of what the source was called.
                let fname = format!("cover.{ext}");
                if fs::copy(&src, images_dir.join(&fname)).is_ok() {
                    cover_filename = Some(fname);
                }
            } else {
                println!("[press_kit] cover path does not exist: {}", src.display());
            }
        }
    }

    // Screenshots (from moodboard items). v0.8 renamed `imageDataUrl` →
    // `path` and `caption` → `title`. The legacy field still serializes
    // when `caption` is set on old records, but for the press kit we
    // always prefer the new fields.
    let mut screenshots: Vec<(String, String)> = Vec::new();
    for (i, item) in game.moodboard.items.iter().enumerate() {
        let src = PathBuf::from(&item.path);
        if !src.exists() { continue; }
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png").to_string();
        let fname = format!("screenshot-{:02}.{ext}", i + 1);
        if fs::copy(&src, images_dir.join(&fname)).is_ok() {
            let label = if !item.title.is_empty() {
                item.title.clone()
            } else {
                item.caption.clone().unwrap_or_default()
            };
            screenshots.push((fname, label));
        }
    }

    // screenshots.zip
    if !screenshots.is_empty() {
        let zip_path = assets_dir.join("screenshots.zip");
        if let Ok(file) = fs::File::create(&zip_path) {
            let mut zip = zip::ZipWriter::new(file);
            let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (fname, _) in &screenshots {
                let src_path = images_dir.join(fname);
                if let Ok(bytes) = fs::read(&src_path) {
                    if zip.start_file(fname, options).is_ok() {
                        let _ = zip.write_all(&bytes);
                    }
                }
            }
            let _ = zip.finish();
        }
    }

    // Studio logo (Settings → Studio) next to the developer name.
    let mut studio_logo_filename: Option<String> = None;
    if !input.studio_logo_path.is_empty() {
        let src = PathBuf::from(&input.studio_logo_path);
        if src.is_file() {
            let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
            let fname = format!("studio-logo.{ext}");
            if fs::copy(&src, images_dir.join(&fname)).is_ok() {
                studio_logo_filename = Some(fname);
            }
        }
    }

    // Factsheet rows
    let developer = if input.developer.is_empty() { "HeraVex".to_string() } else { input.developer.clone() };
    let release_date = if input.release_date.is_empty() {
        game.status.clone()
    } else {
        input.release_date.clone()
    };

    let mut factsheet_rows: Vec<(String, String)> = Vec::new();
    let developer_html = match studio_logo_filename.as_ref() {
        Some(f) => format!(
            r#"<span style="display:inline-flex;align-items:center;gap:8px"><img src="assets/images/{f}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:contain"/>{}</span>"#,
            html_escape(&developer)
        ),
        None => html_escape(&developer),
    };
    factsheet_rows.push(("Developer".into(), developer_html));
    factsheet_rows.push(("Release".into(), html_escape(&release_date)));
    if !game.platforms.is_empty() {
        factsheet_rows.push(("Platforms".into(), html_escape(&game.platforms.join(" · "))));
    }
    if !input.website.is_empty() {
        let url = html_escape(&input.website);
        factsheet_rows.push((
            "Website".into(),
            format!("<a href=\"{url}\" target=\"_blank\" rel=\"noreferrer\">{url}</a>"),
        ));
    }
    if !input.press_contact.is_empty() {
        factsheet_rows.push(("Press contact".into(), html_escape(&input.press_contact)));
    }
    if !input.pricing.is_empty() {
        factsheet_rows.push(("Price".into(), html_escape(&input.pricing)));
    }
    if !input.languages.is_empty() {
        factsheet_rows.push(("Languages".into(), html_escape(&input.languages)));
    }
    if !game.tags.is_empty() {
        factsheet_rows.push(("Tags".into(), html_escape(&game.tags.join(", "))));
    }

    let factsheet_html: String = factsheet_rows
        .iter()
        .map(|(k, v)| format!(r#"<div class="fact"><dt>{k}</dt><dd>{v}</dd></div>"#))
        .collect();

    // Store + social links
    let mut link_rows: Vec<(String, String)> = Vec::new();
    if !game.stores.steam.external_id.is_empty() {
        link_rows.push(("Steam".into(), game.stores.steam.external_id.clone()));
    }
    if !game.stores.itch.external_id.is_empty() {
        link_rows.push(("Itch.io".into(), game.stores.itch.external_id.clone()));
    }
    if !game.stores.play.external_id.is_empty() {
        link_rows.push(("Google Play".into(), game.stores.play.external_id.clone()));
    }
    for cl in &game.custom_links {
        if !cl.url.is_empty() {
            link_rows.push((cl.label.clone(), cl.url.clone()));
        }
    }
    for cl in &input.social_links {
        if !cl.url.is_empty() {
            link_rows.push((cl.label.clone(), cl.url.clone()));
        }
    }

    let links_html: String = if link_rows.is_empty() {
        r#"<p class="muted">No links yet.</p>"#.into()
    } else {
        let items: String = link_rows
            .iter()
            .map(|(label, url)| {
                let url_esc = html_escape(url);
                format!(r#"<li><a href="{url_esc}" target="_blank" rel="noreferrer">{label} →</a></li>"#)
            })
            .collect();
        format!("<ul class=\"links\">{items}</ul>")
    };

    // Description / History / Features
    let description_text = if input.description.is_empty() {
        if game.summary.is_empty() { "Description coming soon.".to_string() } else { game.summary.clone() }
    } else {
        input.description.clone()
    };
    let description_html = description_text
        .split("\n\n")
        .map(|p| format!("<p>{}</p>", html_escape(p.trim())))
        .collect::<String>();

    let history_html: String = if input.history.is_empty() {
        String::new()
    } else {
        let paragraphs = input
            .history
            .split("\n\n")
            .map(|p| format!("<p>{}</p>", html_escape(p.trim())))
            .collect::<String>();
        format!(r#"<section class="pk-section"><h2>History</h2>{paragraphs}</section>"#)
    };

    let features_html: String = if input.features.is_empty() {
        String::new()
    } else {
        let items: String = input
            .features
            .iter()
            .filter(|f| !f.trim().is_empty())
            .map(|f| format!("<li>{}</li>", html_escape(f)))
            .collect();
        if items.is_empty() {
            String::new()
        } else {
            format!(r#"<section class="pk-section"><h2>Features</h2><ul class="features">{items}</ul></section>"#)
        }
    };

    let screenshots_html: String = if screenshots.is_empty() {
        String::new()
    } else {
        let items: String = screenshots
            .iter()
            .map(|(fname, caption)| {
                let cap = html_escape(caption);
                format!(
                    r#"<figure><a href="assets/images/{fname}" target="_blank"><img src="assets/images/{fname}" alt="{cap}" loading="lazy"/></a><figcaption>{cap}</figcaption></figure>"#
                )
            })
            .collect();
        let zip_link = r#"<a class="pk-zip" href="assets/screenshots.zip" download>↓ screenshots.zip</a>"#;
        format!(
            r#"<section class="pk-section pk-screenshots"><div class="pk-screenshots-head"><h2>Screenshots</h2>{zip_link}</div><div class="pk-screenshots-grid">{items}</div></section>"#
        )
    };

    let cover_block = match cover_filename.as_ref() {
        Some(fname) => format!(
            r#"<div class="cover"><img src="assets/images/{fname}" alt="{title} cover"/></div>"#,
            title = html_escape(&game.title)
        ),
        None => format!(
            r#"<div class="cover cover-placeholder"><span>{initial}</span></div>"#,
            initial = html_escape(
                &game.title.chars().next().map(|c| c.to_string()).unwrap_or_else(|| "S".into())
            )
        ),
    };

    let og_image = cover_filename
        .as_ref()
        .map(|f| format!("assets/images/{f}"))
        .unwrap_or_default();
    let og_description = {
        let raw = if !description_text.is_empty() {
            let cut: String = description_text.chars().take(200).collect();
            if description_text.chars().count() > 200 { format!("{cut}…") } else { cut }
        } else {
            format!("Press kit for {}", game.title)
        };
        html_escape(&raw)
    };

    let now_str = Utc::now().format("%Y-%m-%d").to_string();

    let html = format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{title} — Press Kit</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="description" content="{og_description}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="{title} — Press Kit" />
<meta property="og:description" content="{og_description}" />
{og_image_meta}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{title} — Press Kit" />
<meta name="twitter:description" content="{og_description}" />
{twitter_image_meta}
<style>
  :root {{ --bg:#0a0f1a; --surface:rgba(255,255,255,0.04); --border:rgba(255,255,255,0.08); --text:#f4f7fb; --muted:#94a3b8; --accent:#4f8cff; --accent-2:#a78bfa; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif; background:radial-gradient(circle at 18% -10%,rgba(79,140,255,0.18),transparent 40%),radial-gradient(circle at 92% 0%,rgba(167,139,250,0.14),transparent 35%),var(--bg); color:var(--text); min-height:100vh; line-height:1.7; }}
  .container {{ max-width:1100px; margin:0 auto; padding:56px 32px; }}
  /* Brand bar — a square logo tile + label. Sits at the top-right of every
   * non-classic template (classic keeps it left for backwards-compat). */
  header.brand {{
    display:flex;
    align-items:center;
    gap:12px;
    font-size:11px;
    font-weight:700;
    letter-spacing:0.18em;
    text-transform:uppercase;
    color:var(--muted);
    margin-bottom:32px;
  }}
  /* Square logo container.  display:inline-flex is critical — a bare <span>
   * is inline and would collapse the height to the font line, distorting
   * the SVG. */
  header.brand .heravex-mark {{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:40px;
    height:40px;
    aspect-ratio:1 / 1;
    flex-shrink:0;
    border-radius:10px;
    overflow:hidden;
    box-shadow:0 8px 18px rgba(79,140,255,0.35);
  }}
  /* SVG fills the square; preserveAspectRatio (default xMidYMid meet) keeps
   * the 256x256 viewBox proportional inside the 40x40 tile. */
  header.brand .heravex-mark svg {{
    width:100%;
    height:100%;
    display:block;
  }}
  .hero {{ display:grid; grid-template-columns:1.2fr 1fr; gap:40px; align-items:center; margin-bottom:56px; }}
  .hero h1 {{ font-size:56px; line-height:1.05; letter-spacing:-0.02em; margin:0 0 12px; }}
  .hero .lede {{ font-size:18px; color:#cbd5e1; max-width:480px; margin:0; }}
  .hero .badge {{ display:inline-block; padding:4px 12px; border-radius:999px; background:rgba(79,140,255,0.18); color:#c7d8ff; font-size:11px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; margin-bottom:18px; }}
  .cover,.cover-placeholder {{ aspect-ratio:16/9; border-radius:18px; overflow:hidden; background:var(--surface); border:1px solid var(--border); box-shadow:0 30px 60px rgba(0,0,0,0.45); }}
  .cover img {{ width:100%; height:100%; object-fit:cover; display:block; }}
  .cover-placeholder {{ display:grid; place-items:center; font-size:96px; font-weight:800; color:var(--accent); }}
  @media (max-width:860px) {{ .hero {{ grid-template-columns:1fr; }} .hero h1 {{ font-size:38px; }} }}
  .layout {{ display:grid; grid-template-columns:1.55fr 1fr; gap:40px; align-items:start; }}
  @media (max-width:860px) {{ .layout {{ grid-template-columns:1fr; }} }}
  .pk-section {{ margin-bottom:36px; }}
  .pk-section h2 {{ margin:0 0 14px; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); }}
  .pk-section p {{ margin:0 0 14px; color:#dbe3ef; }}
  .features {{ list-style:none; padding:0; margin:0; }}
  .features li {{ padding:10px 14px; margin-bottom:8px; background:var(--surface); border:1px solid var(--border); border-radius:10px; color:#e2e8f0; }}
  .features li::before {{ content:"→ "; color:var(--accent); font-weight:800; }}
  .panel {{ padding:24px 26px; border-radius:18px; background:var(--surface); border:1px solid var(--border); position:sticky; top:32px; }}
  .panel h2 {{ margin:0 0 14px; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); }}
  .factsheet dl {{ margin:0; }}
  .fact {{ display:grid; grid-template-columns:110px 1fr; gap:14px; padding:10px 0; border-bottom:1px dashed var(--border); }}
  .fact:last-child {{ border-bottom:none; }}
  .fact dt {{ color:var(--muted); font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; }}
  .fact dd {{ margin:0; color:var(--text); font-weight:600; word-break:break-word; }}
  .fact dd a {{ color:var(--accent); text-decoration:none; }}
  .links {{ list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }}
  .links a {{ display:inline-flex; align-items:center; padding:9px 14px; border-radius:10px; background:rgba(79,140,255,0.10); color:#cfe1ff; text-decoration:none; font-weight:600; border:1px solid rgba(79,140,255,0.22); transition:background 0.15s; }}
  .links a:hover {{ background:rgba(79,140,255,0.22); }}
  .muted {{ color:var(--muted); font-style:italic; }}
  .pk-screenshots-head {{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }}
  .pk-zip {{ padding:7px 14px; border-radius:999px; background:rgba(52,211,153,0.14); color:#6ee7b7; border:1px solid rgba(52,211,153,0.32); font-size:12px; font-weight:700; text-decoration:none; letter-spacing:0.04em; }}
  .pk-zip:hover {{ background:rgba(52,211,153,0.24); }}
  .pk-screenshots-grid {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }}
  @media (max-width:760px) {{ .pk-screenshots-grid {{ grid-template-columns:1fr 1fr; }} }}
  .pk-screenshots figure {{ margin:0; border-radius:14px; overflow:hidden; background:var(--surface); border:1px solid var(--border); }}
  .pk-screenshots img {{ width:100%; aspect-ratio:16/10; object-fit:cover; display:block; }}
  .pk-screenshots figcaption {{ padding:10px 12px; font-size:12px; color:#cbd5e1; }}
  footer.kit-footer {{ margin-top:64px; padding-top:24px; border-top:1px dashed var(--border); color:var(--muted); font-size:12px; text-align:center; }}

  /* ─────────────────────────────────────────────────────────────────
     TEMPLATE VARIANTS — each one is structurally distinct, not just
     a recolor. Variants override fonts, palette, layout grid, section
     order (via CSS `order`), and section visibility.
     ───────────────────────────────────────────────────────────────── */

  /* ═══════════════════════════════════════════════════════════════════
     CLASSIC — the doPressKit baseline (kept as-is for backwards-compat).
     Defaults defined above. No overrides needed. */

  /* ═══════════════════════════════════════════════════════════════════
     MINIMAL — light theme, single column, serif body, calm typography,
     full-bleed cover under the hero. Built for screenshot-friendly
     social posts and one-page PDFs. */
  body.pk-minimal {{
    background: #f8f7f4;
    color: #1a1d2b;
    font-family: "Georgia", "Iowan Old Style", "Charter", serif;
    line-height: 1.85;
  }}
  body.pk-minimal .container {{ max-width: 760px; padding: 32px 28px 80px; }}
  /* Brand bar pinned top-right, separated from the page with a thin rule */
  body.pk-minimal header.brand {{
    color: #6b7280;
    justify-content: flex-end;
    padding-bottom: 18px;
    margin-bottom: 56px;
    border-bottom: 1px solid #e5e7eb;
  }}
  /* Minimal template uses a flat, sharp square — no rounded corners, no
   * gradient halo. Matches the editorial / paper-like feel of the theme. */
  body.pk-minimal header.brand .heravex-mark {{
    width: 32px;
    height: 32px;
    aspect-ratio: 1 / 1;
    box-shadow: none;
    border-radius: 0;
  }}
  body.pk-minimal .hero {{
    grid-template-columns: 1fr;
    text-align: center;
    gap: 32px;
    margin-bottom: 64px;
  }}
  body.pk-minimal .hero h1 {{
    font-size: 56px;
    font-weight: 400;
    font-style: italic;
    letter-spacing: -0.01em;
    color: #111;
  }}
  body.pk-minimal .hero .lede {{
    color: #4b5563;
    font-size: 19px;
    max-width: 520px;
    margin: 0 auto;
    font-style: normal;
  }}
  body.pk-minimal .hero .badge {{
    background: transparent;
    color: #6b7280;
    border: 1px solid #d1d5db;
    border-radius: 0;
    letter-spacing: 0.24em;
  }}
  body.pk-minimal .cover {{
    aspect-ratio: 21 / 9;
    border-radius: 0;
    border: none;
    box-shadow: none;
    margin: 0 -40px;
  }}
  body.pk-minimal .layout {{ grid-template-columns: 1fr; gap: 48px; }}
  body.pk-minimal aside.panel {{
    position: static;
    background: transparent;
    border: 1px solid #e5e7eb;
    border-radius: 0;
    padding: 28px 0;
    border-left: none;
    border-right: none;
  }}
  body.pk-minimal .panel h2 {{ color: #6b7280; }}
  body.pk-minimal .pk-section h2 {{ color: #6b7280; font-weight: 400; }}
  body.pk-minimal .pk-section p {{ color: #1a1d2b; font-size: 17px; }}
  body.pk-minimal .features {{ display: block; }}
  body.pk-minimal .features li {{
    background: transparent;
    border: none;
    border-bottom: 1px solid #e5e7eb;
    border-radius: 0;
    padding: 14px 0;
    color: #1a1d2b;
  }}
  body.pk-minimal .features li::before {{ content: "— "; color: #9ca3af; }}
  body.pk-minimal .fact {{ border-bottom-style: solid; border-bottom-color: #e5e7eb; grid-template-columns: 130px 1fr; }}
  body.pk-minimal .fact dt {{ color: #9ca3af; }}
  body.pk-minimal .fact dd {{ color: #1a1d2b; font-weight: 400; }}
  body.pk-minimal .fact dd a {{ color: #2563eb; text-decoration: underline; }}
  body.pk-minimal .links a {{
    background: transparent;
    border: 1px solid #d1d5db;
    color: #1a1d2b;
    border-radius: 0;
  }}
  body.pk-minimal .links a:hover {{ background: #f3f4f6; }}
  body.pk-minimal .pk-screenshots-grid {{ grid-template-columns: 1fr; gap: 24px; }}
  body.pk-minimal .pk-screenshots figure {{ border-radius: 0; border: none; background: transparent; }}
  body.pk-minimal .pk-screenshots figcaption {{
    color: #6b7280;
    font-style: italic;
    text-align: center;
    padding: 14px 0;
    border-bottom: 1px solid #e5e7eb;
  }}
  body.pk-minimal .pk-zip {{
    background: transparent;
    color: #2563eb;
    border: 1px solid #2563eb;
    border-radius: 0;
  }}
  body.pk-minimal footer.kit-footer {{ color: #9ca3af; border-top-style: solid; border-top-color: #e5e7eb; }}

  /* ═══════════════════════════════════════════════════════════════════
     FACTSHEET — journalist-first, dense table layout. Factsheet sits ABOVE
     description (CSS order swap). Print-friendly columns. Hero is small
     and tight. Reads like a newsroom one-pager. */
  body.pk-factsheet {{
    background: #fdfdfb;
    color: #0f172a;
    font-family: "Helvetica Neue", "Arial Narrow", "Inter", system-ui, sans-serif;
    line-height: 1.55;
  }}
  body.pk-factsheet .container {{ max-width: 980px; padding: 32px 32px 80px; }}
  /* Factsheet brand bar — mark sits left, "FOR IMMEDIATE RELEASE" pinned
   * far right via margin-left:auto. The bottom rule is the topbar separator. */
  body.pk-factsheet header.brand {{
    color: #94a3b8;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 14px;
    margin-bottom: 24px;
    font-size: 10px;
    letter-spacing: 0.24em;
  }}
  body.pk-factsheet header.brand .heravex-mark {{
    width: 32px;
    height: 32px;
    border-radius: 6px;
    box-shadow: none;
  }}
  body.pk-factsheet header.brand::after {{
    content: "FOR IMMEDIATE RELEASE";
    margin-left: auto;
    color: #dc2626;
    font-weight: 800;
  }}
  body.pk-factsheet .hero {{
    grid-template-columns: 220px 1fr;
    gap: 24px;
    align-items: start;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid #e5e7eb;
  }}
  body.pk-factsheet .hero h1 {{
    font-size: 38px;
    line-height: 1.1;
    color: #0f172a;
    margin-bottom: 8px;
  }}
  body.pk-factsheet .hero .lede {{
    color: #334155;
    font-size: 15px;
    max-width: none;
  }}
  body.pk-factsheet .hero .badge {{
    background: #0f172a;
    color: #f8fafc;
    border-radius: 0;
    padding: 3px 10px;
    font-weight: 800;
  }}
  body.pk-factsheet .cover {{
    aspect-ratio: 4 / 3;
    border-radius: 4px;
    border: 1px solid #cbd5e1;
    box-shadow: none;
  }}
  /* The big move: aside (factsheet) renders ABOVE the description column */
  body.pk-factsheet .layout {{
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas: "facts" "content";
    gap: 28px;
  }}
  body.pk-factsheet .layout > div:first-child {{ grid-area: content; }}
  body.pk-factsheet aside.panel {{
    grid-area: facts;
    position: static;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 20px 24px;
  }}
  body.pk-factsheet aside.panel h2 {{ color: #0f172a; font-weight: 800; }}
  body.pk-factsheet .fact {{
    grid-template-columns: 140px 1fr;
    padding: 6px 0;
    border-bottom-style: dotted;
    border-bottom-color: #94a3b8;
  }}
  body.pk-factsheet .fact dt {{ color: #475569; font-weight: 700; }}
  body.pk-factsheet .fact dd {{ color: #0f172a; font-weight: 500; }}
  body.pk-factsheet .links {{ display: grid; grid-template-columns: 1fr 1fr; }}
  body.pk-factsheet .links a {{
    background: transparent;
    border: 1px solid #94a3b8;
    color: #0f172a;
    border-radius: 0;
    font-weight: 500;
  }}
  body.pk-factsheet .pk-section h2 {{
    color: #0f172a;
    font-weight: 800;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 6px;
  }}
  body.pk-factsheet .pk-section p {{ color: #1e293b; }}
  body.pk-factsheet .features li {{
    background: transparent;
    border: none;
    border-bottom: 1px solid #e5e7eb;
    border-radius: 0;
    padding: 8px 0;
    color: #0f172a;
  }}
  body.pk-factsheet .features li::before {{ content: "▸ "; color: #dc2626; }}
  body.pk-factsheet .pk-screenshots-grid {{ grid-template-columns: repeat(4, 1fr); gap: 8px; }}
  body.pk-factsheet .pk-screenshots figure {{ border-radius: 2px; border: 1px solid #cbd5e1; background: transparent; }}
  body.pk-factsheet .pk-screenshots figcaption {{ color: #475569; padding: 6px 8px; font-size: 11px; }}
  body.pk-factsheet .pk-zip {{ background: #0f172a; color: white; border: none; border-radius: 2px; }}
  body.pk-factsheet footer.kit-footer {{ color: #94a3b8; border-top: 2px solid #0f172a; }}

  /* ═══════════════════════════════════════════════════════════════════
     INDIE SPOTLIGHT — full-bleed gradient hero (almost a viewport tall),
     huge display type, magenta/cyan accents, cover positioned AFTER the
     hero as a full-width band. Convention-booth / social-banner vibe. */
  body.pk-indie {{
    background: #050613;
    color: #f4f7fb;
    font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  }}
  body.pk-indie .container {{ max-width: 1200px; padding: 0 0 80px; }}
  /* Brand bar overlays the hero gradient; pinned right with a soft divider. */
  body.pk-indie header.brand {{
    position: relative;
    z-index: 2;
    padding: 22px 48px 14px;
    margin-bottom: 0;
    color: rgba(255,255,255,0.55);
    justify-content: flex-end;
    border-bottom: 1px solid rgba(236, 72, 153, 0.22);
  }}
  body.pk-indie header.brand .heravex-mark {{
    width: 36px;
    height: 36px;
    border-radius: 10px;
    box-shadow: 0 8px 22px rgba(168, 85, 247, 0.45);
  }}
  body.pk-indie .hero {{
    grid-template-columns: 1fr;
    text-align: center;
    margin-bottom: 0;
    padding: 80px 48px 100px;
    background:
      radial-gradient(circle at 20% 30%, rgba(168,85,247,0.45), transparent 40%),
      radial-gradient(circle at 80% 70%, rgba(236,72,153,0.45), transparent 40%),
      radial-gradient(circle at 50% 100%, rgba(34,211,238,0.35), transparent 50%),
      linear-gradient(180deg, #1a0a2e 0%, #2d1b4e 50%, #0f0a1e 100%);
    position: relative;
    overflow: hidden;
  }}
  body.pk-indie .hero::before {{
    content: "";
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(45deg, transparent 0 20px, rgba(255,255,255,0.02) 20px 21px);
    pointer-events: none;
  }}
  body.pk-indie .hero > div {{ position: relative; z-index: 1; }}
  body.pk-indie .hero h1 {{
    font-size: 96px;
    font-weight: 900;
    line-height: 0.95;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    margin: 16px 0 18px;
    background: linear-gradient(135deg, #fbcfe8 0%, #a78bfa 40%, #67e8f9 80%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 18px rgba(167,139,250,0.4));
  }}
  body.pk-indie .hero .lede {{
    font-size: 22px;
    color: rgba(255,255,255,0.85);
    max-width: 680px;
    margin: 0 auto;
    font-weight: 500;
  }}
  body.pk-indie .hero .badge {{
    background: rgba(236,72,153,0.25);
    color: #fbcfe8;
    border: 1px solid rgba(236,72,153,0.5);
    font-weight: 800;
    padding: 6px 16px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    border-radius: 999px;
  }}
  /* Cover sits below the hero, full-bleed band */
  body.pk-indie .cover,
  body.pk-indie .cover-placeholder {{
    grid-column: 1 / -1;
    aspect-ratio: 21 / 9;
    border-radius: 0;
    border: none;
    border-top: 1px solid rgba(236,72,153,0.3);
    border-bottom: 1px solid rgba(167,139,250,0.3);
    box-shadow: 0 -10px 60px rgba(168,85,247,0.3);
    margin: 0;
  }}
  body.pk-indie .layout {{
    grid-template-columns: 1fr;
    padding: 64px 48px 0;
    gap: 56px;
  }}
  body.pk-indie aside.panel {{
    position: static;
    background: linear-gradient(135deg, rgba(168,85,247,0.08), rgba(236,72,153,0.05));
    border: 1px solid rgba(236,72,153,0.25);
    border-radius: 18px;
  }}
  body.pk-indie .panel h2 {{ color: #fbcfe8; }}
  body.pk-indie .pk-section h2 {{
    color: #67e8f9;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.22em;
  }}
  body.pk-indie .pk-section p {{ font-size: 17px; color: rgba(255,255,255,0.88); line-height: 1.7; }}
  body.pk-indie .features {{
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }}
  body.pk-indie .features li {{
    background: linear-gradient(135deg, rgba(168,85,247,0.12), rgba(236,72,153,0.08));
    border: 1px solid rgba(236,72,153,0.25);
    border-radius: 12px;
    padding: 16px 18px;
    color: #f4f7fb;
    font-weight: 600;
  }}
  body.pk-indie .features li::before {{ content: "✦ "; color: #fbcfe8; }}
  body.pk-indie .fact {{ border-bottom-color: rgba(236,72,153,0.18); }}
  body.pk-indie .fact dt {{ color: #67e8f9; }}
  body.pk-indie .links a {{
    background: rgba(236,72,153,0.15);
    border: 1px solid rgba(236,72,153,0.45);
    color: #fbcfe8;
    border-radius: 999px;
    font-weight: 700;
  }}
  body.pk-indie .links a:hover {{ background: rgba(236,72,153,0.3); }}
  body.pk-indie .pk-screenshots-grid {{ grid-template-columns: 1fr; gap: 32px; }}
  body.pk-indie .pk-screenshots figure {{
    border-radius: 20px;
    border: 1px solid rgba(236,72,153,0.3);
    box-shadow: 0 18px 50px rgba(168,85,247,0.25);
    overflow: hidden;
  }}
  body.pk-indie .pk-screenshots img {{ aspect-ratio: 21/9; }}
  body.pk-indie .pk-zip {{
    background: linear-gradient(135deg, #f472b6, #a78bfa);
    color: white;
    border: none;
    font-weight: 800;
    box-shadow: 0 6px 20px rgba(236,72,153,0.4);
  }}
  body.pk-indie footer.kit-footer {{
    color: rgba(255,255,255,0.4);
    border-top: 1px solid rgba(236,72,153,0.2);
    margin: 56px 48px 0;
  }}

  /* ═══════════════════════════════════════════════════════════════════
     OPTIONAL DARK MODE for the two light templates (minimal & factsheet).
     Triggered by adding `pk-dark` to the body alongside the template class. */

  /* ── minimal · dark ─────────────────────────────────────────────── */
  body.pk-minimal.pk-dark {{
    background: #0e1018;
    color: #f1f5f9;
  }}
  body.pk-minimal.pk-dark header.brand {{ color: #94a3b8; border-bottom-color: rgba(255,255,255,0.08); }}
  body.pk-minimal.pk-dark .hero h1 {{ color: #f8fafc; }}
  body.pk-minimal.pk-dark .hero .lede {{ color: #cbd5e1; }}
  body.pk-minimal.pk-dark .hero .badge {{ color: #94a3b8; border-color: rgba(255,255,255,0.18); }}
  body.pk-minimal.pk-dark .cover {{ filter: none; }}
  body.pk-minimal.pk-dark aside.panel {{ border-top-color: rgba(255,255,255,0.1); border-bottom-color: rgba(255,255,255,0.1); }}
  body.pk-minimal.pk-dark .panel h2 {{ color: #94a3b8; }}
  body.pk-minimal.pk-dark .pk-section h2 {{ color: #94a3b8; }}
  body.pk-minimal.pk-dark .pk-section p {{ color: #e2e8f0; }}
  body.pk-minimal.pk-dark .features li {{ border-bottom-color: rgba(255,255,255,0.08); color: #e2e8f0; }}
  body.pk-minimal.pk-dark .features li::before {{ color: #64748b; }}
  body.pk-minimal.pk-dark .fact {{ border-bottom-color: rgba(255,255,255,0.08); }}
  body.pk-minimal.pk-dark .fact dt {{ color: #64748b; }}
  body.pk-minimal.pk-dark .fact dd {{ color: #f1f5f9; }}
  body.pk-minimal.pk-dark .fact dd a {{ color: #93c5fd; }}
  body.pk-minimal.pk-dark .links a {{ border-color: rgba(255,255,255,0.18); color: #e2e8f0; }}
  body.pk-minimal.pk-dark .links a:hover {{ background: rgba(255,255,255,0.06); }}
  body.pk-minimal.pk-dark .pk-screenshots figcaption {{ color: #94a3b8; border-bottom-color: rgba(255,255,255,0.08); }}
  body.pk-minimal.pk-dark .pk-zip {{ color: #93c5fd; border-color: #3b82f6; }}
  body.pk-minimal.pk-dark footer.kit-footer {{ color: #64748b; border-top-color: rgba(255,255,255,0.08); }}

  /* ── factsheet · dark ───────────────────────────────────────────── */
  body.pk-factsheet.pk-dark {{
    background: #0a0d14;
    color: #e2e8f0;
  }}
  body.pk-factsheet.pk-dark header.brand {{
    color: #64748b;
    border-bottom-color: #e2e8f0;
  }}
  body.pk-factsheet.pk-dark header.brand::after {{ color: #fca5a5; }}
  body.pk-factsheet.pk-dark .hero {{ border-bottom-color: rgba(255,255,255,0.08); }}
  body.pk-factsheet.pk-dark .hero h1 {{ color: #f8fafc; }}
  body.pk-factsheet.pk-dark .hero .lede {{ color: #cbd5e1; }}
  body.pk-factsheet.pk-dark .hero .badge {{ background: #e2e8f0; color: #0f172a; }}
  body.pk-factsheet.pk-dark .cover {{ border-color: rgba(255,255,255,0.15); }}
  body.pk-factsheet.pk-dark aside.panel {{
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.12);
  }}
  body.pk-factsheet.pk-dark aside.panel h2 {{ color: #f1f5f9; }}
  body.pk-factsheet.pk-dark .fact {{ border-bottom-color: rgba(148,163,184,0.45); }}
  body.pk-factsheet.pk-dark .fact dt {{ color: #94a3b8; }}
  body.pk-factsheet.pk-dark .fact dd {{ color: #f1f5f9; }}
  body.pk-factsheet.pk-dark .links a {{ border-color: rgba(148,163,184,0.4); color: #e2e8f0; }}
  body.pk-factsheet.pk-dark .pk-section h2 {{
    color: #f1f5f9;
    border-bottom-color: #e2e8f0;
  }}
  body.pk-factsheet.pk-dark .pk-section p {{ color: #cbd5e1; }}
  body.pk-factsheet.pk-dark .features li {{ border-bottom-color: rgba(255,255,255,0.08); color: #e2e8f0; }}
  body.pk-factsheet.pk-dark .features li::before {{ color: #fca5a5; }}
  body.pk-factsheet.pk-dark .pk-screenshots figure {{ border-color: rgba(255,255,255,0.1); }}
  body.pk-factsheet.pk-dark .pk-screenshots figcaption {{ color: #94a3b8; }}
  body.pk-factsheet.pk-dark .pk-zip {{ background: #e2e8f0; color: #0f172a; }}
  body.pk-factsheet.pk-dark footer.kit-footer {{
    color: #64748b;
    border-top-color: #e2e8f0;
  }}
</style>
</head>
<body class="pk-{template_id}">
<main class="container">
  <header class="brand"><span class="heravex-mark">{heravex_logo_svg}</span><span>HeraVex · Press Kit</span></header>
  <section class="hero">
    <div>
      <span class="badge">{status}</span>
      <h1>{title}</h1>
      <p class="lede">{lede}</p>
    </div>
    {cover_block}
  </section>
  <div class="layout">
    <div>
      <section class="pk-section"><h2>Description</h2>{description_html}</section>
      {history_html}
      {features_html}
      {screenshots_html}
    </div>
    <aside class="panel factsheet">
      <h2>Factsheet</h2>
      <dl>{factsheet_html}</dl>
      <h2 style="margin-top:22px;">Links</h2>
      {links_html}
    </aside>
  </div>
  <footer class="kit-footer">Last updated: {ts} · Generated by HeraVex</footer>
</main>
</body>
</html>"#,
        title = html_escape(&game.title),
        status = html_escape(&game.status),
        lede = html_escape(if game.summary.is_empty() { "—" } else { &game.summary }),
        description_html = description_html,
        history_html = history_html,
        features_html = features_html,
        screenshots_html = screenshots_html,
        cover_block = cover_block,
        factsheet_html = factsheet_html,
        links_html = links_html,
        // Inline the HeraVex mark so the press kit is fully self-contained.
        // We keep the exact gradient + glyph from src/assets/logo-mark.svg.
        heravex_logo_svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="HeraVex"><defs><linearGradient id="hv-mark-bg" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient><linearGradient id="hv-mark-sheen" x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="rgba(255,255,255,0.18)"/><stop offset="55%" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><rect x="0" y="0" width="256" height="256" rx="60" ry="60" fill="url(#hv-mark-bg)"/><rect x="0" y="0" width="256" height="256" rx="60" ry="60" fill="url(#hv-mark-sheen)"/><g fill="#ffffff"><rect x="62" y="60" width="28" height="136" rx="6"/><rect x="166" y="60" width="28" height="136" rx="6"/><path d="M 90 142 L 166 114 L 166 142 L 90 170 Z"/></g></svg>"##,
        og_image_meta = if og_image.is_empty() {
            String::new()
        } else {
            format!(r#"<meta property="og:image" content="{og_image}" />"#)
        },
        twitter_image_meta = if og_image.is_empty() {
            String::new()
        } else {
            format!(r#"<meta name="twitter:image" content="{og_image}" />"#)
        },
        og_description = og_description,
        ts = now_str,
        template_id = {
            let id = input.template_id.trim();
            let base = match id {
                "minimal" | "factsheet" | "indie" | "classic" => id.to_string(),
                _ => "classic".to_string(),
            };
            // `dark_mode` only flips the two light templates. classic & indie
            // already render dark and shouldn't gain a redundant class.
            if input.dark_mode && (base == "minimal" || base == "factsheet") {
                format!("{base} pk-dark")
            } else {
                base
            }
        },
    );

    let index_path = kit_dir.join("index.html");
    fs::write(&index_path, html).map_err(|e| e.to_string())?;

    Ok(kit_dir.to_string_lossy().to_string())
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[tauri::command(async)]
fn get_workspace_path(app: AppHandle) -> Result<Option<String>, String> {
    Ok(load_settings_from_disk(&app)?.workspace_path)
}

#[tauri::command]
fn set_workspace_path(app: AppHandle, new_path: String) -> Result<String, String> {
    let target = PathBuf::from(&new_path);
    if !target.exists() {
        fs::create_dir_all(&target).map_err(|e| format!("Klasor olusturulamadi: {e}"))?;
    }
    if !target.is_dir() {
        return Err("Secilen yol bir klasor degil.".into());
    }

    // Current data root (pre-migration)
    let mut settings = load_settings_from_disk(&app)?;
    let current_root = data_root(&app)?;

    // Make sure target has a library subdir
    fs::create_dir_all(target.join("library")).map_err(|e| e.to_string())?;

    // Copy games.json / notes.json if missing in target
    for fname in &["games.json", "notes.json"] {
        let src = current_root.join(fname);
        let dst = target.join(fname);
        if src.exists() && !dst.exists() {
            let _ = fs::copy(&src, &dst);
        }
    }

    settings.workspace_path = Some(target.to_string_lossy().to_string());
    save_settings_to_disk(&app, &settings)?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn clear_workspace_path(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    settings.workspace_path = None;
    save_settings_to_disk(&app, &settings)
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let folder = if p.is_dir() {
        p.clone()
    } else {
        p.parent().map(|p| p.to_path_buf()).unwrap_or(p)
    };
    open::that(folder).map_err(|e| e.to_string())
}

// ── v0.9 M5: Storage stats + backup history ───────────────────────────
//
// `compute_storage_stats` walks the data root and reports total disk
// use plus a breakdown by major subdirectory (games/notes/moodboard/
// backups). The Settings → Storage page renders the result as a tiny
// bar chart. Walking is depth-first with errors swallowed per-file —
// a single unreadable entry shouldn't kill the whole report.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStats {
    total_bytes: u64,
    file_count: u64,
    games_bytes: u64,
    notes_bytes: u64,
    moodboard_bytes: u64,
    backups_bytes: u64,
    other_bytes: u64,
}

fn dir_size_recursive(path: &PathBuf) -> (u64, u64) {
    // (bytes, files) — silently skips unreadable entries.
    let mut bytes: u64 = 0;
    let mut files: u64 = 0;
    let Ok(entries) = fs::read_dir(path) else { return (0, 0); };
    for entry in entries.flatten() {
        let p = entry.path();
        if let Ok(meta) = entry.metadata() {
            if meta.is_dir() {
                let (b, f) = dir_size_recursive(&p);
                bytes = bytes.saturating_add(b);
                files = files.saturating_add(f);
            } else {
                bytes = bytes.saturating_add(meta.len());
                files = files.saturating_add(1);
            }
        }
    }
    (bytes, files)
}

#[tauri::command]
fn compute_storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let root = data_root(&app)?;
    let library = library_dir(&app)?;

    let games_path    = root.join("games");
    let notes_path    = root.join("notes");
    let backups_path  = root.join("backups");
    // Moodboard images live under `library/<gameId>/moodboard/` — we
    // walk the library and sum any path whose final segment is
    // `moodboard`. Per-game build files in library/<gameId>/v*/ count
    // toward `games_bytes` so a heavy build sits in the right bucket.
    let (games_bytes,    _gf) = dir_size_recursive(&games_path);
    let (notes_bytes,    _nf) = dir_size_recursive(&notes_path);
    let (backups_bytes,  _bf) = dir_size_recursive(&backups_path);
    let (library_bytes,  library_files) = dir_size_recursive(&library);
    // Approximate moodboard by walking library subtree looking for
    // `moodboard` folders. Cheaper than tagging every file.
    let mut moodboard_bytes: u64 = 0;
    if let Ok(games) = fs::read_dir(&library) {
        for game in games.flatten() {
            let mb = game.path().join("moodboard");
            if mb.is_dir() {
                let (b, _) = dir_size_recursive(&mb);
                moodboard_bytes = moodboard_bytes.saturating_add(b);
            }
        }
    }
    let games_disk = library_bytes.saturating_sub(moodboard_bytes);

    let (root_bytes, root_files) = dir_size_recursive(&root);
    let categorised = games_bytes
        .saturating_add(notes_bytes)
        .saturating_add(backups_bytes)
        .saturating_add(library_bytes);
    let other_bytes = root_bytes.saturating_sub(categorised);

    Ok(StorageStats {
        total_bytes: root_bytes,
        file_count: root_files.saturating_add(library_files),
        // Combined "games" bucket: per-id JSON records + their build
        // archives, minus moodboard so the latter has its own slice.
        games_bytes: games_bytes.saturating_add(games_disk),
        notes_bytes,
        moodboard_bytes,
        backups_bytes,
        other_bytes,
    })
}

// ── Storage maintenance (v0.9.9, Settings → Storage) ────────────────────────
//
// Every tool here only touches files HeraVex itself creates, inside the
// active data root, and leaves anything that may still be in flight:
//   * temp files younger than 10 minutes (an atomic write or backup of
//     this or another instance may own them);
//   * images changed in the last 24 hours (in a team folder the cloud
//     client can deliver an image before the game file that uses it).

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CleanResult {
    files: u64,
    bytes: u64,
}

fn file_age_secs(md: &fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Leftovers of `atomic_write` (`name.<pid>.<n>.tmp`, old `name.tmp`)
/// and of an interrupted backup (`*.zip.part`).
fn is_temp_leftover(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".tmp") || lower.ends_with(".zip.part")
}

fn walk_files(dir: &Path, depth: u32, out: &mut Vec<(PathBuf, fs::Metadata)>) {
    if depth > 8 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        let Ok(md) = entry.metadata() else { continue };
        if md.is_dir() {
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if matches!(name, "plugins" | "node_modules" | "target") {
                continue;
            }
            walk_files(&p, depth + 1, out);
        } else if md.is_file() {
            out.push((p, md));
        }
    }
}

/// Clear the store-data cache (`<data root>/cache/`). Store Center
/// downloads fresh numbers on its next refresh; the cache only exists
/// as an offline fallback.
#[tauri::command(async)]
fn storage_clear_cache(app: AppHandle) -> Result<CleanResult, String> {
    let _io = io_lock();
    let dir = data_root(&app)?.join("cache");
    let mut res = CleanResult::default();
    let mut files = Vec::new();
    walk_files(&dir, 0, &mut files);
    for (p, md) in files {
        if fs::remove_file(&p).is_ok() {
            res.files += 1;
            res.bytes += md.len();
        }
    }
    Ok(res)
}

fn remove_temp_in(dir: &Path, min_age_secs: u64, res: &mut CleanResult) {
    let mut files = Vec::new();
    walk_files(dir, 0, &mut files);
    for (p, md) in files {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if is_temp_leftover(name) && file_age_secs(&md) >= min_age_secs && fs::remove_file(&p).is_ok() {
            res.files += 1;
            res.bytes += md.len();
        }
    }
}

#[tauri::command(async)]
fn storage_remove_temp(app: AppHandle) -> Result<CleanResult, String> {
    let _io = io_lock();
    let data = data_root(&app)?;
    let local = root_dir(&app)?;
    let mut res = CleanResult::default();
    remove_temp_in(&data, 600, &mut res);
    if local != data {
        remove_temp_in(&local, 600, &mut res);
    }
    Ok(res)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrphanImage {
    path: String,
    /// `library/...` relative path, for display.
    relative: String,
    size_bytes: u64,
}

const IMAGE_EXTS: [&str; 6] = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];

/// Every JSON record in the workspace, as text. An image is "used" when
/// its file name appears anywhere in it (cover, moodboard, notes,
/// flows...). Image names carry a millisecond timestamp, so a name match
/// is specific; matching text instead of known fields means a field we
/// forgot can never get an image deleted.
fn workspace_json_text(root: &Path) -> Result<String, String> {
    let mut text = String::new();
    let mut files = Vec::new();
    walk_files(root, 0, &mut files);
    for (p, _) in files {
        let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
        if !rel.to_lowercase().ends_with(".json") || rel.starts_with("Saves/") || rel.starts_with("backups/") {
            continue;
        }
        match read_text_guarded(&p) {
            Ok(t) => {
                text.push_str(&t);
                text.push('\n');
            }
            // Can't see what this file references, so refuse to call
            // anything an orphan.
            Err(ReadFail::TimedOut) => return Err(format!("{} okunamadi (zaman asimi)", rel)),
            Err(ReadFail::Io(e)) => return Err(format!("{rel}: {e}")),
        }
    }
    Ok(text.to_lowercase())
}

fn find_orphans_at(root: &Path, min_age_secs: u64) -> Result<Vec<OrphanImage>, String> {
    let used = workspace_json_text(root)?;
    let library = root.join("library");
    let mut files = Vec::new();
    walk_files(&library, 0, &mut files);
    let mut out = Vec::new();
    for (p, md) in files {
        let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
        let lower = rel.to_lowercase();
        // Only images HeraVex stores (covers / moodboard), never builds.
        if !lower.contains("/assets/") || !IMAGE_EXTS.iter().any(|e| lower.ends_with(e)) {
            continue;
        }
        if file_age_secs(&md) < min_age_secs {
            continue;
        }
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if name.is_empty() || used.contains(&name) {
            continue;
        }
        out.push(OrphanImage { path: p.to_string_lossy().to_string(), relative: rel, size_bytes: md.len() });
    }
    out.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(out)
}

#[tauri::command(async)]
fn storage_find_orphan_images(app: AppHandle) -> Result<Vec<OrphanImage>, String> {
    let _io = io_lock();
    find_orphans_at(&data_root(&app)?, 24 * 3600)
}

/// Deletes only paths that are STILL orphans when re-checked now, so a
/// list that went stale (teammate started using an image) is safe.
#[tauri::command(async)]
fn storage_delete_orphan_images(app: AppHandle, paths: Vec<String>) -> Result<CleanResult, String> {
    let _io = io_lock();
    let current = find_orphans_at(&data_root(&app)?, 24 * 3600)?;
    let mut res = CleanResult::default();
    for o in current.iter().filter(|o| paths.contains(&o.path)) {
        if fs::remove_file(&o.path).is_ok() {
            res.files += 1;
            res.bytes += o.size_bytes;
        }
    }
    Ok(res)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityProblem {
    /// "unreadable" | "corrupt" | "missingCover" | "missingImage" |
    /// "missingBuild" | "duplicateId" | "tempLeftover"
    kind: String,
    file: String,
    detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityReport {
    checked_files: u64,
    problems: Vec<IntegrityProblem>,
}

fn integrity_check_at(app: Option<&AppHandle>, root: &Path) -> IntegrityReport {
    let mut problems = Vec::new();
    let mut checked = 0u64;
    let mut push = |kind: &str, file: &str, detail: String| {
        problems.push(IntegrityProblem { kind: kind.into(), file: file.into(), detail });
    };
    let read = |p: &Path| -> Result<String, String> {
        match read_text_guarded(p) {
            Ok(t) => Ok(t),
            Err(ReadFail::TimedOut) => Err("zaman asimi".into()),
            Err(ReadFail::Io(e)) => Err(e),
        }
    };
    let resolve = |raw: &str| -> PathBuf {
        match app {
            Some(a) => resolve_workspace_asset(a, raw),
            None => PathBuf::from(raw),
        }
    };

    // Games
    let mut seen_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut entries: Vec<PathBuf> = fs::read_dir(root.join("games"))
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    entries.sort();
    for p in entries {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if !name.ends_with(".json") {
            continue;
        }
        let rel = format!("games/{name}");
        checked += 1;
        let raw = match read(&p) {
            Ok(r) => r,
            Err(e) => { push("unreadable", &rel, e); continue; }
        };
        let game: GameRecord = match serde_json::from_str(&raw) {
            Ok(g) => g,
            Err(e) => { push("corrupt", &rel, e.to_string()); continue; }
        };
        if let Some(prev) = seen_ids.insert(game.id.clone(), rel.clone()) {
            push("duplicateId", &rel, format!("{} = {prev}", game.id));
        }
        if let Some(cover) = game.cover_data_url.as_ref().filter(|c| !c.is_empty() && !c.starts_with("data:")) {
            if !resolve(cover).exists() {
                push("missingCover", &rel, format!("{}: {cover}", game.title));
            }
        }
        for item in &game.moodboard.items {
            if !item.path.is_empty() && !item.path.starts_with("data:") && !resolve(&item.path).exists() {
                push("missingImage", &rel, format!("{}: {}", game.title, item.path));
            }
        }
        for v in &game.versions {
            if let Some(b) = v.build_relative_path.as_ref() {
                if !root.join("library").join(b).exists() {
                    push("missingBuild", &rel, format!("{} {}: {b}", game.title, v.version));
                }
            }
        }
    }

    // Notes, flows, wallet, settings: must parse.
    let mut json_files: Vec<(String, PathBuf)> = Vec::new();
    for sub in ["notes", "flows"] {
        if let Ok(rd) = fs::read_dir(root.join(sub)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.ends_with(".json") {
                    json_files.push((format!("{sub}/{n}"), e.path()));
                }
            }
        }
    }
    for name in ["wallet.json", "settings.json", "notes.json", "games.json"] {
        let p = root.join(name);
        if p.is_file() {
            json_files.push((name.to_string(), p));
        }
    }
    json_files.sort();
    for (rel, p) in json_files {
        checked += 1;
        match read(&p) {
            Ok(raw) if raw.trim().is_empty() => {}
            Ok(raw) => {
                let ok = if rel == "wallet.json" {
                    serde_json::from_str::<WalletFile>(&raw).map(|_| ()).map_err(|e| e.to_string())
                } else if rel.starts_with("notes/") {
                    serde_json::from_str::<NoteRecord>(&raw).map(|_| ()).map_err(|e| e.to_string())
                } else {
                    serde_json::from_str::<serde_json::Value>(&raw).map(|_| ()).map_err(|e| e.to_string())
                };
                if let Err(e) = ok {
                    push("corrupt", &rel, e);
                }
            }
            Err(e) => push("unreadable", &rel, e),
        }
    }

    // Leftover temp files (informational; "Remove temporary files" fixes).
    let mut files = Vec::new();
    walk_files(root, 0, &mut files);
    let temps = files
        .iter()
        .filter(|(p, _)| is_temp_leftover(p.file_name().and_then(|s| s.to_str()).unwrap_or("")))
        .count();
    if temps > 0 {
        push("tempLeftover", "", temps.to_string());
    }

    IntegrityReport { checked_files: checked, problems }
}

#[tauri::command(async)]
fn storage_integrity_check(app: AppHandle) -> Result<IntegrityReport, String> {
    let _io = io_lock();
    let root = data_root(&app)?;
    Ok(integrity_check_at(Some(&app), &root))
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PruneResult {
    games: u64,
    files: u64,
    bytes: u64,
}

/// Versions whose build file should go: everything with a build beyond
/// the newest `keep` builds, never the game's current build. Versions
/// are stored newest first.
fn builds_to_prune(game: &GameRecord, keep: usize) -> Vec<usize> {
    let current = game.current_build_relative_path.as_deref();
    let mut seen = 0usize;
    let mut out = Vec::new();
    for (i, v) in game.versions.iter().enumerate() {
        let Some(path) = v.build_relative_path.as_deref() else { continue };
        seen += 1;
        if seen > keep && Some(path) != current {
            out.push(i);
        }
    }
    out
}

/// Delete old build files of one game. The version entries (number,
/// notes, date) stay; only the file goes and the entry is marked.
fn prune_game_builds(library: &Path, game: &mut GameRecord, keep: usize, res: &mut PruneResult) -> bool {
    let idx = builds_to_prune(game, keep);
    if idx.is_empty() {
        return false;
    }
    let versions_root = library.join(game_folder_name(game)).join("versions");
    for i in idx {
        let Some(rel) = game.versions[i].build_relative_path.clone() else { continue };
        let file = library.join(&rel);
        // The build lives in its own `versions/<slug>-<id>/` folder.
        if let Some(dir) = file.parent().filter(|d| d.parent() == Some(versions_root.as_path())) {
            let (bytes, files) = dir_size_recursive(&dir.to_path_buf());
            if !dir.exists() || fs::remove_dir_all(dir).is_ok() {
                res.files += files;
                res.bytes += bytes;
            } else {
                continue;
            }
        } else if file.is_file() {
            let len = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(&file).is_err() {
                continue;
            }
            res.files += 1;
            res.bytes += len;
        }
        game.versions[i].build_relative_path = None;
        game.versions[i].build_pruned_at = Some(now_iso());
    }
    res.games += 1;
    true
}

#[tauri::command(async)]
fn storage_prune_builds(app: AppHandle, keep: u32) -> Result<PruneResult, String> {
    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock()
        .map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let keep = keep.max(1) as usize;
    let library = library_dir(&app)?;
    let mut res = PruneResult::default();
    for mut game in load_games_from_disk(&app)? {
        if prune_game_builds(&library, &mut game, keep, &mut res) {
            game.updated_at = now_iso();
            save_single_game_to_disk(&app, &game)?;
        }
    }
    Ok(res)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry {
    path: String,
    name: String,
    size_bytes: u64,
    /// Modified time ISO-formatted; falls back to "" when the platform
    /// doesn't expose it (unlikely on the desktop targets we ship).
    created_at: String,
    /// Heuristic — backups named with `auto-` prefix are recognised as
    /// scheduler-driven; everything else is treated as manual.
    is_auto: bool,
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Result<Vec<BackupEntry>, String> {
    // Canonical folder is `Saves/`. Legacy `backups/` is still scanned
    // so users upgrading from older v0.9 builds don't lose visibility
    // on their existing dumps. Both folders are de-duped by full path.
    let candidates = backup_dirs(&app)?;
    let mut out: Vec<BackupEntry> = Vec::new();
    for folder in &candidates {
        let Ok(entries) = fs::read_dir(folder) else { continue; };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue; };
            if !meta.is_file() { continue; }
            let name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if !(name.ends_with(".json") || name.ends_with(".zip") || name.ends_with(".bak")) {
                continue;
            }
            let created_at = meta.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| {
                    let secs = d.as_secs() as i64;
                    chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            out.push(BackupEntry {
                path: path.to_string_lossy().to_string(),
                is_auto: name.starts_with("auto-"),
                name,
                size_bytes: meta.len(),
                created_at,
            });
        }
    }
    // Newest first.
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

// ── Backup housekeeping (v0.9.9, Settings → Backup) ─────────────────────────
//
// Runs right after each backup:
//   * mirror   — copy the new archive to a folder the user picked (e.g.
//                inside Dropbox / Drive), written as .part then renamed;
//   * retention— keep the newest N AUTOMATIC backups (manual ones are
//                never deleted for you), here and in the mirror folder;
//   * compress — re-pack older archives at maximum compression. Each
//                re-packed archive is verified before it replaces the
//                original, keeps its date, and is marked in the zip
//                comment so it is never re-packed twice.

const COMPRESSED_MARK: &str = "heravex:compressed";

/// Every folder backups can live in. Backups are written to the
/// app-local `Saves/`; older builds used the data root (`Saves/`,
/// `backups/`). With a custom workspace those differ, so all are listed.
fn backup_dirs(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in [root_dir(app)?.join("Saves"), data_root(app)?.join("Saves"), data_root(app)?.join("backups")] {
        if !out.contains(&d) {
            out.push(d);
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackupHousekeeping {
    #[serde(default)]
    retention: Option<u32>,
    #[serde(default)]
    compress_old: Option<bool>,
    #[serde(default)]
    mirror_dir: Option<String>,
}

fn is_backup_archive(name: &str) -> bool {
    (name.starts_with("auto-") || name.starts_with("manual-")) && name.ends_with(".zip")
}

/// Our backup archives in `dir`, newest first (names carry the stamp).
fn backup_archives(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.file_name().and_then(|n| n.to_str()).map_or(false, is_backup_archive))
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| {
        let stamp = |p: &PathBuf| {
            let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            n.split_once('-').map(|(_, rest)| rest.to_string()).unwrap_or(n)
        };
        stamp(b).cmp(&stamp(a))
    });
    v
}

/// Delete automatic backups beyond the newest `keep`.
fn apply_retention(dir: &Path, keep: usize) -> u64 {
    let mut removed = 0;
    let autos: Vec<PathBuf> = backup_archives(dir)
        .into_iter()
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with("auto-")))
        .collect();
    for p in autos.into_iter().skip(keep) {
        if fs::remove_file(&p).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn copy_to_mirror(src: &Path, mirror: &Path) -> Result<PathBuf, String> {
    if !mirror.is_dir() {
        return Err(format!("Yedek kopya klasoru bulunamadi: {}", mirror.display()));
    }
    let name = src.file_name().ok_or("dosya adi yok")?;
    let target = mirror.join(name);
    let part = mirror.join(format!("{}.part", name.to_string_lossy()));
    fs::copy(src, &part).map_err(|e| format!("Yedek kopyalanamadi: {e}"))?;
    fs::rename(&part, &target).map_err(|e| {
        let _ = fs::remove_file(&part);
        format!("Yedek kopyalanamadi: {e}")
    })?;
    Ok(target)
}

fn zip_is_marked_compressed(path: &Path) -> bool {
    fs::File::open(path)
        .ok()
        .and_then(|f| zip::ZipArchive::new(f).ok())
        .map_or(false, |a| a.comment() == COMPRESSED_MARK.as_bytes())
}

/// Re-pack one archive at maximum compression. Returns bytes saved.
fn recompress_backup(path: &Path) -> Result<u64, String> {
    use std::io::{Read, Write};
    use zip::{write::SimpleFileOptions, ZipWriter};
    let before = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut src = zip::ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let part = path.with_extension("zip.part");
    {
        let mut out = ZipWriter::new(fs::File::create(&part).map_err(|e| e.to_string())?);
        let opts = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(9));
        let mut buf = Vec::new();
        for i in 0..src.len() {
            let mut entry = src.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if entry.is_dir() {
                continue;
            }
            buf.clear();
            entry.read_to_end(&mut buf).map_err(|e| format!("{name}: {e}"))?;
            out.start_file(&name, opts).map_err(|e| e.to_string())?;
            out.write_all(&buf).map_err(|e| e.to_string())?;
        }
        out.set_comment(COMPRESSED_MARK);
        out.finish().map_err(|e| e.to_string())?;
    }
    // Only replace the original once the new archive checks out.
    let report = verify_backup_at(&part);
    if !report.ok {
        let _ = fs::remove_file(&part);
        return Err(format!("yeniden paketleme dogrulanamadi: {}", report.problems.join("; ")));
    }
    let after = fs::metadata(&part).map_err(|e| e.to_string())?.len();
    if after >= before.len() {
        // No gain: keep the original, just remember it was tried.
        let _ = fs::remove_file(&part);
        return Ok(0);
    }
    fs::rename(&part, path).map_err(|e| e.to_string())?;
    // Keep the backup's date so history and retention stay in order.
    if let (Ok(mtime), Ok(f)) = (before.modified(), fs::OpenOptions::new().write(true).open(path)) {
        let _ = f.set_modified(mtime);
    }
    Ok(before.len() - after)
}

/// Re-pack every archive except the newest `skip_newest`.
fn compress_old_backups(dir: &Path, skip_newest: usize) -> u64 {
    let mut saved = 0;
    for p in backup_archives(dir).into_iter().skip(skip_newest) {
        if zip_is_marked_compressed(&p) {
            continue;
        }
        match recompress_backup(&p) {
            Ok(s) => saved += s,
            Err(e) => eprintln!("[backup] compress {}: {e}", p.display()),
        }
    }
    saved
}

fn run_backup_housekeeping(app: &AppHandle, new_backup: &Path, hk: &BackupHousekeeping) {
    let saves = new_backup.parent().map(Path::to_path_buf);
    if let Some(dir) = hk.mirror_dir.as_ref().filter(|d| !d.trim().is_empty()) {
        let mirror = PathBuf::from(dir);
        match copy_to_mirror(new_backup, &mirror) {
            Ok(_) => {
                if let Some(keep) = hk.retention {
                    apply_retention(&mirror, keep.max(1) as usize);
                }
            }
            Err(e) => {
                let _ = app.emit("backup-mirror-failed", e);
            }
        }
    }
    if let (Some(keep), Some(dir)) = (hk.retention, saves.as_ref()) {
        apply_retention(dir, keep.max(1) as usize);
    }
    if hk.compress_old == Some(true) {
        if let Some(dir) = saves.as_ref() {
            compress_old_backups(dir, 3);
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackupVerifyReport {
    ok: bool,
    format_version: u64,
    games: usize,
    notes: usize,
    files: usize,
    has_wallet: bool,
    problems: Vec<String>,
}

/// Open a backup and read every byte of it: the zip checks each entry's
/// CRC while reading, the manifest must parse into the real record types,
/// and library paths must be safe to restore.
fn verify_backup_at(path: &Path) -> BackupVerifyReport {
    use std::io::Read;
    let mut r = BackupVerifyReport::default();
    let is_zip = path
        .extension()
        .and_then(|e| e.to_str())
        .map_or(false, |e| e.eq_ignore_ascii_case("zip") || e.eq_ignore_ascii_case("part"));
    if !is_zip {
        match fs::read_to_string(path).map_err(|e| e.to_string()).and_then(|raw| {
            serde_json::from_str::<BackupSnapshot>(&raw).map_err(|e| e.to_string())
        }) {
            Ok(snap) => {
                r.format_version = snap.version as u64;
                r.games = snap.games.len();
                r.notes = snap.notes.len();
                r.files = snap.files.len();
                r.has_wallet = snap.wallet.is_some() || !snap.settings.global_expenses.is_empty();
                for f in &snap.files {
                    if validate_relative_backup_path(&f.path).is_err() {
                        r.problems.push(format!("guvensiz yol: {}", f.path));
                    }
                }
            }
            Err(e) => r.problems.push(format!("okunamadi: {e}")),
        }
        r.ok = r.problems.is_empty();
        return r;
    }
    let mut archive = match fs::File::open(path).map_err(|e| e.to_string()).and_then(|f| {
        zip::ZipArchive::new(f).map_err(|e| e.to_string())
    }) {
        Ok(a) => a,
        Err(e) => {
            r.problems.push(format!("zip acilamadi: {e}"));
            return r;
        }
    };
    let mut manifest_seen = false;
    let mut sink = Vec::new();
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(e) => { r.problems.push(format!("kayit {i}: {e}")); continue; }
        };
        let name = entry.name().to_string();
        sink.clear();
        if let Err(e) = entry.read_to_end(&mut sink) {
            r.problems.push(format!("{name}: {e}"));
            continue;
        }
        if name == "manifest.json" {
            manifest_seen = true;
            let v: serde_json::Value = match serde_json::from_slice(&sink) {
                Ok(v) => v,
                Err(e) => { r.problems.push(format!("manifest.json: {e}")); continue; }
            };
            r.format_version = v.get("version").and_then(|x| x.as_u64()).unwrap_or(0);
            if r.format_version != 2 {
                r.problems.push(format!("desteklenmeyen surum: {}", r.format_version));
            }
            match v.get("games").map(|g| serde_json::from_value::<Vec<GameRecord>>(g.clone())) {
                Some(Ok(g)) => r.games = g.len(),
                Some(Err(e)) => r.problems.push(format!("oyunlar: {e}")),
                None => r.problems.push("oyun listesi yok".into()),
            }
            if let Some(n) = v.get("notes") {
                match serde_json::from_value::<Vec<NoteRecord>>(n.clone()) {
                    Ok(n) => r.notes = n.len(),
                    Err(e) => r.problems.push(format!("notlar: {e}")),
                }
            }
            if let Some(s) = v.get("settings") {
                match serde_json::from_value::<AppSettings>(s.clone()) {
                    Ok(s) => r.has_wallet |= !s.global_expenses.is_empty(),
                    Err(e) => r.problems.push(format!("ayarlar: {e}")),
                }
            }
            if let Some(w) = v.get("wallet").filter(|w| !w.is_null()) {
                match serde_json::from_value::<WalletFile>(w.clone()) {
                    Ok(_) => r.has_wallet = true,
                    Err(e) => r.problems.push(format!("cuzdan: {e}")),
                }
            }
        } else if let Some(rel) = name.strip_prefix("library/") {
            if !rel.is_empty() && !name.ends_with('/') {
                r.files += 1;
                if validate_relative_backup_path(rel).is_err() {
                    r.problems.push(format!("guvensiz yol: {name}"));
                }
            }
        }
    }
    if !manifest_seen {
        r.problems.push("manifest.json yok".into());
    }
    r.ok = r.problems.is_empty();
    r
}

#[tauri::command(async)]
fn verify_backup(app: AppHandle, path: String) -> Result<BackupVerifyReport, String> {
    let target = PathBuf::from(&path);
    let canon = target.canonicalize().map_err(|e| e.to_string())?;
    let allowed = backup_dirs(&app)?
        .into_iter()
        .filter_map(|d| d.canonicalize().ok())
        .any(|d| canon.starts_with(&d));
    if !allowed {
        return Err("Path is outside the backup directory.".to_string());
    }
    Ok(verify_backup_at(&canon))
}

// ── Import / export (v0.9.9, Settings → Import & Export) ────────────────────
//
// Format conversion (CSV, Markdown, Obsidian, Notion, Trello) lives in
// `src/lib/importExport.ts` where it is unit-tested; Rust only picks,
// reads and writes files. The one exception is the single-game bundle,
// which has to copy image files between workspaces.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextFileOut {
    name: String,
    contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileIn {
    /// Path relative to the picked folder / archive, `/`-separated.
    relative: String,
    contents: String,
    modified_at: String,
}

const IMPORT_MAX_FILES: usize = 5000;
const IMPORT_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// A file name that can't escape the target folder or upset Windows.
fn safe_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let mut name: String = trimmed.chars().take(120).collect();
    if name.is_empty() {
        name = "untitled".into();
    }
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "LPT1" | "LPT2") {
        name = format!("_{name}");
    }
    name
}

fn mtime_iso(md: &fs::Metadata) -> String {
    md.modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
        .unwrap_or_else(now_iso)
}

/// Save one text file through a save dialog. Returns the chosen path.
#[tauri::command(async)]
fn save_text_file_dialog(
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    contents: String,
) -> Result<String, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let path = FileDialog::new()
        .set_file_name(&safe_file_name(&default_name))
        .add_filter(&filter_name, &exts)
        .save_file()
        .ok_or_else(|| "Kaydetme iptal edildi.".to_string())?;
    atomic_write(&path, contents.as_bytes())?;
    Ok(path.to_string_lossy().to_string())
}

/// Write many text files into a NEW subfolder of `dir` (never into an
/// existing one, so nothing of the user's is overwritten). Returns the
/// folder created.
#[tauri::command(async)]
fn write_text_files_to_new_folder(dir: String, folder_name: String, files: Vec<TextFileOut>) -> Result<String, String> {
    let parent = PathBuf::from(&dir);
    if !parent.is_dir() {
        return Err(format!("Klasor bulunamadi: {dir}"));
    }
    let base = safe_file_name(&folder_name);
    let mut target = parent.join(&base);
    let mut n = 2;
    while target.exists() {
        target = parent.join(format!("{base} ({n})"));
        n += 1;
    }
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    for f in files {
        let name = safe_file_name(&f.name);
        let (stem, ext) = match name.rfind('.') {
            Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
            _ => (name.clone(), String::new()),
        };
        let mut candidate = name.clone();
        let mut k = 2;
        while !used.insert(candidate.to_lowercase()) {
            candidate = format!("{stem} ({k}){ext}");
            k += 1;
        }
        fs::write(target.join(&candidate), f.contents.as_bytes()).map_err(|e| format!("{candidate}: {e}"))?;
    }
    Ok(target.to_string_lossy().to_string())
}

fn read_text_files_from_dir(root: &Path, exts: &[String]) -> Result<Vec<TextFileIn>, String> {
    let mut out = Vec::new();
    fn visit(root: &Path, dir: &Path, exts: &[String], depth: u32, out: &mut Vec<TextFileIn>) -> Result<(), String> {
        if depth > 12 || out.len() >= IMPORT_MAX_FILES {
            return Ok(());
        }
        let Ok(rd) = fs::read_dir(dir) else { return Ok(()) };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                // Obsidian config / trash and other hidden folders.
                if name.starts_with('.') || name == "node_modules" {
                    continue;
                }
                visit(root, &p, exts, depth + 1, out)?;
            } else if md.is_file() {
                let lower = name.to_lowercase();
                if !exts.iter().any(|x| lower.ends_with(&format!(".{}", x.to_lowercase()))) {
                    continue;
                }
                if md.len() > IMPORT_MAX_BYTES {
                    continue;
                }
                let contents = fs::read_to_string(&p).map_err(|err| format!("{name}: {err}"))?;
                let relative = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                out.push(TextFileIn { relative, contents, modified_at: mtime_iso(&md) });
                if out.len() >= IMPORT_MAX_FILES {
                    break;
                }
            }
        }
        Ok(())
    }
    visit(root, root, exts, 0, &mut out)?;
    Ok(out)
}

/// Text files inside a zip; zips inside it (Notion splits big exports
/// into `Part-N.zip`) are opened one level deep.
fn read_text_files_from_zip_reader<R: std::io::Read + std::io::Seek>(
    reader: R,
    exts: &[String],
    depth: u32,
    out: &mut Vec<TextFileIn>,
) -> Result<(), String> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("zip: {e}"))?;
    for i in 0..archive.len() {
        if out.len() >= IMPORT_MAX_FILES {
            break;
        }
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        let lower = name.to_lowercase();
        if lower.split('/').any(|seg| seg.starts_with('.') || seg == "__macosx") {
            continue;
        }
        if lower.ends_with(".zip") && depth == 0 {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            read_text_files_from_zip_reader(std::io::Cursor::new(buf), exts, depth + 1, out)?;
            continue;
        }
        if !exts.iter().any(|x| lower.ends_with(&format!(".{}", x.to_lowercase()))) || entry.size() > IMPORT_MAX_BYTES {
            continue;
        }
        let mut contents = String::new();
        if entry.read_to_string(&mut contents).is_err() {
            continue; // not UTF-8 text
        }
        out.push(TextFileIn { relative: name, contents, modified_at: now_iso() });
    }
    Ok(())
}

/// Pick a folder (or, with `allow_zip`, a .zip) and read its text files
/// with the given extensions. Returns (source path, files).
#[tauri::command(async)]
fn pick_and_read_text_files(
    extensions: Vec<String>,
    allow_zip: Option<bool>,
    title: Option<String>,
) -> Result<(String, Vec<TextFileIn>), String> {
    let title = title.unwrap_or_else(|| "Klasor sec".into());
    if allow_zip == Some(true) {
        // A zip export (Notion) or an already-unzipped folder.
        if let Some(file) = FileDialog::new().set_title(&title).add_filter("ZIP", &["zip"]).pick_file() {
            let mut out = Vec::new();
            let f = fs::File::open(&file).map_err(|e| e.to_string())?;
            read_text_files_from_zip_reader(f, &extensions, 0, &mut out)?;
            return Ok((file.to_string_lossy().to_string(), out));
        }
        return Err("Secim iptal edildi.".into());
    }
    let dir = FileDialog::new()
        .set_title(&title)
        .pick_folder()
        .ok_or_else(|| "Secim iptal edildi.".to_string())?;
    let files = read_text_files_from_dir(&dir, &extensions)?;
    Ok((dir.to_string_lossy().to_string(), files))
}

/// Pick one text file (CSV, Trello JSON...).
#[tauri::command(async)]
fn pick_and_read_text_file(filter_name: String, extensions: Vec<String>) -> Result<TextFileIn, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let path = FileDialog::new()
        .add_filter(&filter_name, &exts)
        .pick_file()
        .ok_or_else(|| "Secim iptal edildi.".to_string())?;
    let md = fs::metadata(&path).map_err(|e| e.to_string())?;
    if md.len() > 50 * 1024 * 1024 {
        return Err("Dosya cok buyuk (50 MB ustu).".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    // Excel saves CSV with a BOM; strip it.
    let text = String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)).to_string();
    Ok(TextFileIn {
        relative: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        contents: text,
        modified_at: mtime_iso(&md),
    })
}

/// A game ready to leave the workspace: builds are not bundled (they can
/// be gigabytes and belong to one machine's release flow), so their
/// paths are cleared; version entries and notes stay.
fn game_for_bundle(game: &GameRecord) -> GameRecord {
    let mut g = game.clone();
    g.current_build_relative_path = None;
    for v in g.versions.iter_mut() {
        v.build_relative_path = None;
    }
    g
}

/// Images to bundle: files under the game's `assets/` folder, as
/// (path inside the bundle, source path).
fn bundle_assets(game_dir: &Path) -> Vec<(String, PathBuf)> {
    let mut files = Vec::new();
    walk_files(&game_dir.join("assets"), 0, &mut files);
    files
        .into_iter()
        .map(|(p, _)| {
            let rel = p.strip_prefix(game_dir).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            (rel, p)
        })
        .collect()
}

/// Settings → Import & Export → "Export a single game":
/// `<title>.heravex-game.zip` with `game.json` + the game's images.
#[tauri::command(async)]
fn export_game_bundle(app: AppHandle, game_id: String) -> Result<String, String> {
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};
    let game = {
        let _io = io_lock();
        load_games_from_disk(&app)?
            .into_iter()
            .find(|g| g.id == game_id)
            .ok_or_else(|| "Oyun bulunamadi.".to_string())?
    };
    let target = FileDialog::new()
        .set_file_name(&format!("{}.heravex-game.zip", safe_file_name(&slugify(&game.title))))
        .add_filter("HeraVex game", &["zip"])
        .save_file()
        .ok_or_else(|| "Kaydetme iptal edildi.".to_string())?;
    let game_dir = game_folder(&app, &game)?;
    let part = target.with_extension("zip.part");
    {
        let mut zip = ZipWriter::new(fs::File::create(&part).map_err(|e| e.to_string())?);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let payload = serde_json::json!({
            "kind": "heravex-game",
            "version": 1,
            "exportedAt": now_iso(),
            "game": game_for_bundle(&game),
        });
        zip.start_file("game.json", opts).map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        for (rel, src) in bundle_assets(&game_dir) {
            let bytes = fs::read(&src).map_err(|e| format!("{rel}: {e}"))?;
            zip.start_file(format!("files/{rel}"), opts).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    fs::rename(&part, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

/// Re-point image paths (absolute paths from the exporting machine) at
/// the copies in the new game folder, matched by file name.
fn remap_bundle_paths(game: &mut GameRecord, by_name: &std::collections::HashMap<String, PathBuf>) {
    let remap = |raw: &str| -> Option<String> {
        if raw.is_empty() || raw.starts_with("data:") {
            return None;
        }
        let name = raw.replace('\\', "/").rsplit('/').next().unwrap_or("").to_lowercase();
        by_name.get(&name).map(|p| p.to_string_lossy().to_string())
    };
    if let Some(cover) = game.cover_data_url.clone() {
        if let Some(p) = remap(&cover) {
            game.cover_data_url = Some(p);
        }
    }
    for item in game.moodboard.items.iter_mut() {
        if let Some(p) = remap(&item.path) {
            item.path = p;
        }
    }
}

/// "HeraVex JSON" import: a `.heravex-game.zip` from "Export a single
/// game" (or a bare game `.json`). The game gets a NEW id, so importing
/// into the workspace it came from makes a copy instead of overwriting.
#[tauri::command(async)]
fn import_game_bundle(app: AppHandle) -> Result<GameRecord, String> {
    use std::io::Read;
    let path = FileDialog::new()
        .add_filter("HeraVex game", &["zip", "json"])
        .pick_file()
        .ok_or_else(|| "Secim iptal edildi.".to_string())?;
    let is_zip = path.extension().and_then(|e| e.to_str()).map_or(false, |e| e.eq_ignore_ascii_case("zip"));
    let mut images: Vec<(String, Vec<u8>)> = Vec::new();
    let raw_json: Vec<u8> = if is_zip {
        let mut archive = zip::ZipArchive::new(fs::File::open(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("zip: {e}"))?;
        let mut json = None;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().replace('\\', "/");
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| format!("{name}: {e}"))?;
            if name == "game.json" {
                json = Some(buf);
            } else if let Some(rel) = name.strip_prefix("files/") {
                if !rel.is_empty() && !name.ends_with('/') {
                    images.push((validate_relative_backup_path(rel)?.to_string_lossy().replace('\\', "/"), buf));
                }
            }
        }
        json.ok_or_else(|| "Bu dosya bir HeraVex oyun paketi degil (game.json yok).".to_string())?
    } else {
        fs::read(&path).map_err(|e| e.to_string())?
    };
    let value: serde_json::Value = serde_json::from_slice(&raw_json).map_err(|e| format!("game.json: {e}"))?;
    let game_value = value.get("game").cloned().unwrap_or(value);
    let mut game: GameRecord =
        serde_json::from_value(game_value).map_err(|e| format!("Oyun okunamadi: {e}"))?;

    let _io = io_lock();
    let _guard = WORKSPACE_WRITE_LOCK.lock().map_err(|e| format!("write-lock zehirlendi: {e}"))?;
    let existing = load_games_from_disk(&app)?;
    let mut new_id = next_id();
    while existing.iter().any(|g| g.id == new_id) {
        new_id = next_id();
    }
    game.id = new_id;
    if existing.iter().any(|g| g.title == game.title) {
        game.title = format!("{} (2)", game.title);
    }
    game.updated_at = now_iso();
    let game = game_for_bundle(&game);
    let mut game = game;
    let dir = game_folder(&app, &game)?;
    fs::create_dir_all(dir.join("versions")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    let mut by_name = std::collections::HashMap::new();
    for (rel, bytes) in images {
        let target = dir.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
        let name = target.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        by_name.insert(name, target);
    }
    remap_bundle_paths(&mut game, &by_name);
    save_single_game_to_disk(&app, &game)?;
    append_activity(&app, "game.imported", Some(game.title.clone()));
    Ok(game)
}

/// Settings → Webhooks → Custom. POSTs `body` as JSON. Only https (or
/// http to this machine, for testing) so a typo can't send data in the
/// clear across the internet. Returns the HTTP status.
fn webhook_url_allowed(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    lower.starts_with("https://")
        || lower.starts_with("http://localhost")
        || lower.starts_with("http://127.0.0.1")
}

#[tauri::command]
async fn post_webhook(url: String, body: serde_json::Value) -> Result<u16, String> {
    if !webhook_url_allowed(&url) {
        return Err("Webhook adresi https:// ile baslamali.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("HeraVex/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(url.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Webhook gonderilemedi: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Webhook {} dondu", status.as_u16()));
    }
    Ok(status.as_u16())
}

/// Destructive nuclear option. Walks the data root and removes every
/// subdirectory we created (games/, notes/, library/, backups/) plus
/// the settings file. The frontend gates this behind a "type SIL to
/// confirm" prompt; this command itself is unconditional, so don't
/// expose it casually.
#[tauri::command]
fn delete_all_data(app: AppHandle) -> Result<(), String> {
    let root = data_root(&app)?;
    // Per-directory removal so an unrelated file users dropped in the
    // root (e.g. an editor backup) doesn't get caught.
    for sub in ["games", "notes", "library", "backups"] {
        let p = root.join(sub);
        if p.exists() {
            fs::remove_dir_all(&p).map_err(|e| format!("{sub}: {e}"))?;
        }
    }
    // settings.json + cached files
    for name in ["settings.json", "wallet.json", "games.legacy.json", "notes.legacy.json"] {
        let p = root.join(name);
        if p.exists() {
            let _ = fs::remove_file(&p);
        }
    }
    Ok(())
}

/// Small file IO bridges used by the export-redaction pass. We
/// keep them constrained to UTF-8 text so binary backups never go
/// through here, and we don't expose them on the CSP-restricted
/// surface (no `fs` plugin pulled in).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Opens the host's log directory in the OS file manager. Falls back
/// to the app data root when the platform log dir is unavailable.
#[tauri::command]
fn open_log_directory(app: AppHandle) -> Result<(), String> {
    let path = app.path()
        .app_log_dir()
        .ok()
        .filter(|p| p.exists())
        .or_else(|| data_root(&app).ok())
        .ok_or_else(|| "Log dizini bulunamadi.".to_string())?;
    open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_backup(app: AppHandle, path: String) -> Result<(), String> {
    // Defence in depth — only allow deletes of files that genuinely
    // live under one of our backup directories. Both `Saves/` (current)
    // and `backups/` (legacy) are accepted so users upgrading from older
    // builds can still prune their old files.
    let target = PathBuf::from(&path);
    let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
    let mut ok = false;
    for dir in backup_dirs(&app)? {
        if let Ok(canon) = dir.canonicalize() {
            if canonical_target.starts_with(&canon) {
                ok = true;
                break;
            }
        }
    }
    if !ok {
        return Err("Path is outside the backup directory.".to_string());
    }
    fs::remove_file(&canonical_target).map_err(|e| e.to_string())
}

/// Resolve a workspace-relative build path to the absolute folder that
/// contains it. Used by the Butler panel on the Versions tab to pre-fill
/// its "Local build folder" input when a user clicks "Push this version
/// with Butler" — Butler operates on a directory, so we strip the
/// filename. Mirrors the validation in `reveal_build_file`.
#[tauri::command]
fn resolve_build_folder(app: AppHandle, relative: String) -> Result<String, String> {
    let rel = relative.trim();
    if rel.is_empty() {
        return Err("Build yolu bos.".into());
    }
    let rel_path = PathBuf::from(rel);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Gecersiz build yolu.".into());
    }
    let full_path = library_dir(&app)?.join(&rel_path);
    if !full_path.exists() {
        return Err("Build dosyasi bulunamadi.".into());
    }
    let folder = if full_path.is_dir() {
        full_path
    } else {
        full_path
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "Build klasoru bulunamadi.".to_string())?
    };
    Ok(folder.to_string_lossy().to_string())
}

/// Reveal a build file by its workspace-relative path (as stored on
/// `VersionItem.build_relative_path`). Resolves the path against the active
/// library directory and opens the containing folder. Frontend cannot call
/// `reveal_in_folder` directly because it only has the relative segment.
#[tauri::command]
fn reveal_build_file(app: AppHandle, relative: String) -> Result<(), String> {
    // Reject absolute or traversal-y inputs — the relative string comes from
    // our own data files but we still treat it as untrusted.
    let rel = relative.trim();
    if rel.is_empty() {
        return Err("Build yolu bos.".into());
    }
    let rel_path = PathBuf::from(rel);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Gecersiz build yolu.".into());
    }

    let full_path = library_dir(&app)?.join(&rel_path);
    if !full_path.exists() {
        return Err("Build dosyasi bulunamadi.".into());
    }

    let folder = if full_path.is_dir() {
        full_path.clone()
    } else {
        full_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(full_path)
    };
    open::that(folder).map_err(|e| e.to_string())
}

/// Open a URL (http/https/mailto) in the user's default OS handler.
/// Tauri's webview blocks `window.open` for external schemes, so the frontend
/// must round-trip through this command for "Send feedback", "View releases",
/// store page links, etc.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    // Reject anything that isn't an obvious URL — prevents accidentally
    // shelling out to arbitrary paths from untrusted frontend input.
    let trimmed = url.trim();
    let is_url = trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("mailto:");
    if !is_url {
        return Err("Yalnizca http(s):// veya mailto: URL'leri acilabilir.".to_string());
    }
    open::that(trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_csv_report(_app: AppHandle, csv_content: String) -> Result<String, String> {
    let save_path = FileDialog::new()
        .set_title("CSV Raporunu Kaydet")
        .add_filter("CSV", &["csv"])
        .set_file_name(&format!(
            "heravex-report-{}.csv",
            Utc::now().format("%Y%m%d-%H%M")
        ))
        .save_file()
        .ok_or_else(|| "XLS/CSV disa aktarma iptal edildi.".to_string())?;

    fs::write(&save_path, csv_content).map_err(|err| err.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
}

/// Plugin manifest discovery for the v0.9.x plugin/extension API.
///
/// Walks `<workspace>/plugins/<id>/heravex.plugin.json` and returns a
/// JSON-encoded array of `{ manifest, entryUrl }` records. The JS
/// loader (`src/lib/plugins.ts`) handles enabling/disabling and
/// mounting; this side is intentionally dumb — it just enumerates.
///
/// Returns an empty array (never an error) when the plugins folder is
/// missing. That keeps the API call cheap on every page mount even
/// for users with no plugins installed.
// ═══ Plugin system (v0.9.9) ═══════════════════════════════════════════════
//
// Plugins are INSTALLATION-GLOBAL (`<app-data>/plugins/<id>/`), not
// workspace-scoped — a shared team folder must never be able to push
// executable code onto a teammate's machine. Each plugin ships a
// `heravex.plugin.json` manifest plus a single bundled ES-module entry.
//
// Install flow is consent-gated in three steps so the frontend can show
// the permission screen BEFORE anything lands in the plugins dir:
//   1. plugin_fetch(source)   — source is a local .zip/.hvx path OR an
//      http(s) URL; stages the archive under plugins/.staging/ and
//      returns the parsed+validated manifest.
//   2. plugin_install(staged) — extracts the staged archive (zip-slip
//      safe) into plugins/<id>/, replacing any existing version.
//   3. plugin_discard(staged) — user hit cancel; delete the staged file.

fn plugins_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root_dir(app)?.join("plugins");
    fs::create_dir_all(&dir).map_err(|e| format!("plugins dizini olusturulamadi: {e}"))?;
    Ok(dir)
}

fn valid_plugin_id(id: &str) -> bool {
    id.len() >= 2 && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-') && !id.starts_with('.')
}

/// Locate `heravex.plugin.json` inside the archive: either at the root
/// or under exactly one top-level folder (the shape you get when a user
/// zips the plugin folder itself). Returns (root_prefix, manifest).
fn zip_find_manifest(
    archive: &mut zip::ZipArchive<std::fs::File>,
) -> Result<(String, serde_json::Value), String> {
    use std::io::Read;
    let mut candidates: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let name = archive.by_index(i).map_err(|e| e.to_string())?.name().to_string();
        if name == "heravex.plugin.json" || (name.ends_with("/heravex.plugin.json") && name.matches('/').count() == 1) {
            candidates.push(name);
        }
    }
    // Prefer a root-level manifest; else exactly one nested candidate.
    candidates.sort_by_key(|n| n.matches('/').count());
    let manifest_name = candidates.first()
        .ok_or_else(|| "Arsivde heravex.plugin.json bulunamadi.".to_string())?
        .clone();
    let prefix = manifest_name.strip_suffix("heravex.plugin.json").unwrap_or("").to_string();
    let mut raw = String::new();
    archive.by_name(&manifest_name).map_err(|e| e.to_string())?
        .read_to_string(&mut raw).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Manifest JSON hatali: {e}"))?;
    Ok((prefix, manifest))
}

fn validate_plugin_manifest(
    manifest: &serde_json::Value,
    archive: &mut zip::ZipArchive<std::fs::File>,
    prefix: &str,
) -> Result<(), String> {
    let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if !valid_plugin_id(id) {
        return Err("Manifest 'id' gecersiz (kucuk harf, rakam ve tire; 2-64 karakter).".into());
    }
    if manifest.get("name").and_then(|v| v.as_str()).map(str::trim).unwrap_or("").is_empty() {
        return Err("Manifest 'name' zorunlu.".into());
    }
    if manifest.get("apiVersion").and_then(|v| v.as_u64()) != Some(1) {
        return Err("Desteklenmeyen apiVersion (1 bekleniyor).".into());
    }
    let entry = manifest.get("entry").and_then(|v| v.as_str()).unwrap_or("index.js");
    if entry.contains("..") || entry.starts_with('/') || entry.starts_with('\\') {
        return Err("Manifest 'entry' yolu gecersiz.".into());
    }
    let entry_name = format!("{prefix}{entry}");
    if archive.by_name(&entry_name).is_err() {
        return Err(format!("Giris dosyasi arsivde yok: {entry}"));
    }
    Ok(())
}

/// Read a response body, failing as soon as it passes `limit` bytes —
/// the old code downloaded everything first and only then checked the
/// size, so a huge (or endless) response could exhaust memory.
async fn read_body_capped(mut resp: reqwest::Response, limit: usize, what: &str) -> Result<Vec<u8>, String> {
    if let Some(len) = resp.content_length() {
        if len as usize > limit {
            return Err(format!("{what} cok buyuk ({} MB siniri).", limit / (1024 * 1024)));
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > limit {
            return Err(format!("{what} cok buyuk ({} MB siniri).", limit / (1024 * 1024)));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginFetchResult {
    manifest: serde_json::Value,
    staged: String,
}

/// Stage a plugin archive from a local path or URL and return its
/// validated manifest for the consent screen. Nothing is installed yet.
#[tauri::command]
async fn plugin_fetch(app: AppHandle, source: String) -> Result<PluginFetchResult, String> {
    let staging_dir = plugins_root(&app)?.join(".staging");
    fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    let staged = staging_dir.join(format!("{}.zip", uuid::Uuid::new_v4().simple()));

    let src = source.trim().to_string();
    if src.starts_with("http://") || src.starts_with("https://") {
        let resp = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build().map_err(|e| e.to_string())?
            .get(&src).send().await
            .map_err(|e| format!("Indirme basarisiz: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Indirme basarisiz: HTTP {}", resp.status()));
        }
        let bytes = read_body_capped(resp, 50 * 1024 * 1024, "Eklenti arsivi").await?;
        fs::write(&staged, &bytes).map_err(|e| e.to_string())?;
    } else {
        let from = PathBuf::from(&src);
        if !from.is_file() {
            return Err(format!("Dosya bulunamadi: {src}"));
        }
        fs::copy(&from, &staged).map_err(|e| e.to_string())?;
    }

    // Validate: must be a zip containing a manifest + entry module.
    let file = std::fs::File::open(&staged).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| { let _ = fs::remove_file(&staged); "Dosya gecerli bir eklenti arsivi degil (.zip/.hvx bekleniyor).".to_string() })?;
    let (prefix, manifest) = match zip_find_manifest(&mut archive) {
        Ok(v) => v,
        Err(e) => { let _ = fs::remove_file(&staged); return Err(e); }
    };
    if let Err(e) = validate_plugin_manifest(&manifest, &mut archive, &prefix) {
        let _ = fs::remove_file(&staged);
        return Err(e);
    }
    Ok(PluginFetchResult { manifest, staged: staged.to_string_lossy().to_string() })
}

/// Unpacked size limit for one plugin (zip-bomb guard).
const PLUGIN_MAX_UNPACKED: u64 = 200 * 1024 * 1024;

/// Extract the plugin files (under `prefix`) into `dest`. Zip-slip safe:
/// only paths that stay inside the archive root are written.
fn extract_plugin_archive(
    archive: &mut zip::ZipArchive<std::fs::File>,
    prefix: &str,
    dest: &Path,
) -> Result<(), String> {
    use std::io::Read;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else { continue };
        let rel = enclosed.to_string_lossy().replace('\\', "/");
        let Some(stripped) = rel.strip_prefix(prefix) else { continue };
        if stripped.is_empty() { continue; }
        let out_path = dest.join(stripped);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        // `take` bounds what we read even if the header lies about the size.
        (&mut entry).take(PLUGIN_MAX_UNPACKED - total + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        total += buf.len() as u64;
        if total > PLUGIN_MAX_UNPACKED {
            return Err("Eklenti acildiginda cok buyuk (200 MB siniri).".into());
        }
        fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Extract a previously staged archive into plugins/<id>/ (consent given).
/// The new version is unpacked next to the old one first and only then
/// swapped in, so a failed install never leaves the plugin missing.
/// Async: unpacking a large plugin must not freeze the window.
#[tauri::command(async)]
fn plugin_install(app: AppHandle, staged: String) -> Result<serde_json::Value, String> {
    let staged_path = PathBuf::from(&staged);
    let root = plugins_root(&app)?;
    let staging_dir = root.join(".staging");
    if !staged_path.starts_with(&staging_dir) || !staged_path.is_file() {
        return Err("Gecersiz kurulum dosyasi.".into());
    }
    let file = std::fs::File::open(&staged_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let (prefix, manifest) = zip_find_manifest(&mut archive)?;
    validate_plugin_manifest(&manifest, &mut archive, &prefix)?;
    let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let target = root.join(&id);
    let fresh = staging_dir.join(format!("{id}.new-{}", uuid::Uuid::new_v4().simple()));
    let old = staging_dir.join(format!("{id}.old-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&fresh).map_err(|e| e.to_string())?;
    if let Err(e) = extract_plugin_archive(&mut archive, &prefix, &fresh) {
        let _ = fs::remove_dir_all(&fresh);
        return Err(e);
    }
    // Swap: old → aside, new → place; put the old one back on failure.
    if target.exists() {
        fs::rename(&target, &old).map_err(|e| {
            let _ = fs::remove_dir_all(&fresh);
            format!("Eski surum yerinden alinamadi (eklenti kullanimda olabilir): {e}")
        })?;
    }
    if let Err(e) = fs::rename(&fresh, &target) {
        if old.exists() {
            let _ = fs::rename(&old, &target);
        }
        let _ = fs::remove_dir_all(&fresh);
        return Err(format!("Eklenti yerlestirilemedi: {e}"));
    }
    if old.exists() {
        let _ = fs::remove_dir_all(&old);
    }
    let _ = fs::remove_file(&staged_path);
    append_activity(&app, "plugin.installed", manifest.get("name").and_then(|v| v.as_str()).map(String::from));
    Ok(manifest)
}

/// User cancelled the consent screen — drop the staged archive.
#[tauri::command]
fn plugin_discard(app: AppHandle, staged: String) -> Result<(), String> {
    let staged_path = PathBuf::from(&staged);
    let staging_dir = plugins_root(&app)?.join(".staging");
    if staged_path.starts_with(&staging_dir) && staged_path.is_file() {
        let _ = fs::remove_file(&staged_path);
    }
    Ok(())
}

#[tauri::command]
fn plugin_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_plugin_id(&id) {
        return Err("Gecersiz eklenti kimligi.".into());
    }
    let dir = plugins_root(&app)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Eklenti silinemedi: {e}"))?;
    }
    append_activity(&app, "plugin.uninstalled", Some(id));
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPluginEntry {
    manifest: serde_json::Value,
    /// Absolute path to the entry module — the frontend reads it and
    /// imports the code as a Blob URL (CSP: script-src blob:).
    entry_path: String,
    dir: String,
}

/// Enumerate installed plugins from the GLOBAL plugins directory.
#[tauri::command]
fn plugins_list(app: AppHandle) -> Result<Vec<InstalledPluginEntry>, String> {
    let root = plugins_root(&app)?;
    let mut out = Vec::new();
    // Safe-mode kill-switch: if a `.disabled` marker file exists in the
    // plugins dir, load NOTHING. Recovery hatch for when a bad plugin
    // freezes the UI — the user (or support) drops the file in without
    // needing to reach Settings. Delete it to re-enable plugins.
    if root.join(".disabled").exists() {
        return Ok(out);
    }
    let entries = match fs::read_dir(&root) { Ok(e) => e, Err(_) => return Ok(out) };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let dir_name = dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if dir_name.starts_with('.') { continue; } // .staging
        let manifest_path = dir.join("heravex.plugin.json");
        let raw = match fs::read_to_string(&manifest_path) { Ok(s) => s, Err(_) => continue };
        let manifest: serde_json::Value = match serde_json::from_str(&raw) { Ok(v) => v, Err(_) => continue };
        // The folder IS the id (installer guarantees it, the SDK documents
        // it); uninstall deletes plugins/<id>, so a mismatch could never
        // be removed from the UI. Same for entry paths leaving the folder.
        let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if !valid_plugin_id(id) || id != dir_name {
            eprintln!("[plugins] skipped {dir_name}: manifest id '{id}' must match the folder name");
            continue;
        }
        let entry_name = manifest.get("entry").and_then(|v| v.as_str()).unwrap_or("index.js");
        if entry_name.contains("..") || entry_name.starts_with('/') || entry_name.starts_with('\\') {
            continue;
        }
        let entry_path = dir.join(entry_name);
        if !entry_path.is_file() { continue; }
        out.push(InstalledPluginEntry {
            manifest,
            entry_path: entry_path.to_string_lossy().to_string(),
            dir: dir.to_string_lossy().to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
fn pick_plugin_zip() -> Result<String, String> {
    let picked = FileDialog::new()
        .set_title("Eklenti arsivi sec")
        .add_filter("HeraVex Eklentisi", &["zip", "hvx"])
        .pick_file()
        .ok_or_else(|| "Eklenti secimi iptal edildi.".to_string())?;
    Ok(picked.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginHttpResponse {
    status: u16,
    body: String,
    content_type: Option<String>,
}

/// HTTP proxy for plugins (`hv.fetch`). The webview CSP rightfully
/// blocks plugin `fetch()` to arbitrary hosts, so network-permitted
/// plugins route through reqwest instead — same pattern as the FX-rate
/// fetcher. Response bodies are text and capped at 10MB.
#[tauri::command]
async fn plugin_http_fetch(
    url: String,
    method: Option<String>,
    body: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<PluginHttpResponse, String> {
    let trimmed = url.trim().to_string();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Yalnizca http(s):// adresleri desteklenir.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let m = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let mut req = match m.as_str() {
        "GET" => client.get(&trimmed),
        "POST" => client.post(&trimmed),
        "PUT" => client.put(&trimmed),
        "PATCH" => client.patch(&trimmed),
        "DELETE" => client.delete(&trimmed),
        "HEAD" => client.head(&trimmed),
        other => return Err(format!("Desteklenmeyen HTTP metodu: {other}")),
    };
    if let Some(map) = headers {
        for (k, v) in map {
            req = req.header(k, v);
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| format!("Istek basarisiz: {e}"))?;
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let bytes = read_body_capped(resp, 10 * 1024 * 1024, "Yanit").await?;
    Ok(PluginHttpResponse {
        status,
        body: String::from_utf8_lossy(&bytes).to_string(),
        content_type,
    })
}

/// Lightweight fingerprint of the active workspace data root. Used by
/// the frontend Team-Mode polling loop to detect changes on cloud-sync
/// drives (Drive, OneDrive, Dropbox) where the OS filesystem notifier
/// is unreliable. Walks games.json, notes.json, activity.json, and the
/// library/ subtree non-recursively at the game-folder level — enough
/// to catch new games and edits without blowing CPU.
///
/// v0.9.7 — per-file modification manifest for fine-grained team sync.
///
/// Returns a map of `relative_path → mtime_secs` for every file that
/// the frontend cares about. The frontend diffs successive manifests
/// to dispatch *targeted* refresh events: when only `notes.json`
/// changed, the active NoteCenter silently re-fetches notes — no
/// modal, no full `refreshGames`, no jarring reload.
///
/// Why this replaces the global signature: a single hash collapses
/// every change into one yes/no event, which forced the UI to ask
/// "something changed somewhere, refresh?". With per-file mtimes the
/// UI can answer "what changed, who needs to know?" itself.
#[tauri::command(async)]
fn workspace_manifest(app: AppHandle) -> Result<std::collections::HashMap<String, u64>, String> {
    let root = data_root(&app)?;
    let mut out = std::collections::HashMap::new();
    if !root.exists() { return Ok(out); }
    fn visit(dir: &PathBuf, root: &PathBuf, depth: u32, out: &mut std::collections::HashMap<String, u64>) {
        if depth > 4 { return; }
        let entries = match fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
        for entry in entries.flatten() {
            let p = entry.path();
            let md = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            if md.is_dir() {
                let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                // Skip noisy directories — backups churn on every run,
                // plugins are user-installed, target is build output.
                if matches!(name, "backups" | "Saves" | "plugins" | "target" | "node_modules") {
                    continue;
                }
                visit(&p, root, depth + 1, out);
            } else if md.is_file() {
                let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                // Track JSON records plus the images teammates upload
                // (covers / moodboard under library/<game>/assets/).
                // Images arrive from the cloud client independently of
                // the game JSON that references them — often seconds
                // later — so the frontend needs to know when they land
                // to retry the <img> that failed. Build artifacts and
                // everything else stay untracked.
                let lower = rel.to_lowercase();
                let is_image = lower.starts_with("library/")
                    && lower.contains("/assets/")
                    && [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]
                        .iter()
                        .any(|ext| lower.ends_with(ext));
                let track = rel.ends_with(".json") || is_image;
                if !track { continue; }
                // Milliseconds, not seconds: two teammate saves inside
                // the same second used to share an mtime and the second
                // one was never detected. The size is folded in so an
                // in-place rewrite with a coarse mtime still registers.
                // The frontend only compares values for equality.
                let mtime = md.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.insert(rel, mtime.wrapping_mul(31).wrapping_add(md.len()));
            }
        }
    }
    visit(&root, &root, 0, &mut out);
    Ok(out)
}

#[tauri::command(async)]
fn compute_workspace_signature(app: AppHandle) -> Result<String, String> {
    let root = data_root(&app)?;
    if !root.exists() {
        return Ok(String::from("0:0:0:0"));
    }

    // Stat-tree fingerprint:
    //   file_count : total_size : max_mtime : name_hash
    //
    // `name_hash` is an additive hash of every file path's tail (relative
    // to root). Catches cloud-sync edge cases where the file count/size
    // stay identical but a file was renamed or replaced — Drive's
    // placeholder files frequently land with mtime=0 and size=0, so the
    // original 3-tuple couldn't distinguish "two empty placeholders for
    // different games" from "no change at all". Including the name hash
    // makes a brand-new game folder always change the signature.
    //
    // Also reads up to the first 256 bytes of games.json / notes.json
    // (the two most-edited files) into a rolling FNV-1a hash so an edit
    // that doesn't touch mtime — common on copy-over cloud writes — is
    // still caught.
    fn fnv1a(seed: u64, bytes: &[u8]) -> u64 {
        let mut h = seed;
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h
    }

    fn visit(dir: &PathBuf, root: &PathBuf, depth: u32, max_depth: u32,
            count: &mut u64, size: &mut u64, mtime: &mut u64,
            name_hash: &mut u64, content_hash: &mut u64) {
        if depth > max_depth { return; }
        let entries = match fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
        for entry in entries.flatten() {
            let p = entry.path();
            let md = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            if md.is_dir() {
                visit(&p, root, depth + 1, max_depth, count, size, mtime, name_hash, content_hash);
            } else {
                *count += 1;
                *size = size.saturating_add(md.len());
                if let Ok(modified) = md.modified() {
                    if let Ok(d) = modified.duration_since(std::time::UNIX_EPOCH) {
                        let secs = d.as_secs();
                        if secs > *mtime { *mtime = secs; }
                    }
                }
                // Name hash — relative path bytes folded in. Path
                // separators are normalised so a Win/Unix swap doesn't
                // flap the signature.
                if let Ok(rel) = p.strip_prefix(root) {
                    let s = rel.to_string_lossy().replace('\\', "/");
                    *name_hash = fnv1a(*name_hash, s.as_bytes());
                }
                // Content peek for the two hot-edit files. Cheap: bounded
                // to 256 bytes so even on huge JSONs we stay sub-ms.
                let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if fname == "games.json" || fname == "notes.json" || fname == "activity.json" {
                    if let Ok(buf) = fs::read(&p) {
                        let head = &buf[..buf.len().min(256)];
                        *content_hash = fnv1a(*content_hash, head);
                    }
                }
            }
        }
    }

    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let mut max_mtime: u64 = 0;
    let mut name_hash: u64 = 0xcbf29ce484222325;
    let mut content_hash: u64 = 0xcbf29ce484222325;
    visit(&root, &root, 0, 3,
        &mut file_count, &mut total_size, &mut max_mtime,
        &mut name_hash, &mut content_hash);

    Ok(format!("{}:{}:{}:{:016x}:{:016x}",
        file_count, total_size, max_mtime, name_hash, content_hash))
}

// ═══ System tray ═══════════════════════════════════════════════════════
//
// Closing the main window hides it instead of quitting, so team sync,
// Pomodoro and reminders keep running from the tray (bottom-right on
// Windows). The tray menu reopens the window and offers quick actions;
// "Quit" is the real exit. Users can turn hide-on-close off in
// Settings → General (`set_close_to_tray`).

static CLOSE_TO_TRAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
/// Settings → Startup "Minimise to tray": minimising hides the window to
/// the tray instead of the taskbar. Off by default.
static MINIMISE_TO_TRAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

const TRAY_ID: &str = "heravex-tray";

struct TrayMenuItems {
    open: tauri::menu::MenuItem<tauri::Wry>,
    new_task: tauri::menu::MenuItem<tauri::Wry>,
    new_note: tauri::menu::MenuItem<tauri::Wry>,
    pomodoro: tauri::menu::MenuItem<tauri::Wry>,
    quit: tauri::menu::MenuItem<tauri::Wry>,
}

/// [open, new task, new note, pomodoro, quit]
fn tray_labels(lang: &str) -> [&'static str; 5] {
    match lang {
        "tr" => ["HeraVex'i aç", "Yeni görev", "Yeni not", "Pomodoro başlat / durdur", "Çıkış"],
        "fr" => ["Ouvrir HeraVex", "Nouvelle tâche", "Nouvelle note", "Démarrer / arrêter Pomodoro", "Quitter"],
        "es" => ["Abrir HeraVex", "Nueva tarea", "Nueva nota", "Iniciar / detener Pomodoro", "Salir"],
        _ => ["Open HeraVex", "New task", "New note", "Start / stop Pomodoro", "Quit"],
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let lang = load_settings_from_disk(app.handle())
        .ok()
        .and_then(|s| s.preferred_language)
        .unwrap_or_else(|| "tr".into());
    let l = tray_labels(&lang);

    let open = MenuItem::with_id(app, "tray-open", l[0], true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "tray-new-task", l[1], true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, "tray-new-note", l[2], true, None::<&str>)?;
    let pomodoro = MenuItem::with_id(app, "tray-pomodoro", l[3], true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", l[4], true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &new_task,
            &new_note,
            &pomodoro,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("HeraVex")
        .menu(&menu)
        // Left click opens the app; the menu lives on right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let action = match event.id.as_ref() {
                "tray-open" => None,
                "tray-new-task" => Some("new-task"),
                "tray-new-note" => Some("new-note"),
                "tray-pomodoro" => Some("pomodoro"),
                "tray-quit" => {
                    app.exit(0);
                    return;
                }
                _ => return,
            };
            // Pomodoro toggles in the background; the others need the UI.
            if action != Some("pomodoro") {
                show_main_window(app);
            }
            if let Some(a) = action {
                let _ = app.emit("tray-action", a);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayMenuItems { open, new_task, new_note, pomodoro, quit });
    Ok(())
}

// ── Multiple windows (v0.9.9, Settings → Startup) ───────────────────────────
//
// Extra windows load the app with `?window=secondary`. Every window keeps
// its own copy of the data in memory, so a save in one must reach the
// others or a stale window would write old data back. Each write path
// calls `notify_windows`; with more than one window open it emits
// `local-data-changed { kind, ids }` and every window re-reads just that
// (its own save echoing back is a no-op on the frontend).

static MULTI_WINDOW: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static WINDOW_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

#[derive(Debug, Clone, Serialize)]
struct LocalDataChanged {
    kind: &'static str,
    ids: Vec<String>,
}

/// `ids` empty = re-read everything of that kind.
fn notify_windows(app: &AppHandle, kind: &'static str, ids: Vec<String>) {
    if app.webview_windows().len() > 1 {
        let _ = app.emit("local-data-changed", LocalDataChanged { kind, ids });
    }
}

#[tauri::command]
fn set_multi_window(enabled: bool) {
    MULTI_WINDOW.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Open another app window, optionally on a given page. Must be async:
/// building a window inside a sync (main-thread) command deadlocks on
/// Windows.
#[tauri::command]
async fn open_app_window(app: AppHandle, tab: Option<String>) -> Result<String, String> {
    if !MULTI_WINDOW.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("Coklu pencere ayari kapali.".into());
    }
    let n = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("win-{n}");
    let tab = tab
        .filter(|t| t.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|t| format!("&tab={t}"))
        .unwrap_or_default();
    let url = tauri::WebviewUrl::App(format!("index.html?window=secondary{tab}").into());
    tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title("HeraVex")
        .inner_size(1180.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| format!("Pencere acilamadi: {e}"))?;
    Ok(label)
}

/// Settings → Startup toggle. `false` = closing the window quits the app.
#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Settings → Startup toggle. Ignored when the tray failed to start
/// (there would be no way back to a hidden window).
#[tauri::command]
fn set_minimise_to_tray(app: AppHandle, enabled: bool) {
    let has_tray = app.try_state::<TrayMenuItems>().is_some();
    MINIMISE_TO_TRAY.store(enabled && has_tray, std::sync::atomic::Ordering::Relaxed);
}

/// Re-label the tray menu when the UI language changes.
#[tauri::command]
fn set_tray_language(app: AppHandle, language: String) -> Result<(), String> {
    let Some(items) = app.try_state::<TrayMenuItems>() else { return Ok(()) };
    let l = tray_labels(&language);
    let _ = items.open.set_text(l[0]);
    let _ = items.new_task.set_text(l[1]);
    let _ = items.new_note.set_text(l[2]);
    let _ = items.pomodoro.set_text(l[3]);
    let _ = items.quit.set_text(l[4]);
    Ok(())
}

fn start_workspace_watcher(app: AppHandle) {
    use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
    use std::sync::mpsc::channel;

    std::thread::spawn(move || {
        // Team Mode gate: only attach a file watcher when a shared workspace
        // folder is configured. Without one, every local save would re-trigger
        // the watcher and surface a false-positive "remote change" toast.
        // When the user enables Team Mode the app reloads (window.location.reload),
        // so this check naturally re-evaluates on startup.
        let settings = match load_settings_from_disk(&app) {
            Ok(s) => s,
            Err(e) => {
                println!("[watcher] settings load failed: {e}");
                return;
            }
        };
        let workspace_path = match settings.workspace_path.as_ref().filter(|s| !s.trim().is_empty()) {
            Some(p) => p.clone(),
            None => {
                println!("[watcher] Team Mode off — skipping watcher.");
                return;
            }
        };

        let watch_path = PathBuf::from(&workspace_path);
        if !watch_path.exists() || !watch_path.is_dir() {
            println!("[watcher] workspace path missing or not a dir: {}", watch_path.display());
            return;
        }
        println!("[watcher] watching {}", watch_path.display());

        // Keep the watcher and a forever-open channel alive on this thread.
        let (tx, rx) = channel::<DebounceEventResult>();
        let app_clone = app.clone();
        let mut debouncer = match new_debouncer(
            std::time::Duration::from_millis(1000),
            move |res: DebounceEventResult| {
                let _ = tx.send(res);
            },
        ) {
            Ok(d) => d,
            Err(e) => {
                println!("[watcher] debouncer init failed: {e}");
                return;
            }
        };

        if let Err(e) = debouncer.watcher().watch(&watch_path, RecursiveMode::Recursive) {
            println!("[watcher] watch failed: {e}");
            return;
        }

        // Forward debounced events to the frontend
        while let Ok(res) = rx.recv() {
            if let Ok(events) = res {
                let relevant = events.iter().any(|e| {
                    let s = e.path.to_string_lossy().to_lowercase();
                    // atomic_write's `*.tmp` staging files are our own
                    // writes in flight, never a teammate's change.
                    if s.ends_with(".tmp") { return false; }
                    s.contains("games") || s.contains("notes") || s.contains("library")
                        || s.ends_with("activity.json")
                });
                if relevant {
                    println!("[watcher] workspace-updated fired ({} event(s))", events.len());
                    let _ = app_clone.emit("workspace-updated", ());
                }
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        // Must be the first plugin. With the app living in the tray, a
        // second launch (desktop shortcut, Start menu) would otherwise
        // start a second process writing the same workspace files. The
        // second launch exits and the running one comes to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            start_workspace_watcher(handle);
            // A tray failure (e.g. no status-notifier host on some Linux
            // desktops) must not stop the app; hide-on-close is turned
            // off so the window can still be closed normally.
            if let Err(e) = setup_tray(app) {
                eprintln!("[tray] setup failed: {e}");
                CLOSE_TO_TRAY.store(false, std::sync::atomic::Ordering::Relaxed);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("hidden-to-tray", ());
                }
            }
            // There is no "minimised" event; minimising fires a resize
            // (to 0x0 on Windows), so check the state there. Reopening
            // goes through `show_main_window`, which un-minimises first.
            if let tauri::WindowEvent::Resized(_) = event {
                if window.label() == "main"
                    && MINIMISE_TO_TRAY.load(std::sync::atomic::Ordering::Relaxed)
                    && window.is_minimized().unwrap_or(false)
                    && window.is_visible().unwrap_or(false)
                {
                    let _ = window.hide();
                    let _ = window.emit("hidden-to-tray", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            keychain_status,
            set_secrets_in_keychain,
            set_minimise_to_tray,
            set_multi_window,
            open_app_window,
            set_tray_language,
            load_games,
            load_games_by_ids,
            create_game,
            save_game,
            add_version_with_build,
            delete_version,
            open_current_build,
            open_store_page,
            get_preferred_language,
            load_app_settings,
            set_preferred_language,
            save_global_expenses,
            load_wallet,
            wallet_upsert_expense,
            wallet_delete_expense,
            wallet_set_currencies,
            import_legacy_wallet,
            save_exchange_rates,
            fetch_live_exchange_rates,
            team_read_members,
            team_read_members_versioned,
            team_write_members,
            team_write_members_cas,
            team_write_self,
            team_write_roles,
            team_remove_member_file,
            team_read_team,
            search_notes,
            workspace_manifest,
            save_currency_labels,
            save_release_template,
            delete_game,
            export_backup,
            import_backup,
            export_csv_report,
            export_financial_csv,
            export_financial_json,
            export_financial_pdf,
            reveal_in_folder,
            reveal_build_file,
            resolve_build_folder,
            compute_storage_stats,
            list_backups,
            delete_backup,
            delete_all_data,
            open_log_directory,
            read_text_file,
            write_text_file,
            open_external,
            export_notes_pdf,
            get_all_notes,
            read_note,
            save_note,
            delete_note,
            load_flows,
            save_flow,
            delete_flow,
            export_global_note_pdf,
            save_image_to_disk,
            save_api_keys,
            pick_and_save_avatar,
            pick_and_save_studio_logo,
            storage_clear_cache,
            storage_remove_temp,
            storage_find_orphan_images,
            storage_delete_orphan_images,
            storage_integrity_check,
            storage_prune_builds,
            verify_backup,
            save_text_file_dialog,
            write_text_files_to_new_folder,
            pick_and_read_text_files,
            pick_and_read_text_file,
            export_game_bundle,
            import_game_bundle,
            post_webhook,
            clear_studio_logo,
            pick_directory,
            pick_google_play_json,
            pick_asset_file,
            clear_avatar,
            save_store_mapping,
            unlink_store_mapping,
            fetch_store_games,
            fetch_store_data,
            deploy_to_itch,
            generate_press_kit,
            get_workspace_path,
            set_workspace_path,
            clear_workspace_path,
            read_activity_log,
            compute_workspace_signature,
            plugins_list,
            plugin_fetch,
            plugin_install,
            plugin_discard,
            plugin_uninstall,
            pick_plugin_zip,
            plugin_http_fetch,
            export_backup_silent
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon while the window is hidden in
            // the tray brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main_window(_app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World"), "hello-world");
    }

    #[test]
    fn slugify_special_chars() {
        // ": " between words collapses into a single dash
        assert_eq!(slugify("My Game: Episode 1!"), "my-game-episode-1");
    }

    #[test]
    fn slugify_trims_dashes() {
        assert_eq!(slugify("!hello!"), "hello");
    }

    #[test]
    fn slugify_empty() {
        assert_eq!(slugify(""), "");
    }

    #[test]
    fn timeline_from_template_maps_correctly() {
        let template = vec![
            ReleaseTemplateItem {
                id: "step-1".into(),
                title: "Alpha".into(),
                description: "Alpha test".into(),
            },
            ReleaseTemplateItem {
                id: "step-2".into(),
                title: "Beta".into(),
                description: "Beta test".into(),
            },
        ];
        let timeline = timeline_from_template(&template);
        assert_eq!(timeline.len(), 2);
        assert_eq!(timeline[0].id, "step-1");
        assert_eq!(timeline[0].title, "Alpha");
        assert!(!timeline[0].done);
        assert!(!timeline[1].done);
    }

    #[test]
    fn guarded_read_returns_content_and_io_errors() {
        let dir = std::env::temp_dir().join(format!("hv-guarded-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.json");
        fs::write(&file, "{\"ok\":true}").unwrap();
        match read_text_guarded(&file) {
            Ok(t) => assert_eq!(t, "{\"ok\":true}"),
            Err(_) => panic!("plain local read must succeed"),
        }
        assert!(matches!(read_text_guarded(&dir.join("missing.json")), Err(ReadFail::Io(_))));
        // A finished read must never leave a stall marker behind.
        assert!(STALLED_READS.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    fn wallet_expense(id: &str) -> ExpenseItem {
        ExpenseItem {
            id: id.into(),
            title: format!("expense {id}"),
            amount: 10.0,
            category: "Tools".into(),
            spent_at: "2026-09-01".into(),
            notes: String::new(),
            currency: Some("USD".into()),
            is_recurring: None,
            shared_with_game_ids: None,
        }
    }

    fn wallet_tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hv_wallet_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wallet_missing_file_is_none_and_corrupt_file_is_error() {
        let root = wallet_tmp_root("read");
        assert!(read_wallet(&root).unwrap().is_none());

        // A corrupt wallet must never read as "empty" — a save would
        // then overwrite the user's expenses.
        fs::write(wallet_path(&root), b"{ not json").unwrap();
        assert!(read_wallet(&root).is_err());

        let w = WalletFile {
            version: 1,
            global_expenses: vec![wallet_expense("a")],
            active_currencies: Some(vec!["USD".into(), "TRY".into()]),
        };
        write_wallet(&root, &w).unwrap();
        let back = read_wallet(&root).unwrap().unwrap();
        assert_eq!(back.global_expenses.len(), 1);
        assert_eq!(back.active_currencies.unwrap(), vec!["USD".to_string(), "TRY".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn expense_split_survives_a_round_trip() {
        let mut e = wallet_expense("s");
        e.shared_with_game_ids = Some(vec!["g1".into(), "g2".into()]);
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("sharedWithGameIds"));
        let back: ExpenseItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.shared_with_game_ids.unwrap().len(), 2);
    }

    #[test]
    fn old_settings_without_claim_marker_still_parse() {
        // settings.json written by v0.9.8 and earlier.
        let raw = r#"{"preferredLanguage":"tr","globalExpenses":[{"id":"x","title":"Claude","amount":20,"category":"Tools","spentAt":"2026-01-01","notes":""}]}"#;
        let s: AppSettings = serde_json::from_str(raw).unwrap();
        assert_eq!(s.global_expenses.len(), 1);
        assert!(s.legacy_wallet_claimed_by.is_none());
    }

    #[test]
    fn legacy_offer_rules() {
        let root = wallet_tmp_root("offer");
        let other = wallet_tmp_root("offer_other");
        let mut settings: AppSettings = serde_json::from_str("{}").unwrap();
        settings.global_expenses = vec![wallet_expense("a"), wallet_expense("b")];
        let empty = WalletFile::default();

        // Nobody adopted it yet: offered.
        assert_eq!(legacy_offer(&settings, &root, &empty), 2);
        // Ids already in this wallet are not offered again.
        let has_a = WalletFile { global_expenses: vec![wallet_expense("a")], ..WalletFile::default() };
        assert_eq!(legacy_offer(&settings, &root, &has_a), 1);
        // Adopted by this workspace: nothing to offer.
        settings.legacy_wallet_claimed_by = Some(root.to_string_lossy().to_string());
        assert_eq!(legacy_offer(&settings, &root, &empty), 0);
        // Adopted by another workspace that still exists: not offered.
        settings.legacy_wallet_claimed_by = Some(other.to_string_lossy().to_string());
        assert_eq!(legacy_offer(&settings, &root, &empty), 0);
        // ...but offered again if that folder is gone.
        let _ = fs::remove_dir_all(&other);
        assert_eq!(legacy_offer(&settings, &root, &empty), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn team_root_detection() {
        let root = wallet_tmp_root("team");
        assert!(!is_team_root(&root));
        fs::create_dir_all(root.join("heravex-members")).unwrap();
        assert!(is_team_root(&root));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn upgrade_adopts_old_wallet_once_and_keeps_the_backup() {
        let local = wallet_tmp_root("up_local");
        let other = wallet_tmp_root("up_other");
        let team = wallet_tmp_root("up_team");
        fs::create_dir_all(team.join("heravex-members")).unwrap();

        // settings.json as v0.9.8 left it.
        let mut settings: AppSettings = serde_json::from_str("{}").unwrap();
        settings.global_expenses = vec![wallet_expense("a"), wallet_expense("b")];

        // A team folder opened first: nothing adopted (no leak to
        // teammates), the old list is offered instead, nothing written.
        let t = load_wallet_at(&team, &mut settings, true).unwrap();
        assert!(!t.migrated);
        assert!(t.global_expenses.is_empty());
        assert_eq!(t.legacy_available, 2);
        assert!(!wallet_path(&team).exists());
        assert!(settings.legacy_wallet_claimed_by.is_none());

        // The first local workspace adopts it.
        let l = load_wallet_at(&local, &mut settings, true).unwrap();
        assert!(l.migrated);
        assert_eq!(l.global_expenses.len(), 2);
        assert_eq!(l.legacy_available, 0);
        assert!(wallet_path(&local).exists());
        assert!(settings.legacy_wallet_claimed_by.is_some());
        // The old list is never cleared.
        assert_eq!(settings.global_expenses.len(), 2);

        // Reloading the same workspace reads its file, no second adoption.
        let again = load_wallet_at(&local, &mut settings, true).unwrap();
        assert!(!again.migrated);
        assert_eq!(again.global_expenses.len(), 2);

        // Any other workspace starts with an empty wallet of its own.
        let o = load_wallet_at(&other, &mut settings, true).unwrap();
        assert!(!o.migrated);
        assert!(o.global_expenses.is_empty());
        assert_eq!(o.legacy_available, 0);

        for d in [&local, &other, &team] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn corrupt_wallet_is_an_error_and_is_left_alone() {
        let root = wallet_tmp_root("corrupt");
        fs::write(wallet_path(&root), b"{ half written").unwrap();
        let mut settings: AppSettings = serde_json::from_str("{}").unwrap();
        settings.global_expenses = vec![wallet_expense("a")];
        assert!(load_wallet_at(&root, &mut settings, true).is_err());
        assert_eq!(fs::read_to_string(wallet_path(&root)).unwrap(), "{ half written");
        assert!(settings.legacy_wallet_claimed_by.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restoring_an_old_backup_writes_its_wallet_without_a_second_adoption() {
        let root = wallet_tmp_root("restore");
        // Backup from v0.9.8: expenses only inside settings.
        let mut old: AppSettings = serde_json::from_str("{}").unwrap();
        old.global_expenses = vec![wallet_expense("from-backup")];

        let restored = restore_wallet_at(&root, None, old, Some("C:/elsewhere".into())).unwrap();
        let w = read_wallet(&root).unwrap().unwrap();
        assert_eq!(w.global_expenses[0].id, "from-backup");
        // This install's adoption marker wins.
        assert_eq!(restored.legacy_wallet_claimed_by.as_deref(), Some("C:/elsewhere"));

        // New-format backup: the wallet itself is restored.
        let fresh: AppSettings = serde_json::from_str("{}").unwrap();
        let bw = WalletFile {
            version: 1,
            global_expenses: vec![wallet_expense("x")],
            active_currencies: Some(vec!["USD".into(), "EUR".into()]),
        };
        let restored = restore_wallet_at(&root, Some(bw), fresh, None).unwrap();
        let w = read_wallet(&root).unwrap().unwrap();
        assert_eq!(w.global_expenses[0].id, "x");
        assert_eq!(w.active_currencies.unwrap().len(), 2);
        assert!(restored.legacy_wallet_claimed_by.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("studio_hub_test_atomic.json");

        atomic_write(&path, b"first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");

        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");

        let tmp = path.with_extension("tmp");
        assert!(!tmp.exists(), ".tmp file should be cleaned up after rename");

        fs::remove_file(&path).ok();
    }

    #[test]
    fn game_folder_name_format() {
        let game = GameRecord {
            id: "abc123".into(),
            title: "My Cool Game".into(),
            summary: "".into(),
            status: "Fikir".into(),
            platforms: vec![],
            tags: vec![],
            notes: "".into(),
            tasks: vec![],
            versions: vec![],
            cover_data_url: None,
            current_build_relative_path: None,
            expenses: vec![],
            release_timeline: vec![],
            moodboard: Moodboard::default(),
            stores: GameStores {
                itch: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
                steam: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
                play: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
            },
            custom_links: Vec::new(),
            store_mappings: StoreMappings::default(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            budget: None,
            currency: None,
            butler_target: None,
            butler_build_path: None,
            board_columns: Vec::new(),
        };
        assert_eq!(game_folder_name(&game), "my-cool-game-abc123");
    }

    #[test]
    fn press_kit_shows_the_studio_logo() {
        let dir = std::env::temp_dir().join(format!("hv_presskit_logo_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let logo = dir.join("my-logo.png");
        fs::write(&logo, b"not really a png").unwrap();
        let game = GameRecord {
            id: "g1".into(),
            title: "Logo Game".into(),
            summary: "".into(),
            status: "Demo".into(),
            platforms: vec![],
            tags: vec![],
            notes: "".into(),
            tasks: vec![],
            versions: vec![],
            cover_data_url: None,
            current_build_relative_path: None,
            expenses: vec![],
            release_timeline: vec![],
            moodboard: Moodboard::default(),
            stores: GameStores {
                itch: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
                steam: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
                play: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
            },
            custom_links: Vec::new(),
            store_mappings: StoreMappings::default(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            budget: None,
            currency: None,
            butler_target: None,
            butler_build_path: None,
            board_columns: Vec::new(),
        };
        let input = PressKitInput {
            developer: "Moth Studio".into(),
            studio_logo_path: logo.to_string_lossy().to_string(),
            ..PressKitInput::default()
        };
        let index = render_press_kit(&game, &dir, &input).unwrap();
        let html = fs::read_to_string(PathBuf::from(&index).join("index.html"))
            .or_else(|_| fs::read_to_string(&index))
            .unwrap();
        assert!(html.contains("assets/images/studio-logo.png"));
        assert!(html.contains("Moth Studio"));
        assert!(dir.join("logo-game-press-kit/assets/images/studio-logo.png").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    fn storage_test_game(id: &str, title: &str) -> GameRecord {
        GameRecord {
            id: id.into(),
            title: title.into(),
            summary: "".into(),
            status: "Demo".into(),
            platforms: vec![],
            tags: vec![],
            notes: "".into(),
            tasks: vec![],
            versions: vec![],
            cover_data_url: None,
            current_build_relative_path: None,
            expenses: vec![],
            release_timeline: vec![],
            moodboard: Moodboard::default(),
            stores: GameStores {
                itch: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
                steam: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
                play: StoreConnection { enabled: false, external_id: "".into(), label: "".into() },
            },
            custom_links: Vec::new(),
            store_mappings: StoreMappings::default(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            budget: None,
            currency: None,
            butler_target: None,
            butler_build_path: None,
            board_columns: Vec::new(),
        }
    }

    fn storage_version(id: &str, build: Option<&str>) -> VersionItem {
        VersionItem {
            id: id.into(),
            version: format!("v{id}"),
            notes: String::new(),
            created_at: "2026-01-01T00:00:00Z".into(),
            build_file_name: build.map(|b| b.rsplit('/').next().unwrap_or(b).to_string()),
            build_relative_path: build.map(|b| b.to_string()),
            build_file_size_bytes: None,
            build_pruned_at: None,
        }
    }

    fn storage_tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hv_storage_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn temp_leftover_names() {
        assert!(is_temp_leftover("games.json.1234.7.tmp"));
        assert!(is_temp_leftover("auto-20260101.zip.part"));
        assert!(!is_temp_leftover("games.json"));
        assert!(!is_temp_leftover("cover.png"));
    }

    #[test]
    fn orphan_images_are_only_unreferenced_asset_images() {
        let root = storage_tmp("orphans");
        let assets = root.join("library/game-a/assets/images");
        fs::create_dir_all(&assets).unwrap();
        fs::create_dir_all(root.join("library/game-a/versions/v1-x")).unwrap();
        fs::create_dir_all(root.join("games")).unwrap();
        fs::write(assets.join("a_111.png"), b"used").unwrap();
        fs::write(assets.join("a_222.png"), b"orphan").unwrap();
        fs::write(assets.join("a_333.jpg"), b"used by a note").unwrap();
        // Builds are never images to clean, even unreferenced.
        fs::write(root.join("library/game-a/versions/v1-x/shot.png"), b"build").unwrap();
        fs::write(root.join("games/a.json"), r#"{"coverDataUrl":"C:/Users/ali/Drive/library/game-a/assets/images/a_111.png"}"#).unwrap();
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("notes/n.json"), r#"{"content":"![](a_333.jpg)"}"#).unwrap();

        let found = find_orphans_at(&root, 0).unwrap();
        let names: Vec<&str> = found.iter().map(|o| o.relative.as_str()).collect();
        assert_eq!(names, vec!["library/game-a/assets/images/a_222.png"]);

        // Freshly written files are left alone (cloud sync in flight).
        assert!(find_orphans_at(&root, 3600).unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn prune_keeps_newest_builds_and_the_current_one() {
        let mut g = storage_test_game("g1", "Prune Me");
        // Newest first; v3 is pinned as current even though it's old.
        g.versions = vec![
            storage_version("5", Some("prune-me-g1/versions/v5-5/b.zip")),
            storage_version("4", Some("prune-me-g1/versions/v4-4/b.zip")),
            storage_version("note-only", None),
            storage_version("3", Some("prune-me-g1/versions/v3-3/b.zip")),
            storage_version("2", Some("prune-me-g1/versions/v2-2/b.zip")),
            storage_version("1", Some("prune-me-g1/versions/v1-1/b.zip")),
        ];
        g.current_build_relative_path = Some("prune-me-g1/versions/v3-3/b.zip".into());
        assert_eq!(builds_to_prune(&g, 2), vec![4, 5]);

        let lib = storage_tmp("prune");
        for v in ["v5-5", "v4-4", "v3-3", "v2-2", "v1-1"] {
            let d = lib.join("prune-me-g1/versions").join(v);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("b.zip"), vec![0u8; 100]).unwrap();
        }
        let mut res = PruneResult::default();
        assert!(prune_game_builds(&lib, &mut g, 2, &mut res));
        assert_eq!(res.files, 2);
        assert_eq!(res.bytes, 200);
        assert!(lib.join("prune-me-g1/versions/v5-5/b.zip").exists());
        assert!(lib.join("prune-me-g1/versions/v3-3/b.zip").exists());
        assert!(!lib.join("prune-me-g1/versions/v2-2").exists());
        assert!(!lib.join("prune-me-g1/versions/v1-1").exists());
        // Version entries stay, marked as pruned.
        assert_eq!(g.versions.len(), 6);
        assert!(g.versions[4].build_relative_path.is_none());
        assert!(g.versions[4].build_pruned_at.is_some());
        assert!(g.versions[3].build_relative_path.is_some());
        // Nothing left to prune on a second run.
        assert!(!prune_game_builds(&lib, &mut g, 2, &mut PruneResult::default()));
        let _ = fs::remove_dir_all(&lib);
    }

    #[test]
    fn integrity_check_reports_corrupt_and_missing_files() {
        let root = storage_tmp("integrity");
        fs::create_dir_all(root.join("games")).unwrap();
        fs::create_dir_all(root.join("notes")).unwrap();
        let mut g = storage_test_game("ok1", "Fine Game");
        g.versions = vec![storage_version("1", Some("fine-game-ok1/versions/v1-1/gone.zip"))];
        fs::write(root.join("games/ok1.json"), serde_json::to_string(&g).unwrap()).unwrap();
        fs::write(root.join("games/bad.json"), b"{ broken").unwrap();
        fs::write(root.join("notes/n1.json"), b"[not a note]").unwrap();
        fs::write(root.join("games/ok1.json.99.1.tmp"), b"x").unwrap();

        let r = integrity_check_at(None, &root);
        let kinds: Vec<&str> = r.problems.iter().map(|p| p.kind.as_str()).collect();
        assert!(kinds.contains(&"corrupt"), "{kinds:?}");
        assert!(kinds.contains(&"missingBuild"), "{kinds:?}");
        assert!(kinds.contains(&"tempLeftover"), "{kinds:?}");
        assert_eq!(r.problems.iter().filter(|p| p.kind == "corrupt").count(), 2);
        assert_eq!(r.checked_files, 3);
        let _ = fs::remove_dir_all(&root);
    }

    fn write_test_backup(path: &Path, manifest: &str, library: &[(&str, &[u8])]) {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(1));
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        for (name, bytes) in library {
            zip.start_file(format!("library/{name}"), opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    const GOOD_MANIFEST: &str = r#"{"version":2,"exportedAt":"2026-10-01","settings":{},"games":[],"notes":[],"wallet":{"version":1,"globalExpenses":[]}}"#;

    #[test]
    fn verify_accepts_a_good_backup_and_rejects_broken_ones() {
        let dir = storage_tmp("verify");
        let good = dir.join("manual-20261001-100000.zip");
        write_test_backup(&good, GOOD_MANIFEST, &[("g/assets/a.png", b"img")]);
        let r = verify_backup_at(&good);
        assert!(r.ok, "{:?}", r.problems);
        assert_eq!(r.files, 1);
        assert!(r.has_wallet);

        let bad_manifest = dir.join("manual-20261001-110000.zip");
        write_test_backup(&bad_manifest, r#"{"version":2,"games":[{"nope":1}]}"#, &[]);
        assert!(!verify_backup_at(&bad_manifest).ok);

        let unsafe_path = dir.join("manual-20261001-120000.zip");
        write_test_backup(&unsafe_path, GOOD_MANIFEST, &[("../../evil.txt", b"x")]);
        assert!(!verify_backup_at(&unsafe_path).ok);

        let truncated = dir.join("manual-20261001-130000.zip");
        let bytes = fs::read(&good).unwrap();
        fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
        assert!(!verify_backup_at(&truncated).ok);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn retention_deletes_only_old_automatic_backups() {
        let dir = storage_tmp("retention");
        for n in ["auto-20261001-010000.zip", "auto-20261002-010000.zip", "auto-20261003-010000.zip",
                  "manual-20260901-010000.zip", "notes.txt"] {
            fs::write(dir.join(n), b"x").unwrap();
        }
        assert_eq!(apply_retention(&dir, 2), 1);
        assert!(!dir.join("auto-20261001-010000.zip").exists());
        assert!(dir.join("auto-20261003-010000.zip").exists());
        assert!(dir.join("manual-20260901-010000.zip").exists());
        assert!(dir.join("notes.txt").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mirror_copy_lands_complete() {
        let dir = storage_tmp("mirror_src");
        let mirror = storage_tmp("mirror_dst");
        let src = dir.join("auto-20261001-010000.zip");
        write_test_backup(&src, GOOD_MANIFEST, &[]);
        let copied = copy_to_mirror(&src, &mirror).unwrap();
        assert!(verify_backup_at(&copied).ok);
        assert!(!mirror.join("auto-20261001-010000.zip.part").exists());
        assert!(copy_to_mirror(&src, &mirror.join("missing")).is_err());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&mirror);
    }

    #[test]
    fn compressing_old_backups_keeps_them_valid_and_dated() {
        let dir = storage_tmp("compress");
        let big: Vec<u8> = b"HeraVex backup payload ".iter().cycle().take(200_000).copied().collect();
        let names = ["auto-20261001-010000.zip", "auto-20261002-010000.zip",
                     "auto-20261003-010000.zip", "auto-20261004-010000.zip"];
        for n in names {
            write_test_backup(&dir.join(n), GOOD_MANIFEST, &[("g/notes.txt", &big)]);
        }
        let oldest = dir.join(names[0]);
        let mtime_before = fs::metadata(&oldest).unwrap().modified().unwrap();
        let size_before = fs::metadata(&oldest).unwrap().len();

        let saved = compress_old_backups(&dir, 3);
        assert!(saved > 0);
        assert!(fs::metadata(&oldest).unwrap().len() < size_before);
        assert!(verify_backup_at(&oldest).ok);
        assert!(zip_is_marked_compressed(&oldest));
        assert_eq!(fs::metadata(&oldest).unwrap().modified().unwrap(), mtime_before);
        // The newest three are left alone, and nothing is re-packed twice.
        assert!(!zip_is_marked_compressed(&dir.join(names[3])));
        assert_eq!(compress_old_backups(&dir, 3), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn safe_file_names_cannot_escape_or_break_windows() {
        assert_eq!(safe_file_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(safe_file_name("Plan: v2?.md"), "Plan- v2-.md");
        assert_eq!(safe_file_name("   "), "untitled");
        assert_eq!(safe_file_name("CON.md"), "_CON.md");
        assert!(!safe_file_name("a/b\\c").contains('/'));
    }

    #[test]
    fn writing_exports_never_overwrites_existing_files() {
        let dir = storage_tmp("write_export");
        fs::create_dir_all(dir.join("Notes")).unwrap();
        fs::write(dir.join("Notes/keep.md"), b"mine").unwrap();
        let out = write_text_files_to_new_folder(
            dir.to_string_lossy().to_string(),
            "Notes".into(),
            vec![
                TextFileOut { name: "Idea.md".into(), contents: "one".into() },
                TextFileOut { name: "idea.md".into(), contents: "two".into() },
                TextFileOut { name: "../escape.md".into(), contents: "three".into() },
            ],
        )
        .unwrap();
        let out = PathBuf::from(out);
        assert_eq!(out.file_name().unwrap().to_string_lossy(), "Notes (2)");
        assert_eq!(fs::read_to_string(dir.join("Notes/keep.md")).unwrap(), "mine");
        assert_eq!(fs::read_to_string(out.join("Idea.md")).unwrap(), "one");
        assert_eq!(fs::read_to_string(out.join("idea (2).md")).unwrap(), "two");
        assert!(out.join("-escape.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn notion_style_nested_zip_is_read() {
        use std::io::Write;
        let opts = zip::write::SimpleFileOptions::default();
        let mut inner = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        inner.start_file("Workspace/Page abc0123456789abcdef0123456789abcd.md", opts).unwrap();
        inner.write_all("# Page\nhello".as_bytes()).unwrap();
        inner.start_file("Workspace/image.png", opts).unwrap();
        inner.write_all(b"png").unwrap();
        let inner_bytes = inner.finish().unwrap().into_inner();

        let mut outer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        outer.start_file("Export-Part-1.zip", opts).unwrap();
        outer.write_all(&inner_bytes).unwrap();
        outer.start_file("__MACOSX/junk.md", opts).unwrap();
        outer.write_all(b"junk").unwrap();
        let outer_bytes = outer.finish().unwrap().into_inner();

        let mut files = Vec::new();
        read_text_files_from_zip_reader(std::io::Cursor::new(outer_bytes), &["md".to_string()], 0, &mut files).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].relative.ends_with(".md"));
        assert!(files[0].contents.contains("hello"));
    }

    #[test]
    fn game_bundle_drops_builds_and_remaps_images() {
        let mut g = storage_test_game("old", "Bundle Me");
        g.cover_data_url = Some("C:\\Users\\ali\\Drive\\library\\bundle-me-old\\assets\\images\\old_111.png".into());
        g.current_build_relative_path = Some("bundle-me-old/versions/v1-1/b.zip".into());
        g.versions = vec![storage_version("1", Some("bundle-me-old/versions/v1-1/b.zip"))];
        let bundled = game_for_bundle(&g);
        assert!(bundled.current_build_relative_path.is_none());
        assert!(bundled.versions[0].build_relative_path.is_none());
        assert_eq!(bundled.versions.len(), 1); // the entry itself stays

        let mut imported = bundled.clone();
        let mut by_name = std::collections::HashMap::new();
        by_name.insert("old_111.png".to_string(), PathBuf::from("D:/ws/library/bundle-me-new/assets/images/old_111.png"));
        remap_bundle_paths(&mut imported, &by_name);
        assert_eq!(
            imported.cover_data_url.as_deref(),
            Some("D:/ws/library/bundle-me-new/assets/images/old_111.png")
        );
    }

    #[test]
    fn keychain_off_leaves_keys_in_the_file() {
        let mut s: AppSettings = serde_json::from_str(r#"{"steamApiKey":"S","itchApiKey":"I"}"#).unwrap();
        fill_secrets(&mut s);
        assert_eq!(s.steam_api_key.as_deref(), Some("S"));
        let on_disk = strip_secrets(&s).unwrap();
        assert_eq!(on_disk.itch_api_key.as_deref(), Some("I"));
        assert_eq!(settings_for_backup(s).steam_api_key.as_deref(), Some("S"));
    }

    #[test]
    fn keychain_keys_stay_out_of_backups_and_restores_keep_the_choice() {
        let mut on: AppSettings = serde_json::from_str("{}").unwrap();
        on.secrets_in_keychain = true;
        on.steam_api_key = Some("S".into());
        assert!(settings_for_backup(on.clone()).steam_api_key.is_none());

        // Old backup with plain keys restored while the keychain is on:
        // the choice stays on, the restored key wins.
        let mut restored: AppSettings = serde_json::from_str(r#"{"itchApiKey":"OLD"}"#).unwrap();
        keep_keychain_choice(&mut restored, Some(&on));
        assert!(restored.secrets_in_keychain);
        assert_eq!(restored.itch_api_key.as_deref(), Some("OLD"));
        assert_eq!(restored.steam_api_key.as_deref(), Some("S"));
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn os_keychain_round_trip() {
        let name = format!("heravex-test-{}", std::process::id());
        os_secrets::set(&name, Some("secret-123")).unwrap();
        assert_eq!(os_secrets::get(&name).unwrap().as_deref(), Some("secret-123"));
        os_secrets::set(&name, None).unwrap();
        assert_eq!(os_secrets::get(&name).unwrap(), None);
        // Deleting what isn't there is fine.
        os_secrets::set(&name, None).unwrap();
    }

    fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
        use std::io::Write;
        let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        for (n, b) in files {
            z.start_file(*n, o).unwrap();
            z.write_all(b).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn every_sdk_example_installs_from_its_zip() {
        let sdk = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../plugin-sdk");
        for name in ["example-plugin", "god-mode", "theme-pack", "color-kit", "deadline-heatmap"] {
            let mut archive = zip::ZipArchive::new(fs::File::open(sdk.join(format!("{name}.zip"))).unwrap()).unwrap();
            let (prefix, manifest) = zip_find_manifest(&mut archive).unwrap();
            validate_plugin_manifest(&manifest, &mut archive, &prefix).unwrap_or_else(|e| panic!("{name}: {e}"));
            let dest = storage_tmp(&format!("plugin_{name}"));
            extract_plugin_archive(&mut archive, &prefix, &dest).unwrap();
            assert!(dest.join("heravex.plugin.json").is_file(), "{name}");
            let entry = manifest.get("entry").and_then(|v| v.as_str()).unwrap_or("index.js");
            assert!(dest.join(entry).is_file(), "{name}");
            let _ = fs::remove_dir_all(&dest);
        }
    }

    #[test]
    fn plugin_archive_cannot_escape_or_explode() {
        let dir = storage_tmp("plugin_evil");
        let manifest = br#"{"id":"evil","name":"Evil","version":"1","apiVersion":1}"#;
        let zip_path = dir.join("evil.zip");
        write_zip(&zip_path, &[
            ("heravex.plugin.json", manifest),
            ("index.js", b"export default () => {}"),
            ("../../outside.txt", b"escape"),
        ]);
        let mut a = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
        let (prefix, m) = zip_find_manifest(&mut a).unwrap();
        validate_plugin_manifest(&m, &mut a, &prefix).unwrap();
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        extract_plugin_archive(&mut a, &prefix, &dest).unwrap();
        assert!(dest.join("index.js").is_file());
        assert!(!dir.join("outside.txt").exists());
        assert!(!dir.parent().unwrap().join("outside.txt").exists());

        // Unpacked size cap.
        let big = vec![0u8; (PLUGIN_MAX_UNPACKED as usize) + 10];
        let bomb = dir.join("bomb.zip");
        write_zip(&bomb, &[("heravex.plugin.json", manifest), ("index.js", b"x"), ("pad.bin", &big)]);
        let mut b = zip::ZipArchive::new(fs::File::open(&bomb).unwrap()).unwrap();
        let dest2 = dir.join("out2");
        fs::create_dir_all(&dest2).unwrap();
        assert!(extract_plugin_archive(&mut b, "", &dest2).is_err());

        // Bad manifests are refused before anything is written.
        let bad = dir.join("bad.zip");
        write_zip(&bad, &[("heravex.plugin.json", br#"{"id":"Bad ID","name":"x","apiVersion":1}"#), ("index.js", b"")]);
        let mut c = zip::ZipArchive::new(fs::File::open(&bad).unwrap()).unwrap();
        let (p2, m2) = zip_find_manifest(&mut c).unwrap();
        assert!(validate_plugin_manifest(&m2, &mut c, &p2).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── M6: Moodboard migration tests ─────────────────────────────────────

    #[test]
    fn split_legacy_caption_short_goes_to_title_only() {
        let (title, desc) = split_legacy_caption("Ana karakter silueti", 60);
        assert_eq!(title, "Ana karakter silueti");
        assert_eq!(desc, "");
    }

    #[test]
    fn split_legacy_caption_long_splits_at_boundary() {
        // 65 chars → first 60 in title, rest in description.
        let raw = "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijxxxxx";
        let (title, desc) = split_legacy_caption(raw, 60);
        assert_eq!(title.chars().count(), 60);
        assert_eq!(desc, "xxxxx");
    }

    #[test]
    fn split_legacy_caption_handles_multibyte_utf8() {
        // Each "ş" is multi-byte; counting by chars matters.
        let raw = "şşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşşextra-part";
        let (title, desc) = split_legacy_caption(raw, 60);
        assert_eq!(title.chars().count(), 60);
        assert_eq!(desc, "extra-part");
    }

    #[test]
    fn split_legacy_caption_trims_whitespace_at_boundary() {
        // Title ends with a space → it should be trimmed off, and the
        // description should not begin with the spillover space.
        let raw = "word ".repeat(20); // each "word " is 5 chars → 100 chars total
        let (title, desc) = split_legacy_caption(&raw, 60);
        assert!(!title.ends_with(' '), "title should not end with whitespace");
        assert!(!desc.starts_with(' '), "description should not start with whitespace");
    }

    #[test]
    fn split_legacy_caption_empty_returns_empty() {
        let (title, desc) = split_legacy_caption("   ", 60);
        assert_eq!(title, "");
        assert_eq!(desc, "");
    }

    #[test]
    fn data_url_size_bytes_estimates_base64_payload() {
        // "data:image/png;base64," prefix + 4-char payload "QUJD".
        // Base64 → 3 bytes (no padding handling, but approximation
        // suffices for the UI). Our formula: payload_len * 3 / 4.
        let url = "data:image/png;base64,QUJD";
        let size = data_url_size_bytes(url).expect("should compute for data URL");
        // payload_len = 4, 4 * 3 / 4 = 3
        assert_eq!(size, 3);
    }

    #[test]
    fn data_url_size_bytes_returns_none_for_disk_path() {
        let p = "library/abc/screenshot.png";
        assert!(data_url_size_bytes(p).is_none());
    }

    #[test]
    fn filename_from_path_or_dataurl_extracts_basename_windows() {
        let p = r"C:\HereVexProgram\library\abc\refs\hero.png";
        assert_eq!(filename_from_path_or_dataurl(p), "hero.png");
    }

    #[test]
    fn filename_from_path_or_dataurl_extracts_basename_unix() {
        let p = "/library/abc/refs/hero.png";
        assert_eq!(filename_from_path_or_dataurl(p), "hero.png");
    }

    #[test]
    fn filename_from_path_or_dataurl_synthesises_for_data_url() {
        let url = "data:image/jpeg;base64,QUJD";
        assert_eq!(filename_from_path_or_dataurl(url), "reference.jpeg");
    }

    #[test]
    fn is_legacy_moodboard_json_detects_array_shape() {
        // Minimal JSON with the moodboard field as an array.
        let raw = r#"{"id":"g","title":"t","summary":"","status":"","platforms":[],"tags":[],"notes":"","tasks":[],"versions":[],"coverDataUrl":null,"currentBuildRelativePath":null,"moodboard":[{"id":"i","imageDataUrl":"p","caption":"c","createdAt":"2024"}],"stores":{"itch":{"enabled":false,"externalId":"","label":""},"steam":{"enabled":false,"externalId":"","label":""},"play":{"enabled":false,"externalId":"","label":""}},"updatedAt":"2024"}"#;
        assert!(is_legacy_moodboard_json(raw));
    }

    #[test]
    fn is_legacy_moodboard_json_returns_false_for_new_shape() {
        let raw = r#"{"moodboard":{"categories":[],"items":[]}}"#;
        assert!(!is_legacy_moodboard_json(raw));
    }

    #[test]
    fn is_legacy_moodboard_json_handles_missing_field() {
        let raw = r#"{"id":"g"}"#;
        assert!(!is_legacy_moodboard_json(raw));
    }

    #[test]
    fn moodboard_deserialize_migrates_legacy_array() {
        // Untagged-style custom deserialize should accept the legacy
        // array and produce the new shape with the caption split.
        let raw = r#"[
            {
                "id": "mb1",
                "imageDataUrl": "library/abc/refs/hero.png",
                "caption": "Ana karakter silueti",
                "createdAt": "2024-01-01T00:00:00Z"
            }
        ]"#;
        let mb: Moodboard = serde_json::from_str(raw).expect("legacy shape parses");
        assert_eq!(mb.categories.len(), 0);
        assert_eq!(mb.items.len(), 1);
        let it = &mb.items[0];
        assert_eq!(it.id, "mb1");
        assert_eq!(it.title, "Ana karakter silueti");
        assert_eq!(it.description, "");
        assert_eq!(it.filename, "hero.png");
        assert_eq!(it.path, "library/abc/refs/hero.png");
        assert!(it.category_id.is_none());
        assert!(it.tags.is_empty());
        assert!(it.linked_task_ids.is_empty());
        assert!(it.linked_note_ids.is_empty());
        assert!(it.caption.is_none(), "caption should not survive migration");
    }

    #[test]
    fn moodboard_deserialize_accepts_new_object_shape() {
        let raw = r#"{
            "categories": [{"id":"c1","name":"Karakter","order":0}],
            "items": [{
                "id":"mb1","filename":"hero.png","path":"p","categoryId":"c1",
                "title":"Hero","description":"","tags":["x"],
                "linkedTaskIds":[],"linkedNoteIds":[],
                "createdAt":"2024"
            }]
        }"#;
        let mb: Moodboard = serde_json::from_str(raw).expect("new shape parses");
        assert_eq!(mb.categories.len(), 1);
        assert_eq!(mb.categories[0].name, "Karakter");
        assert_eq!(mb.items.len(), 1);
        assert_eq!(mb.items[0].category_id.as_deref(), Some("c1"));
        assert_eq!(mb.items[0].tags, vec!["x"]);
    }

    #[test]
    fn moodboard_default_is_empty() {
        let mb = Moodboard::default();
        assert!(mb.categories.is_empty());
        assert!(mb.items.is_empty());
    }
}
