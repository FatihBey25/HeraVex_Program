// Centralised app metadata — single source of truth for the version string.
//
// CHANGING THE VERSION: bump APP_VERSION here, then run `npm run sync-version`
// (or any `npm run build` invocation, which syncs automatically). This will
// update package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json so
// the in-app label, the installer filename, and `Get-Item *.exe | Version`
// all agree.

export const APP_VERSION = "1.0.0";
export const APP_BUILD_DATE = "03.10.2026";

/** GitHub Releases page where each tagged build is published. Update this when
 *  the public repo URL is finalised. */
export const RELEASES_URL = "https://heravex.app/";

/** Inbound feedback address. Mailto: must use the literal string so default
 *  mail handlers register the intent correctly. */
export const FEEDBACK_EMAIL = "support@heravex.app";
