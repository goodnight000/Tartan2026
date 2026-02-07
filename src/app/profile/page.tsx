"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { authorizedFetch } from "@/lib/api";
import type { ActionLog, MedicalProfile, SymptomLog } from "@/lib/types";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ProfilePage() {
  const router = useRouter();

  useEffect(() => {
    const ensureAuth = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
      }
    };
    ensureAuth();
  }, [router]);
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const response = await authorizedFetch("/profile");
      if (response.status === 401) {
        router.push("/login");
        throw new Error("Not authenticated");
      }
      if (!response.ok) throw new Error("Failed to load profile");
      return (await response.json()) as MedicalProfile;
    }
  });

  const symptomsQuery = useQuery({
    queryKey: ["symptom-logs"],
    queryFn: async () => {
      const response = await authorizedFetch("/logs/symptoms?limit=20");
      if (!response.ok) return { items: [] as SymptomLog[] };
      return (await response.json()) as { items: SymptomLog[] };
    }
  });

  const actionsQuery = useQuery({
    queryKey: ["action-logs"],
    queryFn: async () => {
      const response = await authorizedFetch("/logs/actions?limit=20");
      if (!response.ok) return { items: [] as ActionLog[] };
      return (await response.json()) as { items: ActionLog[] };
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
