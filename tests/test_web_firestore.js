import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyBdaIbBKlPn1yTxB2g7zuycPk-B1WF9TPk",
    authDomain: "antigravity-jairo-2026.firebaseapp.com",
    projectId: "antigravity-jairo-2026",
    storageBucket: "antigravity-jairo-2026.firebasestorage.app",
    messagingSenderId: "48939331003",
    appId: "1:48939331003:web:450caf121f1b53693b689e"
};

try {
    console.log("Initializing web SDK...");
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    console.log("Web SDK Initialized. Checking firestore READ...");
    
    // We try to read some public or default collection
    // Note: depending on firestore.rules, this might get PERMISSION_DENIED.
    const q = query(collection(db, "AuditLogs"), limit(1));
    const querySnapshot = await getDocs(q);
    console.log("✅ Firestore Web SDK connected successfully!");
    console.log("Size:", querySnapshot.size);
} catch (err) {
    if (err.code === "permission-denied") {
        console.log("✅ Firestore Web SDK connected! (got permission-denied as expected from security rules without user login)");
    } else {
        console.error("❌ Firestore Web SDK error:", err);
    }
}
