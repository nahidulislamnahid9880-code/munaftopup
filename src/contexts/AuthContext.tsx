import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../lib/firebase';
import {initializeDefaultCatalogIfMissing} from '../lib/seedData';
import type {AdminSessionUser, CustomerProfile} from '../types';

interface AuthContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  customerProfile: CustomerProfile | null;
  signInCustomerWithGoogle: () => Promise<void>;
  signOutCustomer: () => Promise<void>;
  updateCustomerPhone: (name: string, phone: string) => Promise<void>;

  adminToken: string | null;
  adminUser: AdminSessionUser | null;
  adminAuthLoading: boolean;
  adminLoginWithGoogle: () => Promise<AdminSessionUser>;
  adminLoginWithPassword: (email: string, password: string) => Promise<AdminSessionUser>;
  adminClaimPassword: (email: string, password: string, name: string) => Promise<AdminSessionUser>;
  adminLinkGoogleForSync: () => Promise<void>;
  adminLogout: () => Promise<void>;
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<AdminSessionUser | null>(null);
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Keep customer profile synced when signed in
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setCustomerProfile(null);
      return;
    }

    const custRef = doc(db, 'customers', firebaseUser.uid);
    let cancelled = false;

    const ensureProfile = async () => {
      try {
        const snap = await getDoc(custRef);
        if (!snap.exists() && !cancelled) {
          const now = serverTimestamp();
          await setDoc(custRef, {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName || 'Customer',
            email: firebaseUser.email || '',
            photoURL: firebaseUser.photoURL || '',
            phone: '',
            walletBalance: 0,
            suspended: false,
            suspendedReason: '',
            createdAt: now,
            updatedAt: now,
          });
        } else if (snap.exists() && !cancelled) {
          const existingData = snap.data() as Partial<CustomerProfile>;
          if (typeof existingData.walletBalance !== 'number') {
            await updateDoc(custRef, {
              walletBalance: 0,
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `customers/${firebaseUser.uid}`);
      }
    };

    void ensureProfile();

    const unsub = onSnapshot(
      custRef,
      (snap) => {
        if (snap.exists()) {
          const raw = snap.data() as Partial<CustomerProfile>;
          setCustomerProfile({
            uid: raw.uid || firebaseUser.uid,
            displayName: raw.displayName || firebaseUser.displayName || 'Customer',
            email: raw.email || firebaseUser.email || '',
            photoURL: raw.photoURL || firebaseUser.photoURL || '',
            phone: raw.phone || '',
            walletBalance: typeof raw.walletBalance === 'number' ? raw.walletBalance : 0,
            suspended: Boolean(raw.suspended),
            suspendedReason: raw.suspendedReason || '',
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
          });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `customers/${firebaseUser.uid}`);
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [authReady, firebaseUser]);

  const signInCustomerWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOutCustomer = useCallback(async () => {
    await signOut(auth);
    setCustomerProfile(null);
  }, []);

  const updateCustomerPhone = useCallback(
    async (displayName: string, phone: string) => {
      if (!firebaseUser) throw new Error('Not signed in');
      const custRef = doc(db, 'customers', firebaseUser.uid);
      try {
        await updateDoc(custRef, {
          displayName: displayName.trim().slice(0, 100) || 'Customer',
          phone: phone.trim().slice(0, 30),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customers/${firebaseUser.uid}`);
      }
    },
    [firebaseUser],
  );

  const adminLoginWithGoogle = useCallback(async (): Promise<AdminSessionUser> => {
    setAdminAuthLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/admin/auth/firebase', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({idToken}),
      });
      const data = (await res.json()) as {token?: string; admin?: AdminSessionUser; error?: string};
      if (!res.ok || !data.token || !data.admin) {
        throw new Error(data.error || 'Admin Google sign-in denied');
      }
      setAdminToken(data.token);
      setAdminUser(data.admin);
      if (data.admin.role === 'super_admin') {
        await initializeDefaultCatalogIfMissing(data.admin.email).catch(() => false);
      }
      return data.admin;
    } finally {
      setAdminAuthLoading(false);
    }
  }, []);

  const adminLoginWithPassword = useCallback(
    async (email: string, password: string): Promise<AdminSessionUser> => {
      setAdminAuthLoading(true);
      try {
        const res = await fetch('/api/admin/auth/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email, password}),
        });
        const data = (await res.json()) as {token?: string; admin?: AdminSessionUser; error?: string};
        if (!res.ok || !data.token || !data.admin) {
          throw new Error(data.error || 'Invalid credentials');
        }
        setAdminToken(data.token);
        setAdminUser(data.admin);
        if (
          data.admin.role === 'super_admin' &&
          auth.currentUser?.email?.toLowerCase() === data.admin.email.toLowerCase()
        ) {
          await initializeDefaultCatalogIfMissing(data.admin.email).catch(() => false);
        }
        return data.admin;
      } finally {
        setAdminAuthLoading(false);
      }
    },
    [],
  );

  const adminClaimPassword = useCallback(
    async (email: string, password: string, name: string): Promise<AdminSessionUser> => {
      setAdminAuthLoading(true);
      try {
        const res = await fetch('/api/admin/auth/claim', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email, password, name}),
        });
        const data = (await res.json()) as {token?: string; admin?: AdminSessionUser; error?: string};
        if (!res.ok || !data.token || !data.admin) {
          throw new Error(data.error || 'Unable to claim admin password');
        }
        setAdminToken(data.token);
        setAdminUser(data.admin);
        return data.admin;
      } finally {
        setAdminAuthLoading(false);
      }
    },
    [],
  );

  const adminLinkGoogleForSync = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    const idToken = await cred.user.getIdToken();
    const res = await fetch('/api/admin/auth/firebase', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({idToken}),
    });
    const data = (await res.json()) as {token?: string; admin?: AdminSessionUser; error?: string};
    if (!res.ok || !data.token || !data.admin) {
      throw new Error(data.error || 'Google account is not authorized for admin sync.');
    }
    setAdminToken(data.token);
    setAdminUser(data.admin);
    if (data.admin.role === 'super_admin') {
      await initializeDefaultCatalogIfMissing(data.admin.email).catch(() => false);
    }
  }, []);

  const adminLogout = useCallback(async () => {
    setAdminToken(null);
    setAdminUser(null);
    if (auth.currentUser) {
      await signOut(auth);
    }
  }, []);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (adminToken) {
        headers.set('Authorization', `Bearer ${adminToken}`);
      } else if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${idToken}`);
      }
      return fetch(url, {...init, headers});
    },
    [adminToken],
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        customerProfile,
        signInCustomerWithGoogle,
        signOutCustomer,
        updateCustomerPhone,
        adminToken,
        adminUser,
        adminAuthLoading,
        adminLoginWithGoogle,
        adminLoginWithPassword,
        adminClaimPassword,
        adminLinkGoogleForSync,
        adminLogout,
        adminFetch,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
