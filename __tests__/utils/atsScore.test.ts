import { describe, it, expect } from "vitest";
import { calculateATSScore } from "@/utils/atsScore";
import type { CVData, JDAnalysis } from "@/types";

const baseCv: CVData = {
  contact_info: { name: "Ana López", email: "ana@email.com", phone: "+54911" },
  description: "",
  experience: [],
  education: [],
  additional_info: { skills: "" },
};

const baseJd: JDAnalysis = {
  role: "Frontend Developer",
  seniority: "Mid",
  requiredSkills: [],
  niceToHave: [],
  atsKeywords: [],
  domain: "SaaS",
  lang: "en",
  rawSummary: "",
};

describe("calculateATSScore", () => {
  it("returns base score of 40 when there are no keywords", () => {
    const result = calculateATSScore(baseCv, baseJd);
    expect(result.score).toBe(40);
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it("returns 99 (capped) when all keywords match", () => {
    const cv = { ...baseCv, description: "expert in react typescript node.js" };
    const jd = { ...baseJd, atsKeywords: ["react", "typescript", "node.js"] };
    const { score, matched } = calculateATSScore(cv, jd);
    expect(score).toBe(99);
    expect(matched).toHaveLength(3);
  });

  it("returns 40 when no keywords match", () => {
    const cv = { ...baseCv, description: "expert in java spring boot" };
    const jd = { ...baseJd, atsKeywords: ["react", "typescript"] };
    const { score, missing } = calculateATSScore(cv, jd);
    expect(score).toBe(40);
    expect(missing).toHaveLength(2);
  });

  it("matches keywords case-insensitively", () => {
    const cv = { ...baseCv, description: "Expert in REACT and TypeScript" };
    const jd = { ...baseJd, atsKeywords: ["react", "typescript"] };
    const { matched } = calculateATSScore(cv, jd);
    expect(matched).toHaveLength(2);
  });

  it("deduplicates keywords that appear in both atsKeywords and requiredSkills", () => {
    const cv = { ...baseCv, description: "react developer" };
    const jd = { ...baseJd, atsKeywords: ["react"], requiredSkills: ["react"] };
    const { matched } = calculateATSScore(cv, jd);
    // "react" must be counted once even though it appears in both lists
    expect(matched).toHaveLength(1);
  });

  it("niceToHave keywords do not penalise the score when missing", () => {
    // 100% core coverage → score 99 regardless of niceToHave coverage
    const cv = { ...baseCv, description: "react typescript developer" };
    const jd = {
      ...baseJd,
      atsKeywords: ["react", "typescript"],
      niceToHave: ["graphql", "jest", "storybook", "cypress", "turborepo"],
    };
    const { score } = calculateATSScore(cv, jd);
    expect(score).toBe(99);
  });

  it("niceToHave matched keywords appear in matched list", () => {
    const cv = { ...baseCv, description: "react developer who uses graphql" };
    const jd = {
      ...baseJd,
      atsKeywords: ["react"],
      niceToHave: ["graphql"],
    };
    const { matched, missing } = calculateATSScore(cv, jd);
    expect(matched).toContain("react");
    expect(matched).toContain("graphql");
    expect(missing).toHaveLength(0);
  });

  it("niceToHave missing keywords appear in missing list", () => {
    const cv = { ...baseCv, description: "react developer" };
    const jd = {
      ...baseJd,
      atsKeywords: ["react"],
      niceToHave: ["graphql"],
    };
    const { missing } = calculateATSScore(cv, jd);
    expect(missing).toContain("graphql");
  });

  it("searches across all CV sections (bullets, skills, education)", () => {
    const cv: CVData = {
      ...baseCv,
      experience: [{
        role: "Dev", company: "Corp", startDate: "2020", endDate: "2023",
        bullets: ["Built CI/CD pipelines with Jenkins"],
      }],
      additional_info: { skills: "Docker, Kubernetes" },
    };
    const jd = { ...baseJd, atsKeywords: ["ci/cd", "docker"] };
    const { matched } = calculateATSScore(cv, jd);
    expect(matched).toHaveLength(2);
  });
});
