"use client";

import { useState } from "react";
import { JDAnalysis } from "@/types";
import { auth } from "@/lib/firebase";

export function useJDAnalysis() {
  const [analysis,   setAnalysis]   = useState<JDAnalysis | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [modelUsed,  setModelUsed]  = useState<string | null>(null);

  async function analyze(jobDescription: string, lang: "auto" | "es" | "en" = "auto") {
    setLoading(true);
    setError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/analyze-jd", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobDescription, lang }),
      });

      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg ?? "Analysis failed");
      }

      const { modelUsed: mu, ...data } = await res.json();
      setAnalysis(data as JDAnalysis);
      setModelUsed(mu ?? null);
      return data as JDAnalysis;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setAnalysis(null);
    setError(null);
    setModelUsed(null);
  }

  return { analysis, setAnalysis, loading, error, modelUsed, analyze, reset };
}
