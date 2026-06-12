import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Gamepad2,
  ListTodo,
  Calendar,
  Wallet as WalletIcon,
  BarChart3,
  Store,
  Settings,
  StickyNote,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Info,
  PlusCircle,
  Cloud as CloudIcon,
  HardDrive,
  Copy,
  ExternalLink,
  Users,
  Crown,
} from "lucide-react";
import { useAppStore, type WorkspaceTab } from "../store";
import { StudioHubLogo } from "./shared/StudioHubLogo";
import { imgSrc } from "../lib/images";
import logoMarkUrl from "../assets/logo-mark.svg";
import {
  loadWorkspaces,
  resolveActiveWorkspace,
  switchToWorkspace,
  type Workspace,
} from "../lib/workspaces";
import { getWorkspacePath } from "../lib/storage";
import { ProfileViewModal } from "./modals/ProfileViewModal";

type NavItem = { key: WorkspaceTab; label: string; icon: typeof LayoutDashboard };
type NavSection = { eyebrow: string; items: NavItem[] };

export function Sidebar({
  onOpenLanguage,
  onOpenSettings,
  onNewWorkspace,
}: {
  onOpenLanguage: () => void;
  onOpenSettings: () => void;
  onNewWorkspace: () => void;
}) {
  const { workspaceTab, setWorkspaceTab, language, ui, avatarPath, showToast, showError, profile, teamMode, layout, setLayout } = useAppStore();
  const t = ui as unknown as Record<string, string>;
  const avatarSrc = imgSrc(avatarPath);

  // v0.9 polish — Mini-profile pulls its name / sub-line directly
  // from the live profile slice instead of the pre-v0.9
  // localStorage keys. Display name falls back to a localised
  // default; the sub-line prefers the user's bio (truncated to one
  // line) and falls back to the localised primary-role label.
  const defaultName = language === "tr" ? "Stüdyo Üyesi" : "Studio Member";
  const userName = profile.displayName.trim() || defaultName;
  const roleKey =
    profile.primaryRole === "soloDev"    ? "roleSoloDev" :
    profile.primaryRole === "designer"   ? "roleDesigner" :
    profile.primaryRole === "programmer" ? "roleProgrammer" :
    profile.primaryRole === "artist"     ? "roleArtist" :
    profile.primaryRole === "composer"   ? "roleComposer" :
    profile.primaryRole === "producer"   ? "roleProducer" :
    profile.primaryRole === "writer"     ? "roleWriter" :
    profile.primaryRole === "qa"         ? "roleQa" : "roleOther";
  const roleLabel = (ui as unknown as Record<string, string>)[roleKey] ?? "";
  // Bio when present wins over role — that's the spec ("girilen bio
  // sol altta açıklama yazısı olarak görünsün"). Truncate hard so
  // the sidebar layout never grows past one line.
  const bioOneLiner = profile.bio.trim().replace(/\s+/g, " ");
  const userRole = bioOneLiner.length > 0
    ? (bioOneLiner.length > 60 ? bioOneLiner.slice(0, 58) + "…" : bioOneLiner)
    : roleLabel;

  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "HV";

  // v0.9 polish — view-mode profile modal. Main mini-profile click
  // opens this; the gear icon still routes to Settings.
  const [showProfileView, setShowProfileView] = useState(false);

  // Presence indicator (Team Mode only). Reads the last-sync-check
  // timestamp the workspace poller persists on every tick and converts
  // it into a 3-state dot: green (<2× watcher interval ago — healthy),
  // amber (within 5×), grey (stale). Updates once per second so the
  // colour tracks the actual freshness, not just the moment of opening.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    if (!teamMode.showPresence) return;
    const id = window.setInterval(() => setPresenceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [teamMode.showPresence]);
  const presenceState: "live" | "soon" | "stale" | null = (() => {
    if (!teamMode.showPresence) return null;
    void presenceTick; // re-evaluate on tick
    const raw = localStorage.getItem("heravex_last_sync_check");
    if (!raw) return "stale";
    const ago = Date.now() - Number(raw);
    const baseMs =
      teamMode.watcherDelay === "instant" ? 3000 :
      teamMode.watcherDelay === "5s"      ? 5000 :
      teamMode.watcherDelay === "30s"     ? 30000 :
      teamMode.watcherDelay === "2m"      ? 120000 : 5000;
    if (ago < baseMs * 2) return "live";
    if (ago < baseMs * 5) return "soon";
    return "stale";
  })();
  const presenceLabel = (() => {
    if (!presenceState) return "";
    const raw = localStorage.getItem("heravex_last_sync_check");
    const ago = raw ? Math.max(0, Math.floor((Date.now() - Number(raw)) / 1000)) : null;
    const agoStr = ago == null
      ? (language === "tr" ? "henüz yok" : "no data")
      : ago < 60 ? `${ago}s`
      : ago < 3600 ? `${Math.floor(ago / 60)}m`
      : `${Math.floor(ago / 3600)}h`;
    const map = {
      live:  language === "tr" ? "Senkron canlı" : "Sync live",
      soon:  language === "tr" ? "Yakında güncellenecek" : "Updating soon",
      stale: language === "tr" ? "Senkron eski" : "Sync stale",
    };
    return `${map[presenceState]} · ${agoStr}`;
  })();

  // ── Sidebar resize handle (v0.9.7) ─────────────────────────────────────
  //
  // Drag the right edge of the sidebar to set `layout.sidebarWidth`.
  // The pointer-handler clamps to [200, 480] — the lower bound keeps
  // the labels readable, the upper keeps the main pane from getting
  // squeezed too tight. We listen at the document level (not the
  // sidebar) once a drag starts so the cursor doesn't break if the
  // pointer leaves the 8px hit-area mid-drag.
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const onSidebarHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    document.documentElement.classList.add("is-resizing-sidebar");
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(200, Math.min(480, ev.clientX));
      setLayout({ sidebarWidth: next });
    };
    const onUp = () => {
      setIsResizingSidebar(false);
      document.documentElement.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Workspace dropdown ─────────────────────────────────────────────────
  const [wsOpen, setWsOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wsRef.current?.contains(e.target as Node)) setWsOpen(false);
    };
    if (wsOpen) window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [wsOpen]);

  // ── Workspace registry + active resolution ──────────────────────────────
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => loadWorkspaces());
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const p = await getWorkspacePath();
        setActivePath(p);
      } catch {
        setActivePath(null);
      }
    })();
  }, []);

  // Refresh registry each time the dropdown is opened so newly-added
  // workspaces from the NewWorkspaceModal appear without a reload.
  useEffect(() => {
    if (wsOpen) setWorkspaces(loadWorkspaces());
  }, [wsOpen]);

  const activeWs = resolveActiveWorkspace(workspaces, activePath);

  // ── Active-workspace stats (v0.9.7) ─────────────────────────────────────
  //
  // Surface info about the active workspace at the top of the dropdown:
  //   • Game count (from the live store — current workspace only)
  //   • For team workspaces: member count + your role badge
  // Both are cheap reads only triggered when the dropdown actually
  // opens, so closed-state performance is unaffected.
  const liveGameCount = useAppStore((s) => s.games.length);
  const [activeTeam, setActiveTeam] = useState<{ memberCount: number; myRole: "leader" | "member" | "banned" | null } | null>(null);
  useEffect(() => {
    if (!wsOpen || activeWs.mode !== "team" || !activeWs.path) {
      setActiveTeam(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { readMembers, selfUserId } = await import("../lib/teamMembers");
        const doc = await readMembers(activeWs.path!);
        if (cancelled) return;
        const me = doc.members.find((m) => m.userId === selfUserId());
        setActiveTeam({
          memberCount: doc.members.length,
          myRole: me?.role ?? null,
        });
      } catch {
        if (!cancelled) setActiveTeam({ memberCount: 0, myRole: null });
      }
    })();
    return () => { cancelled = true; };
  }, [wsOpen, activeWs.id, activeWs.path, activeWs.mode]);

  const handleCopyPath = async () => {
    const p = activeWs.path ?? "";
    if (!p) {
      showToast(language === "tr" ? "Bu çalışma alanı varsayılan klasörde, kopyalanacak yol yok." : "Default workspace has no copyable path.", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(p);
      showToast(language === "tr" ? "Yol kopyalandı." : "Path copied.", "success");
    } catch {
      showToast(language === "tr" ? "Kopyalama başarısız." : "Copy failed.", "error");
    }
  };
  const handleRevealFolder = async () => {
    const p = activeWs.path ?? "";
    if (!p) {
      showToast(language === "tr" ? "Varsayılan çalışma alanı klasörü açılamaz buradan." : "Can't reveal the default-storage location from here.", "info");
      return;
    }
    try {
      const { revealInFolder } = await import("../lib/storage");
      await revealInFolder(p);
    } catch (err) {
      showError(err);
    }
  };
  const providerLabel = (p: typeof activeWs.cloudProvider) => {
    if (p === "onedrive") return "OneDrive";
    if (p === "dropbox") return "Dropbox";
    if (p === "gdrive") return "Google Drive";
    if (p === "icloud") return "iCloud Drive";
    if (p === "other") return language === "tr" ? "Bulut" : "Cloud";
    return "";
  };
  /** Truncate a long path keeping head + tail so the user still recognises it. */
  const fmtPath = (p: string | null | undefined) => {
    if (!p) return language === "tr" ? "Varsayılan veri klasörü" : "App data folder";
    if (p.length <= 48) return p;
    const head = p.slice(0, 16);
    const tail = p.slice(-28);
    return `${head}…${tail}`;
  };

  const handleSwitchWorkspace = async (ws: Workspace) => {
    if (ws.id === activeWs.id) {
      setWsOpen(false);
      return;
    }
    setWsOpen(false);
    showToast(
      language === "tr"
        ? `"${ws.name}" çalışma alanına geçiliyor…`
        : `Switching to "${ws.name}"…`,
      "info",
    );
    try {
      await switchToWorkspace(ws);
      // Full reload — guarantees Zustand state, watchers and caches reset.
      setTimeout(() => { window.location.reload(); }, 600);
    } catch (err) {
      showError(err);
    }
  };

  const sections: NavSection[] = [
    {
      eyebrow: t.navMainMenu ?? "MAIN MENU",
      items: [{ key: "dashboard", label: t.dashboard, icon: LayoutDashboard }],
    },
    {
      eyebrow: t.navStudio ?? "STUDIO",
      items: [
        { key: "library", label: t.library, icon: Gamepad2 },
        { key: "storehub", label: t.storeHub ?? "Store Hub", icon: Store },
        { key: "tasks", label: t.taskCenter, icon: ListTodo },
        { key: "notes", label: t.notebook ?? "Notes", icon: StickyNote },
        { key: "calendar", label: t.calendar ?? "Calendar", icon: Calendar },
      ],
    },
    {
      eyebrow: t.navFinancial ?? "FINANCIAL",
      items: [
        { key: "wallet", label: t.wallet, icon: WalletIcon },
        { key: "analytics", label: t.analytics ?? "Analytics", icon: BarChart3 },
      ],
    },
  ];

  return (
    <aside className="sidebar modern-sidebar">
      {/* Workspace brand card (clickable dropdown) */}
      <div className="sidebar-workspace-wrap" ref={wsRef}>
        <button
          type="button"
          className="sidebar-brand modern-brand sidebar-brand-button"
          onClick={() => setWsOpen((o) => !o)}
          title={language === "tr" ? "Çalışma alanı menüsü" : "Workspace menu"}
          aria-label={language === "tr" ? "Çalışma alanı menüsünü aç" : "Open workspace menu"}
          aria-haspopup="menu"
          aria-expanded={wsOpen}
        >
          <div className="sidebar-brand-mark">
            <StudioHubLogo />
          </div>
          <div className="modern-brand-text">
            <p className="eyebrow">{t.brandEyebrow}</p>
            <h1>HeraVex</h1>
          </div>
          <ChevronDown
            size={14}
            className={`sidebar-brand-caret ${wsOpen ? "is-open" : ""}`}
          />
        </button>

        {wsOpen && (
          <div className="sidebar-workspace-menu" role="menu">
            {/* ── Active workspace summary card ───────────────────────
                Headline area showing the active workspace name, the
                full-or-truncated path, a mode badge (Local / Team +
                provider), live game count, and — for team folders —
                member count + your role badge. Two action chips below
                let the user reveal the folder in their file explorer
                or copy the absolute path to the clipboard. */}
            <div className={`sidebar-ws-active-card ${activeWs.mode === "team" ? "is-team" : "is-local"}`}>
              <div className="sidebar-ws-active-head">
                {activeWs.mode === "team"
                  ? <CloudIcon size={14} className="sidebar-ws-active-icon" />
                  : <HardDrive size={14} className="sidebar-ws-active-icon" />}
                <div className="sidebar-ws-active-text">
                  <strong className="sidebar-ws-active-name">{activeWs.name}</strong>
                  <span className="sidebar-ws-active-path" title={activeWs.path ?? undefined}>
                    {fmtPath(activeWs.path)}
                  </span>
                </div>
              </div>

              <div className="sidebar-ws-active-tags">
                <span className={`sidebar-ws-mode-tag mode-${activeWs.mode ?? "local"}`}>
                  {activeWs.mode === "team"
                    ? (language === "tr" ? "Ekip" : language === "fr" ? "Équipe" : language === "es" ? "Equipo" : "Team")
                    : (language === "tr" ? "Yerel" : language === "fr" ? "Local" : language === "es" ? "Local" : "Local")}
                </span>
                {activeWs.mode === "team" && activeWs.cloudProvider && (
                  <span className="sidebar-ws-provider-tag">{providerLabel(activeWs.cloudProvider)}</span>
                )}
                <span className="sidebar-ws-stat-tag">
                  <Gamepad2 size={10} />
                  {liveGameCount} {language === "tr" ? "oyun" : language === "fr" ? "jeux" : language === "es" ? "juegos" : "games"}
                </span>
                {activeWs.mode === "team" && activeTeam && (
                  <span className="sidebar-ws-stat-tag">
                    <Users size={10} />
                    {activeTeam.memberCount} {language === "tr" ? "üye" : language === "fr" ? "membres" : language === "es" ? "miembros" : "members"}
                  </span>
                )}
                {activeWs.mode === "team" && activeTeam?.myRole === "leader" && (
                  <span className="sidebar-ws-role-tag role-leader">
                    <Crown size={10} />
                    {language === "tr" ? "Lider" : language === "fr" ? "Leader" : language === "es" ? "Líder" : "Leader"}
                  </span>
                )}
                {activeWs.mode === "team" && activeTeam?.myRole === "member" && (
                  <span className="sidebar-ws-role-tag role-member">
                    {language === "tr" ? "Üye" : language === "fr" ? "Membre" : language === "es" ? "Miembro" : "Member"}
                  </span>
                )}
                {activeWs.mode === "team" && activeTeam?.myRole === "banned" && (
                  <span className="sidebar-ws-role-tag role-banned">
                    {language === "tr" ? "Banlı" : language === "fr" ? "Banni" : language === "es" ? "Baneado" : "Banned"}
                  </span>
                )}
              </div>

              <div className="sidebar-ws-active-actions">
                <button
                  type="button"
                  className="sidebar-ws-action"
                  onClick={() => void handleRevealFolder()}
                  disabled={!activeWs.path}
                  title={language === "tr" ? "Klasörü dosya gezgininde aç" : "Reveal in file explorer"}
                >
                  <ExternalLink size={11} />
                  {language === "tr" ? "Klasörü aç" : language === "fr" ? "Ouvrir le dossier" : language === "es" ? "Abrir carpeta" : "Open folder"}
                </button>
                <button
                  type="button"
                  className="sidebar-ws-action"
                  onClick={() => void handleCopyPath()}
                  disabled={!activeWs.path}
                  title={language === "tr" ? "Yolu kopyala" : "Copy path"}
                >
                  <Copy size={11} />
                  {language === "tr" ? "Yolu kopyala" : language === "fr" ? "Copier le chemin" : language === "es" ? "Copiar ruta" : "Copy path"}
                </button>
              </div>
            </div>

            {/* Local workspaces — includes the synthetic Default
                entry. Team workspaces render in their own section below
                so they read as a distinct surface, not a sibling list. */}
            <div className="sidebar-ws-section">
              <span className="sidebar-ws-section-label">
                {language === "tr" ? "ÇALIŞMA ALANLARI" : "WORKSPACES"}
              </span>
              {workspaces
                .filter((w) => w.id === "default" || (w.mode ?? "local") === "local")
                .map((ws) => {
                  const isActive = ws.id === activeWs.id;
                  const leaf = ws.path ? (ws.path.split(/[\\/]/).filter(Boolean).pop() ?? "") : "";
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      className={`sidebar-ws-item sidebar-ws-item-workspace ${isActive ? "is-active" : ""}`}
                      onClick={() => void handleSwitchWorkspace(ws)}
                      role="menuitemradio"
                      aria-checked={isActive}
                      title={ws.path ?? (language === "tr" ? "Varsayılan veri klasörü" : "App data folder")}
                    >
                      {ws.id === "default" ? <HardDrive size={13} strokeWidth={2.1} /> : <FolderOpen size={13} strokeWidth={2.1} />}
                      <div className="sidebar-ws-item-text">
                        <span className="sidebar-ws-name">{ws.name}</span>
                        <span className="sidebar-ws-sub">
                          {ws.id === "default"
                            ? (language === "tr" ? "Varsayılan klasör" : "App data folder")
                            : leaf || (language === "tr" ? "Yerel" : "Local")}
                        </span>
                      </div>
                      {isActive && <span className="sidebar-ws-active-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
            </div>

            {/* Team folders — only rendered when at least one team
                workspace is registered. Reads "EKİP KLASÖRLERİ" /
                "TEAM FOLDERS" with a cloud icon so users can tell the
                two surfaces apart at a glance. */}
            {workspaces.some((w) => w.mode === "team") && (
              <div className="sidebar-ws-section sidebar-ws-team-section">
                <span className="sidebar-ws-section-label">
                  {language === "tr" ? "EKİP KLASÖRLERİ"
                    : language === "fr" ? "DOSSIERS ÉQUIPE"
                    : language === "es" ? "CARPETAS DE EQUIPO"
                    : "TEAM FOLDERS"}
                </span>
                {workspaces.filter((w) => w.mode === "team").map((ws) => {
                  const isActive = ws.id === activeWs.id;
                  const leaf = ws.path ? (ws.path.split(/[\\/]/).filter(Boolean).pop() ?? "") : "";
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      className={`sidebar-ws-item sidebar-ws-item-workspace sidebar-ws-item-team ${isActive ? "is-active" : ""}`}
                      onClick={() => void handleSwitchWorkspace(ws)}
                      role="menuitemradio"
                      aria-checked={isActive}
                      title={ws.path ?? ws.cloudProvider ?? undefined}
                    >
                      <CloudIcon size={13} strokeWidth={2.1} />
                      <div className="sidebar-ws-item-text">
                        <span className="sidebar-ws-name">{ws.name}</span>
                        <span className="sidebar-ws-sub">
                          {providerLabel(ws.cloudProvider)}{leaf ? ` · ${leaf}` : ""}
                        </span>
                      </div>
                      {isActive && <span className="sidebar-ws-active-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="sidebar-ws-divider" />

            <button
              type="button"
              className="sidebar-ws-item"
              onClick={() => {
                setWsOpen(false);
                onNewWorkspace();
              }}
              role="menuitem"
            >
              <PlusCircle size={13} strokeWidth={2.1} />
              <span>{language === "tr" ? "Yeni Workspace" : "New Workspace"}</span>
            </button>
            <button
              type="button"
              className="sidebar-ws-item"
              onClick={() => {
                setWsOpen(false);
                setWorkspaceTab("profile");
              }}
              role="menuitem"
            >
              <Info size={13} strokeWidth={2.1} />
              <span>{language === "tr" ? "Workspace ayarları" : "Workspace settings"}</span>
            </button>

            {/* Footer counter — gives the user a sense of scale at a
                glance and balances the new active-summary header so
                the dropdown reads as a finished surface, not a list
                trailing off into empty space. */}
            <div className="sidebar-ws-footer">
              {workspaces.length} {language === "tr" ? "çalışma alanı kayıtlı" : language === "fr" ? "espaces enregistrés" : language === "es" ? "espacios registrados" : "registered"}
              {workspaces.some((w) => w.mode === "team") && (
                <> · {workspaces.filter((w) => w.mode === "team").length} {language === "tr" ? "ekip" : language === "fr" ? "équipe" : language === "es" ? "equipo" : "team"}</>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="modern-nav">
        {sections.map((section, sIdx) => (
          <motion.div
            key={section.eyebrow}
            className="nav-section"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: sIdx * 0.05, duration: 0.25 }}
          >
            <p className="nav-section-eyebrow">{section.eyebrow}</p>
            <ul className="nav-section-list">
              {section.items.map((item) => {
                const active = workspaceTab === item.key;
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <button
                      className={`nav-item ${active ? "nav-item-active" : ""}`}
                      onClick={() => setWorkspaceTab(item.key)}
                      data-tutorial={`nav-${item.key}`}
                    >
                      {active && layout.sidebarSlideIndicator !== false && (
                        <motion.span
                          layoutId="nav-active-indicator"
                          className="nav-active-indicator"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
                      )}
                      {active && layout.sidebarSlideIndicator === false && (
                        <span className="nav-active-indicator nav-active-indicator-static" />
                      )}
                      <Icon size={18} strokeWidth={1.9} className="nav-item-icon" />
                      <span className="nav-item-label">{item.label}</span>
                      {active && <ChevronRight size={14} className="nav-item-chev" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="profile-card-eyebrow">{t.navIdentity ?? "IDENTITY"}</div>
        <div className="profile-card">
          <button
            className="profile-card-main"
            onClick={() => setShowProfileView(true)}
            title={t.profile ?? "Profile"}
            data-tutorial="nav-profile"
          >
            <div className="profile-avatar">
              {avatarSrc ? (
                <img src={avatarSrc} alt="avatar" className="profile-avatar-img" />
              ) : (
                <img
                  src={logoMarkUrl}
                  alt={initials}
                  className="profile-avatar-img profile-avatar-mark"
                  draggable={false}
                />
              )}
              {presenceState && (
                <span
                  className={`profile-presence-dot is-${presenceState}`}
                  title={presenceLabel}
                  aria-label={presenceLabel}
                />
              )}
            </div>
            <div className="profile-info">
              <strong className="profile-name">{userName}</strong>
              <span className="profile-role">{userRole}</span>
            </div>
          </button>
          <div className="profile-card-side">
            <button
              type="button"
              className="profile-card-lang"
              onClick={onOpenLanguage}
              title={language === "tr" ? "Dili değiştir" : "Change language"}
              aria-label={language === "tr" ? "Dili değiştir" : "Change language"}
            >
              {language.toUpperCase()}
            </button>
            <button
              type="button"
              className="profile-card-settings"
              onClick={onOpenSettings}
              title={t.settings}
              aria-label={String(t.settings ?? (language === "tr" ? "Ayarlar" : "Settings"))}
            >
              <Settings size={16} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>

      {showProfileView && (
        <ProfileViewModal
          onClose={() => setShowProfileView(false)}
          onEdit={() => setWorkspaceTab("profile")}
        />
      )}

      {/* Drag handle — direct manipulation companion to the
          Settings → Layout sidebar-width slider. Both write to the
          same `layout.sidebarWidth`, so changing one updates the
          other live. The handle sits at the very right edge of the
          aside with an 8px hit-area; CSS gives it a subtle accent
          stripe on hover / during drag. */}
      <div
        className={`sidebar-drag-handle ${isResizingSidebar ? "is-dragging" : ""}`}
        onPointerDown={onSidebarHandleDown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={layout.sidebarWidth}
        aria-valuemin={200}
        aria-valuemax={480}
        title={language === "tr" ? "Sürükleyip genişliği değiştir" : "Drag to resize"}
      />
    </aside>
  );
}
