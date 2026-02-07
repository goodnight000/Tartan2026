"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabaseClient";
import { authorizedFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { push } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" }
  });

  const handlePostAuth = async () => {
    const response = await authorizedFetch("/profile");
    if (!response.ok) {
      router.push("/onboarding");
      return;
    }
    const data = (await response.json()) as { user_id?: string };
    if (data?.user_id) {
      router.push("/app");
    } else {
      router.push("/onboarding");
    }
  };

  const handleLogin = async (values: FormValues) => {
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      push({ title: "Login failed", description: error.message });
      return;
    }
    push({ title: "Welcome back" });
    await handlePostAuth();
  };

  const handleSignup = async (values: FormValues) => {
    const { error } = await supabase.auth.signUp(values);
    if (error) {
      push({ title: "Signup failed", description: error.message });
      return;
    }
    push({ title: "Account created", description: "Continue onboarding." });
    router.push("/onboarding");
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
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <form className="space-y-4" onSubmit={form.handleSubmit(handleLogin)}>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" {...form.register("email")} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" {...form.register("password")} />
              </div>
              <Button type="submit">Login</Button>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form className="space-y-4" onSubmit={form.handleSubmit(handleSignup)}>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" {...form.register("email")} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" {...form.register("password")} />
              </div>
              <Button type="submit">Create account</Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
