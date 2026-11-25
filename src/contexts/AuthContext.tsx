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

const ADMIN_TOKEN_STORAGE_KEY = 'sv_admin_token';
const ADMIN_USER_STORAGE_KEY = 'sv_admin_user';

function readStoredAdminSession(): {token: string | null; user: AdminSessionUser | null} {
  try {
    const token = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    const rawUser = window.localStorage.getItem(ADMIN_USER_STORAGE_KEY);
    if (!token || !rawUser) return {token: null, user: null};
    const parsedUser = JSON.parse(rawUser) as AdminSessionUser;
    if (!parsedUser?.email || !parsedUser?.role) return {token: null, user: null};
    return {token, user: parsedUser};
  } catch {
    return {token: null, user: null};
  }
}

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);

  const [adminToken, setAdminToken] = useState<string | null>(() => readStoredAdminSession().token);
  const [adminUser, setAdminUser] = useState<AdminSessionUser | null>(() => readStoredAdminSession().user);
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);

  const persistAdminSession = useCallback((token: string, user: AdminSessionUser) => {
    setAdminToken(token);
    setAdminUser(user);
    try {
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(ADMIN_USER_STORAGE_KEY, JSON.stringify(user));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const clearAdminSession = useCallback(() => {
    setAdminToken(null);
    setAdminUser(null);
    try {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_USER_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Validate persisted admin session on startup and silently refresh via Firebase Google if needed
  useEffect(() => {
    if (!authReady || !adminToken) return;
    let cancelled = false;

    const verifyStoredSession = async () => {
      try {
        const res = await fetch('/api/admin/auth/me', {
          headers: {Authorization: `Bearer ${adminToken}`},
        });
        if (res.ok) {
          const data = (await res.json()) as {admin?: AdminSessionUser};
          if (!cancelled && data.admin) {
            persistAdminSession(adminToken, data.admin);
          }
          return;
        }

        if (res.status === 401 || res.status === 403) {
          if (auth.currentUser) {
            try {
              const idToken = await auth.currentUser.getIdToken();
              const fbRes = await fetch('/api/admin/auth/firebase', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({idToken}),
              });
              if (fbRes.ok) {
                const fbData = (await fbRes.json()) as {token?: string; admin?: AdminSessionUser};
                if (!cancelled && fbData.token && fbData.admin) {
                  persistAdminSession(fbData.token, fbData.admin);
                  return;
                }
              }
            } catch {
              // ignore silent refresh network error
            }
          }
          if (!cancelled) {
            clearAdminSession();
          }
        }
      } catch {
        // Keep persisted admin session on transient network failure
      }
    };

    void verifyStoredSession();
    return () => {
      cancelled = true;
    };
  }, [authReady, adminToken, persistAdminSession, clearAdminSession]);

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
      persistAdminSession(data.token, data.admin);
      if (data.admin.role === 'super_admin') {
        await initializeDefaultCatalogIfMissing(data.admin.email).catch(() => false);
      }
      return data.admin;
    } finally {
      setAdminAuthLoading(false);
    }
  }, [persistAdminSession]);

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
        persistAdminSession(data.token, data.admin);
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
    [persistAdminSession],
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
        persistAdminSession(data.token, data.admin);
        return data.admin;
      } finally {
        setAdminAuthLoading(false);
      }
    },
    [persistAdminSession],
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
    persistAdminSession(data.token, data.admin);
    if (data.admin.role === 'super_admin') {
      await initializeDefaultCatalogIfMissing(data.admin.email).catch(() => false);
    }
  }, [persistAdminSession]);

  const adminLogout = useCallback(async () => {
    clearAdminSession();
    if (auth.currentUser) {
      await signOut(auth);
    }
  }, [clearAdminSession]);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (adminToken) {
        headers.set('Authorization', `Bearer ${adminToken}`);
      } else if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${idToken}`);
      }
      let res = await fetch(url, {...init, headers});
      if (res.status === 401 && auth.currentUser) {
        try {
          const idToken = await auth.currentUser.getIdToken();
          const fbRes = await fetch('/api/admin/auth/firebase', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({idToken}),
          });
          if (fbRes.ok) {
            const fbData = (await fbRes.json()) as {token?: string; admin?: AdminSessionUser};
            if (fbData.token && fbData.admin) {
              persistAdminSession(fbData.token, fbData.admin);
              headers.set('Authorization', `Bearer ${fbData.token}`);
              res = await fetch(url, {...init, headers});
            }
          }
        } catch {
          // ignore refresh failure
        }
      }
      return res;
    },
    [adminToken, persistAdminSession],
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
