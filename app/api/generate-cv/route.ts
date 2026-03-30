import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { GEMINI_MODEL_CHAIN } from "@/lib/ai";
import { FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { CVData, JDAnalysis } from "@/types";
import { calculateATSScore } from "@/utils/atsScore";

export const maxDuration = 60;

const MAX_JD_LENGTH    = 15_000;
const MAX_ATS_KEYWORDS = 30;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  // Auth
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobDescription, jdAnalysis } = await req.json() as {
    jobDescription: string;
    jdAnalysis: JDAnalysis;
  };

  if (!jobDescription || !jdAnalysis) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (typeof jobDescription !== "string" || jobDescription.length > MAX_JD_LENGTH) {
    return NextResponse.json({ error: "jobDescription too long" }, { status: 400 });
  }

  // Cap jdAnalysis arrays to prevent prompt inflation
  if (Array.isArray(jdAnalysis.atsKeywords)) {
    jdAnalysis.atsKeywords = jdAnalysis.atsKeywords.slice(0, MAX_ATS_KEYWORDS);
  }
  if (Array.isArray(jdAnalysis.requiredSkills)) {
    jdAnalysis.requiredSkills = jdAnalysis.requiredSkills.slice(0, 20);
  }
  if (Array.isArray(jdAnalysis.niceToHave)) {
    jdAnalysis.niceToHave = jdAnalysis.niceToHave.slice(0, 10);
  }

  // Check + decrement quota in transaction
  const userRef = adminDb.collection("users").doc(uid);
  let profile: FirebaseFirestore.DocumentData = {};

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      profile    = snap.data() ?? {};
      const credits = profile.cvCredits ?? 0;
      if (!profile.unlimited && credits <= 0) {
        throw new Error("QUOTA_EXCEEDED");
      }
      if (!profile.unlimited) {
        tx.update(userRef, { cvCredits: FieldValue.increment(-1) });
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "QUOTA_EXCEEDED") {
      return NextResponse.json({ error: "No credits remaining" }, { status: 402 });
    }
    throw err;
  }

  // Generate CV with Gemini
  const profileSummary = JSON.stringify({
    name:        profile!.name,
    email:       profile!.email,
    phone:       profile!.phone,
    linkedin:    profile!.linkedin ?? null,
    location:    profile!.location ?? null,
    title:       profile!.title,
    description: profile!.shortDescription,
    skills:      [...(profile!.hardSkills ?? []), ...(profile!.softSkills ?? [])],
    experience:  profile!.experience,
    education:   profile!.education,
    projects:    profile!.projects ?? [],
  });

  const prompt = `
You are an expert CV writer. Using the candidate profile and job analysis below, create a tailored CV.
Respond ONLY with valid JSON, no markdown.

Candidate Profile:
${profileSummary}

Job Analysis:
${JSON.stringify(jdAnalysis)}

Job Description:
${jobDescription}

Return this exact JSON structure:
{
  "contact_info": {
    "name": "Full Name",
    "title": "Professional title tailored to the role (e.g. Senior Frontend Developer)",
    "email": "email",
    "phone": "phone",
    "location": "location",
    "linkedin": "linkedin url or null",
    "portfolio": "portfolio url or null"
  },
  "description": "3-4 sentence tailored professional summary using ATS keywords from the job",
  "experience": [
    {
      "role": "Job Title",
      "company": "Company Name",
      "startDate": "Month Year",
      "endDate": "Month Year or Present",
      "location": "City, Country",
      "bullets": ["Achievement 1 with metrics", "Achievement 2"]
    }
  ],
  "education": [
    {
      "degree": "Degree",
      "institution": "University Name",
      "field": "Field of Study",
      "year": "Graduation Year"
    }
  ],
  "additional_info": {
    "skills": "Comma-separated relevant skills matching the job",
    "languages": "Languages if applicable"
  },
  "projects": [
    {
      "name": "Project name",
      "description": "1-2 sentence description tailored to show relevance to the role",
      "tech": ["Tech1", "Tech2"]
    }
  ]
}

Rules:
- Tailor all content to match the job's ATS keywords: ${jdAnalysis.atsKeywords.join(", ")}
- Write in ${jdAnalysis.lang === "es" ? "Spanish" : "English"}
- Use strong action verbs and quantifiable achievements
- Keep bullet points concise and impactful
- Only include projects from the candidate profile; if there are none, return "projects": []
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
        const status = (err as { status?: number })?.status;
        if ((status === 429 || status === 503) && i < GEMINI_MODEL_CHAIN.length - 1) continue;
        throw err;
      }
    }

    const start = rawText.indexOf("{");
    const end   = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in response");
    const cvData: CVData = JSON.parse(rawText.slice(start, end + 1));

    // Calculate ATS score
    const { score, matched, missing } = calculateATSScore(cvData, jdAnalysis);

    // Save to history
    const cvId   = nanoid();
    const histRef = adminDb
      .collection("users")
      .doc(uid)
      .collection("cvHistory")
      .doc(cvId);

    await histRef.set({
      cvData,
      jobDescription,
      jdAnalysis,
      lang:            jdAnalysis.lang,
      createdAt:       FieldValue.serverTimestamp(),
      role:            jdAnalysis.role,
      company:         jdAnalysis.company ?? null,
      atsScore:        score,
      matchedKeywords: matched,
      missingKeywords: missing,
    });

    // Update lastCvAt
    await userRef.update({ lastCvAt: FieldValue.serverTimestamp() });

    return NextResponse.json({ cvData, atsScore: score, matched, missing, cvId, modelUsed });
  } catch (err: unknown) {
    console.error("generate-cv error:", err);
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json(
        { error: "Daily AI quota exhausted on all models. Try again tomorrow." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "CV generation failed" }, { status: 500 });
  }
}
