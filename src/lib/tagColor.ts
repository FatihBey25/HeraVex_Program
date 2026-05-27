// Etiket → deterministik renk eşlemesi.
//
// Aynı tag stringi her zaman aynı rengi alır; renk kullanıcı tercihinde
// saklanmaz. Bir kasıtla seçilmiş 12-renk paleti üzerinden hash → index.

const TAG_PALETTE: { bg: string; border: string; fg: string }[] = [
  { bg: "rgba(79,140,255,0.18)",  border: "rgba(79,140,255,0.45)",  fg: "#a8c2ff" }, // blue
  { bg: "rgba(167,139,250,0.18)", border: "rgba(167,139,250,0.45)", fg: "#c8b6ff" }, // violet
  { bg: "rgba(244,114,182,0.18)", border: "rgba(244,114,182,0.45)", fg: "#f9a8d4" }, // pink
  { bg: "rgba(248,113,113,0.18)", border: "rgba(248,113,113,0.45)", fg: "#fca5a5" }, // red
  { bg: "rgba(251,146,60,0.18)",  border: "rgba(251,146,60,0.45)",  fg: "#fdba74" }, // orange
  { bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.45)",  fg: "#fcd34d" }, // amber
  { bg: "rgba(132,204,22,0.18)",  border: "rgba(132,204,22,0.45)",  fg: "#bef264" }, // lime
  { bg: "rgba(74,222,128,0.18)",  border: "rgba(74,222,128,0.45)",  fg: "#86efac" }, // green
  { bg: "rgba(52,211,153,0.18)",  border: "rgba(52,211,153,0.45)",  fg: "#6ee7b7" }, // emerald
  { bg: "rgba(34,211,238,0.18)",  border: "rgba(34,211,238,0.45)",  fg: "#67e8f9" }, // cyan
  { bg: "rgba(125,211,252,0.18)", border: "rgba(125,211,252,0.45)", fg: "#bae6fd" }, // sky
  { bg: "rgba(196,181,253,0.18)", border: "rgba(196,181,253,0.45)", fg: "#ddd6fe" }, // lavender
];

/** Cheap deterministic hash. djb2-ish — order-sensitive, case-insensitive. */
function hashString(s: string): number {
  let h = 5381;
  const lower = s.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    h = ((h << 5) + h + lower.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForTag(tag: string): { bg: string; border: string; fg: string } {
  if (!tag) return TAG_PALETTE[0];
  return TAG_PALETTE[hashString(tag) % TAG_PALETTE.length];
}
