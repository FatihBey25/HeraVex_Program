export type GameStatus =
  | "Fikir"
  | "Prototip"
  | "Demo"
  | "Alpha"
  | "Beta"
  | "Yayina Hazir"
  | "Yayinda";

export type StoreConnection = {
  enabled: boolean;
  externalId: string;
  label: string;
};

export type CustomLink = {
  label: string;
  url: string;
};

export type NoteRecord = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  category?: string | null;
  /** Moodboard image ids attached to this note. Mirrors
   *  `MoodboardItem.linkedNoteIds`. Mutated only via the link helper
   *  in the store. */
  moodboardImageIds?: string[];
};

export type PressKitTemplateId = "classic" | "minimal" | "factsheet" | "indie";

export type PressKitInput = {
  description: string;
  features: string[];
  history: string;
  developer: string;
  releaseDate: string;
  website: string;
  pressContact: string;
  pricing: string;
  languages: string;
  socialLinks: CustomLink[];
  templateId?: PressKitTemplateId;
  /** Opt-in dark palette for the otherwise-light templates
   *  (minimal & factsheet). Ignored by classic & indie. */
  darkMode?: boolean;
};

export type ActivityEntry = {
  timestamp: string;
  user: string;
  action: string;
  target?: string | null;
};

export type ExpenseItem = {
  id: string;
  title: string;
  amount: number;
  category: string;
  spentAt: string;
  notes: string;
  currency?: string;
  isRecurring?: boolean;
};

/** A single visual reference on a game's moodboard.
 *
 *  v0.8 introduced categories, tags, per-item title/description, and
 *  bidirectional links to tasks/notes. Legacy records (pre-v0.8)
 *  stored `{ id, imageDataUrl, caption, createdAt }` only — those are
 *  migrated by Rust on first load (see `Moodboard::deserialize` in
 *  `main.rs`). The fields below mirror the new schema. */
export type MoodboardItem = {
  id: string;
  /** Display name with extension. Synthesized from the file path for
   *  legacy records that only stored a data URL. */
  filename: string;
  /** Disk path or `data:` URL. Frontend renders via `imgSrc(path)`. */
  path: string;
  /** References `MoodboardCategory.id`. `null`/undefined = "Uncategorized" —
   *  rendered under a virtual category that always exists. */
  categoryId?: string | null;
  /** Short editable headline. Migrated from legacy `caption` (first 60 chars). */
  title: string;
  /** Optional longer note (0–280 chars by UI convention; not enforced
   *  at type level so the store can clamp lazily). */
  description: string;
  /** Free-form `#tags`, lower-cased & deduped by the link helper. */
  tags: string[];
  /** Tasks this image is attached to. Mirrored by `TaskItem.moodboardImageIds`
   *  — both arrays are mutated only via the link helper in the store. */
  linkedTaskIds: string[];
  /** Notes this image is embedded into. Mirrored by `NoteRecord.moodboardImageIds`. */
  linkedNoteIds: string[];
  createdAt: string;
  /** Filled lazily — the moodboard tab measures visible cards in idle
   *  time and writes back; the detail modal measures on open as a
   *  failsafe. Old records load with these undefined. */
  width?: number;
  height?: number;
  /** Computed from base64 payload during migration; never recomputed. */
  sizeBytes?: number;
  /** DEPRECATED: legacy caption preserved on disk for safety, never
   *  populated by new code. Slated for removal in v0.9. */
  caption?: string | null;
};

/** User-defined channel within a game's moodboard. Default channels
 *  (Character / UI / Color / Atmosphere / Environment / Typography) are
 *  seeded by the store on first access, in the game's language. */
export type MoodboardCategory = {
  id: string;
  name: string;
  order: number;
};

/** Container shape on disk and in the store. Replaces the pre-v0.8
 *  `MoodboardItem[]` array. */
export type Moodboard = {
  categories: MoodboardCategory[];
  items: MoodboardItem[];
};

export type ReleaseTemplateItem = {
  id: string;
  title: string;
  description: string;
};

export type ReleaseTimelineItem = {
  id: string;
  title: string;
  description: string;
  done: boolean;
};

export type AppSettingsRecord = {
  preferredLanguage?: string | null;
  globalExpenses: ExpenseItem[];
  releaseTemplate: ReleaseTemplateItem[];
  exchangeRates?: Record<string, number>;
  currencyLabel1?: string;
  currencyLabel2?: string;
  activeCurrencies?: string[];
  steamApiKey?: string | null;
  itchApiKey?: string | null;
  steamUserId?: string | null;
  avatarPath?: string | null;
  googlePlayJsonPath?: string | null;
  workspacePath?: string | null;
};

export type StoreProvider = "steam" | "itch" | "play";

export type StoreGameInfo = {
  id: string;
  title: string;
  coverUrl?: string | null;
};

export type StoreData = {
  wishlist?: number | null;
  views?: number | null;
  downloads?: number | null;
  purchases?: number | null;
  earnings?: number | null;
  currency?: string | null;
  currentPlayers?: number | null;
  ratingAverage?: number | null;
  ratingCount?: number | null;
  lastNewsTitle?: string | null;
  lastNewsUrl?: string | null;
  lastNewsAt?: string | null;
  activeInstalls?: number | null;
  uninstalls?: number | null;
};

export type TaskItem = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  priority: 1 | 2 | 3;
  dueDate?: string;
  relatedNoteHeading?: string | null;
  /** Accumulated focus time on this task across sessions, in seconds. */
  timeSpentSeconds?: number;
  /** ISO timestamp the timer currently runs from; null when paused/done. */
  runningSince?: string | null;
  /** Free-form classification chips (Bug, Design, Audio…). Tag color is
   *  derived deterministically from the string so two users see the same
   *  hue without storing it. */
  tags?: string[];
  /** Which Kanban column this task sits in. References `BoardColumn.id`
   *  on the parent game. When undefined the task auto-assigns to "done"
   *  (if task.done) or the first non-done column. */
  boardColumnId?: string | null;
  /** Moodboard image ids attached to this task. Mirrors
   *  `MoodboardItem.linkedTaskIds` — write only through the link
   *  helper in the store, never mutate directly. */
  moodboardImageIds?: string[];
  /** ISO timestamp marking when the task last transitioned to done.
   *  Cleared (omitted) when the user reopens. Used by the dashboard's
   *  "completed this week" hero stat. v0.8.5+; older finished tasks
   *  are missing this field and won't count toward weekly stats. */
  completedAt?: string | null;
};

/** A user-defined Kanban column. The column with `isDone: true` is the system
 *  "Done" column — dropping a task there flips `task.done = true`. There can
 *  be exactly one done column per game and it can't be deleted. */
export type BoardColumn = {
  id: string;
  title: string;
  color: string;
  order: number;
  isDone?: boolean;
};

export type VersionItem = {
  id: string;
  version: string;
  notes: string;
  createdAt: string;
  buildFileName?: string;
  buildRelativePath?: string;
  buildFileSizeBytes?: number;
};

export type StoreMappingEntry = {
  id: string;
  title: string;
};

export type StoreMappings = {
  steam?: StoreMappingEntry | null;
  itch?: StoreMappingEntry | null;
  play?: StoreMappingEntry | null;
};

export type GameRecord = {
  id: string;
  title: string;
  summary: string;
  status: GameStatus;
  platforms: string[];
  tags: string[];
  notes: string;
  tasks: TaskItem[];
  versions: VersionItem[];
  coverDataUrl?: string;
  currentBuildRelativePath?: string;
  expenses: ExpenseItem[];
  releaseTimeline: ReleaseTimelineItem[];
  moodboard: Moodboard;
  stores: {
    itch: StoreConnection;
    steam: StoreConnection;
    play: StoreConnection;
  };
  customLinks?: CustomLink[];
  storeMappings?: StoreMappings;
  updatedAt: string;
  budget?: number;
  currency?: string;
  butlerTarget?: string | null;
  butlerBuildPath?: string | null;
  /** User-customizable Kanban columns for this game's Task Center. Optional
   *  for backwards compat: when absent, defaults are injected on first access. */
  boardColumns?: BoardColumn[];
};

export type CreateGameInput = {
  title: string;
  summary: string;
  status: GameStatus;
  platforms: string[];
  tags: string[];
};

/** A TaskItem enriched with its parent game's context */
export type FlatTask = TaskItem & {
  gameId: string;
  gameTitle: string;
  coverDataUrl?: string;
  /** True if the task lives in the internal "Studio General" marker game.
   *  UI can swap the cover for the HeraVex logo when this flag is set. */
  isGeneral?: boolean;
};

/** Free-form column identifier — opaque string referencing a `BoardColumn.id`.
 *  Kept as a type alias for readability (older code used a fixed enum). */
export type KanbanColKey = string;
