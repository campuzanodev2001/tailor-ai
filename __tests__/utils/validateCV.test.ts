import { describe, it, expect } from "vitest";
import { validateCVData, type ProfileFacts } from "@/utils/validateCV";
import type { CVData } from "@/types";

const facts: ProfileFacts = {
  email:     "danicampu56@gmail.com",
  phone:     "+34663744803",
  linkedin:  "https://www.linkedin.com/in/daniel-campuzano-7149552b7",
  portfolio: "https://campuzano-portfoliov1.vercel.app/",
  companies: ["FREELANCE", "GLOBANT", "ACCENTURE"],
};

const validCV = (): CVData => ({
  contact_info: {
    name:      "Daniel Ricardo Campuzano Olmedo",
    email:     "danicampu56@gmail.com",
    phone:     "+34663744803",
    location:  "Barcelona, Spain",
    linkedin:  "https://www.linkedin.com/in/daniel-campuzano-7149552b7",
    portfolio: "https://campuzano-portfoliov1.vercel.app/",
  },
  description: "Frontend developer with 5+ years of experience.",
  experience: [
    { role: "Frontend Developer", company: "GLOBANT", startDate: "Dec 2021", endDate: "Apr 2025", bullets: ["Refactored a legacy frontend"] },
  ],
  education: [],
  additional_info: { skills: "React, TypeScript" },
});

describe("validateCVData — shape", () => {
  it("passes a well-formed CV", () => {
    expect(validateCVData(validCV(), facts)).toEqual([]);
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, "cv", 42]) {
      expect(validateCVData(v)).toEqual([{ field: "root", problem: "not an object" }]);
    }
  });

  it("flags missing contact fields", () => {
    const cv = validCV();
    // @ts-expect-error deliberately malformed
    delete cv.contact_info.email;
    const fields = validateCVData(cv, facts).map((i) => i.field);
    expect(fields).toContain("contact_info.email");
  });

  it("flags an empty description and empty experience", () => {
    const cv = { ...validCV(), description: "   ", experience: [] };
    const fields = validateCVData(cv, facts).map((i) => i.field);
    expect(fields).toContain("description");
    expect(fields).toContain("experience");
  });

  it("flags a role with no bullets", () => {
    const cv = validCV();
    cv.experience[0].bullets = [];
    expect(validateCVData(cv, facts).map((i) => i.field)).toContain("experience[0].bullets");
  });

  it("flags projects when present but not an array", () => {
    const cv = { ...validCV(), projects: "none" };
    expect(validateCVData(cv, facts).map((i) => i.field)).toContain("projects");
  });
});

describe("validateCVData — fabrication", () => {
  it("catches a rewritten email", () => {
    const cv = validCV();
    cv.contact_info.email = "daniel.campuzano@gmail.com";
    const issue = validateCVData(cv, facts).find((i) => i.field === "contact_info.email");
    expect(issue?.problem).toMatch(/does not match profile/);
  });

  it("catches an invented employer", () => {
    const cv = validCV();
    cv.experience[0].company = "Google";
    const issue = validateCVData(cv, facts).find((i) => i.field === "experience[0].company");
    expect(issue?.problem).toMatch(/not in the candidate profile/);
  });

  it("allows employer matching to ignore case and padding", () => {
    const cv = validCV();
    cv.experience[0].company = "  globant ";
    expect(validateCVData(cv, facts)).toEqual([]);
  });

  it("allows omitting an optional contact field but not changing it", () => {
    const dropped = validCV();
    delete dropped.contact_info.portfolio;
    expect(validateCVData(dropped, facts)).toEqual([]);

    const changed = validCV();
    changed.contact_info.portfolio = "https://example.com";
    expect(validateCVData(changed, facts).map((i) => i.field)).toContain("contact_info.portfolio");
  });

  it("checks shape only when no profile facts are supplied", () => {
    const cv = validCV();
    cv.contact_info.email = "someone-else@example.com";
    cv.experience[0].company = "Invented Corp";
    expect(validateCVData(cv)).toEqual([]);
  });
});
