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
import { db } from "@/lib/firebase";
import type { ActionLog, MedicalProfile, SymptomLog } from "@/lib/types";

const profileCollection = collection(db, "medical_profiles");
const symptomCollection = collection(db, "symptom_logs");
const actionCollection = collection(db, "action_logs");

export async function getProfile(userId: string): Promise<MedicalProfile | null> {
  const ref = doc(profileCollection, userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as MedicalProfile;
}

export async function upsertProfile(
  userId: string,
  payload: Omit<MedicalProfile, "user_id" | "updated_at">
): Promise<void> {
  const ref = doc(profileCollection, userId);
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
  await addDoc(symptomCollection, {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString()
  });
}

export async function getSymptomLogs(userId: string, max = 20) {
  const q = query(symptomCollection, where("user_id", "==", userId));
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
  await addDoc(actionCollection, {
    ...payload,
    user_id: userId,
    created_at: new Date().toISOString()
  });
}

export async function getActionLogs(userId: string, max = 20) {
  const q = query(actionCollection, where("user_id", "==", userId));
  const snap = await getDocs(q);
  const items = snap.docs.map((docSnap) => docSnap.data() as ActionLog);
  return items
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, max);
}
