// Studio identity slice — branding/legal info consumed by the press
// kit generator and any future invoice / contract template. Stored
// per-machine in localStorage; this is studio-level data so it
// follows the user across workspaces.
//
// Brand colours (primary/secondary) are intentionally distinct from
// the appearance accent colour — that one drives the live UI theme,
// these ones drive press-kit OUTPUT. Mixing them would have the
// press kit re-skin every time the user retunes their accent.

export type TeamSize = "solo" | "2-5" | "6-10" | "10+";

export interface StudioIdentitySlice {
  // Studio
  studioName: string;
  /** Path or data URL of the studio logo. Used in press kits. */
  logoPath: string;
  /** ISO date string (YYYY-MM-DD); empty when unset. */
  founded: string;
  location: string;
  teamSize: TeamSize;

  // Legal
  legalName: string;
  taxId: string;
  contactEmail: string;
  pressEmail: string;

  // Brand
  primaryColor: string;    // hex
  secondaryColor: string;  // hex
  brandFont: "inter" | "manrope" | "dmSans" | "geist" | "ibmPlex" | "system";
}

export const DEFAULT_STUDIO_IDENTITY: StudioIdentitySlice = {
  studioName: "",
  logoPath: "",
  founded: "",
  location: "",
  teamSize: "solo",

  legalName: "",
  taxId: "",
  contactEmail: "",
  pressEmail: "",

  primaryColor: "#a78bfa",
  secondaryColor: "#4f8cff",
  brandFont: "inter",
};

// ── Backup preferences ───────────────────────────────────────────────

export type BackupSchedule = "off" | "hourly" | "daily" | "weekly";

export interface BackupPrefsSlice {
  schedule: BackupSchedule;
  /** HH:mm for daily/weekly schedules; ignored otherwise. */
  scheduledTime: string;
  /** Only run the schedule while the app is actively open. */
  onlyWhileOpen: boolean;
  /** Optional override path; empty means workspace/backups/. */
  customLocation: string;
  /** Push completed backup to a cloud-mirrored folder if set. */
  mirrorToCloud: boolean;
  /** How many backups to retain before pruning oldest. */
  retentionCount: number;
  /** Compress older backups (gzip) when pruning. */
  compressOld: boolean;
}

export const DEFAULT_BACKUP_PREFS: BackupPrefsSlice = {
  schedule: "daily",
  scheduledTime: "03:00",
  onlyWhileOpen: true,
  customLocation: "",
  mirrorToCloud: false,
  retentionCount: 7,
  compressOld: false,
};

// ── localStorage ─────────────────────────────────────────────────────

const KEY_STUDIO  = "heravex_studio_v1";
const KEY_BACKUP  = "heravex_backup_prefs_v1";

export function loadStudioIdentity(): StudioIdentitySlice {
  return safeRead(KEY_STUDIO, DEFAULT_STUDIO_IDENTITY);
}
export function loadBackupPrefs(): BackupPrefsSlice {
  return safeRead(KEY_BACKUP, DEFAULT_BACKUP_PREFS);
}
export function saveStudioIdentity(s: StudioIdentitySlice) { safeWrite(KEY_STUDIO, s); }
export function saveBackupPrefs(s: BackupPrefsSlice)       { safeWrite(KEY_BACKUP, s); }

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}
function safeWrite<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
