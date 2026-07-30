// Team workspace membership — presence-per-user model (v0.9.8 rewrite).
//
// WHY THE REWRITE
// ───────────────
// The old design had every client read-modify-write ONE shared
// `heravex-members.json`. Over a cloud-sync folder (OneDrive/Dropbox)
// that races badly: two machines edit their local copy, the cloud
// merges last-writer-wins, and member rows get silently dropped — the
// symptom users hit was "I only ever see the leader". CAS only guarded
// *same-machine* concurrency, never the cross-machine cloud merge.
//
// THE FIX — presence-per-user
// ───────────────────────────
// Each client writes ONLY its own file, `heravex-members/<userId>.json`,
// and never touches anyone else's. The cloud therefore never has to
// merge a shared document — different files never conflict. The members
// list is the UNION of every file in that directory.
//
// Roles (leader / ban) live in a single `_roles.json` written ONLY by
// the leader — again a one-writer file. The leader is:
//   1. `_roles.leader` when set (explicit, via transferLeadership), else
//   2. the member with the earliest `joinedAt` (deterministic, write-free
//      — the first person to open the folder is leader automatically).
//
// This keeps the public API the Settings panel + teamSync already use.

import { invoke } from "./invokeWrapper";

export const MEMBERS_SCHEMA_VERSION = 2;

export type TeamRole = "leader" | "member" | "banned";

export interface TeamMember {
  userId: string;
  displayName: string;
  role: TeamRole;
  joinedAt: string;
  lastSeenAt: string;
  machineHint: string;
  avatarPath?: string | null;
}

export interface MembersDoc {
  version: number;
  members: TeamMember[];
}

/** A single client's own presence file (no `role` — role is derived). */
interface Presence {
  userId: string;
  displayName: string;
  avatarPath?: string | null;
  machineHint: string;
  joinedAt: string;
  lastSeenAt: string;
}

/** Leader-owned overrides file. */
interface RolesDoc {
  /** Explicit leader, or null to fall back to earliest joiner. */
  leader: string | null;
  /** userId → "banned" (the only override that matters; "member" is the
   *  absence of an override). */
  overrides: Record<string, "banned">;
  updatedAt: string;
}

// ── Identity (per-machine) ──────────────────────────────────────────

const USER_ID_KEY = "heravex_team_user_id";

export function selfUserId(): string {
  try {
    const existing = localStorage.getItem(USER_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = `u_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    return `u_eph_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function machineHint(displayName: string): string {
  const platform =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")  ? "macOS"
    : typeof navigator !== "undefined" && navigator.userAgent.includes("Linux") ? "Linux"
    : "Windows";
  const safeName = (displayName || "Anonymous").split(/\s+/)[0] || "User";
  return `${platform} · ${safeName}-PC`;
}

// ── Raw I/O ─────────────────────────────────────────────────────────

interface TeamReadResult { members: string[]; roles: string | null }

function parsePresence(raw: string): Presence | null {
  try {
    const x = JSON.parse(raw) as Record<string, unknown>;
    const userId = typeof x.userId === "string" ? x.userId : "";
    if (!userId) return null;
    return {
      userId,
      displayName: typeof x.displayName === "string" ? x.displayName : "Anonymous",
      avatarPath: typeof x.avatarPath === "string" ? x.avatarPath : null,
      machineHint: typeof x.machineHint === "string" ? x.machineHint : "",
      joinedAt: typeof x.joinedAt === "string" ? x.joinedAt : new Date().toISOString(),
      lastSeenAt: typeof x.lastSeenAt === "string" ? x.lastSeenAt : new Date().toISOString(),
    };
  } catch { return null; }
}

function parseRoles(raw: string): RolesDoc {
  try {
    const x = JSON.parse(raw) as Record<string, unknown>;
    const overridesIn = (x.overrides && typeof x.overrides === "object" ? x.overrides : {}) as Record<string, unknown>;
    const overrides: Record<string, "banned"> = {};
    for (const [k, v] of Object.entries(overridesIn)) {
      if (v === "banned") overrides[k] = "banned";
    }
    return {
      leader: typeof x.leader === "string" ? x.leader : null,
      overrides,
      updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : "",
    };
  } catch { return { leader: null, overrides: {}, updatedAt: "" }; }
}

async function readTeamRaw(workspacePath: string): Promise<{ presences: Presence[]; roles: RolesDoc }> {
  try {
    const res = await invoke<TeamReadResult>("team_read_team", { workspacePath });
    const presences = (res.members ?? []).map(parsePresence).filter((p): p is Presence => p != null);
    const roles = res.roles ? parseRoles(res.roles) : { leader: null, overrides: {}, updatedAt: "" };
    return { presences, roles };
  } catch {
    return { presences: [], roles: { leader: null, overrides: {}, updatedAt: "" } };
  }
}

/** Resolve the effective leader id: explicit override if that user is
 *  still present, otherwise the earliest joiner. */
function resolveLeaderId(presences: Presence[], roles: RolesDoc): string | null {
  if (roles.leader && presences.some((p) => p.userId === roles.leader)) return roles.leader;
  if (presences.length === 0) return null;
  return presences.slice().sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0].userId;
}

// ── Public read ─────────────────────────────────────────────────────

export async function readMembers(workspacePath: string): Promise<MembersDoc> {
  const { presences, roles } = await readTeamRaw(workspacePath);
  const leaderId = resolveLeaderId(presences, roles);
  const members: TeamMember[] = presences.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatarPath: p.avatarPath ?? null,
    machineHint: p.machineHint,
    joinedAt: p.joinedAt,
    lastSeenAt: p.lastSeenAt,
    role: roles.overrides[p.userId] === "banned"
      ? "banned"
      : p.userId === leaderId ? "leader" : "member",
  }));
  return { version: MEMBERS_SCHEMA_VERSION, members };
}

export function isLeader(doc: MembersDoc, userId: string): boolean {
  return doc.members.find((m) => m.userId === userId)?.role === "leader";
}

// ── Membership verbs ────────────────────────────────────────────────

/** Heartbeat: write/refresh ONLY my own presence file. Preserves my
 *  original joinedAt. A banned user stops heartbeating so the leader can
 *  see they went stale. */
export async function joinTeamWorkspace(
  workspacePath: string,
  identity: { displayName: string; avatarPath?: string | null },
): Promise<MembersDoc> {
  const me = selfUserId();
  const { presences, roles } = await readTeamRaw(workspacePath);

  // Banned → don't refresh lastSeenAt (leave the stale file in place).
  if (roles.overrides[me] === "banned") {
    return readMembers(workspacePath);
  }

  const now = new Date().toISOString();
  const existing = presences.find((p) => p.userId === me);
  const self: Presence = {
    userId: me,
    displayName: identity.displayName || "Anonymous",
    avatarPath: identity.avatarPath ?? null,
    machineHint: machineHint(identity.displayName),
    joinedAt: existing?.joinedAt ?? now,
    lastSeenAt: now,
  };
  await invoke<void>("team_write_self", {
    workspacePath,
    userId: me,
    content: JSON.stringify(self, null, 2),
  });
  return readMembers(workspacePath);
}

/** Leader-only roles write. Reads the current roles, mutates, persists. */
async function writeRoles(
  workspacePath: string,
  mutate: (r: RolesDoc) => RolesDoc,
): Promise<void> {
  const { roles } = await readTeamRaw(workspacePath);
  const next = mutate({ leader: roles.leader, overrides: { ...roles.overrides }, updatedAt: roles.updatedAt });
  next.updatedAt = new Date().toISOString();
  await invoke<void>("team_write_roles", { workspacePath, content: JSON.stringify(next, null, 2) });
}

async function assertLeader(workspacePath: string, actor: string): Promise<void> {
  const doc = await readMembers(workspacePath);
  if (!isLeader(doc, actor)) throw new Error("leader-only");
}

export async function setMemberRole(
  workspacePath: string,
  actor: string,
  targetUserId: string,
  role: TeamRole,
): Promise<MembersDoc> {
  if (targetUserId === actor) throw new Error("cannot-self-edit-role");
  if (role === "leader") throw new Error("use-transfer-leadership");
  await assertLeader(workspacePath, actor);
  await writeRoles(workspacePath, (r) => {
    if (role === "banned") r.overrides[targetUserId] = "banned";
    else delete r.overrides[targetUserId]; // back to plain member
    return r;
  });
  return readMembers(workspacePath);
}

export async function transferLeadership(
  workspacePath: string,
  actor: string,
  targetUserId: string,
): Promise<MembersDoc> {
  if (actor === targetUserId) throw new Error("already-leader");
  await assertLeader(workspacePath, actor);
  const { presences } = await readTeamRaw(workspacePath);
  if (!presences.find((p) => p.userId === targetUserId)) throw new Error("not-a-member");
  await writeRoles(workspacePath, (r) => { r.leader = targetUserId; return r; });
  return readMembers(workspacePath);
}

export async function removeMember(
  workspacePath: string,
  actor: string,
  targetUserId: string,
): Promise<MembersDoc> {
  if (actor === targetUserId) throw new Error("cannot-self-remove");
  await assertLeader(workspacePath, actor);
  await invoke<void>("team_remove_member_file", { workspacePath, userId: targetUserId });
  await writeRoles(workspacePath, (r) => { delete r.overrides[targetUserId]; return r; });
  return readMembers(workspacePath);
}

export function banMember(workspacePath: string, actor: string, targetUserId: string) {
  return setMemberRole(workspacePath, actor, targetUserId, "banned");
}
export function unbanMember(workspacePath: string, actor: string, targetUserId: string) {
  return setMemberRole(workspacePath, actor, targetUserId, "member");
}
