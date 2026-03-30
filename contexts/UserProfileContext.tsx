"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import {
  doc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./AuthContext";
import { UserProfile } from "@/types";

interface UserProfileContextValue {
  profile: UserProfile | null;
  loading: boolean;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const ref = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(ref, async (snap) => {
      if (snap.exists()) {
        setProfile({ uid: user.uid, ...snap.data() } as UserProfile);
        setLoading(false);
      } else {
        // Profile doesn't exist yet — init server-side (prevents client-side credit tampering)
        const idToken = await user.getIdToken();
        await fetch("/api/user/init", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        // onSnapshot will fire again once the server writes the doc
      }
    });

    return unsubscribe;
  }, [user]);

  async function updateProfile(data: Partial<UserProfile>) {
    if (!user) return;
    const ref = doc(db, "users", user.uid);
    await setDoc(ref, data, { merge: true });
  }

  return (
    <UserProfileContext.Provider value={{ profile, loading, updateProfile }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const ctx = useContext(UserProfileContext);
  if (!ctx) throw new Error("useUserProfile must be used within UserProfileProvider");
  return ctx;
}
