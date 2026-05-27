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
  const { workspaceTab, setWorkspaceTab, language, ui, avatarPath, showToast, showError } = useAppStore();
  const t = ui as unknown as Record<string, string>;
  const avatarSrc = imgSrc(avatarPath);

  // ── User identity (synced with localStorage from Profile) ───────────────
  const defaultName = language === "tr" ? "Stüdyo Üyesi" : "Studio Member";
  const defaultRole = language === "tr" ? "Geliştirici" : "Developer";
  const [userName, setUserName] = useState<string>(defaultName);
  const [userRole, setUserRole] = useState<string>(defaultRole);
  useEffect(() => {
    const readIdentity = () => {
      try {
        const name = localStorage.getItem("heravex_user_name");
        const role = localStorage.getItem("heravex_user_role");
        setUserName((name && name.trim()) || defaultName);
        setUserRole((role && role.trim()) || defaultRole);
      } catch {
        setUserName(defaultName);
        setUserRole(defaultRole);
      }
    };
    readIdentity();
    // Update when other tabs (or future code paths) change storage
    window.addEventListener("storage", readIdentity);
    // Poll lightly so in-app edits in Profile.tsx surface here (no event bus)
    const id = window.setInterval(readIdentity, 1200);
    return () => {
      window.removeEventListener("storage", readIdentity);
      window.clearInterval(id);
    };
  }, [defaultName, defaultRole]);

  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "HV";

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
            <div className="sidebar-ws-section">
              <span className="sidebar-ws-section-label">
                {language === "tr" ? "ÇALIŞMA ALANLARI" : "WORKSPACES"}
              </span>
              {workspaces.map((ws) => {
                const isActive = ws.id === activeWs.id;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    className={`sidebar-ws-item sidebar-ws-item-workspace ${isActive ? "is-active" : ""}`}
                    onClick={() => void handleSwitchWorkspace(ws)}
                    role="menuitemradio"
                    aria-checked={isActive}
                  >
                    <FolderOpen size={13} strokeWidth={2.1} />
                    <span className="sidebar-ws-name">{ws.name}</span>
                    {isActive && <span className="sidebar-ws-active-dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

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
                      {active && (
                        <motion.span
                          layoutId="nav-active-indicator"
                          className="nav-active-indicator"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
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
            onClick={() => setWorkspaceTab("profile")}
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

    </aside>
  );
}
