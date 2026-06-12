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

fn save_single_game_to_disk(app: &AppHandle, game: &GameRecord) -> Result<(), String> {
    let path = games_dir(app)?.join(format!("{}.json", safe_id_filename(&game.id)));
    let payload = serde_json::to_string_pretty(game).map_err(|e| e.to_string())?;
    atomic_write(&path, payload.as_bytes())
}

fn save_single_note_to_disk(app: &AppHandle, note: &NoteRecord) -> Result<(), String> {
    let path = notes_dir(app)?.join(format!("{}.json", safe_id_filename(&note.id)));
    let payload = serde_json::to_string_pretty(note).map_err(|e| e.to_string())?;
    atomic_write(&path, payload.as_bytes())
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

fn load_games_from_disk(app: &AppHandle) -> Result<Vec<GameRecord>, String> {
    let dir = games_dir(app)?;
    let mut games: Vec<GameRecord> = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        match fs::read_to_string(&path) {
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

                match serde_json::from_str::<GameRecord>(&raw) {
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
                    Err(e) => println!("[load_games] skip {}: {e}", path.display()),
                }
            }
            Err(e) => println!("[load_games] read err {}: {e}", path.display()),
        }
    }

    if games.is_empty() {
        if let Ok(Some(migrated)) = migrate_legacy_games(app) {
            return Ok(migrated);
        }
    }

    // Stable order: most recently updated first
    games.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(games)
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

fn load_notes_from_disk(app: &AppHandle) -> Result<Vec<NoteRecord>, String> {
    let dir = notes_dir(app)?;
    let mut notes: Vec<NoteRecord> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(n) = serde_json::from_str::<NoteRecord>(&raw) {
                notes.push(n);
            }
        }
    }
    if notes.is_empty() {
        if let Ok(Some(migrated)) = migrate_legacy_notes(app) {
            return Ok(migrated);
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
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

#[tauri::command]
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
        });
    }

    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

fn save_settings_to_disk(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let payload = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    atomic_write(&path, payload.as_bytes())
}

fn atomic_write(path: &PathBuf, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|err| err.to_string())?;
    fs::rename(&tmp, path).map_err(|err| err.to_string())
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

#[tauri::command]
fn load_games(app: AppHandle) -> Result<Vec<GameRecord>, String> {
    load_games_from_disk(&app)
}

#[tauri::command]
fn create_game(app: AppHandle, input: CreateGameInput) -> Result<GameRecord, String> {
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

#[tauri::command]
fn save_game(app: AppHandle, mut game: GameRecord) -> Result<GameRecord, String> {
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
) -> Result<GameRecord, String> {
    if version.trim().is_empty() {
        return Err("Surum bos olamaz.".into());
    }

    let selected_file = FileDialog::new()
        .set_title("Build dosyasini sec")
        .pick_file()
        .ok_or_else(|| "Build secimi iptal edildi.".to_string())?;

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
    };

    game.current_build_relative_path = Some(relative);
    game.updated_at = now_iso();
    game.versions.insert(0, version_item);
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

#[tauri::command]
fn save_global_expenses(app: AppHandle, expenses: Vec<ExpenseItem>) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    settings.global_expenses = expenses;
    save_settings_to_disk(&app, &settings)
}

#[tauri::command]
fn save_exchange_rates(app: AppHandle, rates: std::collections::HashMap<String, f64>) -> Result<(), String> {
    let mut settings = load_settings_from_disk(&app)?;
    settings.exchange_rates = Some(rates);
    save_settings_to_disk(&app, &settings)
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

#[tauri::command]
fn team_read_members(workspace_path: String) -> Result<String, String> {
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

#[tauri::command]
fn team_write_members(workspace_path: String, content: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&workspace_path);
    if !dir.is_dir() {
        return Err(format!("workspace klasoru yok: {workspace_path}"));
    }
    let target = dir.join("heravex-members.json");
    let tmp = dir.join("heravex-members.json.tmp");
    std::fs::write(&tmp, content.as_bytes())
        .map_err(|e| format!("members.json gecici dosya yazilamadi: {e}"))?;
    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("members.json atomik degistirilemedi: {e}"))?;
    Ok(())
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

#[tauri::command]
fn search_notes(app: AppHandle, query: String, limit: Option<usize>) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let cap = limit.unwrap_or(20).min(100);

    let mut hits: Vec<SearchHit> = Vec::new();

    // Global notes
    let global = load_notes_from_disk(&app).unwrap_or_default();
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
    let games = load_games_from_disk(&app).unwrap_or_default();
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

#[tauri::command]
fn delete_game(app: AppHandle, game_id: String) -> Result<(), String> {
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
    let settings = load_settings_from_disk(app)?;

    // Manifest carries everything except binary library content. The
    // matching import command reconstructs the workspace by writing
    // these blobs to disk and unzipping the `library/` entries.
    let manifest = serde_json::json!({
        "version": 2,
        "exportedAt": now_iso(),
        "settings": settings,
        "games":    games,
        "notes":    notes,
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
async fn export_backup_silent(app: AppHandle, prefix: Option<String>) -> Result<String, String> {
    let prefix = prefix.unwrap_or_else(|| "auto".into());
    // `tauri::async_runtime::spawn_blocking` parks the work on Tauri's
    // dedicated blocking pool — same one fs/sqlite use — so we don't
    // starve the small UI command thread pool. The await is cheap; the
    // frontend just sees a regular Promise that resolves when done.
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        perform_silent_backup(&app_clone, &prefix)
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
    let settings = load_settings_from_disk(&app)?;
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
    save_settings_to_disk(app, &snapshot.settings)?;
    Ok(())
}

#[tauri::command]
fn save_image_to_disk(app: AppHandle, base64_data: String, game_id: String) -> Result<String, String> {
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

#[tauri::command]
fn save_store_mapping(
    app: AppHandle,
    game_id: String,
    store_key: String,
    mapped_id: String,
    mapped_title: String,
) -> Result<GameRecord, String> {
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
    reqwest::Client::builder()
        .user_agent("HeraVex/0.1")
        .timeout(std::time::Duration::from_secs(15))
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

#[tauri::command]
fn get_all_notes(app: AppHandle) -> Result<Vec<NoteRecord>, String> {
    let mut notes = load_notes_from_disk(&app)?;
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
fn save_note(app: AppHandle, mut note: NoteRecord) -> Result<NoteRecord, String> {
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

#[tauri::command]
fn delete_note(app: AppHandle, note_id: String) -> Result<(), String> {
    let mut notes = load_notes_from_disk(&app)?;
    let removed_title = notes.iter().find(|n| n.id == note_id).map(|n| n.title.clone());
    notes.retain(|n| n.id != note_id);
    save_notes_to_disk(&app, &notes)?;
    append_activity(&app, "note.deleted", removed_title);
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
}

#[tauri::command]
fn generate_press_kit(
    app: AppHandle,
    game_id: String,
    output_dir: String,
    input: Option<PressKitInput>,
) -> Result<String, String> {
    let games = load_games_from_disk(&app)?;
    let game = games
        .into_iter()
        .find(|g| g.id == game_id)
        .ok_or_else(|| "Oyun bulunamadi.".to_string())?;

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
            // Treat as filesystem path.
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

    // Factsheet rows
    let developer = if input.developer.is_empty() { "HeraVex".to_string() } else { input.developer.clone() };
    let release_date = if input.release_date.is_empty() {
        game.status.clone()
    } else {
        input.release_date.clone()
    };

    let mut factsheet_rows: Vec<(String, String)> = Vec::new();
    factsheet_rows.push(("Developer".into(), html_escape(&developer)));
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

#[tauri::command]
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
    let root = data_root(&app)?;
    let candidates = [root.join("Saves"), root.join("backups")];
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
    for name in ["settings.json", "games.legacy.json", "notes.legacy.json"] {
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
    let root = data_root(&app)?;
    let allowed = ["Saves", "backups"];
    let target = PathBuf::from(&path);
    let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
    let mut ok = false;
    for folder in &allowed {
        let dir = root.join(folder);
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
#[tauri::command]
fn list_plugin_manifests(app: AppHandle) -> Result<String, String> {
    let root = data_root(&app)?;
    let plugins_dir = root.join("plugins");
    if !plugins_dir.exists() || !plugins_dir.is_dir() {
        return Ok(String::from("[]"));
    }
    let mut out: Vec<serde_json::Value> = Vec::new();
    let entries = match fs::read_dir(&plugins_dir) {
        Ok(e) => e,
        Err(_) => return Ok(String::from("[]")),
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let manifest_path = dir.join("heravex.plugin.json");
        if !manifest_path.exists() { continue; }
        let raw = match fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let manifest: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Default entry filename if the manifest omits it.
        let entry_name = manifest.get("entry")
            .and_then(|v| v.as_str())
            .unwrap_or("widget.js");
        let entry_url = format!(
            "file://{}",
            dir.join(entry_name).to_string_lossy().replace('\\', "/"),
        );
        out.push(serde_json::json!({
            "manifest": manifest,
            "entryUrl": entry_url,
        }));
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Lightweight fingerprint of the active workspace data root. Used by
/// the frontend Team-Mode polling loop to detect changes on cloud-sync
/// drives (Drive, OneDrive, Dropbox) where the OS filesystem notifier
/// is unreliable. Walks games.json, notes.json, activity.json, and the
/// library/ subtree non-recursively at the game-folder level — enough
/// to catch new games and edits without blowing CPU.
#[tauri::command]
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
                    s.contains("games") || s.contains("notes") || s.ends_with("activity.json")
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
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            start_workspace_watcher(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_games,
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
            save_exchange_rates,
            fetch_live_exchange_rates,
            team_read_members,
            team_write_members,
            search_notes,
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
            save_note,
            delete_note,
            export_global_note_pdf,
            save_image_to_disk,
            save_api_keys,
            pick_and_save_avatar,
            pick_directory,
            pick_google_play_json,
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
            list_plugin_manifests,
            export_backup_silent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
