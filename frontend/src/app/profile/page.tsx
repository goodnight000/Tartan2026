"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Clock, FileText, Trash2, Download, AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrustBadge } from "@/components/TrustBadge";
import { PageHeader } from "@/components/PageHeader";
import { SkeletonCard } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { MasterKeyPanel } from "@/components/MasterKeyPanel";
import { SupportToolsPanel } from "@/components/SupportToolsPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionLog, AllergyItem, ConditionItem, MedItem, MedicalProfile, ProcedureItem, SymptomLog } from "@/lib/types";
import { getActionLogs, getProfile, getSymptomLogs, upsertProfile } from "@/lib/firestore";
import { pullCloudToLocal, pushAllToCloud } from "@/lib/carebase/cloud";
import { useAuthUser } from "@/lib/useAuth";
import { useToast } from "@/components/ui/toast";

type EditSection =
  | "conditions"
  | "allergies"
  | "medications"
  | "procedures"
  | "demographics"
  | "family_history"
  | "preferences"
  | "reminders";

const SELECT_CLASS =
  "w-full rounded-2xl border border-[color:var(--cp-line)] bg-white/85 px-4 py-2.5 text-sm text-[color:var(--cp-text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--cp-primary)]/45 focus:border-[color:var(--cp-primary)]";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const APPOINTMENT_WINDOWS = ["08:00-12:00", "12:00-17:00", "17:00-20:00"] as const;

const DEFAULT_PROFILE: MedicalProfile = {
  user_id: "new",
  updated_at: new Date().toISOString(),
  consent: {
    health_data_use: false,
    privacy_version: "v1",
  },
  profile_mode: {
    managing_for: "self",
  },
  demographics: {},
  lifestyle: {},
  conditions: [],
  procedures: [],
  meds: [],
  allergies: [],
  family_history: {
    heart_disease: false,
    stroke: false,
    diabetes: false,
    cancer: false,
    hypertension: false,
    none_or_unsure: false,
  },
  preferences: {
    radius_miles: 5,
    preferred_days: [],
    appointment_windows: [],
    care_priority: "no_preference",
  },
  reminders: {
    med_runout: true,
    checkup_due: true,
    followup_nudges: true,
    reminder_mode: "all",
    proactive_state: "active",
    quiet_hours: { start: "22:00", end: "08:00" },
  },
  onboarding: {
    completed: false,
    step_last_seen: "review_confirm",
    version: "v1",
  },
};

const ONBOARDING_STATE_KEY = "carepilot.onboarding_state.v1";

function hydrateProfile(profile: MedicalProfile | null, userId: string): MedicalProfile {
  const base = { ...DEFAULT_PROFILE, user_id: userId };
  if (!profile) return base;
  return {
    ...base,
    ...profile,
    consent: { ...base.consent, ...profile.consent },
    profile_mode: { ...base.profile_mode, ...profile.profile_mode },
    demographics: { ...base.demographics, ...profile.demographics },
    lifestyle: { ...base.lifestyle, ...profile.lifestyle },
    conditions: profile.conditions ?? [],
    procedures: profile.procedures ?? [],
    meds: profile.meds ?? [],
    allergies: profile.allergies ?? [],
    family_history: { ...base.family_history, ...profile.family_history },
    preferences: {
      ...base.preferences,
      ...profile.preferences,
      preferred_days: profile.preferences?.preferred_days ?? base.preferences.preferred_days,
      appointment_windows: profile.preferences?.appointment_windows ?? base.preferences.appointment_windows,
    },
    reminders: {
      ...base.reminders,
      ...profile.reminders,
      quiet_hours: {
        ...base.reminders.quiet_hours,
        ...profile.reminders?.quiet_hours,
      },
    },
    onboarding: { ...base.onboarding, ...profile.onboarding },
  };
}

function severityColor(severity: number): string {
  if (severity >= 7) return "text-[color:var(--cp-danger)]";
  if (severity >= 4) return "text-[color:var(--cp-warn)]";
  return "text-[color:var(--cp-success)]";
}

function statusIcon(status: string) {
  if (status === "success") return <CheckCircle className="h-4 w-4 text-[color:var(--cp-success)]" aria-hidden="true" />;
  if (status === "failure") return <XCircle className="h-4 w-4 text-[color:var(--cp-danger)]" aria-hidden="true" />;
  return <Clock className="h-4 w-4 text-[color:var(--cp-warn)]" aria-hidden="true" />;
}

export default function ProfilePage() {
  const router = useRouter();
  const { push } = useToast();
  const { user, loading } = useAuthUser();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editSection, setEditSection] = useState<EditSection | null>(null);
  const [draftProfile, setDraftProfile] = useState<MedicalProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, router, user]);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) throw new Error("Not authenticated");
      return getProfile(user.uid);
    },
  });

  const symptomsQuery = useQuery({
    queryKey: ["symptom-logs", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return { items: [] as SymptomLog[] };
      const items = await getSymptomLogs(user.uid, 20);
      return { items };
    },
  });

  const actionsQuery = useQuery({
    queryKey: ["action-logs", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return { items: [] as ActionLog[] };
      const items = await getActionLogs(user.uid, 20);
      return { items };
    },
  });

  useEffect(() => {
    if (!editSection || !user) return;
    const hydrated = hydrateProfile(profileQuery.data ?? null, user.uid);
    setDraftProfile(hydrated);
  }, [editSection, profileQuery.data, user]);

  const editTitle = useMemo(() => {
    switch (editSection) {
      case "conditions":
        return "Edit Conditions";
      case "allergies":
        return "Edit Allergies";
      case "medications":
        return "Edit Medications";
      case "procedures":
        return "Edit Procedures";
      case "demographics":
        return "Edit Demographics & Lifestyle";
      case "family_history":
        return "Edit Family History";
      case "preferences":
        return "Edit Care Preferences";
      case "reminders":
        return "Edit Reminder Controls";
      default:
        return "Edit Profile";
    }
  }, [editSection]);

  const handleSave = async () => {
    if (!user || !draftProfile) return;
    setSaving(true);
    try {
      const { user_id, updated_at, ...payload } = draftProfile;
      await upsertProfile(user.uid, payload);
      await profileQuery.refetch();
      push({ title: "Profile updated", variant: "success" });
      setEditSection(null);
    } catch (error) {
      push({ title: "Save failed", description: (error as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleRestartOnboarding = async () => {
    if (!user) return;
    const confirmed = window.confirm("Restart onboarding? You'll be taken through the full intake flow again.");
    if (!confirmed) return;
    setRestarting(true);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(ONBOARDING_STATE_KEY);
      }
      const hydrated = hydrateProfile(profileQuery.data ?? null, user.uid);
      const { user_id, updated_at, ...payload } = hydrated;
      const cleanedOnboarding = {
        completed: false,
        step_last_seen: "consent_transparency",
        version: "v1" as const,
      };
      await upsertProfile(user.uid, {
        ...payload,
        onboarding: {
          ...cleanedOnboarding,
        },
      });
      await profileQuery.refetch();
      push({ title: "Onboarding restarted", description: "You can complete the intake again.", variant: "success" });
      router.push("/onboarding");
    } catch (error) {
      push({ title: "Restart failed", description: (error as Error).message, variant: "error" });
    } finally {
      setRestarting(false);
    }
  };

  const handlePushToCloud = async () => {
    setSyncStatus("Pushing encrypted records...");
    try {
      await pushAllToCloud();
      setSyncStatus("Cloud backup updated.");
      push({ title: "Cloud synced", description: "Encrypted backup pushed.", variant: "success" });
    } catch (error) {
      setSyncStatus("Cloud push failed.");
      push({ title: "Cloud push failed", description: (error as Error).message, variant: "error" });
    }
  };

  const handlePullFromCloud = async () => {
    setSyncStatus("Pulling encrypted records...");
    try {
      await pullCloudToLocal();
      await Promise.all([profileQuery.refetch(), symptomsQuery.refetch(), actionsQuery.refetch()]);
      setSyncStatus("Local cache refreshed from cloud.");
      push({ title: "Cloud synced", description: "Local CareBase refreshed.", variant: "success" });
    } catch (error) {
      setSyncStatus("Cloud pull failed.");
      push({ title: "Cloud pull failed", description: (error as Error).message, variant: "error" });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="reveal space-y-4 p-7">
        <PageHeader
          eyebrow="Profile"
          title="Profile, Permissions, and Receipts"
          subtitle="Inspect the exact data used in care decisions, review action history, and control your privacy posture."
        />
        <TrustBadge variant="block" />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={handleRestartOnboarding}
            disabled={restarting || profileQuery.isLoading}
          >
            {restarting ? "Restarting..." : "Restart Onboarding"}
          </Button>
          <span className="text-xs text-[color:var(--cp-muted)]">Re-run the full onboarding flow at any time.</span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Clinical Profile */}
        <Card className="reveal space-y-4 p-6" style={{ animationDelay: "70ms" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="editorial-eyebrow">Clinical Profile</p>
              <h2 className="text-3xl leading-none">Structured Context</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditSection("demographics")}>
              Edit Profile
            </Button>
          </div>
          {profileQuery.isLoading ? (
            <SkeletonCard />
        ) : profileQuery.data ? (
          <div className="space-y-4 text-sm text-[color:var(--cp-text)]">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Conditions
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("conditions")}>
                  Edit
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {(profileQuery.data.conditions?.length
                  ? profileQuery.data.conditions.map((condition) => condition.name)
                  : profileQuery.data.conditions_legacy ?? []
                ).length ? (
                  (profileQuery.data.conditions?.length
                    ? profileQuery.data.conditions.map((condition) => condition.name)
                    : profileQuery.data.conditions_legacy ?? []
                  ).map((condition) => (
                    <Badge key={condition} className="bg-[color:var(--cp-primary-soft)] text-[color:var(--cp-primary)] border-[color:var(--cp-primary)]/20">
                      {condition}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[color:var(--cp-muted)]">None</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Allergies
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("allergies")}>
                  Edit
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {(profileQuery.data.allergies?.length
                  ? profileQuery.data.allergies.map((allergy) => allergy.allergen)
                  : profileQuery.data.allergies_legacy ?? []
                ).length ? (
                  (profileQuery.data.allergies?.length
                    ? profileQuery.data.allergies.map((allergy) => allergy.allergen)
                    : profileQuery.data.allergies_legacy ?? []
                  ).map((allergy) => (
                    <Badge key={allergy} className="border-[color:var(--cp-danger)]/20 bg-[color:color-mix(in_srgb,var(--cp-danger)_8%,white_92%)] text-[color:var(--cp-danger)]">
                      {allergy}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[color:var(--cp-muted)]">None</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Medications
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("medications")}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {profileQuery.data.meds?.length ? (
                  profileQuery.data.meds.map((med) => (
                    <div
                      key={`${med.name}-${med.dose ?? ""}`}
                      className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2"
                    >
                      <div>
                        <span className="font-semibold">{med.name}</span>
                        <span className="ml-2 text-xs text-[color:var(--cp-muted)]">{med.dose || "dose n/a"}</span>
                      </div>
                      <span className="text-xs text-[color:var(--cp-muted)]">
                        {med.cadence ? med.cadence.replace(/_/g, " ") : `${med.frequency_per_day ?? "?"}x/day`}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[color:var(--cp-muted)]">None</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Procedures
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("procedures")}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {profileQuery.data.procedures?.length ? (
                  profileQuery.data.procedures.map((procedure) => (
                    <div
                      key={`${procedure.name}-${procedure.approximate_year ?? ""}`}
                      className="flex items-center justify-between rounded-xl border border-[color:var(--cp-line)] bg-white/70 px-3 py-2"
                    >
                      <span className="font-semibold">{procedure.name}</span>
                      <span className="text-xs text-[color:var(--cp-muted)]">
                        {procedure.approximate_year ?? "year n/a"}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[color:var(--cp-muted)]">None</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Demographics & Lifestyle
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("demographics")}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-[color:var(--cp-muted)] md:grid-cols-2">
                <div>Year of birth: {profileQuery.data.demographics?.year_of_birth || "Not set"}</div>
                <div>Sex assigned: {profileQuery.data.demographics?.sex_assigned_at_birth?.replace(/_/g, " ") || "Not set"}</div>
                <div>Height: {profileQuery.data.demographics?.height_cm ? `${profileQuery.data.demographics.height_cm} cm` : "Not set"}</div>
                <div>Weight: {profileQuery.data.demographics?.weight_kg ? `${profileQuery.data.demographics.weight_kg} kg` : "Not set"}</div>
                <div>Smoking: {profileQuery.data.lifestyle?.smoking_status || "Not set"}</div>
                <div>Alcohol: {profileQuery.data.lifestyle?.alcohol_use || "Not set"}</div>
                <div>Activity: {profileQuery.data.lifestyle?.activity_level || "Not set"}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Family history
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("family_history")}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(() => {
                  const entries = profileQuery.data.family_history
                    ? Object.entries(profileQuery.data.family_history).filter(([, value]) => value)
                    : [];
                  return entries.length ? (
                    entries.map(([key]) => (
                      <Badge key={key} className="border-[color:var(--cp-line)] bg-white/80 text-[color:var(--cp-text)]">
                        {key.replace(/_/g, " ")}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[color:var(--cp-muted)]">None</span>
                  );
                })()}
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/72 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Care Preferences
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("preferences")}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-[color:var(--cp-muted)] md:grid-cols-2">
                <div>Priority: {profileQuery.data.preferences?.care_priority?.replace(/_/g, " ") || "Not set"}</div>
                <div>Radius: {profileQuery.data.preferences?.radius_miles || "Not set"} mi</div>
                <div>Pharmacy: {profileQuery.data.preferences?.preferred_pharmacy || "Not set"}</div>
                <div>Preferred days: {profileQuery.data.preferences?.preferred_days?.join(", ") || "Not set"}</div>
                <div>Appointment windows: {profileQuery.data.preferences?.appointment_windows?.join(", ") || "Not set"}</div>
                <div>Provider gender: {profileQuery.data.preferences?.provider_gender_preference?.replace(/_/g, " ") || "Not set"}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/72 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]">
                  Reminder Controls
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditSection("reminders")}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-[color:var(--cp-muted)] md:grid-cols-2">
                <div>Mode: {profileQuery.data.reminders?.reminder_mode || "all"}</div>
                <div>State: {profileQuery.data.reminders?.proactive_state || "active"}</div>
                <div>
                  Quiet hours: {profileQuery.data.reminders?.quiet_hours?.start || "22:00"} -{" "}
                  {profileQuery.data.reminders?.quiet_hours?.end || "08:00"}
                </div>
              </div>
            </div>

            <p className="text-[10px] text-[color:var(--cp-muted)]">
              Last updated: {new Date(profileQuery.data.updated_at).toLocaleString()}
            </p>
          </div>
        ) : (
            <EmptyState
              icon={FileText}
              title="No profile on file"
              description="Create your clinical profile here in the Profile."
              action={<Button onClick={() => setEditSection("demographics")}>Create Profile</Button>}
            />
          )}
        </Card>

        <div className="space-y-4">
          {/* Symptom Timeline */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "110ms" }}>
            <div>
              <p className="editorial-eyebrow">Symptom Timeline</p>
              <h3 className="text-2xl leading-none">Recent Check-Ins</h3>
            </div>
            {symptomsQuery.isLoading ? (
              <SkeletonCard />
            ) : symptomsQuery.data?.items?.length ? (
              <div className="relative space-y-0">
                {symptomsQuery.data.items.map((item, i) => (
                  <div
                    key={`${item.created_at}-${item.symptom_text}`}
                    className="relative flex gap-3 pb-4"
                  >
                    {/* Timeline line */}
                    {i < (symptomsQuery.data?.items?.length ?? 0) - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-px bg-[color:var(--cp-line)]" aria-hidden="true" />
                    )}
                    {/* Timeline dot */}
                    <div className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white ${severityColor(item.severity)} bg-current`} aria-hidden="true" />
                    <div className="flex-1 rounded-xl border border-[color:var(--cp-line)] bg-white/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-[color:var(--cp-text)]">{item.symptom_text}</span>
                        <span className={`text-xs font-bold ${severityColor(item.severity)}`}>
                          {item.severity}/10
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--cp-muted)]">
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={FileText} title="No symptom logs yet" description="Use the Daily Check-In to start tracking." />
            )}
          </Card>

          {/* Action Receipts */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "150ms" }}>
            <div>
              <p className="editorial-eyebrow">Action Receipts</p>
              <h3 className="text-2xl leading-none">Transactional History</h3>
            </div>
            {actionsQuery.isLoading ? (
              <SkeletonCard />
            ) : actionsQuery.data?.items?.length ? (
              <ul className="space-y-2 text-sm text-[color:var(--cp-text)]">
                {actionsQuery.data.items.map((item) => (
                  <li
                    key={`${item.created_at}-${item.action_type}`}
                    className="flex items-start gap-3 rounded-xl border border-[color:var(--cp-line)] bg-white/70 p-3"
                  >
                    {statusIcon(item.status)}
                    <div className="flex-1">
                      <div className="font-semibold">{item.action_type.replace(/_/g, " ")}</div>
                      <div className="text-xs text-[color:var(--cp-muted)]">
                        {new Date(item.created_at).toLocaleString()} · {item.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={FileText} title="No action logs yet" description="Actions will appear here after you confirm workflows." />
            )}
          </Card>

          {/* Privacy Controls */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "190ms" }}>
            <div>
              <p className="editorial-eyebrow">Privacy Controls</p>
              <h3 className="text-2xl leading-none">Data Commands</h3>
            </div>
            <p className="text-sm text-[color:var(--cp-muted)]">
              Export and deletion flows are surfaced here to support transparent user control.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() =>
                  push({
                    title: "Export Requested",
                    description: "Your data export is being prepared.",
                    variant: "success",
                  })
                }
              >
                Export My Data
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setDeleteOpen(true)}
              >
                Delete My Data
              </Button>
            </div>
          </Card>

          {/* CareBase Cloud */}
          <Card className="reveal space-y-3 p-5" style={{ animationDelay: "230ms" }}>
            <div>
              <p className="editorial-eyebrow">CareBase Cloud</p>
              <h3 className="text-2xl leading-none">Encrypted Backup</h3>
            </div>
            <p className="text-sm text-[color:var(--cp-muted)]">
              Client-side is primary. Cloud stores only encrypted records.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handlePushToCloud}>
                Push to Cloud
              </Button>
              <Button variant="outline" onClick={handlePullFromCloud}>
                Pull from Cloud
              </Button>
            </div>
            {syncStatus ? (
              <div className="text-xs text-[color:var(--cp-muted)]">{syncStatus}</div>
            ) : null}
          </Card>

          <div className="reveal" style={{ animationDelay: "270ms" }}>
            <MasterKeyPanel />
          </div>

          <div className="reveal" style={{ animationDelay: "310ms" }}>
            <SupportToolsPanel />
          </div>
        </div>
      </div>

      <Dialog open={Boolean(editSection)} onOpenChange={(open) => setEditSection(open ? editSection : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">{editTitle}</DialogTitle>
            <DialogDescription className="text-sm text-[color:var(--cp-muted)]">
              Make updates here and click Save. This is not the onboarding flow.
            </DialogDescription>
          </DialogHeader>
          {!draftProfile ? (
            <div className="text-sm text-[color:var(--cp-muted)]">Loading profile...</div>
          ) : (
            <div className="space-y-4">
              {editSection === "conditions" && (
                <div className="space-y-3">
                  {draftProfile.conditions.map((condition, index) => (
                    <div key={`${condition.name ?? "condition"}-${index}`} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-1">
                        <Label>Condition</Label>
                        <Input
                          value={condition.name ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.conditions];
                              next[index] = { ...next[index], name: event.target.value };
                              return { ...prev, conditions: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Diagnosed year</Label>
                        <Input
                          type="number"
                          min={1900}
                          max={new Date().getFullYear()}
                          value={condition.diagnosed_year ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.conditions];
                              next[index] = { ...next[index], diagnosed_year: event.target.value ? Number(event.target.value) : undefined };
                              return { ...prev, conditions: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Under treatment?</Label>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={condition.under_treatment === true ? "default" : "outline"}
                            onClick={() =>
                              setDraftProfile((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.conditions];
                                next[index] = { ...next[index], under_treatment: true };
                                return { ...prev, conditions: next };
                              })
                            }
                          >
                            Yes
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={condition.under_treatment === false ? "default" : "outline"}
                            onClick={() =>
                              setDraftProfile((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.conditions];
                                next[index] = { ...next[index], under_treatment: false };
                                return { ...prev, conditions: next };
                              })
                            }
                          >
                            No
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = prev.conditions.filter((_, i) => i !== index);
                              return { ...prev, conditions: next };
                            })
                          }
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
                      setDraftProfile((prev) => {
                        if (!prev) return prev;
                        const next = [...prev.conditions, { name: "" } as ConditionItem];
                        return { ...prev, conditions: next };
                      })
                    }
                  >
                    Add condition
                  </Button>
                </div>
              )}

              {editSection === "allergies" && (
                <div className="space-y-3">
                  {draftProfile.allergies.map((allergy, index) => (
                    <div key={`${allergy.allergen ?? "allergy"}-${index}`} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Allergen</Label>
                        <Input
                          value={allergy.allergen ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.allergies];
                              next[index] = { ...next[index], allergen: event.target.value };
                              return { ...prev, allergies: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Reaction</Label>
                        <Input
                          value={allergy.reaction ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.allergies];
                              next[index] = { ...next[index], reaction: event.target.value };
                              return { ...prev, allergies: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <select
                          className={SELECT_CLASS}
                          value={allergy.category ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.allergies];
                              next[index] = { ...next[index], category: (event.target.value || undefined) as AllergyItem["category"] };
                              return { ...prev, allergies: next };
                            })
                          }
                        >
                          <option value="">Select</option>
                          <option value="medication">Medication</option>
                          <option value="food">Food</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = prev.allergies.filter((_, i) => i !== index);
                              return { ...prev, allergies: next };
                            })
                          }
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
                      setDraftProfile((prev) => {
                        if (!prev) return prev;
                        const next = [...prev.allergies, { allergen: "" } as AllergyItem];
                        return { ...prev, allergies: next };
                      })
                    }
                  >
                    Add allergy
                  </Button>
                </div>
              )}

              {editSection === "medications" && (
                <div className="space-y-3">
                  {draftProfile.meds.map((med, index) => (
                    <div key={`${med.name ?? "med"}-${index}`} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Medication name</Label>
                        <Input
                          value={med.name ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.meds];
                              next[index] = { ...next[index], name: event.target.value };
                              return { ...prev, meds: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Dose</Label>
                        <Input
                          value={med.dose ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.meds];
                              next[index] = { ...next[index], dose: event.target.value };
                              return { ...prev, meds: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cadence</Label>
                        <select
                          className={SELECT_CLASS}
                          value={med.cadence ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.meds];
                              next[index] = { ...next[index], cadence: (event.target.value || undefined) as MedItem["cadence"] };
                              return { ...prev, meds: next };
                            })
                          }
                        >
                          <option value="">Select</option>
                          <option value="once_daily">Once daily</option>
                          <option value="multiple_daily">Multiple times daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="as_needed">As needed</option>
                        </select>
                      </div>
                      {med.cadence === "multiple_daily" && (
                        <div className="space-y-2">
                          <Label>Frequency per day</Label>
                          <Input
                            type="number"
                            min={1}
                            max={12}
                            value={med.frequency_per_day ?? ""}
                            onChange={(event) =>
                              setDraftProfile((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.meds];
                                next[index] = {
                                  ...next[index],
                                  frequency_per_day: event.target.value ? Number(event.target.value) : undefined,
                                };
                                return { ...prev, meds: next };
                              })
                            }
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Start date</Label>
                        <Input
                          type="date"
                          value={med.start_date ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.meds];
                              next[index] = { ...next[index], start_date: event.target.value || undefined };
                              return { ...prev, meds: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Last fill date</Label>
                        <Input
                          type="date"
                          value={med.last_fill_date ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.meds];
                              next[index] = { ...next[index], last_fill_date: event.target.value || undefined };
                              return { ...prev, meds: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Refill days</Label>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={med.refill_days ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.meds];
                              next[index] = { ...next[index], refill_days: event.target.value ? Number(event.target.value) : undefined };
                              return { ...prev, meds: next };
                            })
                          }
                        />
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = prev.meds.filter((_, i) => i !== index);
                              return { ...prev, meds: next };
                            })
                          }
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
                      setDraftProfile((prev) => {
                        if (!prev) return prev;
                        const next = [...prev.meds, { name: "" } as MedItem];
                        return { ...prev, meds: next };
                      })
                    }
                  >
                    Add medication
                  </Button>
                </div>
              )}

              {editSection === "procedures" && (
                <div className="space-y-3">
                  {draftProfile.procedures.map((procedure, index) => (
                    <div key={`${procedure.name ?? "procedure"}-${index}`} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-2">
                        <Label>Procedure name</Label>
                        <Input
                          value={procedure.name ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.procedures];
                              next[index] = { ...next[index], name: event.target.value };
                              return { ...prev, procedures: next };
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Approximate year</Label>
                        <Input
                          type="number"
                          min={1900}
                          max={new Date().getFullYear()}
                          value={procedure.approximate_year ?? ""}
                          onChange={(event) =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.procedures];
                              next[index] = { ...next[index], approximate_year: event.target.value ? Number(event.target.value) : undefined };
                              return { ...prev, procedures: next };
                            })
                          }
                        />
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const next = prev.procedures.filter((_, i) => i !== index);
                              return { ...prev, procedures: next };
                            })
                          }
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
                      setDraftProfile((prev) => {
                        if (!prev) return prev;
                        const next = [...prev.procedures, { name: "" } as ProcedureItem];
                        return { ...prev, procedures: next };
                      })
                    }
                  >
                    Add procedure
                  </Button>
                </div>
              )}

              {editSection === "demographics" && (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Year of birth</Label>
                      <Input
                        type="number"
                        min={1900}
                        max={new Date().getFullYear()}
                        value={draftProfile.demographics?.year_of_birth ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  demographics: {
                                    ...prev.demographics,
                                    year_of_birth: event.target.value ? Number(event.target.value) : undefined,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sex assigned at birth</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.demographics?.sex_assigned_at_birth ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  demographics: {
                                    ...prev.demographics,
                                    sex_assigned_at_birth: (event.target.value || undefined) as MedicalProfile["demographics"]["sex_assigned_at_birth"],
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        <option value="">Select</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="intersex">Intersex</option>
                        <option value="prefer_not_to_say">Prefer not to say</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Height (cm)</Label>
                      <Input
                        type="number"
                        min={50}
                        max={250}
                        value={draftProfile.demographics?.height_cm ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  demographics: {
                                    ...prev.demographics,
                                    height_cm: event.target.value ? Number(event.target.value) : undefined,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Weight (kg)</Label>
                      <Input
                        type="number"
                        min={20}
                        max={350}
                        value={draftProfile.demographics?.weight_kg ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  demographics: {
                                    ...prev.demographics,
                                    weight_kg: event.target.value ? Number(event.target.value) : undefined,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Smoking status</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.lifestyle?.smoking_status ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lifestyle: {
                                    ...prev.lifestyle,
                                    smoking_status: (event.target.value || undefined) as MedicalProfile["lifestyle"]["smoking_status"],
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        <option value="">Select</option>
                        <option value="never">Never</option>
                        <option value="former">Former</option>
                        <option value="occasional">Occasional</option>
                        <option value="regular">Regular</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Alcohol use</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.lifestyle?.alcohol_use ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lifestyle: {
                                    ...prev.lifestyle,
                                    alcohol_use: (event.target.value || undefined) as MedicalProfile["lifestyle"]["alcohol_use"],
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        <option value="">Select</option>
                        <option value="none">None</option>
                        <option value="occasional">Occasional</option>
                        <option value="weekly">Weekly</option>
                        <option value="daily">Daily</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Activity level</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.lifestyle?.activity_level ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lifestyle: {
                                    ...prev.lifestyle,
                                    activity_level: (event.target.value || undefined) as MedicalProfile["lifestyle"]["activity_level"],
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        <option value="">Select</option>
                        <option value="rarely">Rarely</option>
                        <option value="1_2_per_week">1-2 per week</option>
                        <option value="3_plus_per_week">3+ per week</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {editSection === "family_history" && (
                <div className="grid gap-2 md:grid-cols-2">
                  {(["heart_disease", "stroke", "diabetes", "cancer", "hypertension", "none_or_unsure"] as const).map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(draftProfile.family_history?.[key])}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  family_history: {
                                    ...prev.family_history,
                                    [key]: event.target.checked,
                                  },
                                }
                              : prev
                          )
                        }
                      />
                      {key.replace(/_/g, " ")}
                    </label>
                  ))}
                </div>
              )}

              {editSection === "preferences" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Care priority</Label>
                    <select
                      className={SELECT_CLASS}
                      value={draftProfile.preferences?.care_priority ?? "no_preference"}
                      onChange={(event) =>
                        setDraftProfile((prev) =>
                          prev
                            ? {
                                ...prev,
                                preferences: {
                                  ...prev.preferences,
                                  care_priority: event.target.value as MedicalProfile["preferences"]["care_priority"],
                                },
                              }
                            : prev
                        )
                      }
                    >
                      <option value="closest_location">Closest location</option>
                      <option value="weekend_availability">Weekend availability</option>
                      <option value="specific_provider_gender">Specific provider gender</option>
                      <option value="no_preference">No preference</option>
                    </select>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Preferred radius</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.preferences?.radius_miles ?? 5}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  preferences: {
                                    ...prev.preferences,
                                    radius_miles: Number(event.target.value) as MedicalProfile["preferences"]["radius_miles"],
                                  },
                                }
                              : prev
                          )
                        }
                      >
                        <option value={3}>3 miles</option>
                        <option value={5}>5 miles</option>
                        <option value={10}>10 miles</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Preferred pharmacy</Label>
                      <Input
                        value={draftProfile.preferences?.preferred_pharmacy ?? ""}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  preferences: { ...prev.preferences, preferred_pharmacy: event.target.value },
                                }
                              : prev
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Preferred days</Label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((day) => (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={draftProfile.preferences?.preferred_days?.includes(day) ? "default" : "outline"}
                          onClick={() =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const current = prev.preferences.preferred_days ?? [];
                              const next = current.includes(day)
                                ? current.filter((d) => d !== day)
                                : [...current, day];
                              return { ...prev, preferences: { ...prev.preferences, preferred_days: next } };
                            })
                          }
                        >
                          {day.slice(0, 3).toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Appointment windows</Label>
                    <div className="flex flex-wrap gap-2">
                      {APPOINTMENT_WINDOWS.map((windowValue) => (
                        <Button
                          key={windowValue}
                          type="button"
                          size="sm"
                          variant={draftProfile.preferences?.appointment_windows?.includes(windowValue) ? "default" : "outline"}
                          onClick={() =>
                            setDraftProfile((prev) => {
                              if (!prev) return prev;
                              const current = prev.preferences.appointment_windows ?? [];
                              const next = current.includes(windowValue)
                                ? current.filter((w) => w !== windowValue)
                                : [...current, windowValue];
                              return { ...prev, preferences: { ...prev.preferences, appointment_windows: next } };
                            })
                          }
                        >
                          {windowValue}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Provider gender preference</Label>
                    <select
                      className={SELECT_CLASS}
                      value={draftProfile.preferences?.provider_gender_preference ?? ""}
                      onChange={(event) =>
                        setDraftProfile((prev) =>
                          prev
                            ? {
                                ...prev,
                                preferences: {
                                  ...prev.preferences,
                                  provider_gender_preference: (event.target.value || undefined) as MedicalProfile["preferences"]["provider_gender_preference"],
                                },
                              }
                            : prev
                        )
                      }
                    >
                      <option value="">Select</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="no_preference">No preference</option>
                    </select>
                  </div>
                </div>
              )}

              {editSection === "reminders" && (
                <div className="space-y-4">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draftProfile.reminders.med_runout}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? { ...prev, reminders: { ...prev.reminders, med_runout: event.target.checked } }
                              : prev
                          )
                        }
                      />
                      Medication runout
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draftProfile.reminders.checkup_due}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? { ...prev, reminders: { ...prev.reminders, checkup_due: event.target.checked } }
                              : prev
                          )
                        }
                      />
                      Checkup due
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draftProfile.reminders.followup_nudges}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? { ...prev, reminders: { ...prev.reminders, followup_nudges: event.target.checked } }
                              : prev
                          )
                        }
                      />
                      Follow-up nudges
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Reminder mode</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.reminders.reminder_mode}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? { ...prev, reminders: { ...prev.reminders, reminder_mode: event.target.value as MedicalProfile["reminders"]["reminder_mode"] } }
                              : prev
                          )
                        }
                      >
                        <option value="all">All</option>
                        <option value="medications_only">Medications only</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Proactive state</Label>
                      <select
                        className={SELECT_CLASS}
                        value={draftProfile.reminders.proactive_state}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? { ...prev, reminders: { ...prev.reminders, proactive_state: event.target.value as MedicalProfile["reminders"]["proactive_state"] } }
                              : prev
                          )
                        }
                      >
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Quiet hours start</Label>
                      <Input
                        type="time"
                        value={draftProfile.reminders.quiet_hours.start}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  reminders: {
                                    ...prev.reminders,
                                    quiet_hours: { ...prev.reminders.quiet_hours, start: event.target.value },
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Quiet hours end</Label>
                      <Input
                        type="time"
                        value={draftProfile.reminders.quiet_hours.end}
                        onChange={(event) =>
                          setDraftProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  reminders: {
                                    ...prev.reminders,
                                    quiet_hours: { ...prev.reminders.quiet_hours, end: event.target.value },
                                  },
                                }
                              : prev
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditSection(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[color:var(--cp-danger)]" aria-hidden="true" />
              <DialogTitle className="text-2xl">Delete All Data?</DialogTitle>
            </div>
            <DialogDescription className="text-sm text-[color:var(--cp-muted)]">
              This will permanently delete your clinical profile, symptom logs, action receipts, and all associated data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteOpen(false);
                push({
                  title: "Delete Flow",
                  description: "Deletion confirmation recorded. Backend deletion pipeline is next.",
                  variant: "warning",
                });
              }}
            >
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
