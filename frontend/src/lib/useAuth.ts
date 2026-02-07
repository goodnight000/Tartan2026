"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";
import { ensureLocalUser } from "@/lib/auth-local";
import type { AuthUser } from "@/lib/auth-helpers";

export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (firebaseEnabled && auth) {
      const unsub = onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        setLoading(false);
      });
      return () => unsub();
    }
    const localUser = ensureLocalUser();
    setUser(localUser);
    setLoading(false);
    return undefined;
  }, []);

  return { user, loading };
}
