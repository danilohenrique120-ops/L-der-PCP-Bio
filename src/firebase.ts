import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getFirestore, Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBLhjjpa69UbjZyNHg3U8XXxCed4qV1HJY",
  authDomain: "bioscale-enterprise-prod.firebaseapp.com",
  projectId: "bioscale-enterprise-prod",
  storageBucket: "bioscale-enterprise-prod.firebasestorage.app",
  messagingSenderId: "1020761268162",
  appId: "1:1020761268162:web:e553364cf8a2604b5e805b",
  measurementId: "G-ZRKHSSXF6M"
};

// Initialize Firebase App & Auth
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

// Global cache for tenant Firestore instances to avoid already-initialized errors
const dbCache = new Map<string, Firestore>();

export function getTenantDb(databaseId?: string): Firestore {
  const dbId = databaseId || "(default)";
  
  if (dbCache.has(dbId)) {
    return dbCache.get(dbId)!;
  }

  try {
    const db = dbId === "(default)" || dbId === "default" 
      ? getFirestore(app)
      : getFirestore(app, dbId);
    dbCache.set(dbId, db);
    return db;
  } catch (e) {
    try {
      const db = initializeFirestore(app, {}, dbId);
      dbCache.set(dbId, db);
      return db;
    } catch (err) {
      console.error("Erro ao inicializar Firestore para databaseId:", dbId, err);
      const fallbackDb = getFirestore(app);
      dbCache.set(dbId, fallbackDb);
      return fallbackDb;
    }
  }
}

export { app, auth };
