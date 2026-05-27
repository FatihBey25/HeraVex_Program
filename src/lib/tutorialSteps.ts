// 9 bölümlü kurulum rehberi — dil bağımsız step yapısı.
//
// Her step bir DOM element seçici (selector) içerir. Spotlight bu elementin
// bounding rect'ini kullanarak ekranda bir delik açar, geri kalan yeri
// karartır. `selector` null ise step "merkez" modunda (full-screen modal)
// gösterilir.
//
// İçerik talebine göre 9 bölüm:
//   1. Hoş geldin
//   2. İlk adımlar (oyun + API anahtarları)
//   3. The Nexus (Store Hub)
//   4. The Forge (Notlar + GDD)
//   5. Görev Merkezi + Takvim
//   6. Cüzdan + Analitik
//   7. Press Kit + Butler
//   8. Ekip Modu (Cloud Sync)
//   9. Çoklu çalışma alanları + geri bildirim daveti

import type { AppLanguage } from "./i18n";
import type { WorkspaceTab } from "../store";

export type TutorialStep = {
  /** Stable identifier, never localized. */
  id: string;
  /** CSS selector for the element to spotlight. null → centered, no spotlight. */
  selector: string | null;
  /** Tab to switch to before showing this step. */
  preferredTab?: WorkspaceTab;
  /** Localized chapter title (shown in step badge). */
  chapter: Record<AppLanguage, string>;
  /** Localized step heading. */
  title: Record<AppLanguage, string>;
  /** Localized body markdown-ish text (line breaks supported via \n). */
  body: Record<AppLanguage, string>;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  // 1 ──────────────────────────────────────────────────────────────────────
  {
    id: "welcome",
    selector: null,
    chapter: {
      tr: "Bölüm 1 / 9",
      en: "Chapter 1 / 9",
      fr: "Chapitre 1 / 9",
      es: "Capítulo 1 / 9",
    },
    title: {
      tr: "HeraVex'e Hoş Geldin",
      en: "Welcome to HeraVex",
      fr: "Bienvenue sur HeraVex",
      es: "Bienvenido a HeraVex",
    },
    body: {
      tr: "HeraVex, indie geliştiriciler için tek pencerede komuta merkezidir. Notion, Trello, Excel ve mağaza panelleri arasında sekme değiştirmeyi bırak — burada her şey tek yerde.\n\nKazanacakların:\n• ZAMAN: Sekme yorgunluğu yok, tek araç.\n• ODAK: Yaratıcı işe konsantre ol, takip kendiliğinden olsun.\n• PROFESYONELLİK: Yayıncılara, basına ve ekibine hep aynı kalitede çıktı.\n\nBu kısa rehber 9 bölümde tüm modülleri gezdirecek. ~3 dakika sürer.",
      en: "HeraVex is a single-window command center for indie game developers. Stop juggling Notion, Trello, Excel and store dashboards — it's all here.\n\nWhat you gain:\n• TIME: No tab fatigue, one tool only.\n• FOCUS: Concentrate on creative work; tracking happens around it.\n• PROFESSIONALISM: Consistent, polished output for publishers, press, and your team.\n\nThis tour walks through every module in 9 chapters. Takes about 3 minutes.",
      fr: "HeraVex est un centre de commande à fenêtre unique pour les développeurs indépendants. Plus besoin de jongler entre Notion, Trello, Excel et les tableaux de bord des boutiques — tout est ici.\n\nCe que vous gagnez :\n• TEMPS : finie la fatigue des onglets.\n• CONCENTRATION : focus sur le créatif, le suivi se fait autour.\n• PROFESSIONNALISME : des livrables cohérents pour éditeurs, presse et équipe.\n\nCe tour couvre chaque module en 9 chapitres. Environ 3 minutes.",
      es: "HeraVex es un centro de mando en una sola ventana para desarrolladores indie. Olvídate de saltar entre Notion, Trello, Excel y paneles de tiendas — todo está aquí.\n\nQué ganas:\n• TIEMPO: sin fatiga de pestañas, una sola herramienta.\n• FOCO: concéntrate en lo creativo, el seguimiento ocurre alrededor.\n• PROFESIONALIDAD: resultados consistentes para publishers, prensa y equipo.\n\nEste recorrido cubre cada módulo en 9 capítulos. Unos 3 minutos.",
    },
  },

  // 2 ──────────────────────────────────────────────────────────────────────
  {
    id: "first-steps",
    selector: '[data-tutorial="nav-library"]',
    preferredTab: "dashboard",
    chapter: {
      tr: "Bölüm 2 / 9",
      en: "Chapter 2 / 9",
      fr: "Chapitre 2 / 9",
      es: "Capítulo 2 / 9",
    },
    title: {
      tr: "İlk Adımlar — Kurulum",
      en: "First Steps — Setup",
      fr: "Premiers pas — Installation",
      es: "Primeros pasos — Instalación",
    },
    body: {
      tr: "Buradaki **Library** sekmesinden ilk oyununu ekle. Bir oyun = bir proje arşivi: build, sürüm, platform, etiket, mağaza eşleşmeleri, görevler, notlar, giderler hepsi tek kayda bağlı.\n\nSonraki adım: **Profil → API Anahtarları**. Steam Web API Key, steamid64, Itch.io API key ve (opsiyonel) Google Play servis hesabı JSON'ı ekle. Bu anahtarlar yalnızca diskinde durur, hiçbir sunucuya gönderilmez.",
      en: "Add your first game from the **Library** tab on the left. A game = a project archive: builds, versions, platforms, tags, store mappings, tasks, notes, expenses — all bound to one record.\n\nNext: **Profile → API Keys**. Add your Steam Web API Key, steamid64, Itch.io API key, and (optionally) the Google Play service account JSON. Keys stay on your disk — never sent to any server.",
      fr: "Ajoutez votre premier jeu depuis l'onglet **Library** à gauche. Un jeu = une archive projet : builds, versions, plateformes, tags, liens boutiques, tâches, notes, dépenses — tout est lié à un seul enregistrement.\n\nEnsuite : **Profil → Clés API**. Ajoutez votre clé Steam Web API, steamid64, clé Itch.io, et (en option) le JSON du compte de service Google Play. Les clés restent sur votre disque.",
      es: "Añade tu primer juego desde la pestaña **Library** a la izquierda. Un juego = un archivo de proyecto: builds, versiones, plataformas, etiquetas, vínculos de tienda, tareas, notas, gastos — todo unido a un registro.\n\nSiguiente: **Perfil → Claves API**. Añade tu Steam Web API Key, steamid64, clave Itch.io y (opcional) el JSON de cuenta de servicio de Google Play. Las claves se quedan en tu disco.",
    },
  },

  // 3 ──────────────────────────────────────────────────────────────────────
  {
    id: "the-nexus",
    selector: '[data-tutorial="nav-storehub"]',
    preferredTab: "storehub",
    chapter: {
      tr: "Bölüm 3 / 9",
      en: "Chapter 3 / 9",
      fr: "Chapitre 3 / 9",
      es: "Capítulo 3 / 9",
    },
    title: {
      tr: "The Nexus — Mağaza Merkezi",
      en: "The Nexus — Store Hub",
      fr: "Le Nexus — Centre boutiques",
      es: "El Nexus — Centro de tiendas",
    },
    body: {
      tr: "**The Nexus** tüm mağazalarındaki canlı veriyi tek ekranda toplar:\n• **Wishlist** — Steam (yayın öncesi)\n• **İndirme / Satış** — Itch.io, Google Play\n• **CCU** — Steam anlık oyuncu sayısı (resmi API)\n• **Gelir & Puan** — mağaza bazlı dağılım\n• **Son haber** — Steam community announcement'larını çeker\n\nHer oyunu Library içinden **Store Sync** sekmesinde eşleştir, geri kalanı Nexus halleder.",
      en: "**The Nexus** aggregates live data from every store into one screen:\n• **Wishlist** — Steam (pre-release)\n• **Downloads / Sales** — Itch.io, Google Play\n• **CCU** — Steam concurrent players (official API)\n• **Revenue & Rating** — broken down per store\n• **Latest news** — pulls Steam community announcements\n\nMap each game inside Library → **Store Sync** tab; Nexus handles the rest.",
      fr: "**Le Nexus** rassemble les données en direct de chaque boutique dans un seul écran :\n• **Wishlist** — Steam (avant sortie)\n• **Téléchargements / Ventes** — Itch.io, Google Play\n• **CCU** — joueurs simultanés Steam (API officielle)\n• **Revenus & Note** — répartis par boutique\n• **Dernière actu** — annonces de la communauté Steam\n\nLiez chaque jeu dans Library → onglet **Store Sync** ; le Nexus s'occupe du reste.",
      es: "**El Nexus** agrega datos en vivo de cada tienda en una sola pantalla:\n• **Wishlist** — Steam (prelanzamiento)\n• **Descargas / Ventas** — Itch.io, Google Play\n• **CCU** — jugadores concurrentes Steam (API oficial)\n• **Ingresos y Puntuación** — desglose por tienda\n• **Última noticia** — anuncios de la comunidad Steam\n\nVincula cada juego en Library → pestaña **Store Sync**; el Nexus se encarga del resto.",
    },
  },

  // 4 ──────────────────────────────────────────────────────────────────────
  {
    id: "the-forge",
    selector: '[data-tutorial="nav-notes"]',
    preferredTab: "notes",
    chapter: {
      tr: "Bölüm 4 / 9",
      en: "Chapter 4 / 9",
      fr: "Chapitre 4 / 9",
      es: "Capítulo 4 / 9",
    },
    title: {
      tr: "The Forge — Notlar ve GDD",
      en: "The Forge — Notes & GDD",
      fr: "The Forge — Notes et GDD",
      es: "The Forge — Notas y GDD",
    },
    body: {
      tr: "Notion'u bırak. **The Forge** markdown editörü:\n• Canlı önizleme — yazdıkça görüyorsun.\n• GDD şablonları — Game Design Document, haftalık yol haritası, toplantı notu.\n• Kategori filtresi + arama.\n• **Tek tıkla profesyonel PDF dışa aktarımı** — başlık sayfası, sayfa numarası, kategori footer'ı dahil.\n\nHer oyunun Library → **Notes** sekmesinde de kendi GDD'si vardır; ayrıca burada serbest notlar tutulur.",
      en: "Drop Notion. **The Forge** markdown editor:\n• Live preview — see what you type.\n• GDD templates — Game Design Document, weekly roadmap, meeting notes.\n• Category filter + search.\n• **One-click professional PDF export** — title page, page numbers, category footer.\n\nEach game also has its own GDD inside Library → **Notes** tab; this center is for cross-project notes.",
      fr: "Lâchez Notion. **The Forge**, éditeur markdown :\n• Aperçu en direct.\n• Modèles GDD — Game Design Document, roadmap hebdomadaire, notes de réunion.\n• Filtre par catégorie + recherche.\n• **Export PDF pro en un clic** — page de titre, numéros de page, pied de catégorie.\n\nChaque jeu a aussi son GDD dans Library → onglet **Notes** ; ce centre concerne les notes transverses.",
      es: "Deja Notion. **The Forge**, editor markdown:\n• Vista previa en vivo.\n• Plantillas de GDD — Game Design Document, roadmap semanal, actas.\n• Filtro por categoría + búsqueda.\n• **Exportación PDF profesional con un clic** — portada, numeración, pie por categoría.\n\nCada juego tiene además su propio GDD en Library → pestaña **Notes**; este centro es para notas transversales.",
    },
  },

  // 5 ──────────────────────────────────────────────────────────────────────
  {
    id: "tasks-calendar",
    selector: '[data-tutorial="nav-tasks"]',
    preferredTab: "tasks",
    chapter: {
      tr: "Bölüm 5 / 9",
      en: "Chapter 5 / 9",
      fr: "Chapitre 5 / 9",
      es: "Capítulo 5 / 9",
    },
    title: {
      tr: "Görev Merkezi ve Takvim",
      en: "Task Center & Calendar",
      fr: "Centre des tâches et Calendrier",
      es: "Centro de tareas y Calendario",
    },
    body: {
      tr: "**Görev Merkezi** iki görünüm sunar:\n• **Liste** — tüm görevler tek akışta; oyuna göre filtre, öncelik, deadline.\n• **Kanban** — düşük / orta / yüksek / tamamlandı sütunları.\n\nGörevleri Notlar'daki belirli başlıklara bağlayabilirsin — \"Bu görev GDD'nin Karakterler bölümüne ait\" gibi.\n\n**Takvim** sekmesi (sol menü) görev deadline'larını ay görünümünde gösterir; Acil ve Kilometre Taşı filtreleri var.\n\nKlavye: `T` ile Görev Merkezi'ne hızlı atla.",
      en: "**Task Center** offers two views:\n• **List** — all tasks in one stream; filter by game, priority, due date.\n• **Kanban** — low / medium / high / done columns.\n\nLink a task to a specific heading inside your Notes — e.g. \"This task belongs to the Characters section of the GDD\".\n\nThe **Calendar** tab (left menu) shows task due dates on a month view; Urgent and Milestone filters are built in.\n\nKeyboard: press `T` to jump straight to Tasks.",
      fr: "**Centre des tâches**, deux vues :\n• **Liste** — toutes les tâches dans un flux ; filtres par jeu, priorité, échéance.\n• **Kanban** — colonnes basse / moyenne / haute / terminée.\n\nReliez une tâche à un titre précis dans vos Notes — ex. « Cette tâche appartient à la section Personnages du GDD ».\n\nL'onglet **Calendrier** (menu de gauche) affiche les échéances en vue mensuelle ; filtres Urgent et Jalon inclus.\n\nClavier : `T` pour ouvrir directement les Tâches.",
      es: "**Centro de tareas** ofrece dos vistas:\n• **Lista** — todas las tareas en un flujo; filtros por juego, prioridad, fecha.\n• **Kanban** — columnas baja / media / alta / hecha.\n\nVincula una tarea a un encabezado específico de tus Notas — p. ej. \"Esta tarea pertenece a la sección Personajes del GDD\".\n\nLa pestaña **Calendario** (menú izquierdo) muestra los vencimientos en vista mensual; filtros Urgente e Hito incluidos.\n\nTeclado: pulsa `T` para abrir Tareas directamente.",
    },
  },

  // 6 ──────────────────────────────────────────────────────────────────────
  {
    id: "wallet-analytics",
    selector: '[data-tutorial="nav-wallet"]',
    preferredTab: "wallet",
    chapter: {
      tr: "Bölüm 6 / 9",
      en: "Chapter 6 / 9",
      fr: "Chapitre 6 / 9",
      es: "Capítulo 6 / 9",
    },
    title: {
      tr: "Cüzdan ve Analitik — Mali Yönetim",
      en: "Wallet & Analytics — Financials",
      fr: "Portefeuille et Analytique — Finances",
      es: "Cartera y Analíticas — Finanzas",
    },
    body: {
      tr: "**Cüzdan** giderleri kategorize eder (Asset, Lisans, Pazarlama, Donanım…) ve proje başına bütçe tutar. Tekrarlayan giderler (örn. aylık lisans) için işaretleme var.\n\n**Analitik** sekmesi şunları üretir:\n• Yayıncı sunumu için **UTF-8 BOM destekli CSV** (Excel TR karakterleri doğru gösterir).\n• Profesyonel **PDF mali rapor** — gelir/gider özeti, kategori dağılımı, ROI.\n• JSON export — başka araçlara aktarım.\n\n\"Bu oyuna ne kadar harcadım, ne kadar kazandım?\" sorusu artık 5 saniyede yanıt buluyor.",
      en: "**Wallet** categorizes expenses (Assets, Licenses, Marketing, Hardware…) and tracks budget per project. Recurring expenses (e.g. monthly license) can be flagged.\n\nThe **Analytics** tab produces:\n• Publisher-grade **CSV with UTF-8 BOM** (Excel renders non-ASCII chars correctly).\n• Polished **PDF financial report** — revenue/expense summary, category breakdown, ROI.\n• JSON export — for downstream tooling.\n\n\"How much did I spend on this game, and how much did I earn?\" — answered in 5 seconds.",
      fr: "**Portefeuille** catégorise les dépenses (Assets, Licences, Marketing, Matériel…) et suit le budget par projet. Les dépenses récurrentes (ex. licence mensuelle) peuvent être marquées.\n\nL'onglet **Analytique** produit :\n• **CSV UTF-8 BOM** prêt pour éditeur (Excel affiche les accents correctement).\n• **Rapport financier PDF** soigné — résumé revenus/dépenses, répartition par catégorie, ROI.\n• Export JSON pour les outils en aval.\n\n« Combien j'ai dépensé sur ce jeu, et combien j'ai gagné ? » — réponse en 5 secondes.",
      es: "**Cartera** categoriza gastos (Assets, Licencias, Marketing, Hardware…) y lleva el presupuesto por proyecto. Los gastos recurrentes (p. ej. licencia mensual) se marcan.\n\nLa pestaña **Analíticas** genera:\n• **CSV con UTF-8 BOM** apto para publishers (Excel muestra acentos correctamente).\n• **Informe financiero PDF** pulido — resumen ingresos/gastos, desglose por categoría, ROI.\n• Exportación JSON para flujos posteriores.\n\n\"¿Cuánto gasté en este juego y cuánto gané?\" — respuesta en 5 segundos.",
    },
  },

  // 7 ──────────────────────────────────────────────────────────────────────
  {
    id: "presskit-butler",
    selector: '[data-tutorial="nav-library"]',
    preferredTab: "library",
    chapter: {
      tr: "Bölüm 7 / 9",
      en: "Chapter 7 / 9",
      fr: "Chapitre 7 / 9",
      es: "Capítulo 7 / 9",
    },
    title: {
      tr: "PR ve Dağıtım — Press Kit & Butler",
      en: "PR & Distribution — Press Kit & Butler",
      fr: "RP et Distribution — Press Kit & Butler",
      es: "RR.PP. y Distribución — Press Kit y Butler",
    },
    body: {
      tr: "Bir oyun seç, **Release** sekmesini aç:\n• **Press Kit oluştur** — tek tıkla dopresskit standartlarına uygun HTML basın kiti üretir (oyun bilgisi, ekran görüntüleri, iletişim, sosyal linkler). Gazetecilere hazır şekilde gönderebilirsin.\n• **Itch.io Butler entegrasyonu** — Butler PATH'inde ise build klasörünü doğrudan Itch.io'ya push'lar. Loglar canlı olarak alttaki panele akar.\n• **Steam çıkış checklist'i** — capsule art, store copy, screenshot, trailer, build upload, final QA. Şablon özelleştirilebilir.",
      en: "Pick a game, open its **Release** tab:\n• **Generate Press Kit** — produces a one-click dopresskit-style HTML kit (game info, screenshots, contact, social links). Ready to send to journalists.\n• **Itch.io Butler integration** — if Butler is on your PATH, pushes your build folder straight to Itch.io. Logs stream live into the panel below.\n• **Steam launch checklist** — capsule art, store copy, screenshots, trailer, build upload, final QA. Template is customizable.",
      fr: "Choisissez un jeu, ouvrez son onglet **Release** :\n• **Générer Press Kit** — produit en un clic un kit HTML façon dopresskit (infos du jeu, captures, contact, liens sociaux). Prêt à envoyer aux journalistes.\n• **Intégration Itch.io Butler** — si Butler est dans votre PATH, pousse votre dossier de build directement sur Itch.io. Les logs défilent en direct dans le panneau du dessous.\n• **Checklist de sortie Steam** — capsule art, textes store, captures, trailer, upload build, QA finale. Le modèle est personnalisable.",
      es: "Elige un juego, abre su pestaña **Release**:\n• **Generar Press Kit** — produce en un clic un kit HTML estilo dopresskit (info del juego, capturas, contacto, redes). Listo para enviar a prensa.\n• **Integración Itch.io Butler** — si Butler está en tu PATH, publica tu carpeta de build directamente en Itch.io. Los logs aparecen en vivo en el panel inferior.\n• **Checklist de lanzamiento Steam** — capsule art, textos de tienda, capturas, trailer, subida de build, QA final. Plantilla personalizable.",
    },
  },

  // 8 ──────────────────────────────────────────────────────────────────────
  {
    id: "team-mode",
    selector: '[data-tutorial="nav-profile"]',
    preferredTab: "profile",
    chapter: {
      tr: "Bölüm 8 / 9",
      en: "Chapter 8 / 9",
      fr: "Chapitre 8 / 9",
      es: "Capítulo 8 / 9",
    },
    title: {
      tr: "Ekip Modu — Cloud Sync",
      en: "Team Mode — Cloud Sync",
      fr: "Mode équipe — Synchro Cloud",
      es: "Modo equipo — Sincronización en la nube",
    },
    body: {
      tr: "Küçük ekipler için sunucu maliyeti yok: **Profil → Ekip Modu**'nda Dropbox veya Google Drive klasörünü seç. HeraVex tüm veriyi oraya yazar.\n\n**Atomic Storage**: Her oyun ve not kendi `id.json` dosyasında — aynı anda çalışan iki kişi farklı oyunları düzenliyorsa çakışma olmaz. Aynı oyunda çakışma olursa toast bildirir, son halini görürsün.\n\nKlasörü değiştirdiğinde uygulama yeniden yüklenir, yeni alandan başlar. Önceki yerel veriyi etkilemez — geri dönmek için \"Yerele döndür\" yeter.",
      en: "No server cost for small teams: in **Profile → Team Mode**, pick a Dropbox or Google Drive folder. HeraVex writes all data there.\n\n**Atomic Storage**: each game and note lives in its own `id.json` file — two people editing different games simultaneously never conflict. If you do edit the same game, a toast notifies you and you see the final state.\n\nSwitching folders reloads the app onto the new workspace. Your previous local data stays untouched — \"Reset to local\" brings it back.",
      fr: "Pas de coût serveur pour les petites équipes : dans **Profil → Mode équipe**, choisissez un dossier Dropbox ou Google Drive. HeraVex y écrit toutes les données.\n\n**Stockage atomique** : chaque jeu et chaque note dans son propre fichier `id.json` — deux personnes éditant des jeux différents en même temps n'entrent jamais en conflit. Si vous éditez le même jeu, un toast vous prévient et vous voyez l'état final.\n\nChanger de dossier recharge l'app sur le nouvel espace. Vos données locales précédentes restent intactes — « Réinitialiser au local » les ramène.",
      es: "Sin coste de servidor para equipos pequeños: en **Perfil → Modo equipo**, elige una carpeta de Dropbox o Google Drive. HeraVex escribe todos los datos ahí.\n\n**Almacenamiento atómico**: cada juego y nota vive en su propio archivo `id.json` — dos personas editando juegos distintos nunca colisionan. Si editan el mismo juego, un toast lo avisa y ves el estado final.\n\nCambiar de carpeta recarga la app sobre el nuevo espacio. Tus datos locales previos quedan intactos — \"Restablecer a local\" los recupera.",
    },
  },

  // 9 ──────────────────────────────────────────────────────────────────────
  {
    id: "workspaces",
    // Sidebar brand button doubles as the workspace switcher dropdown
    selector: '.sidebar-brand-button',
    preferredTab: "dashboard",
    chapter: {
      tr: "Bölüm 9 / 9",
      en: "Chapter 9 / 9",
      fr: "Chapitre 9 / 9",
      es: "Capítulo 9 / 9",
    },
    title: {
      tr: "Çoklu Çalışma Alanları",
      en: "Multiple Workspaces",
      fr: "Espaces de travail multiples",
      es: "Espacios de trabajo múltiples",
    },
    body: {
      tr: "Sol üst köşedeki **HeraVex rozetine** tıklayarak çalışma alanı menüsünü aç. Birden fazla bağımsız stüdyo, takım veya kişisel oyun seti tutabilirsin.\n\n• **+ Yeni Workspace** — sıfırdan ayrı bir veri deposu aç (örn. iş projeleri ve kişisel projeler ayrı).\n• **Workspace listesi** — aktif olan yeşil noktayla işaretli; tek tıkla geç.\n• Her workspace kendi `games/`, `notes/`, `library/` klasörünü tutar; veriler hiçbir zaman karışmaz.\n\nİpucu: Her workspace'i istersen Dropbox/Drive'da farklı bir klasöre yönlendirerek ekiplere göre ayrı paylaşım yapabilirsin.\n\n📬 **Geri bildirim çok değerli.** Bir sorun, fikir veya özellik isteği için bize ulaş: **support@heravex.app**\n\nHazırsın. İyi geliştirmeler! 🎮",
      en: "Click the **HeraVex badge** at the top-left to open the workspace switcher. You can keep multiple independent studios, teams or personal game sets here.\n\n• **+ New Workspace** — spin up a fresh data store from scratch (e.g. work projects vs personal projects).\n• **Workspace list** — the active one is marked with a green dot; one click to switch.\n• Each workspace owns its own `games/`, `notes/`, `library/` folders — data never bleeds across.\n\nTip: route each workspace at a different Dropbox/Drive folder to share with different teams independently.\n\n📬 **We love feedback.** Found a bug, have an idea, or wish a feature existed? Reach us at **support@heravex.app**\n\nYou're set. Happy shipping! 🎮",
      fr: "Cliquez sur le **badge HeraVex** en haut à gauche pour ouvrir le sélecteur d'espace de travail. Vous pouvez gérer plusieurs studios, équipes ou ensembles personnels indépendants.\n\n• **+ Nouveau Workspace** — créez un nouveau dépôt de données vierge (ex. projets pro vs persos).\n• **Liste des workspaces** — l'actif est marqué d'un point vert ; un clic pour basculer.\n• Chaque workspace possède ses propres dossiers `games/`, `notes/`, `library/` — les données ne se mélangent jamais.\n\nAstuce : pointez chaque workspace vers un dossier Dropbox/Drive distinct pour partager avec des équipes différentes en toute indépendance.\n\n📬 **Vos retours sont précieux.** Un bug, une idée, une fonctionnalité souhaitée ? Écrivez-nous à **support@heravex.app**\n\nC'est parti. Bon dev ! 🎮",
      es: "Haz clic en el **distintivo HeraVex** arriba a la izquierda para abrir el selector de espacios de trabajo. Puedes mantener varios estudios, equipos o conjuntos personales independientes.\n\n• **+ Nuevo Workspace** — crea un repositorio de datos desde cero (p. ej. proyectos del trabajo vs personales).\n• **Lista de workspaces** — el activo está marcado con un punto verde; un clic para cambiar.\n• Cada workspace tiene sus propias carpetas `games/`, `notes/`, `library/` — los datos nunca se mezclan.\n\nConsejo: apunta cada workspace a una carpeta Dropbox/Drive distinta para compartir con equipos distintos de forma independiente.\n\n📬 **Tu opinión importa.** ¿Un bug, una idea, una función que te gustaría? Escríbenos a **support@heravex.app**\n\nListo. ¡Buen desarrollo! 🎮",
    },
  },
];

// Localized UI labels used by the overlay shell itself.
export const TUTORIAL_UI: Record<
  AppLanguage,
  {
    next: string;
    back: string;
    skip: string;
    finish: string;
    startTitle: string;
    progressOf: (i: number, n: number) => string;
  }
> = {
  tr: {
    next: "İleri",
    back: "Geri",
    skip: "Atla",
    finish: "Bitir",
    startTitle: "Rehberi Yeniden Başlat",
    progressOf: (i, n) => `${i} / ${n}`,
  },
  en: {
    next: "Next",
    back: "Back",
    skip: "Skip",
    finish: "Finish",
    startTitle: "Restart Tutorial",
    progressOf: (i, n) => `${i} / ${n}`,
  },
  fr: {
    next: "Suivant",
    back: "Retour",
    skip: "Passer",
    finish: "Terminer",
    startTitle: "Recommencer le tutoriel",
    progressOf: (i, n) => `${i} / ${n}`,
  },
  es: {
    next: "Siguiente",
    back: "Atrás",
    skip: "Saltar",
    finish: "Terminar",
    startTitle: "Reiniciar tutorial",
    progressOf: (i, n) => `${i} / ${n}`,
  },
};
