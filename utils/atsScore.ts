import { CVData, JDAnalysis, ATSResult } from "@/types";

/**
 * Calculates ATS compatibility score by comparing CV text against JD keywords.
 */
export function calculateATSScore(cv: CVData, jd: JDAnalysis): ATSResult {
  // Flatten all CV text into one string
  const cvText = [
    cv.description,
    ...cv.experience.flatMap((e) => [e.role, e.company, ...e.bullets]),
    ...cv.education.flatMap((e) => [e.degree, e.field, e.institution]),
    cv.additional_info?.skills,
    cv.additional_info?.languages,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Core keywords determine the score — niceToHave are optional and must not penalise
  const coreKeywords = [...new Set(
    [...jd.atsKeywords, ...jd.requiredSkills].map((k) => k.toLowerCase()),
  )];
  const coreMatched  = coreKeywords.filter((k) => cvText.includes(k));
  const coreMissing  = coreKeywords.filter((k) => !cvText.includes(k));

  // niceToHave: tracked for display only, not counted in the score denominator
  const nthKeywords  = [...new Set(jd.niceToHave.map((k) => k.toLowerCase()))];
  const nthMatched   = nthKeywords.filter((k) => cvText.includes(k) && !coreKeywords.includes(k));
  const nthMissing   = nthKeywords.filter((k) => !cvText.includes(k) && !coreKeywords.includes(k));

  // Score: base 40 + up to 60 from core keyword coverage
  const coverage = coreKeywords.length > 0 ? coreMatched.length / coreKeywords.length : 0;
  const score    = Math.round(40 + coverage * 60);

  const allMatched = [...coreMatched, ...nthMatched];
  const allMissing = [...coreMissing, ...nthMissing];

  const toOriginal = (k: string) =>
    jd.atsKeywords.find((o) => o.toLowerCase() === k) ??
    jd.requiredSkills.find((o) => o.toLowerCase() === k) ??
    jd.niceToHave.find((o) => o.toLowerCase() === k) ??
    k;

  return {
    score:   Math.min(score, 99),
    matched: allMatched.map(toOriginal),
    missing: allMissing.map(toOriginal),
  };
}
