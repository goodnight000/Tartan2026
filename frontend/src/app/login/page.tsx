"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrustBadge } from "@/components/TrustBadge";
import { useToast } from "@/components/ui/toast";
import { auth } from "@/lib/firebase";
import { getProfile } from "@/lib/firestore";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";

export default function LoginPage() {
  const router = useRouter();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const emailId = useId();
  const passwordId = useId();

  const validate = () => {
    const errs: typeof errors = {};
    if (!email.includes("@")) errs.email = "Please enter a valid email address";
    if (password.length < 6) errs.password = "Password must be at least 6 characters";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setPending(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const profile = await getProfile(result.user.uid);
      push({ title: "Welcome back", variant: "success" });
      router.push(profile ? "/app" : "/onboarding");
    } catch (error) {
      push({ title: "Login Failed", description: (error as Error).message, variant: "error" });
    } finally {
      setPending(false);
    }
  };

  const handleSignup = async () => {
    if (!validate()) return;
    setPending(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (result.user?.uid) {
        push({ title: "Account Created", description: "Let's set up your profile.", variant: "success" });
        router.push("/onboarding");
      }
    } catch (error) {
      push({ title: "Signup Failed", description: (error as Error).message, variant: "error" });
    } finally {
      setPending(false);
    }
  };

  const handleReset = async () => {
    try {
      if (!email) {
        push({ title: "Enter Email First", variant: "warning" });
        return;
      }
      await sendPasswordResetEmail(auth, email);
      push({ title: "Reset Email Sent", description: "Check your inbox for a password reset link.", variant: "success" });
    } catch (error) {
      push({ title: "Reset Failed", description: (error as Error).message, variant: "error" });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <Card className="reveal space-y-5 p-8">
        <p className="editorial-eyebrow">Entry Gate</p>
        <h1 className="panel-title text-[clamp(2.3rem,6vw,4.2rem)] leading-[0.88]">
          Secure your care cockpit in under a minute.
        </h1>
        <p className="panel-subtitle text-base">
          Session continuity, consent receipts, and medical context integrity start with authenticated identity.
        </p>
        <TrustBadge variant="block" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/75 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]">
              PHI-Aware Routing
            </p>
            <p className="mt-2 text-sm text-[color:var(--cp-text)]">User-scoped data context across intake, chat, actions, and reminders.</p>
          </div>
          <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/75 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]">
              Trust Signals
            </p>
            <p className="mt-2 text-sm text-[color:var(--cp-text)]">Action confirmations and status logs are always attached to your account.</p>
          </div>
        </div>
      </Card>

      <Card className="reveal space-y-4 p-8" style={{ animationDelay: "90ms" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[color:var(--cp-primary-soft)]">
            <Lock className="h-4 w-4 text-[color:var(--cp-primary)]" aria-hidden="true" />
          </div>
          <div>
            <p className="editorial-eyebrow">Access</p>
            <h2 className="text-4xl leading-none">Welcome Back</h2>
          </div>
        </div>
        <Tabs defaultValue="login">
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">
              Log In
            </TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">
              Create Account
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleLogin();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor={emailId}>Email</Label>
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setErrors((e) => ({ ...e, email: undefined })); }}
                  required
                  aria-invalid={errors.email ? "true" : undefined}
                  aria-describedby={errors.email ? `${emailId}-error` : undefined}
                />
                {errors.email && (
                  <p id={`${emailId}-error`} className="text-xs text-[color:var(--cp-danger)]">{errors.email}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={passwordId}>Password</Label>
                <Input
                  id={passwordId}
                  type="password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setErrors((e) => ({ ...e, password: undefined })); }}
                  required
                  aria-invalid={errors.password ? "true" : undefined}
                  aria-describedby={errors.password ? `${passwordId}-error` : undefined}
                />
                {errors.password && (
                  <p id={`${passwordId}-error`} className="text-xs text-[color:var(--cp-danger)]">{errors.password}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" loading={pending}>
                  Log In
                </Button>
                <Button type="button" variant="ghost" onClick={handleReset}>
                  Forgot Password
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSignup();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor={`${emailId}-signup`}>Email</Label>
                <Input
                  id={`${emailId}-signup`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${passwordId}-signup`}>Password</Label>
                <Input
                  id={`${passwordId}-signup`}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                {password.length > 0 && password.length < 6 && (
                  <p className="text-xs text-[color:var(--cp-warn)]">
                    {password.length < 6 ? "Too short — need at least 6 characters" : ""}
                  </p>
                )}
              </div>
              <Button type="submit" loading={pending}>
                Create Account
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
