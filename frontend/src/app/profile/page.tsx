"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MedicalProfile, SymptomLog } from "@/lib/types";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getActionLogs, getProfile, getSymptomLogs } from "@/lib/firestore";
import { useAuthUser } from "@/lib/useAuth";

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useAuthUser();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, router, user]);
  const profileQuery = useQuery({
    queryKey: ["profile"],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) {
        router.push("/login");
        throw new Error("Not authenticated");
      }
      const profile = await getProfile(user.uid);
      if (!profile) throw new Error("No profile found");
      return profile;
    }
  });

  const symptomsQuery = useQuery({
    queryKey: ["symptom-logs"],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return { items: [] as SymptomLog[] };
      const items = await getSymptomLogs(user.uid, 20);
      return { items };
    }
  });

  const actionsQuery = useQuery({
    queryKey: ["action-logs"],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return { items: [] as ActionLog[] };
      const items = await getActionLogs(user.uid, 20);
      return { items };
    }
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Profile</h1>
        <p className="text-slate-600">Snapshot of your stored medical data.</p>
      </header>

      <Card className="space-y-3">
        <h2 className="text-xl font-semibold">Medical Profile</h2>
        {profileQuery.isLoading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : profileQuery.data ? (
          <div className="space-y-2 text-sm text-slate-700">
            <div>
              <span className="font-semibold">Conditions:</span>{" "}
              {profileQuery.data.conditions.join(", ") || "None"}
            </div>
            <div>
              <span className="font-semibold">Allergies:</span>{" "}
              {profileQuery.data.allergies.join(", ") || "None"}
            </div>
            <div className="space-y-2">
              <span className="font-semibold">Medications:</span>
              <div className="flex flex-wrap gap-2">
                {profileQuery.data.meds.map((med) => (
                  <Badge key={med.name}>
                    {med.name} ({med.dose})
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <span className="font-semibold">Family history:</span>{" "}
              {profileQuery.data.family_history || "None"}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No profile on file.</p>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">Recent symptoms</h2>
          {symptomsQuery.data?.items?.length ? (
            <ul className="space-y-2 text-sm text-slate-700">
              {symptomsQuery.data.items.map((item) => (
                <li key={`${item.created_at}-${item.symptom_text}`}>
                  <div className="font-semibold">{item.symptom_text}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(item.created_at).toLocaleString()} · Severity {item.severity}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No symptom logs.</p>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">Recent actions</h2>
          {actionsQuery.data?.items?.length ? (
            <ul className="space-y-2 text-sm text-slate-700">
              {actionsQuery.data.items.map((item) => (
                <li key={`${item.created_at}-${item.action_type}`}>
                  <div className="font-semibold">{item.action_type}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(item.created_at).toLocaleString()} · {item.status}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No action logs.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
