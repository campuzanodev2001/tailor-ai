/**
 * Guardrail for the skill chips produced by /api/analyze-jd.
 *
 * The chips in the fit panel are one-click writes into the user's profile, so a
 * model that returns a requirement phrase instead of a skill name ("Advanced
 * English (not explicitly confirmed in profile)") permanently pollutes the
 * profile — and a polluted profile skews every later analysis. The prompt asks
 * for clean tokens; this enforces it regardless of what comes back.
 */

const MAX_WORDS = 4;
const MAX_CHARS = 40;

/** Requirements the model keeps mislabelling as skills. These belong in `summary`. */
const NON_SKILL_PATTERNS: RegExp[] = [
  // location / on-site availability / relocation
  /\b(ubicaci[oó]n|localizaci[oó]n|residen(?:cia|te)|reubicaci[oó]n|relocation|on-?site|presencial|h[ií]brid|hybrid|remoto|remote|disponibilidad|availability|traslado)\b/i,
  // immigration status
  /\b(visa|permiso de trabajo|work permit|sponsorship|nie|autorizaci[oó]n)\b/i,
  // years of experience / seniority. "User Experience" is a real skill, so the
  // bare word is only disqualifying when it is not part of that phrase.
  /\b(\d+\s*\+?\s*(a[ñn]os|years)|seniority|senioridad)\b/i,
  /(?<!user\s)\bexperien(?:ce|cia)s?\b/i,
  // spoken languages and levels
  /\b(ingl[eé]s|english|espa[ñn]ol|spanish|catal[aá]n|catalan|biling[uü]e|bilingual|native|nativo|fluent|fluido|[abc][12]\s*level|nivel\s+[abc][12])\b/i,
  // academic credentials
  /\b(grado|degree|bachelor|licenciatura|master|m[aá]ster|titulaci[oó]n|carrera universitaria)\b/i,
  // compensation / contract
  /\b(salari\w*|sueldo|salary|compensaci[oó]n|contrato|contract type|jornada)\b/i,
  // meta-commentary about the profile itself
  /\b(confirmaci[oó]n|confirmar|confirmation|confirmad\w*|not confirmed|not explicitly|unclear|desconocid\w*|sin especificar)\b/i,
];

/** True when `raw` looks like a real, chip-sized skill name. */
export function isValidSkillToken(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;

  const s = raw.trim();
  if (s.length === 0 || s.length > MAX_CHARS) return false;

  // Sentences and lists, not skill names. Dots are allowed inside a token
  // ("Next.js", ".NET") but a dot that ends a word ends a sentence.
  if (/[;:,]/.test(s)) return false;
  if (/\.(\s|$)/.test(s)) return false;
  // Parentheses always wrap commentary here ("React (not confirmed)")
  if (/[()[\]]/.test(s)) return false;
  if (s.split(/\s+/).length > MAX_WORDS) return false;

  return !NON_SKILL_PATTERNS.some((re) => re.test(s));
}

/**
 * Filters a model-produced skill array down to valid tokens, trimmed and
 * deduplicated case-insensitively. Non-arrays yield an empty array.
 */
export function sanitizeSkillList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Map<string, string>();
  for (const item of input) {
    if (!isValidSkillToken(item)) continue;
    const trimmed = item.trim();
    const key     = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()];
}
