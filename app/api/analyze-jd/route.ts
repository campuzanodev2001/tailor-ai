import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { JDAnalysis } from "@/types";
import { GEMINI_MODEL_CHAIN } from "@/lib/ai";
export const maxDuration = 60;

const MAX_JD_LENGTH = 15_000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get("authorization") ?? "";
  const token      = authHeader.replace("Bearer ", "");
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobDescription, lang = "auto" } = await req.json();
  if (!jobDescription?.trim()) {
    return NextResponse.json({ error: "jobDescription is required" }, { status: 400 });
  }
  if (jobDescription.length > MAX_JD_LENGTH) {
    return NextResponse.json({ error: "jobDescription too long" }, { status: 400 });
  }

  // Fetch user profile for fit analysis (best-effort — don't fail if missing)
  let profileSnippet: string | null = null;
  try {
    const snap = await adminDb.collection("users").doc(uid).get();
    const p    = snap.data();
    if (p) {
      profileSnippet = JSON.stringify({
        skills:          [...(p.hardSkills ?? []), ...(p.softSkills ?? [])],
        currentRole:     p.title ?? null,
        yearsExperience: (p.experience ?? []).length,
        recentTechStack: (p.experience?.[0]?.techStack ?? []).slice(0, 8),
      });
    }
  } catch { /* ignore */ }

  const fitSection = profileSnippet
    ? `
Also evaluate how well this candidate profile fits the job.
Candidate profile (JSON):
${profileSnippet}

Include a "profileFit" key in your response:
{
  "profileFit": {
    "score": <integer 0-100 reflecting overall fit>,
    "label": <one of: "Excelente match" | "Buen candidato" | "Match parcial" | "Débil match">,
    "summary": "<1-2 sentences assessing fit, written in the same language as the job description>",
    "matchedSkills": ["skills the candidate has that the job requires"],
    "missingSkills": ["required skills the candidate lacks"]
  }
}`
    : `Do NOT include a "profileFit" key.`;

  const langInstruction = lang === "auto"
    ? 'Detect the language of the job description. Set "lang" to "en" if the job is written in English, or "es" if written in Spanish.'
    : `Set "lang" to "${lang}".`;

  const prompt = `
Analyze this job description and extract structured information.
Respond ONLY with valid JSON, no markdown.
${langInstruction}

Job Description:
${jobDescription}

${fitSection}

Return this exact JSON structure (add profileFit only if instructed above):
{
  "role": "job title",
  "company": "company name or null",
  "seniority": "Junior|Mid|Senior|Lead|Staff|Principal",
  "requiredSkills": ["skill1", "skill2"],
  "niceToHave": ["skill1"],
  "atsKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "domain": "industry/domain (e.g. Fintech, Healthcare, SaaS)",
  "lang": "${lang === "auto" ? "<REQUIRED: detect the language of the job description — return 'en' if written in English, 'es' if written in Spanish>" : lang}",
  "rawSummary": "2-3 sentence summary of the role"
}
`;

  try {
    let rawText = "";
    let modelUsed = GEMINI_MODEL_CHAIN[0];
    for (let i = 0; i < GEMINI_MODEL_CHAIN.length; i++) {
      modelUsed = GEMINI_MODEL_CHAIN[i];
      try {
        const model  = genAI.getGenerativeModel({ model: modelUsed });
        const result = await model.generateContent(prompt);
        rawText = result.response.text().trim();
        break;
      } catch (err: unknown) {
        if (((err as { status?: number })?.status === 429 || (err as { status?: number })?.status === 503) && i < GEMINI_MODEL_CHAIN.length - 1) continue;
        throw err;
      }
    }

    const start = rawText.indexOf("{");
    const end   = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in response");
    const analysis: JDAnalysis = JSON.parse(rawText.slice(start, end + 1));

    // If user explicitly picked a language, override whatever Gemini returned
    if (lang !== "auto") {
      analysis.lang = lang as "es" | "en";
    }

    return NextResponse.json({ ...analysis, modelUsed });
  } catch (err: unknown) {
    console.error("analyze-jd error:", err);
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json(
        { error: "Daily AI quota exhausted on all models. Try again tomorrow." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
