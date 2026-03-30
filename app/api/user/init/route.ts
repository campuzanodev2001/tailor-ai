import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  let uid: string;
  let name: string;
  let email: string;
  let photoURL: string;

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid      = decoded.uid;
    name     = decoded.name     ?? "";
    email    = decoded.email    ?? "";
    photoURL = decoded.picture  ?? "";
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ref  = adminDb.collection("users").doc(uid);
  const snap = await ref.get();

  if (snap.exists()) {
    return NextResponse.json({ created: false });
  }

  await ref.set({
    name,
    email,
    photoURL,
    phone:          "",
    hardSkills:     [],
    softSkills:     [],
    languages:      [],
    experience:     [],
    education:      [],
    certifications: [],
    cvCredits:      5,
    plan:           "free",
    createdAt:      FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ created: true }, { status: 201 });
}
