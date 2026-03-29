"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { useAuth } from "@/contexts/AuthContext";
import { AccordionSection } from "@/components/ui/AccordionSection";
import { SkillChip } from "@/components/ui/SkillChip";
import { UserProfile, Experience, Education, Certification, Language, Project } from "@/types";

// Safely coerce a Firestore field to an array
function toArr<T>(val: T[] | null | undefined): T[];
function toArr(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  return [];
}

const VALID_LANGUAGE_LEVELS = ["native", "fluent", "intermediate", "basic"] as const;
type LanguageLevel = typeof VALID_LANGUAGE_LEVELS[number];

function normalizeLanguageLevel(level: string): LanguageLevel {
  const l = level?.toLowerCase().trim();
  if ((VALID_LANGUAGE_LEVELS as readonly string[]).includes(l)) return l as LanguageLevel;
  if (l?.includes("native") || l?.includes("mother")) return "native";
  if (l?.includes("fluent") || l?.includes("advanced") || l?.includes("c1") || l?.includes("c2")) return "fluent";
  if (l?.includes("intermediate") || l?.includes("b1") || l?.includes("b2")) return "intermediate";
  return "basic";
}

export default function ProfilePage() {
  const { profile, updateProfile } = useUserProfile();
  const { user } = useAuth();
  const [newHardSkill, setNewHardSkill] = useState("");
  const [newSoftSkill, setNewSoftSkill] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [optimizingSummary, setOptimizingSummary] = useState(false);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  async function handleCVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadMessage(null);

    try {
      const token = await user?.getIdToken();
      const formData = new FormData();
      formData.append("cv", file);

      const res = await fetch("/api/parse-cv", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const parsed = await res.json();
      const { nanoid } = await import("nanoid");

      // Only fill empty scalar fields — never overwrite existing data
      const mapped: Partial<UserProfile> = {};

      if (parsed.name             && !profile?.name)             mapped.name             = parsed.name;
      if (parsed.email            && !profile?.email)            mapped.email            = parsed.email;
      if (parsed.phone            && !profile?.phone)            mapped.phone            = parsed.phone;
      if (parsed.location         && !profile?.location)         mapped.location         = parsed.location;
      if (parsed.linkedin         && !profile?.linkedin)         mapped.linkedin         = parsed.linkedin;
      if (parsed.title            && !profile?.title)            mapped.title            = parsed.title;
      if (parsed.shortDescription && !profile?.shortDescription) mapped.shortDescription = parsed.shortDescription;

      // Merge skill arrays — add only skills not already present
      if (Array.isArray(parsed.hardSkills) && parsed.hardSkills.length) {
        const existing = new Set(toArr(profile?.hardSkills ?? []).map((s) => s.toLowerCase()));
        const incoming = (parsed.hardSkills as string[]).filter((s) => !existing.has(s.toLowerCase()));
        if (incoming.length) mapped.hardSkills = [...toArr(profile?.hardSkills ?? []), ...incoming];
      }
      if (Array.isArray(parsed.softSkills) && parsed.softSkills.length) {
        const existing = new Set(toArr(profile?.softSkills ?? []).map((s) => s.toLowerCase()));
        const incoming = (parsed.softSkills as string[]).filter((s) => !existing.has(s.toLowerCase()));
        if (incoming.length) mapped.softSkills = [...toArr(profile?.softSkills ?? []), ...incoming];
      }

      // Merge languages — add only languages whose name isn't already listed
      if (Array.isArray(parsed.languages) && parsed.languages.length) {
        const existingLangs = new Set(
          (profile?.languages ?? []).map((l) => l.name.toLowerCase())
        );
        const incoming = (parsed.languages as { name: string; level: string }[])
          .filter((l) => !existingLangs.has(l.name.toLowerCase()))
          .map((l) => ({ name: l.name, level: normalizeLanguageLevel(l.level) })) as Language[];
        if (incoming.length)
          mapped.languages = [...(profile?.languages ?? []), ...incoming];
      }

      // Append experience entries not already present (matched by company + role)
      if (Array.isArray(parsed.experience) && parsed.experience.length) {
        const existingKeys = new Set(
          toArr(profile?.experience ?? []).map((e) => `${e.company}|${e.role}`.toLowerCase())
        );
        const incoming = (parsed.experience as {
          company: string; role: string; startDate: string; endDate: string;
          location: string; achievements: string[]; techStack: string[];
        }[])
          .filter((e) => !existingKeys.has(`${e.company}|${e.role}`.toLowerCase()))
          .map((exp) => ({
            id:           nanoid(),
            company:      exp.company      ?? "",
            role:         exp.role         ?? "",
            startDate:    exp.startDate    ?? "",
            endDate:      exp.endDate      ?? "Present",
            location:     exp.location     ?? "",
            achievements: Array.isArray(exp.achievements) ? exp.achievements : [],
            techStack:    Array.isArray(exp.techStack)    ? exp.techStack    : [],
          })) as Experience[];
        if (incoming.length)
          mapped.experience = [...toArr(profile?.experience ?? []), ...incoming];
      }

      // Append education not already present (matched by institution + degree)
      if (Array.isArray(parsed.education) && parsed.education.length) {
        const existingKeys = new Set(
          (profile?.education ?? []).map((e) => `${e.institution}|${e.degree}`.toLowerCase())
        );
        const incoming = (parsed.education as {
          institution: string; degree: string; field: string; startYear: string; endYear: string;
        }[])
          .filter((e) => !existingKeys.has(`${e.institution}|${e.degree}`.toLowerCase()))
          .map((edu) => ({
            id:          nanoid(),
            institution: edu.institution ?? "",
            degree:      edu.degree      ?? "",
            field:       edu.field       ?? "",
            startYear:   edu.startYear   ?? "",
            endYear:     edu.endYear     ?? "",
          })) as Education[];
        if (incoming.length)
          mapped.education = [...(profile?.education ?? []), ...incoming];
      }

      // Append certifications not already present (matched by name)
      if (Array.isArray(parsed.certifications) && parsed.certifications.length) {
        const existingNames = new Set(
          (profile?.certifications ?? []).map((c) => c.name.toLowerCase())
        );
        const incoming = (parsed.certifications as { name: string; issuer: string; year: string }[])
          .filter((c) => !existingNames.has(c.name.toLowerCase()))
          .map((c) => ({
            id:     nanoid(),
            name:   c.name   ?? "",
            issuer: c.issuer ?? "",
            year:   c.year   ?? "",
          })) as Certification[];
        if (incoming.length)
          mapped.certifications = [...(profile?.certifications ?? []), ...incoming];
      }

      await updateProfile(mapped);
      setUploadMessage({ type: "success", text: "CV parsed and profile updated successfully." });
    } catch (err) {
      console.error("CV upload error:", err);
      setUploadMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to parse CV." });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const [newLangName, setNewLangName] = useState("");
  const [newLangLevel, setNewLangLevel] = useState<LanguageLevel>("intermediate");

  function addLanguage() {
    if (!newLangName.trim()) return;
    const existing = (profile?.languages ?? []).map((l) => l.name.toLowerCase());
    if (existing.includes(newLangName.trim().toLowerCase())) return;
    updateProfile({ languages: [...(profile?.languages ?? []), { name: newLangName.trim(), level: newLangLevel }] });
    setNewLangName("");
    setNewLangLevel("intermediate");
  }

  function removeLanguage(name: string) {
    updateProfile({ languages: (profile?.languages ?? []).filter((l) => l.name !== name) });
  }

  function updateLanguageLevel(name: string, level: LanguageLevel) {
    updateProfile({
      languages: (profile?.languages ?? []).map((l) => l.name === name ? { ...l, level } : l),
    });
  }

  function addHardSkill() {
    if (!newHardSkill.trim()) return;
    updateProfile({ hardSkills: [...toArr(profile?.hardSkills), newHardSkill.trim()] });
    setNewHardSkill("");
  }

  function removeHardSkill(skill: string) {
    updateProfile({ hardSkills: toArr(profile?.hardSkills).filter((s) => s !== skill) });
  }

  function addSoftSkill() {
    if (!newSoftSkill.trim()) return;
    updateProfile({ softSkills: [...toArr(profile?.softSkills), newSoftSkill.trim()] });
    setNewSoftSkill("");
  }

  function removeSoftSkill(skill: string) {
    updateProfile({ softSkills: toArr(profile?.softSkills).filter((s) => s !== skill) });
  }

  async function handleOptimizeSummary() {
    setOptimizingSummary(true);
    try {
      const token = await user?.getIdToken();
      const currentSummary = summaryRef.current?.value ?? profile?.shortDescription ?? "";
      const context = [
        profile?.title && `Title: ${profile.title}`,
        toArr(profile?.hardSkills).length && `Skills: ${toArr(profile?.hardSkills).join(", ")}`,
        toArr(profile?.experience).length && `Experience: ${toArr(profile?.experience).map((e) => `${e.role} at ${e.company}`).join("; ")}`,
        currentSummary && `Current summary: ${currentSummary}`,
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/optimize-summary", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });

      if (!res.ok) throw new Error("Failed to optimize");
      const { summary } = await res.json();

      if (summaryRef.current) summaryRef.current.value = summary;
      await updateProfile({ shortDescription: summary });
    } catch (err) {
      console.error("Optimize summary error:", err);
    } finally {
      setOptimizingSummary(false);
    }
  }

  function addProject() {
    const { nanoid } = require("nanoid");
    const blank: Project = {
      id:          nanoid(),
      name:        "",
      description: "",
      url:         "",
      tech:        [],
    };
    updateProfile({ projects: [...(profile?.projects ?? []), blank] });
  }

  function addExperience() {
    const { nanoid } = require("nanoid");
    const blank: Experience = {
      id:          nanoid(),
      company:     "",
      role:        "",
      startDate:   "",
      endDate:     "Present",
      location:    "",
      achievements: [],
      techStack:   [],
    };
    updateProfile({ experience: [...toArr(profile?.experience), blank] });
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Parsing overlay */}
      {uploading && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-6">
          <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <div className="text-center">
            <p className="text-white font-bold text-lg mb-1">Parsing your CV...</p>
            <p className="text-outline text-sm">Gemini AI is extracting your information</p>
          </div>
        </div>
      )}
      <main className="flex-1 min-w-0 pb-24 md:pb-0">
        <div className="max-w-5xl mx-auto px-6 py-12">
          {/* Profile Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
            <div className="flex items-center gap-6">
              <div className="relative group">
                <div className="relative w-24 h-24 rounded-full overflow-hidden bg-surface-container-high ring-2 ring-primary/20">
                  {profile?.photoURL ? (
                    <Image
                      src={profile.photoURL}
                      alt={profile.name ?? "Avatar"}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl font-black text-on-surface-variant">
                      {profile?.name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                </div>
                <button className="absolute bottom-0 right-0 p-1.5 bg-primary text-on-primary rounded-full shadow-lg hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              </div>
              <div>
                <h2 className="text-4xl font-headline font-extrabold tracking-tight text-white mb-1">
                  {profile?.name || "Your Name"}
                </h2>
                <p className="text-outline flex items-center gap-2 font-label">
                  <span className="material-symbols-outlined text-sm">location_on</span>
                  {[profile?.location, profile?.title].filter(Boolean).join(" • ") ||
                    "Add your location & title"}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {/* Upload feedback */}
              {uploadMessage && (
                <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
                  uploadMessage.type === "success"
                    ? "bg-tertiary/10 text-tertiary border border-tertiary/20"
                    : "bg-error/10 text-error border border-error/20"
                }`}>
                  <span className="material-symbols-outlined text-sm">
                    {uploadMessage.type === "success" ? "check_circle" : "error"}
                  </span>
                  {uploadMessage.text}
                </div>
              )}
              <div className="flex gap-3">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,application/pdf,text/plain"
                  className="hidden"
                  onChange={handleCVUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-5 py-2.5 rounded-lg border border-outline-variant/20 text-on-surface font-semibold hover:bg-surface-container transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                      Parsing CV...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">upload_file</span>
                      Import CV
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Accordion Sections */}
          <div className="space-y-4">
            {/* Personal Info */}
            <AccordionSection title="Personal Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {([
                  { label: "Full Name",     field: "name",     type: "text" },
                  { label: "Email Address", field: "email",    type: "email" },
                  { label: "Phone Number",  field: "phone",    type: "text" },
                  { label: "LinkedIn URL",  field: "linkedin", type: "text" },
                  { label: "Location",      field: "location", type: "text" },
                ] as { label: string; field: keyof UserProfile; type: string }[]).map(({ label, field, type }) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-label uppercase tracking-widest text-outline">
                      {label}
                    </label>
                    <input
                      type={type}
                      defaultValue={(profile?.[field] as string) ?? ""}
                      onBlur={(e) => updateProfile({ [field]: e.target.value })}
                      className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                    />
                  </div>
                ))}
              </div>
            </AccordionSection>

            {/* Professional Summary */}
            <AccordionSection title="Professional Summary">
              <div className="space-y-4">
                <textarea
                  ref={summaryRef}
                  defaultValue={profile?.shortDescription ?? ""}
                  onBlur={(e) => updateProfile({ shortDescription: e.target.value })}
                  className="w-full h-32 bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all resize-none"
                  placeholder="Write your professional summary..."
                />
                <button
                  type="button"
                  onClick={handleOptimizeSummary}
                  disabled={optimizingSummary}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-on-primary-container text-sm font-bold hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-60"
                >
                  {optimizingSummary ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                      Writing...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                      Optimize with AI
                    </>
                  )}
                </button>
              </div>
            </AccordionSection>

            {/* Skills */}
            <AccordionSection title="Skills & Competencies">
              <div className="space-y-8">
                {/* Hard skills */}
                <div>
                  <label className="text-xs font-label uppercase tracking-widest text-outline mb-4 block">
                    Hard Skills
                  </label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {toArr(profile?.hardSkills).map((s) => (
                      <SkillChip
                        key={s}
                        label={s}
                        variant="hard"
                        onRemove={() => removeHardSkill(s)}
                      />
                    ))}
                    <input
                      value={newHardSkill}
                      onChange={(e) => setNewHardSkill(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addHardSkill())}
                      className="bg-transparent border-none text-sm focus:ring-0 py-1 w-24 text-on-surface placeholder:text-outline/50"
                      placeholder="Add skill..."
                    />
                  </div>
                </div>

                {/* Soft skills */}
                <div>
                  <label className="text-xs font-label uppercase tracking-widest text-outline mb-4 block">
                    Soft Skills
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {toArr(profile?.softSkills).map((s) => (
                      <SkillChip
                        key={s}
                        label={s}
                        variant="soft"
                        onRemove={() => removeSoftSkill(s)}
                      />
                    ))}
                    <input
                      value={newSoftSkill}
                      onChange={(e) => setNewSoftSkill(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSoftSkill())}
                      className="bg-transparent border-none text-sm focus:ring-0 py-1 w-24 text-on-surface placeholder:text-outline/50"
                      placeholder="Add skill..."
                    />
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* Work Experience */}
            <AccordionSection title="Work Experience">
              <div className="space-y-12">
                {(profile?.experience ?? [] as Experience[]).map((exp, idx) => {
                  function updateExp(patch: Partial<Experience>) {
                    const next = (profile?.experience ?? [] as Experience[]).map((e, i) =>
                      i === idx ? { ...e, ...patch } : e
                    ) as Experience[];
                    updateProfile({ experience: next });
                  }

                  return (
                    <div
                      key={exp.id ?? idx}
                      className="relative pl-8 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-[1px] before:bg-outline-variant/30"
                    >
                      <div className="absolute left-[-4px] top-2 w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(192,193,255,0.5)]" />
                      <button
                        type="button"
                        onClick={() =>
                          updateProfile({
                            experience: (profile?.experience ?? [] as Experience[]).filter((_, i) => i !== idx) as Experience[],
                          })
                        }
                        className="absolute top-0 right-0 text-outline hover:text-error transition-colors"
                        title="Remove experience"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                        {([
                          { label: "Company",    field: "company",   value: exp.company },
                          { label: "Role",       field: "role",      value: exp.role },
                          { label: "Start Date", field: "startDate", value: exp.startDate },
                          { label: "End Date",   field: "endDate",   value: exp.endDate },
                          { label: "Location",   field: "location",  value: exp.location },
                        ] as { label: string; field: keyof Experience; value: string }[]).map(({ label, field, value }) => (
                          <div key={field} className="space-y-1">
                            <label className="text-xs font-label uppercase tracking-widest text-outline">
                              {label}
                            </label>
                            <input
                              defaultValue={value}
                              onBlur={(e) => updateExp({ [field]: e.target.value })}
                              className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Achievements */}
                      <div className="space-y-4">
                        <label className="text-xs font-label uppercase tracking-widest text-outline">
                          Achievements
                        </label>
                        <ul className="space-y-2">
                          {(exp.achievements ?? []).map((a, ai) => (
                            <li key={ai} className="flex gap-3 items-start">
                              <span className="material-symbols-outlined text-outline text-sm pt-1.5">
                                drag_indicator
                              </span>
                              <input
                                defaultValue={a}
                                onBlur={(e) => {
                                  const next = [...(exp.achievements ?? [])];
                                  next[ai] = e.target.value;
                                  updateExp({ achievements: next });
                                }}
                                className="flex-1 bg-surface-container-low border-none focus:ring-0 p-0 text-sm text-on-surface"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (exp.achievements ?? []).filter((_, i) => i !== ai);
                                  updateExp({ achievements: next });
                                }}
                                className="text-outline hover:text-error transition-colors mt-1"
                              >
                                <span className="material-symbols-outlined text-xs">close</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => updateExp({ achievements: [...(exp.achievements ?? []), ""] })}
                          className="text-xs text-primary font-bold flex items-center gap-1 mt-2"
                        >
                          <span className="material-symbols-outlined text-xs">add</span> Add Point
                        </button>
                      </div>

                      {/* Tech Stack */}
                      <div className="mt-6">
                        <label className="text-xs font-label uppercase tracking-widest text-outline mb-2 block">
                          Tech Stack
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(exp.techStack ?? []).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => updateExp({ techStack: (exp.techStack ?? []).filter((s) => s !== t) })}
                              className="px-2 py-0.5 bg-surface-container text-outline rounded text-[10px] uppercase font-label hover:bg-error/10 hover:text-error transition-colors"
                            >
                              {t} ×
                            </button>
                          ))}
                          <input
                            placeholder="Add tech..."
                            className="bg-transparent border-none text-[10px] uppercase font-label focus:ring-0 py-0.5 w-20 text-on-surface placeholder:text-outline/50"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const val = e.currentTarget.value.trim();
                                if (val) {
                                  updateExp({ techStack: [...(exp.techStack ?? []), val] });
                                  e.currentTarget.value = "";
                                }
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={addExperience}
                  className="w-full py-4 border-2 border-dashed border-outline-variant/20 rounded-xl text-outline hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined">add_circle</span>
                  Add Experience
                </button>
              </div>
            </AccordionSection>

            {/* Projects */}
            <AccordionSection title="Projects" isEmpty={!profile?.projects?.length} defaultOpen={false}>
              <div className="space-y-12">
                {(profile?.projects ?? []).map((proj, idx) => {
                  function updateProj(patch: Partial<Project>) {
                    const next = (profile?.projects ?? []).map((p, i) =>
                      i === idx ? { ...p, ...patch } : p
                    ) as Project[];
                    updateProfile({ projects: next });
                  }

                  return (
                    <div
                      key={proj.id ?? idx}
                      className="relative pl-8 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-[1px] before:bg-outline-variant/30"
                    >
                      <div className="absolute left-[-4px] top-2 w-2 h-2 rounded-full bg-tertiary shadow-[0_0_8px_rgba(192,255,193,0.4)]" />
                      <button
                        type="button"
                        onClick={() =>
                          updateProfile({ projects: (profile?.projects ?? []).filter((_, i) => i !== idx) })
                        }
                        className="absolute top-0 right-0 text-outline hover:text-error transition-colors"
                        title="Remove project"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                        <div className="space-y-1">
                          <label className="text-xs font-label uppercase tracking-widest text-outline">Project Name</label>
                          <input
                            defaultValue={proj.name}
                            onBlur={(e) => updateProj({ name: e.target.value })}
                            className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                            placeholder="My Awesome Project"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-label uppercase tracking-widest text-outline">URL (optional)</label>
                          <input
                            defaultValue={proj.url ?? ""}
                            onBlur={(e) => updateProj({ url: e.target.value })}
                            className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                            placeholder="https://github.com/..."
                          />
                        </div>
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-xs font-label uppercase tracking-widest text-outline">Description</label>
                          <textarea
                            defaultValue={proj.description}
                            onBlur={(e) => updateProj({ description: e.target.value })}
                            rows={3}
                            className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all resize-none"
                            placeholder="What does it do? What problem does it solve?"
                          />
                        </div>
                      </div>

                      {/* Tech Stack */}
                      <div>
                        <label className="text-xs font-label uppercase tracking-widest text-outline mb-2 block">
                          Tech Stack
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(proj.tech ?? []).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => updateProj({ tech: (proj.tech ?? []).filter((s) => s !== t) })}
                              className="px-2 py-0.5 bg-surface-container text-outline rounded text-[10px] uppercase font-label hover:bg-error/10 hover:text-error transition-colors"
                            >
                              {t} ×
                            </button>
                          ))}
                          <input
                            placeholder="Add tech..."
                            className="bg-transparent border-none text-[10px] uppercase font-label focus:ring-0 py-0.5 w-20 text-on-surface placeholder:text-outline/50"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const val = e.currentTarget.value.trim();
                                if (val) {
                                  updateProj({ tech: [...(proj.tech ?? []), val] });
                                  e.currentTarget.value = "";
                                }
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={addProject}
                  className="w-full py-4 border-2 border-dashed border-outline-variant/20 rounded-xl text-outline hover:border-tertiary hover:text-tertiary transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined">add_circle</span>
                  Add Project
                </button>
              </div>
            </AccordionSection>

            {/* Languages */}
            <AccordionSection title="Languages">
              <div className="space-y-4">
                {(profile?.languages ?? []).length > 0 && (
                  <div className="space-y-2">
                    {(profile?.languages ?? []).map((lang) => (
                      <div key={lang.name} className="flex items-center gap-3">
                        <span className="flex-1 text-sm text-on-surface font-medium">{lang.name}</span>
                        <select
                          value={lang.level}
                          onChange={(e) => updateLanguageLevel(lang.name, e.target.value as LanguageLevel)}
                          className="bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface text-sm py-1 pr-2 transition-all"
                        >
                          {VALID_LANGUAGE_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl} className="capitalize">{lvl.charAt(0).toUpperCase() + lvl.slice(1)}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeLanguage(lang.name)}
                          className="text-outline hover:text-error transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="text"
                    value={newLangName}
                    onChange={(e) => setNewLangName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLanguage())}
                    placeholder="Language name..."
                    className="flex-1 bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface text-sm px-0 py-1.5 transition-all placeholder:text-outline/50"
                  />
                  <select
                    value={newLangLevel}
                    onChange={(e) => setNewLangLevel(e.target.value as LanguageLevel)}
                    className="bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface text-sm py-1.5 pr-2 transition-all"
                  >
                    {VALID_LANGUAGE_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>{lvl.charAt(0).toUpperCase() + lvl.slice(1)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addLanguage}
                    className="text-primary hover:text-primary/80 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">add_circle</span>
                  </button>
                </div>
              </div>
            </AccordionSection>

            {/* Certifications */}
            <AccordionSection
              title="Certifications"
              isEmpty={!profile?.certifications?.length}
              defaultOpen={false}
            >
              <p className="text-on-surface-variant text-sm">
                No certifications added yet.
              </p>
            </AccordionSection>
          </div>

          {/* Live CV Preview */}
          <div className="mt-20">
            <h4 className="text-xs font-label uppercase tracking-[0.2em] text-outline text-center mb-8">
              Live Preview
            </h4>
            <div className="bg-white rounded-lg shadow-2xl max-w-3xl mx-auto overflow-hidden">
              <div className="p-10 font-serif text-gray-900 leading-relaxed text-sm">

                {/* Header */}
                <div className="mb-6 pb-4 border-b border-gray-200">
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">
                    {profile?.name || "Your Name"}
                  </h2>
                  {profile?.title && (
                    <p className="text-sm text-indigo-600 font-medium mb-2">{profile.title}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    {[profile?.email, profile?.phone, profile?.location, profile?.linkedin]
                      .filter(Boolean)
                      .join("  •  ")}
                  </p>
                </div>

                {/* Summary */}
                {profile?.shortDescription && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2">
                      Professional Summary
                    </h3>
                    <p className="text-xs text-gray-700 leading-relaxed">{profile.shortDescription}</p>
                  </div>
                )}

                {/* Experience */}
                {toArr(profile?.experience).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 pb-1 border-b border-gray-200">
                      Experience
                    </h3>
                    <div className="space-y-5">
                      {toArr(profile?.experience).map((exp, idx) => (
                        <div key={exp.id ?? idx}>
                          <div className="flex justify-between items-baseline mb-0.5">
                            <h4 className="text-sm font-bold text-gray-900">{exp.role}</h4>
                            <span className="text-[10px] text-gray-500 shrink-0 ml-2">
                              {exp.startDate} — {exp.endDate}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mb-1.5">
                            {[exp.company, exp.location].filter(Boolean).join(" · ")}
                          </p>
                          {toArr(exp.achievements).length > 0 && (
                            <ul className="list-disc list-outside ml-4 space-y-0.5">
                              {toArr(exp.achievements).map((a, i) => (
                                <li key={i} className="text-xs text-gray-700">{a}</li>
                              ))}
                            </ul>
                          )}
                          {toArr(exp.techStack).length > 0 && (
                            <p className="text-[10px] text-gray-400 mt-1.5">
                              {exp.techStack.join(" · ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Projects */}
                {(profile?.projects ?? []).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 pb-1 border-b border-gray-200">
                      Projects
                    </h3>
                    <div className="space-y-3">
                      {(profile?.projects ?? []).map((proj, idx) => (
                        <div key={proj.id ?? idx}>
                          <div className="flex items-baseline justify-between mb-0.5">
                            <p className="text-xs font-bold text-gray-900">{proj.name}</p>
                            {proj.url && (
                              <span className="text-[10px] text-gray-400 truncate ml-2 max-w-[120px]">{proj.url}</span>
                            )}
                          </div>
                          {proj.description && (
                            <p className="text-xs text-gray-700 leading-relaxed mb-1">{proj.description}</p>
                          )}
                          {(proj.tech ?? []).length > 0 && (
                            <p className="text-[10px] text-gray-400">{proj.tech.join(" · ")}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Education */}
                {(profile?.education ?? []).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 pb-1 border-b border-gray-200">
                      Education
                    </h3>
                    <div className="space-y-3">
                      {(profile?.education ?? []).map((edu, idx) => (
                        <div key={edu.id ?? idx} className="flex justify-between items-baseline">
                          <div>
                            <p className="text-xs font-bold text-gray-900">
                              {edu.degree}{edu.field ? ` · ${edu.field}` : ""}
                            </p>
                            <p className="text-xs text-gray-600">{edu.institution}</p>
                          </div>
                          <span className="text-[10px] text-gray-500 shrink-0 ml-2">
                            {[edu.startYear, edu.endYear].filter(Boolean).join(" — ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Skills */}
                {(toArr(profile?.hardSkills).length > 0 || toArr(profile?.softSkills).length > 0) && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 pb-1 border-b border-gray-200">
                      Skills
                    </h3>
                    {toArr(profile?.hardSkills).length > 0 && (
                      <p className="text-xs text-gray-700 mb-1">
                        <span className="font-semibold">Technical: </span>
                        {toArr(profile?.hardSkills).join(", ")}
                      </p>
                    )}
                    {toArr(profile?.softSkills).length > 0 && (
                      <p className="text-xs text-gray-700">
                        <span className="font-semibold">Soft skills: </span>
                        {toArr(profile?.softSkills).join(", ")}
                      </p>
                    )}
                  </div>
                )}

                {/* Languages */}
                {(profile?.languages ?? []).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 pb-1 border-b border-gray-200">
                      Languages
                    </h3>
                    <p className="text-xs text-gray-700">
                      {(profile?.languages ?? [])
                        .map((l) => `${l.name} (${l.level})`)
                        .join("  •  ")}
                    </p>
                  </div>
                )}

                {/* Certifications */}
                {(profile?.certifications ?? []).length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 pb-1 border-b border-gray-200">
                      Certifications
                    </h3>
                    <div className="space-y-1">
                      {(profile?.certifications ?? []).map((c, idx) => (
                        <div key={c.id ?? idx} className="flex justify-between">
                          <p className="text-xs text-gray-800 font-medium">{c.name}</p>
                          <p className="text-[10px] text-gray-500">{[c.issuer, c.year].filter(Boolean).join(", ")}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
