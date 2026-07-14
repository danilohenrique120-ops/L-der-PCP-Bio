import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBLhjjpa69UbjZyNHg3U8XXxCed4qV1HJY",
  authDomain: "bioscale-enterprise-prod.firebaseapp.com",
  projectId: "bioscale-enterprise-prod",
  storageBucket: "bioscale-enterprise-prod.firebasestorage.app",
  messagingSenderId: "1020761268162",
  appId: "1:1020761268162:web:e553364cf8a2604b5e805b",
  measurementId: "G-ZRKHSSXF6M"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

let activeDb: Firestore | null = null;

export function getTenantDb(databaseId?: string): Firestore {
  if (databaseId) {
    activeDb = initializeFirestore(app, {}, databaseId);
  }
  if (!activeDb) {
    throw new Error("Banco de dados do inquilino não inicializado.");
  }
  return activeDb;
}

export { app, auth };
