import { getAdminDb } from "@/lib/firebase-admin";
import type { MedicalProfile } from "@/lib/types";

export async function loadProfile(
  userId: string
): Promise<MedicalProfile | null> {
  const snap = await getAdminDb()
    .collection("medical_profiles")
    .doc(userId)
    .get();

  if (!snap.exists) return null;
  return snap.data() as MedicalProfile;
}
