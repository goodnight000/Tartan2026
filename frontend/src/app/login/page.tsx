"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { auth } from "@/lib/firebase";
import { getProfile } from "@/lib/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";

export default function LoginPage() {
  const router = useRouter();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const profile = await getProfile(result.user.uid);
      if (profile) {
        router.push("/app");
      } else {
        router.push("/onboarding");
      }
    } catch (error) {
      push({ title: "Login failed", description: (error as Error).message });
    }
  };

  const handleSignup = async () => {
    try {
      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      if (result.user?.uid) {
        router.push("/onboarding");
      }
    } catch (error) {
      push({ title: "Signup failed", description: (error as Error).message });
    }
  };

  const handleReset = async () => {
    try {
      if (!email) {
        push({ title: "Enter email first" });
        return;
      }
      await sendPasswordResetEmail(auth, email);
      push({ title: "Password reset sent" });
    } catch (error) {
      push({ title: "Reset failed", description: (error as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Login</h1>
        <p className="text-slate-600">
          Use email + password for your MedClaw account.
        </p>
      </header>
      <Card>
        <Tabs defaultValue="login">
          <TabsList>
            <TabsTrigger value="login">Log in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={handleLogin}>Log in</Button>
                <Button variant="ghost" onClick={handleReset}>
                  Forgot password
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="signup">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button onClick={handleSignup}>Create account</Button>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
