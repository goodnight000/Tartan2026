"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { auth } from "@/lib/firebase";
import { getProfile } from "@/lib/firestore";
import { useToast } from "@/components/ui/toast";
import { EmailAuthProvider } from "firebase/auth";
import * as firebaseui from "firebaseui";

export default function LoginPage() {
  const router = useRouter();
  const { push } = useToast();

  useEffect(() => {
    const ui =
      firebaseui.auth.AuthUI.getInstance() || new firebaseui.auth.AuthUI(auth);

    ui.start("#firebaseui-auth-container", {
      signInFlow: "popup",
      signInOptions: [EmailAuthProvider.PROVIDER_ID],
      callbacks: {
        signInSuccessWithAuthResult: async (authResult) => {
          const userId = authResult.user?.uid;
          if (!userId) return false;
          const profile = await getProfile(userId);
          if (profile) {
            router.push("/app");
          } else {
            router.push("/onboarding");
          }
          return false;
        },
        signInFailure: (error) => {
          push({ title: "Login failed", description: error.message });
          return Promise.resolve();
        }
      }
    });
  }, [push, router]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Login</h1>
        <p className="text-slate-600">
          Use email + password for your MedClaw account.
        </p>
      </header>
      <Card>
        <div id="firebaseui-auth-container" />
      </Card>
    </div>
  );
}
