// Frontend hata mesajı çevirmeni.
//
// Rust backend sabit Türkçe (ASCII transliterasyonlu) hata stringleri döner.
// Bu modül onları yakalayıp aktif dile çevirir. Eşleşme yoksa orijinal mesaj
// olduğu gibi dönülür — bu sayede yeni bir hata türü eklendiğinde regresyon
// olmaz, sadece çeviri eksik kalır.

import type { AppLanguage } from "./i18n";

type Dict = Record<AppLanguage, string>;

/**
 * Pattern: ya tam string ya da regex; öncelik sırasıyla denenir.
 * params'ı doldurmak için regex group'ları kullanılır ({1} = capture group 1).
 */
type Rule = {
  match: RegExp;
  messages: Dict;
};

// Sıralama önemli — daha spesifik kalıplar yukarıda olmalı.
const RULES: Rule[] = [
  // ── İptal edilen kullanıcı eylemleri ────────────────────────────────
  {
    match: /iptal edildi/i,
    messages: {
      tr: "İşlem iptal edildi.",
      en: "Action cancelled.",
      fr: "Action annulée.",
      es: "Acción cancelada.",
    },
  },

  // ── Steam ──────────────────────────────────────────────────────────
  {
    match: /Steam: AppID sadece rakam/i,
    messages: {
      tr: "Steam: AppID yalnızca rakamlardan oluşmalı (ör. 730).",
      en: "Steam: AppID must be numeric (e.g. 730).",
      fr: "Steam : l'AppID doit être numérique (ex. 730).",
      es: "Steam: el AppID debe ser numérico (ej. 730).",
    },
  },
  {
    match: /steamid64 17 haneli/i,
    messages: {
      tr: "Steam: steamid64 17 haneli sayısal olmalı (ör. 76561198XXXXXXXXX).",
      en: "Steam: steamid64 must be a 17-digit number (e.g. 76561198XXXXXXXXX).",
      fr: "Steam : le steamid64 doit comporter 17 chiffres (ex. 76561198XXXXXXXXX).",
      es: "Steam: el steamid64 debe tener 17 dígitos (ej. 76561198XXXXXXXXX).",
    },
  },
  {
    match: /Steam icin steamid64 gerekli/i,
    messages: {
      tr: "Steam için steamid64 zorunlu.",
      en: "Steam requires a steamid64.",
      fr: "Steam exige un steamid64.",
      es: "Steam requiere un steamid64.",
    },
  },
  {
    match: /Steam: API anahtari yetkisi reddedildi/i,
    messages: {
      tr: "Steam: API anahtarı reddedildi. Web API key doğru mu?",
      en: "Steam: API key rejected. Is your Web API key correct?",
      fr: "Steam : clé API refusée. La clé Web API est-elle correcte ?",
      es: "Steam: clave API rechazada. ¿La Web API key es correcta?",
    },
  },
  {
    match: /Steam: cok fazla istek/i,
    messages: {
      tr: "Steam: çok fazla istek (rate limit). Birkaç dakika sonra dene.",
      en: "Steam: rate limit reached. Try again in a few minutes.",
      fr: "Steam : limite de requêtes atteinte. Réessayez dans quelques minutes.",
      es: "Steam: límite de peticiones alcanzado. Inténtalo en unos minutos.",
    },
  },
  {
    match: /Steam: AppID (\d+) icin veri bulunamadi/i,
    messages: {
      tr: "Steam: AppID {1} için veri bulunamadı (gizli veya geçersiz).",
      en: "Steam: no data found for AppID {1} (private or invalid).",
      fr: "Steam : aucune donnée pour l'AppID {1} (privé ou invalide).",
      es: "Steam: sin datos para el AppID {1} (privado o no válido).",
    },
  },
  {
    match: /Steam: ag baglanti hatasi/i,
    messages: {
      tr: "Steam: ağ bağlantı hatası. İnternet bağlantını kontrol et.",
      en: "Steam: network error. Check your internet connection.",
      fr: "Steam : erreur réseau. Vérifiez votre connexion.",
      es: "Steam: error de red. Comprueba tu conexión.",
    },
  },
  {
    match: /Steam storefront kod: (\d+)/i,
    messages: {
      tr: "Steam mağaza isteği başarısız (HTTP {1}).",
      en: "Steam storefront request failed (HTTP {1}).",
      fr: "Échec de la requête Steam (HTTP {1}).",
      es: "Falló la solicitud de Steam (HTTP {1}).",
    },
  },
  {
    match: /Steam API kod: (\d+)/i,
    messages: {
      tr: "Steam API başarısız (HTTP {1}).",
      en: "Steam API failed (HTTP {1}).",
      fr: "Échec de l'API Steam (HTTP {1}).",
      es: "Falló la API de Steam (HTTP {1}).",
    },
  },

  // ── Itch.io ─────────────────────────────────────────────────────────
  {
    match: /Itch\.io API anahtari kayitli degil/i,
    messages: {
      tr: "Itch.io API anahtarı kayıtlı değil. Ayarlardan ekle.",
      en: "Itch.io API key is not configured. Add it in Settings.",
      fr: "Clé API Itch.io non configurée. Ajoutez-la dans les paramètres.",
      es: "Falta la clave API de Itch.io. Añádela en Ajustes.",
    },
  },
  {
    match: /Itch\.io API kod: (\d+)/i,
    messages: {
      tr: "Itch.io API başarısız (HTTP {1}).",
      en: "Itch.io API failed (HTTP {1}).",
      fr: "Échec de l'API Itch.io (HTTP {1}).",
      es: "Falló la API de Itch.io (HTTP {1}).",
    },
  },
  {
    match: /Itch\.io: id=(\S+) hesabinizdaki/i,
    messages: {
      tr: "Itch.io: id={1} hesabınızda bulunamadı.",
      en: "Itch.io: id={1} not found in your account.",
      fr: "Itch.io : id={1} introuvable dans votre compte.",
      es: "Itch.io: id={1} no encontrado en tu cuenta.",
    },
  },
  {
    match: /Itch\.io hatasi: (.+)/i,
    messages: {
      tr: "Itch.io hatası: {1}",
      en: "Itch.io error: {1}",
      fr: "Erreur Itch.io : {1}",
      es: "Error de Itch.io: {1}",
    },
  },
  {
    match: /Itch\.io hedef bos olamaz/i,
    messages: {
      tr: "Itch.io hedefi boş olamaz.",
      en: "Itch.io target cannot be empty.",
      fr: "La cible Itch.io ne peut pas être vide.",
      es: "El objetivo de Itch.io no puede estar vacío.",
    },
  },

  // ── Google Play ─────────────────────────────────────────────────────
  {
    match: /Google Play: Service Account JSON kayitli degil/i,
    messages: {
      tr: "Google Play: Service Account JSON kayıtlı değil.",
      en: "Google Play: Service Account JSON is not configured.",
      fr: "Google Play : JSON de compte de service non configuré.",
      es: "Google Play: falta el JSON de la cuenta de servicio.",
    },
  },
  {
    match: /Google Play: Auth Error \((\d+)\)/i,
    messages: {
      tr: "Google Play: kimlik doğrulama hatası ({1}).",
      en: "Google Play: authentication error ({1}).",
      fr: "Google Play : erreur d'authentification ({1}).",
      es: "Google Play: error de autenticación ({1}).",
    },
  },
  {
    match: /Google Play API kod: (\d+)/i,
    messages: {
      tr: "Google Play API başarısız (HTTP {1}).",
      en: "Google Play API failed (HTTP {1}).",
      fr: "Échec de l'API Google Play (HTTP {1}).",
      es: "Falló la API de Google Play (HTTP {1}).",
    },
  },

  // ── Genel ──────────────────────────────────────────────────────────
  {
    match: /Magaza ID bos/i,
    messages: {
      tr: "Mağaza ID boş olamaz.",
      en: "Store ID cannot be empty.",
      fr: "L'ID de la boutique ne peut pas être vide.",
      es: "El ID de la tienda no puede estar vacío.",
    },
  },
  {
    match: /API anahtari bos/i,
    messages: {
      tr: "API anahtarı boş.",
      en: "API key is empty.",
      fr: "La clé API est vide.",
      es: "La clave API está vacía.",
    },
  },
  {
    match: /Oyun bulunamadi/i,
    messages: {
      tr: "Oyun bulunamadı.",
      en: "Game not found.",
      fr: "Jeu introuvable.",
      es: "Juego no encontrado.",
    },
  },
  {
    match: /Oyun basligi bos olamaz/i,
    messages: {
      tr: "Oyun başlığı boş olamaz.",
      en: "Game title cannot be empty.",
      fr: "Le titre du jeu ne peut pas être vide.",
      es: "El título del juego no puede estar vacío.",
    },
  },
  {
    match: /Surum bos olamaz/i,
    messages: {
      tr: "Sürüm numarası boş olamaz.",
      en: "Version cannot be empty.",
      fr: "La version ne peut pas être vide.",
      es: "La versión no puede estar vacía.",
    },
  },
  {
    match: /Surum bulunamadi/i,
    messages: {
      tr: "Sürüm bulunamadı.",
      en: "Version not found.",
      fr: "Version introuvable.",
      es: "Versión no encontrada.",
    },
  },
  {
    match: /Not bulunamadi/i,
    messages: {
      tr: "Not bulunamadı.",
      en: "Note not found.",
      fr: "Note introuvable.",
      es: "Nota no encontrada.",
    },
  },
  {
    match: /Build dosyasi bulunamadi/i,
    messages: {
      tr: "Build dosyası bulunamadı.",
      en: "Build file not found.",
      fr: "Fichier de build introuvable.",
      es: "Archivo de build no encontrado.",
    },
  },
  {
    match: /Build klasoru bos olamaz/i,
    messages: {
      tr: "Build klasörü boş olamaz.",
      en: "Build folder cannot be empty.",
      fr: "Le dossier de build ne peut pas être vide.",
      es: "La carpeta del build no puede estar vacía.",
    },
  },
  {
    match: /Klasor bulunamadi: (.+)/i,
    messages: {
      tr: "Klasör bulunamadı: {1}",
      en: "Folder not found: {1}",
      fr: "Dossier introuvable : {1}",
      es: "Carpeta no encontrada: {1}",
    },
  },
  {
    match: /Yedek icinde gecersiz mutlak dosya yolu/i,
    messages: {
      tr: "Yedek dosyada geçersiz mutlak yol var.",
      en: "Backup contains an invalid absolute path.",
      fr: "La sauvegarde contient un chemin absolu invalide.",
      es: "La copia de seguridad contiene una ruta absoluta no válida.",
    },
  },
  {
    match: /Yedek icinde guvensiz dosya yolu/i,
    messages: {
      tr: "Yedek dosyada güvensiz yol bulundu.",
      en: "Backup contains an unsafe path.",
      fr: "La sauvegarde contient un chemin non sécurisé.",
      es: "La copia contiene una ruta no segura.",
    },
  },
  {
    match: /Bu yedek surumu desteklenmiyor/i,
    messages: {
      tr: "Bu yedek sürümü desteklenmiyor.",
      en: "This backup version is not supported.",
      fr: "Cette version de sauvegarde n'est pas prise en charge.",
      es: "Esta versión de copia de seguridad no es compatible.",
    },
  },
  {
    match: /Bu magaza icin link kaydedilmemis/i,
    messages: {
      tr: "Bu mağaza için bağlantı kaydedilmemiş.",
      en: "No link is saved for this store.",
      fr: "Aucun lien enregistré pour cette boutique.",
      es: "No hay enlace guardado para esta tienda.",
    },
  },
  {
    match: /Gecersiz magazaya baglanti denendi|Gecersiz magaza anahtari/i,
    messages: {
      tr: "Geçersiz mağaza anahtarı.",
      en: "Invalid store key.",
      fr: "Clé de boutique invalide.",
      es: "Clave de tienda no válida.",
    },
  },
  {
    match: /Bilinmeyen saglayici: (.+)/i,
    messages: {
      tr: "Bilinmeyen sağlayıcı: {1}",
      en: "Unknown provider: {1}",
      fr: "Fournisseur inconnu : {1}",
      es: "Proveedor desconocido: {1}",
    },
  },
  {
    match: /Veri okunamadi/i,
    messages: {
      tr: "Veri okunamadı (JSON format uyumsuzluğu).",
      en: "Failed to read data (JSON format mismatch).",
      fr: "Échec de lecture des données (format JSON incompatible).",
      es: "No se pudieron leer los datos (formato JSON incompatible).",
    },
  },
  {
    match: /Bu oyun icin build eklenmemis/i,
    messages: {
      tr: "Bu oyun için build eklenmemiş.",
      en: "No build has been added for this game.",
      fr: "Aucun build n'a été ajouté pour ce jeu.",
      es: "No se ha añadido ningún build para este juego.",
    },
  },
  {
    match: /Dosya adi alinamadi/i,
    messages: {
      tr: "Dosya adı alınamadı.",
      en: "Could not read file name.",
      fr: "Impossible de lire le nom du fichier.",
      es: "No se pudo leer el nombre del archivo.",
    },
  },
];

function applyParams(template: string, match: RegExpMatchArray): string {
  return template.replace(/\{(\d+)\}/g, (_, idx) => {
    const n = parseInt(idx, 10);
    return match[n] ?? "";
  });
}

export function translateError(raw: unknown, language: AppLanguage): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  for (const rule of RULES) {
    const m = text.match(rule.match);
    if (m) {
      return applyParams(rule.messages[language] ?? rule.messages.en, m);
    }
  }
  return text;
}
