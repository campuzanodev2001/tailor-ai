"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { nanoid } from "nanoid";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { useAuth } from "@/contexts/AuthContext";
import { AccordionSection } from "@/components/ui/AccordionSection";
import { SkillChip } from "@/components/ui/SkillChip";
import { UserProfile, Experience, Language, Project } from "@/types";

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
  const { profile, updateProfile, refreshProfile } = useUserProfile();
  const { user } = useAuth();

  // Local draft — initialized once from profile, all edits go here
  const [draft, setDraft] = useState<UserProfile | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    if (profile && !draft) setDraft(profile);
  }, [profile, draft]);

  // dirty=true for text-field edits (saved via button)
  // dirty=false for list ops that also call updateProfile immediately
  function updateDraft(patch: Partial<UserProfile>, dirty = true) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    if (dirty) setIsDirty(true);
  }

  // ── experience helpers ────────────────────────────────────────────────────
  // Text field changes: update draft only (saved with Save button)
  function updateDraftExp(idx: number, patch: Partial<Experience>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = toArr(prev.experience).map((e, i) =>
        i === idx ? { ...e, ...patch } : e
      ) as Experience[];
      return { ...prev, experience: next };
    });
  }

  // Structural changes (add/remove bullets/tech): update draft + save immediately
  function updateExpNow(idx: number, patch: Partial<Experience>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = toArr(prev.experience).map((e, i) =>
        i === idx ? { ...e, ...patch } : e
      ) as Experience[];
      updateProfile({ experience: next });
      return { ...prev, experience: next };
    });
  }

  // ── project helpers ───────────────────────────────────────────────────────
  function updateDraftProj(idx: number, patch: Partial<Project>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = (prev.projects ?? []).map((p, i) =>
        i === idx ? { ...p, ...patch } : p
      ) as Project[];
      return { ...prev, projects: next };
    });
  }

  function updateProjNow(idx: number, patch: Partial<Project>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = (prev.projects ?? []).map((p, i) =>
        i === idx ? { ...p, ...patch } : p
      ) as Project[];
      updateProfile({ projects: next });
      return { ...prev, projects: next };
    });
  }

  // ── save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await updateProfile(draft);
      await refreshProfile();
      setIsDirty(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  // ── CV upload ─────────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

      const mapped: Partial<UserProfile> = {};
      if (parsed.name             && !draft?.name)             mapped.name             = parsed.name;
      if (parsed.email            && !draft?.email)            mapped.email            = parsed.email;
      if (parsed.phone            && !draft?.phone)            mapped.phone            = parsed.phone;
      if (parsed.location         && !draft?.location)         mapped.location         = parsed.location;
      if (parsed.linkedin         && !draft?.linkedin)         mapped.linkedin         = parsed.linkedin;
      if (parsed.title            && !draft?.title)            mapped.title            = parsed.title;
      if (parsed.shortDescription && !draft?.shortDescription) mapped.shortDescription = parsed.shortDescription;

      if (Array.isArray(parsed.hardSkills) && parsed.hardSkills.length) {
        const existing = new Set(toArr(draft?.hardSkills ?? []).map((s) => s.toLowerCase()));
        const incoming = (parsed.hardSkills as string[]).filter((s) => !existing.has(s.toLowerCase()));
        if (incoming.length) mapped.hardSkills = [...toArr(draft?.hardSkills ?? []), ...incoming];
      }
      if (Array.isArray(parsed.softSkills) && parsed.softSkills.length) {
        const existing = new Set(toArr(draft?.softSkills ?? []).map((s) => s.toLowerCase()));
        const incoming = (parsed.softSkills as string[]).filter((s) => !existing.has(s.toLowerCase()));
        if (incoming.length) mapped.softSkills = [...toArr(draft?.softSkills ?? []), ...incoming];
      }
      if (Array.isArray(parsed.languages) && parsed.languages.length) {
        const existingLangs = new Set((draft?.languages ?? []).map((l) => l.name.toLowerCase()));
        const incoming = (parsed.languages as { name: string; level: string }[])
          .filter((l) => !existingLangs.has(l.name.toLowerCase()))
          .map((l) => ({ name: l.name, level: normalizeLanguageLevel(l.level) })) as Language[];
        if (incoming.length) mapped.languages = [...(draft?.languages ?? []), ...incoming];
      }
      if (Array.isArray(parsed.experience) && parsed.experience.length) {
        const existingKeys = new Set(
          toArr(draft?.experience ?? []).map((e) => `${e.company}|${e.role}`.toLowerCase())
        );
        const incoming = (parsed.experience as {
          company: string; role: string; startDate: string; endDate: string;
          location: string; achievements: string[]; techStack: string[];
        }[])
          .filter((e) => !existingKeys.has(`${e.company}|${e.role}`.toLowerCase()))
          .map((exp) => ({
            id: nanoid(), company: exp.company ?? "", role: exp.role ?? "",
            startDate: exp.startDate ?? "", endDate: exp.endDate ?? "Present",
            location: exp.location ?? "",
            achievements: Array.isArray(exp.achievements) ? exp.achievements : [],
            techStack: Array.isArray(exp.techStack) ? exp.techStack : [],
          })) as Experience[];
        if (incoming.length) mapped.experience = [...toArr(draft?.experience ?? []), ...incoming];
      }
      if (Array.isArray(parsed.education) && parsed.education.length) {
        const existingKeys = new Set(
          (draft?.education ?? []).map((e) => `${e.institution}|${e.degree}`.toLowerCase())
        );
        const incoming = (parsed.education as {
          institution: string; degree: string; field: string; startYear: string; endYear: string;
        }[])
          .filter((e) => !existingKeys.has(`${e.institution}|${e.degree}`.toLowerCase()))
          .map((edu) => ({
            id: nanoid(), institution: edu.institution ?? "", degree: edu.degree ?? "",
            field: edu.field ?? "", startYear: edu.startYear ?? "", endYear: edu.endYear ?? "",
          }));
        if (incoming.length) mapped.education = [...(draft?.education ?? []), ...incoming];
      }
      if (Array.isArray(parsed.certifications) && parsed.certifications.length) {
        const existingNames = new Set((draft?.certifications ?? []).map((c) => c.name.toLowerCase()));
        const incoming = (parsed.certifications as { name: string; issuer: string; year: string }[])
          .filter((c) => !existingNames.has(c.name.toLowerCase()))
          .map((c) => ({ id: nanoid(), name: c.name ?? "", issuer: c.issuer ?? "", year: c.year ?? "" }));
        if (incoming.length) mapped.certifications = [...(draft?.certifications ?? []), ...incoming];
      }

      // Apply to draft immediately (UI updates now), then persist and sync context
      setDraft((prev) => (prev ? { ...prev, ...mapped } : prev));
      await updateProfile(mapped);
      await refreshProfile();
      setIsDirty(false);
      setUploadMessage({ type: "success", text: "CV parsed and profile updated successfully." });
    } catch (err) {
      setUploadMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to parse CV." });
    } finally {
      setUploading(false);
      const el = document.getElementById("cv-file-input") as HTMLInputElement | null;
      if (el) el.value = "";
    }
  }

  // ── languages ─────────────────────────────────────────────────────────────
  const [newLangName, setNewLangName] = useState("");
  const [newLangLevel, setNewLangLevel] = useState<LanguageLevel>("intermediate");

  function addLanguage() {
    if (!newLangName.trim()) return;
    const existing = (draft?.languages ?? []).map((l) => l.name.toLowerCase());
    if (existing.includes(newLangName.trim().toLowerCase())) return;
    const updated = [...(draft?.languages ?? []), { name: newLangName.trim(), level: newLangLevel }];
    updateDraft({ languages: updated }, false);
    updateProfile({ languages: updated });
    setNewLangName("");
    setNewLangLevel("intermediate");
  }

  function removeLanguage(name: string) {
    const updated = (draft?.languages ?? []).filter((l) => l.name !== name);
    updateDraft({ languages: updated }, false);
    updateProfile({ languages: updated });
  }

  function updateLanguageLevel(name: string, level: LanguageLevel) {
    const updated = (draft?.languages ?? []).map((l) => l.name === name ? { ...l, level } : l);
    updateDraft({ languages: updated }, false);
    updateProfile({ languages: updated });
  }

  // ── skills ────────────────────────────────────────────────────────────────
  const [newHardSkill, setNewHardSkill] = useState("");
  const [newSoftSkill, setNewSoftSkill] = useState("");

  function addHardSkill() {
    if (!newHardSkill.trim()) return;
    const updated = [...toArr(draft?.hardSkills), newHardSkill.trim()];
    updateDraft({ hardSkills: updated }, false);
    updateProfile({ hardSkills: updated });
    setNewHardSkill("");
  }

  function removeHardSkill(skill: string) {
    const updated = toArr(draft?.hardSkills).filter((s) => s !== skill);
    updateDraft({ hardSkills: updated }, false);
    updateProfile({ hardSkills: updated });
  }

  function addSoftSkill() {
    if (!newSoftSkill.trim()) return;
    const updated = [...toArr(draft?.softSkills), newSoftSkill.trim()];
    updateDraft({ softSkills: updated }, false);
    updateProfile({ softSkills: updated });
    setNewSoftSkill("");
  }

  function removeSoftSkill(skill: string) {
    const updated = toArr(draft?.softSkills).filter((s) => s !== skill);
    updateDraft({ softSkills: updated }, false);
    updateProfile({ softSkills: updated });
  }

  // ── summary optimize ──────────────────────────────────────────────────────
  const [optimizingSummary, setOptimizingSummary] = useState(false);

  async function handleOptimizeSummary() {
    setOptimizingSummary(true);
    try {
      const token = await user?.getIdToken();
      const context = [
        draft?.title && `Title: ${draft.title}`,
        toArr(draft?.hardSkills).length && `Skills: ${toArr(draft?.hardSkills).join(", ")}`,
        toArr(draft?.experience).length && `Experience: ${toArr(draft?.experience).map((e) => `${e.role} at ${e.company}`).join("; ")}`,
        draft?.shortDescription && `Current summary: ${draft.shortDescription}`,
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/optimize-summary", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      if (!res.ok) throw new Error("Failed to optimize");
      const { summary } = await res.json();
      updateDraft({ shortDescription: summary });
      await updateProfile({ shortDescription: summary });
    } catch (err) {
      console.error("Optimize summary error:", err);
    } finally {
      setOptimizingSummary(false);
    }
  }

  // ── experience structural ops ──────────────────────────────────────────────
  function addExperience() {
    const blank: Experience = {
      id: nanoid(), company: "", role: "", startDate: "", endDate: "Present",
      location: "", achievements: [], techStack: [],
    };
    const updated = [...toArr(draft?.experience), blank];
    updateDraft({ experience: updated }, false);
    updateProfile({ experience: updated });
  }

  function deleteExperience(idx: number) {
    const updated = toArr(draft?.experience).filter((_, i) => i !== idx) as Experience[];
    updateDraft({ experience: updated }, false);
    updateProfile({ experience: updated });
  }

  // ── project structural ops ─────────────────────────────────────────────────
  function addProject() {
    const blank: Project = { id: nanoid(), name: "", description: "", url: "", tech: [] };
    const updated = [...(draft?.projects ?? []), blank];
    updateDraft({ projects: updated }, false);
    updateProfile({ projects: updated });
  }

  function deleteProject(idx: number) {
    const updated = (draft?.projects ?? []).filter((_, i) => i !== idx);
    updateDraft({ projects: updated }, false);
    updateProfile({ projects: updated });
  }

  return (
    <div className="flex min-h-screen bg-background">
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
              <div className="relative w-24 h-24 shrink-0 rounded-full overflow-hidden bg-surface-container-high ring-2 ring-primary/20">
                {draft?.photoURL ? (
                  <Image src={draft.photoURL} alt={draft.name ?? "Avatar"} fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl font-black text-on-surface-variant">
                    {draft?.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
              </div>
              <div>
                <h2 className="text-4xl font-headline font-extrabold tracking-tight text-white mb-1">
                  {draft?.name || "Your Name"}
                </h2>
                <p className="text-outline flex items-center gap-2 font-label">
                  <span className="material-symbols-outlined text-sm">location_on</span>
                  {[draft?.location, draft?.title].filter(Boolean).join(" • ") || "Add your location & title"}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 items-end">
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

              {/* Import CV — row propio */}
              <input
                id="cv-file-input"
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                className="hidden"
                onChange={handleCVUpload}
              />
              <button
                onClick={() => document.getElementById("cv-file-input")?.click()}
                disabled={uploading}
                className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-outline-variant/25 bg-surface-container text-on-surface-variant text-sm font-medium hover:bg-surface-container-high hover:border-outline-variant/50 hover:text-on-surface active:scale-[0.97] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                    Parsing...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base group-hover:translate-y-[-1px] transition-transform duration-150">upload_file</span>
                    Import CV
                  </>
                )}
              </button>

              {/* Save — siempre visible, desactivado cuando no hay cambios pendientes */}
              <button
                onClick={handleSave}
                disabled={!isDirty || saving}
                className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 active:scale-[0.97] select-none min-w-[152px]
                  ${isDirty || saving || savedOk
                    ? "bg-gradient-to-br from-primary to-primary-container text-on-primary-container shadow-[0_0_18px_rgba(192,193,255,0.22)] hover:shadow-[0_0_26px_rgba(192,193,255,0.38)] hover:scale-[1.03] disabled:hover:scale-100 cursor-pointer"
                    : "bg-surface-container border border-outline-variant/25 text-on-surface-variant opacity-40 cursor-not-allowed"
                  }`}
              >
                {saving ? (
                  <>
                    <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                    Saving...
                  </>
                ) : savedOk ? (
                  <>
                    <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    Saved!
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">save</span>
                    Save changes
                  </>
                )}
              </button>
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
                    <label className="text-xs font-label uppercase tracking-widest text-outline">{label}</label>
                    <input
                      type={type}
                      value={(draft?.[field] as string) ?? ""}
                      onChange={(e) => updateDraft({ [field]: e.target.value })}
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
                  value={draft?.shortDescription ?? ""}
                  onChange={(e) => updateDraft({ shortDescription: e.target.value })}
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
                <div>
                  <label className="text-xs font-label uppercase tracking-widest text-outline mb-4 block">Hard Skills</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {toArr(draft?.hardSkills).map((s) => (
                      <SkillChip key={s} label={s} variant="hard" onRemove={() => removeHardSkill(s)} />
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
                <div>
                  <label className="text-xs font-label uppercase tracking-widest text-outline mb-4 block">Soft Skills</label>
                  <div className="flex flex-wrap gap-2">
                    {toArr(draft?.softSkills).map((s) => (
                      <SkillChip key={s} label={s} variant="soft" onRemove={() => removeSoftSkill(s)} />
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
                {toArr(draft?.experience).map((exp, idx) => (
                  <div
                    key={exp.id ?? idx}
                    className="relative pl-8 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-[1px] before:bg-outline-variant/30"
                  >
                    <div className="absolute left-[-4px] top-2 w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(192,193,255,0.5)]" />
                    <button
                      type="button"
                      onClick={() => deleteExperience(idx)}
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
                          <label className="text-xs font-label uppercase tracking-widest text-outline">{label}</label>
                          <input
                            value={value ?? ""}
                            onChange={(e) => updateDraftExp(idx, { [field]: e.target.value })}
                            className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Achievements */}
                    <div className="space-y-4">
                      <label className="text-xs font-label uppercase tracking-widest text-outline">Achievements</label>
                      <ul className="space-y-2">
                        {(exp.achievements ?? []).map((a, ai) => (
                          <li key={ai} className="flex gap-3 items-center">
                            <span className="material-symbols-outlined text-outline text-sm shrink-0">drag_indicator</span>
                            <input
                              value={a}
                              onChange={(e) => {
                                const next = [...(exp.achievements ?? [])];
                                next[ai] = e.target.value;
                                updateDraftExp(idx, { achievements: next });
                              }}
                              className="flex-1 bg-surface-container-low border-none focus:ring-0 p-0 text-sm text-on-surface"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next = (exp.achievements ?? []).filter((_, i) => i !== ai);
                                updateExpNow(idx, { achievements: next });
                              }}
                              className="text-outline hover:text-error transition-colors shrink-0"
                            >
                              <span className="material-symbols-outlined text-xs">close</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => updateExpNow(idx, { achievements: [...(exp.achievements ?? []), ""] })}
                        className="text-xs text-primary font-bold flex items-center gap-1 mt-2"
                      >
                        <span className="material-symbols-outlined text-xs">add</span> Add Point
                      </button>
                    </div>

                    {/* Tech Stack */}
                    <div className="mt-6">
                      <label className="text-xs font-label uppercase tracking-widest text-outline mb-2 block">Tech Stack</label>
                      <div className="flex flex-wrap gap-2">
                        {(exp.techStack ?? []).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => updateExpNow(idx, { techStack: (exp.techStack ?? []).filter((s) => s !== t) })}
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
                                updateExpNow(idx, { techStack: [...(exp.techStack ?? []), val] });
                                e.currentTarget.value = "";
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}

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
            <AccordionSection title="Projects" isEmpty={!draft?.projects?.length} defaultOpen={false}>
              <div className="space-y-12">
                {(draft?.projects ?? []).map((proj, idx) => (
                  <div
                    key={proj.id ?? idx}
                    className="relative pl-8 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-[1px] before:bg-outline-variant/30"
                  >
                    <div className="absolute left-[-4px] top-2 w-2 h-2 rounded-full bg-tertiary shadow-[0_0_8px_rgba(192,255,193,0.4)]" />
                    <button
                      type="button"
                      onClick={() => deleteProject(idx)}
                      className="absolute top-0 right-0 text-outline hover:text-error transition-colors"
                      title="Remove project"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                      <div className="space-y-1">
                        <label className="text-xs font-label uppercase tracking-widest text-outline">Project Name</label>
                        <input
                          value={proj.name}
                          onChange={(e) => updateDraftProj(idx, { name: e.target.value })}
                          className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                          placeholder="My Awesome Project"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-label uppercase tracking-widest text-outline">URL (optional)</label>
                        <input
                          value={proj.url ?? ""}
                          onChange={(e) => updateDraftProj(idx, { url: e.target.value })}
                          className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all"
                          placeholder="https://github.com/..."
                        />
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-label uppercase tracking-widest text-outline">Description</label>
                        <textarea
                          value={proj.description}
                          onChange={(e) => updateDraftProj(idx, { description: e.target.value })}
                          rows={3}
                          className="w-full bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface px-0 py-2 transition-all resize-none"
                          placeholder="What does it do? What problem does it solve?"
                        />
                      </div>
                    </div>

                    {/* Tech Stack */}
                    <div>
                      <label className="text-xs font-label uppercase tracking-widest text-outline mb-2 block">Tech Stack</label>
                      <div className="flex flex-wrap gap-2">
                        {(proj.tech ?? []).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => updateProjNow(idx, { tech: (proj.tech ?? []).filter((s) => s !== t) })}
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
                                updateProjNow(idx, { tech: [...(proj.tech ?? []), val] });
                                e.currentTarget.value = "";
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}

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
                {(draft?.languages ?? []).length > 0 && (
                  <div className="space-y-2">
                    {(draft?.languages ?? []).map((lang) => (
                      <div key={lang.name} className="flex items-center gap-3">
                        <span className="flex-1 text-sm text-on-surface font-medium">{lang.name}</span>
                        <select
                          value={lang.level}
                          onChange={(e) => updateLanguageLevel(lang.name, e.target.value as LanguageLevel)}
                          className="bg-surface-container-low border-b border-outline-variant/20 focus:border-primary focus:ring-0 text-on-surface text-sm py-1 pr-2 transition-all"
                        >
                          {VALID_LANGUAGE_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl} className="capitalize">
                              {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                            </option>
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
            <AccordionSection title="Certifications" isEmpty={!draft?.certifications?.length} defaultOpen={false}>
              <p className="text-on-surface-variant text-sm">No certifications added yet.</p>
            </AccordionSection>
          </div>

          {/* Live CV Preview */}
          <div className="mt-20">
            <h4 className="text-xs font-label uppercase tracking-[0.2em] text-outline text-center mb-8">Live Preview</h4>
            <div className="bg-white rounded-lg shadow-2xl max-w-3xl mx-auto overflow-hidden">
              <div className="p-10 font-serif text-gray-900 leading-relaxed text-sm">

                {/* Header */}
                <div className="mb-6 pb-4 border-b border-gray-200">
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">{draft?.name || "Your Name"}</h2>
                  {draft?.title && (
                    <p className="text-sm text-indigo-600 font-medium mb-2">{draft.title}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    {[draft?.email, draft?.phone, draft?.location, draft?.linkedin].filter(Boolean).join("  •  ")}
                  </p>
                </div>

                {/* Summary */}
                {draft?.shortDescription && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2">Professional Summary</h3>
                    <p className="text-xs text-gray-700 leading-relaxed">{draft.shortDescription}</p>
                  </div>
                )}

                {/* Experience */}
                {toArr(draft?.experience).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 pb-1 border-b border-gray-200">Experience</h3>
                    <div className="space-y-5">
                      {toArr(draft?.experience).map((exp, idx) => (
                        <div key={exp.id ?? idx}>
                          <div className="flex justify-between items-baseline mb-0.5">
                            <h4 className="text-sm font-bold text-gray-900">{exp.role}</h4>
                            <span className="text-[10px] text-gray-500 shrink-0 ml-2">{exp.startDate} — {exp.endDate}</span>
                          </div>
                          <p className="text-xs text-gray-600 mb-1.5">{[exp.company, exp.location].filter(Boolean).join(" · ")}</p>
                          {toArr(exp.achievements).length > 0 && (
                            <ul className="list-disc list-outside ml-4 space-y-0.5">
                              {toArr(exp.achievements).map((a, i) => (
                                <li key={i} className="text-xs text-gray-700">{a}</li>
                              ))}
                            </ul>
                          )}
                          {toArr(exp.techStack).length > 0 && (
                            <p className="text-[10px] text-gray-400 mt-1.5">{exp.techStack.join(" · ")}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Projects */}
                {(draft?.projects ?? []).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 pb-1 border-b border-gray-200">Projects</h3>
                    <div className="space-y-3">
                      {(draft?.projects ?? []).map((proj, idx) => (
                        <div key={proj.id ?? idx}>
                          <div className="flex items-baseline justify-between mb-0.5">
                            <p className="text-xs font-bold text-gray-900">{proj.name}</p>
                            {proj.url && <span className="text-[10px] text-gray-400 truncate ml-2 max-w-[120px]">{proj.url}</span>}
                          </div>
                          {proj.description && <p className="text-xs text-gray-700 leading-relaxed mb-1">{proj.description}</p>}
                          {(proj.tech ?? []).length > 0 && <p className="text-[10px] text-gray-400">{proj.tech.join(" · ")}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Education */}
                {(draft?.education ?? []).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-3 pb-1 border-b border-gray-200">Education</h3>
                    <div className="space-y-3">
                      {(draft?.education ?? []).map((edu, idx) => (
                        <div key={edu.id ?? idx} className="flex justify-between items-baseline">
                          <div>
                            <p className="text-xs font-bold text-gray-900">{edu.degree}{edu.field ? ` · ${edu.field}` : ""}</p>
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
                {(toArr(draft?.hardSkills).length > 0 || toArr(draft?.softSkills).length > 0) && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 pb-1 border-b border-gray-200">Skills</h3>
                    {toArr(draft?.hardSkills).length > 0 && (
                      <p className="text-xs text-gray-700 mb-1">
                        <span className="font-semibold">Technical: </span>{toArr(draft?.hardSkills).join(", ")}
                      </p>
                    )}
                    {toArr(draft?.softSkills).length > 0 && (
                      <p className="text-xs text-gray-700">
                        <span className="font-semibold">Soft skills: </span>{toArr(draft?.softSkills).join(", ")}
                      </p>
                    )}
                  </div>
                )}

                {/* Languages */}
                {(draft?.languages ?? []).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 pb-1 border-b border-gray-200">Languages</h3>
                    <p className="text-xs text-gray-700">
                      {(draft?.languages ?? []).map((l) => `${l.name} (${l.level})`).join("  •  ")}
                    </p>
                  </div>
                )}

                {/* Certifications */}
                {(draft?.certifications ?? []).length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 mb-2 pb-1 border-b border-gray-200">Certifications</h3>
                    <div className="space-y-1">
                      {(draft?.certifications ?? []).map((c, idx) => (
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
