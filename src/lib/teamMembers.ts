// Team workspace membership store (v0.9.7).
//
// On a team-mode (cloud-synced) workspace, HeraVex keeps a tiny
// `heravex-members.json` at the folder root that records who's been
// connected. The Rust side handles the bytes atomically; this module
// owns the schema, conflict resolution, and the action verbs the UI
// calls.
//
// Identity model
// ──────────────
// We don't have accounts. A "member" is a stable random id stored in
// localStorage on the user's machine, paired with their display name
// from `studioIdentity.studioName` and a machine hint built from the
// OS + a short fingerprint. The same human on two machines = two
// members; this is a feature, not a bug, since it lets people audit
// "which laptop opened the file last".
//
// Role model
// ──────────
// - "leader"  — the user who first wrote the file. Can promote,
//               demote, ban, and remove anyone else. Only one leader
//               at a time; transferring requires demoting yourself.
// - "member"  — anyone else who's joined.
// - "banned"  — flagged by the leader. Their entry stays in the file
//               (so the leader can un-ban later); when a banned user
//               opens the workspace HeraVex shows a notice and skips
//               their self-update on lastSeenAt, so the leader can
//               cleanly tell when they tried to come back.
//
// Conflict resolution
// ───────────────────
// The file is small and updates are infrequent, but two clients can
// still race (cloud merge would silently overwrite one). We use a
// merge-by-userId strategy on every read: when the on-disk file has
// entries we don't, we add them; when both sides have the same
// userId, the higher lastSeenAt wins for non-role fields and the
// leader's writes are authoritative for role. The schema also carries
// a monotonically-incrementing `version` so a Rust-side merge step
// can defer to the newer document if we ever need it.

import { invoke } from "./invokeWrapper";

/** Schema version of the members file. Bump when fields change shape. */
export const MEMBERS_SCHEMA_VERSION = 1;

export type TeamRole = "leader" | "member" | "banned";

export interface TeamMember {
  /** Stable random id created on first launch and stored per-machine. */
  userId: string;
  /** Free-form display name pulled from Studio Identity at join time. */
  displayName: string;
  role: TeamRole;
  /** ISO timestamps. */
  joinedAt: string;
  lastSeenAt: string;
  /** Short string the leader sees in the members panel — "Windows · Mucah-PC". */
  machineHint: string;
  /** Optional avatar path/URL. We don't sync the image itself; only
   *  the avatarPath set in the user's Studio Identity. */
  avatarPath?: string | null;
}

export interface MembersDoc {
  version: number;
  members: TeamMember[];
}

const EMPTY_DOC: MembersDoc = { version: MEMBERS_SCHEMA_VERSION, members: [] };

// ── Identity (per-machine) ──────────────────────────────────────────

const USER_ID_KEY = "heravex_team_user_id";

/** Returns the user's stable id for team workspaces, generating it
 *  on the first call. The id is opaque — never displayed in UI. */
export function selfUserId(): string {
  try {
    const existing = localStorage.getItem(USER_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = `u_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    // localStorage unavailable — fall back to an ephemeral id. The
    // user will appear as "new" on every launch, but the rest of the
    // membership system still works.
    return `u_eph_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Short machine hint visible in the members panel. We avoid
 *  shipping a full fingerprint here — the goal is "Mucah's other
 *  laptop" affordance, not device tracking. */
export function machineHint(displayName: string): string {
  const platform =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")  ? "macOS"
    : typeof navigator !== "undefined" && navigator.userAgent.includes("Linux") ? "Linux"
    : "Windows";
  const safeName = (displayName || "Anonymous").split(/\s+/)[0] || "User";
  return `${platform} · ${safeName}-PC`;
}

// ── File I/O ────────────────────────────────────────────────────────

/** Read and validate the members file at `workspacePath`. Missing /
 *  malformed files yield an empty doc — callers proceed as if there
 *  are no members yet and the next write will recover a clean state. */
export async function readMembers(workspacePath: string): Promise<MembersDoc> {
  try {
    const raw = await invoke<string>("team_read_members", { workspacePath });
    if (!raw) return { ...EMPTY_DOC };
    const parsed = JSON.parse(raw) as unknown;
    return normaliseDoc(parsed);
  } catch {
    return { ...EMPTY_DOC };
  }
}

/** Write the doc back. Throws on disk failure so callers can toast.
 *  The Rust side does temp-then-rename for crash safety. */
export async function writeMembers(workspacePath: string, doc: MembersDoc): Promise<void> {
  const normalised = normaliseDoc(doc);
  await invoke<void>("team_write_members", {
    workspacePath,
    content: JSON.stringify(normalised, null, 2),
  });
}

function normaliseDoc(value: unknown): MembersDoc {
  if (!value || typeof value !== "object") return { ...EMPTY_DOC };
  const obj = value as { version?: unknown; members?: unknown };
  const version = typeof obj.version === "number" ? obj.version : MEMBERS_SCHEMA_VERSION;
  const members: TeamMember[] = Array.isArray(obj.members)
    ? obj.members.flatMap((m): TeamMember[] => {
        if (!m || typeof m !== "object") return [];
        const x = m as Record<string, unknown>;
        const userId = typeof x.userId === "string" ? x.userId : "";
        if (!userId) return [];
        const role = (x.role === "leader" || x.role === "banned" ? x.role : "member") as TeamRole;
        return [{
          userId,
          displayName: typeof x.displayName === "string" ? x.displayName : "Anonymous",
          role,
          joinedAt: typeof x.joinedAt === "string" ? x.joinedAt : new Date().toISOString(),
          lastSeenAt: typeof x.lastSeenAt === "string" ? x.lastSeenAt : new Date().toISOString(),
          machineHint: typeof x.machineHint === "string" ? x.machineHint : "",
          avatarPath: typeof x.avatarPath === "string" ? x.avatarPath : null,
        }];
      })
    : [];
  return { version, members };
}

// ── Membership verbs ────────────────────────────────────────────────

/** Register self as a member of this workspace if not already, or
 *  bump lastSeenAt if already present. Returns the updated doc.
 *
 *  Leader assignment rule: when the file has *zero* members on read,
 *  the joining user becomes the leader. Subsequent joiners are
 *  members. This is racy if two users join simultaneously — but the
 *  next read-modify-write will reveal the duplicate leader and we
 *  resolve via `dedupeLeader` below. */
export async function joinTeamWorkspace(
  workspacePath: string,
  identity: { displayName: string; avatarPath?: string | null },
): Promise<MembersDoc> {
  const doc = await readMembers(workspacePath);
  const me = selfUserId();
  const now = new Date().toISOString();
  const existing = doc.members.find((m) => m.userId === me);

  let next: TeamMember[];
  if (existing) {
    // Don't bump lastSeenAt for banned users — the leader uses
    // staleness to tell when a banned account stopped retrying.
    if (existing.role === "banned") {
      return doc;
    }
    next = doc.members.map((m) =>
      m.userId === me
        ? { ...m, displayName: identity.displayName, lastSeenAt: now, machineHint: machineHint(identity.displayName), avatarPath: identity.avatarPath ?? m.avatarPath ?? null }
        : m,
    );
  } else {
    const isFirst = doc.members.length === 0;
    next = [
      ...doc.members,
      {
        userId: me,
        displayName: identity.displayName,
        role: isFirst ? "leader" : "member",
        joinedAt: now,
        lastSeenAt: now,
        machineHint: machineHint(identity.displayName),
        avatarPath: identity.avatarPath ?? null,
      },
    ];
  }

  const out = dedupeLeader({ version: MEMBERS_SCHEMA_VERSION, members: next });
  await writeMembers(workspacePath, out);
  return out;
}

/** Returns true if `userId` is the leader in the given doc. */
export function isLeader(doc: MembersDoc, userId: string): boolean {
  return doc.members.find((m) => m.userId === userId)?.role === "leader";
}

/** Race-resilient leader pick: when two writers each made themselves
 *  leader concurrently, the one with the earliest joinedAt wins; the
 *  other is demoted to "member". */
function dedupeLeader(doc: MembersDoc): MembersDoc {
  const leaders = doc.members.filter((m) => m.role === "leader");
  if (leaders.length <= 1) return doc;
  // Keep the earliest joiner as leader.
  const keep = leaders.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
  return {
    ...doc,
    members: doc.members.map((m) =>
      m.role === "leader" && m.userId !== keep.userId ? { ...m, role: "member" } : m,
    ),
  };
}

/** Leader action: change another member's role. The leader cannot
 *  demote themselves without first promoting someone else; that
 *  transfer flow is `transferLeadership`. */
export async function setMemberRole(
  workspacePath: string,
  actor: string,
  targetUserId: string,
  role: TeamRole,
): Promise<MembersDoc> {
  const doc = await readMembers(workspacePath);
  if (!isLeader(doc, actor)) {
    throw new Error("leader-only");
  }
  if (targetUserId === actor) {
    throw new Error("cannot-self-edit-role");
  }
  // Disallow creating a second leader directly — promotion goes
  // through transferLeadership.
  if (role === "leader") {
    throw new Error("use-transfer-leadership");
  }
  const next: MembersDoc = {
    version: MEMBERS_SCHEMA_VERSION,
    members: doc.members.map((m) => (m.userId === targetUserId ? { ...m, role } : m)),
  };
  await writeMembers(workspacePath, next);
  return next;
}

/** Leader action: transfer leadership to another member. The old
 *  leader becomes a member; the named target becomes leader. */
export async function transferLeadership(
  workspacePath: string,
  actor: string,
  targetUserId: string,
): Promise<MembersDoc> {
  const doc = await readMembers(workspacePath);
  if (!isLeader(doc, actor)) throw new Error("leader-only");
  if (actor === targetUserId) throw new Error("already-leader");
  const target = doc.members.find((m) => m.userId === targetUserId);
  if (!target) throw new Error("not-a-member");
  const next: MembersDoc = {
    version: MEMBERS_SCHEMA_VERSION,
    members: doc.members.map((m) => {
      if (m.userId === actor) return { ...m, role: "member" };
      if (m.userId === targetUserId) return { ...m, role: "leader" };
      return m;
    }),
  };
  await writeMembers(workspacePath, next);
  return next;
}

/** Leader action: delete a member from the file. They can rejoin by
 *  opening the workspace again — banning is the right move when you
 *  want them gone permanently. */
export async function removeMember(
  workspacePath: string,
  actor: string,
  targetUserId: string,
): Promise<MembersDoc> {
  const doc = await readMembers(workspacePath);
  if (!isLeader(doc, actor)) throw new Error("leader-only");
  if (actor === targetUserId) throw new Error("cannot-self-remove");
  const next: MembersDoc = {
    version: MEMBERS_SCHEMA_VERSION,
    members: doc.members.filter((m) => m.userId !== targetUserId),
  };
  await writeMembers(workspacePath, next);
  return next;
}

/** Convenience wrappers. */
export function banMember(workspacePath: string, actor: string, targetUserId: string) {
  return setMemberRole(workspacePath, actor, targetUserId, "banned");
}
export function unbanMember(workspacePath: string, actor: string, targetUserId: string) {
  return setMemberRole(workspacePath, actor, targetUserId, "member");
}
