// Notlar için merkezi şablon kütüphanesi.
//
// Şablonlar 4 dilde tutulur (en/tr/fr/es). Yeni şablon eklerken her dilin
// `build` fonksiyonunu doldurmak gerekir — eksik dil, fallback olarak en'i
// kullanır (bk. `getGlobalTemplates`).
//
// İki kategori:
//   • Global şablonlar — NoteCenter'da serbest not seçildiğinde kullanılır
//     (proje bağlamı yok).
//   • Game şablonları — bir oyun seçildiğinde kullanılır; oyun başlığı build
//     fonksiyonuna geçirilir.

import type { AppLanguage } from "./i18n";

export type NoteTemplate = {
  id: string;
  label: Record<AppLanguage, string>;
  /** Returns the initial markdown for the template, in the requested language. */
  build: Record<AppLanguage, () => string>;
};

export type GameNoteTemplate = {
  id: string;
  label: Record<AppLanguage, string>;
  build: Record<AppLanguage, (gameTitle: string) => string>;
};

const today = () => new Date().toLocaleDateString();

// ─── Global templates ───────────────────────────────────────────────────

export const GLOBAL_TEMPLATES: NoteTemplate[] = [
  // 1. Concept Ideas
  {
    id: "concept",
    label: { en: "Concept Ideas", tr: "Konsept Fikirleri", fr: "Idées de concept", es: "Ideas de concepto" },
    build: {
      en: () => `# Concept Ideas

> ${today()} · Studio Knowledge Base

## Seed
- **One-liner:**
- **Why now?**
- **Inspiration:**

## Themes & Moods
- Theme:
- Mood:
- References:

## Mechanics to Try
- [ ] Idea 1
- [ ] Idea 2

\`\`\`text
[Spark] → [Test] → [Keep / Kill]
\`\`\`

## Next Step
- _What's the smallest experiment to validate this?_
`,
      tr: () => `# Konsept Fikirleri

> ${today()} · Stüdyo Bilgi Tabanı

## Tohum
- **Tek cümle:**
- **Neden şimdi?**
- **İlham:**

## Tema ve Atmosfer
- Tema:
- Atmosfer:
- Referanslar:

## Denenecek Mekanikler
- [ ] Fikir 1
- [ ] Fikir 2

\`\`\`text
[Kıvılcım] → [Test] → [Sakla / At]
\`\`\`

## Sonraki Adım
- _Bu fikri doğrulamak için en küçük deney ne?_
`,
      fr: () => `# Idées de concept

> ${today()} · Base de connaissances du studio

## Germe
- **Pitch :**
- **Pourquoi maintenant ?**
- **Inspiration :**

## Thèmes et ambiances
- Thème :
- Ambiance :
- Références :

## Mécaniques à tester
- [ ] Idée 1
- [ ] Idée 2

\`\`\`text
[Étincelle] → [Test] → [Garder / Tuer]
\`\`\`

## Prochaine étape
- _Quelle est la plus petite expérience pour valider ?_
`,
      es: () => `# Ideas de concepto

> ${today()} · Base de conocimiento del estudio

## Semilla
- **Pitch:**
- **¿Por qué ahora?**
- **Inspiración:**

## Temas y atmósferas
- Tema:
- Atmósfera:
- Referencias:

## Mecánicas a probar
- [ ] Idea 1
- [ ] Idea 2

\`\`\`text
[Chispa] → [Test] → [Guardar / Descartar]
\`\`\`

## Próximo paso
- _¿Cuál es el experimento más pequeño para validarlo?_
`,
    },
  },

  // 2. Meeting Notes
  {
    id: "meeting",
    label: { en: "Meeting Notes", tr: "Toplantı Notları", fr: "Notes de réunion", es: "Notas de reunión" },
    build: {
      en: () => `# Meeting Notes — ${today()}

> Studio Knowledge Base

## Attendees
-

## Agenda
1.
2.
3.

## Discussion
-

## Decisions
- [ ]
- [ ]

## Action Items
| Owner | Task | Due |
| --- | --- | --- |
|  |  |  |

## Follow-up
- _Next meeting:_
`,
      tr: () => `# Toplantı Notları — ${today()}

> Stüdyo Bilgi Tabanı

## Katılımcılar
-

## Gündem
1.
2.
3.

## Tartışma
-

## Kararlar
- [ ]
- [ ]

## Aksiyon Öğeleri
| Sorumlu | Görev | Termin |
| --- | --- | --- |
|  |  |  |

## Takip
- _Sonraki toplantı:_
`,
      fr: () => `# Notes de réunion — ${today()}

> Base de connaissances du studio

## Participants
-

## Ordre du jour
1.
2.
3.

## Discussion
-

## Décisions
- [ ]
- [ ]

## Actions à mener
| Responsable | Tâche | Échéance |
| --- | --- | --- |
|  |  |  |

## Suivi
- _Prochaine réunion :_
`,
      es: () => `# Notas de reunión — ${today()}

> Base de conocimiento del estudio

## Asistentes
-

## Agenda
1.
2.
3.

## Discusión
-

## Decisiones
- [ ]
- [ ]

## Acciones
| Responsable | Tarea | Fecha |
| --- | --- | --- |
|  |  |  |

## Seguimiento
- _Próxima reunión:_
`,
    },
  },

  // 3. Weekly Roadmap
  {
    id: "roadmap",
    label: { en: "Weekly Roadmap", tr: "Haftalık Yol Haritası", fr: "Roadmap hebdomadaire", es: "Roadmap semanal" },
    build: {
      en: () => `# Weekly Roadmap — Week of ${today()}

> Studio Knowledge Base

## North Star
_What's the single most important outcome this week?_

## Themes
- **Production:**
- **Design:**
- **Marketing:**

## Mon → Fri
- [ ] Mon ·
- [ ] Tue ·
- [ ] Wed ·
- [ ] Thu ·
- [ ] Fri ·

## Risks & Blockers
-

## Wins to Celebrate
-

## Retro Note
- _What changed since last week's plan?_
`,
      tr: () => `# Haftalık Yol Haritası — ${today()} Haftası

> Stüdyo Bilgi Tabanı

## Kuzey Yıldızı
_Bu hafta en kritik tek hedef ne?_

## Temalar
- **Yapım:**
- **Tasarım:**
- **Pazarlama:**

## Pzt → Cum
- [ ] Pzt ·
- [ ] Sal ·
- [ ] Çar ·
- [ ] Per ·
- [ ] Cum ·

## Riskler ve Engeller
-

## Kutlanacak Kazanımlar
-

## Retro Notu
- _Geçen haftaki plana göre ne değişti?_
`,
      fr: () => `# Roadmap hebdomadaire — Semaine du ${today()}

> Base de connaissances du studio

## Étoile polaire
_Quel est le résultat le plus important de la semaine ?_

## Thèmes
- **Production :**
- **Design :**
- **Marketing :**

## Lun → Ven
- [ ] Lun ·
- [ ] Mar ·
- [ ] Mer ·
- [ ] Jeu ·
- [ ] Ven ·

## Risques & blocages
-

## Victoires à célébrer
-

## Note rétro
- _Qu'est-ce qui a changé depuis le plan de la semaine dernière ?_
`,
      es: () => `# Roadmap semanal — Semana del ${today()}

> Base de conocimiento del estudio

## Estrella polar
_¿Cuál es el resultado más importante esta semana?_

## Temas
- **Producción:**
- **Diseño:**
- **Marketing:**

## Lun → Vie
- [ ] Lun ·
- [ ] Mar ·
- [ ] Mié ·
- [ ] Jue ·
- [ ] Vie ·

## Riesgos y bloqueos
-

## Victorias para celebrar
-

## Nota retro
- _¿Qué cambió desde el plan de la semana pasada?_
`,
    },
  },

  // 4. Bug Report
  {
    id: "bug",
    label: { en: "Bug Report", tr: "Hata Raporu", fr: "Rapport de bug", es: "Informe de bug" },
    build: {
      en: () => `# Bug Report — ${today()}

## Summary
_One-sentence description of the bug._

## Environment
- **Build:**
- **OS / Device:**
- **Hardware:**
- **GPU:**

## Steps to Reproduce
1.
2.
3.

## Expected
_What should happen?_

## Actual
_What actually happens?_

## Severity
- [ ] Crash / Data loss
- [ ] Blocker
- [ ] Major
- [ ] Minor
- [ ] Cosmetic

## Repro Rate
- [ ] 100%
- [ ] Intermittent
- [ ] Once

## Attachments
- _Screenshots, video, log file:_

## Notes
-
`,
      tr: () => `# Hata Raporu — ${today()}

## Özet
_Hatayı tek cümle ile anlat._

## Ortam
- **Build:**
- **İşletim Sistemi / Cihaz:**
- **Donanım:**
- **GPU:**

## Tekrarlatma Adımları
1.
2.
3.

## Beklenen
_Ne olmalıydı?_

## Gerçekleşen
_Aslında ne oldu?_

## Şiddet
- [ ] Çökme / Veri kaybı
- [ ] Engelleyici
- [ ] Büyük
- [ ] Küçük
- [ ] Kozmetik

## Tekrarlanabilirlik
- [ ] %100
- [ ] Ara sıra
- [ ] Bir kez

## Ek Dosyalar
- _Ekran görüntüsü, video, log:_

## Notlar
-
`,
      fr: () => `# Rapport de bug — ${today()}

## Résumé
_Une phrase décrivant le bug._

## Environnement
- **Build :**
- **OS / Appareil :**
- **Matériel :**
- **GPU :**

## Étapes de reproduction
1.
2.
3.

## Attendu
_Que devrait-il se passer ?_

## Réel
_Que se passe-t-il en réalité ?_

## Gravité
- [ ] Crash / Perte de données
- [ ] Bloquant
- [ ] Majeur
- [ ] Mineur
- [ ] Cosmétique

## Taux de reproduction
- [ ] 100%
- [ ] Intermittent
- [ ] Une fois

## Pièces jointes
- _Captures, vidéo, journal :_

## Notes
-
`,
      es: () => `# Informe de bug — ${today()}

## Resumen
_Descripción del bug en una frase._

## Entorno
- **Build:**
- **SO / Dispositivo:**
- **Hardware:**
- **GPU:**

## Pasos para reproducir
1.
2.
3.

## Esperado
_¿Qué debería pasar?_

## Actual
_¿Qué pasa realmente?_

## Severidad
- [ ] Crash / Pérdida de datos
- [ ] Bloqueante
- [ ] Mayor
- [ ] Menor
- [ ] Cosmético

## Tasa de reproducción
- [ ] 100%
- [ ] Intermitente
- [ ] Una vez

## Adjuntos
- _Capturas, vídeo, log:_

## Notas
-
`,
    },
  },

  // 5. Post-mortem
  {
    id: "postmortem",
    label: { en: "Post-mortem", tr: "Post-mortem", fr: "Post-mortem", es: "Post-mortem" },
    build: {
      en: () => `# Post-mortem — ${today()}

> Honest retrospective. Blameless. Focus on systems, not people.

## Project / Milestone
- **Name:**
- **Duration:**
- **Outcome:**

## What Went Right
1.
2.
3.

## What Went Wrong
1.
2.
3.

## What We Learned
-

## Root Causes
- _Use 5 Whys — drill past symptoms._

## Action Items
| # | Action | Owner | Due |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |

## Numbers
- **Planned vs actual scope:**
- **Planned vs actual duration:**
- **Budget burn:**

## Quotes / Anecdotes
> _Memorable moments that crystallise the lesson._
`,
      tr: () => `# Post-mortem — ${today()}

> Dürüst geriye dönük inceleme. Suçsuz. Kişilere değil sisteme odaklan.

## Proje / Kilometre Taşı
- **Ad:**
- **Süre:**
- **Sonuç:**

## İyi Giden
1.
2.
3.

## Yanlış Giden
1.
2.
3.

## Öğrendiklerimiz
-

## Temel Sebepler
- _5 Neden tekniği — semptomdan geç._

## Aksiyon Öğeleri
| # | Aksiyon | Sorumlu | Termin |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |

## Sayılar
- **Planlanan vs gerçekleşen kapsam:**
- **Planlanan vs gerçekleşen süre:**
- **Bütçe harcaması:**

## Alıntılar / Anekdotlar
> _Dersi kristalleştiren akılda kalan anlar._
`,
      fr: () => `# Post-mortem — ${today()}

> Rétrospective honnête. Sans blâme. Focus sur les systèmes.

## Projet / Jalon
- **Nom :**
- **Durée :**
- **Résultat :**

## Ce qui a bien marché
1.
2.
3.

## Ce qui n'a pas marché
1.
2.
3.

## Ce que nous avons appris
-

## Causes racines
- _Utiliser les 5 pourquoi._

## Actions
| # | Action | Responsable | Échéance |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |

## Chiffres
- **Périmètre prévu vs réel :**
- **Durée prévue vs réelle :**
- **Budget consommé :**

## Citations / Anecdotes
> _Moments marquants qui résument la leçon._
`,
      es: () => `# Post-mortem — ${today()}

> Retrospectiva honesta. Sin culpas. Foco en los sistemas.

## Proyecto / Hito
- **Nombre:**
- **Duración:**
- **Resultado:**

## Lo que salió bien
1.
2.
3.

## Lo que salió mal
1.
2.
3.

## Lo que aprendimos
-

## Causas raíz
- _Usar los 5 porqués._

## Acciones
| # | Acción | Responsable | Fecha |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |

## Números
- **Alcance previsto vs real:**
- **Duración prevista vs real:**
- **Presupuesto consumido:**

## Citas / Anécdotas
> _Momentos clave que cristalizan la lección._
`,
    },
  },

  // 6. Sprint Retrospective
  {
    id: "retro",
    label: { en: "Sprint Retro", tr: "Sprint Retro", fr: "Rétro de sprint", es: "Retro de sprint" },
    build: {
      en: () => `# Sprint Retrospective — ${today()}

## Sprint Window
- **From:**
- **To:**
- **Team:**

## 😀 Start
_Things we should start doing._
-

## 😐 Stop
_Things we should stop doing._
-

## 🚀 Continue
_Things working well — keep doing._
-

## Improvements This Sprint
- [ ]
- [ ]

## Carry-over to Next Sprint
- [ ]
- [ ]

## Team Vibe
- Energy: ★★★☆☆
- Workload: ★★★★☆
- Morale: ★★★☆☆
`,
      tr: () => `# Sprint Retrospektifi — ${today()}

## Sprint Aralığı
- **Başlangıç:**
- **Bitiş:**
- **Takım:**

## 😀 Başla
_Başlamamız gereken şeyler._
-

## 😐 Durdur
_Yapmayı bırakmamız gereken şeyler._
-

## 🚀 Devam
_İyi giden şeyler — devam._
-

## Bu Sprint İyileştirmeleri
- [ ]
- [ ]

## Sonraki Sprint'e Devreden
- [ ]
- [ ]

## Takım Havası
- Enerji: ★★★☆☆
- İş yükü: ★★★★☆
- Moral: ★★★☆☆
`,
      fr: () => `# Rétrospective de sprint — ${today()}

## Période
- **Début :**
- **Fin :**
- **Équipe :**

## 😀 Commencer
_Choses à commencer._
-

## 😐 Arrêter
_Choses à arrêter._
-

## 🚀 Continuer
_Choses qui marchent._
-

## Améliorations
- [ ]
- [ ]

## À reporter
- [ ]
- [ ]

## Ambiance d'équipe
- Énergie : ★★★☆☆
- Charge : ★★★★☆
- Moral : ★★★☆☆
`,
      es: () => `# Retrospectiva de sprint — ${today()}

## Periodo
- **Inicio:**
- **Fin:**
- **Equipo:**

## 😀 Empezar
_Cosas que empezar._
-

## 😐 Parar
_Cosas que parar._
-

## 🚀 Continuar
_Cosas que funcionan._
-

## Mejoras
- [ ]
- [ ]

## Pendientes para el próximo sprint
- [ ]
- [ ]

## Ambiente del equipo
- Energía: ★★★☆☆
- Carga: ★★★★☆
- Moral: ★★★☆☆
`,
    },
  },

  // 7. Patch Notes
  {
    id: "patchnotes",
    label: { en: "Patch Notes", tr: "Sürüm Notları", fr: "Notes de patch", es: "Notas de parche" },
    build: {
      en: () => `# Patch Notes — vX.Y.Z

> ${today()}

## ✨ New
-

## ⚡ Improved
-

## 🛠 Fixed
-

## 🔧 Balance
-

## ⚠️ Known Issues
-

---

_Thanks for playing! Drop feedback at support@heravex.app or in our Discord._
`,
      tr: () => `# Sürüm Notları — vX.Y.Z

> ${today()}

## ✨ Yeni
-

## ⚡ İyileştirmeler
-

## 🛠 Düzeltmeler
-

## 🔧 Denge
-

## ⚠️ Bilinen Sorunlar
-

---

_Oynadığınız için teşekkürler! Geri bildirim için support@heravex.app veya Discord._
`,
      fr: () => `# Notes de patch — vX.Y.Z

> ${today()}

## ✨ Nouveau
-

## ⚡ Améliorations
-

## 🛠 Corrections
-

## 🔧 Équilibrage
-

## ⚠️ Problèmes connus
-

---

_Merci d'avoir joué ! Retours à support@heravex.app ou sur notre Discord._
`,
      es: () => `# Notas de parche — vX.Y.Z

> ${today()}

## ✨ Nuevo
-

## ⚡ Mejoras
-

## 🛠 Correcciones
-

## 🔧 Balance
-

## ⚠️ Problemas conocidos
-

---

_¡Gracias por jugar! Comentarios en support@heravex.app o nuestro Discord._
`,
    },
  },

  // 8. Release Checklist
  {
    id: "release-checklist",
    label: { en: "Release Checklist", tr: "Yayın Kontrol Listesi", fr: "Checklist de sortie", es: "Checklist de lanzamiento" },
    build: {
      en: () => `# Release Checklist — ${today()}

> One pass per release. Don't skip; ship boring.

## 🎨 Store Assets
- [ ] Capsule art (all sizes)
- [ ] Header image
- [ ] Screenshots (5+, 1920×1080)
- [ ] Trailer (under 90s)
- [ ] Animated GIF for social

## 📝 Store Copy
- [ ] Short description (≤300 chars)
- [ ] Long description
- [ ] About the game section
- [ ] Feature bullet list
- [ ] System requirements

## 🧪 Build & QA
- [ ] Release build tagged in source control
- [ ] Final smoke test (clean install)
- [ ] Crash reporter wired up
- [ ] Localization sanity check
- [ ] Achievements / cloud saves verified

## 📰 Press & Marketing
- [ ] Press kit uploaded (HeraVex → Press Kit)
- [ ] Press release drafted
- [ ] Email blast to journalist list
- [ ] Streamer / creator codes sent
- [ ] Social media posts scheduled

## 🛒 Storefront
- [ ] Steam release date confirmed
- [ ] Pricing & regional pricing reviewed
- [ ] Achievements published
- [ ] Trailers attached
- [ ] Tags & categories chosen

## 🌐 Channels
- [ ] Website updated
- [ ] Discord announcement drafted
- [ ] Twitter / Bluesky thread ready
- [ ] Reddit launch post drafted

## 🆘 Launch-day Standby
- [ ] On-call dev assigned
- [ ] Hotfix branch ready
- [ ] Support inbox monitored
`,
      tr: () => `# Yayın Kontrol Listesi — ${today()}

> Her yayında bir kez geç. Atlama; sıkıcı şekilde yayınla.

## 🎨 Mağaza Varlıkları
- [ ] Capsule art (tüm boyutlar)
- [ ] Header görseli
- [ ] Ekran görüntüleri (5+, 1920×1080)
- [ ] Fragman (90 sn altı)
- [ ] Sosyal medya için animasyonlu GIF

## 📝 Mağaza Metni
- [ ] Kısa açıklama (≤300 karakter)
- [ ] Uzun açıklama
- [ ] Oyun hakkında bölümü
- [ ] Özellik madde listesi
- [ ] Sistem gereksinimleri

## 🧪 Build & QA
- [ ] Release build kaynak kontrolde etiketlendi
- [ ] Son smoke test (temiz kurulum)
- [ ] Crash reporter bağlandı
- [ ] Yerelleştirme sanity check
- [ ] Achievements / cloud kayıtlar doğrulandı

## 📰 Basın & Pazarlama
- [ ] Press kit yüklendi (HeraVex → Press Kit)
- [ ] Basın bülteni hazır
- [ ] Gazeteci listesine toplu e-posta
- [ ] Yayıncı / içerik üretici kodları gönderildi
- [ ] Sosyal medya postları zamanlandı

## 🛒 Mağaza
- [ ] Steam yayın tarihi onaylandı
- [ ] Fiyatlandırma & bölgesel fiyat incelendi
- [ ] Başarımlar yayında
- [ ] Fragmanlar eklendi
- [ ] Etiket ve kategoriler seçildi

## 🌐 Kanallar
- [ ] Web sitesi güncellendi
- [ ] Discord duyurusu hazır
- [ ] Twitter / Bluesky thread hazır
- [ ] Reddit yayın postu hazır

## 🆘 Çıkış Günü Standby
- [ ] Nöbetçi developer atandı
- [ ] Hotfix branch hazır
- [ ] Destek kutusu izleniyor
`,
      fr: () => `# Checklist de sortie — ${today()}

> Une passe par sortie. Pas d'impasse.

## 🎨 Assets boutique
- [ ] Capsule art (toutes tailles)
- [ ] Image d'en-tête
- [ ] Captures (5+, 1920×1080)
- [ ] Trailer (< 90s)
- [ ] GIF animé social

## 📝 Textes boutique
- [ ] Description courte (≤300 car.)
- [ ] Description longue
- [ ] Section "à propos"
- [ ] Liste de features
- [ ] Configuration requise

## 🧪 Build & QA
- [ ] Build de sortie taggué
- [ ] Smoke test final (install propre)
- [ ] Crash reporter branché
- [ ] Localisation vérifiée
- [ ] Succès / sauvegardes cloud vérifiés

## 📰 Presse & marketing
- [ ] Press kit uploadé (HeraVex → Press Kit)
- [ ] Communiqué rédigé
- [ ] Mail aux journalistes
- [ ] Codes streamers envoyés
- [ ] Posts sociaux programmés

## 🛒 Boutique
- [ ] Date de sortie Steam confirmée
- [ ] Prix & prix régionaux revus
- [ ] Succès publiés
- [ ] Trailers attachés
- [ ] Tags & catégories choisis

## 🌐 Canaux
- [ ] Site web à jour
- [ ] Annonce Discord prête
- [ ] Thread Twitter / Bluesky prêt
- [ ] Post Reddit prêt

## 🆘 Jour J
- [ ] Dev d'astreinte assigné
- [ ] Branche hotfix prête
- [ ] Boîte support surveillée
`,
      es: () => `# Checklist de lanzamiento — ${today()}

> Una pasada por lanzamiento. Sin saltarse pasos.

## 🎨 Recursos de tienda
- [ ] Capsule art (todos los tamaños)
- [ ] Imagen de cabecera
- [ ] Capturas (5+, 1920×1080)
- [ ] Tráiler (<90s)
- [ ] GIF animado para redes

## 📝 Textos de tienda
- [ ] Descripción corta (≤300 car.)
- [ ] Descripción larga
- [ ] Sección "Acerca del juego"
- [ ] Lista de características
- [ ] Requisitos del sistema

## 🧪 Build & QA
- [ ] Build de lanzamiento etiquetado
- [ ] Smoke test final (instalación limpia)
- [ ] Crash reporter activo
- [ ] Localización revisada
- [ ] Logros / guardado en la nube verificados

## 📰 Prensa & marketing
- [ ] Press kit subido (HeraVex → Press Kit)
- [ ] Nota de prensa redactada
- [ ] Correo a periodistas
- [ ] Códigos para streamers enviados
- [ ] Posts sociales programados

## 🛒 Tienda
- [ ] Fecha Steam confirmada
- [ ] Precio & precios regionales revisados
- [ ] Logros publicados
- [ ] Tráilers adjuntados
- [ ] Etiquetas y categorías elegidas

## 🌐 Canales
- [ ] Web actualizada
- [ ] Anuncio Discord listo
- [ ] Hilo Twitter / Bluesky listo
- [ ] Post Reddit listo

## 🆘 Día de lanzamiento
- [ ] Dev de guardia asignado
- [ ] Rama hotfix lista
- [ ] Buzón de soporte vigilado
`,
    },
  },
];

// ─── Game-scoped templates ──────────────────────────────────────────────

export const GAME_TEMPLATES: GameNoteTemplate[] = [
  // 1. GDD (Game Design Document)
  {
    id: "gdd",
    label: { en: "Game Design Document", tr: "Game Design Document", fr: "Document de design", es: "Documento de diseño" },
    build: {
      en: (title) => `# ${title} — Game Design Document

> Version 1.0 · HeraVex · ${today()}

## 1. High Concept
- **Pitch:** _Describe the game in a single line._
- **Genre:**
- **Platforms:**
- **Target audience:**
- **Inspirations:**

## 2. Core Loop
- Step 1 →
- Step 2 →
- Step 3 →

## 3. Mechanics & Systems
- **Player verbs:**
- **Progression:**
- **Failure model:**

## 4. Story & Characters
- **Protagonist:**
- **Antagonist / conflict:**
- **World:**

## 5. Art Style & Audio
- **Visual style:**
- **Color palette:**
- **Soundtrack direction:**

## 6. Scope
- **MVP:**
- **Stretch:**
- **Out of scope:**

## 7. Risks
-
`,
      tr: (title) => `# ${title} — Game Design Document

> Versiyon 1.0 · HeraVex · ${today()}

## 1. Yüksek Konsept
- **Tek cümle:** _Oyununu tek satırda anlat._
- **Tür:**
- **Platformlar:**
- **Hedef kitle:**
- **İlhamlar:**

## 2. Çekirdek Döngü
- Adım 1 →
- Adım 2 →
- Adım 3 →

## 3. Mekanikler ve Sistemler
- **Oyuncu fiilleri:**
- **İlerleme:**
- **Başarısızlık modeli:**

## 4. Hikaye ve Karakterler
- **Ana karakter:**
- **Karşı güç / çatışma:**
- **Dünya:**

## 5. Sanat Tarzı ve Ses
- **Görsel stil:**
- **Renk paleti:**
- **Müzik yönelimi:**

## 6. Kapsam
- **MVP:**
- **Stretch:**
- **Kapsam dışı:**

## 7. Riskler
-
`,
      fr: (title) => `# ${title} — Document de Design

> Version 1.0 · HeraVex · ${today()}

## 1. High concept
- **Pitch :** _Décrivez le jeu en une ligne._
- **Genre :**
- **Plateformes :**
- **Public cible :**
- **Inspirations :**

## 2. Boucle de jeu
- Étape 1 →
- Étape 2 →
- Étape 3 →

## 3. Mécaniques et systèmes
- **Actions joueur :**
- **Progression :**
- **Modèle d'échec :**

## 4. Histoire et personnages
- **Protagoniste :**
- **Antagoniste / conflit :**
- **Univers :**

## 5. Style et audio
- **Style visuel :**
- **Palette :**
- **Direction musicale :**

## 6. Périmètre
- **MVP :**
- **Stretch :**
- **Hors périmètre :**

## 7. Risques
-
`,
      es: (title) => `# ${title} — Documento de Diseño

> Versión 1.0 · HeraVex · ${today()}

## 1. Concepto general
- **Pitch:** _Describe el juego en una línea._
- **Género:**
- **Plataformas:**
- **Público objetivo:**
- **Inspiraciones:**

## 2. Bucle central
- Paso 1 →
- Paso 2 →
- Paso 3 →

## 3. Mecánicas y sistemas
- **Verbos del jugador:**
- **Progresión:**
- **Modelo de fallo:**

## 4. Historia y personajes
- **Protagonista:**
- **Antagonista / conflicto:**
- **Mundo:**

## 5. Arte y audio
- **Estilo visual:**
- **Paleta:**
- **Dirección musical:**

## 6. Alcance
- **MVP:**
- **Stretch:**
- **Fuera de alcance:**

## 7. Riesgos
-
`,
    },
  },

  // 2. Vertical Slice Plan
  {
    id: "vertical-slice",
    label: { en: "Vertical Slice Plan", tr: "Dikey Dilim Planı", fr: "Plan vertical slice", es: "Plan vertical slice" },
    build: {
      en: (title) => `# ${title} — Vertical Slice Plan

> ${today()}

## Goal
_The smallest piece of the game that looks, feels, and plays like the final product._

## Scope
- **Duration of slice (in-game):** ~5 min
- **Levels / scenes:**
- **Characters in slice:**
- **Mechanics included:**

## Definition of Done
- [ ] Final art quality (no placeholders in slice)
- [ ] Final audio (music + key SFX)
- [ ] UI polish to release standard
- [ ] No game-breaking bugs

## Asset Checklist
- [ ] Character art
- [ ] Environment
- [ ] FX
- [ ] Music
- [ ] SFX
- [ ] UI

## Timeline
| Milestone | Owner | Date |
| --- | --- | --- |
| Blockout |  |  |
| Art pass |  |  |
| Audio pass |  |  |
| Polish |  |  |

## Demo Day Plan
- _How will you show the slice? Trailer? Playable build? Hands-on?_
`,
      tr: (title) => `# ${title} — Dikey Dilim Planı

> ${today()}

## Hedef
_Final üründekiyle aynı görünüp, hissedilen ve oynanan en küçük parça._

## Kapsam
- **Oyun içi süre:** ~5 dk
- **Bölüm / sahne:**
- **Dilime giren karakterler:**
- **Dahil mekanikler:**

## Bitirilmiş Tanımı
- [ ] Final sanat kalitesi (placeholder yok)
- [ ] Final ses (müzik + ana efektler)
- [ ] Yayın standardında UI cilası
- [ ] Oyunu kıran bug yok

## Asset Kontrol Listesi
- [ ] Karakter art
- [ ] Çevre
- [ ] Efektler
- [ ] Müzik
- [ ] Ses efektleri
- [ ] UI

## Zaman Çizelgesi
| Kilometre Taşı | Sorumlu | Tarih |
| --- | --- | --- |
| Blockout |  |  |
| Sanat geçişi |  |  |
| Ses geçişi |  |  |
| Cila |  |  |

## Tanıtım Günü Planı
- _Dilimi nasıl göstereceksin? Fragman? Oynanabilir build? El üstünde?_
`,
      fr: (title) => `# ${title} — Plan Vertical Slice

> ${today()}

## Objectif
_La plus petite portion qui ressemble et se joue comme le jeu final._

## Périmètre
- **Durée in-game :** ~5 min
- **Niveaux / scènes :**
- **Personnages :**
- **Mécaniques incluses :**

## Définition de "fini"
- [ ] Qualité art finale (pas de placeholders)
- [ ] Audio final (musique + effets)
- [ ] UI polie
- [ ] Aucun bug bloquant

## Checklist assets
- [ ] Art personnages
- [ ] Environnement
- [ ] FX
- [ ] Musique
- [ ] SFX
- [ ] UI

## Planning
| Jalon | Responsable | Date |
| --- | --- | --- |
| Blockout |  |  |
| Passe art |  |  |
| Passe audio |  |  |
| Polish |  |  |

## Plan démo
- _Comment montrer la slice ? Trailer ? Build jouable ?_
`,
      es: (title) => `# ${title} — Plan Vertical Slice

> ${today()}

## Objetivo
_La porción más pequeña que se ve y se juega como el producto final._

## Alcance
- **Duración in-game:** ~5 min
- **Niveles / escenas:**
- **Personajes:**
- **Mecánicas incluidas:**

## Definición de hecho
- [ ] Calidad de arte final (sin placeholders)
- [ ] Audio final (música + efectos)
- [ ] UI pulida
- [ ] Sin bugs bloqueantes

## Checklist de assets
- [ ] Arte de personajes
- [ ] Entorno
- [ ] FX
- [ ] Música
- [ ] SFX
- [ ] UI

## Cronograma
| Hito | Responsable | Fecha |
| --- | --- | --- |
| Blockout |  |  |
| Pase de arte |  |  |
| Pase de audio |  |  |
| Pulido |  |  |

## Plan de demo
- _¿Cómo mostrar la slice? ¿Tráiler? ¿Build jugable?_
`,
    },
  },
];

// ─── Lookup helpers ─────────────────────────────────────────────────────

function pickLang<T>(map: Record<AppLanguage, T>, lang: AppLanguage): T {
  return map[lang] ?? map.en;
}

export function getGlobalTemplates(lang: AppLanguage) {
  return GLOBAL_TEMPLATES.map((t) => ({
    id: t.id,
    label: pickLang(t.label, lang),
    title: pickLang(t.label, lang),
    build: pickLang(t.build, lang),
  }));
}

export function getGameTemplates(lang: AppLanguage, gameTitle: string) {
  return GAME_TEMPLATES.map((t) => ({
    id: t.id,
    label: pickLang(t.label, lang),
    title: pickLang(t.label, lang),
    build: () => pickLang(t.build, lang)(gameTitle),
  }));
}
