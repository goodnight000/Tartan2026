"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ChatPanel } from "@/components/ChatPanel";
import { consumeSSE } from "@/lib/sse";
import { useChatStore } from "@/store/chat";
import { useToast } from "@/components/ui/toast";
import type { Reminder } from "@/lib/types";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { addSymptomLog, getProfile } from "@/lib/firestore";

const symptomSchema = z.object({
  symptom_text: z.string().min(2),
  severity: z.coerce.number().min(0).max(10),
  onset_time: z.string().optional(),
  notes: z.string().optional()
});

type SymptomValues = z.infer<typeof symptomSchema>;

export default function AppPage() {
  const { push } = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { appendMessage, appendAssistantDelta, setActionPlan } = useChatStore();
  const form = useForm<SymptomValues>({
    resolver: zodResolver(symptomSchema),
    defaultValues: { severity: 5, symptom_text: "", notes: "" }
  });

  useEffect(() => {
    const ensureAuth = async () => {
      if (!auth.currentUser) {
        router.push("/login");
      }
    };
    ensureAuth();
  }, [router]);

  const remindersQuery = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const profile = await getProfile(user.uid);
      const meds = profile?.meds ?? [];
      const reminders: Reminder[] = [];
      const today = new Date();
      for (const med of meds) {
        if (!med.last_fill_date || !med.refill_days) continue;
        const due = new Date(med.last_fill_date);
        due.setDate(due.getDate() + Number(med.refill_days));
        const daysLeft = Math.ceil(
          (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysLeft <= 7) {
          reminders.push({
            med_name: med.name,
            days_left: daysLeft,
            recommended_action: "Refill soon"
          });
        }
      }
      return { refill_reminders: reminders };
    }
  });

  const planQuery = useQuery({
    queryKey: ["health-plan", remindersQuery.data],
    enabled: Boolean(remindersQuery.data),
    queryFn: async () => {
      const user = auth.currentUser;
      const profile = user ? await getProfile(user.uid) : {};
      const response = await fetch("/api/plan/reminder", {
        method: "POST",
        body: JSON.stringify({
          profile,
          reminders: remindersQuery.data?.refill_reminders ?? []
        })
      });
      if (!response.ok) throw new Error("Failed to load health plan");
      return (await response.json()) as {
        summary: string;
        days: Array<{ day: string; actions: string[] }>;
      };
    }
  });

  const sendToChat = async (message: string) => {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      body: JSON.stringify({
        message,
        history: useChatStore.getState().messages.map((msg) => ({
          role: msg.role,
          content: msg.content
        }))
      })
    });

    await consumeSSE(response, (event) => {
      if (event.event === "token") {
        const delta =
          typeof event.data === "string"
            ? event.data
            : (event.data as { delta?: string }).delta ?? "";
        appendAssistantDelta(delta);
      }
      if (event.event === "message") {
        const text =
          typeof event.data === "string"
            ? event.data
            : (event.data as { text?: string }).text;
        if (text) {
          appendMessage({ role: "assistant", content: text });
        }
      }
      if (event.event === "action_plan") {
        setActionPlan(
          event.data as {
            tier: 1 | 2;
            tool: string;
            params: object;
            consent_prompt?: string;
          }
        );
      }
    });
  };

  const onSubmit = async (values: SymptomValues) => {
    setPending(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      await addSymptomLog(user.uid, {
        symptom_text: values.symptom_text,
        severity: values.severity,
        onset_time: values.onset_time,
        notes: values.notes
      });
      push({ title: "Symptom logged" });
      form.reset({ severity: 5, symptom_text: "", notes: "" });
    } catch (error) {
      push({ title: "Submission failed", description: (error as Error).message });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <main className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Dashboard</h1>
            <p className="text-slate-600">
              Daily check-in, reminders, and action outcomes.
            </p>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="lg:hidden">
                Open chat
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <ChatPanel />
            </SheetContent>
          </Sheet>
        </header>

        <Card className="space-y-4">
          <h2 className="text-xl font-semibold">Daily questionnaire</h2>
          <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
            <Input
              placeholder="Symptom summary"
              {...form.register("symptom_text")}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                type="number"
                min={0}
                max={10}
                placeholder="Severity 0-10"
                {...form.register("severity")}
              />
              <Input type="datetime-local" {...form.register("onset_time")} />
              <Input placeholder="Notes" {...form.register("notes")} />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Submit"}
            </Button>
          </form>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">Refill reminders</h2>
          {remindersQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading reminders...</p>
          ) : remindersQuery.data?.refill_reminders?.length ? (
            <ul className="space-y-2 text-sm text-slate-700">
              {remindersQuery.data.refill_reminders.map((item) => (
                <li key={item.med_name}>
                  <div className="font-semibold">{item.med_name}</div>
                  <div className="text-xs text-slate-500">
                    {item.days_left} days left · {item.recommended_action}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No reminders yet.</p>
          )}
          <div className="pt-4 border-t border-slate-200 space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">
              AI Health Plan (7 days)
            </h3>
            {planQuery.isLoading ? (
              <p className="text-sm text-slate-500">Generating plan...</p>
            ) : planQuery.data ? (
              <div className="space-y-3 text-sm text-slate-700">
                <p className="text-slate-600">{planQuery.data.summary}</p>
                {planQuery.data.days.map((day) => (
                  <div key={day.day} className="rounded-xl bg-slate-50 p-3">
                    <div className="font-semibold">{day.day}</div>
                    <ul className="list-disc list-inside">
                      {day.actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No plan yet. Check API key.
              </p>
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">Action results</h2>
          <ActionResults />
        </Card>
      </main>

      <aside className="hidden lg:block">
        <ChatPanel />
      </aside>
    </div>
  );
}

function ActionResults() {
  const result = useChatStore((state) => state.actionResult);
  if (!result) {
    return <p className="text-sm text-slate-500">No actions yet.</p>;
  }
  return (
    <pre className="rounded-xl bg-slate-50 p-4 text-xs text-slate-700 overflow-auto">
      {JSON.stringify(result.result, null, 2)}
    </pre>
  );
}
