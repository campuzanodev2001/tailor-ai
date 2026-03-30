import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

type Action = "pc" | "os"; // parseCv | optimizeSummary

const DAILY_LIMITS: Record<Action, number> = {
  pc:  5, // parse-cv
  os: 20, // optimize-summary
};

/**
 * Atomically increments the daily counter for a user+action.
 * Returns false if the limit is already reached.
 */
export async function checkRateLimit(uid: string, action: Action): Promise<boolean> {
  const today   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const limit   = DAILY_LIMITS[action];
  const userRef = adminDb.collection("users").doc(uid);
  let allowed   = false;

  await adminDb.runTransaction(async (tx) => {
    const snap  = await tx.get(userRef);
    const count = (snap.data()?.rl?.[today]?.[action] ?? 0) as number;
    if (count < limit) {
      tx.update(userRef, { [`rl.${today}.${action}`]: FieldValue.increment(1) });
      allowed = true;
    }
  });

  return allowed;
}
