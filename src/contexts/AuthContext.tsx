import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  User,
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
import { auth, db } from '../firebase';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const profile = await loadUserProfile(firebaseUser.uid);
        setUserProfile(profile);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  async function loadUserProfile(uid: string): Promise<UserProfile | null> {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as UserProfile;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function createUserProfile(
    firebaseUser: User,
    displayName: string
  ): Promise<void> {
    const profile: UserProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email || '',
      displayName,
      photoURL: firebaseUser.photoURL || '',
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
      disabled: false,
      role: 'user',
      proyectos: [],
    };
    await setDoc(doc(db, 'users', firebaseUser.uid), profile);
    setUserProfile(profile);
  }

  async function signIn(email: string, password: string): Promise<void> {
    const result = await signInWithEmailAndPassword(auth, email, password);
    await updateDoc(doc(db, 'users', result.user.uid), {
      lastLogin: serverTimestamp(),
    });
  }

  async function signUp(
    email: string,
    password: string,
    displayName: string
  ): Promise<void> {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });
    await createUserProfile(result.user, displayName);
    await firebaseSendEmailVerification(result.user);
  }

  async function signOut(): Promise<void> {
    await firebaseSignOut(auth);
  }

  async function sendEmailVerification(): Promise<void> {
    if (user) await firebaseSendEmailVerification(user);
  }

  async function sendPasswordReset(email: string): Promise<void> {
    await firebaseSendPasswordResetEmail(auth, email);
  }

  async function signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const existing = await loadUserProfile(result.user.uid);
    if (!existing) {
      await createUserProfile(result.user, result.user.displayName || 'Usuario');
    }
    await updateDoc(doc(db, 'users', result.user.uid), {
      lastLogin: serverTimestamp(),
    });
  }

  async function updateUserProfile(data: Partial<UserProfile>): Promise<void> {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      ...data,
      updatedAt: serverTimestamp(),
    });
    setUserProfile((prev) => (prev ? { ...prev, ...data } : prev));
  }

  const isPermitted = userProfile ? !userProfile.disabled : true;

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        loading,
        signIn,
        signUp,
        signOut,
        sendEmailVerification,
        sendPasswordReset,
        signInWithGoogle,
        updateUserProfile,
        isPermitted,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}