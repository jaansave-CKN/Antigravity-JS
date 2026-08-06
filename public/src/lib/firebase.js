import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import firebaseConfig from '../../firebase-config.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export function signOut() {
  return fbSignOut(auth);
}

// Token fresco de Firebase — el SDK lo renueva automáticamente antes de que expire.
export async function getIdToken(forceRefresh = false) {
  return auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
}

export { onAuthStateChanged };
