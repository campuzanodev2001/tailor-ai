import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { GEMINI_MODEL_CHAIN } from "@/lib/ai";
import { FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { CVData, JDAnalysis } from "@/types";
import { calculateATSScore } from "@/utils/atsScore";
import { validateCVData } from "@/utils/validateCV";

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
    linkedin:    profile!.linkedin  ?? null,
    portfolio:   profile!.portfolio ?? null,
    location:    profile!.location  ?? null,
    title:       profile!.title,
    description: profile!.shortDescription,
    skills:      [...(profile!.hardSkills ?? []), ...(profile!.softSkills ?? [])],
    experience:  profile!.experience,
    education:   profile!.education,
    projects:    profile!.projects ?? [],
  });

  const today = new Date().toISOString().split("T")[0];

  const prompt = `
You are an expert CV writer. Using the candidate profile and job analysis below, create a tailored CV.
Respond ONLY with valid JSON, no markdown.
Today's date: ${today}

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
    "linkedin": "linkedin url from candidate profile or null",
    "portfolio": "portfolio url from candidate profile or null"
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
- Keep bullet points concise and impactful: 3-6 bullets per role, most job-relevant first
- Only include projects from the candidate profile; if there are none, return "projects": []
- Calculate total years of professional experience from the experience[].startDate and experience[].endDate fields using today's date for any "Present" entries; use that figure when writing the description

NEVER INVENT. This CV is submitted to real employers under the candidate's name;
an invented detail is a lie told on their behalf. Every fact must already exist
in the candidate profile above.
- Reproduce these EXACTLY as given, character for character: name, email, phone,
  location, linkedin, portfolio, company names, job titles, start and end dates,
  institution names, degrees. Never reword, translate, correct or complete them.
  If a field is absent from the profile, omit it — never fill the gap.
- Rewrite bullets only from achievements the profile already states. You may
  rephrase, merge, reorder, and shift emphasis toward the job. You may not add
  an achievement, a responsibility, a team size, a metric, a percentage, a
  client or a technology that is not there.
- Never state or imply a skill, tool or framework the candidate's profile does
  not list, even when the job asks for it. Missing requirements stay missing.
- Never invent employers, roles, dates, certifications or degrees, and never
  stretch dates to close an employment gap.
- Every number in the output must appear in the profile. If the profile has no
  metric for an achievement, write it without one.
- "additional_info.skills" may only contain skills present in the profile,
  ordered by relevance to the job.
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

    // Never persist or return a CV that invented facts about the candidate.
    const issues = validateCVData(cvData, {
      email:     profile.email,
      phone:     profile.phone,
      linkedin:  profile.linkedin,
      portfolio: profile.portfolio,
      companies: (profile.experience ?? []).map(
        (e: { company?: string }) => e.company ?? "",
      ).filter(Boolean),
    });
    if (issues.length > 0) {
      console.error("generate-cv validation failed:", issues);
      // The credit was taken before generation — give it back.
      if (!profile.unlimited) {
        await userRef.update({ cvCredits: FieldValue.increment(1) });
      }
      return NextResponse.json(
        {
          error: "Generated CV failed validation and was discarded. Your credit was not consumed.",
          issues,
        },
        { status: 502 },
      );
    }

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
