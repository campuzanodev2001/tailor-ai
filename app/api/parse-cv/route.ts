import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminAuth } from "@/lib/firebaseAdmin";
import { GEMINI_MODEL } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rateLimit";

export const maxDuration = 60;

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

  const allowed = await checkRateLimit(uid, "pc");
  if (!allowed) {
    return NextResponse.json({ error: "Daily limit reached. Try again tomorrow." }, { status: 429 });
  }

  const formData = await req.formData();
  const file     = formData.get("cv") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const allowedTypes = ["application/pdf", "text/plain"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Only PDF or TXT files are supported" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `
You are an expert CV parser. Extract all information from this CV/resume and return ONLY valid JSON — no markdown, no explanations.

Return this exact JSON structure (use null for missing fields, empty arrays [] for missing lists):

{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "+1 555 000 0000",
  "location": "City, Country",
  "linkedin": "linkedin URL or null",
  "portfolio": "portfolio URL or null",
  "title": "Current job title or professional title",
  "shortDescription": "Professional summary paragraph (2-4 sentences)",
  "hardSkills": ["skill1", "skill2"],
  "softSkills": ["skill1", "skill2"],
  "languages": [
    { "name": "English", "level": "native" }
  ],
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "startDate": "Jan 2020",
      "endDate": "Present",
      "location": "City, Country or Remote",
      "achievements": ["Achievement 1", "Achievement 2"],
      "techStack": ["Tech1", "Tech2"]
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Bachelor of Science",
      "field": "Computer Science",
      "startYear": "2016",
      "endYear": "2020"
    }
  ],
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuer",
      "year": "2022"
    }
  ]
}

Rules:
- language levels must be exactly one of: "native", "fluent", "intermediate", "basic"
- dates should be "Month Year" format or "Present"
- hardSkills should include technical/tool skills only
- softSkills should include interpersonal/management skills only
- achievements should be concise bullet points, keep original wording
- techStack per experience entry (tools/languages used in that role)
`;

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: file.type as "application/pdf" | "text/plain",
          data:     base64,
        },
      },
      prompt,
    ]);

    const text    = result.response.text().trim();
    const cleaned = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    const parsed  = JSON.parse(cleaned);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("parse-cv error:", err);
    return NextResponse.json({ error: "Failed to parse CV" }, { status: 500 });
  }
}
