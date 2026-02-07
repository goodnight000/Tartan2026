import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  addDoc,
  where
} from "firebase/firestore";
import { db, firebaseEnabled } from "@/lib/firebase";
import type { ActionLog, MedicalProfile, SymptomLog } from "@/lib/types";
import * as localDb from "@/lib/indexeddb";

export async function getProfile(userId: string): Promise<MedicalProfile | null> {
  if (!firebaseEnabled || !db) {
    return localDb.getProfile(userId);
  }
  const ref = doc(collection(db, "medical_profiles"), userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as MedicalProfile;
}

export async function upsertProfile(
  userId: string,
  payload: Omit<MedicalProfile, "user_id" | "updated_at">
): Promise<void> {
  if (!firebaseEnabled || !db) {
    await localDb.upsertProfile(userId, payload);
    return;
  }
  const ref = doc(collection(db, "medical_profiles"), userId);
  await setDoc(
    ref,
    {
      ...payload,
      user_id: userId,
      updated_at: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function addSymptomLog(
  userId: string,
  payload: Omit<SymptomLog, "created_at">
): Promise<void> {
  if (!firebaseEnabled || !db) {
    await localDb.addSymptomLog(userId, payload);
    return;
  }
  await addDoc(collection(db, "symptom_logs"), {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString()
  });
}

export async function getSymptomLogs(userId: string, max = 20) {
  if (!firebaseEnabled || !db) {
    return localDb.getSymptomLogs(userId, max);
  }
  const q = query(
    collection(db, "symptom_logs"),
    where("user_id", "==", userId),
    orderBy("created_at", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  const items = snap.docs.map((docSnap) => docSnap.data() as SymptomLog);
  return items
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, max);
}

export async function addActionLog(
  userId: string,
  payload: Omit<ActionLog, "created_at">
): Promise<void> {
  if (!firebaseEnabled || !db) {
    await localDb.addActionLog(userId, payload);
    return;
  }
  await addDoc(collection(db, "action_logs"), {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString()
  });
}

export async function getActionLogs(userId: string, max = 20) {
  if (!firebaseEnabled || !db) {
    return localDb.getActionLogs(userId, max);
  }
  const q = query(
    collection(db, "action_logs"),
    where("user_id", "==", userId),
    orderBy("created_at", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  const items = snap.docs.map((docSnap) => docSnap.data() as ActionLog);
  return items
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, max);
}
