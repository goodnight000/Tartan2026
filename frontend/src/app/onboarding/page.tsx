"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/TagInput";
import { StepProgress } from "@/components/StepProgress";
import { useToast } from "@/components/ui/toast";
import { upsertProfile } from "@/lib/firestore";
import { useAuthUser } from "@/lib/useAuth";

const DRAFT_KEY = "carepilot.onboarding_draft";

const medSchema = z.object({
  name: z.string().optional(),
  dose: z.string().optional(),
  frequency_per_day: z.coerce.number().min(0),
  start_date: z.string().optional(),
  last_fill_date: z.string().optional(),
  refill_days: z.coerce.number().optional(),
});

const schema = z.object({
  conditions: z.array(z.string()),
  allergies: z.array(z.string()),
  meds: z.array(medSchema),
  family_history: z.string().optional(),
  preferences: z.object({
    radius_miles: z.coerce.number().min(1),
    open_now: z.boolean(),
    preferred_days: z.array(z.string()),
    preferred_pharmacy: z.string().optional(),
    appointment_windows: z.array(z.string()),
    reminder_mode: z.enum(["all", "medications_only"]),
    proactive_state: z.enum(["active", "paused"]),
    quiet_hours: z.object({
      start: z.string(),
      end: z.string(),
    }),
  }),
});

type FormValues = z.infer<typeof schema>;

const defaultValues: FormValues = {
  conditions: [],
  allergies: [],
  meds: [{ name: "", dose: "", frequency_per_day: 1 }],
  family_history: "",
  preferences: {
    radius_miles: 10,
    open_now: true,
    preferred_days: [],
    preferred_pharmacy: "",
    appointment_windows: [],
    reminder_mode: "all",
    proactive_state: "active",
    quiet_hours: { start: "22:00", end: "08:00" },
  },
};

const steps = [
  { id: "baseline", title: "Clinical" },
  { id: "medications", title: "Medications" },
  { id: "logistics", title: "Logistics" },
  { id: "proactive", title: "Controls" },
] as const;

const stepDetails = [
  { title: "Clinical Baseline", subtitle: "Conditions and allergy facts used for triage and guidance." },
  { title: "Medication Profile", subtitle: "Dosage, refill timing, and medication cadence inputs." },
  { title: "Care Logistics", subtitle: "Discovery preferences, scheduling windows, and preferred pharmacy." },
  { title: "Proactive Controls", subtitle: "Reminder mode, quiet hours, and intervention posture." },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const { push } = useToast();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const { user, loading } = useAuthUser();

  // Load draft from localStorage
  const loadDraft = useCallback((): Partial<FormValues> | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  const draft = loadDraft();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      push({ title: "Please Log In First", variant: "warning" });
      router.push("/login");
      return;
    }
    setReady(true);
  }, [loading, push, router, user]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: draft ? { ...defaultValues, ...draft } : defaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "meds",
  });

  // Persist draft on changes (debounced)
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const subscription = form.watch((values) => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
        }
      }, 500);
    });
    return () => {
      if (timerId) clearTimeout(timerId);
      subscription.unsubscribe();
    };
  }, [form]);

  // Watch all fields so completeness re-computes on every change
  const watchedValues = form.watch();
  const completeness = useMemo(() => {
    let filled = 0;
    const total = 6;
    if (watchedValues.conditions.length > 0) filled++;
    if (watchedValues.allergies.length > 0) filled++;
    if (watchedValues.meds.some((m) => m.name?.trim())) filled++;
    if (watchedValues.preferences.preferred_pharmacy?.trim()) filled++;
    if (watchedValues.preferences.preferred_days.length > 0) filled++;
    if (watchedValues.family_history?.trim()) filled++;
    return Math.round((filled / total) * 100);
  }, [watchedValues]);

  const onSubmit = async (values: FormValues) => {
    if (!user) {
      push({ title: "Please Log In First", variant: "warning" });
      router.push("/login");
      return;
    }

    setSaving(true);
    const cleaned = {
      ...values,
      meds: values.meds.filter((med) => med.name?.trim()),
    };
    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";

    try {
      await upsertProfile(user.uid, cleaned);

      let idToken: string;
      try {
        idToken = await user.getIdToken();
      } catch {
        throw new Error(
          "Profile saved locally, but backend sync could not verify your session. Please log in again."
        );
      }

      const syncResponse = await fetch("/api/profile/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cleaned,
          timezone,
          idToken,
        }),
      });
      if (!syncResponse.ok) {
        let detail = "Backend profile sync failed.";
        try {
          const payload = await syncResponse.json();
          if (payload && typeof payload.message === "string" && payload.message.trim()) {
            detail = payload.message.trim();
          }
        } catch {
          // Ignore parse failures and keep generic fallback.
        }
        throw new Error(`Profile saved locally, but backend sync failed: ${detail}`);
      }

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_KEY);
      }
      setShowSuccess(true);
      setTimeout(() => {
        push({ title: "Profile Saved", description: "Command center is ready.", variant: "success" });
        router.push("/app");
      }, 1500);
    } catch (error) {
      push({ title: "Save Error", description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return <div className="text-sm text-[color:var(--cp-muted)]">Checking secure session...</div>;
  }

  if (showSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-20 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
        >
          <CheckCircle className="h-16 w-16 text-[color:var(--cp-success)]" />
        </motion.div>
        <h2 className="mt-4 text-3xl">Profile Complete</h2>
        <p className="mt-2 text-[color:var(--cp-muted)]">Redirecting to your command center...</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="reveal space-y-4 p-7">
        <p className="editorial-eyebrow">Guided Intake</p>
        <h1 className="panel-title text-[clamp(2.1rem,5vw,3.8rem)] leading-[0.9]">
          Build a profile that powers safer, faster coordination.
        </h1>
        <p className="panel-subtitle max-w-3xl text-base">
          We collect only the minimum structured context needed for triage quality, reminder intelligence, and action reliability.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <StepProgress steps={[...steps]} currentStep={step} />
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[color:var(--cp-accent)]" aria-hidden="true" />
            <span className="text-xs font-semibold text-[color:var(--cp-muted)]">
              {completeness}% complete
            </span>
          </div>
        </div>
      </Card>

      <Card className="reveal space-y-6 p-7" style={{ animationDelay: "90ms" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <div>
              <h2 className="text-4xl leading-none">{stepDetails[step].title}</h2>
              <p className="panel-subtitle mt-2">{stepDetails[step].subtitle}</p>
            </div>

            <form className="mt-6 space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
              {step === 0 && (
                <div className="grid gap-4">
                  <TagInput
                    label="Conditions"
                    value={form.watch("conditions")}
                    onChange={(next) => form.setValue("conditions", next)}
                    placeholder="Type 2 diabetes"
                  />
                  <TagInput
                    label="Allergies"
                    value={form.watch("allergies")}
                    onChange={(next) => form.setValue("allergies", next)}
                    placeholder="Penicillin"
                  />
                  <div className="space-y-2">
                    <Label htmlFor="family-history">Family History (optional)</Label>
                    <Textarea id="family-history" rows={4} {...form.register("family_history")} />
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4">
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3"
                    >
                      <div className="space-y-2">
                        <Label htmlFor={`med-name-${index}`}>Medication Name</Label>
                        <Input id={`med-name-${index}`} {...form.register(`meds.${index}.name`)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`med-dose-${index}`}>Dose</Label>
                        <Input id={`med-dose-${index}`} {...form.register(`meds.${index}.dose`)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`med-freq-${index}`}>Frequency / day</Label>
                        <Input id={`med-freq-${index}`} type="number" min={0} {...form.register(`meds.${index}.frequency_per_day`)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`med-start-${index}`}>Start Date</Label>
                        <Input id={`med-start-${index}`} type="date" {...form.register(`meds.${index}.start_date`)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`med-fill-${index}`}>Last Fill</Label>
                        <Input id={`med-fill-${index}`} type="date" {...form.register(`meds.${index}.last_fill_date`)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`med-refill-${index}`}>Refill Cycle (days)</Label>
                        <Input id={`med-refill-${index}`} type="number" {...form.register(`meds.${index}.refill_days`)} />
                      </div>
                      <div>
                        <Button type="button" variant="ghost" onClick={() => remove(index)}>
                          Remove Medication
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => append({ name: "", dose: "", frequency_per_day: 1 })}
                  >
                    Add Medication
                  </Button>
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="radius">Search Radius (miles)</Label>
                      <Input id="radius" type="number" {...form.register("preferences.radius_miles")} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pharmacy">Preferred Pharmacy</Label>
                      <Input id="pharmacy" placeholder="Walgreens - 5th Ave" {...form.register("preferences.preferred_pharmacy")} />
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-full border border-[color:var(--cp-line)] bg-white/70 px-4 py-2 text-sm text-[color:var(--cp-text)] cursor-pointer">
                    <input type="checkbox" {...form.register("preferences.open_now")} />
                    Prefer currently open locations
                  </label>
                  <TagInput
                    label="Preferred Days"
                    value={form.watch("preferences.preferred_days")}
                    onChange={(next) => form.setValue("preferences.preferred_days", next)}
                    placeholder="Monday"
                  />
                  <TagInput
                    label="Appointment Time Windows"
                    value={form.watch("preferences.appointment_windows")}
                    onChange={(next) => form.setValue("preferences.appointment_windows", next)}
                    placeholder="Tue 9:00-11:00"
                  />
                </div>
              )}

              {step === 3 && (
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Reminder Mode</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={form.watch("preferences.reminder_mode") === "all" ? "default" : "outline"}
                        onClick={() => form.setValue("preferences.reminder_mode", "all")}
                      >
                        All Reminders
                      </Button>
                      <Button
                        type="button"
                        variant={form.watch("preferences.reminder_mode") === "medications_only" ? "default" : "outline"}
                        onClick={() => form.setValue("preferences.reminder_mode", "medications_only")}
                      >
                        Medications Only
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Proactive State</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={form.watch("preferences.proactive_state") === "active" ? "default" : "outline"}
                        onClick={() => form.setValue("preferences.proactive_state", "active")}
                      >
                        Active
                      </Button>
                      <Button
                        type="button"
                        variant={form.watch("preferences.proactive_state") === "paused" ? "default" : "outline"}
                        onClick={() => form.setValue("preferences.proactive_state", "paused")}
                      >
                        Paused
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="quiet-start">Quiet Hours Start</Label>
                      <Input id="quiet-start" type="time" {...form.register("preferences.quiet_hours.start")} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quiet-end">Quiet Hours End</Label>
                      <Input id="quiet-end" type="time" {...form.register("preferences.quiet_hours.end")} />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-[color:var(--cp-line)]/45 pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
                  disabled={step === 0}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  {step < steps.length - 1 && (
                    <Button type="button" variant="ghost" onClick={() => setStep((prev) => prev + 1)}>
                      Skip for now
                    </Button>
                  )}
                  {step < steps.length - 1 ? (
                    <Button type="button" onClick={() => setStep((prev) => prev + 1)}>
                      Continue
                    </Button>
                  ) : (
                    <Button type="submit" loading={saving}>
                      Save Profile
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </motion.div>
        </AnimatePresence>
      </Card>
    </div>
  );
}
