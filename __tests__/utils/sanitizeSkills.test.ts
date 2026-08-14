import { describe, it, expect } from "vitest";
import { isValidSkillToken, sanitizeSkillList } from "@/utils/sanitizeSkills";

describe("isValidSkillToken", () => {
  it("accepts canonical skill names", () => {
    for (const s of ["React", "Next.js", "Ruby on Rails", "GraphQL", "Agile", "MCP", "AWS CloudWatch"]) {
      expect(isValidSkillToken(s), s).toBe(true);
    }
  });

  it("rejects non-strings and empty values", () => {
    for (const v of [null, undefined, 42, {}, [], "", "   "]) {
      expect(isValidSkillToken(v)).toBe(false);
    }
  });

  it("rejects sentences and commentary", () => {
    expect(isValidSkillToken("Experience with React and modern frontend tooling")).toBe(false);
    expect(isValidSkillToken("React (not explicitly confirmed in profile)")).toBe(false);
    expect(isValidSkillToken("React, Angular, Vue")).toBe(false);
  });

  it("rejects the requirement phrases that polluted the profile", () => {
    const observed = [
      "Confirmación de disponibilidad para trabajo híbrido en Parque Patricios",
      "Advanced English (not explicitly confirmed in profile)",
      "Bachelor's Degree confirmation",
      "React 17 specific experience",
      "Experiencia reciente y constante con React/TypeScript (su stack actual es Shopify/Liquid)",
    ];
    for (const s of observed) expect(isValidSkillToken(s), s).toBe(false);
  });

  it("rejects location, visa, seniority, language and salary requirements", () => {
    const nonSkills = [
      "Ubicación en Barcelona",
      "Relocation to Madrid",
      "Trabajo presencial",
      "Work permit",
      "5+ años de experiencia",
      "3 years of experience",
      "Inglés C1",
      "Bilingual English",
      "Salario competitivo",
    ];
    for (const s of nonSkills) expect(isValidSkillToken(s), s).toBe(false);
  });

  it("enforces the length and word-count caps", () => {
    expect(isValidSkillToken("One Two Three Four")).toBe(true);
    expect(isValidSkillToken("One Two Three Four Five")).toBe(false);
    expect(isValidSkillToken("a".repeat(41))).toBe(false);
  });
});

describe("sanitizeSkillList", () => {
  it("keeps valid tokens and drops the rest", () => {
    const input = ["React", "Ubicación en Barcelona", "TypeScript", "Bachelor's Degree confirmation"];
    expect(sanitizeSkillList(input)).toEqual(["React", "TypeScript"]);
  });

  it("trims and deduplicates case-insensitively, keeping first spelling", () => {
    expect(sanitizeSkillList(["  React ", "react", "REACT"])).toEqual(["React"]);
  });

  it("returns an empty array for non-arrays", () => {
    for (const v of [null, undefined, "React", {}]) {
      expect(sanitizeSkillList(v)).toEqual([]);
    }
  });

  it("drops non-string members without throwing", () => {
    expect(sanitizeSkillList(["React", null, 7, undefined, "Zod"])).toEqual(["React", "Zod"]);
  });
});
