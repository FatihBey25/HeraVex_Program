import { convertFileSrc } from "@tauri-apps/api/core";
// v0.9 M8 — route invoke through the wrapper for log-on-call support.
import { invoke } from "./invokeWrapper";
import { getCachedWorkspacePath } from "./storage";

/**
 * Upload a base64 data-URL to the Rust backend, which decodes and saves it
 * as a real file under the game's assets/images folder.
 * Returns the absolute path of the saved file.
 */
export async function saveImageToDisk(base64Data: string, gameId: string): Promise<string> {
  return invoke<string>("save_image_to_disk", { base64Data, gameId });
}

// HeraVex-managed images always live at <root>/library/<game>/assets/...
const MANAGED_ASSET_RE_G = /\/library\/[^/]+\/assets\//gi;

/**
 * Team mode: image paths are stored as ABSOLUTE paths, so a cover set by
 * a teammate points into THEIR sync folder (`C:/Users/ali/Google Drive/
 * HeraVex/library/...`), which doesn't exist on this machine. The JSON
 * synced fine, the <img> 404'd — "the cover changed but won't display".
 *
 * Re-anchor any HeraVex-managed path (`.../library/<game>/assets/...`)
 * onto THIS machine's workspace root. Paths already under the local root
 * and user files elsewhere on disk (note attachments) are untouched.
 * Rust mirrors this in `resolve_workspace_asset`.
 */
export function remapWorkspaceAsset(value: string): string {
  const root = getCachedWorkspacePath();
  if (!root) return value;
  const norm = value.replace(/\\/g, "/");
  const rootNorm = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const sep = root.includes("\\") ? "\\" : "/";

  // Legacy relative form: "library/<game>/..."
  if (/^library\//i.test(norm)) {
    return rootNorm.replace(/\//g, sep) + sep + norm.replace(/\//g, sep);
  }
  if (norm.toLowerCase().startsWith(rootNorm.toLowerCase() + "/")) return value;
  // Use the LAST match so a teammate root that itself contains a
  // "library" folder still resolves to the HeraVex-managed tail.
  const matches = Array.from(norm.matchAll(MANAGED_ASSET_RE_G));
  if (matches.length === 0) return value;
  const idx = matches[matches.length - 1].index ?? 0;
  const tail = norm.slice(idx); // "/library/<game>/assets/..."
  return (rootNorm + tail).replace(/\//g, sep);
}

/**
 * Convert a stored image value to an <img src> compatible URL.
 *
 * Backward-compatible:
 *  - undefined / ""         → undefined  (no image)
 *  - "data:image/..."       → return as-is (legacy base64 stored in JSON)
 *  - "/absolute/path/..."   → convertFileSrc() → asset:// or http://asset.localhost/
 *                             (re-anchored onto the local workspace first)
 */
export function imgSrc(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("data:")) return value;
  return convertFileSrc(remapWorkspaceAsset(value));
}

/**
 * Read a File object as a base64 data-URL (used before uploading to Rust).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("FileReader did not produce a string"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

// ── Broken-image recovery (team mode) ──────────────────────────────────
//
// The cloud client delivers files independently: the game JSON that
// names a new cover often lands seconds BEFORE the image itself. The
// <img> fails once and the WebView never asks again, so the cover stays
// broken until a restart. This installs one capture-phase listener for
// every local-asset <img> in the app and retries it:
//   • on a backoff schedule (covers slow downloads), and
//   • immediately when team sync reports new image files on disk.
// Tauri's asset protocol only reads the URL path, so the `?hv-retry=`
// query is a pure cache-buster. Components keep their own onError
// fallbacks (initials avatar etc.); this only adds retries.

const RETRY_DELAYS_MS = [1500, 4000, 10000, 20000, 45000, 90000];
const RETRY_ATTR = "data-hv-retry";

interface RetryState {
  base: string;
  attempt: number;
  timer: number | null;
}

const retryState = new WeakMap<HTMLImageElement, RetryState>();
const broken = new Set<HTMLImageElement>();
let recoveryInstalled = false;

function isLocalAssetUrl(src: string): boolean {
  return src.startsWith("http://asset.localhost/")
    || src.startsWith("https://asset.localhost/")
    || src.startsWith("asset://");
}

function stripRetry(src: string): string {
  const q = src.indexOf("?hv-retry=");
  return q >= 0 ? src.slice(0, q) : src;
}

/** Rebuild the URL from the path it encodes, re-applying the workspace
 *  remap (covers the case where the root wasn't known at first render). */
function rebuildAssetUrl(src: string): string {
  try {
    const url = new URL(src);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!path) return src;
    return convertFileSrc(remapWorkspaceAsset(path));
  } catch {
    return src;
  }
}

function retryNow(img: HTMLImageElement): void {
  const st = retryState.get(img);
  if (!st || !img.isConnected) {
    broken.delete(img);
    return;
  }
  if (st.timer != null) {
    window.clearTimeout(st.timer);
    st.timer = null;
  }
  st.attempt++;
  img.setAttribute(RETRY_ATTR, String(st.attempt));
  img.src = `${rebuildAssetUrl(st.base)}?hv-retry=${Date.now()}`;
}

function onImgError(e: Event): void {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const src = img.getAttribute("src") ?? "";
  if (!isLocalAssetUrl(src)) return;
  const base = stripRetry(src);
  let st = retryState.get(img);
  // A new src (React re-render with a different cover) starts fresh.
  if (!st || st.base !== base) {
    if (st?.timer != null) window.clearTimeout(st.timer);
    st = { base, attempt: 0, timer: null };
    retryState.set(img, st);
  }
  broken.add(img);
  if (st.attempt >= RETRY_DELAYS_MS.length) return; // give up on the timer; sync events can still revive it
  const delay = RETRY_DELAYS_MS[st.attempt];
  const state = st;
  state.timer = window.setTimeout(() => {
    state.timer = null;
    retryNow(img);
  }, delay);
}

function onImgLoad(e: Event): void {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (!broken.has(img)) return;
  broken.delete(img);
  const st = retryState.get(img);
  if (st?.timer != null) window.clearTimeout(st.timer);
  retryState.delete(img);
  img.removeAttribute(RETRY_ATTR);
}

/** Retry every currently-broken local image right away. Team sync calls
 *  this (via `heravex:assets-changed`) when new image files land. */
export function retryBrokenImages(): void {
  for (const img of Array.from(broken)) retryNow(img);
}

/** Idempotent. Call once at startup. */
export function installImageRecovery(): void {
  if (recoveryInstalled || typeof document === "undefined") return;
  recoveryInstalled = true;
  // `error` / `load` don't bubble, but they do reach capture listeners.
  document.addEventListener("error", onImgError, true);
  document.addEventListener("load", onImgLoad, true);
  window.addEventListener("heravex:assets-changed", retryBrokenImages);
  window.addEventListener("heravex:games-list-changed", retryBrokenImages);
}
