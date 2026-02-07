export type LocalUser = {
  uid: string;
  isAnonymous: true;
  email: string | null;
};

const LOCAL_USER_KEY = "carepilot.local_user_id";
let cachedUser: LocalUser | null = null;

function generateLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ensureLocalUser(): LocalUser {
  if (cachedUser) return cachedUser;
  if (typeof window === "undefined") {
    cachedUser = { uid: "local-server", isAnonymous: true, email: null };
    return cachedUser;
  }

  let userId = window.localStorage.getItem(LOCAL_USER_KEY);
  if (!userId) {
    userId = generateLocalId();
    window.localStorage.setItem(LOCAL_USER_KEY, userId);
  }

  cachedUser = { uid: userId, isAnonymous: true, email: null };
  return cachedUser;
}

export function clearLocalUser(): void {
  cachedUser = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LOCAL_USER_KEY);
  }
}
