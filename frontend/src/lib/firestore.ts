import type { ActionLog, MedicalProfile, SymptomLog } from "@/lib/types";
import { getJsonRecord, getTextRecord, setJsonRecord } from "@/lib/carebase/storage";
import { listRecords } from "@/lib/carebase/database";
import { pullCloudToLocal } from "@/lib/carebase/cloud";

function profileKey(userId: string) {
  return `profile:${userId}`;
}

function symptomKey(userId: string) {
  return `symptom_logs:${userId}`;
}

function actionKey(userId: string) {
  return `action_logs:${userId}`;
}

function legacyKey(key: string, userId: string): string {
  return key.replace(userId, "{user_id}");
}

async function getOrPull<T>(key: string, legacy?: string): Promise<T | null> {
  const local = await getJsonRecord<T>(key).catch(() => null);
  if (local) return local;
  if (legacy) {
    const legacyLocal = await getJsonRecord<T>(legacy).catch(() => null);
    if (legacyLocal) {
      await setJsonRecord(key, legacyLocal as T);
      return legacyLocal;
    }
  }
  try {
    await pullCloudToLocal();
    const pulled = await getJsonRecord<T>(key).catch(() => null);
    if (pulled) return pulled;
    if (legacy) {
      const legacyPulled = await getJsonRecord<T>(legacy).catch(() => null);
      if (legacyPulled) {
        await setJsonRecord(key, legacyPulled as T);
        return legacyPulled;
      }
    }
    return null;
  } catch {
    return local;
  }
}

function normalizeJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("```")) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match?.[1]) return match[1].trim();
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
}

function parseJsonLoose<T>(text: string): T | null {
  const candidate = normalizeJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as T;
    if (typeof parsed === "string") {
      try {
        return JSON.parse(parsed) as T;
      } catch {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

async function resolveProfileRecord(userId: string): Promise<MedicalProfile | null> {
  const primaryKey = profileKey(userId);
  const legacy = legacyKey(primaryKey, userId);
  const preferredKeys = [primaryKey, legacy, "profile", "profile:{user_id}"];

  const tryKeys = async (keys: string[]): Promise<{ key: string; value: MedicalProfile } | null> => {
    for (const key of keys) {
      const value = await getJsonRecord<MedicalProfile>(key).catch(() => null);
      if (value) return { key, value };
      const raw = await getTextRecord(key).catch(() => null);
      if (raw) {
        const parsed = parseJsonLoose<MedicalProfile>(raw);
        if (parsed) return { key, value: parsed };
      }
    }
    return null;
  };

  const localMatch = await tryKeys(preferredKeys);
  if (localMatch) {
    if (localMatch.key !== primaryKey) {
      await setJsonRecord(primaryKey, localMatch.value);
    }
    return localMatch.value;
  }

  const localRecords = await listRecords().catch(() => []);
  const profileCandidates = localRecords
    .filter((record) => record.key === "profile" || record.key.startsWith("profile:") || record.key.includes("profile"))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (profileCandidates.length > 0) {
    for (const candidate of profileCandidates) {
      const value = await getJsonRecord<MedicalProfile>(candidate.key).catch(() => null);
      if (value) {
        await setJsonRecord(primaryKey, value);
        return value;
      }
      const raw = await getTextRecord(candidate.key).catch(() => null);
      if (raw) {
        const parsed = parseJsonLoose<MedicalProfile>(raw);
        if (parsed) {
          await setJsonRecord(primaryKey, parsed);
          return parsed;
        }
      }
    }
  }

  return null;
}

function normalizeStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? item : ""))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeProfileValue(profile: MedicalProfile): MedicalProfile {
  const rawConditions = (profile as unknown as { conditions?: unknown }).conditions;
  const rawAllergies = (profile as unknown as { allergies?: unknown }).allergies;
  const rawMeds = (profile as unknown as { meds?: unknown }).meds;
  const rawProcedures = (profile as unknown as { procedures?: unknown }).procedures;

  const conditions = Array.isArray(rawConditions)
    ? rawConditions.every((item) => typeof item === "string")
      ? (rawConditions as string[]).map((name) => ({ name }))
      : (rawConditions as MedicalProfile["conditions"])
    : normalizeStringList(rawConditions).map((name) => ({ name }));
  const allergies = Array.isArray(rawAllergies)
    ? rawAllergies.every((item) => typeof item === "string")
      ? (rawAllergies as string[]).map((allergen) => ({ allergen }))
      : (rawAllergies as MedicalProfile["allergies"])
    : normalizeStringList(rawAllergies).map((allergen) => ({ allergen }));
  const meds = Array.isArray(rawMeds)
    ? rawMeds.every((item) => typeof item === "string")
      ? (rawMeds as string[]).map((name) => ({ name }))
      : (rawMeds as MedicalProfile["meds"])
    : normalizeStringList(rawMeds).map((name) => ({ name }));
  const procedures = Array.isArray(rawProcedures)
    ? rawProcedures.every((item) => typeof item === "string")
      ? (rawProcedures as string[]).map((name) => ({ name }))
      : (rawProcedures as MedicalProfile["procedures"])
    : normalizeStringList(rawProcedures).map((name) => ({ name }));

  if (!conditions.length) {
    const legacy = normalizeStringList((profile as unknown as { conditions_legacy?: unknown }).conditions_legacy);
    if (legacy.length) {
      profile.conditions = legacy.map((name) => ({ name }));
    }
  }

  return {
    ...profile,
    conditions,
    allergies,
    meds,
    procedures,
  };
}

export async function getProfile(userId: string): Promise<MedicalProfile | null> {
  const direct = await getOrPull(profileKey(userId), legacyKey(profileKey(userId), userId));
  if (direct) return normalizeProfileValue(direct);
  try {
    await pullCloudToLocal();
  } catch {
    // ignore
  }
  const resolved = await resolveProfileRecord(userId);
  return resolved ? normalizeProfileValue(resolved) : null;
}

export async function upsertProfile(
  userId: string,
  payload: Omit<MedicalProfile, "user_id" | "updated_at">
): Promise<void> {
  const record: MedicalProfile = {
    ...payload,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  await setJsonRecord(profileKey(userId), record);
}

export async function addSymptomLog(
  userId: string,
  payload: Omit<SymptomLog, "created_at">
): Promise<void> {
  const existing = (await getOrPull<SymptomLog[]>(symptomKey(userId), legacyKey(symptomKey(userId), userId))) ?? [];
  const next: SymptomLog = {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString(),
  } as SymptomLog;
  const updated = [next, ...existing].slice(0, 200);
  await setJsonRecord(symptomKey(userId), updated);
}

export async function getSymptomLogs(userId: string, max = 20) {
  const logs = (await getOrPull<SymptomLog[]>(symptomKey(userId), legacyKey(symptomKey(userId), userId))) ?? [];
  return logs.slice(0, max);
}

export async function addActionLog(
  userId: string,
  payload: Omit<ActionLog, "created_at">
): Promise<void> {
  const existing = (await getOrPull<ActionLog[]>(actionKey(userId), legacyKey(actionKey(userId), userId))) ?? [];
  const next: ActionLog = {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString(),
  } as ActionLog;
  const updated = [next, ...existing].slice(0, 200);
  await setJsonRecord(actionKey(userId), updated);
}

export async function getActionLogs(userId: string, max = 20) {
  const logs = (await getOrPull<ActionLog[]>(actionKey(userId), legacyKey(actionKey(userId), userId))) ?? [];
  return logs.slice(0, max);
}
