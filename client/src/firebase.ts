import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBdaIbBKlPn1yTxB2g7zuycPk-B1WF9TPk",
  authDomain: "antigravity-jairo-2026.firebaseapp.com",
  projectId: "antigravity-jairo-2026",
  storageBucket: "antigravity-jairo-2026.firebasestorage.app",
  messagingSenderId: "48939331003",
  appId: "1:48939331003:web:450caf121f1b53693b689e"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;