"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Sun, Moon, CloudSun, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChatPanel } from "@/components/ChatPanel";
import { MetricCard } from "@/components/MetricCard";
import { MedicationCard } from "@/components/MedicationCard";
import { TriageCard } from "@/components/TriageCard";
import { PageHeader } from "@/components/PageHeader";
import { SkeletonCard } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useChatStore } from "@/store/chat";
import { useToast } from "@/components/ui/toast";
import type { HealthSignal, MedicationCardData, Reminder } from "@/lib/types";
import { addSymptomLog, getProfile } from "@/lib/firestore";
import { useAuthUser } from "@/lib/useAuth";

const symptomSchema = z.object({
  symptom_text: z.string().min(2),
  severity: z.coerce.number().min(0).max(10),
  onset_time: z.string().optional(),
  notes: z.string().optional(),
});

type SymptomValues = z.infer<typeof symptomSchema>;

function getGreeting(): { text: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", icon: Sun };
  if (hour < 17) return { text: "Good afternoon", icon: CloudSun };
  return { text: "Good evening", icon: Moon };
}

function parseHour(value?: string | null): number | null {
  if (!value) return null;
  const [hourString] = value.split(":");
  const hour = Number(hourString);
  return Number.isFinite(hour) ? hour : null;
}

const signalSeed: HealthSignal[] = [
  {
    id: "cycle",
    title: "Cycle Tracking",
    value: "Tracking enabled",
    trend: "stable",
    lastSync: "Today 8:10 AM",
    source: "Apple Health",
    data: [28, 30, 29, 27, 31, 28, 29],
  },
  {
    id: "meds",
    title: "Medication Adherence",
    value: "6 of 7 doses",
    trend: "up",
    lastSync: "Today 7:42 AM",
    source: "User + Tool",
    data: [4, 5, 6, 5, 7, 6, 6],
  },
  {
    id: "workouts",
    title: "Workouts",
    value: "4 sessions, 190 min",
    trend: "up",
    lastSync: "Yesterday 6:03 PM",
    source: "Apple Health",
    data: [120, 140, 160, 150, 170, 180, 190],
  },
  {
    id: "symptoms",
    title: "Symptom State",
    value: "2 active threads",
    trend: "down",
    lastSync: "Today 11:21 AM",
    source: "User Reported",
    data: [5, 4, 3, 4, 3, 2, 2],
  },
];

export default function AppPage() {
  const { push } = useToast();
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [pending, setPending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [medOnly, setMedOnly] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const triageLevel = useChatStore((s) => s.triageLevel);

  const form = useForm<SymptomValues>({
    resolver: zodResolver(symptomSchema),
    defaultValues: { severity: 5, symptom_text: "", notes: "" },
  });

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) throw new Error("Not authenticated");
      return getProfile(user.uid);
    },
  });

  const remindersQuery = useQuery({
    queryKey: ["reminders", user?.uid, profileQuery.data?.updated_at],
    enabled: Boolean(user && profileQuery.data),
    queryFn: async () => {
      const meds = profileQuery.data?.meds ?? [];
      const reminders: Reminder[] = [];
      const today = new Date();
      for (const med of meds) {
        if (!med.last_fill_date || !med.refill_days) continue;
        const due = new Date(med.last_fill_date);
        due.setDate(due.getDate() + Number(med.refill_days));
        const daysLeft = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 7) {
          reminders.push({
            med_name: med.name ?? "Unknown",
            days_left: daysLeft,
            recommended_action: "Refill soon",
          });
        }
      }
      return { refill_reminders: reminders };
    },
  });

  const planQuery = useQuery({
    queryKey: ["health-plan", user?.uid, remindersQuery.data],
    enabled: Boolean(remindersQuery.data && user && profileQuery.data),
    queryFn: async () => {
      const response = await fetch("/api/plan/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: profileQuery.data,
          reminders: remindersQuery.data?.refill_reminders ?? [],
        }),
      });
      if (!response.ok) throw new Error("Failed to load health plan");
      return (await response.json()) as {
        summary: string;
        days: Array<{ day: string; actions: string[] }>;
      };
    },
  });

  useEffect(() => {
    if (!profileQuery.data?.reminders) return;
    setPaused(profileQuery.data.reminders.proactive_state === "paused");
    setMedOnly(profileQuery.data.reminders.reminder_mode === "medications_only");
  }, [profileQuery.data?.reminders]);

  const medCards: MedicationCardData[] = useMemo(() => {
    if (!profileQuery.data?.meds) return [];
    return profileQuery.data.meds
      .filter((m) => m.name?.trim())
      .map((med) => {
        const today = new Date();
        let daysUntilRefill: number | undefined;
        let status: MedicationCardData["status"] = "on-track";
        if (med.last_fill_date && med.refill_days) {
          const due = new Date(med.last_fill_date);
          due.setDate(due.getDate() + Number(med.refill_days));
          daysUntilRefill = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntilRefill <= 3) status = "due-soon";
          if (daysUntilRefill < 0) status = "missed";
        }
        return {
          name: med.name ?? "Unknown",
          dose: med.dose ?? "N/A",
          frequency: med.cadence
            ? med.cadence.replace(/_/g, " ")
            : med.frequency_per_day
              ? `${med.frequency_per_day}x/day`
              : "as directed",
          status,
          adherenceStreak: Array.from({ length: 7 }, (_, i) => {
            // Deterministic per-medication streak based on name + day index
            const seed = (med.name ?? "").length + i;
            return seed % 5 !== 0; // ~80% adherence, stable across renders
          }),
          daysUntilRefill,
        };
      });
  }, [profileQuery.data?.meds]);

  const onSubmit = async (values: SymptomValues) => {
    setPending(true);
    try {
      if (!user) throw new Error("Not authenticated");
      await addSymptomLog(user.uid, {
        symptom_text: values.symptom_text,
        severity: values.severity,
        onset_time: values.onset_time,
        notes: values.notes,
      });
      push({ title: "Symptom Logged", description: "Included in your longitudinal timeline.", variant: "success" });
      form.reset({ severity: 5, symptom_text: "", notes: "" });
    } catch (error) {
      push({ title: "Submission Failed", description: (error as Error).message, variant: "error" });
    } finally {
      setPending(false);
    }
  };

  const greeting = getGreeting();
  const reminderSettings = profileQuery.data?.reminders;
  const quietStart = reminderSettings?.quiet_hours?.start ?? "22:00";
  const quietEnd = reminderSettings?.quiet_hours?.end ?? "08:00";
  const quietStartHour = parseHour(quietStart) ?? 22;
  const quietEndHour = parseHour(quietEnd) ?? 8;
  const quietHoursWindow = { startHour: quietStartHour, endHour: quietEndHour };
  const isQuietHours =
    now.getHours() >= quietHoursWindow.startHour || now.getHours() < quietHoursWindow.endHour;
  const snoozeActive = snoozedUntil ? snoozedUntil.getTime() > now.getTime() : false;
  const proactiveStatus = paused
    ? "Paused"
    : snoozeActive
      ? "Snoozed"
      : "Active";
  const proactiveStatusDetail = paused
    ? "No proactive nudges while paused."
    : snoozeActive
      ? `Snoozed until ${snoozedUntil?.toLocaleDateString()}.`
      : "Proactive nudges are enabled.";

  const topPriority = useMemo(() => {
    const first = remindersQuery.data?.refill_reminders?.[0];
    if (first) return `Refill watch: ${first.med_name} has ${first.days_left} day(s) remaining.`;
    return "No immediate refill risks detected.";
  }, [remindersQuery.data?.refill_reminders]);

  return (
    <div className="space-y-5">
      {/* Header with greeting and triage */}
      <Card className="reveal space-y-4 p-7">
        <PageHeader
          eyebrow="Command Center"
          title={`${greeting.text}`}
          subtitle={topPriority}
        />
        {triageLevel && (
          <TriageCard
            level={triageLevel}
            summary={
              triageLevel === "EMERGENT"
                ? "An emergency condition may have been detected. Please seek immediate medical attention."
                : triageLevel === "URGENT_24H"
                  ? "Your symptoms may need attention within 24 hours. Consider scheduling an appointment."
                  : "Your current health status appears routine. Continue your care plan as scheduled."
            }
            actions={
              triageLevel === "EMERGENT"
                ? ["Call 911 immediately", "Go to nearest emergency room", "Do not drive yourself"]
                : triageLevel === "URGENT_24H"
                  ? ["Schedule an appointment today", "Monitor symptoms closely"]
                  : ["Continue medications as prescribed", "Log any changes in symptoms"]
            }
          />
        )}
      </Card>

      {/* 3-column layout */}
      <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)_340px]">
        {/* Left sidebar */}
        <aside className="space-y-4" aria-label="Symptom check-in and proactive rules">
          <Card className="reveal space-y-4 p-5" style={{ animationDelay: "70ms" }}>
            <div>
              <p className="editorial-eyebrow">Quick Intake</p>
              <h2 className="text-3xl leading-none">Daily Check-In</h2>
            </div>
            <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="symptom-text">Symptom Summary</Label>
                <Input id="symptom-text" placeholder="Persistent headache since morning" {...form.register("symptom_text")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="severity">Severity (0-10)</Label>
                <input
                  id="severity"
                  type="range"
                  min={0}
                  max={10}
                  className="w-full accent-[color:var(--cp-primary)]"
                  {...form.register("severity")}
                  aria-label="Severity level"
                />
                <div className="flex justify-between text-[10px] text-[color:var(--cp-muted)]">
                  <span>0 - None</span>
                  <span className="font-semibold">{form.watch("severity")}</span>
                  <span>10 - Severe</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="onset">Onset Time</Label>
                <Input id="onset" type="datetime-local" {...form.register("onset_time")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" placeholder="Missed one evening dose" {...form.register("notes")} />
              </div>
              <Button type="submit" loading={pending} className="w-full">
                Log Symptom
              </Button>
            </form>
          </Card>

          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "120ms" }}>
            <div>
              <p className="editorial-eyebrow">Proactive Rules</p>
              <h3 className="text-2xl leading-none">Care Autopilot</h3>
            </div>
            <div className="space-y-2 text-sm text-[color:var(--cp-muted)]">
              <div className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2">
                <span>Status</span>
                <span className="font-mono text-xs">{proactiveStatus}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2">
                <span>Quiet hours</span>
                <span className="font-mono text-xs">
                  {quietStart} - {quietEnd} {isQuietHours ? "(Active)" : "(Inactive)"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2">
                <span>Snooze</span>
                <span className="font-mono text-xs">
                  {snoozeActive ? `Until ${snoozedUntil?.toLocaleDateString()}` : "Off"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2">
                <span>Non-urgent limit</span>
                <span className="font-mono text-xs">1/day</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2">
                <span>Mode</span>
                <span className="font-mono text-xs">{medOnly ? "Medication Only" : "All"}</span>
              </div>
            </div>
            <p className="text-xs text-[color:var(--cp-muted)]">{proactiveStatusDetail}</p>
          </Card>
        </aside>

        {/* Center - Chat */}
        <section className="reveal" style={{ animationDelay: "120ms" }}>
          <ChatPanel />
        </section>

        {/* Right sidebar */}
        <aside className="space-y-4" aria-label="Medication forecast and health plan">
          {/* Medication cards */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "150ms" }}>
            <div>
              <p className="editorial-eyebrow">Medication Forecast</p>
              <h3 className="text-2xl leading-none">Refill Watchlist</h3>
            </div>
            {remindersQuery.isLoading ? (
              <SkeletonCard />
            ) : medCards.length > 0 ? (
              <div className="space-y-3">
                {medCards.map((med, index) => (
                  <MedicationCard
                    key={`${index}-${med.name}`}
                    med={med}
                    onRefill={() =>
                      push({ title: `Refill requested for ${med.name}`, variant: "success" })
                    }
                  />
                ))}
              </div>
            ) : remindersQuery.data?.refill_reminders?.length ? (
              <ul className="space-y-2 text-sm">
                {remindersQuery.data.refill_reminders.map((item) => (
                  <li key={item.med_name} className="rounded-xl border border-[color:var(--cp-line)] bg-white/70 p-3">
                    <div className="font-semibold text-[color:var(--cp-text)]">{item.med_name}</div>
                    <div className="text-xs text-[color:var(--cp-muted)]">
                      {item.days_left} days left
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Activity}
                title="No refill concerns"
                description="All medications are on track."
              />
            )}
          </Card>

          {/* Health plan */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "190ms" }}>
            <div>
              <p className="editorial-eyebrow">7-Day Protocol</p>
              <h3 className="text-2xl leading-none">AI Health Plan</h3>
            </div>
            {planQuery.isLoading ? (
              <SkeletonCard />
            ) : planQuery.data ? (
              <div className="space-y-3 text-sm text-[color:var(--cp-text)]">
                <p className="text-[color:var(--cp-muted)]">{planQuery.data.summary}</p>
                {planQuery.data.days.slice(0, 3).map((day) => (
                  <div key={day.day} className="rounded-xl border border-[color:var(--cp-line)] bg-white/72 p-3">
                    <div className="font-semibold">{day.day}</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[color:var(--cp-muted)]">
                      {day.actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[color:var(--cp-muted)]">Plan unavailable. Verify API key/config.</p>
            )}
          </Card>

          {/* Action results */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "220ms" }}>
            <div>
              <p className="editorial-eyebrow">Execution Ledger</p>
              <h3 className="text-2xl leading-none">Latest Action</h3>
            </div>
            <ActionResults />
          </Card>
        </aside>
      </div>

      {/* Health signals */}
      <Card id="signals" className="reveal space-y-4 p-6" style={{ animationDelay: "240ms" }} role="region" aria-label="Health signals dashboard">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="editorial-eyebrow">Health Signals Dashboard</p>
            <h2 className="text-4xl leading-none">Connected Metrics</h2>
          </div>
          <span className="status-chip status-chip--success">Apple Health Linked</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {signalSeed.map((signal) => (
            <MetricCard key={signal.id} signal={signal} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ActionResults() {
  const result = useChatStore((state) => state.actionResult);
  if (!result) {
    return <p className="text-sm text-[color:var(--cp-muted)]">No transactional action executed yet.</p>;
  }

  return (
    <div className="space-y-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/75 p-3">
      <div className={`status-chip ${result.status === "success" ? "status-chip--success" : "status-chip--danger"}`}>
        {result.status}
      </div>
      <div className="space-y-1">
        {Object.entries(result.result ?? {}).map(([key, val]) => (
          <div key={key} className="flex justify-between text-xs">
            <span className="font-medium text-[color:var(--cp-muted)]">{key.replace(/_/g, " ")}</span>
            <span className="text-[color:var(--cp-text)]">{typeof val === "object" && val !== null ? JSON.stringify(val) : String(val ?? "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
