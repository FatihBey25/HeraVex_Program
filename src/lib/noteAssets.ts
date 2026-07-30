// Local asset references for the notes editor (v0.9.8).
//
// Philosophy: HeraVex never copies the user's heavy media into the
// workspace. The note stores only the *absolute path* (in a
// `data-asset-path` attribute) and the WebView streams the bytes
// straight off disk through Tauri's `asset:` protocol via
// `convertFileSrc`. A 300 MB concept-art PNG therefore costs the
// (cloud-synced) note file just a few dozen bytes of path text.
//
// What lives here:
//   • pickAssetFile()      — opens the native picker (Rust side), no copy
//   • assetKindFromPath()  — image | audio | null
//   • buildAssetHtml()     — the editor-ready, contenteditable=false markup
//   • resolveAssetSrcs()   — re-points every media element's `src` at the
//                            current `convertFileSrc(path)` on (re)mount, so
//                            references survive reload without baking a
//                            Tauri-version-specific host URL into saved HTML.

import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "./invokeWrapper";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const AUDIO_EXT = new Set(["wav", "mp3", "ogg", "flac", "m4a", "aac"]);

export type AssetKind = "image" | "audio";

function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path.trim());
  return m ? m[1].toLowerCase() : "";
}

function baseName(path: string): string {
  // Handle both \ and / separators (Windows + POSIX paths).
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function assetKindFromPath(path: string): AssetKind | null {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

/** Native file picker (Rust `pick_asset_file`). Returns the absolute
 *  path, or `null` if the user cancelled. No file is copied. */
export async function pickAssetFile(): Promise<string | null> {
  try {
    const path = await invoke<string>("pick_asset_file");
    return path && path.trim() ? path : null;
  } catch {
    // rfd returns an Err on cancel; treat as a no-op, not an error.
    return null;
  }
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build the editor-ready HTML for a local asset reference.
 *
 * The wrapper is `contenteditable="false"` so the contentEditable shell
 * treats the whole asset as a single atomic, non-editable block (the
 * user can still place the caret before/after it and delete it wholesale).
 * `data-asset-path` carries the canonical absolute path; `src` is the
 * convenience pre-resolved URL (refreshed by `resolveAssetSrcs` on load).
 *
 * Returns `""` when the extension isn't a supported media type.
 */
export function buildAssetHtml(path: string): string {
  const kind = assetKindFromPath(path);
  if (!kind) return "";
  const src = convertFileSrc(path);
  const name = baseName(path);
  const pathAttr = escapeAttr(path);
  const srcAttr = escapeAttr(src);
  const nameAttr = escapeAttr(name);

  if (kind === "image") {
    return (
      `<figure class="note-asset note-asset-image" data-asset-path="${pathAttr}" contenteditable="false">` +
      `<img src="${srcAttr}" alt="${nameAttr}" loading="lazy" draggable="false" />` +
      `<figcaption>${nameAttr}</figcaption>` +
      `</figure>`
    );
  }
  // audio
  return (
    `<div class="note-asset note-asset-audio" data-asset-path="${pathAttr}" contenteditable="false">` +
    `<audio controls preload="metadata" src="${srcAttr}"></audio>` +
    `<span class="note-asset-name">${nameAttr}</span>` +
    `</div>`
  );
}

/**
 * Re-point every asset's media `src` at the freshly-resolved
 * `convertFileSrc(path)`. Call after writing saved HTML into the editor
 * (or any preview surface). Idempotent — skips elements whose src is
 * already correct.
 */
export function resolveAssetSrcs(root: HTMLElement | null | undefined): void {
  if (!root) return;
  const nodes = root.querySelectorAll<HTMLElement>("[data-asset-path]");
  nodes.forEach((node) => {
    const path = node.getAttribute("data-asset-path");
    if (!path) return;
    const media = node.querySelector<HTMLImageElement | HTMLAudioElement>("img, audio");
    if (!media) return;
    const next = convertFileSrc(path);
    if (media.getAttribute("src") !== next) media.setAttribute("src", next);
  });
}
