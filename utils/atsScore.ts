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

  const keywords = [
    ...jd.atsKeywords,
    ...jd.requiredSkills,
    ...jd.niceToHave,
  ].map((k) => k.toLowerCase());

  const unique    = [...new Set(keywords)];
  const matched   = unique.filter((k) => cvText.includes(k));
  const missing   = unique.filter((k) => !cvText.includes(k));

  // Score: base 40 points + up to 60 from keyword coverage
  const coverage = unique.length > 0 ? matched.length / unique.length : 0;
  const score    = Math.round(40 + coverage * 60);

  return {
    score:   Math.min(score, 99),
    matched: matched.map((k) =>
      jd.atsKeywords.find((o) => o.toLowerCase() === k) ?? k
    ),
    missing: missing.map((k) =>
      jd.atsKeywords.find((o) => o.toLowerCase() === k) ?? k
    ),
  };
}
