"use client";

import { useState, useEffect, useRef } from "react";
import { useJDAnalysis } from "@/hooks/useJDAnalysis";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { useUserQuota } from "@/hooks/useUserQuota";
import { CVPreview } from "@/components/cv/CVPreview";
import { CVData, JDAnalysis } from "@/types";
import { auth } from "@/lib/firebase";

type LangMode = "auto" | "es" | "en";

export default function GeneratePage() {
  const { profile, updateProfile } = useUserProfile();
  const { credits, hasQuota } = useUserQuota();
  const {
    analysis,
    setAnalysis,
    loading: analyzing,
    error: analysisError,
    modelUsed: analyzeModelUsed,
    analyze,
  } = useJDAnalysis();

  const [jd, setJd] = useState("");
  const [langMode, setLangMode] = useState<LangMode>("auto");
  const [cvData, setCvData] = useState<CVData | null>(null);
  const [atsScore, setAtsScore] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [manualEdit, setManualEdit] = useState(false);
  const [mobileTab, setMobileTab] = useState<"input" | "preview">("input");
  const [justMoved, setJustMoved] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState(false);
  const analysisRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to analysis results on mobile when analysis is ready
  useEffect(() => {
    if (analysis && window.innerWidth < 768) {
      setTimeout(() => {
        analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [analysis]);

  // Pre-fill from dashboard Quick Tailor
  useEffect(() => {
    const stored = sessionStorage.getItem("quickJD");
    if (stored) {
      setJd(stored);
      sessionStorage.removeItem("quickJD");
    }
  }, []);

  function addSkillToProfile(skill: string) {
    const current = profile?.hardSkills ?? [];
    if (current.map((s) => s.toLowerCase()).includes(skill.toLowerCase())) return;
    updateProfile({ hardSkills: [...current, skill] });

    // Patch analysis locally — move from missing → matched, recalculate score
    if (!analysis?.profileFit) return;
    const fit = analysis.profileFit;
    const newMissing  = fit.missingSkills.filter((s) => s !== skill);
    const newMatched  = [...fit.matchedSkills, skill];
    const total       = newMissing.length + newMatched.length;
    const newScore    = total > 0
      ? Math.min(99, Math.round(40 + (newMatched.length / total) * 60))
      : fit.score;
    const newLabel =
      newScore >= 75 ? "Excellent match" :
      newScore >= 50 ? "Good candidate"  :
      newScore >= 25 ? "Partial match"   : "Weak match";

    setAnalysis({
      ...analysis,
      profileFit: { ...fit, score: newScore, label: newLabel, matchedSkills: newMatched, missingSkills: newMissing },
    });
    setJustMoved((prev) => new Set(prev).add(skill));
    setTimeout(() => setJustMoved((prev) => { const n = new Set(prev); n.delete(skill); return n; }), 900);
  }

  function removeSkillFromProfile(skill: string) {
    const current = profile?.hardSkills ?? [];
    updateProfile({ hardSkills: current.filter((s) => s !== skill) });

    if (!analysis?.profileFit) return;
    const fit = analysis.profileFit;
    const newMatched  = fit.matchedSkills.filter((s) => s !== skill);
    const newMissing  = [...fit.missingSkills, skill];
    const total       = newMissing.length + newMatched.length;
    const newScore    = total > 0
      ? Math.min(99, Math.round(40 + (newMatched.length / total) * 60))
      : fit.score;
    const newLabel =
      newScore >= 75 ? "Excellent match" :
      newScore >= 50 ? "Good candidate"  :
      newScore >= 25 ? "Partial match"   : "Weak match";

    setAnalysis({
      ...analysis,
      profileFit: { ...fit, score: newScore, label: newLabel, matchedSkills: newMatched, missingSkills: newMissing },
    });
    setJustMoved((prev) => new Set(prev).add(skill));
    setTimeout(() => setJustMoved((prev) => { const n = new Set(prev); n.delete(skill); return n; }), 900);
  }

  async function handleAnalyze() {
    if (!jd.trim()) return;
    setCvData(null);
    setAtsScore(null);
    setAnalysis(null);
    setModelUsed(null);
    await analyze(jd, langMode);
  }

  async function handleGenerate() {
    if (!hasQuota || !analysis) return;
    setGenerating(true);
    setGenError(null);
    if (window.innerWidth < 768) setMobileTab("preview");
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/generate-cv", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobDescription: jd, jdAnalysis: analysis }),
      });

      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg ?? "Generation failed");
      }

      const data = await res.json();
      setCvData(data.cvData);
      setAtsScore(data.atsScore ?? null);
      setModelUsed(data.modelUsed ?? null);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate CV");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadPDF() {
    if (!cvData) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cvData }),
      });
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const namePart  = cvData.contact_info.name.replace(/\s+/g, "-").toLowerCase();
      const rolePart  = (analysis?.role ?? "").replace(/\s+/g, "-").toLowerCase();
      const compPart  = (analysis?.company ?? "").replace(/\s+/g, "-").toLowerCase();
      const parts     = [namePart, rolePart, compPart].filter(Boolean);
      a.download = `cv-${parts.join("_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // fall back to client-side
      const { generatePDF } = await import("@/utils/generatePDF");
      generatePDF(cvData, { role: analysis?.role, company: analysis?.company });
    }
  }

  const activeModel = modelUsed ?? analyzeModelUsed;

  function formatModelName(model: string) {
    return model
      .replace(/^gemini-/, "Gemini ")
      .replace(/-preview$/, "")
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  return (
    <div className="flex flex-col md:flex-row md:h-screen overflow-hidden bg-background">

      {/* ── MOBILE TAB BAR ── */}
      <div className="md:hidden flex shrink-0 border-b border-outline-variant/10 bg-surface sticky top-0 z-20">
        {(["input", "preview"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-colors relative ${
              mobileTab === tab
                ? "text-primary border-b-2 border-primary"
                : "text-outline"
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {tab === "input" ? "tune" : "description"}
            </span>
            {tab === "input" ? "Configure" : "Preview"}
            {tab === "preview" && cvData && mobileTab !== "preview" && (
              <span className="absolute top-2.5 right-[calc(50%-28px)] w-1.5 h-1.5 rounded-full bg-tertiary" />
            )}
          </button>
        ))}
      </div>

      {/* ── LEFT PANEL (45%) ── */}
      <section className={`w-full md:w-[45%] md:h-full flex flex-col bg-surface border-r border-outline-variant/5 overflow-y-auto ${mobileTab === "preview" ? "hidden md:flex" : "flex"}`}>
        <header className="p-4 sm:p-8 pb-0">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl sm:text-3xl font-headline font-extrabold tracking-tight text-white">
              Tailor Content
            </h2>
            {(analyzing || generating) ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/20 text-[10px] font-bold text-outline animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                thinking...
              </span>
            ) : activeModel ? (
              <div className="relative group/model">
                <span
                  key={activeModel}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/20 text-[10px] font-bold text-primary cursor-default select-none animate-in fade-in duration-300"
                >
                  <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>
                    auto_awesome
                  </span>
                  {formatModelName(activeModel)}
                </span>
                <div className="absolute left-0 top-full mt-1.5 z-50 w-64 hidden group-hover/model:block">
                  <div className="bg-surface-container-highest border border-outline-variant/20 rounded-xl p-3 shadow-xl text-xs text-on-surface-variant leading-relaxed">
                    Tailor AI always tries to use the most capable Gemini model available. If it hits a rate limit, it automatically falls back to the next best option.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <p className="text-on-surface-variant text-sm max-w-sm">
            Paste the job description and let the AI extract the critical
            requirements for your CV.
          </p>
        </header>

        <div className="p-4 sm:p-8 flex flex-col gap-6 sm:gap-8">
          {/* JD Input */}
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-tertiary/20 rounded-xl blur opacity-20 group-focus-within:opacity-40 transition duration-500" />
            <div className="relative bg-surface-container-low rounded-xl p-6 border-b-2 border-outline-variant/20 focus-within:border-primary focus-within:duration-0 transition-colors">
              {/* Lang toggle */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex bg-surface-container-high p-1 rounded-full gap-1">
                  {(["auto", "es", "en"] as LangMode[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLangMode(l)}
                      className={`px-3 py-1 text-[10px] font-label font-bold rounded-full transition-colors ${
                        langMode === l
                          ? "bg-primary text-on-primary"
                          : "text-outline hover:text-white"
                      }`}
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={async () => {
                      setJd("");
                      const text = await navigator.clipboard.readText();
                      if (!text) return;
                      setJd(text);
                      setPasted(true);
                      setTimeout(() => setPasted(false), 1500);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-outline hover:text-white transition-colors rounded-lg hover:bg-surface-container-high text-[10px] font-label"
                    aria-label="Paste from clipboard"
                  >
                    <span className={`material-symbols-outlined text-sm transition-colors ${pasted ? "text-tertiary" : ""}`}>
                      {pasted ? "check" : "content_paste"}
                    </span>
                    <span className={`transition-colors ${pasted ? "text-tertiary" : ""}`}>
                      {pasted ? "Pasted" : "Paste"}
                    </span>
                  </button>
                  <button
                    onClick={() => setJd("")}
                    className="p-1 text-outline hover:text-white transition-colors"
                    aria-label="Clear input"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              </div>
              <textarea
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                className="w-full bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-outline/50 resize-none min-h-[200px] font-body text-base leading-relaxed"
                placeholder="Paste job description here..."
              />
            </div>
          </div>

          {/* Analyze Button */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !jd.trim()}
            className="flex items-center justify-center gap-2 py-4 bg-surface-container-high border border-outline-variant/20 rounded-xl text-white font-bold tracking-tight hover:bg-surface-container-highest transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-primary group-hover:rotate-12 transition-transform">
              analytics
            </span>
            {analyzing ? "Analyzing..." : "Analyze Requirements"}
          </button>

          {analysisError && (
            <p className="text-xs text-error bg-error-container/20 px-3 py-2 rounded-lg">
              {analysisError}
            </p>
          )}

          {/* Analysis Results */}
          {analysis && (
            <div ref={analysisRef} className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-label uppercase tracking-widest text-outline">
                  Analysis Results
                </h3>
                <span className="flex items-center gap-1.5 px-2 py-0.5 bg-tertiary/10 text-tertiary rounded text-[10px] font-bold">
                  <span
                    className="material-symbols-outlined text-xs"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    bolt
                  </span>
                  AI OPTIMIZED
                </span>
              </div>

              <div className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 space-y-6">
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1.5 bg-secondary-container text-on-secondary-container rounded-full text-xs font-bold inline-flex items-center justify-center">
                    {analysis.role}
                  </span>
                  <span className="px-3 py-1.5 bg-surface-container-high text-primary rounded-full text-xs font-bold inline-flex items-center justify-center">
                    {analysis.seniority}
                  </span>
                  {analysis.company && (
                    <span className="px-3 py-1.5 bg-surface-container-high text-on-surface-variant rounded-full text-xs font-medium flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">business</span>
                      {analysis.company}
                    </span>
                  )}
                </div>

                {analysis.requiredSkills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-label text-outline mb-3 uppercase tracking-widest">
                      Core Skills Detected
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.requiredSkills.slice(0, 6).map((s) => (
                        <span
                          key={s}
                          className="px-2.5 py-1 bg-tertiary/20 text-tertiary rounded-lg text-xs"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {analysis.atsKeywords.length > 0 && (
                  <div>
                    <p className="text-[10px] font-label text-outline mb-3 uppercase tracking-widest">
                      ATS Keywords
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.atsKeywords.slice(0, 5).map((k) => (
                        <span
                          key={k}
                          className="px-2.5 py-1 border border-outline-variant/30 text-outline rounded-lg text-xs"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile Fit */}
              {analysis.profileFit && (() => {
                const fit = analysis.profileFit;
                const pct = fit.score;
                const color =
                  pct >= 75 ? "tertiary" :
                  pct >= 50 ? "primary"  :
                  pct >= 25 ? "secondary": "error";
                return (
                  <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-label text-outline uppercase tracking-widest">
                        Profile Fit
                      </p>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black text-${color}`}>{pct}</span>
                        <span className={`text-xs font-bold text-${color}/70`}>/100</span>
                      </div>
                    </div>

                    {/* Score bar */}
                    <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-${color} rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex items-start gap-2">
                      <span className={`material-symbols-outlined text-sm text-${color} mt-0.5`}
                        style={{ fontVariationSettings: "'FILL' 1" }}>
                        {pct >= 75 ? "verified" : pct >= 50 ? "thumb_up" : pct >= 25 ? "info" : "warning"}
                      </span>
                      <div>
                        <p className={`text-xs font-bold text-${color} mb-0.5`}>{fit.label}</p>
                        <p className="text-xs text-on-surface-variant leading-relaxed">{fit.summary}</p>
                      </div>
                    </div>

                    {fit.matchedSkills.length > 0 && (
                      <div>
                        <p className="text-[10px] font-label text-outline mb-2 uppercase tracking-widest">You have</p>
                        <div className="flex flex-wrap gap-1.5">
                          {fit.matchedSkills.map((s) => (
                            <div key={s} className="relative group/chip">
                              <button
                                onClick={() => removeSkillFromProfile(s)}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium border active:scale-95 transition-all flex items-center gap-1 cursor-pointer
                                  ${justMoved.has(s)
                                    ? "bg-tertiary/40 text-tertiary border-tertiary/60 scale-105"
                                    : "bg-tertiary/15 text-tertiary border-tertiary/20 hover:bg-error/15 hover:text-error hover:border-error/30"
                                  }`}
                              >
                                {s}
                                <span className="material-symbols-outlined text-[10px] opacity-60">remove_circle</span>
                              </button>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/chip:opacity-100 scale-95 group-hover/chip:scale-100 transition-all duration-150 pointer-events-none z-20">
                                <div className="bg-[#1a1a2e] border border-error/20 rounded-xl px-3 py-2 shadow-2xl shadow-black/40 flex items-center gap-2 whitespace-nowrap">
                                  <div className="w-5 h-5 rounded-full bg-error/20 flex items-center justify-center shrink-0">
                                    <span className="material-symbols-outlined text-error text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>remove</span>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-white tracking-wide">Click to remove from profile</p>
                                    <p className="text-[9px] text-error/70 font-medium">Updates your score instantly</p>
                                  </div>
                                </div>
                                <div className="flex justify-center -mt-px">
                                  <div className="w-2.5 h-2.5 bg-[#1a1a2e] border-r border-b border-error/20 rotate-45" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fit.missingSkills.length > 0 && (
                      <div>
                        <p className="text-[10px] font-label text-outline mb-2 uppercase tracking-widest">Missing</p>
                        <div className="flex flex-wrap gap-1.5">
                          {fit.missingSkills.map((s) => (
                            <div key={s} className="relative group/chip">
                              <button
                                onClick={() => addSkillToProfile(s)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border active:scale-95 transition-all cursor-pointer flex items-center gap-1
                                  ${justMoved.has(s)
                                    ? "bg-error/30 text-error border-error/60 scale-105"
                                    : "bg-error/10 text-error border-error/20 hover:bg-error/20 hover:border-error/40"
                                  }`}
                              >
                                <span className="material-symbols-outlined text-[10px] opacity-60">add_circle</span>
                                {s}
                              </button>
                              {/* Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/chip:opacity-100 scale-95 group-hover/chip:scale-100 transition-all duration-150 pointer-events-none z-20">
                                <div className="bg-[#1a1a2e] border border-primary/20 rounded-xl px-3 py-2 shadow-2xl shadow-black/40 flex items-center gap-2 whitespace-nowrap">
                                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                    <span className="material-symbols-outlined text-primary text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-white tracking-wide">Click to add to profile</p>
                                    <p className="text-[9px] text-primary/70 font-medium">Updates your profile instantly</p>
                                  </div>
                                </div>
                                {/* Arrow */}
                                <div className="flex justify-center -mt-px">
                                  <div className="w-2.5 h-2.5 bg-[#1a1a2e] border-r border-b border-primary/20 rotate-45" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Generate CTA */}
              <div className="pt-4 border-t border-outline-variant/10">
                {genError && (
                  <p className="text-xs text-error mb-3">{genError}</p>
                )}
                {!hasQuota && (
                  <p className="text-xs text-error mb-3">
                    No credits remaining. Upgrade to continue.
                  </p>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={generating || !hasQuota}
                  className="w-full py-5 bg-gradient-to-br from-primary to-primary-container text-on-primary-container font-black text-lg rounded-xl shadow-lg shadow-primary/10 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    auto_awesome
                  </span>
                  {generating ? "Generating..." : "Generate Tailored CV"}
                  <span className="text-xs bg-black/20 px-2 py-1 rounded-full font-label">
                    1 CREDIT
                  </span>
                </button>
                <p className="text-center text-xs text-outline mt-2">
                  {credits} credit{credits !== 1 ? "s" : ""} remaining
                </p>
                {modelUsed && modelUsed !== "gemini-3.1-pro-preview" && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-secondary/10 border border-secondary/20 rounded-lg">
                    <span className="material-symbols-outlined text-secondary text-base shrink-0">swap_horiz</span>
                    <p className="text-[11px] text-secondary leading-snug">
                      Using <span className="font-bold">{formatModelName(modelUsed)}</span> — best available model right now.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── RIGHT PANEL (55%) ── */}
      <section className={`w-full md:w-[55%] md:h-full flex flex-col bg-surface-container-lowest relative overflow-y-auto ${mobileTab === "input" ? "hidden md:flex" : "flex"}`}>
        {/* Decorative glows */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-tertiary/5 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative flex-1 flex flex-col items-center justify-start p-4 sm:p-8 md:p-12 min-h-max">
          {/* Top action bar */}
          <div className="w-full max-w-2xl mb-4 sm:mb-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="font-headline font-bold text-lg text-white">
                Live Preview
              </h3>
              {generating && (
                <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full border border-primary/20">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-[10px] font-label text-primary">GENERATING</span>
                </div>
              )}
              {modelUsed && !generating && !analyzing && (
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-mono font-bold ${
                    modelUsed === "gemini-3.1-pro-preview"
                      ? "bg-tertiary/10 border-tertiary/20 text-tertiary"
                      : "bg-secondary/10 border-secondary/20 text-secondary"
                  }`}
                  title={modelUsed}
                >
                  <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {modelUsed === "gemini-3.1-pro-preview" ? "bolt" : "swap_horiz"}
                  </span>
                  {formatModelName(modelUsed)}
                </div>
              )}
              {analyzing && !generating && (
                <div className="flex items-center gap-2 px-3 py-1 bg-secondary/10 rounded-full border border-secondary/20">
                  <div className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-[10px] font-label text-secondary">ANALYZING</span>
                </div>
              )}
              {cvData && !generating && !analyzing && (
                <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant/20">
                  <div className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
                  <span className="text-[10px] font-label text-tertiary">SYNCED</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button className="p-2 text-outline hover:text-white transition-colors">
                <span className="material-symbols-outlined">zoom_in</span>
              </button>
              <button className="p-2 text-outline hover:text-white transition-colors">
                <span className="material-symbols-outlined">print</span>
              </button>
            </div>
          </div>

          {generating ? (
            /* CV generation skeleton */
            <div className="w-full max-w-2xl shadow-2xl shadow-black/60">
              <div className="bg-white p-12 w-full">
                {/* Name */}
                <div className="flex flex-col items-center gap-3 pb-6 mb-6 border-b-2 border-gray-200">
                  <div className="h-8 w-56 bg-gray-200 rounded animate-pulse" />
                  <div className="h-3 w-80 bg-gray-100 rounded animate-pulse" />
                </div>
                {/* Summary */}
                <div className="mb-6 space-y-2">
                  <div className="h-2.5 w-32 bg-gray-200 rounded animate-pulse mb-4" />
                  <div className="h-2 w-full bg-gray-100 rounded animate-pulse" />
                  <div className="h-2 w-full bg-gray-100 rounded animate-pulse" />
                  <div className="h-2 w-3/4 bg-gray-100 rounded animate-pulse" />
                </div>
                {/* Experience */}
                <div className="mb-6 space-y-4">
                  <div className="h-2.5 w-40 bg-gray-200 rounded animate-pulse mb-4" />
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between">
                        <div className="h-3 w-48 bg-gray-200 rounded animate-pulse" />
                        <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
                      </div>
                      <div className="h-2 w-full bg-gray-100 rounded animate-pulse ml-3" />
                      <div className="h-2 w-5/6 bg-gray-100 rounded animate-pulse ml-3" />
                      <div className="h-2 w-4/5 bg-gray-100 rounded animate-pulse ml-3" />
                    </div>
                  ))}
                </div>
                {/* Education */}
                <div className="mb-6">
                  <div className="h-2.5 w-24 bg-gray-200 rounded animate-pulse mb-4" />
                  <div className="flex justify-between">
                    <div className="h-3 w-40 bg-gray-200 rounded animate-pulse" />
                    <div className="h-3 w-32 bg-gray-100 rounded animate-pulse" />
                  </div>
                </div>
                {/* Skills */}
                <div>
                  <div className="h-2.5 w-28 bg-gray-200 rounded animate-pulse mb-4" />
                  <div className="h-2 w-full bg-gray-100 rounded animate-pulse" />
                  <div className="h-2 w-2/3 bg-gray-100 rounded animate-pulse mt-2" />
                </div>
                {/* Shimmer overlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.8s_infinite] pointer-events-none" />
              </div>
              <p className="text-center text-xs text-outline mt-4 animate-pulse">
                AI is writing your tailored CV…
              </p>
            </div>
          ) : analyzing && !cvData ? (
            /* Analyzing empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-5">
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-6 bg-primary rounded-full animate-[bounce_1s_ease-in-out_infinite]"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-bold text-white">Analyzing requirements</p>
                  <p className="text-xs text-on-surface-variant">Extracting skills, keywords and seniority…</p>
                </div>
              </div>
            </div>
          ) : cvData ? (
            <>
              {/* CV Canvas */}
              <div className="relative w-full max-w-2xl shadow-2xl shadow-black/60 group">
                {/* ATS badge */}
                {atsScore != null && (
                  <div className="absolute -right-3 sm:-right-6 -top-3 sm:-top-6 z-10 w-14 sm:w-20 h-14 sm:h-20 bg-surface-container-highest border-4 border-surface-container-lowest rounded-full flex flex-col items-center justify-center shadow-xl">
                    <span className="text-[9px] sm:text-xs font-label text-outline uppercase tracking-tighter">
                      ATS
                    </span>
                    <span className="text-lg sm:text-2xl font-black text-tertiary">
                      {atsScore}
                    </span>
                  </div>
                )}
                <CVPreview cv={cvData} editable={manualEdit} onChange={setCvData} />
                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              </div>

              {/* Action bar below CV */}
              <div className="w-full max-w-2xl mt-6 md:mt-10 p-4 sm:p-6 bg-surface-container rounded-2xl border border-outline-variant/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-label text-outline uppercase tracking-wider">
                      Manual Edit
                    </span>
                    <button
                      onClick={() => setManualEdit((v) => !v)}
                      className={`w-12 h-6 rounded-full relative p-1 transition-colors ${
                        manualEdit
                          ? "bg-primary"
                          : "bg-surface-container-highest"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full shadow-sm transition-transform ${
                          manualEdit
                            ? "translate-x-6 bg-on-primary"
                            : "bg-outline"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="h-6 w-px bg-outline-variant/20" />
                  <div className="flex items-center gap-2 text-primary">
                    <span className="material-symbols-outlined text-sm">history</span>
                    <span className="text-xs font-bold">Latest</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button className="flex-1 sm:flex-none px-4 sm:px-6 py-2.5 bg-surface-container-high text-white font-bold rounded-lg border border-outline-variant/30 hover:bg-surface-container-highest transition-colors text-sm">
                    Share Link
                  </button>
                  <button
                    onClick={handleDownloadPDF}
                    className="flex-1 sm:flex-none px-4 sm:px-6 py-2.5 bg-white text-black font-black rounded-lg hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    Download PDF
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-24 h-24 mx-auto mb-6 bg-surface-container rounded-2xl border border-outline-variant/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-outline text-4xl">
                    description
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">No CV yet</h3>
                <p className="text-on-surface-variant text-sm max-w-xs mx-auto">
                  Paste a job description and analyze it, then generate your
                  tailored CV.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
