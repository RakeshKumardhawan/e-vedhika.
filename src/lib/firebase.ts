import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const legacyDb = getFirestore(app);
export const db = firebaseConfig.firestoreDatabaseId === "(default)" || !firebaseConfig.firestoreDatabaseId 
  ? legacyDb 
  : getFirestore(app, firebaseConfig.firestoreDatabaseId);
