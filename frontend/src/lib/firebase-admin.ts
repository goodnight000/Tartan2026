import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

let _app: App | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;

export const firebaseAdminEnabled = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
);

function ensureInit(): App {
  if (!firebaseAdminEnabled) {
    throw new Error("Firebase admin not configured.");
  }
  if (!_app) {
    if (getApps().length) {
      _app = getApps()[0];
    } else {
      _app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(
            /\\n/g,
            "\n"
          ),
        }),
      });
    }
  }
  return _app;
}

export function getAdminDb(): Firestore {
  if (!_db) {
    ensureInit();
    _db = getFirestore();
  }
  return _db;
}

export function getAdminAuth(): Auth {
  if (!_auth) {
    ensureInit();
    _auth = getAuth();
  }
  return _auth;
}
