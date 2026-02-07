import type { User } from "firebase/auth";
import type { LocalUser } from "@/lib/auth-local";

export type AuthUser = User | LocalUser;

export function isFirebaseUser(user: AuthUser | null): user is User {
  return Boolean(user && typeof (user as User).getIdToken === "function");
}

export async function getIdTokenMaybe(user: AuthUser | null): Promise<string | undefined> {
  if (!user || !isFirebaseUser(user)) return undefined;
  try {
    return await user.getIdToken();
  } catch {
    return undefined;
  }
}
