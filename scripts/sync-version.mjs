// Tek kaynaklı versiyon senkronizasyonu.
//
// `src/lib/app-meta.ts` içindeki APP_VERSION sabitini okur ve bu değerle
//   • package.json              ("version")
//   • src-tauri/Cargo.toml      ([package] version = "...")
//   • src-tauri/tauri.conf.json ("version")
// dosyalarını eşitler.
//
// `npm run build` çalıştırılınca otomatik tetiklenir. Manuel çalıştırma için:
//   node scripts/sync-version.mjs
//
// Çıktı: değişen dosya başına bir satır + son satırda özet.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const APP_META_PATH      = resolve(root, "src/lib/app-meta.ts");
const PACKAGE_JSON_PATH  = resolve(root, "package.json");
const CARGO_TOML_PATH    = resolve(root, "src-tauri/Cargo.toml");
const TAURI_CONF_PATH    = resolve(root, "src-tauri/tauri.conf.json");

function readVersionFromAppMeta() {
  const raw = readFileSync(APP_META_PATH, "utf8");
  const m = raw.match(/APP_VERSION\s*=\s*"([^"]+)"/);
  if (!m) {
    throw new Error(`Could not find APP_VERSION in ${APP_META_PATH}`);
  }
  const v = m[1].trim();
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(v)) {
    throw new Error(`Version "${v}" is not semver-shaped (X.Y.Z).`);
  }
  return v;
}

function patchPackageJson(version) {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const obj = JSON.parse(raw);
  if (obj.version === version) return false;
  obj.version = version;
  // Preserve trailing newline if present.
  const trail = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(obj, null, 2) + trail);
  return true;
}

function patchCargoToml(version) {
  const raw = readFileSync(CARGO_TOML_PATH, "utf8");
  // Match the FIRST `version = "..."` after [package] header. Conservative:
  // assumes the package version line is in the first section, which is the
  // Cargo convention.
  const re = /(\[package\][^\[]*?version\s*=\s*")([^"]+)(")/s;
  const m = raw.match(re);
  if (!m) {
    throw new Error(`Could not find [package] version in ${CARGO_TOML_PATH}`);
  }
  if (m[2] === version) return false;
  const next = raw.replace(re, `$1${version}$3`);
  writeFileSync(CARGO_TOML_PATH, next);
  return true;
}

function patchTauriConf(version) {
  const raw = readFileSync(TAURI_CONF_PATH, "utf8");
  const obj = JSON.parse(raw);
  if (obj.version === version) return false;
  obj.version = version;
  const trail = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(TAURI_CONF_PATH, JSON.stringify(obj, null, 2) + trail);
  return true;
}

function main() {
  const version = readVersionFromAppMeta();
  const changes = [];
  if (patchPackageJson(version)) changes.push("package.json");
  if (patchCargoToml(version))   changes.push("src-tauri/Cargo.toml");
  if (patchTauriConf(version))   changes.push("src-tauri/tauri.conf.json");

  if (changes.length === 0) {
    console.log(`[sync-version] v${version} — all files already in sync.`);
  } else {
    for (const c of changes) console.log(`[sync-version] updated → ${c}`);
    console.log(`[sync-version] v${version} synced (${changes.length} file${changes.length > 1 ? "s" : ""}).`);
  }
}

main();
