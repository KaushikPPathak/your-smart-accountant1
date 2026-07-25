// Indian-name-aware phonetic + honorific stripping for the assistant's
// fuzzy party matcher.
//
// Handles: honorifics (Smt / Shri / Mr / Late / M/s ...), interchangeable
// consonant digraphs (bh↔b, sh↔s, ph↔f, th↔t, gh↔g, kh↔k, dh↔d), v↔w↔b,
// z↔s, y↔i, vowel-insensitivity, and doubled letters. Also supports
// initials — "M Shah" phonetically matches "Madhuben Shah".

const HONORIFICS = new Set([
  "smt", "smt.", "shrimati", "srimati",
  "shri", "shree", "sri", "sh", "sh.",
  "mr", "mr.", "mrs", "mrs.", "ms", "ms.",
  "dr", "dr.", "prof", "prof.",
  "kum", "kum.", "kumari",
  "late", "swargiya",
  "master", "mst", "mst.",
  "messrs", "m/s",
]);

export function stripHonorifics(s: string): string {
  const words = String(s ?? "")
    .toLowerCase()
    .replace(/[,\.]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !HONORIFICS.has(w));
  return words.join(" ").trim();
}

/** Collapse Indian-English spellings to a normalized consonant skeleton. */
export function phoneticKey(s: string): string {
  let x = String(s ?? "").toLowerCase().replace(/[^a-z\s]/g, "");
  // Digraphs → single canonical sound.
  x = x
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/kh/g, "k")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/ck/g, "k");
  // Interchangeable single consonants.
  x = x
    .replace(/[vw]/g, "b")
    .replace(/z/g, "s")
    .replace(/y/g, "i")
    .replace(/j/g, "c");
  // Collapse all vowels to a single 'a', then squash duplicates.
  x = x.replace(/[aeiou]+/g, "a").replace(/(.)\1+/g, "$1");
  // Trim leading vowel marker for stability.
  return x.replace(/\s+/g, " ").trim();
}

export interface PhoneticScore {
  /** 0..1 similarity. */
  score: number;
  /** Which signal fired — for debugging. */
  reason: string;
}

/**
 * Score a candidate ledger name against the user's phrase using
 * honorific-stripping + phonetic collapse + initial expansion.
 */
export function scoreNameMatch(candidate: string, phrase: string): PhoneticScore {
  const cStripped = stripHonorifics(candidate);
  const pStripped = stripHonorifics(phrase);
  if (!cStripped || !pStripped) return { score: 0, reason: "empty" };

  const cKey = phoneticKey(cStripped);
  const pKey = phoneticKey(pStripped);
  if (cKey === pKey) return { score: 0.97, reason: "phonetic-exact" };

  const cTokens = cStripped.split(/\s+/).filter(Boolean);
  const pTokens = pStripped.split(/\s+/).filter(Boolean);
  const cWords = cTokens.filter((t) => t.length >= 2);
  const pWords = pTokens.filter((t) => t.length >= 2);
  const pInitials = pTokens.filter((t) => t.length === 1);

  const cKeyWords = cWords.map(phoneticKey);
  const pKeyWords = pWords.map(phoneticKey);

  // How many query words match phonetically (or as substring) inside the name.
  let wordHits = 0;
  for (const pw of pKeyWords) {
    if (cKeyWords.some((cw) => cw === pw || cw.includes(pw) || pw.includes(cw))) wordHits++;
  }
  const wordCoverage = pKeyWords.length ? wordHits / pKeyWords.length : 0;

  // Initials: 'M' matches a name-word starting with 'm'.
  let initialHits = 0;
  for (const ini of pInitials) {
    if (cWords.some((cw) => cw.startsWith(ini))) initialHits++;
  }
  const initialsOk = pInitials.length === 0 || initialHits === pInitials.length;

  if (wordCoverage >= 1 && initialsOk) return { score: 0.9, reason: "all-words" };
  if (wordCoverage >= 0.75 && initialsOk) return { score: 0.8, reason: "most-words" };
  if (wordCoverage >= 0.5 && initialsOk && pKeyWords.length >= 2) {
    return { score: 0.7, reason: "half-words" };
  }

  // Phonetic substring — "madhuben" phonetic key contained in candidate key.
  if (cKey.includes(pKey) || pKey.includes(cKey)) {
    return { score: 0.75, reason: "phonetic-substring" };
  }

  return { score: 0, reason: "no-match" };
}
