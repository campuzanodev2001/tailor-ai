/**
 * Structural + factual checks on the CV JSON returned by Gemini.
 *
 * Tailoring means rephrasing and reordering what the profile already contains.
 * Anything the model adds on its own — an employer, a date, a contact detail —
 * is a fabrication that ships on a real job application, so contact fields and
 * employers are compared against the profile rather than trusted.
 */

import type { CVData } from "@/types";

export interface CVValidationIssue {
  field: string;
  problem: string;
}

export interface ProfileFacts {
  email?: string;
  phone?: string;
  linkedin?: string | null;
  portfolio?: string | null;
  companies: string[];
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Returns the issues found. An empty array means the CV is safe to persist.
 * `facts` omitted skips the factual comparison and checks shape only.
 */
export function validateCVData(cv: unknown, facts?: ProfileFacts): CVValidationIssue[] {
  const issues: CVValidationIssue[] = [];
  const add = (field: string, problem: string) => issues.push({ field, problem });

  if (!cv || typeof cv !== "object") {
    return [{ field: "root", problem: "not an object" }];
  }
  const data = cv as Partial<CVData>;

  // ── shape ────────────────────────────────────────────────────────────────
  const contact = data.contact_info;
  if (!contact || typeof contact !== "object") {
    add("contact_info", "missing");
  } else {
    for (const key of ["name", "email", "phone"] as const) {
      if (!contact[key] || typeof contact[key] !== "string") {
        add(`contact_info.${key}`, "missing or empty");
      }
    }
  }

  if (typeof data.description !== "string" || data.description.trim().length === 0) {
    add("description", "missing or empty");
  }

  if (!Array.isArray(data.experience) || data.experience.length === 0) {
    add("experience", "missing or empty");
  } else {
    data.experience.forEach((exp, i) => {
      for (const key of ["role", "company", "startDate", "endDate"] as const) {
        if (!exp?.[key]) add(`experience[${i}].${key}`, "missing");
      }
      if (!Array.isArray(exp?.bullets) || exp.bullets.length === 0) {
        add(`experience[${i}].bullets`, "missing or empty");
      }
    });
  }

  if (!Array.isArray(data.education)) add("education", "must be an array");

  if (!data.additional_info || typeof data.additional_info.skills !== "string") {
    add("additional_info.skills", "missing");
  }

  if (data.projects !== undefined && !Array.isArray(data.projects)) {
    add("projects", "must be an array when present");
  }

  if (!facts) return issues;

  // ── facts: contact details must be copied, never composed ─────────────────
  if (contact && typeof contact === "object") {
    const compare: Array<[keyof ProfileFacts & keyof typeof contact, string]> = [
      ["email", "contact_info.email"],
      ["phone", "contact_info.phone"],
      ["linkedin", "contact_info.linkedin"],
      ["portfolio", "contact_info.portfolio"],
    ];
    for (const [key, field] of compare) {
      const expected = facts[key];
      const actual   = contact[key];
      // Dropping an optional field is fine; changing it is not.
      if (!expected || !actual) continue;
      if (norm(expected) !== norm(actual)) {
        add(field, `does not match profile (expected "${expected}", got "${actual}")`);
      }
    }
  }

  // ── facts: no invented employers ─────────────────────────────────────────
  if (Array.isArray(data.experience) && facts.companies.length > 0) {
    const known = new Set(facts.companies.map(norm));
    data.experience.forEach((exp, i) => {
      const company = norm(exp?.company);
      if (company && !known.has(company)) {
        add(`experience[${i}].company`, `"${exp.company}" is not in the candidate profile`);
      }
    });
  }

  return issues;
}
