// Read-only profile + studio identity card — fullscreen overlay.
//
// Opens when the user clicks the mini-profile button in the sidebar.
// The gear icon next to it still routes to Settings. This view is a
// one-shot read-only summary of every field the user filled in on the
// Profile and Studio Identity settings pages.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, Mail, Pencil, User, Briefcase, Sparkles, Palette, Link as LinkIcon, Scale } from "lucide-react";
import { useAppStore } from "../../store";
import { imgSrc } from "../../lib/images";
import { openExternal } from "../../lib/storage";

interface Props {
  onClose: () => void;
  onEdit: () => void;
}

export function ProfileViewModal({ onClose, onEdit }: Props) {
  const { ui, profile, studioIdentity, avatarPath } = useAppStore();
  const avatarSrc = imgSrc(avatarPath);

  // ESC closes the modal — keyboard parity with the tutorial overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const socialUrl = (kind: string, raw: string): string | null => {
    const v = raw.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    const handle = v.replace(/^@/, "");
    switch (kind) {
      case "website":  return v.startsWith("http") ? v : `https://${v}`;
      case "twitter":  return `https://x.com/${handle}`;
      case "bluesky":  return `https://bsky.app/profile/${handle}`;
      case "github":   return `https://github.com/${handle}`;
      case "mastodon":
        return handle.includes("@") ? `https://${handle.split("@")[1]}/@${handle.split("@")[0]}` : null;
      default: return null;
    }
  };

  const SocialChip = ({ kind, label, raw }: { kind: string; label: string; raw: string }) => {
    if (!raw.trim()) return null;
    const url = socialUrl(kind, raw);
    const onClick = url ? () => void openExternal(url) : undefined;
    return (
      <button
        type="button"
        className={`profile-view-social${url ? "" : " is-static"}`}
        onClick={onClick}
        disabled={!url}
      >
        <span className="profile-view-social-label">{label}</span>
        <span className="profile-view-social-value">{raw}</span>
        {url && <ExternalLink size={10} />}
      </button>
    );
  };

  const teamLabel =
    studioIdentity.teamSize === "solo" ? ui.studioTeamSolo : studioIdentity.teamSize;

  // Renders a labeled field tile. Falls back to a muted "—" instead of
  // hiding empties so the read-only view is auditable: the user can see
  // at a glance what data is still missing from the press kit.
  const Field = ({ label, value }: { label: string; value: string | number | undefined }) => {
    const str = value == null ? "" : String(value).trim();
    return (
      <div className="profile-view-field">
        <span className="profile-view-field-label">{label}</span>
        <span className={`profile-view-field-value${str ? "" : " is-empty"}`}>
          {str || "—"}
        </span>
      </div>
    );
  };

  // Portal to <body> so the modal escapes the sidebar's `backdrop-filter`
  // containing block. Without this, position:fixed clips to the sidebar
  // column and the modal looks "locked" to the left rail. With portal,
  // the backdrop covers the full viewport like TutorialOverlay does.
  return createPortal(
    <div className="mb-modal-backdrop profile-view-fs-backdrop" onClick={onClose}>
      <div
        className="mb-modal profile-view-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mb-modal-close" onClick={onClose} aria-label={ui.mbClose}>
          <X size={18} />
        </button>

        <div className="mb-modal-side" style={{ borderLeft: "none" }}>
          {/* ── Identity hero (banner gradient + avatar + name) ───── */}
          <div className="profile-view-hero-banner">
            <div className="profile-view-hero">
              <div className="profile-view-avatar" style={{ width: 112, height: 112, fontSize: 36 }}>
                {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{
                  (profile.displayName || "HV").slice(0, 2).toUpperCase()
                }</span>}
              </div>
              <div className="profile-view-hero-text">
                <h2 style={{ fontSize: 30 }}>{profile.displayName || ui.profileDisplayName}</h2>
                {profile.handle && <p className="profile-view-handle">@{profile.handle}</p>}
                {profile.bio && <p className="profile-view-bio">{profile.bio}</p>}
              </div>
              <button type="button" className="setting-compact-btn" onClick={() => { onEdit(); onClose(); }}>
                <Pencil size={11} style={{ marginRight: 4 }} />
                {ui.profileAvatarPick}
              </button>
            </div>

            {/* ── Contact + location ──────────────────────────────── */}
            {(profile.email || profile.location) && (
              <div className="profile-view-meta" style={{ marginTop: 16 }}>
                {profile.email && (
                  <button type="button" className="profile-view-meta-row"
                          onClick={() => void openExternal(`mailto:${profile.email}`)}>
                    <Mail size={12} /> {profile.email}
                  </button>
                )}
                {profile.location && (
                  <span className="profile-view-meta-row is-static">📍 {profile.location}</span>
                )}
              </div>
            )}
          </div>

          <div className="profile-view-fullscreen-grid" style={{ marginTop: 4 }}>
            {/* ── Profile fields ─────────────────────────────────── */}
            <div>
              <div className="profile-view-section">
                <p className="profile-view-section-title">
                  <span className="profile-view-section-icon"><User size={14} /></span>
                  {ui.profileGroupIdentity}
                </p>
                <div className="profile-view-field-list">
                  <Field label={ui.profileDisplayName} value={profile.displayName} />
                  <Field label={ui.profileHandle}      value={profile.handle ? `@${profile.handle}` : ""} />
                  <Field label={ui.profileEmail}       value={profile.email} />
                  <Field label={ui.profileLocation}    value={profile.location} />
                </div>
              </div>

              <div className="profile-view-section">
                <p className="profile-view-section-title">
                  <span className="profile-view-section-icon"><Sparkles size={14} /></span>
                  {ui.profileGroupRole}
                </p>
                <div className="profile-view-chip-row">
                  <span className="profile-view-chip is-primary">
                    {(ui as unknown as Record<string, string>)[
                      profile.primaryRole === "soloDev"    ? "roleSoloDev" :
                      profile.primaryRole === "designer"   ? "roleDesigner" :
                      profile.primaryRole === "programmer" ? "roleProgrammer" :
                      profile.primaryRole === "artist"     ? "roleArtist" :
                      profile.primaryRole === "composer"   ? "roleComposer" :
                      profile.primaryRole === "producer"   ? "roleProducer" :
                      profile.primaryRole === "writer"     ? "roleWriter" :
                      profile.primaryRole === "qa"         ? "roleQa" : "roleOther"
                    ] ?? profile.primaryRole}
                  </span>
                  {profile.secondaryRoles.map((r) => (
                    <span key={r} className="profile-view-chip">{r}</span>
                  ))}
                  <span className="profile-view-chip is-muted">
                    {(ui as unknown as Record<string, string>)[
                      profile.experience === "lt1y"  ? "experienceLt1y" :
                      profile.experience === "1to3"  ? "experience1to3" :
                      profile.experience === "3to5"  ? "experience3to5" : "experience5plus"
                    ]}
                  </span>
                  <span className="profile-view-chip is-muted">{profile.preferredEngine}</span>
                  {profile.preferredLanguages.map((l) => (
                    <span key={l} className="profile-view-chip is-muted">{l}</span>
                  ))}
                </div>
              </div>

              <div className="profile-view-section">
                <p className="profile-view-section-title">
                  <span className="profile-view-section-icon"><LinkIcon size={14} /></span>
                  {ui.profileGroupBio}
                </p>
                <div className="profile-view-chip-row">
                  <SocialChip kind="website"  label="web"     raw={profile.website} />
                  <SocialChip kind="twitter"  label="x"       raw={profile.twitter} />
                  <SocialChip kind="bluesky"  label="bsky"    raw={profile.bluesky} />
                  <SocialChip kind="mastodon" label="masto"   raw={profile.mastodon} />
                  <SocialChip kind="discord"  label="discord" raw={profile.discord} />
                  <SocialChip kind="github"   label="github"  raw={profile.github} />
                </div>
              </div>
            </div>

            {/* ── Studio identity ────────────────────────────────── */}
            <div>
              <div className="profile-view-section">
                <p className="profile-view-section-title">
                  <span className="profile-view-section-icon"><Briefcase size={14} /></span>
                  {ui.studioGroupStudio}
                </p>
                {studioIdentity.studioName && (
                  <div
                    className="profile-view-studio-banner"
                    style={{
                      // CSS vars consumed by the gradient — fall back to
                      // accent tokens when the user hasn't picked brand
                      // colours yet.
                      ["--studio-primary" as string]: studioIdentity.primaryColor || "var(--accent)",
                      ["--studio-secondary" as string]: studioIdentity.secondaryColor || "var(--accent-strong)",
                    }}
                  >
                    <h3>{studioIdentity.studioName}</h3>
                    <div className="profile-view-studio-meta">
                      {studioIdentity.location && <span>📍 {studioIdentity.location}</span>}
                      {studioIdentity.founded && <span>🗓 {studioIdentity.founded}</span>}
                      <span>👥 {teamLabel}</span>
                    </div>
                  </div>
                )}
                <div className="profile-view-field-list" style={{ marginTop: 12 }}>
                  <Field label={ui.studioName}     value={studioIdentity.studioName} />
                  <Field label={ui.studioFounded}  value={studioIdentity.founded} />
                  <Field label={ui.studioLocation} value={studioIdentity.location} />
                  <Field label={ui.studioTeamSize} value={String(teamLabel)} />
                </div>
              </div>

              <div className="profile-view-section">
                <p className="profile-view-section-title">
                  <span className="profile-view-section-icon"><Scale size={14} /></span>
                  {ui.studioGroupLegal}
                </p>
                <div className="profile-view-field-list">
                  <Field label={ui.studioLegalName}    value={studioIdentity.legalName} />
                  <Field label={ui.studioTaxId}        value={studioIdentity.taxId} />
                  <Field label={ui.studioContactEmail} value={studioIdentity.contactEmail} />
                  <Field label={ui.studioPressEmail}   value={studioIdentity.pressEmail} />
                </div>
              </div>

              <div className="profile-view-section">
                <p className="profile-view-section-title">
                  <span className="profile-view-section-icon"><Palette size={14} /></span>
                  {ui.studioGroupBrand}
                </p>
                <div className="profile-view-brand-row">
                  <div className="profile-view-brand-card">
                    <span className="profile-view-brand-swatch" style={{ background: studioIdentity.primaryColor }} />
                    <div>
                      <small>{ui.studioPrimaryColor}</small>
                      <strong>{studioIdentity.primaryColor}</strong>
                    </div>
                  </div>
                  <div className="profile-view-brand-card">
                    <span className="profile-view-brand-swatch" style={{ background: studioIdentity.secondaryColor }} />
                    <div>
                      <small>{ui.studioSecondaryColor}</small>
                      <strong>{studioIdentity.secondaryColor}</strong>
                    </div>
                  </div>
                </div>
                <div className="profile-view-field-list" style={{ marginTop: 12 }}>
                  <Field label={ui.studioBrandFont} value={studioIdentity.brandFont} />
                </div>
              </div>
            </div>
          </div>

          {/* Bottom breathing room */}
          <div style={{ height: 40 }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
