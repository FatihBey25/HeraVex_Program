import logoUrl from "../../assets/logo.svg";

// Vite bundles SVGs as URL strings — same file used for app icon, sidebar
// brand mark, and (via logo-mark.svg) the avatar fallback. Keeps the brand
// identity unified across every surface.
export function StudioHubLogo() {
  return (
    <img
      src={logoUrl}
      alt="HeraVex"
      className="studio-logo"
      draggable={false}
    />
  );
}
