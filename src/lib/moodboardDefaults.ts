// Default moodboard categories seeded into every new game. Hard-coded
// in this file rather than `i18n.ts` because they are only consumed by
// the store at game-creation time and the i18n bundle is already busy
// with UI copy. M4 may surface the labels in the i18n file if other
// modules need to read them too.
//
// IMPORTANT: when adding a new language, update both this file and
// `i18n.ts`. The `id` field is stable across languages so existing
// games keep their category identity even if the user switches UI
// language later — only the display `name` would diverge, and we
// intentionally do NOT rename on language switch (user might have
// customised the label).

import type { AppLanguage } from "./i18n";
import type { MoodboardCategory } from "../types";

type CategorySeed = {
  /** Stable id — never changes across languages. */
  id: string;
  /** Localised display name. */
  name: Record<AppLanguage, string>;
};

const SEEDS: CategorySeed[] = [
  { id: "cat_default_character",  name: { tr: "Karakter",  en: "Character",   fr: "Personnage",     es: "Personaje" } },
  { id: "cat_default_ui",         name: { tr: "UI",        en: "UI",          fr: "Interface",      es: "Interfaz" } },
  { id: "cat_default_color",      name: { tr: "Renk",      en: "Color",       fr: "Couleur",        es: "Color" } },
  { id: "cat_default_atmosphere", name: { tr: "Atmosfer",  en: "Atmosphere",  fr: "Atmosphère",     es: "Atmósfera" } },
  { id: "cat_default_environment",name: { tr: "Çevre",     en: "Environment", fr: "Environnement",  es: "Entorno" } },
  { id: "cat_default_typography", name: { tr: "Tipografi", en: "Typography",  fr: "Typographie",    es: "Tipografía" } },
];

export function defaultMoodboardCategoriesForLanguage(language: AppLanguage): MoodboardCategory[] {
  return SEEDS.map((seed, order) => ({
    id: seed.id,
    name: seed.name[language],
    order,
  }));
}
