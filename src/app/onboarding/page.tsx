"use client";

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/TagInput";
import { authorizedFetch } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const medSchema = z.object({
  name: z.string().optional(),
  dose: z.string().optional(),
  frequency_per_day: z.coerce.number().min(0),
  start_date: z.string().optional(),
  last_fill_date: z.string().optional(),
  refill_days: z.coerce.number().optional()
});

const schema = z.object({
  conditions: z.array(z.string()),
  allergies: z.array(z.string()),
  meds: z.array(medSchema),
  family_history: z.string().optional(),
  preferences: z.object({
    radius_miles: z.coerce.number().min(1),
    open_now: z.boolean(),
    preferred_days: z.array(z.string())
  })
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const router = useRouter();
  const { push } = useToast();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const ensureAuth = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!session) {
        push({ title: "Please log in first" });
        router.push("/login");
        return;
      }
      setReady(true);
    };
    ensureAuth();
  }, [push, router]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      conditions: [],
      allergies: [],
      meds: [{ name: "", dose: "", frequency_per_day: 1 }],
      family_history: "",
      preferences: {
        radius_miles: 10,
        open_now: true,
        preferred_days: []
      }
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "meds"
  });

  const onSubmit = async (values: FormValues) => {
    const cleaned = {
      ...values,
      meds: values.meds.filter((med) => med.name?.trim())
    };
    try {
      const response = await authorizedFetch("/profile", {
        method: "POST",
        body: JSON.stringify(cleaned)
      });
      if (!response.ok) {
        const errorText = await response.text();
        push({
          title: "Profile save failed",
          description: errorText || "Server error"
        });
        return;
      }
      push({ title: "Profile saved" });
      router.push("/app");
    } catch (error) {
      push({ title: "Save error", description: (error as Error).message });
    }
  };

  if (!ready) {
    return (
      <div className="text-sm text-slate-500">
        Checking session...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Onboarding</h1>
        <p className="text-slate-600">
          Build your medical profile in a few steps.
        </p>
      </header>

      <Card>
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          {step === 0 && (
            <div className="space-y-4">
              <TagInput
                label="Conditions"
                value={form.watch("conditions")}
                onChange={(next) => form.setValue("conditions", next)}
                placeholder="Asthma"
              />
              <TagInput
                label="Allergies"
                value={form.watch("allergies")}
                onChange={(next) => form.setValue("allergies", next)}
                placeholder="Penicillin"
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="text-sm font-medium text-slate-700">Medications</div>
              {fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input {...form.register(`meds.${index}.name`)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Dose</Label>
                    <Input {...form.register(`meds.${index}.dose`)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Frequency/day</Label>
                    <Input
                      type="number"
                      min={0}
                      {...form.register(`meds.${index}.frequency_per_day`)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Start date</Label>
                    <Input type="date" {...form.register(`meds.${index}.start_date`)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Last fill</Label>
                    <Input
                      type="date"
                      {...form.register(`meds.${index}.last_fill_date`)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Refill days</Label>
                    <Input
                      type="number"
                      {...form.register(`meds.${index}.refill_days`)}
                    />
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => remove(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  append({ name: "", dose: "", frequency_per_day: 1 })
                }
              >
                Add medication
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Family history</Label>
                <Textarea rows={4} {...form.register("family_history")} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Preferred radius (miles)</Label>
                  <Input type="number" {...form.register("preferences.radius_miles")} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" {...form.register("preferences.open_now")} />
                  Open now only
                </label>
              </div>
              <TagInput
                label="Preferred days"
                value={form.watch("preferences.preferred_days")}
                onChange={(next) =>
                  form.setValue("preferences.preferred_days", next)
                }
                placeholder="Monday"
              />
            </div>
          )}

          <div className="flex justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
              disabled={step === 0}
            >
              Back
            </Button>
            {step < 2 ? (
              <Button type="button" onClick={() => setStep((prev) => prev + 1)}>
                Next
              </Button>
            ) : (
              <Button type="submit">Save profile</Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
