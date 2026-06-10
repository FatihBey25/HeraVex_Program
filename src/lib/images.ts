import { convertFileSrc } from "@tauri-apps/api/core";
// v0.9 M8 — route invoke through the wrapper for log-on-call support.
import { invoke } from "./invokeWrapper";

/**
 * Upload a base64 data-URL to the Rust backend, which decodes and saves it
 * as a real file under the game's assets/images folder.
 * Returns the absolute path of the saved file.
 */
export async function saveImageToDisk(base64Data: string, gameId: string): Promise<string> {
  return invoke<string>("save_image_to_disk", { base64Data, gameId });
}

/**
 * Convert a stored image value to an <img src> compatible URL.
 *
 * Backward-compatible:
 *  - undefined / ""         → undefined  (no image)
 *  - "data:image/..."       → return as-is (legacy base64 stored in JSON)
 *  - "/absolute/path/..."   → convertFileSrc() → asset:// or http://asset.localhost/
 */
export function imgSrc(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("data:")) return value;
  return convertFileSrc(value);
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
