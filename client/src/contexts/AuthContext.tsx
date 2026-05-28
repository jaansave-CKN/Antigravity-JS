import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification as firebaseSendEmailVerification,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

// ── Dev-mode fallback user (used when Firebase is unreachable) ─────────────────
const DEV_PROFILE: UserProfile = {
  uid: 'dev-mode',
  email: 'dev@local',
  displayName: 'Dev Mode',
  photoURL: '',
  createdAt: null,
  lastLogin: null,
  disabled: false,
  role: 'admin',
  proyectos: [],
};

const FIREBASE_TIMEOUT_MS = 2000;

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: any;
  lastLogin: any;
  disabled: boolean;
  role: 'admin' | 'user';
  proyectos: string[];
}

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isDevMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendEmailVerification: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  updateUserProfile: (data: Partial<UserProfile>) => Promise<void>;
  isPermitted: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Firebase timeout (${ms}ms)`)), ms)
    ),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDevMode, setIsDevMode] = useState(false);
  const resolvedRef = useRef(false);

  useEffect(() => {
    let auth: import('firebase/auth').Auth | null = null;

    // Fallback: si Firebase no dispara onAuthStateChanged en FIREBASE_TIMEOUT_MS,
    // activamos dev-mode para que la UI renderice.
    const fallbackTimer = setTimeout(() => {
      if (!resolvedRef.current) {
        console.warn('[AuthContext] Firebase no respondió — activando modo offline (dev-mode)');
        setIsDevMode(true);
        setUserProfile(DEV_PROFILE);
        setUser(null);
        setLoading(false);
        resolvedRef.current = true;
      }
    }, FIREBASE_TIMEOUT_MS);

    async function initFirebase() {
      try {
        const firebaseModule = await withTimeout(
          import('../firebase'),
          FIREBASE_TIMEOUT_MS
        );
        auth = firebaseModule.auth;

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          if (resolvedRef.current && isDevMode) return; // ya en dev-mode, ignorar
          clearTimeout(fallbackTimer);
          resolvedRef.current = true;

          try {
            setUser(firebaseUser);
            setIsDevMode(false);

            if (firebaseUser) {
              try {
                const profile = await loadUserProfile(firebaseModule.db, firebaseUser.uid);
                setUserProfile(profile);
              } catch {
                setUserProfile(null);
              }
            } else {
              setUserProfile(null);
            }
          } catch (err) {
            console.warn('[AuthContext] Error en onAuthStateChanged:', err);
            setUser(null);
            setUserProfile(null);
          } finally {
            setLoading(false);
          }
        });

        return unsubscribe;
      } catch (err) {
        console.warn('[AuthContext] Firebase no disponible — modo offline:', err);
        clearTimeout(fallbackTimer);
        if (!resolvedRef.current) {
          resolvedRef.current = true;
          setIsDevMode(true);
          setUserProfile(DEV_PROFILE);
          setUser(null);
          setLoading(false);
        }
        return () => {};
      }
    }

    const unsubscribePromise = initFirebase();

    return () => {
      clearTimeout(fallbackTimer);
      unsubscribePromise.then(unsub => unsub?.());
    };
  }, []);

  async function loadUserProfile(db: import('firebase/firestore').Firestore, uid: string): Promise<UserProfile | null> {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? (docSnap.data() as UserProfile) : null;
    } catch {
      return null;
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    try {
      const { auth: fbAuth, db: fbDb } = await import('../firebase');
      const result = await signInWithEmailAndPassword(fbAuth, email, password);
      try {
        await updateDoc(doc(fbDb, 'users', result.user.uid), { lastLogin: serverTimestamp() });
      } catch (e) {
        console.warn('[AuthContext] No se pudo actualizar lastLogin:', e);
      }
    } catch (err) {
      console.warn('[AuthContext] signIn failed:', err);
      throw err;
    }
  }

  async function signUp(email: string, password: string, displayName: string): Promise<void> {
    try {
      const { auth: fbAuth, db: fbDb } = await import('../firebase');
      const result = await createUserWithEmailAndPassword(fbAuth, email, password);
      try { await updateProfile(result.user, { displayName }); } catch {}
      try {
        const profile: UserProfile = {
          uid: result.user.uid,
          email: result.user.email || '',
          displayName,
          photoURL: result.user.photoURL || '',
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
          disabled: false,
          role: 'user',
          proyectos: [],
        };
        await setDoc(doc(fbDb, 'users', result.user.uid), profile);
        setUserProfile(profile);
      } catch {}
      try { await firebaseSendEmailVerification(result.user); } catch {}
    } catch (err) {
      console.warn('[AuthContext] signUp failed:', err);
      throw err;
    }
  }

  async function signOut(): Promise<void> {
    try {
      if (isDevMode) { setUser(null); setUserProfile(null); return; }
      const { auth: fbAuth } = await import('../firebase');
      await firebaseSignOut(fbAuth);
    } catch (err) {
      console.warn('[AuthContext] signOut failed:', err);
      throw err;
    }
  }

  async function sendEmailVerification(): Promise<void> {
    if (!user) return;
    try {
      await firebaseSendEmailVerification(user);
    } catch (err) {
      console.warn('[AuthContext] sendEmailVerification failed:', err);
    }
  }

  async function sendPasswordReset(email: string): Promise<void> {
    try {
      const { auth: fbAuth } = await import('../firebase');
      await firebaseSendPasswordResetEmail(fbAuth, email);
    } catch (err) {
      console.warn('[AuthContext] sendPasswordReset failed:', err);
      throw err;
    }
  }

  async function signInWithGoogle(): Promise<void> {
    try {
      const { auth: fbAuth } = await import('../firebase');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(fbAuth, provider);
    } catch (err) {
      console.warn('[AuthContext] signInWithGoogle failed:', err);
      throw err;
    }
  }

  async function updateUserProfile(data: Partial<UserProfile>): Promise<void> {
    if (!user) return;
    try {
      const { db: fbDb } = await import('../firebase');
      await updateDoc(doc(fbDb, 'users', user.uid), data as any);
      setUserProfile(prev => prev ? { ...prev, ...data } : null);
    } catch (err) {
      console.warn('[AuthContext] updateUserProfile failed:', err);
    }
  }

  const isPermitted = !!(userProfile && !userProfile.disabled);

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    isDevMode,
    signIn,
    signUp,
    signOut,
    sendEmailVerification,
    sendPasswordReset,
    signInWithGoogle,
    updateUserProfile,
    isPermitted,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
