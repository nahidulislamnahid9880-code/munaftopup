import {initializeApp} from 'firebase/app';
import {GoogleAuthProvider, getAuth} from 'firebase/auth';
import {doc, getDocFromServer, getFirestore} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const SUPER_ADMIN_EMAIL = 'nahidulislamnahid9880@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export function emailToStaffId(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export function normalizeTrxKey(methodId: string, trxId: string): string {
  const cleanMethod = methodId.replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();
  const cleanTrx = trxId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();
  return `${cleanMethod}_${cleanTrx}`.slice(0, 120);
}

export function timestampToMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return Date.parse(ts) || 0;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as {toMillis: () => number}).toMillis === 'function') {
    return (ts as {toMillis: () => number}).toMillis();
  }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts && typeof (ts as {seconds: number}).seconds === 'number') {
    return (ts as {seconds: number}).seconds * 1000;
  }
  return 0;
}

export function formatCurrency(amount: number): string {
  return `৳${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
