"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Clock, FileText, Trash2, Download, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrustBadge } from "@/components/TrustBadge";
import { PageHeader } from "@/components/PageHeader";
import { SkeletonCard } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionLog, SymptomLog } from "@/lib/types";
import { getActionLogs, getProfile, getSymptomLogs } from "@/lib/firestore";
import { useAuthUser } from "@/lib/useAuth";
import { useToast } from "@/components/ui/toast";

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="reveal space-y-4 p-7">
        <PageHeader
          eyebrow="Trust Center"
          title="Profile, Permissions, and Receipts"
          subtitle="Inspect the exact data used in care decisions, review action history, and control your privacy posture."
          chips={<span className="status-chip status-chip--info">Consent Records Enabled</span>}
        />
        <TrustBadge variant="block" />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Clinical Profile */}
        <Card className="reveal space-y-4 p-6" style={{ animationDelay: "70ms" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="editorial-eyebrow">Clinical Profile</p>
              <h2 className="text-3xl leading-none">Structured Context</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=health_baseline")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=medications_allergies")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=medications_allergies")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=health_baseline")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=health_baseline")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=health_baseline")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=care_logistics")}>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/onboarding?step=reminders_controls")}>
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
              description="Complete the intake flow to build your clinical profile."
              action={
                <Button onClick={() => router.push("/onboarding")}>Start Intake</Button>
              }
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
        </div>
      </div>

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
