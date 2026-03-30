import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminAuth } from "@/lib/firebaseAdmin";
import { GEMINI_MODEL } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rateLimit";

export const maxDuration = 60;

const MAX_CONTEXT_LENGTH = 4_000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { context } = await req.json();
  if (!context) {
    return NextResponse.json({ error: "No context provided" }, { status: 400 });
  }
  if (context.length > MAX_CONTEXT_LENGTH) {
    return NextResponse.json({ error: "context too long" }, { status: 400 });
  }

  const allowed = await checkRateLimit(uid, "os");
  if (!allowed) {
    return NextResponse.json({ error: "Daily limit reached. Try again tomorrow." }, { status: 429 });
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `You are a professional CV writer. Based on the following profile context, write a compelling professional summary paragraph (3-4 sentences, max 80 words). Be specific, results-oriented, and professional. Return ONLY the summary text, no quotes, no explanations.

${context}`;

  try {
    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();
    return NextResponse.json({ summary });
  } catch (err) {
    console.error("optimize-summary error:", err);
    return NextResponse.json({ error: "Failed to optimize summary" }, { status: 500 });
  }
}
