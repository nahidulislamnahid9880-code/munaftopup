import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import express, {type NextFunction, type Request, type Response} from 'express';
import {cert, getApp, getApps, initializeApp as initializeAdminApp, type ServiceAccount} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import {FieldValue, Timestamp, getFirestore, type Firestore} from 'firebase-admin/firestore';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';
import multer from 'multer';
import nodemailer from 'nodemailer';
import {
  getConfiguredTelegramAdminChatIds,
  handleTelegramAdminCallback,
  handleTelegramAdminCommand,
  makeAdminOrderCallback,
  notifyTelegramAdmins,
  type TelegramAdminDeps,
} from './server-telegram-admin.ts';
import {
  DEFAULT_COMMERCE_SETTINGS,
  normalizeCommerceSettings,
  reconcilePendingTransactionsForSms,
  registerCommerceRoutes,
  type CommerceDeps,
  type CommerceSettings,
  type SmsReconcileOutcome,
} from './server-commerce.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const SUPER_ADMIN_EMAIL = 'nahidulislamnahid9880@gmail.com';
const DATA_DIR = path.resolve(__dirname, 'data');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const STORE_PATH = path.resolve(DATA_DIR, 'admin-store.json');
const CONFIG_PATH = path.resolve(__dirname, 'firebase-applet-config.json');

fs.mkdirSync(DATA_DIR, {recursive: true});
fs.mkdirSync(UPLOADS_DIR, {recursive: true});

interface StaffPermissions {
  products: boolean;
  orders: boolean;
  payments: boolean;
  customers: boolean;
  customization: boolean;
  settings: boolean;
}

interface StoredStaff {
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'sub_admin';
  active: boolean;
  permissions: StaffPermissions;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_NOTIFICATION_EMAIL = 'abdulmunafadmin@gmail.com';

export type TelegramQuickReplyAction = 'reply' | 'show_list' | 'order_status' | 'request_agent';

export interface TelegramQuickReplyPreset {
  id: string;
  label: string;
  replyText: string;
  action: TelegramQuickReplyAction;
  active: boolean;
}

const DEFAULT_TELEGRAM_QUICK_REPLIES: TelegramQuickReplyPreset[] = [
  {
    id: 'payment_received',
    label: 'Payment Received',
    replyText: '✅ আপনার পেমেন্ট রিসিভ হয়েছে! আমাদের টিম দ্রুত ভেরিফাই করে আপনার অর্ডার কমপ্লিট করছে।',
    action: 'reply',
    active: true,
  },
  {
    id: 'order_processing',
    label: 'Order Processing',
    replyText: '⏳ আপনার অর্ডারটি বর্তমানে প্রসেসিং অবস্থায় আছে। সাধারণত ১–৫ মিনিটের মধ্যে ডেলিভারি সম্পন্ন হয়।',
    action: 'reply',
    active: true,
  },
  {
    id: 'rate_list',
    label: '💎 Rate List',
    replyText: 'আজকের প্যাকেজ ও ডায়মন্ড রেট লিস্ট নিচে দেখুন:',
    action: 'show_list',
    active: true,
  },
  {
    id: 'my_orders',
    label: '🧾 My Orders',
    replyText: 'আপনার সাম্প্রতিক অর্ডারের অবস্থা নিচে দেওয়া হলো:',
    action: 'order_status',
    active: true,
  },
  {
    id: 'support_agent',
    label: '👨‍💼 Support Agent',
    replyText: '🙋‍♂️ আপনার অনুরোধটি এডমিনের কাছে পাঠানো হয়েছে। কিছুক্ষণের মধ্যে আমাদের এজেন্ট আপনার সাথে যোগাযোগ করবেন।',
    action: 'request_agent',
    active: true,
  },
];

interface SystemSettingsStore {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  notificationEmail: string;
  smtpEnabled: boolean;
  customerEmailNotificationsEnabled: boolean;
  distributorBaseUrl: string;
  distributorMerchantId: string;
  distributorApiKey: string;
  distributorEnabled: boolean;
  telegramQuickRepliesEnabled: boolean;
  telegramQuickReplies: TelegramQuickReplyPreset[];
  telegramAdminChatIds: string[];
  telegramAdminOrderAlerts: boolean;
  commerce?: CommerceSettings;
  updatedAt: string;
}

interface AdminStoreData {
  primaryAdminName: string;
  primaryPasswordHash: string | null;
  sessionSecret?: string;
  staff: Record<string, StoredStaff>;
  systemSettings: SystemSettingsStore;
  serverLogs: Array<{
    id: string;
    actorEmail: string;
    action: string;
    details: string;
    createdAt: string;
  }>;
}

interface SessionPayload {
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'sub_admin';
  permissions: StaffPermissions;
  exp: number;
}

interface AuthedRequest extends Request {
  adminSession?: SessionPayload;
  firebaseAuthUid?: string;
  firebaseAuthEmail?: string;
}

const FULL_PERMISSIONS: StaffPermissions = {
  products: true,
  orders: true,
  payments: true,
  customers: true,
  customization: true,
  settings: true,
};

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as FirebaseAppletConfig;
    if (!raw.projectId || raw.projectId === 'remixed-project-id') return {};
    return raw;
  } catch {
    return {};
  }
}

function parseServiceAccountFromEnv(): (ServiceAccount & {project_id?: string}) | null {
  const rawEnv = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!rawEnv) return null;
  try {
    const jsonText = rawEnv.startsWith('{')
      ? rawEnv
      : Buffer.from(rawEnv, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as ServiceAccount & {
      project_id?: string;
      private_key?: string;
      client_email?: string;
    };
    if (!parsed || typeof parsed !== 'object' || !parsed.client_email || !parsed.private_key) {
      return null;
    }
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env var:', err instanceof Error ? err.message : err);
    return null;
  }
}

const appletConfig = loadFirebaseAppletConfig();
const serviceAccountCreds = parseServiceAccountFromEnv();
const firebaseProjectId: string | null =
  serviceAccountCreds?.project_id || appletConfig.projectId || null;
const firestoreDatabaseId: string =
  (process.env.FIREBASE_DATABASE_ID || appletConfig.firestoreDatabaseId || '').trim();

let adminDb: Firestore | null = null;
let firebaseInitMode: 'service_account' | 'project_config' | 'unconfigured' = 'unconfigured';

if (firebaseProjectId) {
  try {
    const adminApp = getApps().length
      ? getApp()
      : serviceAccountCreds
        ? initializeAdminApp({
            credential: cert(serviceAccountCreds),
            projectId: firebaseProjectId,
          })
        : initializeAdminApp({projectId: firebaseProjectId});

    adminDb =
      firestoreDatabaseId && firestoreDatabaseId !== '(default)'
        ? getFirestore(adminApp, firestoreDatabaseId)
        : getFirestore(adminApp);
    firebaseInitMode = serviceAccountCreds ? 'service_account' : 'project_config';
  } catch (err) {
    console.error('Firebase Admin initialization error:', err instanceof Error ? err.message : err);
  }
}

let cachedSessionSecret: string | null = null;

function getSessionSecret(): string {
  const envSecret = (process.env.ADMIN_SESSION_SECRET || '').trim();
  if (envSecret) return envSecret;
  if (cachedSessionSecret) return cachedSessionSecret;

  const store = readStore();
  if (store.sessionSecret && store.sessionSecret.length >= 32) {
    cachedSessionSecret = store.sessionSecret;
    return cachedSessionSecret;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  store.sessionSecret = generated;
  try {
    writeStore(store);
  } catch {
    // ignore write error if read-only
  }
  cachedSessionSecret = generated;
  return generated;
}

function defaultStore(): AdminStoreData {
  const now = new Date().toISOString();
  return {
    primaryAdminName: 'Primary Administrator',
    primaryPasswordHash: null,
    staff: {
      [SUPER_ADMIN_EMAIL]: {
        email: SUPER_ADMIN_EMAIL,
        name: 'Primary Administrator',
        role: 'super_admin',
        active: true,
        permissions: {...FULL_PERMISSIONS},
        createdAt: now,
        updatedAt: now,
      },
    },
    systemSettings: {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpUser: '',
      smtpPassword: '',
      smtpFromEmail: '',
      notificationEmail: DEFAULT_NOTIFICATION_EMAIL,
      smtpEnabled: false,
      customerEmailNotificationsEnabled: true,
      distributorBaseUrl: '',
      distributorMerchantId: '',
      distributorApiKey: '',
      distributorEnabled: false,
      telegramQuickRepliesEnabled: true,
      telegramQuickReplies: DEFAULT_TELEGRAM_QUICK_REPLIES.map((p) => ({...p})),
      telegramAdminChatIds: [],
      telegramAdminOrderAlerts: true,
      commerce: {...DEFAULT_COMMERCE_SETTINGS},
      updatedAt: now,
    },
    serverLogs: [],
  };
}

function normalizeQuickRepliesInput(raw: unknown): TelegramQuickReplyPreset[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_TELEGRAM_QUICK_REPLIES.map((p) => ({...p}));
  }
  const seenIds = new Set<string>();
  const validActions = new Set<TelegramQuickReplyAction>(['reply', 'show_list', 'order_status', 'request_agent']);
  const out: TelegramQuickReplyPreset[] = [];

  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const item = raw[i] as Partial<TelegramQuickReplyPreset> | null;
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim().slice(0, 40);
    if (!label) continue;
    let id = String(item.id || label)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    if (!id) id = `preset_${i + 1}`;
    while (seenIds.has(id)) {
      id = `${id.slice(0, 26)}_${i + 1}`;
    }
    seenIds.add(id);

    const action: TelegramQuickReplyAction = validActions.has(item.action as TelegramQuickReplyAction)
      ? (item.action as TelegramQuickReplyAction)
      : 'reply';
    const replyText = String(item.replyText || '').trim().slice(0, 1000);
    const active = item.active !== false;

    out.push({
      id,
      label,
      replyText,
      action,
      active,
    });
  }
  return out;
}

function readStore(): AdminStoreData {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const init = defaultStore();
      fs.writeFileSync(STORE_PATH, JSON.stringify(init, null, 2), 'utf8');
      return init;
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as AdminStoreData;
    if (!parsed.staff) parsed.staff = defaultStore().staff;
    if (!parsed.staff[SUPER_ADMIN_EMAIL]) {
      parsed.staff[SUPER_ADMIN_EMAIL] = defaultStore().staff[SUPER_ADMIN_EMAIL];
    }
    if (!parsed.systemSettings) {
      parsed.systemSettings = defaultStore().systemSettings;
    } else {
      if (!parsed.systemSettings.notificationEmail) {
        parsed.systemSettings.notificationEmail = DEFAULT_NOTIFICATION_EMAIL;
      }
      if (typeof parsed.systemSettings.customerEmailNotificationsEnabled !== 'boolean') {
        parsed.systemSettings.customerEmailNotificationsEnabled = true;
      }
      if (typeof parsed.systemSettings.telegramQuickRepliesEnabled !== 'boolean') {
        parsed.systemSettings.telegramQuickRepliesEnabled = true;
      }
      if (!Array.isArray(parsed.systemSettings.telegramQuickReplies)) {
        parsed.systemSettings.telegramQuickReplies = DEFAULT_TELEGRAM_QUICK_REPLIES.map((p) => ({...p}));
      }
      if (!Array.isArray(parsed.systemSettings.telegramAdminChatIds)) {
        parsed.systemSettings.telegramAdminChatIds = [];
      }
      if (typeof parsed.systemSettings.telegramAdminOrderAlerts !== 'boolean') {
        parsed.systemSettings.telegramAdminOrderAlerts = true;
      }
      parsed.systemSettings.commerce = normalizeCommerceSettings(parsed.systemSettings.commerce);
    }
    if (!Array.isArray(parsed.serverLogs)) parsed.serverLogs = [];
    return parsed;
  } catch {
    return defaultStore();
  }
}

function writeStore(data: AdminStoreData): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function appendServerLog(store: AdminStoreData, actorEmail: string, action: string, details: string): void {
  store.serverLogs.unshift({
    id: crypto.randomUUID(),
    actorEmail,
    action,
    details,
    createdAt: new Date().toISOString(),
  });
  if (store.serverLogs.length > 200) {
    store.serverLogs = store.serverLogs.slice(0, 200);
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

const ADMIN_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.email || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function resolveAdminFromRequest(req: Request): Promise<SessionPayload | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const session = verifySessionToken(token);
  if (session) {
    const store = readStore();
    const email = session.email.toLowerCase();
    if (email === SUPER_ADMIN_EMAIL) {
      return {
        email,
        name: store.primaryAdminName || session.name,
        role: 'super_admin',
        permissions: {...FULL_PERMISSIONS},
        exp: session.exp,
      };
    }
    const staffMember = store.staff[email];
    if (!staffMember || !staffMember.active) return null;
    return {
      email,
      name: staffMember.name,
      role: staffMember.role,
      permissions: staffMember.permissions,
      exp: session.exp,
    };
  }

  // Also support direct Firebase ID token verification for authorized staff
  if (firebaseProjectId) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      if (decoded.email && decoded.email_verified) {
        const email = decoded.email.toLowerCase();
        const store = readStore();
        if (email === SUPER_ADMIN_EMAIL) {
          return {
            email,
            name: store.primaryAdminName || decoded.name || 'Primary Administrator',
            role: 'super_admin',
            permissions: {...FULL_PERMISSIONS},
            exp: Date.now() + 3600000,
          };
        }
        const staffMember = store.staff[email];
        if (staffMember && staffMember.active) {
          return {
            email,
            name: staffMember.name,
            role: staffMember.role,
            permissions: staffMember.permissions,
            exp: Date.now() + 3600000,
          };
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

function requireAdmin(permission?: keyof StaffPermissions) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const session = await resolveAdminFromRequest(req);
    if (!session) {
      res.status(401).json({error: 'Unauthorized admin access'});
      return;
    }
    if (permission && session.role !== 'super_admin' && !session.permissions[permission]) {
      res.status(403).json({error: `Missing required permission: ${permission}`});
      return;
    }
    req.adminSession = session;
    next();
  };
}

async function requireSignedInFirebase(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Authentication required'});
    return;
  }
  const token = authHeader.slice(7).trim();
  const adminSession = verifySessionToken(token);
  if (adminSession) {
    req.adminSession = adminSession;
    req.firebaseAuthEmail = adminSession.email;
    next();
    return;
  }
  if (!firebaseProjectId) {
    res.status(401).json({error: 'Authentication verification unavailable'});
    return;
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (!decoded.uid) {
      res.status(401).json({error: 'Invalid user token'});
      return;
    }
    req.firebaseAuthUid = decoded.uid;
    if (decoded.email && decoded.email_verified) {
      req.firebaseAuthEmail = decoded.email.trim().toLowerCase();
    }
    next();
  } catch {
    res.status(401).json({error: 'Invalid or expired authentication token'});
  }
}

const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: 5 * 1024 * 1024},
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WEBP, GIF, and ICO images are allowed'));
    }
  },
});

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const notifiedEventKeys = new Map<string, number>();
const SERVER_BOOT_TIME_MS = Date.now();

function markNotificationEventSent(eventKey: string): boolean {
  const now = Date.now();
  if (notifiedEventKeys.size > 1000) {
    for (const [k, ts] of notifiedEventKeys.entries()) {
      if (now - ts > 15 * 60 * 1000) notifiedEventKeys.delete(k);
    }
  }
  const prev = notifiedEventKeys.get(eventKey);
  if (prev && now - prev < 15 * 60 * 1000) {
    return false;
  }
  notifiedEventKeys.set(eventKey, now);
  return true;
}

function resolveSmtpConfig(store: AdminStoreData) {
  const s = store.systemSettings;
  const host = (s.smtpHost || process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com').trim();
  const port = Number(s.smtpPort || process.env.SMTP_PORT || process.env.EMAIL_PORT || 587) || 587;
  const user = (
    s.smtpUser ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER ||
    process.env.GMAIL_USER ||
    ''
  ).trim();
  const pass = (
    s.smtpPassword ||
    process.env.SMTP_PASSWORD ||
    process.env.EMAIL_PASS ||
    process.env.GMAIL_PASS ||
    ''
  ).trim();
  const fromEmail = (
    s.smtpFromEmail ||
    process.env.SMTP_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    user
  ).trim();
  const toEmail = (
    s.notificationEmail ||
    process.env.NOTIFICATION_EMAIL ||
    process.env.ADMIN_EMAIL ||
    DEFAULT_NOTIFICATION_EMAIL
  ).trim();

  const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();
  const brevoSenderEmail = (process.env.BREVO_SENDER_EMAIL || '').trim();
  const useBrevo = Boolean(brevoApiKey);
  const resolvedBrevoSender =
    isValidEmailAddress(brevoSenderEmail) ||
    isValidEmailAddress(process.env.SMTP_USER) ||
    isValidEmailAddress(process.env.EMAIL_USER) ||
    isValidEmailAddress(fromEmail) ||
    isValidEmailAddress(user);

  const envConfigured = Boolean(
    (process.env.SMTP_USER && process.env.SMTP_PASSWORD) ||
      (process.env.EMAIL_USER && process.env.EMAIL_PASS) ||
      (process.env.GMAIL_USER && process.env.GMAIL_PASS),
  );
  const smtpReady = Boolean((s.smtpEnabled || envConfigured) && host && user && pass);
  const transportReady = useBrevo ? Boolean(resolvedBrevoSender) : smtpReady;
  const enabled = Boolean(transportReady && toEmail);
  const customerEnabled = Boolean(transportReady && s.customerEmailNotificationsEnabled !== false);
  const mailTransport: 'brevo' | 'smtp' | 'none' = useBrevo ? 'brevo' : smtpReady ? 'smtp' : 'none';

  return {
    host,
    port,
    user,
    pass,
    fromEmail,
    toEmail,
    brevoApiKey,
    brevoSenderEmail: resolvedBrevoSender,
    useBrevo,
    mailTransport,
    enabled,
    customerEnabled,
    envConfigured,
  };
}

function isValidEmailAddress(email: string | undefined | null): string {
  const cleaned = String(email ?? '').trim().toLowerCase();
  if (!cleaned || cleaned.length > 160) return '';
  if (!/^[^\s@<>()[\]\\,;:\s"]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleaned)) return '';
  return cleaned;
}

async function dispatchEmailTransport(
  cfg: ReturnType<typeof resolveSmtpConfig>,
  params: {
    senderName?: string;
    toEmail: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<'brevo' | 'smtp'> {
  if (cfg.useBrevo) {
    const senderEmail =
      cfg.brevoSenderEmail ||
      isValidEmailAddress(process.env.SMTP_USER) ||
      isValidEmailAddress(process.env.EMAIL_USER) ||
      isValidEmailAddress(cfg.fromEmail) ||
      isValidEmailAddress(cfg.user);
    if (!senderEmail) {
      throw new Error('BREVO_SENDER_EMAIL (or SMTP_USER / EMAIL_USER) is missing or invalid while BREVO_API_KEY is set.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': cfg.brevoApiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: (params.senderName || 'MUNAFTOPUP.bd').replace(/"/g, '').slice(0, 80),
            email: senderEmail,
          },
          to: [{email: params.toEmail}],
          subject: params.subject,
          htmlContent: params.html,
          textContent: params.text,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let detail = errText.slice(0, 300);
        try {
          const parsed = JSON.parse(errText) as {message?: string; code?: string};
          if (parsed.message) {
            detail = `${parsed.code ? `[${parsed.code}] ` : ''}${parsed.message}`;
          }
        } catch {
          // keep raw text
        }
        throw new Error(`Brevo API HTTP ${resp.status}: ${detail || 'Failed to send email'}`);
      }
      return 'brevo';
    } finally {
      clearTimeout(timer);
    }
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: {user: cfg.user, pass: cfg.pass},
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 15000,
  });
  const fromAddr = cfg.fromEmail || cfg.user;
  await transporter.sendMail({
    from: params.senderName ? `"${params.senderName.replace(/"/g, '')}" <${fromAddr}>` : fromAddr,
    to: params.toEmail,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  return 'smtp';
}

async function sendAdminNotificationEmail(
  subject: string,
  rows: Array<{label: string; value: string}>,
  actorEmail: string,
): Promise<{sent: boolean; reason?: string; toEmail?: string; transport?: 'brevo' | 'smtp'}> {
  const store = readStore();
  const cfg = resolveSmtpConfig(store);

  if (!cfg.enabled) {
    const missingParts: string[] = [];
    if (cfg.useBrevo) {
      if (!cfg.brevoSenderEmail) missingParts.push('BREVO_SENDER_EMAIL (or SMTP_USER / EMAIL_USER)');
    } else {
      if (!cfg.user) missingParts.push('SMTP_USER / EMAIL_USER');
      if (!cfg.pass) missingParts.push('SMTP_PASSWORD / EMAIL_PASS');
    }
    if (!cfg.toEmail) missingParts.push('NOTIFICATION_EMAIL');
    const detail =
      missingParts.length > 0
        ? `Missing mail credentials: ${missingParts.join(', ')}`
        : 'Outbound SMTP is disabled in Admin Settings';
    console.warn(`[Admin Email Skipped] "${subject}" -> ${detail}`);
    appendServerLog(
      store,
      actorEmail,
      'EMAIL_NOTIFY_SKIPPED',
      `Notification "${subject}" skipped (${detail}).`,
    );
    writeStore(store);
    return {sent: false, reason: detail, toEmail: cfg.toEmail};
  }

  const textBody = [subject, '', ...rows.map((r) => `${r.label}: ${r.value}`)].join('\n');
  const htmlRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;font-weight:600;width:150px;">${escapeHtml(r.label)}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;word-break:break-word;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#0f172a;color:#ffffff;padding:16px 20px;">
          <h2 style="margin:0;font-size:16px;">${escapeHtml(subject)}</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${htmlRows}
        </table>
        <div style="padding:12px 20px;background:#f1f5f9;color:#64748b;font-size:12px;">
          Automated notification sent to ${escapeHtml(cfg.toEmail)}
        </div>
      </div>
    </div>
  `;

  try {
    const transport = await dispatchEmailTransport(cfg, {
      senderName: botSharedStoreCache?.brandName || 'MUNAFTOPUP.bd',
      toEmail: cfg.toEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });
    console.log(`[Admin Email Sent via ${transport.toUpperCase()}] "${subject}" -> ${cfg.toEmail}`);
    appendServerLog(
      store,
      actorEmail,
      'EMAIL_NOTIFY_SENT',
      `Sent "${subject}" to ${cfg.toEmail} (${transport})`,
    );
    writeStore(store);
    return {sent: true, toEmail: cfg.toEmail, transport};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Admin Email Failed] "${subject}" -> ${msg}`);
    appendServerLog(store, actorEmail, 'EMAIL_NOTIFY_FAILED', `Failed "${subject}": ${msg}`);
    writeStore(store);
    return {sent: false, reason: msg, toEmail: cfg.toEmail};
  }
}

export interface CustomerOrderEmailPayload {
  toEmail?: string;
  customerName?: string;
  orderNumber: string;
  orderStatus: 'pending' | 'processing' | 'completed' | 'cancelled' | 'expired';
  paymentStatus?: 'pending' | 'verified' | 'rejected';
  productName: string;
  packageName: string;
  playerUid?: string;
  serverId?: string;
  totalAmount?: number | string;
  paymentMethodName?: string;
  trxId?: string;
  voucherCode?: string;
  note?: string;
  isNewOrder?: boolean;
}

async function sendCustomerOrderEmail(
  params: CustomerOrderEmailPayload,
): Promise<{sent: boolean; skipped?: boolean; reason?: string; toEmail?: string}> {
  const recipient = isValidEmailAddress(params.toEmail);
  if (!recipient) {
    return {sent: false, skipped: true, reason: 'No valid customer email on order'};
  }

  const store = readStore();
  const cfg = resolveSmtpConfig(store);
  if (!cfg.customerEnabled) {
    const reason =
      store.systemSettings.customerEmailNotificationsEnabled === false
        ? 'Customer order emails disabled in Admin Settings'
        : cfg.useBrevo && !cfg.brevoSenderEmail
          ? 'BREVO_SENDER_EMAIL missing'
          : !cfg.user || !cfg.pass
            ? 'SMTP credentials missing'
            : 'Outbound email disabled in Admin Settings';
    return {sent: false, skipped: true, reason, toEmail: recipient};
  }

  let brandName = 'MUNAFTOPUP.bd';
  try {
    if (botSharedStoreCache?.brandName) {
      brandName = botSharedStoreCache.brandName;
    }
  } catch {
    // ignore
  }

  let subject = `[${brandName}] Order ${params.orderNumber} Update`;
  let headline = 'Your order status has been updated';
  let badgeBg = '#0ea5e9';
  let statusText = params.orderStatus.toUpperCase();

  if (params.isNewOrder) {
    subject = `[${brandName}] Order Confirmed: ${params.orderNumber} (${params.packageName})`;
    headline =
      params.paymentStatus === 'verified'
        ? 'Order Received & Payment Verified!'
        : 'Order Received — Pending Verification';
    badgeBg = params.paymentStatus === 'verified' ? '#0891b2' : '#d97706';
    statusText = params.paymentStatus === 'verified' ? 'PROCESSING / QUEUED' : 'PENDING REVIEW';
  } else if (params.orderStatus === 'completed') {
    subject = `[${brandName}] Order Completed: ${params.orderNumber} — ${params.packageName}`;
    headline = 'Your Top-Up Order is Completed!';
    badgeBg = '#059669';
    statusText = 'COMPLETED';
  } else if (params.orderStatus === 'processing') {
    subject = `[${brandName}] Order Processing: ${params.orderNumber}`;
    headline =
      params.paymentStatus === 'verified'
        ? 'Payment Verified — Fulfilling Your Order!'
        : 'Your Order is Now Processing';
    badgeBg = '#0891b2';
    statusText = 'PROCESSING';
  } else if (params.orderStatus === 'cancelled') {
    subject = `[${brandName}] Order Cancelled: ${params.orderNumber}`;
    headline =
      params.paymentStatus === 'rejected'
        ? 'Payment Rejected & Order Cancelled'
        : 'Your Order Has Been Cancelled';
    badgeBg = '#dc2626';
    statusText = 'CANCELLED';
  } else if (params.orderStatus === 'expired') {
    subject = `[${brandName}] Order Expired: ${params.orderNumber}`;
    headline = 'Your Pending Order Expired After 30 Minutes';
    badgeBg = '#475569';
    statusText = 'EXPIRED';
  } else if (params.paymentStatus === 'verified') {
    subject = `[${brandName}] Payment Verified: ${params.orderNumber}`;
    headline = 'Your Payment Has Been Verified!';
    badgeBg = '#0891b2';
    statusText = 'PAYMENT VERIFIED';
  }

  const amountDisplay =
    typeof params.totalAmount === 'number'
      ? `৳${params.totalAmount}`
      : params.totalAmount
        ? String(params.totalAmount)
        : '—';

  const trackUrl = `${WEBSITE_URL.replace(/\/$/, '')}/track?order=${encodeURIComponent(params.orderNumber)}`;

  const detailRows: Array<{label: string; value: string}> = [
    {label: 'Order Number', value: params.orderNumber},
    {label: 'Product', value: params.productName || '—'},
    {label: 'Package', value: params.packageName || '—'},
    ...(params.playerUid ? [{label: 'Player UID', value: params.playerUid}] : []),
    ...(params.serverId && params.serverId !== 'N/A' ? [{label: 'Server ID', value: params.serverId}] : []),
    {label: 'Amount', value: amountDisplay},
    ...(params.paymentMethodName ? [{label: 'Payment Method', value: params.paymentMethodName}] : []),
    ...(params.trxId ? [{label: 'TrxID', value: params.trxId}] : []),
    {label: 'Payment Status', value: (params.paymentStatus || 'pending').toUpperCase()},
    {label: 'Order Status', value: statusText},
  ];

  const textLines = [
    `Hello ${params.customerName || 'Customer'},`,
    '',
    headline,
    '',
    ...detailRows.map((r) => `${r.label}: ${r.value}`),
    ...(params.voucherCode?.trim() ? ['', `Voucher / Redeem Code: ${params.voucherCode.trim()}`] : []),
    ...(params.note?.trim() ? ['', `Message: ${params.note.trim()}`] : []),
    '',
    `Track your order live: ${trackUrl}`,
    '',
    `Thank you for choosing ${brandName}!`,
  ];

  const htmlRows = detailRows
    .map(
      (r) =>
        `<tr><td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600;width:155px;">${escapeHtml(r.label)}</td><td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:500;word-break:break-word;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');

  const voucherHtml = params.voucherCode?.trim()
    ? `<div style="margin:16px 0;padding:14px 16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;">
         <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#047857;margin-bottom:4px;">Redeem / Voucher Code</div>
         <div style="font-family:monospace;font-size:16px;font-weight:700;color:#065f46;word-break:break-all;">${escapeHtml(params.voucherCode.trim())}</div>
       </div>`
    : '';

  const noteHtml = params.note?.trim()
    ? `<div style="margin:14px 0;padding:12px 14px;background:#f8fafc;border-left:4px solid ${badgeBg};border-radius:6px;color:#334155;font-size:13px;line-height:1.5;">
         <strong>Update Note:</strong> ${escapeHtml(params.note.trim())}
       </div>`
    : '';

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;background:#f1f5f9;padding:24px 12px;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="background:#0f172a;color:#ffffff;padding:20px 24px;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#38bdf8;font-weight:700;">${escapeHtml(brandName)}</div>
          <h2 style="margin:6px 0 10px;font-size:19px;line-height:1.3;">${escapeHtml(headline)}</h2>
          <span style="display:inline-block;background:${badgeBg};color:#ffffff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;">${escapeHtml(statusText)}</span>
        </div>
        <div style="padding:20px 24px;">
          <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hello <strong>${escapeHtml(params.customerName || 'Valued Customer')}</strong>,</p>
          ${noteHtml}
          ${voucherHtml}
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            ${htmlRows}
          </table>
          <div style="margin-top:20px;text-align:center;">
            <a href="${escapeHtml(trackUrl)}" style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:11px 22px;border-radius:8px;">Track Order Live</a>
          </div>
        </div>
        <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;text-align:center;">
          Thank you for shopping with ${escapeHtml(brandName)} • Order Ref: ${escapeHtml(params.orderNumber)}
        </div>
      </div>
    </div>
  `;

  try {
    const transport = await dispatchEmailTransport(cfg, {
      senderName: brandName,
      toEmail: recipient,
      subject,
      text: textLines.join('\n'),
      html: htmlBody,
    });
    console.log(`[Customer Email Sent via ${transport.toUpperCase()}] "${subject}" -> ${recipient}`);
    appendServerLog(
      store,
      'customer_email',
      'CUSTOMER_EMAIL_SENT',
      `Sent "${subject}" to ${recipient} (${transport})`,
    );
    writeStore(store);
    return {sent: true, toEmail: recipient};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Customer Email Failed] "${subject}" -> ${recipient}: ${msg}`);
    appendServerLog(
      store,
      'customer_email',
      'CUSTOMER_EMAIL_FAILED',
      `Failed "${subject}" to ${recipient}: ${msg}`,
    );
    writeStore(store);
    return {sent: false, reason: msg, toEmail: recipient};
  }
}

async function sendCustomerGenericEmail(params: {
  toEmail?: string;
  customerName?: string;
  subject: string;
  headline: string;
  rows: Array<{label: string; value: string}>;
  message?: string;
}): Promise<{sent: boolean; skipped?: boolean; reason?: string}> {
  const recipient = isValidEmailAddress(params.toEmail);
  if (!recipient) return {sent: false, skipped: true, reason: 'No valid customer email'};

  const store = readStore();
  const cfg = resolveSmtpConfig(store);
  if (!cfg.customerEnabled) {
    return {sent: false, skipped: true, reason: 'Customer email notifications not enabled'};
  }

  const brandName = botSharedStoreCache?.brandName || 'MUNAFTOPUP.bd';
  const textBody = [
    `Hello ${params.customerName || 'Customer'},`,
    '',
    params.headline,
    ...(params.message ? ['', params.message] : []),
    '',
    ...params.rows.map((r) => `${r.label}: ${r.value}`),
    '',
    `Visit: ${WEBSITE_URL}`,
  ].join('\n');

  const htmlRows = params.rows
    .map(
      (r) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600;width:145px;">${escapeHtml(r.label)}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;word-break:break-word;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;background:#f1f5f9;padding:24px 12px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="background:#0f172a;color:#ffffff;padding:18px 22px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#38bdf8;font-weight:700;">${escapeHtml(brandName)}</div>
          <h2 style="margin:6px 0 0;font-size:18px;">${escapeHtml(params.headline)}</h2>
        </div>
        <div style="padding:18px 22px;">
          <p style="margin:0 0 12px;color:#334155;font-size:14px;">Hello <strong>${escapeHtml(params.customerName || 'Customer')}</strong>,</p>
          ${params.message ? `<div style="margin:12px 0;padding:12px 14px;background:#f8fafc;border-left:4px solid #0891b2;border-radius:6px;color:#1e293b;font-size:13px;line-height:1.5;">${escapeHtml(params.message)}</div>` : ''}
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">${htmlRows}</table>
        </div>
        <div style="padding:12px 22px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center;">
          ${escapeHtml(brandName)} • ${escapeHtml(WEBSITE_URL)}
        </div>
      </div>
    </div>
  `;

  try {
    const transport = await dispatchEmailTransport(cfg, {
      senderName: brandName,
      toEmail: recipient,
      subject: `[${brandName}] ${params.subject}`,
      text: textBody,
      html: htmlBody,
    });
    appendServerLog(
      store,
      'customer_email',
      'CUSTOMER_EMAIL_SENT',
      `Sent "${params.subject}" to ${recipient} (${transport})`,
    );
    writeStore(store);
    return {sent: true};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendServerLog(store, 'customer_email', 'CUSTOMER_EMAIL_FAILED', `Failed "${params.subject}" to ${recipient}: ${msg}`);
    writeStore(store);
    return {sent: false, reason: msg};
  }
}

function saveUploadedFile(file: Express.Multer.File): string {
  const ext = ALLOWED_IMAGE_MIMES[file.mimetype] || '.png';
  const safeFilename = `${crypto.randomUUID()}${ext}`;
  const targetPath = path.resolve(UPLOADS_DIR, safeFilename);
  if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid upload target path');
  }
  fs.writeFileSync(targetPath, file.buffer);
  return `/uploads/${safeFilename}`;
}

function timingSafeEqualsText(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface ParsedSmsPayment {
  amount: number;
  trxId: string;
  method: 'bKash' | 'Nagad';
}

function parsePaymentSms(rawText: string, hintSender?: string, hintMethod?: string): ParsedSmsPayment | null {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const combinedHints = `${hintSender || ''} ${hintMethod || ''} ${normalized}`.toLowerCase();
  let method: 'bKash' | 'Nagad' | null = null;
  if (combinedHints.includes('nagad') || combinedHints.includes('16216')) {
    method = 'Nagad';
  } else if (combinedHints.includes('bkash')) {
    method = 'bKash';
  } else if (/\btxnid\b/i.test(normalized) || /\bmoney received\b/i.test(normalized)) {
    method = 'Nagad';
  } else if (/\btrxid\b/i.test(normalized)) {
    method = 'bKash';
  }

  if (!method) return null;

  const trxMatch = normalized.match(
    /(?:trx\s*id|txnid|txn\s*id|transaction\s*id)\s*(?:is|:|#|-|\s)*([a-zA-Z0-9_-]{4,32})/i,
  );
  if (!trxMatch || !trxMatch[1]) return null;
  const trxId = trxMatch[1].replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
  if (trxId.length < 4 || trxId.length > 64) return null;

  // Prefer explicit transaction amount phrases before Fee/Balance fields
  const sanitizedForFallback = normalized
    .replace(/(?:fee|charge|balance|bal)\s*:?\s*(?:tk|bdt|৳)?\.?\s*[\d,]+(?:\.\d{1,2})?/gi, ' ');

  const amountPatterns: RegExp[] = [
    /(?:you have received|received|cash[\s-]*in|send\s*money|payment|amount)\s*:?\s*(?:tk|bdt|৳)\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:tk|bdt|৳)\.?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:from|received|has been received|successful)/i,
    /(?:tk|bdt|৳)\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:tk|bdt|taka)\b/i,
  ];

  let amount = 0;
  for (let i = 0; i < amountPatterns.length; i++) {
    const target = i >= 2 ? sanitizedForFallback : normalized;
    const m = target.match(amountPatterns[i]);
    if (m && m[1]) {
      const parsed = Number.parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10000000) {
        amount = Number(parsed.toFixed(2));
        break;
      }
    }
  }

  if (!(amount > 0)) return null;

  return {amount, trxId, method};
}

function extractSmsPayloadFromForwarderMessage(fullText: string): {
  smsBody: string;
  hintSender?: string;
} {
  const trimmed = fullText.trim();
  const senderMatch = trimmed.match(/(?:^|\n)\s*(?:sender|from)\s*[:\-]\s*([^\n]+)/i);
  const hintSender = senderMatch?.[1]?.trim();

  const messageMatch = trimmed.match(/(?:^|\n)\s*(?:message|sms|body|text)\s*[:\-]\s*([\s\S]+)/i);
  if (messageMatch?.[1]?.trim()) {
    return {
      smsBody: messageMatch[1].trim(),
      hintSender,
    };
  }
  return {
    smsBody: trimmed,
    hintSender,
  };
}

async function recordSmsPaymentInFirestore(params: {
  rawText: string;
  hintSender?: string;
  hintMethod?: string;
  source?: 'sms_webhook' | 'telegram_forwarder';
}): Promise<
  | {
      ok: true;
      duplicate: boolean;
      used: boolean;
      parsed: ParsedSmsPayment;
      reconciled?: SmsReconcileOutcome;
    }
  | {
      ok: false;
      status: number;
      error: string;
    }
> {
  if (!adminDb) {
    return {ok: false, status: 503, error: 'Firebase Admin Firestore is not initialized'};
  }

  const parsed = parsePaymentSms(params.rawText, params.hintSender, params.hintMethod);
  if (!parsed) {
    return {ok: false, status: 400, error: 'Could not extract bKash/Nagad amount and TrxID from SMS'};
  }

  const docRef = adminDb.collection('sms_payments').doc(parsed.trxId);
  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) {
      const existing = snap.data() as {used?: boolean; amount?: number; method?: string};
      return {
        duplicate: true,
        used: Boolean(existing.used),
        amount: Number(existing.amount || parsed.amount),
        method: String(existing.method || parsed.method),
      };
    }
    tx.set(docRef, {
      trxId: parsed.trxId,
      amount: parsed.amount,
      method: parsed.method,
      rawText: params.rawText.slice(0, 2000),
      used: false,
      receivedAt: FieldValue.serverTimestamp(),
    });
    return {
      duplicate: false,
      used: false,
      amount: parsed.amount,
      method: parsed.method,
    };
  });

  if (!result.duplicate) {
    const store = readStore();
    appendServerLog(
      store,
      params.source || 'sms_webhook',
      'SMS_PAYMENT_RECORDED',
      `${parsed.method} ৳${parsed.amount} · TrxID ${parsed.trxId} (${params.source || 'sms_webhook'})`,
    );
    writeStore(store);
  }

  let reconciled: SmsReconcileOutcome | undefined;
  let finalUsed = result.used;
  if (!result.used) {
    reconciled = await reconcilePendingTransactionsForSms(getCommerceDeps(), {
      trxId: parsed.trxId,
      amount: result.amount,
      method: result.method,
    });
    if (reconciled.matched) {
      finalUsed = true;
    }
  }

  return {
    ok: true,
    duplicate: result.duplicate,
    used: finalUsed,
    parsed,
    reconciled,
  };
}

function extractCustomerTrxId(rawInput: string): string | null {
  const normalizedInput = normalizeBengaliDigits(rawInput).replace(/\s+/g, ' ').trim();
  if (!normalizedInput) return null;

  // 1. Explicit TrxID / TxnID label inside a bare or full-SMS text
  const explicitMatch = normalizedInput.match(
    /(?:trx\s*id|txn\s*id|txnid|transaction\s*id)\s*(?:is|হলো|হল|:|#|-|\s)*([a-zA-Z0-9_-]{5,40})\b/i,
  );
  if (explicitMatch?.[1]) {
    const cleaned = explicitMatch[1].replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
    if (cleaned.length >= 4 && cleaned.length <= 64) {
      return cleaned;
    }
  }

  // 2. Clean bare TrxID (single token)
  const nonTrxWords = new Set([
    'price',
    'list',
    'order',
    'topup',
    'cancel',
    'bkash',
    'nagad',
    'hello',
    'help',
    'status',
    'uid',
    'admin',
    'agent',
  ]);
  if (
    /^[a-zA-Z0-9_-]{5,40}$/.test(normalizedInput) &&
    !nonTrxWords.has(normalizedInput.toLowerCase()) &&
    (/[a-zA-Z]/.test(normalizedInput) || normalizedInput.length >= 8)
  ) {
    return normalizedInput.toUpperCase();
  }

  // 3. Full SMS / multi-word fallback: extract a mixed alphanumeric code (e.g., 9B4X2K7M1P, BKA123456)
  const mixedTokens = normalizedInput.match(/\b(?=[a-zA-Z0-9]*[a-zA-Z])(?=[a-zA-Z0-9]*\d)[a-zA-Z0-9]{6,24}\b/g);
  if (mixedTokens && mixedTokens.length > 0) {
    const ignoredPattern = /^(?:tk\d+|bdt\d+|\d+tk|\d+bdt|\d{1,2}(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d{0,4}|\d{1,2}am|\d{1,2}pm)$/i;
    const candidate = mixedTokens.find((tok) => !ignoredPattern.test(tok));
    if (candidate) {
      return candidate.toUpperCase();
    }
  }

  return null;
}

async function dispatchDistributorIfEnabled(params: {
  orderNumber: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  playerUid: string;
  amount: number;
}): Promise<{dispatched: boolean; statusText?: string}> {
  const store = readStore();
  const s = store.systemSettings;
  if (!s.distributorEnabled || !s.distributorBaseUrl || !s.distributorApiKey) {
    return {dispatched: false};
  }

  try {
    const parsedUrl = new URL(s.distributorBaseUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return {dispatched: false, statusText: 'Invalid distributor URL protocol'};
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${parsedUrl.toString().replace(/\/$/, '')}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.distributorApiKey}`,
        'X-Merchant-Id': s.distributorMerchantId || '',
      },
      body: JSON.stringify({
        orderNumber: params.orderNumber,
        productId: params.productId,
        productName: params.productName,
        packageId: params.packageId,
        packageName: params.packageName,
        playerUid: params.playerUid,
        amount: params.amount,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    appendServerLog(
      store,
      'telegram_bot',
      res.ok ? 'DISTRIBUTOR_DISPATCHED' : 'DISTRIBUTOR_FAILED',
      `Order ${params.orderNumber} -> HTTP ${res.status}`,
    );
    writeStore(store);
    return {dispatched: res.ok, statusText: `HTTP ${res.status}`};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendServerLog(store, 'telegram_bot', 'DISTRIBUTOR_ERROR', `Order ${params.orderNumber}: ${msg}`);
    writeStore(store);
    return {dispatched: false, statusText: msg};
  }
}

const WEBSITE_URL = (process.env.WEBSITE_URL || 'https://munaftopup.onrender.com').trim();
const GEMINI_BOT_MODEL = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
const GEMINI_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'] as const;
let geminiQuotaCooldownUntil = 0;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeBengaliDigits(input: string): string {
  const map: Record<string, string> = {
    '০': '0',
    '১': '1',
    '২': '2',
    '৩': '3',
    '৪': '4',
    '৫': '5',
    '৬': '6',
    '৭': '7',
    '৮': '8',
    '৯': '9',
  };
  return input.replace(/[০-৯]/g, (ch) => map[ch] ?? ch);
}

interface BotPackageOption {
  index: number;
  productId: string;
  productName: string;
  productDescription: string;
  productInstructions: string;
  productImage: string;
  requiresUid: boolean;
  uidLabel: string;
  packageId: string;
  packageName: string;
  quantityLabel: string;
  price: number;
  originalPrice: number;
  promoLabel: string;
}

interface BotSession {
  step: 'IDLE' | 'AWAITING_PACKAGE' | 'AWAITING_UID' | 'AWAITING_TRXID';
  options?: BotPackageOption[];
  selected?: BotPackageOption;
  playerUid?: string;
  customerName: string;
  history: Array<{role: 'user' | 'model'; text: string}>;
  updatedAt: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  business_message?: TelegramMessage;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  business_connection_id?: string;
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  text?: string;
  caption?: string;
}

interface TelegramBotState {
  running: boolean;
  username: string;
  lastError: string;
  lastPollAt: string;
  processedUpdates: number;
}

const telegramBotState: TelegramBotState = {
  running: false,
  username: '',
  lastError: '',
  lastPollAt: '',
  processedUpdates: 0,
};

const botSessions = new Map<string, BotSession>();
const BOT_SESSION_TTL_MS = 30 * 60 * 1000;

function cleanupExpiredBotSessions(): void {
  const cutoff = Date.now() - BOT_SESSION_TTL_MS;
  for (const [key, sess] of botSessions.entries()) {
    if (sess.updatedAt < cutoff) {
      botSessions.delete(key);
    }
  }
}

function getOrCreateBotSession(sessionKey: string, customerName: string): BotSession {
  const existing = botSessions.get(sessionKey);
  if (existing) {
    existing.customerName = customerName || existing.customerName;
    existing.updatedAt = Date.now();
    return existing;
  }
  const fresh: BotSession = {
    step: 'IDLE',
    customerName,
    history: [],
    updatedAt: Date.now(),
  };
  botSessions.set(sessionKey, fresh);
  return fresh;
}

function pushSessionHistory(session: BotSession, role: 'user' | 'model', text: string): void {
  const clean = text.trim().slice(0, 1200);
  if (!clean) return;
  session.history.push({role, text: clean});
  if (session.history.length > 8) {
    session.history = session.history.slice(-8);
  }
  session.updatedAt = Date.now();
}

async function callTelegramApi<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  timeoutMs = 35000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? {'Content-Type': 'application/json'} : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    const json = (await res.json()) as {ok: boolean; result?: T; description?: string; error_code?: number};
    if (!res.ok || !json.ok) {
      const err = new Error(json.description || `Telegram API ${method} HTTP ${res.status}`) as Error & {
        statusCode?: number;
      };
      err.statusCode = json.error_code || res.status;
      throw err;
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegramTyping(
  token: string,
  chatId: number,
  businessConnectionId?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    action: 'typing',
  };
  if (businessConnectionId) {
    payload.business_connection_id = businessConnectionId;
  }
  await callTelegramApi(token, 'sendChatAction', payload, 4000).catch(() => null);
}

function buildQuickReplyInlineKeyboard(): Record<string, unknown> | undefined {
  const store = readStore();
  const s = store.systemSettings;
  if (!s.telegramQuickRepliesEnabled) return undefined;
  const activePresets = (s.telegramQuickReplies || []).filter((p) => p.active && p.label.trim().length > 0);
  if (activePresets.length === 0) return undefined;

  const inline_keyboard: Array<Array<{text: string; callback_data: string}>> = [];
  for (let i = 0; i < activePresets.length; i += 2) {
    const row = activePresets.slice(i, i + 2).map((p) => ({
      text: p.label.trim().slice(0, 40),
      callback_data: `qr:${p.id}`.slice(0, 64),
    }));
    inline_keyboard.push(row);
  }
  return {inline_keyboard};
}

async function sendTelegramReply(
  token: string,
  chatId: number,
  text: string,
  businessConnectionId?: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  // Split messages safely under Telegram's 4096 char limit
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 3800) {
    let splitIdx = remaining.lastIndexOf('\n', 3800);
    if (splitIdx < 500) splitIdx = 3800;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  if (remaining) chunks.push(remaining);

  for (let idx = 0; idx < chunks.length; idx++) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[idx],
    };
    if (businessConnectionId) {
      payload.business_connection_id = businessConnectionId;
    }
    if (replyMarkup && idx === chunks.length - 1) {
      payload.reply_markup = replyMarkup;
    }
    await callTelegramApi(token, 'sendMessage', payload, 15000);
  }
}

const telegramChatRoutes = new Map<string, {chatId: number; businessConnectionId?: string}>();

async function saveTelegramChatRoute(
  customerUid: string,
  chatId: number,
  businessConnectionId: string | undefined,
  customerName: string,
): Promise<void> {
  if (!customerUid || !Number.isFinite(chatId)) return;
  telegramChatRoutes.set(customerUid, {chatId, businessConnectionId});
  if (!adminDb) return;
  try {
    await adminDb.collection('telegram_chats').doc(customerUid).set(
      {
        customerUid,
        chatId,
        businessConnectionId: businessConnectionId || '',
        customerName: customerName.slice(0, 100),
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
  } catch {
    // Non-fatal: in-memory route remains active
  }
}

async function resolveTelegramDestination(
  customerUid?: string,
  explicitChatId?: number | string,
  explicitBusinessConnId?: string,
): Promise<{chatId: number | null; businessConnectionId?: string}> {
  let chatId: number | null = null;
  let businessConnectionId = explicitBusinessConnId?.trim() || undefined;

  if (explicitChatId !== undefined && explicitChatId !== null && String(explicitChatId).trim() !== '') {
    const parsed = Number(explicitChatId);
    if (Number.isSafeInteger(parsed) && parsed !== 0) {
      chatId = parsed;
    }
  }

  const cleanUid = (customerUid || '').trim();
  if (!chatId && cleanUid) {
    const uidMatch = cleanUid.match(/^tg_(-?\d+)$/);
    if (uidMatch?.[1]) {
      const parsed = Number(uidMatch[1]);
      if (Number.isSafeInteger(parsed) && parsed !== 0) {
        chatId = parsed;
      }
    }
  }

  if (cleanUid) {
    const cached = telegramChatRoutes.get(cleanUid);
    if (cached) {
      if (!chatId) chatId = cached.chatId;
      if (!businessConnectionId && cached.businessConnectionId) {
        businessConnectionId = cached.businessConnectionId;
      }
    }
    if ((!chatId || !businessConnectionId) && adminDb) {
      try {
        const snap = await adminDb.collection('telegram_chats').doc(cleanUid).get();
        if (snap.exists) {
          const data = snap.data() as {chatId?: number; businessConnectionId?: string};
          if (!chatId && typeof data.chatId === 'number' && Number.isSafeInteger(data.chatId)) {
            chatId = data.chatId;
          }
          if (!businessConnectionId && typeof data.businessConnectionId === 'string' && data.businessConnectionId.trim()) {
            businessConnectionId = data.businessConnectionId.trim();
          }
          if (chatId) {
            telegramChatRoutes.set(cleanUid, {chatId, businessConnectionId});
          }
        }
      } catch {
        // Ignore Firestore lookup error and fall back to parsed tg_<chatId>
      }
    }
  }

  return {chatId, businessConnectionId};
}

export interface OrderStatusTelegramPayload {
  orderNumber: string;
  orderStatus: 'pending' | 'processing' | 'completed' | 'cancelled' | 'expired';
  paymentStatus?: 'pending' | 'verified' | 'rejected';
  productName: string;
  packageName: string;
  playerUid?: string;
  totalAmount?: number;
  paymentMethodName?: string;
  trxId?: string;
  voucherCode?: string;
  note?: string;
  customerUid?: string;
  chatId?: number | string;
  businessConnectionId?: string;
}

export async function sendTelegramOrderStatusUpdate(
  params: OrderStatusTelegramPayload,
): Promise<{sent: boolean; skipped?: boolean; reason?: string}> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return {sent: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN is not configured'};
  }

  const dest = await resolveTelegramDestination(
    params.customerUid,
    params.chatId,
    params.businessConnectionId,
  );
  if (!dest.chatId) {
    return {sent: false, skipped: true, reason: 'No Telegram chat associated with this customer'};
  }

  let headline = '🔔 আপনার অর্ডারের স্ট্যাটাস আপডেট করা হয়েছে';
  let statusBadge: string = params.orderStatus;

  if (params.orderStatus === 'completed') {
    headline =
      params.paymentStatus === 'verified' && params.trxId
        ? '🎉 আপনার পেমেন্ট ভেরিফাই হয়েছে এবং অর্ডার সফলভাবে সম্পন্ন হয়েছে!'
        : '✅ আপনার অর্ডার সফলভাবে সম্পন্ন (Completed) হয়েছে!';
    statusBadge = 'Completed ✅';
  } else if (params.orderStatus === 'processing') {
    headline =
      params.paymentStatus === 'verified'
        ? '💳 পেমেন্ট ভেরিফাই সম্পন্ন! আপনার টপ-আপ এখন প্রসেসিং হচ্ছে।'
        : '⏳ আপনার অর্ডারটি প্রসেসিং (Processing) অবস্থায় রয়েছে।';
    statusBadge = 'Processing ⏳';
  } else if (params.orderStatus === 'cancelled') {
    headline =
      params.paymentStatus === 'rejected'
        ? '❌ আপনার পেমেন্ট বাতিল/রিজেক্ট হওয়ায় অর্ডারটি ক্যানসেল করা হয়েছে।'
        : '❌ আপনার অর্ডারটি ক্যানসেল (Cancelled) করা হয়েছে।';
    statusBadge = 'Cancelled ❌';
  } else if (params.orderStatus === 'expired') {
    headline =
      '⌛ আপনার অর্ডারটি ৩০ মিনিটের বেশি সময় পেন্ডিং থাকায় স্বয়ংক্রিয়ভাবে মেয়াদোত্তীর্ণ (Expired) হয়েছে।';
    statusBadge = 'Expired ⌛';
  } else if (params.orderStatus === 'pending') {
    headline = '🕒 আপনার অর্ডারটি পেন্ডিং রিভিউতে রয়েছে।';
    statusBadge = 'Pending 🕒';
  }

  const lines: string[] = [
    headline,
    '',
    '🧾 অর্ডার বিবরণ:',
    `• অর্ডার নম্বর: ${params.orderNumber}`,
    `• প্রোডাক্ট: ${params.productName}`,
    `• প্যাকেজ: ${params.packageName}`,
  ];

  if (params.playerUid) {
    lines.push(`• Player UID: ${params.playerUid}`);
  }
  if (params.paymentMethodName) {
    lines.push(`• পেমেন্ট মাধ্যম: ${params.paymentMethodName}`);
  }
  if (params.trxId) {
    lines.push(`• TrxID: ${params.trxId}`);
  }
  if (typeof params.totalAmount === 'number' && params.totalAmount > 0) {
    lines.push(`• মূল্য: ৳${params.totalAmount}`);
  }
  lines.push(`• স্ট্যাটাস: ${statusBadge}`);

  if (params.voucherCode && params.voucherCode.trim()) {
    lines.push('');
    lines.push(`🔑 রিডিম / ভাউচার কোড:\n${params.voucherCode.trim()}`);
  }
  if (params.note && params.note.trim()) {
    lines.push('');
    lines.push(`💬 বার্তা: ${params.note.trim()}`);
  }

  lines.push('');
  if (params.orderStatus === 'completed') {
    lines.push('আমাদের সাথে থাকার জন্য ধন্যবাদ! নতুন অর্ডার করতে "অর্ডার" লিখুন।');
  } else if (params.orderStatus === 'expired') {
    lines.push('নতুন করে অর্ডার করতে "অর্ডার" লিখুন অথবা কোনো সহায়তার জন্য "এজেন্ট" লিখে মেসেজ করুন।');
  } else {
    lines.push('যেকোনো সহায়তার জন্য এখানে মেসেজ করুন অথবা "অর্ডার" লিখে নতুন অর্ডার শুরু করুন।');
  }

  const messageText = lines.join('\n');
  const quickReplyMarkup = buildQuickReplyInlineKeyboard();

  try {
    await sendTelegramReply(
      token,
      dest.chatId,
      messageText,
      dest.businessConnectionId,
      quickReplyMarkup,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // If business connection expired/invalid, try direct DM fallback once
    if (dest.businessConnectionId && /business_connection/i.test(errMsg)) {
      try {
        await sendTelegramReply(token, dest.chatId, messageText, undefined, quickReplyMarkup);
      } catch (fallbackErr) {
        const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        const store = readStore();
        appendServerLog(
          store,
          'telegram_bot',
          'TELEGRAM_ORDER_NOTIFY_FAILED',
          `Order ${params.orderNumber}: ${fbMsg}`,
        );
        writeStore(store);
        return {sent: false, reason: fbMsg};
      }
    } else {
      const store = readStore();
      appendServerLog(
        store,
        'telegram_bot',
        'TELEGRAM_ORDER_NOTIFY_FAILED',
        `Order ${params.orderNumber}: ${errMsg}`,
      );
      writeStore(store);
      return {sent: false, reason: errMsg};
    }
  }

  const store = readStore();
  appendServerLog(
    store,
    'telegram_bot',
    'TELEGRAM_ORDER_NOTIFY_SENT',
    `Order ${params.orderNumber} (${params.orderStatus}) notified to chat ${dest.chatId}`,
  );
  writeStore(store);
  return {sent: true};
}

interface BotSharedStoreCache {
  fetchedAt: number;
  brandName: string;
  noticeText: string;
  supportInfo: string;
  options: BotPackageOption[];
  bkashNumber: string;
  nagadNumber: string;
  otherPaymentMethods: Array<{name: string; accountNumber: string; accountType: string; instructions: string}>;
}

const BOT_STORE_CACHE_TTL_MS = 60 * 1000;
let botSharedStoreCache: BotSharedStoreCache | null = null;
let botSharedStoreInflight: Promise<BotSharedStoreCache> | null = null;

async function getBotSharedStoreSnapshot(forceRefresh = false): Promise<BotSharedStoreCache> {
  const now = Date.now();
  if (!forceRefresh && botSharedStoreCache && now - botSharedStoreCache.fetchedAt < BOT_STORE_CACHE_TTL_MS) {
    return botSharedStoreCache;
  }
  if (botSharedStoreInflight) {
    return botSharedStoreInflight;
  }

  botSharedStoreInflight = (async (): Promise<BotSharedStoreCache> => {
    const snapCache: BotSharedStoreCache = {
      fetchedAt: Date.now(),
      brandName: 'Munaf Topup',
      noticeText: '',
      supportInfo: '',
      options: botSharedStoreCache?.options || [],
      bkashNumber: (process.env.BKASH_NUMBER || '').trim(),
      nagadNumber: (process.env.NAGAD_NUMBER || '').trim(),
      otherPaymentMethods: [],
    };

    if (!adminDb) {
      botSharedStoreCache = snapCache;
      return snapCache;
    }

    const [productsRes, paymentMethodsRes, settingsRes] = await Promise.allSettled([
      adminDb.collection('products').where('active', '==', true).get(),
      adminDb.collection('paymentMethods').where('active', '==', true).get(),
      adminDb.collection('settings').doc('storefront').get(),
    ]);

    if (productsRes.status === 'fulfilled') {
      const products = productsRes.value.docs
        .map((d) => d.data() as {
          id?: string;
          name?: string;
          shortDescription?: string;
          instructions?: string;
          images?: string[];
          requiresUid?: boolean;
          uidLabel?: string;
          displayOrder?: number;
          packages?: Array<{
            id?: string;
            name?: string;
            quantityLabel?: string;
            price?: number;
            originalPrice?: number;
            promoLabel?: string;
            active?: boolean;
            displayOrder?: number;
          }>;
        })
        .sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0));

      const options: BotPackageOption[] = [];
      let idx = 1;
      for (const p of products) {
        const productId = String(p.id || '').trim();
        const productName = String(p.name || 'Product').trim();
        const productImage = Array.isArray(p.images) && p.images[0] ? String(p.images[0]) : '';
        const pkgs = Array.isArray(p.packages)
          ? [...p.packages]
              .filter((pkg) => pkg && pkg.active !== false && Number(pkg.price) > 0)
              .sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0))
          : [];
        for (const pkg of pkgs) {
          options.push({
            index: idx++,
            productId,
            productName,
            productDescription: String(p.shortDescription || '').trim(),
            productInstructions: String(p.instructions || '').trim(),
            productImage,
            requiresUid: p.requiresUid !== false,
            uidLabel: String(p.uidLabel || 'Player UID').trim(),
            packageId: String(pkg.id || `pkg_${idx}`),
            packageName: String(pkg.name || pkg.quantityLabel || 'Package').trim(),
            quantityLabel: String(pkg.quantityLabel || pkg.name || '').trim(),
            price: Number(pkg.price),
            originalPrice: Number(pkg.originalPrice || 0),
            promoLabel: String(pkg.promoLabel || '').trim(),
          });
        }
      }
      snapCache.options = options;
    }

    if (paymentMethodsRes.status === 'fulfilled') {
      for (const docSnap of paymentMethodsRes.value.docs) {
        const d = docSnap.data() as {
          name?: string;
          accountNumber?: string;
          accountType?: string;
          instructions?: string;
        };
        const name = String(d.name || '').trim();
        const accountNumber = String(d.accountNumber || '').trim();
        const nameLower = name.toLowerCase();
        if (!snapCache.bkashNumber && nameLower.includes('bkash') && accountNumber) {
          snapCache.bkashNumber = accountNumber;
        } else if (!snapCache.nagadNumber && nameLower.includes('nagad') && accountNumber) {
          snapCache.nagadNumber = accountNumber;
        }
        if (name && accountNumber) {
          snapCache.otherPaymentMethods.push({
            name,
            accountNumber,
            accountType: String(d.accountType || 'Personal'),
            instructions: String(d.instructions || '').trim(),
          });
        }
      }
    }

    if (settingsRes.status === 'fulfilled' && settingsRes.value.exists) {
      const s = settingsRes.value.data() as {
        brandName?: string;
        noticeText?: string;
        noticeActive?: boolean;
        contact?: {whatsapp?: string; telegram?: string; email?: string; supportHours?: string};
      };
      if (s.brandName && s.brandName.trim()) {
        snapCache.brandName = s.brandName.trim();
      }
      if (s.noticeActive && s.noticeText) {
        snapCache.noticeText = s.noticeText.trim();
      }
      if (s.contact) {
        const parts = [
          s.contact.whatsapp ? `WhatsApp: ${s.contact.whatsapp}` : '',
          s.contact.telegram ? `Telegram: ${s.contact.telegram}` : '',
          s.contact.email ? `Email: ${s.contact.email}` : '',
          s.contact.supportHours ? `Hours: ${s.contact.supportHours}` : '',
        ].filter(Boolean);
        snapCache.supportInfo = parts.join(' | ');
      }
    }

    snapCache.fetchedAt = Date.now();
    botSharedStoreCache = snapCache;
    return snapCache;
  })().finally(() => {
    botSharedStoreInflight = null;
  });

  return botSharedStoreInflight;
}

async function fetchActiveRateOptions(): Promise<BotPackageOption[]> {
  try {
    const shared = await getBotSharedStoreSnapshot();
    return shared.options;
  } catch (err) {
    console.error('fetchActiveRateOptions error:', err instanceof Error ? err.message : err);
    return [];
  }
}

interface TelegramBotLiveContext {
  brandName: string;
  websiteUrl: string;
  noticeText: string;
  supportInfo: string;
  options: BotPackageOption[];
  bkashNumber: string;
  nagadNumber: string;
  otherPaymentMethods: Array<{name: string; accountNumber: string; accountType: string; instructions: string}>;
  recentOrders: Array<{
    orderNumber: string;
    productName: string;
    packageName: string;
    playerUid: string;
    totalAmount: number;
    paymentStatus: string;
    orderStatus: string;
    voucherCode: string;
    adminNote: string;
    createdAtMs: number;
  }>;
}

async function fetchTelegramBotLiveContext(tgUid: string): Promise<TelegramBotLiveContext> {
  const sharedPromise = getBotSharedStoreSnapshot();
  const ordersPromise = adminDb
    ? Promise.race([
        adminDb.collection('orders').where('customerUid', '==', tgUid).get(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]).catch(() => null)
    : Promise.resolve(null);

  const [shared, ordersSnap] = await Promise.all([sharedPromise, ordersPromise]);

  const ctx: TelegramBotLiveContext = {
    brandName: shared.brandName,
    websiteUrl: WEBSITE_URL,
    noticeText: shared.noticeText,
    supportInfo: shared.supportInfo,
    options: shared.options,
    bkashNumber: shared.bkashNumber,
    nagadNumber: shared.nagadNumber,
    otherPaymentMethods: shared.otherPaymentMethods,
    recentOrders: [],
  };

  if (ordersSnap && 'docs' in ordersSnap) {
    const toMs = (val: unknown): number => {
      if (!val) return 0;
      if (typeof (val as {toMillis?: () => number}).toMillis === 'function') {
        return (val as {toMillis: () => number}).toMillis();
      }
      return 0;
    };
    ctx.recentOrders = ordersSnap.docs
      .map((d) => {
        const o = d.data() as Record<string, unknown>;
        return {
          orderNumber: String(o.orderNumber || ''),
          productName: String(o.productName || ''),
          packageName: String(o.packageName || ''),
          playerUid: String(o.playerUid || ''),
          totalAmount: Number(o.totalAmount || 0),
          paymentStatus: String(o.paymentStatus || ''),
          orderStatus: String(o.orderStatus || ''),
          voucherCode: String(o.voucherCode || ''),
          adminNote: String(o.adminNote || ''),
          createdAtMs: toMs(o.createdAt),
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 5);
  }

  return ctx;
}


async function resolveBotPaymentNumbers(): Promise<{bkashNumber: string; nagadNumber: string}> {
  let bkashNumber = (process.env.BKASH_NUMBER || '').trim();
  let nagadNumber = (process.env.NAGAD_NUMBER || '').trim();

  if ((!bkashNumber || !nagadNumber) && adminDb) {
    try {
      const snap = await adminDb.collection('paymentMethods').where('active', '==', true).get();
      for (const docSnap of snap.docs) {
        const d = docSnap.data() as {name?: string; accountNumber?: string};
        const nameLower = String(d.name || '').toLowerCase();
        if (!bkashNumber && nameLower.includes('bkash') && d.accountNumber) {
          bkashNumber = String(d.accountNumber).trim();
        }
        if (!nagadNumber && nameLower.includes('nagad') && d.accountNumber) {
          nagadNumber = String(d.accountNumber).trim();
        }
      }
    } catch {
      // keep env values
    }
  }

  return {bkashNumber, nagadNumber};
}

function isRateListTrigger(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (lower === '/start' || lower === '/menu' || lower === '/list' || lower === '/price') {
    return true;
  }
  if (/\b(status|track)\b|স্ট্যাটাস|অবস্থা|কোথায়|কোথায়|কই|হয়েছে কি|হয়েছে কি/i.test(lower)) {
    return false;
  }
  const keywords = [
    'দাম কত',
    'দাম',
    'লিস্ট',
    'রেট',
    'মেনু',
    'প্যাকেজ',
    'price',
    'list',
    'menu',
    'অর্ডার',
    'টপআপ',
    'টপ আপ',
    'order',
    'topup',
    'rate',
  ];
  return keywords.some((kw) => lower.includes(kw));
}

function isCancelCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower === 'বাতিল' ||
    lower === 'ক্যানসেল' ||
    lower === 'cancel' ||
    lower === 'cancel order' ||
    lower === '/cancel' ||
    lower === '/reset'
  );
}

function isHumanAgentRequest(text: string): boolean {
  const lower = text.trim().toLowerCase();
  const triggers = [
    'এজেন্ট',
    'এডমিন',
    'অ্যাডমিন',
    'কথা বলতে চাই',
    'সরাসরি কথা',
    'কথা বলবো',
    'কথা বলব',
    'ম্যানেজার',
    'কাস্টমার কেয়ার',
    'কাস্টমার কেয়ার',
    'human agent',
    'live agent',
    'support agent',
    'customer care',
    'talk to admin',
    'talk to agent',
    'speak to admin',
    'speak with admin',
    'speak with agent',
    'agent',
    'admin',
  ];
  return triggers.some((kw) => lower.includes(kw));
}

async function escalateToHumanAgent(params: {
  token: string;
  chatId: number;
  businessConnectionId?: string;
  customerName: string;
  tgUid: string;
  rawText: string;
  session: BotSession;
  customReply?: string;
}): Promise<void> {
  const {token, chatId, businessConnectionId, customerName, tgUid, rawText, session, customReply} = params;
  const recentHistory = session.history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Customer' : 'Bot'}: ${h.text}`)
    .join(' | ');

  await sendAdminNotificationEmail(
    `Telegram Human Agent Request — ${customerName}`,
    [
      {label: 'Customer Name', value: customerName},
      {label: 'Telegram ID', value: `${tgUid} (Chat ${chatId})`},
      {label: 'Customer Message', value: rawText.slice(0, 800)},
      {label: 'Current Bot Step', value: session.step},
      {
        label: 'Selected Package',
        value: session.selected
          ? `${session.selected.productName} - ${session.selected.packageName} (৳${session.selected.price})`
          : 'None',
      },
      {label: 'Player UID', value: session.playerUid || 'None'},
      {label: 'Recent Chat', value: recentHistory || 'N/A'},
      {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
    ],
    'telegram_bot',
  );

  await notifyTelegramAdmins(
    getTelegramAdminDeps(),
    token,
    [
      '🚨 Telegram Customer Agent Request',
      `👤 Customer: ${customerName} (${tgUid})`,
      `💬 Message: ${rawText.slice(0, 300)}`,
    ].join('\n'),
  ).catch(() => null);

  const replyText =
    customReply ||
    [
      '🙋‍♂️ আপনার অনুরোধটি আমাদের এডমিনের কাছে পাঠানো হয়েছে (ইমেইলে নোটিফিকেশন গেছে)।',
      '',
      '⏳ খুব শীঘ্রই একজন এডমিন আপনার সাথে এখানেই যোগাযোগ করবেন। অনুগ্রহ করে একটু অপেক্ষা করুন।',
      `🌐 ওয়েবসাইট: ${WEBSITE_URL}`,
    ].join('\n');

  pushSessionHistory(session, 'model', replyText);
  await sendTelegramReply(token, chatId, replyText, businessConnectionId);
}

function formatPaymentSummaryPrompt(
  selected: BotPackageOption,
  playerUid: string,
  bkashNumber: string,
  nagadNumber: string,
): string {
  const paymentLines: string[] = [];
  if (bkashNumber) paymentLines.push(`• bKash (Send Money): ${bkashNumber}`);
  if (nagadNumber) paymentLines.push(`• Nagad (Send Money): ${nagadNumber}`);
  if (paymentLines.length === 0) {
    paymentLines.push('• পেমেন্ট নম্বর এখনো সেট করা হয়নি — এডমিনের সাথে যোগাযোগ করুন।');
  }

  return [
    '📋 অর্ডার সামারি:',
    `🎮 প্রোডাক্ট: ${selected.productName}`,
    `💎 প্যাকেজ: ${selected.packageName}`,
    `🆔 ${selected.uidLabel || 'Player UID'}: ${playerUid}`,
    `💰 মোট মূল্য: ৳${selected.price}`,
    '',
    '💳 নিচের যেকোনো নম্বরে Send Money করুন:',
    ...paymentLines,
    '',
    `উপরের নম্বরে ঠিক ৳${selected.price} Send Money করে শুধুমাত্র আপনার Transaction ID (TrxID) লিখে পাঠান।`,
    '(যেমন: 9B4X2K7M1P)',
  ].join('\n');
}

function formatPackageSelectedPrompt(selected: BotPackageOption): string {
  return [
    '✅ আপনি সিলেক্ট করেছেন:',
    `🎮 প্রোডাক্ট: ${selected.productName}`,
    `💎 প্যাকেজ: ${selected.packageName}`,
    `💰 মূল্য: ৳${selected.price}`,
    '',
    `👉 এখন আপনার গেম ${selected.uidLabel || 'Player UID'} (৫ থেকে ১৫ ডিজিটের সংখ্যা) লিখে পাঠান:`,
  ].join('\n');
}

function formatFallbackRateList(options: BotPackageOption[], brandName: string): string {
  const lines: string[] = [`💎 ${brandName} — আজকের টপআপ ও ডায়মন্ড রেট লিস্ট:`, ''];
  let lastProduct = '';
  for (const opt of options) {
    if (opt.productName !== lastProduct) {
      if (lastProduct) lines.push('');
      lines.push(`🎮 ${opt.productName}`);
      lastProduct = opt.productName;
    }
    lines.push(`${opt.index}. ${opt.packageName} — ৳${opt.price}`);
  }
  lines.push('');
  lines.push('👉 অর্ডার করতে পছন্দের প্যাকেজের নম্বর (যেমন: 1 বা ১) অথবা প্যাকেজের নাম লিখে পাঠান।');
  lines.push('❌ বাতিল করতে "বাতিল" লিখুন।');
  return lines.join('\n');
}

function formatStaticHelpfulMenu(liveCtx: TelegramBotLiveContext): string {
  const paymentLines: string[] = [];
  if (liveCtx.bkashNumber) paymentLines.push(`• bKash (Send Money): ${liveCtx.bkashNumber}`);
  if (liveCtx.nagadNumber) paymentLines.push(`• Nagad (Send Money): ${liveCtx.nagadNumber}`);

  return [
    `👋 আসসালামু আলাইকুম! ${liveCtx.brandName}-এ স্বাগতম।`,
    '',
    '📌 দ্রুত সার্ভিস মেনু (২৪/৭ অটোমেটেড):',
    '• "দাম কত" বা "লিস্ট" — আজকের প্যাকেজ ও ডায়মন্ড রেট দেখতে',
    '• প্যাকেজ নম্বর (যেমন: 1, 2) বা প্যাকেজের নাম — অর্ডার শুরু করতে',
    '• "এজেন্ট" — এডমিনের সাথে কথা বলতে',
    ...(paymentLines.length > 0 ? ['', '💳 পেমেন্ট নম্বর:', ...paymentLines] : []),
    '',
    `🌐 ওয়েবসাইট: ${liveCtx.websiteUrl}`,
  ].join('\n');
}

function extractPlayerUidFromText(rawText: string): string | null {
  const normalized = normalizeBengaliDigits(rawText).trim();
  if (!normalized) return null;

  const compact = normalized.replace(/\s+/g, '');
  if (/^\d{5,15}$/.test(compact)) {
    return compact;
  }

  const labeledMatch = normalized.match(
    /(?:uid|player\s*id|game\s*id|id)\s*(?:হলো|হল|is|:|#|=|-|\s)*(\d{5,15})\b/i,
  );
  if (labeledMatch?.[1]) {
    return labeledMatch[1];
  }

  const digitTokens = normalized.match(/\b\d{5,15}\b/g);
  if (digitTokens && digitTokens.length === 1) {
    return digitTokens[0];
  }

  return null;
}

function matchDeterministicPackage(normalizedText: string, options: BotPackageOption[]): BotPackageOption | null {
  if (!normalizedText || options.length === 0) return null;
  const trimmed = normalizedText.trim();

  // 1. Explicit numeric selection (e.g., "1", "#2", "2.", "3 নং", "option 4")
  const numMatch = trimmed.match(
    /^(?:#|option\s*|pkg\s*|package\s*|প্যাকেজ\s*)?(\d{1,3})(?:\s*(?:নং|নাম্বার|নম্বর|no|\.|[)]|নম্বরটি))?$/i,
  );
  if (numMatch?.[1]) {
    const idx = Number.parseInt(numMatch[1], 10);
    return options.find((o) => o.index === idx) || null;
  }

  // 2. Exact match on packageName or quantityLabel
  const cleanLower = trimmed.toLowerCase();
  const exactMatch = options.find(
    (o) =>
      o.packageName.toLowerCase() === cleanLower ||
      o.quantityLabel.toLowerCase() === cleanLower ||
      `${o.productName} ${o.packageName}`.toLowerCase() === cleanLower,
  );
  if (exactMatch) return exactMatch;

  // 3. Unique partial match when text is specific enough (>= 3 chars)
  if (cleanLower.length >= 3 && !/^(diamond|diamonds|ডায়মন্ড|ডায়মন্ড|topup|টপআপ)$/i.test(cleanLower)) {
    const partialMatches = options.filter((o) => {
      const pkg = o.packageName.toLowerCase();
      const qty = o.quantityLabel.toLowerCase();
      const combined = `${o.productName} ${o.packageName}`.toLowerCase();
      return (
        pkg.includes(cleanLower) ||
        qty.includes(cleanLower) ||
        (cleanLower.length >= 5 && combined.includes(cleanLower))
      );
    });
    if (partialMatches.length === 1) {
      return partialMatches[0];
    }
  }

  return null;
}

async function verifyAndCompleteTelegramOrder(params: {
  token: string;
  chatId: number;
  businessConnectionId?: string;
  sessionKey: string;
  session: BotSession;
  selected: BotPackageOption;
  playerUid: string;
  rawTrxInput: string;
  customerName: string;
}): Promise<boolean> {
  const {token, chatId, businessConnectionId, sessionKey, session, selected, playerUid, rawTrxInput, customerName} =
    params;

  if (!adminDb) {
    await sendTelegramReply(
      token,
      chatId,
      '⚠️ পেমেন্ট ভেরিফিকেশন সিস্টেম সাময়িকভাবে অনুপলব্ধ। অনুগ্রহ করে একটু পর আবার চেষ্টা করুন।',
      businessConnectionId,
    );
    return false;
  }

  const trxId = extractCustomerTrxId(rawTrxInput);

  if (!trxId) {
    await sendTelegramReply(
      token,
      chatId,
      '❌ অনুগ্রহ করে শুধুমাত্র সঠিক Transaction ID (TrxID) লিখে পাঠান (যেমন: 9B4X2K7M1P)।',
      businessConnectionId,
    );
    return false;
  }

  const tgUid = `tg_${chatId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

  try {
    const outcome = await adminDb.runTransaction(async (tx) => {
      const smsRef = adminDb!.collection('sms_payments').doc(trxId);
      const smsSnap = await tx.get(smsRef);

      if (!smsSnap.exists) {
        return {ok: false as const, code: 'NOT_FOUND' as const};
      }

      const smsData = smsSnap.data() as {
        amount?: number;
        method?: string;
        used?: boolean;
      };

      if (smsData.used === true) {
        return {ok: false as const, code: 'ALREADY_USED' as const};
      }

      const paidAmount = Number(smsData.amount || 0);
      if (paidAmount < selected.price) {
        return {
          ok: false as const,
          code: 'INSUFFICIENT_AMOUNT' as const,
          receivedAmount: paidAmount,
        };
      }

      const methodName = smsData.method === 'Nagad' ? 'Nagad' : 'bKash';
      const methodId = methodName.toLowerCase();
      const trxKey = `${methodId}_${trxId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      const trxRegRef = adminDb!.collection('trxRegistry').doc(trxKey);
      const trxRegSnap = await tx.get(trxRegRef);
      if (trxRegSnap.exists) {
        return {ok: false as const, code: 'ALREADY_USED' as const};
      }

      const orderId = `ord_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const orderNumber = `SV-${Math.floor(100000 + Math.random() * 900000)}`;
      const now = FieldValue.serverTimestamp();
      const maskedUid =
        playerUid.length > 4 ? `${playerUid.slice(0, 2)}***${playerUid.slice(-2)}` : playerUid;

      tx.update(smsRef, {
        used: true,
        usedAt: now,
        usedOrderNumber: orderNumber,
      });

      tx.set(adminDb!.collection('orders').doc(orderId), {
        id: orderId,
        orderNumber,
        customerUid: tgUid,
        customerName: customerName.slice(0, 100) || `Telegram User ${chatId}`,
        customerEmail: '',
        customerPhone: tgUid.slice(0, 30),
        productId: selected.productId,
        productName: selected.productName.slice(0, 120),
        productImage: selected.productImage.slice(0, 1000),
        packageId: selected.packageId,
        packageName: selected.packageName.slice(0, 120),
        quantityLabel: (selected.quantityLabel || selected.packageName).slice(0, 80),
        unitPrice: selected.price,
        totalAmount: selected.price,
        playerUid,
        serverId: '',
        paymentType: 'manual',
        paymentMethodId: methodId,
        paymentMethodName: methodName,
        senderNumber: 'Telegram',
        trxId,
        trxKey,
        screenshotUrl: '',
        voucherCode: '',
        walletRefunded: false,
        paymentStatus: 'verified',
        orderStatus: 'completed',
        adminNote: `Auto-verified via ${methodName} SMS (৳${paidAmount}) on Telegram Business Bot`,
        notificationMessage: 'Payment verified automatically via Telegram Business Bot. Order completed!',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });

      tx.set(adminDb!.collection('orderTracking').doc(orderNumber), {
        orderNumber,
        productName: selected.productName.slice(0, 120),
        packageName: selected.packageName.slice(0, 120),
        playerUidMasked: maskedUid,
        paymentStatus: 'verified',
        orderStatus: 'completed',
        notificationMessage: 'Payment verified automatically via Telegram Business Bot. Order completed!',
        createdAt: now,
        updatedAt: now,
      });

      tx.set(trxRegRef, {
        trxKey,
        trxId,
        orderId,
        customerUid: tgUid,
        paymentMethodId: methodId,
        amount: selected.price,
        status: 'verified',
        createdAt: now,
      });

      return {
        ok: true as const,
        orderId,
        orderNumber,
        methodName,
        paidAmount,
      };
    });

    if (!outcome.ok) {
      let errReply = '';
      if (outcome.code === 'NOT_FOUND') {
        errReply = `❌ দুঃখিত! "${trxId}" ট্রানজ্যাকশন আইডিটি এখনো আমাদের সিস্টেমে পাওয়া যায়নি।\n\nটাকা পাঠিয়ে থাকলে ১০-১৫ সেকেন্ড অপেক্ষা করে সঠিক TrxID টি আবার পাঠান।`;
      } else if (outcome.code === 'ALREADY_USED') {
        errReply = `⚠️ এই TrxID (${trxId}) ইতিমধ্যেই অন্য অর্ডারে ব্যবহার করা হয়েছে। অনুগ্রহ করে নতুন পেমেন্টের সঠিক TrxID পাঠান।`;
      } else {
        errReply = `❌ পাঠানো টাকার পরিমাণ (৳${outcome.receivedAmount}) প্যাকেজের মূল্যের (৳${selected.price}) চেয়ে কম! অনুগ্রহ করে সঠিক পরিমাণ টাকা পাঠিয়ে নতুন TrxID দিন।`;
      }
      pushSessionHistory(session, 'model', errReply);
      await sendTelegramReply(token, chatId, errReply, businessConnectionId);
      return false;
    }

    session.step = 'IDLE';
    session.selected = undefined;
    session.playerUid = undefined;
    botSessions.set(sessionKey, session);
    markNotificationEventSent(`order:${outcome.orderNumber}`);

    const distResult = await dispatchDistributorIfEnabled({
      orderNumber: outcome.orderNumber,
      productId: selected.productId,
      productName: selected.productName,
      packageId: selected.packageId,
      packageName: selected.packageName,
      playerUid,
      amount: selected.price,
    });

    const store = readStore();
    appendServerLog(
      store,
      'telegram_bot',
      'TELEGRAM_AUTO_ORDER',
      `Order ${outcome.orderNumber} completed via ${outcome.methodName} TrxID ${trxId} (৳${selected.price})`,
    );
    writeStore(store);

    await sendAdminNotificationEmail(
      `Telegram Auto-Order ${outcome.orderNumber} — ${selected.productName}`,
      [
        {label: 'Order Number', value: outcome.orderNumber},
        {label: 'Source', value: 'Telegram Business Bot (Auto-Verified)'},
        {label: 'Product', value: selected.productName},
        {label: 'Package', value: selected.packageName},
        {label: 'Order Amount', value: `৳${selected.price}`},
        {label: 'SMS Verified Paid', value: `৳${outcome.paidAmount} (${outcome.methodName})`},
        {label: 'TrxID', value: trxId},
        {label: 'Player UID', value: playerUid},
        {label: 'Customer', value: `${customerName} (${tgUid})`},
        {
          label: 'Distributor API',
          value: distResult.dispatched ? `Dispatched (${distResult.statusText})` : 'Not enabled / Manual',
        },
        {label: 'Order Status', value: 'completed'},
        {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
      ],
      'telegram_bot',
    );

    await sendTelegramOrderStatusUpdate({
      orderNumber: outcome.orderNumber,
      orderStatus: 'completed',
      paymentStatus: 'verified',
      productName: selected.productName,
      packageName: selected.packageName,
      playerUid,
      totalAmount: selected.price,
      paymentMethodName: outcome.methodName,
      trxId,
      customerUid: tgUid,
      chatId,
      businessConnectionId,
    });
    void notifyTelegramAdmins(
      getTelegramAdminDeps(),
      token,
      [
        `🤖 Telegram Auto-Order: ${outcome.orderNumber}`,
        `🎮 ${selected.productName} · ${selected.packageName}`,
        `🆔 UID: ${playerUid} | 💰 ৳${selected.price} (${outcome.methodName})`,
        `🔑 TrxID: ${trxId} | Status: Completed ✅`,
      ].join('\n'),
      {inline_keyboard: [[{text: `🔎 Inspect ${outcome.orderNumber}`, callback_data: makeAdminOrderCallback(outcome.orderId)}]]},
    );
    pushSessionHistory(
      session,
      'model',
      `Order ${outcome.orderNumber} completed for ${selected.packageName} (UID: ${playerUid}, TrxID: ${trxId}).`,
    );
    return true;
  } catch (err) {
    console.error('Telegram auto-order verification error:', err instanceof Error ? err.message : err);
    await sendTelegramReply(
      token,
      chatId,
      '⚠️ অর্ডার প্রসেস করার সময় সমস্যা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার TrxID পাঠান অথবা এডমিনের সাথে যোগাযোগ করুন।',
      businessConnectionId,
    );
    return false;
  }
}

interface GeminiAssistantDecision {
  reply: string;
  action:
    | 'NONE'
    | 'SHOW_LIST'
    | 'SELECT_PACKAGE'
    | 'SET_UID'
    | 'CHECK_TRXID'
    | 'CANCEL_ORDER'
    | 'REQUEST_AGENT';
  selectedOptionIndex?: number;
  extractedUid?: string;
  extractedTrxId?: string;
}

async function askGeminiAssistant(params: {
  rawText: string;
  customerName: string;
  session: BotSession;
  liveCtx: TelegramBotLiveContext;
}): Promise<GeminiAssistantDecision | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Telegram AI] GEMINI_API_KEY is not configured; using static menu fallback.');
    return null;
  }
  if (Date.now() < geminiQuotaCooldownUntil) {
    console.warn('[Telegram AI] Gemini 429 quota cooldown active; using static menu fallback.');
    return null;
  }

  const {rawText, customerName, session, liveCtx} = params;

  const packagesCatalogText =
    liveCtx.options.length > 0
      ? liveCtx.options
          .map(
            (o) =>
              `#${o.index} | Product: ${o.productName} | Package: ${o.packageName} (${o.quantityLabel}) | Price: ৳${o.price}` +
              (o.promoLabel ? ` | Tag: ${o.promoLabel}` : '') +
              (o.productInstructions ? ` | Instructions: ${o.productInstructions}` : ''),
          )
          .join('\n')
      : 'No active packages are currently listed in Firestore.';

  const paymentMethodsText = [
    liveCtx.bkashNumber ? `bKash (Send Money): ${liveCtx.bkashNumber}` : '',
    liveCtx.nagadNumber ? `Nagad (Send Money): ${liveCtx.nagadNumber}` : '',
    ...liveCtx.otherPaymentMethods
      .filter((m) => {
        const lower = m.name.toLowerCase();
        return !lower.includes('bkash') && !lower.includes('nagad');
      })
      .map((m) => `${m.name} (${m.accountType}): ${m.accountNumber}`),
  ]
    .filter(Boolean)
    .join('\n') || 'Payment numbers are being updated; direct customer to the website if needed.';

  const recentOrdersText =
    liveCtx.recentOrders.length > 0
      ? liveCtx.recentOrders
          .map(
            (o) =>
              `Order ${o.orderNumber}: ${o.productName} - ${o.packageName} | UID: ${o.playerUid} | ৳${o.totalAmount} | Payment: ${o.paymentStatus} | Status: ${o.orderStatus}` +
              (o.voucherCode ? ` | Code: ${o.voucherCode}` : '') +
              (o.adminNote ? ` | Note: ${o.adminNote}` : ''),
          )
          .join('\n')
      : 'This customer has no recent Telegram orders in Firestore yet.';

  const currentFlowText = [
    `Current step: ${session.step}`,
    session.selected
      ? `Selected package: #${session.selected.index} ${session.selected.productName} - ${session.selected.packageName} (৳${session.selected.price})`
      : 'Selected package: None',
    session.playerUid ? `Entered Player UID: ${session.playerUid}` : 'Entered Player UID: None',
  ].join('\n');

  const historyText =
    session.history.length > 0
      ? session.history.map((h) => `${h.role === 'user' ? 'Customer' : 'Assistant'}: ${h.text}`).join('\n')
      : 'No prior messages in this session.';

  const systemInstruction = `You are the official, polite, helpful Bengali AI customer support & auto-order assistant for "${liveCtx.brandName}" (Munaf Topup).

RULES & BEHAVIOR:
1. Language: Reply warmly and naturally in Bengali by default (or match Banglish/English if the customer writes primarily in Banglish or English). Keep responses concise, well-formatted, and friendly for Telegram chat.
2. Truthfulness: Answer questions using ONLY the LIVE WEBSITE DATA below. Never invent prices, packages, payment numbers, or order statuses that are not in the data.
3. Website Info:
   - Brand: ${liveCtx.brandName}
   - Website: ${liveCtx.websiteUrl}
   - Standard Delivery Time: Instant to 1-5 minutes after TrxID verification (automated SMS verification).
   ${liveCtx.noticeText ? `- Live Store Notice: ${liveCtx.noticeText}` : ''}
   ${liveCtx.supportInfo ? `- Support Contacts: ${liveCtx.supportInfo}` : ''}
4. Active Payment Numbers:
${paymentMethodsText}

5. Live Products & Packages (USE THESE EXACT NUMBERS AND PRICES):
${packagesCatalogText}

6. This Customer's Recent Orders (private to this customer):
${recentOrdersText}

7. Active Order Conversation State:
${currentFlowText}

8. ACTION ROUTING (CRITICAL — ALWAYS CHOOSE THE RIGHT ACTION):
- "SHOW_LIST": Customer asks for the price list, diamond list, rates, menu, or says they want to see packages / start an order without specifying a particular package yet. Include a clean numbered list of the live packages with ৳ prices in your reply.
- "SELECT_PACKAGE": Customer picks or clearly requests to buy a specific package (either by index like "1", "১", "#2", "দুই নম্বর" OR by package name like "115 diamond", "weekly", "monthly", "level up pass"). Set "selectedOptionIndex" to that exact integer #index from section 5. If the same message ALSO includes a 5-15 digit Player UID, put the English-digit UID in "extractedUid".
- "SET_UID": Customer is providing their 5-15 digit Game Player UID (convert Bengali digits ০-৯ to 0-9). Set "extractedUid" to the English digits only.
- "CHECK_TRXID": Current step is AWAITING_TRXID (or customer has selected a package and UID) and the customer sends a Transaction ID (TrxID / TxnID) to verify their payment. Put the uppercase TrxID in "extractedTrxId".
- "REQUEST_AGENT": Customer explicitly asks to speak with a human agent, admin, manager, or real person (e.g., "এজেন্ট", "agent", "admin", "কথা বলতে চাই"). Reply politely confirming that an admin has been notified.
- "CANCEL_ORDER": Customer wants to cancel, stop, or restart the current order.
- "NONE": Customer is asking a general question (prices of a single item without ordering, delivery time, UID instructions, payment method info, checking their recent order status, greeting, etc.). Keep the conversation smooth and helpful!`;

  const userPrompt = `Customer Name: ${customerName}
Recent Conversation:
${historyText}

Latest Customer Message:
${rawText}`;

  const modelsToTry = Array.from(new Set([GEMINI_BOT_MODEL, ...GEMINI_FALLBACK_MODELS]));

  const runAttempt = async (modelName: string, useThinkingLow: boolean) => {
    return Promise.race([
      ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          ...(useThinkingLow ? {thinkingConfig: {thinkingLevel: ThinkingLevel.LOW}} : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Helpful natural response for the customer in Bengali/Banglish/English.',
              },
              action: {
                type: Type.STRING,
                enum: [
                  'NONE',
                  'SHOW_LIST',
                  'SELECT_PACKAGE',
                  'SET_UID',
                  'CHECK_TRXID',
                  'CANCEL_ORDER',
                  'REQUEST_AGENT',
                ],
                description: 'Structured next state action for the order flow.',
              },
              selectedOptionIndex: {
                type: Type.INTEGER,
                description: '1-based index of the package selected from live products list.',
              },
              extractedUid: {
                type: Type.STRING,
                description: '5 to 15 digit Game Player UID normalized to English digits 0-9.',
              },
              extractedTrxId: {
                type: Type.STRING,
                description: 'Uppercase payment TrxID/TxnID provided by the customer.',
              },
            },
            required: ['reply', 'action'],
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini timeout after 8500ms (${modelName})`)), 8500),
      ),
    ]);
  };

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelName = modelsToTry[i];
    try {
      let response;
      try {
        response = await runAttempt(modelName, true);
      } catch (innerErr) {
        const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        if (/thinking/i.test(innerMsg) && !/\b(404|503)\b/i.test(innerMsg)) {
          response = await runAttempt(modelName, false);
        } else {
          throw innerErr;
        }
      }

      const jsonText = (response.text ?? '').trim();
      if (!jsonText) return null;
      const parsed = JSON.parse(jsonText) as GeminiAssistantDecision;
      if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
        return null;
      }
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errStatus =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as {status?: unknown}).status)
          : NaN;
      const isQuota429 =
        errStatus === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
      const isRetryableModelOrLoadError =
        isQuota429 ||
        errStatus === 404 ||
        errStatus === 503 ||
        /\b(404|503)\b|NOT_FOUND|UNAVAILABLE|is not found|high demand|overloaded|service unavailable|timeout/i.test(
          msg,
        );
      console.error(`Gemini bot assistant error (${modelName}):`, msg);
      if (isQuota429) {
        geminiQuotaCooldownUntil = Date.now() + 60 * 1000;
        console.warn(`[Telegram AI] Gemini 429 quota hit on "${modelName}"; falling back gracefully.`);
        return null;
      }
      if (isRetryableModelOrLoadError && i + 1 < modelsToTry.length) {
        const reasonTag = /timeout/i.test(msg)
          ? 'timeout'
          : errStatus === 503 || /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg)
            ? '503/high demand'
            : '404/not found';
        console.warn(
          `[Telegram AI] Model "${modelName}" failed (${reasonTag}); retrying with "${modelsToTry[i + 1]}".`,
        );
        continue;
      }
      return null;
    }
  }
  return null;
}

function getTelegramAdminDeps(): TelegramAdminDeps {
  return {
    adminDb,
    firebaseInitMode,
    websiteUrl: WEBSITE_URL,
    superAdminEmail: SUPER_ADMIN_EMAIL,
    callTelegramApi,
    sendTelegramReply,
    sendTelegramOrderStatusUpdate,
    sendCustomerOrderEmail,
    sendCustomerGenericEmail,
    sendAdminNotificationEmail,
    readStore,
    writeStore,
    appendServerLog,
    verifyPassword,
    timingSafeEqualsText,
    parseTimestampMillis: parseFirestoreTimestampMillis,
    invalidateBotStoreCache: () => {
      botSharedStoreCache = null;
    },
    runOrderExpiryNow: () => expireStalePendingOrders(true),
    getBotRuntimeStats: () => ({
      running: telegramBotState.running,
      username: telegramBotState.username,
      processedUpdates: telegramBotState.processedUpdates,
      lastPollAt: telegramBotState.lastPollAt,
      lastError: telegramBotState.lastError,
      expiryRunning: orderExpiryCronState.running,
      expiryLastCheckAt: orderExpiryCronState.lastCheckAt,
      expiryTotalExpired: orderExpiryCronState.totalExpired,
      expiryLastError: orderExpiryCronState.lastError,
    }),
  };
}

function getCommerceDeps(): CommerceDeps {
  return {
    adminDb,
    readStore,
    writeStore,
    appendServerLog,
    requireSignedInFirebase,
    requireAdmin,
    timingSafeEqualsText,
    markNotificationEventSent,
    sendAdminNotificationEmail,
    sendCustomerOrderEmail,
    sendCustomerGenericEmail,
    sendTelegramOrderStatusUpdate,
    notifyTelegramAdmins: (text, replyMarkup) => {
      const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
      if (!botToken) return Promise.resolve();
      return notifyTelegramAdmins(getTelegramAdminDeps(), botToken, text, replyMarkup);
    },
    makeAdminOrderCallback,
    websiteUrl: WEBSITE_URL,
  };
}

async function handleTelegramCustomerMessage(token: string, msg: TelegramMessage): Promise<void> {
  const rawText = (msg.text || msg.caption || '').trim();
  if (!rawText) return;

  cleanupExpiredBotSessions();

  const chatId = msg.chat.id;
  const businessConnectionId = msg.business_connection_id;

  // 0. Check Telegram Bot Admin Panel commands / active admin prompts (private DM only, never business chats)
  const handledByAdmin = await handleTelegramAdminCommand(
    getTelegramAdminDeps(),
    token,
    chatId,
    msg.from?.id,
    rawText,
    businessConnectionId,
  );
  if (handledByAdmin) return;

  const sessionKey = `${businessConnectionId || 'dm'}:${chatId}`;
  const customerName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() ||
    msg.from?.username ||
    `Telegram User ${chatId}`;
  const tgUid = `tg_${chatId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  void saveTelegramChatRoute(tgUid, chatId, businessConnectionId, customerName);

  const session = getOrCreateBotSession(sessionKey, customerName);
  pushSessionHistory(session, 'user', rawText);

  const normalizedText = normalizeBengaliDigits(rawText).trim();

  // 1. Deterministic Cancel / Reset (No Gemini)
  if (isCancelCommand(rawText)) {
    session.step = 'IDLE';
    session.selected = undefined;
    session.playerUid = undefined;
    botSessions.set(sessionKey, session);
    const cancelMsg =
      '✅ আপনার চলমান অর্ডার প্রক্রিয়া বাতিল করা হয়েছে।\n\nনতুন অর্ডার করতে প্যাকেজের নাম লিখুন অথবা "দাম কত" লিখে লিস্ট দেখুন।';
    pushSessionHistory(session, 'model', cancelMsg);
    await sendTelegramReply(
      token,
      chatId,
      cancelMsg,
      businessConnectionId,
      buildQuickReplyInlineKeyboard(),
    );
    return;
  }

  // 2. Deterministic Human Agent / Admin Escalation (No Gemini)
  if (isHumanAgentRequest(rawText)) {
    await escalateToHumanAgent({
      token,
      chatId,
      businessConnectionId,
      customerName,
      tgUid,
      rawText,
      session,
    });
    return;
  }

  // 3. Deterministic TrxID Payment Verification Step (No Gemini)
  if (session.step === 'AWAITING_TRXID' && session.selected && session.playerUid) {
    if (isRateListTrigger(rawText)) {
      const shared = await getBotSharedStoreSnapshot();
      session.selected = undefined;
      session.playerUid = undefined;
      if (shared.options.length > 0) {
        session.step = 'AWAITING_PACKAGE';
        session.options = shared.options;
        botSessions.set(sessionKey, session);
        const listText = formatFallbackRateList(shared.options, shared.brandName);
        pushSessionHistory(session, 'model', listText);
        await sendTelegramReply(token, chatId, listText, businessConnectionId);
      } else {
        session.step = 'IDLE';
        botSessions.set(sessionKey, session);
        await sendTelegramReply(
          token,
          chatId,
          `😔 দুঃখিত, ${shared.brandName}-এ এই মুহূর্তে কোনো অ্যাক্টিভ প্যাকেজ পাওয়া যায়নি। ওয়েবসাইট: ${WEBSITE_URL}`,
          businessConnectionId,
        );
      }
      return;
    }

    const extractedTrx = extractCustomerTrxId(rawText);
    if (extractedTrx) {
      await verifyAndCompleteTelegramOrder({
        token,
        chatId,
        businessConnectionId,
        sessionKey,
        session,
        selected: session.selected,
        playerUid: session.playerUid,
        rawTrxInput: extractedTrx,
        customerName,
      });
      return;
    }

    const trxHintReply = [
      '❌ সঠিক Transaction ID (TrxID) পাওয়া যায়নি।',
      '',
      `অনুগ্রহ করে ৳${session.selected.price} Send Money করে শুধুমাত্র আপনার TrxID (যেমন: 9B4X2K7M1P) অথবা সম্পূর্ণ পেমেন্ট SMS কপি করে পাঠান।`,
      '❌ অর্ডার বাতিল করতে "বাতিল" লিখুন।',
    ].join('\n');
    pushSessionHistory(session, 'model', trxHintReply);
    await sendTelegramReply(token, chatId, trxHintReply, businessConnectionId);
    return;
  }

  // 4. Deterministic Player UID Step (No Gemini)
  if (session.step === 'AWAITING_UID' && session.selected) {
    if (isRateListTrigger(rawText)) {
      const shared = await getBotSharedStoreSnapshot();
      session.selected = undefined;
      session.playerUid = undefined;
      if (shared.options.length > 0) {
        session.step = 'AWAITING_PACKAGE';
        session.options = shared.options;
        botSessions.set(sessionKey, session);
        const listText = formatFallbackRateList(shared.options, shared.brandName);
        pushSessionHistory(session, 'model', listText);
        await sendTelegramReply(token, chatId, listText, businessConnectionId);
      } else {
        session.step = 'IDLE';
        botSessions.set(sessionKey, session);
        await sendTelegramReply(
          token,
          chatId,
          `😔 দুঃখিত, ${shared.brandName}-এ এই মুহূর্তে কোনো অ্যাক্টিভ প্যাকেজ পাওয়া যায়নি। ওয়েবসাইট: ${WEBSITE_URL}`,
          businessConnectionId,
        );
      }
      return;
    }

    const uidClean = extractPlayerUidFromText(rawText);
    if (uidClean) {
      session.playerUid = uidClean;
      session.step = 'AWAITING_TRXID';
      botSessions.set(sessionKey, session);
      const {bkashNumber, nagadNumber} = await resolveBotPaymentNumbers();
      const summaryReply = formatPaymentSummaryPrompt(
        session.selected,
        uidClean,
        bkashNumber,
        nagadNumber,
      );
      pushSessionHistory(session, 'model', summaryReply);
      await sendTelegramReply(token, chatId, summaryReply, businessConnectionId);
      return;
    }

    const uidErrReply =
      '❌ ভুল Player UID! অনুগ্রহ করে শুধুমাত্র ৫ থেকে ১৫ ডিজিটের সঠিক গেম UID পাঠান (যেমন: 123456789)।\n❌ বাতিল করতে "বাতিল" লিখুন।';
    pushSessionHistory(session, 'model', uidErrReply);
    await sendTelegramReply(token, chatId, uidErrReply, businessConnectionId);
    return;
  }

  // 5. Deterministic Rate List / Menu Trigger (No Gemini)
  if (isRateListTrigger(rawText)) {
    const shared = await getBotSharedStoreSnapshot();
    if (shared.options.length === 0) {
      const noPkgMsg = `😔 দুঃখিত, ${shared.brandName}-এ এই মুহূর্তে কোনো অ্যাক্টিভ প্যাকেজ পাওয়া যায়নি। আমাদের ওয়েবসাইট ভিজিট করুন: ${WEBSITE_URL}`;
      pushSessionHistory(session, 'model', noPkgMsg);
      await sendTelegramReply(
        token,
        chatId,
        noPkgMsg,
        businessConnectionId,
        buildQuickReplyInlineKeyboard(),
      );
      return;
    }
    session.step = 'AWAITING_PACKAGE';
    session.options = shared.options;
    botSessions.set(sessionKey, session);
    const listText = formatFallbackRateList(shared.options, shared.brandName);
    pushSessionHistory(session, 'model', listText);
    await sendTelegramReply(
      token,
      chatId,
      listText,
      businessConnectionId,
      buildQuickReplyInlineKeyboard(),
    );
    return;
  }

  // 6. Deterministic Package Selection (in AWAITING_PACKAGE or IDLE — No Gemini)
  const cachedOrLiveOptions =
    session.options && session.options.length > 0 ? session.options : await fetchActiveRateOptions();
  if (cachedOrLiveOptions.length > 0) {
    session.options = cachedOrLiveOptions;
    const matchedPkg = matchDeterministicPackage(normalizedText, cachedOrLiveOptions);
    if (matchedPkg) {
      session.selected = matchedPkg;
      session.playerUid = undefined;
      session.step = 'AWAITING_UID';
      botSessions.set(sessionKey, session);
      const prompt = formatPackageSelectedPrompt(matchedPkg);
      pushSessionHistory(session, 'model', prompt);
      await sendTelegramReply(token, chatId, prompt, businessConnectionId);
      return;
    }

    const numberOnlyMatch = normalizedText.match(/^#?(\d{1,3})$/);
    if (numberOnlyMatch && session.step === 'AWAITING_PACKAGE') {
      const idx = Number.parseInt(numberOnlyMatch[1], 10);
      const errReply = `❌ ${idx} নম্বরে কোনো প্যাকেজ নেই। অনুগ্রহ করে ১ থেকে ${cachedOrLiveOptions.length} এর মধ্যে একটি নম্বর দিন অথবা "বাতিল" লিখুন।`;
      pushSessionHistory(session, 'model', errReply);
      await sendTelegramReply(token, chatId, errReply, businessConnectionId);
      return;
    }

    if (session.step === 'AWAITING_PACKAGE') {
      const pkgHintReply = `👉 অনুগ্রহ করে লিস্ট থেকে পছন্দের প্যাকেজের নম্বর (১ থেকে ${cachedOrLiveOptions.length}) অথবা প্যাকেজের নাম লিখুন।\n📋 আবার লিস্ট দেখতে "লিস্ট" এবং বাতিল করতে "বাতিল" লিখুন।`;
      pushSessionHistory(session, 'model', pkgHintReply);
      await sendTelegramReply(token, chatId, pkgHintReply, businessConnectionId);
      return;
    }
  }

  // 7. General Conversational Fallback -> Gemini API (Only in IDLE for general questions)
  void sendTelegramTyping(token, chatId, businessConnectionId);
  const liveCtx = await fetchTelegramBotLiveContext(tgUid);
  if (liveCtx.options.length > 0) {
    session.options = liveCtx.options;
  }

  let aiDecision: GeminiAssistantDecision | null = null;
  try {
    aiDecision = await askGeminiAssistant({
      rawText,
      customerName,
      session,
      liveCtx,
    });
  } catch (err) {
    console.error('[Telegram AI] Unexpected error; using static menu fallback:', err instanceof Error ? err.message : err);
    aiDecision = null;
  }

  if (aiDecision) {
    if (aiDecision.action === 'REQUEST_AGENT') {
      await escalateToHumanAgent({
        token,
        chatId,
        businessConnectionId,
        customerName,
        tgUid,
        rawText,
        session,
        customReply: aiDecision.reply,
      });
      return;
    }

    if (aiDecision.action === 'CANCEL_ORDER') {
      session.step = 'IDLE';
      session.selected = undefined;
      session.playerUid = undefined;
      botSessions.set(sessionKey, session);
      pushSessionHistory(session, 'model', aiDecision.reply);
      await sendTelegramReply(token, chatId, aiDecision.reply, businessConnectionId);
      return;
    }

    if (aiDecision.action === 'SHOW_LIST') {
      if (liveCtx.options.length > 0) {
        session.step = 'AWAITING_PACKAGE';
        session.options = liveCtx.options;
        botSessions.set(sessionKey, session);
      }
      pushSessionHistory(session, 'model', aiDecision.reply);
      await sendTelegramReply(token, chatId, aiDecision.reply, businessConnectionId);
      return;
    }

    if (aiDecision.action === 'SELECT_PACKAGE' && typeof aiDecision.selectedOptionIndex === 'number') {
      const selected = liveCtx.options.find((o) => o.index === aiDecision.selectedOptionIndex);
      if (selected) {
        session.selected = selected;
        session.options = liveCtx.options;
        const maybeUid = aiDecision.extractedUid
          ? normalizeBengaliDigits(aiDecision.extractedUid).replace(/\D/g, '')
          : '';
        if (/^\d{5,15}$/.test(maybeUid)) {
          session.playerUid = maybeUid;
          session.step = 'AWAITING_TRXID';
          botSessions.set(sessionKey, session);
          const summaryReply = formatPaymentSummaryPrompt(
            selected,
            maybeUid,
            liveCtx.bkashNumber,
            liveCtx.nagadNumber,
          );
          pushSessionHistory(session, 'model', summaryReply);
          await sendTelegramReply(token, chatId, summaryReply, businessConnectionId);
          return;
        }
        session.playerUid = undefined;
        session.step = 'AWAITING_UID';
        botSessions.set(sessionKey, session);
        const uidPrompt = formatPackageSelectedPrompt(selected);
        pushSessionHistory(session, 'model', uidPrompt);
        await sendTelegramReply(token, chatId, uidPrompt, businessConnectionId);
        return;
      }
    }

    botSessions.set(sessionKey, session);
    pushSessionHistory(session, 'model', aiDecision.reply);
    await sendTelegramReply(
      token,
      chatId,
      aiDecision.reply,
      businessConnectionId,
      buildQuickReplyInlineKeyboard(),
    );
    return;
  }

  // 8. Graceful Static Helpful Menu Fallback (if GEMINI_API_KEY unset, 429 quota error, or Gemini unreachable)
  const staticMenu = formatStaticHelpfulMenu(liveCtx);
  pushSessionHistory(session, 'model', staticMenu);
  await sendTelegramReply(
    token,
    chatId,
    staticMenu,
    businessConnectionId,
    buildQuickReplyInlineKeyboard(),
  );
}

async function handleTelegramCallbackQuery(
  token: string,
  cb: TelegramCallbackQuery,
): Promise<void> {
  // Always dismiss the Telegram loading spinner immediately
  await callTelegramApi(token, 'answerCallbackQuery', {callback_query_id: cb.id}, 8000).catch(() => null);

  const chatId = cb.message?.chat.id || cb.from.id;
  if (!Number.isSafeInteger(chatId) || chatId === 0) return;

  const businessConnectionId = cb.message?.business_connection_id;
  const sessionKey = `${businessConnectionId || 'dm'}:${chatId}`;
  const customerName =
    [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' ').trim() ||
    cb.from.username ||
    `Telegram User ${chatId}`;
  const tgUid = `tg_${chatId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  void saveTelegramChatRoute(tgUid, chatId, businessConnectionId, customerName);

  cleanupExpiredBotSessions();
  const data = (cb.data || '').trim();

  if (data.startsWith('adm:')) {
    const handled = await handleTelegramAdminCallback(
      getTelegramAdminDeps(),
      token,
      chatId,
      cb.from.id,
      cb.message?.message_id,
      data,
      businessConnectionId,
    );
    if (handled) return;
  }

  const session = getOrCreateBotSession(sessionKey, customerName);
  const quickReplies = readStore().systemSettings.telegramQuickReplies || [];
  const presetId = data.startsWith('qr:') ? data.slice(3) : data;
  const preset = quickReplies.find((p) => p.id === presetId && p.active);

  if (!preset) {
    const liveCtx = await fetchTelegramBotLiveContext(tgUid);
    const fallback = formatStaticHelpfulMenu(liveCtx);
    await sendTelegramReply(
      token,
      chatId,
      fallback,
      businessConnectionId,
      buildQuickReplyInlineKeyboard(),
    );
    return;
  }

  pushSessionHistory(session, 'user', `[Quick Button: ${preset.label}]`);

  if (preset.action === 'show_list') {
    const shared = await getBotSharedStoreSnapshot();
    if (shared.options.length > 0) {
      session.step = 'AWAITING_PACKAGE';
      session.options = shared.options;
      botSessions.set(sessionKey, session);
      const listText = formatFallbackRateList(shared.options, shared.brandName);
      pushSessionHistory(session, 'model', listText);
      await sendTelegramReply(
        token,
        chatId,
        listText,
        businessConnectionId,
        buildQuickReplyInlineKeyboard(),
      );
    } else {
      const noPkgMsg = `😔 দুঃখিত, ${shared.brandName}-এ এই মুহূর্তে কোনো অ্যাক্টিভ প্যাকেজ পাওয়া যায়নি। ওয়েবসাইট: ${WEBSITE_URL}`;
      await sendTelegramReply(
        token,
        chatId,
        noPkgMsg,
        businessConnectionId,
        buildQuickReplyInlineKeyboard(),
      );
    }
    return;
  }

  if (preset.action === 'order_status') {
    const liveCtx = await fetchTelegramBotLiveContext(tgUid);
    const lines: string[] = [];
    if (liveCtx.recentOrders.length === 0) {
      lines.push('🧾 আপনার সাম্প্রতিক কোনো টেলিগ্রাম অর্ডার পাওয়া যায়নি।');
      lines.push('');
      lines.push('নতুন অর্ডার করতে "লিস্ট" লিখুন অথবা নিচের Rate List বাটনে ক্লিক করুন।');
    } else {
      lines.push('🧾 আপনার সাম্প্রতিক অর্ডারসমূহ:');
      lines.push('');
      for (const o of liveCtx.recentOrders) {
        lines.push(
          `• ${o.orderNumber} — ${o.productName} (${o.packageName}) | ৳${o.totalAmount} | UID: ${o.playerUid} | স্ট্যাটাস: ${o.orderStatus}`,
        );
        if (o.voucherCode) lines.push(`  🔑 কোড: ${o.voucherCode}`);
      }
    }
    const statusMsg = lines.join('\n');
    pushSessionHistory(session, 'model', statusMsg);
    await sendTelegramReply(
      token,
      chatId,
      statusMsg,
      businessConnectionId,
      buildQuickReplyInlineKeyboard(),
    );
    return;
  }

  if (preset.action === 'request_agent') {
    await escalateToHumanAgent({
      token,
      chatId,
      businessConnectionId,
      customerName,
      tgUid,
      rawText: `[Quick Reply Button] ${preset.label}`,
      session,
      customReply: preset.replyText.trim() || undefined,
    });
    return;
  }

  const replyText = preset.replyText.trim() || preset.label;
  pushSessionHistory(session, 'model', replyText);
  await sendTelegramReply(
    token,
    chatId,
    replyText,
    businessConnectionId,
    buildQuickReplyInlineKeyboard(),
  );
}

const ADMIN_SMS_FORWARDER_CHAT_ID = Number(process.env.SMS_FORWARDER_CHAT_ID || 8139244263);

async function handleAdminSmsForwarderMessage(token: string, msg: TelegramMessage): Promise<void> {
  const fullText = (msg.text || msg.caption || '').trim();
  const {smsBody, hintSender} = extractSmsPayloadFromForwarderMessage(fullText);

  try {
    const result = await recordSmsPaymentInFirestore({
      rawText: smsBody,
      hintSender,
      source: 'telegram_forwarder',
    });

    if (!result.ok) {
      console.warn(`[Telegram SMS Forwarder] Could not parse SMS from chat ${msg.chat.id}: ${result.error}`);
      await sendTelegramReply(
        token,
        msg.chat.id,
        `⚠️ SMS পার্স করা যায়নি: ${result.error}`,
      ).catch(() => null);
      return;
    }

    const statusLine = result.reconciled?.matched
      ? result.reconciled.matchedType === 'order'
        ? `⚡ Auto-Verified Order ${result.reconciled.orderNumber} (${result.reconciled.orderStatus?.toUpperCase()})`
        : `⚡ Auto-Approved Wallet Deposit ৳${result.reconciled.amount} (${result.reconciled.topupId})`
      : result.duplicate
        ? `ℹ️ Duplicate SMS (already recorded, used=${result.used})`
        : '✅ SMS Payment Saved (Unused)';
    await sendTelegramReply(
      token,
      msg.chat.id,
      `${statusLine}\n💳 ${result.parsed.method} · ৳${result.parsed.amount}\n🔑 TrxID: ${result.parsed.trxId}`,
    ).catch(() => null);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Telegram SMS Forwarder] Firestore error:', errMsg);
    await sendTelegramReply(
      token,
      msg.chat.id,
      `❌ SMS পেমেন্ট সেভ ব্যর্থ হয়েছে: ${errMsg}`,
    ).catch(() => null);
  }
}

function startTelegramBusinessBot(): void {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    telegramBotState.running = false;
    return;
  }

  telegramBotState.running = true;
  let offset = 0;
  const chatQueues = new Map<string, Promise<void>>();

  const enqueueChatWork = (queueKey: string, task: () => Promise<void>) => {
    const prev = chatQueues.get(queueKey) || Promise.resolve();
    const next = prev
      .then(task)
      .catch((err) => {
        console.error(`[Telegram Bot] Handler error (${queueKey}):`, err instanceof Error ? err.message : err);
      })
      .finally(() => {
        if (chatQueues.get(queueKey) === next) {
          chatQueues.delete(queueKey);
        }
      });
    chatQueues.set(queueKey, next);
  };

  const runLoop = async () => {
    try {
      // Ensure polling mode is unobstructed (24/7 getUpdates reliability)
      await callTelegramApi(token, 'deleteWebhook', {drop_pending_updates: false}, 15000).catch(() => null);
      const me = await callTelegramApi<{id: number; username?: string}>(token, 'getMe', undefined, 15000);
      telegramBotState.username = me.username || '';
      console.log(`Telegram Business Bot 24/7 active (@${telegramBotState.username || 'bot'})`);
      await callTelegramApi(
        token,
        'setMyCommands',
        {
          commands: [
            {command: 'start', description: 'স্টার্ট মেনু ও ডায়মন্ড রেট লিস্ট'},
            {command: 'menu', description: 'সকল প্যাকেজ দেখুন'},
            {command: 'cancel', description: 'চলমান অর্ডার বাতিল করুন'},
            {command: 'admin', description: 'Telegram Admin Panel খুলুন'},
            {command: 'myid', description: 'আপনার Telegram Chat ID দেখুন'},
          ],
        },
        10000,
      ).catch(() => null);
    } catch (err) {
      telegramBotState.lastError = err instanceof Error ? err.message : String(err);
      console.error('Telegram Bot getMe failed:', telegramBotState.lastError);
    }

    let backoffMs = 2000;
    while (telegramBotState.running) {
      try {
        const updates = await callTelegramApi<TelegramUpdate[]>(
          token,
          'getUpdates',
          {
            offset,
            timeout: 25,
            allowed_updates: ['business_message', 'message', 'callback_query'],
          },
          35000,
        );
        telegramBotState.lastPollAt = new Date().toISOString();
        telegramBotState.lastError = '';
        backoffMs = 2000;

        for (const upd of updates) {
          offset = Math.max(offset, upd.update_id + 1);
          if (upd.callback_query && !upd.callback_query.from?.is_bot) {
            const cb = upd.callback_query;
            const cbChatId = cb.message?.chat.id || cb.from.id;
            const cbConn = cb.message?.business_connection_id || 'dm';
            telegramBotState.processedUpdates += 1;
            enqueueChatWork(`cb:${cbConn}:${cbChatId}`, () => handleTelegramCallbackQuery(token, cb));
            continue;
          }

          const msg = upd.business_message || upd.message;
          const msgText = (msg?.text || msg?.caption || '').trim();
          if (!msg || !msgText) continue;
          if (msg.from?.is_bot) continue;

          // Intercept Admin SMS Forwarder messages containing TrxID / TxnId (Chat ID 8139244263) — NEVER calls Gemini
          const isFromSmsForwarder =
            !msg.business_connection_id &&
            (msg.chat.id === ADMIN_SMS_FORWARDER_CHAT_ID || msg.from?.id === ADMIN_SMS_FORWARDER_CHAT_ID);
          if (isFromSmsForwarder && /(?:trx\s*id|txnid|txn\s*id|transaction\s*id)/i.test(msgText)) {
            telegramBotState.processedUpdates += 1;
            enqueueChatWork(`sms:${msg.chat.id}`, () => handleAdminSmsForwarderMessage(token, msg));
            continue;
          }

          // In Telegram Business chats, only respond to incoming customer messages (not business owner's own replies)
          if (msg.business_connection_id && msg.from?.id && msg.from.id !== msg.chat.id) {
            continue;
          }
          telegramBotState.processedUpdates += 1;
          const queueKey = `${msg.business_connection_id || 'dm'}:${msg.chat.id}`;
          enqueueChatWork(queueKey, () => handleTelegramCustomerMessage(token, msg));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const statusCode = (err as {statusCode?: number}).statusCode;
        telegramBotState.lastError = msg;
        if (statusCode === 409) {
          // Another instance is polling during deploy overlap; wait cleanly
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 15000);
        }
      }
    }
  };

  void runLoop();

  // Optional 24/7 production keep-alive self-ping (when running on Render or explicit SELF_PING_URL)
  const keepAliveBaseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL || '').trim();
  if (process.env.NODE_ENV === 'production' && keepAliveBaseUrl) {
    const cleanUrl = keepAliveBaseUrl.replace(/\/$/, '');
    setInterval(() => {
      fetch(`${cleanUrl}/api/health`).catch(() => null);
    }, 10 * 60 * 1000).unref();
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({limit: '2mb'}));

  // Serve uploaded files safely
  app.use('/uploads', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  }, express.static(UPLOADS_DIR));

  // Health endpoint (also used for 24/7 uptime monitoring)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      botRunning: telegramBotState.running,
      lastPollAt: telegramBotState.lastPollAt || null,
    });
  });

  // Customer / Admin file upload
  app.post('/api/upload', requireSignedInFirebase, upload.single('image'), (req, res) => {
    if (!req.file) {
      res.status(400).json({error: 'No image file provided'});
      return;
    }
    try {
      const url = saveUploadedFile(req.file);
      res.json({url});
    } catch (err) {
      res.status(400).json({error: err instanceof Error ? err.message : 'Upload failed'});
    }
  });

  // Admin-specific upload endpoint (products, banners, logo, favicon)
  app.post('/api/admin/upload', requireAdmin(), upload.single('image'), (req: AuthedRequest, res) => {
    if (!req.file) {
      res.status(400).json({error: 'No image file provided'});
      return;
    }
    const perm = req.adminSession!.permissions;
    if (req.adminSession!.role !== 'super_admin' && !perm.products && !perm.customization && !perm.payments) {
      res.status(403).json({error: 'Insufficient permissions to upload assets'});
      return;
    }
    try {
      const url = saveUploadedFile(req.file);
      res.json({url});
    } catch (err) {
      res.status(400).json({error: err instanceof Error ? err.message : 'Upload failed'});
    }
  });

  // Admin auth status
  app.get('/api/admin/auth/status', (_req, res) => {
    const store = readStore();
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    res.json({
      claimed: Boolean(store.primaryPasswordHash),
      hasEnvPasscode: Boolean(envPasscode),
      superAdminEmail: SUPER_ADMIN_EMAIL,
    });
  });

  // First-run primary admin password claim
  app.post('/api/admin/auth/claim', (req, res) => {
    const store = readStore();
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    if (envPasscode || store.primaryPasswordHash) {
      res.status(409).json({error: 'Primary admin password is already configured'});
      return;
    }
    const {email, password, name} = req.body as {email?: string; password?: string; name?: string};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (normalizedEmail !== SUPER_ADMIN_EMAIL) {
      res.status(403).json({error: `Initial setup must use the primary owner email (${SUPER_ADMIN_EMAIL})`});
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({error: 'Password must be at least 8 characters'});
      return;
    }
    const adminName = (name || 'Primary Administrator').trim().slice(0, 80) || 'Primary Administrator';
    store.primaryAdminName = adminName;
    store.primaryPasswordHash = hashPassword(password);
    store.staff[SUPER_ADMIN_EMAIL] = {
      email: SUPER_ADMIN_EMAIL,
      name: adminName,
      role: 'super_admin',
      active: true,
      permissions: {...FULL_PERMISSIONS},
      createdAt: store.staff[SUPER_ADMIN_EMAIL]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appendServerLog(store, SUPER_ADMIN_EMAIL, 'ADMIN_PASSWORD_CLAIMED', 'Initial primary admin password configured');
    writeStore(store);

    const token = signSessionToken({
      email: SUPER_ADMIN_EMAIL,
      name: adminName,
      role: 'super_admin',
      permissions: {...FULL_PERMISSIONS},
    });
    res.json({
      token,
      admin: {
        email: SUPER_ADMIN_EMAIL,
        name: adminName,
        role: 'super_admin',
        permissions: {...FULL_PERMISSIONS},
      },
    });
  });

  // Admin / Sub-Admin Email + Password Login
  app.post('/api/admin/auth/login', (req, res) => {
    const {email, password} = req.body as {email?: string; password?: string};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !password || typeof password !== 'string') {
      res.status(400).json({error: 'Email and password are required'});
      return;
    }

    const store = readStore();
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();

    if (normalizedEmail === SUPER_ADMIN_EMAIL) {
      let valid = false;
      if (envPasscode) {
        const a = Buffer.from(password);
        const b = Buffer.from(envPasscode);
        valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      } else if (store.primaryPasswordHash) {
        valid = verifyPassword(password, store.primaryPasswordHash);
      } else {
        res.status(400).json({error: 'Primary admin password not claimed yet. Use Initial Setup or Google Sign-In.'});
        return;
      }

      if (!valid) {
        res.status(401).json({error: 'Invalid admin credentials'});
        return;
      }

      appendServerLog(store, SUPER_ADMIN_EMAIL, 'ADMIN_LOGIN_PASSWORD', 'Super admin signed in with password');
      writeStore(store);

      const token = signSessionToken({
        email: SUPER_ADMIN_EMAIL,
        name: store.primaryAdminName || 'Primary Administrator',
        role: 'super_admin',
        permissions: {...FULL_PERMISSIONS},
      });
      res.json({
        token,
        admin: {
          email: SUPER_ADMIN_EMAIL,
          name: store.primaryAdminName || 'Primary Administrator',
          role: 'super_admin',
          permissions: {...FULL_PERMISSIONS},
        },
      });
      return;
    }

    const staffMember = store.staff[normalizedEmail];
    if (!staffMember || !staffMember.active || !staffMember.passwordHash) {
      res.status(401).json({error: 'Invalid sub-admin credentials or inactive account'});
      return;
    }
    if (!verifyPassword(password, staffMember.passwordHash)) {
      res.status(401).json({error: 'Invalid sub-admin credentials'});
      return;
    }

    appendServerLog(store, normalizedEmail, 'SUBADMIN_LOGIN_PASSWORD', `${staffMember.role} signed in with password`);
    writeStore(store);

    const token = signSessionToken({
      email: normalizedEmail,
      name: staffMember.name,
      role: staffMember.role,
      permissions: staffMember.permissions,
    });
    res.json({
      token,
      admin: {
        email: normalizedEmail,
        name: staffMember.name,
        role: staffMember.role,
        permissions: staffMember.permissions,
      },
    });
  });

  // Firebase Google ID Token exchange for Server Admin Session
  app.post('/api/admin/auth/firebase', async (req, res) => {
    const {idToken} = req.body as {idToken?: string};
    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({error: 'Missing Firebase ID token'});
      return;
    }
    if (!firebaseProjectId) {
      res.status(503).json({error: 'Firebase project not configured'});
      return;
    }
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      if (!decoded.email || !decoded.email_verified) {
        res.status(403).json({error: 'Verified email required for admin access'});
        return;
      }
      const email = decoded.email.toLowerCase();
      const store = readStore();

      if (email === SUPER_ADMIN_EMAIL) {
        const name = store.primaryAdminName || decoded.name || 'Primary Administrator';
        appendServerLog(store, email, 'ADMIN_LOGIN_GOOGLE', 'Super admin authenticated via Google');
        writeStore(store);
        const token = signSessionToken({
          email,
          name,
          role: 'super_admin',
          permissions: {...FULL_PERMISSIONS},
        });
        res.json({
          token,
          admin: {email, name, role: 'super_admin', permissions: {...FULL_PERMISSIONS}},
        });
        return;
      }

      const staffMember = store.staff[email];
      if (!staffMember || !staffMember.active) {
        res.status(403).json({error: 'This Google account is not authorized as Admin or Sub-Admin'});
        return;
      }
      appendServerLog(store, email, 'SUBADMIN_LOGIN_GOOGLE', `${staffMember.role} authenticated via Google`);
      writeStore(store);
      const token = signSessionToken({
        email,
        name: staffMember.name,
        role: staffMember.role,
        permissions: staffMember.permissions,
      });
      res.json({
        token,
        admin: {
          email,
          name: staffMember.name,
          role: staffMember.role,
          permissions: staffMember.permissions,
        },
      });
    } catch {
      res.status(401).json({error: 'Invalid or expired Firebase token'});
    }
  });

  // Current Admin Profile
  app.get('/api/admin/auth/me', requireAdmin(), (req: AuthedRequest, res) => {
    res.json({admin: req.adminSession});
  });

  // Admin Profile & Password Update
  app.post('/api/admin/auth/change-password', requireAdmin(), (req: AuthedRequest, res) => {
    const {name, currentPassword, newPassword} = req.body as {
      name?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    const store = readStore();
    const email = req.adminSession!.email.toLowerCase();

    if (newPassword) {
      if (typeof newPassword !== 'string' || newPassword.length < 8) {
        res.status(400).json({error: 'New password must be at least 8 characters'});
        return;
      }
      if (email === SUPER_ADMIN_EMAIL) {
        if (store.primaryPasswordHash) {
          if (!currentPassword || !verifyPassword(currentPassword, store.primaryPasswordHash)) {
            res.status(400).json({error: 'Current password is incorrect'});
            return;
          }
        }
        store.primaryPasswordHash = hashPassword(newPassword);
      } else {
        const staffMember = store.staff[email];
        if (!staffMember) {
          res.status(404).json({error: 'Staff profile not found'});
          return;
        }
        if (staffMember.passwordHash && (!currentPassword || !verifyPassword(currentPassword, staffMember.passwordHash))) {
          res.status(400).json({error: 'Current password is incorrect'});
          return;
        }
        staffMember.passwordHash = hashPassword(newPassword);
        staffMember.updatedAt = new Date().toISOString();
      }
    }

    if (name && typeof name === 'string' && name.trim()) {
      const cleanName = name.trim().slice(0, 80);
      if (email === SUPER_ADMIN_EMAIL) {
        store.primaryAdminName = cleanName;
      }
      if (store.staff[email]) {
        store.staff[email].name = cleanName;
        store.staff[email].updatedAt = new Date().toISOString();
      }
    }

    appendServerLog(store, email, 'ADMIN_PROFILE_UPDATED', 'Updated admin profile/password');
    writeStore(store);
    res.json({ok: true});
  });

  // Sub-Admin Staff Management (Server-Enforced)
  app.get('/api/admin/staff', requireAdmin('settings'), (_req, res) => {
    const store = readStore();
    const list = Object.values(store.staff).map((s) => ({
      email: s.email,
      name: s.name,
      role: s.role,
      active: s.active,
      permissions: s.permissions,
      hasPassword: Boolean(s.passwordHash),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    res.json({staff: list});
  });

  app.post('/api/admin/staff', requireAdmin('settings'), (req: AuthedRequest, res) => {
    if (req.adminSession!.role !== 'super_admin') {
      res.status(403).json({error: 'Only Super Admin can add or modify staff accounts'});
      return;
    }
    const {email, name, role, active, permissions, password} = req.body as {
      email?: string;
      name?: string;
      role?: 'admin' | 'sub_admin';
      active?: boolean;
      permissions?: StaffPermissions;
      password?: string;
    };
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@') || normalizedEmail === SUPER_ADMIN_EMAIL) {
      res.status(400).json({error: 'Provide a valid sub-admin email address'});
      return;
    }
    if (!name || !name.trim()) {
      res.status(400).json({error: 'Staff name is required'});
      return;
    }
    if (password && password.length < 8) {
      res.status(400).json({error: 'Sub-admin password must be at least 8 characters'});
      return;
    }

    const store = readStore();
    const existing = store.staff[normalizedEmail];
    const now = new Date().toISOString();
    const sanitizedPerms: StaffPermissions = {
      products: Boolean(permissions?.products),
      orders: Boolean(permissions?.orders),
      payments: Boolean(permissions?.payments),
      customers: Boolean(permissions?.customers),
      customization: Boolean(permissions?.customization),
      settings: Boolean(permissions?.settings),
    };

    store.staff[normalizedEmail] = {
      email: normalizedEmail,
      name: name.trim().slice(0, 80),
      role: role === 'admin' ? 'admin' : 'sub_admin',
      active: active !== false,
      permissions: sanitizedPerms,
      passwordHash: password ? hashPassword(password) : existing?.passwordHash,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    appendServerLog(store, req.adminSession!.email, 'STAFF_UPSERT', `Updated staff permissions for ${normalizedEmail}`);
    writeStore(store);

    res.json({
      staff: {
        email: store.staff[normalizedEmail].email,
        name: store.staff[normalizedEmail].name,
        role: store.staff[normalizedEmail].role,
        active: store.staff[normalizedEmail].active,
        permissions: store.staff[normalizedEmail].permissions,
        hasPassword: Boolean(store.staff[normalizedEmail].passwordHash),
      },
    });
  });

  app.delete('/api/admin/staff/:email', requireAdmin('settings'), (req: AuthedRequest, res) => {
    if (req.adminSession!.role !== 'super_admin') {
      res.status(403).json({error: 'Only Super Admin can remove staff accounts'});
      return;
    }
    const targetEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
    if (targetEmail === SUPER_ADMIN_EMAIL) {
      res.status(400).json({error: 'Cannot delete primary Super Admin'});
      return;
    }
    const store = readStore();
    if (!store.staff[targetEmail]) {
      res.status(404).json({error: 'Staff account not found'});
      return;
    }
    delete store.staff[targetEmail];
    appendServerLog(store, req.adminSession!.email, 'STAFF_DELETE', `Removed staff member ${targetEmail}`);
    writeStore(store);
    res.json({ok: true});
  });

  // Customer -> Admin & Customer email notification endpoints (Orders, Support Complaints, Deposits)
  const handleAdminNotifyRequest = async (req: AuthedRequest, res: Response): Promise<void> => {
    const {type, details} = req.body as {
      type?: 'order' | 'ticket' | 'deposit';
      details?: Record<string, unknown>;
    };

    if (!type || !['order', 'ticket', 'deposit'].includes(type) || !details || typeof details !== 'object') {
      res.status(400).json({error: 'Invalid notification payload'});
      return;
    }

    const safeStr = (val: unknown, max = 400) => String(val ?? '').trim().slice(0, max);
    const timestamp = new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'});

    let subject = 'New Store Notification';
    let rows: Array<{label: string; value: string}> = [];
    let eventKey = '';
    let telegramAdminAlertText = '';

    if (type === 'order') {
      const orderNumber = safeStr(details.orderNumber, 40);
      eventKey = orderNumber ? `order:${orderNumber}` : '';
      subject = `New Order ${orderNumber || ''} — ${safeStr(details.productName, 80)}`;
      rows = [
        {label: 'Order Number', value: orderNumber || '—'},
        {label: 'Product', value: safeStr(details.productName, 120) || '—'},
        {label: 'Package', value: safeStr(details.packageName, 120) || '—'},
        {label: 'Amount', value: safeStr(details.amount, 40) || '—'},
        {label: 'Player UID', value: safeStr(details.playerUid, 80) || '—'},
        {label: 'Server ID', value: safeStr(details.serverId, 80) || 'N/A'},
        {label: 'Payment Method', value: safeStr(details.paymentMethod, 60) || '—'},
        {label: 'TrxID', value: safeStr(details.trxId, 64) || '—'},
        {label: 'Customer Name', value: safeStr(details.customerName, 100) || '—'},
        {label: 'Customer Email', value: safeStr(details.customerEmail, 160) || '—'},
        {label: 'Customer Phone', value: safeStr(details.customerPhone, 30) || '—'},
        {label: 'Time (BD)', value: timestamp},
      ];
      telegramAdminAlertText = [
        `🛒 New Website Order: ${orderNumber || '—'}`,
        `🎮 ${safeStr(details.productName, 120)} · ${safeStr(details.packageName, 120)}`,
        `🆔 UID: ${safeStr(details.playerUid, 80) || '—'} | 💰 ${safeStr(details.amount, 40)}`,
        `💳 ${safeStr(details.paymentMethod, 60)} | TrxID: ${safeStr(details.trxId, 64)}`,
        `👤 ${safeStr(details.customerName, 100)} (${req.firebaseAuthEmail || safeStr(details.customerEmail, 160) || '—'})`,
      ].join('\n');
    } else if (type === 'ticket') {
      const ticketId = safeStr(details.ticketId, 60);
      eventKey = ticketId ? `ticket:${ticketId}` : '';
      const subjectLine = safeStr(details.subject, 140);
      subject = `Customer Complaint / Support: ${subjectLine || 'New Ticket'}`;
      rows = [
        {label: 'Ticket ID', value: ticketId || '—'},
        {label: 'Order Number', value: safeStr(details.orderNumber, 40) || 'Not specified'},
        {label: 'Subject', value: subjectLine || '—'},
        {label: 'Complaint / Message', value: safeStr(details.message, 1500) || '—'},
        {label: 'Customer Name', value: safeStr(details.customerName, 100) || '—'},
        {label: 'Customer Email', value: safeStr(details.customerEmail, 160) || '—'},
        {label: 'Time (BD)', value: timestamp},
      ];
      telegramAdminAlertText = [
        `🎫 New Support Ticket`,
        `📌 Subject: ${subjectLine || '—'}`,
        `👤 ${safeStr(details.customerName, 100)} (${safeStr(details.customerEmail, 160)})`,
        `💬 ${safeStr(details.message, 250)}`,
      ].join('\n');
    } else {
      const amount = safeStr(details.amount, 40);
      const trxId = safeStr(details.trxId, 64);
      eventKey = trxId ? `deposit:${trxId}` : '';
      subject = `New Wallet Deposit Request (${amount})`;
      rows = [
        {label: 'Deposit Amount', value: amount || '—'},
        {label: 'Payment Method', value: safeStr(details.paymentMethod, 60) || '—'},
        {label: 'TrxID', value: trxId || '—'},
        {label: 'Customer Name', value: safeStr(details.customerName, 100) || '—'},
        {label: 'Customer Email', value: safeStr(details.customerEmail, 160) || '—'},
        {label: 'Time (BD)', value: timestamp},
      ];
      telegramAdminAlertText = [
        `💰 New Wallet Deposit: ${amount}`,
        `💳 ${safeStr(details.paymentMethod, 60)} | TrxID: ${trxId}`,
        `👤 ${safeStr(details.customerName, 100)} (${safeStr(details.customerEmail, 160)})`,
      ].join('\n');
    }

    if (eventKey && !markNotificationEventSent(eventKey)) {
      res.json({ok: true, sent: true, deduplicated: true});
      return;
    }

    const result = await sendAdminNotificationEmail(
      subject,
      rows,
      req.firebaseAuthEmail || safeStr(details.customerEmail, 160) || 'customer',
    );

    // Send order confirmation email to the authenticated customer's verified email
    let customerEmailResult: {sent: boolean; skipped?: boolean; reason?: string} = {
      sent: false,
      skipped: true,
    };
    if (type === 'order') {
      const orderNumber = safeStr(details.orderNumber, 40);
      const verifiedRecipient = req.adminSession
        ? isValidEmailAddress(safeStr(details.customerEmail, 160))
        : isValidEmailAddress(req.firebaseAuthEmail);
      const paymentMethodStr = safeStr(details.paymentMethod, 60);
      const isWalletPaid = paymentMethodStr.toLowerCase().includes('wallet');
      if (
        verifiedRecipient &&
        orderNumber &&
        markNotificationEventSent(`cust_order:${orderNumber}:pending`)
      ) {
        customerEmailResult = await sendCustomerOrderEmail({
          toEmail: verifiedRecipient,
          customerName: safeStr(details.customerName, 100),
          orderNumber,
          orderStatus: 'pending',
          paymentStatus: isWalletPaid ? 'verified' : 'pending',
          productName: safeStr(details.productName, 120) || 'Top-up',
          packageName: safeStr(details.packageName, 120) || 'Package',
          playerUid: safeStr(details.playerUid, 80),
          serverId: safeStr(details.serverId, 80),
          totalAmount: safeStr(details.amount, 40),
          paymentMethodName: paymentMethodStr,
          trxId: safeStr(details.trxId, 64),
          note: isWalletPaid
            ? 'Paid via Wallet Balance. Queued for instant top-up delivery.'
            : 'Order received. Awaiting payment verification.',
          isNewOrder: true,
        });
      }
    }

    const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (botToken && telegramAdminAlertText) {
      const replyMarkup =
        type === 'order' && details.orderId
          ? {
              inline_keyboard: [
                [{text: `🔎 Inspect ${safeStr(details.orderNumber, 32)}`, callback_data: makeAdminOrderCallback(safeStr(details.orderId, 64))}],
              ],
            }
          : {inline_keyboard: [[{text: '🛡️ Open Admin Panel', callback_data: 'adm:home'}]]};
      void notifyTelegramAdmins(getTelegramAdminDeps(), botToken, telegramAdminAlertText, replyMarkup);
    }

    res.json({ok: true, ...result, customerEmailSent: customerEmailResult.sent});
  };

  app.post('/api/notify/admin', requireSignedInFirebase, handleAdminNotifyRequest);
  app.post('/api/notify-admin', requireSignedInFirebase, handleAdminNotifyRequest);

  // SMTP & Authorized Distributor API Settings (Server-Only Secrets)
  app.get('/api/admin/system-settings', requireAdmin('settings'), (_req, res) => {
    const store = readStore();
    const s = store.systemSettings;
    const cfg = resolveSmtpConfig(store);
    res.json({
      settings: {
        smtpHost: s.smtpHost || cfg.host,
        smtpPort: s.smtpPort || cfg.port,
        smtpUser: s.smtpUser || (cfg.user ? '(Configured via ENV)' : ''),
        hasSmtpPassword: Boolean(cfg.pass),
        smtpFromEmail: s.smtpFromEmail,
        notificationEmail: s.notificationEmail || cfg.toEmail || DEFAULT_NOTIFICATION_EMAIL,
        smtpEnabled: s.smtpEnabled || cfg.envConfigured,
        customerEmailNotificationsEnabled: s.customerEmailNotificationsEnabled !== false,
        distributorBaseUrl: s.distributorBaseUrl,
        distributorMerchantId: s.distributorMerchantId,
        hasDistributorApiKey: Boolean(s.distributorApiKey),
        distributorEnabled: s.distributorEnabled,
        telegramQuickRepliesEnabled: s.telegramQuickRepliesEnabled !== false,
        telegramQuickReplies: Array.isArray(s.telegramQuickReplies)
          ? s.telegramQuickReplies
          : DEFAULT_TELEGRAM_QUICK_REPLIES,
        telegramAdminChatIds: Array.isArray(s.telegramAdminChatIds) ? s.telegramAdminChatIds : [],
        telegramAdminOrderAlerts: s.telegramAdminOrderAlerts !== false,
        updatedAt: s.updatedAt,
      },
    });
  });

  app.put('/api/admin/system-settings', requireAdmin('settings'), (req: AuthedRequest, res) => {
    const body = req.body as Partial<SystemSettingsStore> & {telegramAdminChatIds?: string[] | string};
    const store = readStore();
    const prev = store.systemSettings;

    // Validate URL if provided
    let cleanDistUrl = (body.distributorBaseUrl ?? prev.distributorBaseUrl).trim();
    if (cleanDistUrl) {
      try {
        const parsed = new URL(cleanDistUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          res.status(400).json({error: 'Distributor API URL must use http or https'});
          return;
        }
        cleanDistUrl = parsed.toString().replace(/\/$/, '');
      } catch {
        res.status(400).json({error: 'Invalid Distributor API Base URL'});
        return;
      }
    }

    const cleanNotifEmail = String(
      body.notificationEmail ?? prev.notificationEmail ?? DEFAULT_NOTIFICATION_EMAIL,
    )
      .trim()
      .slice(0, 160);

    const rawUser = String(body.smtpUser ?? prev.smtpUser).trim();
    const safeUser = rawUser === '(Configured via ENV)' ? prev.smtpUser : rawUser.slice(0, 160);

    const nextQuickReplies =
      body.telegramQuickReplies !== undefined
        ? normalizeQuickRepliesInput(body.telegramQuickReplies)
        : prev.telegramQuickReplies || DEFAULT_TELEGRAM_QUICK_REPLIES.map((p) => ({...p}));

    const normalizeAdminIds = (val: unknown): string[] => {
      const items = Array.isArray(val)
        ? val
        : typeof val === 'string'
          ? val.split(/[\s,;]+/)
          : prev.telegramAdminChatIds || [];
      return Array.from(
        new Set(
          items
            .map((x) => String(x).trim())
            .filter((x) => /^-?\d{5,20}$/.test(x)),
        ),
      ).slice(0, 20);
    };

    const nextAdminChatIds =
      body.telegramAdminChatIds !== undefined
        ? normalizeAdminIds(body.telegramAdminChatIds)
        : prev.telegramAdminChatIds || [];

    store.systemSettings = {
      smtpHost: String(body.smtpHost ?? prev.smtpHost ?? 'smtp.gmail.com').trim().slice(0, 160),
      smtpPort: Math.min(65535, Math.max(1, Number(body.smtpPort ?? prev.smtpPort) || 587)),
      smtpUser: safeUser,
      smtpPassword: body.smtpPassword ? String(body.smtpPassword) : prev.smtpPassword,
      smtpFromEmail: String(body.smtpFromEmail ?? prev.smtpFromEmail).trim().slice(0, 160),
      notificationEmail: cleanNotifEmail || DEFAULT_NOTIFICATION_EMAIL,
      smtpEnabled: Boolean(body.smtpEnabled ?? prev.smtpEnabled),
      customerEmailNotificationsEnabled:
        body.customerEmailNotificationsEnabled !== undefined
          ? Boolean(body.customerEmailNotificationsEnabled)
          : prev.customerEmailNotificationsEnabled !== false,
      distributorBaseUrl: cleanDistUrl,
      distributorMerchantId: String(body.distributorMerchantId ?? prev.distributorMerchantId).trim().slice(0, 120),
      distributorApiKey: body.distributorApiKey ? String(body.distributorApiKey) : prev.distributorApiKey,
      distributorEnabled: Boolean(body.distributorEnabled ?? prev.distributorEnabled),
      telegramQuickRepliesEnabled:
        body.telegramQuickRepliesEnabled !== undefined
          ? Boolean(body.telegramQuickRepliesEnabled)
          : prev.telegramQuickRepliesEnabled !== false,
      telegramQuickReplies: nextQuickReplies,
      telegramAdminChatIds: nextAdminChatIds,
      telegramAdminOrderAlerts:
        body.telegramAdminOrderAlerts !== undefined
          ? Boolean(body.telegramAdminOrderAlerts)
          : prev.telegramAdminOrderAlerts !== false,
      commerce: normalizeCommerceSettings(prev.commerce),
      updatedAt: new Date().toISOString(),
    };
    appendServerLog(
      store,
      req.adminSession!.email,
      'SYSTEM_SETTINGS_UPDATED',
      `Updated SMTP (${store.systemSettings.notificationEmail}, customerEmails=${store.systemSettings.customerEmailNotificationsEnabled}), Telegram Admins (${nextAdminChatIds.length}), and Quick Replies (${nextQuickReplies.length})`,
    );
    writeStore(store);

    res.json({
      ok: true,
      telegramQuickReplies: store.systemSettings.telegramQuickReplies,
      telegramQuickRepliesEnabled: store.systemSettings.telegramQuickRepliesEnabled,
      telegramAdminChatIds: store.systemSettings.telegramAdminChatIds,
      telegramAdminOrderAlerts: store.systemSettings.telegramAdminOrderAlerts,
      customerEmailNotificationsEnabled: store.systemSettings.customerEmailNotificationsEnabled,
    });
  });

  app.post('/api/admin/test-email', requireAdmin('settings'), async (req: AuthedRequest, res) => {
    const cfg = resolveSmtpConfig(readStore());
    const result = await sendAdminNotificationEmail(
      'Test Notification — Order & Complaint Email Alerts Active',
      [
        {
          label: 'Status',
          value: cfg.useBrevo
            ? 'Brevo HTTPS REST API working'
            : 'SMTP connection working',
        },
        {label: 'Transport', value: cfg.useBrevo ? 'Brevo REST API (HTTPS)' : `SMTP (${cfg.host}:${cfg.port})`},
        {label: 'Triggered By', value: req.adminSession!.email},
        {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
      ],
      req.adminSession!.email,
    );
    if (!result.sent) {
      res.status(400).json({error: result.reason || 'Failed to send test email', ...result});
      return;
    }
    res.json({ok: true, toEmail: result.toEmail, transport: result.transport});
  });

  // Automated SMS Payment Webhook (bKash / Nagad Android SMS Forwarder -> Firestore sms_payments/{trxId})
  app.post('/api/sms-webhook', async (req, res) => {
    const expectedSecret = (process.env.SMS_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret) {
      res.status(503).json({error: 'SMS_WEBHOOK_SECRET is not configured on server'});
      return;
    }

    const headerSecret = String(req.headers['x-sms-secret'] || '').trim();
    const bodySecret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : '';
    const providedSecret = headerSecret || bodySecret;

    if (!providedSecret || !timingSafeEqualsText(providedSecret, expectedSecret)) {
      res.status(401).json({error: 'Invalid SMS webhook secret'});
      return;
    }

    if (!adminDb) {
      res.status(503).json({error: 'Firebase Admin Firestore is not initialized'});
      return;
    }

    const rawText = String(req.body?.message ?? req.body?.text ?? '').trim();
    if (!rawText || rawText.length > 2000) {
      res.status(400).json({error: 'Provide a valid SMS message/text payload'});
      return;
    }

    const hintSender = typeof req.body?.sender === 'string' ? req.body.sender : undefined;
    const hintMethod = typeof req.body?.method === 'string' ? req.body.method : undefined;

    try {
      const result = await recordSmsPaymentInFirestore({
        rawText,
        hintSender,
        hintMethod,
        source: 'sms_webhook',
      });

      if (!result.ok) {
        res.status(result.status).json({error: result.error});
        return;
      }

      res.status(result.duplicate ? 200 : 201).json({
        ok: true,
        duplicate: result.duplicate,
        used: result.used,
        trxId: result.parsed.trxId,
        amount: result.parsed.amount,
        method: result.parsed.method,
        ...(result.reconciled?.matched ? {autoVerified: result.reconciled} : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('SMS webhook Firestore write error:', msg);
      res.status(500).json({error: `Failed to store SMS payment: ${msg}`});
    }
  });

  // Automation & Telegram Bot Status (Admin Settings diagnostic view, no secret values leaked)
  app.get('/api/admin/automation-status', requireAdmin('settings'), (_req, res) => {
    const maskPhone = (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return '';
      if (trimmed.length <= 5) return '***';
      return `${trimmed.slice(0, 3)}****${trimmed.slice(-3)}`;
    };
    const mailCfg = resolveSmtpConfig(readStore());
    res.json({
      firebaseAdminMode: firebaseInitMode,
      firebaseProjectId: firebaseProjectId || '',
      firestoreDatabaseId: firestoreDatabaseId || '(default)',
      firestoreConnected: Boolean(adminDb),
      emailTransport: mailCfg.mailTransport,
      brevoConfigured: mailCfg.useBrevo,
      brevoSenderConfigured: Boolean(mailCfg.brevoSenderEmail),
      smsWebhookConfigured: Boolean((process.env.SMS_WEBHOOK_SECRET || '').trim()),
      telegramBotConfigured: Boolean((process.env.TELEGRAM_BOT_TOKEN || '').trim()),
      telegramBotRunning: telegramBotState.running,
      telegramBotUsername: telegramBotState.username,
      telegramBotProcessedUpdates: telegramBotState.processedUpdates,
      telegramBotLastPollAt: telegramBotState.lastPollAt,
      telegramBotLastError: telegramBotState.lastError,
      geminiConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      geminiModel: GEMINI_BOT_MODEL,
      bkashNumberMasked: maskPhone(process.env.BKASH_NUMBER || ''),
      nagadNumberMasked: maskPhone(process.env.NAGAD_NUMBER || ''),
      telegramAdminCount: getConfiguredTelegramAdminChatIds(getTelegramAdminDeps()).length,
      pendingOrderExpiryCronRunning: orderExpiryCronState.running,
      lastOrderExpiryCheckAt: orderExpiryCronState.lastCheckAt,
      expiredOrdersCount: orderExpiryCronState.totalExpired,
      lastOrderExpiryError: orderExpiryCronState.lastError,
    });
  });

  // Firebase Admin SDK metric: Total orders placed through the Telegram bot over the last 24 hours
  app.get('/api/admin/telegram-orders-24h', requireAdmin(), async (_req, res) => {
    const fetchedAt = new Date().toISOString();
    if (!adminDb) {
      res.json({
        ok: true,
        connected: false,
        count: 0,
        completedCount: 0,
        pendingCount: 0,
        processingCount: 0,
        cancelledOrExpiredCount: 0,
        totalRevenue: 0,
        botRunning: telegramBotState.running,
        botUsername: telegramBotState.username,
        windowHours: 24,
        fetchedAt,
        reason: 'Firebase Admin SDK is not initialized',
      });
      return;
    }

    try {
      const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const snap = await adminDb
        .collection('orders')
        .where('createdAt', '>=', Timestamp.fromDate(cutoffDate))
        .get();

      let count = 0;
      let completedCount = 0;
      let pendingCount = 0;
      let processingCount = 0;
      let cancelledOrExpiredCount = 0;
      let totalRevenue = 0;
      const recentTelegramOrders: Array<{
        orderNumber: string;
        packageName: string;
        totalAmount: number;
        orderStatus: string;
      }> = [];

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as Record<string, unknown>;
        const customerUid = String(data.customerUid || '').trim();
        const senderNumber = String(data.senderNumber || '').trim().toLowerCase();
        const adminNote = String(data.adminNote || '').toLowerCase();
        const isTelegramOrder =
          customerUid.startsWith('tg_') ||
          senderNumber === 'telegram' ||
          adminNote.includes('telegram business bot');

        if (!isTelegramOrder) continue;

        count += 1;
        const orderStatus = String(data.orderStatus || 'pending');
        const paymentStatus = String(data.paymentStatus || 'pending');
        const amount = Number(data.totalAmount || 0);

        if (orderStatus === 'completed') completedCount += 1;
        else if (orderStatus === 'processing') processingCount += 1;
        else if (orderStatus === 'pending') pendingCount += 1;
        else if (orderStatus === 'cancelled' || orderStatus === 'expired') cancelledOrExpiredCount += 1;

        if (orderStatus !== 'cancelled' && orderStatus !== 'expired' && paymentStatus !== 'rejected') {
          totalRevenue += Number.isFinite(amount) ? amount : 0;
        }

        if (recentTelegramOrders.length < 4) {
          recentTelegramOrders.push({
            orderNumber: String(data.orderNumber || docSnap.id),
            packageName: String(data.packageName || data.productName || 'Top-up'),
            totalAmount: Number.isFinite(amount) ? amount : 0,
            orderStatus,
          });
        }
      }

      expiryCronPermissionRetryAt = 0;

      res.json({
        ok: true,
        connected: true,
        count,
        completedCount,
        pendingCount,
        processingCount,
        cancelledOrExpiredCount,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        botRunning: telegramBotState.running,
        botUsername: telegramBotState.username,
        recentOrders: recentTelegramOrders,
        windowHours: 24,
        fetchedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isPermDenied = /PERMISSION_DENIED|insufficient permissions/i.test(message);
      if (isPermDenied) {
        console.warn('[Telegram 24h Metric] Firestore Admin SDK PERMISSION_DENIED (awaiting project IAM grant).');
        res.json({
          ok: true,
          connected: false,
          permissionDenied: true,
          count: 0,
          completedCount: 0,
          pendingCount: 0,
          processingCount: 0,
          cancelledOrExpiredCount: 0,
          totalRevenue: 0,
          botRunning: telegramBotState.running,
          botUsername: telegramBotState.username,
          windowHours: 24,
          fetchedAt,
          reason:
            'Firestore Admin SDK PERMISSION_DENIED: Grant Cloud Datastore User (roles/datastore.user) in Google Cloud IAM for project gen-lang-client-0552010536, then wait ~1 min and click Refresh.',
        });
        return;
      }
      console.error('[Telegram 24h Metric] Firebase Admin SDK query error:', message);
      res.status(500).json({
        ok: false,
        connected: true,
        error: message,
        fetchedAt,
      });
    }
  });

  // Admin -> Customer Order Status Update Endpoint (Email + Telegram)
  const handleAdminCustomerOrderNotify = async (req: AuthedRequest, res: Response): Promise<void> => {
    const perms = req.adminSession!.permissions;
    if (req.adminSession!.role !== 'super_admin' && !perms.orders && !perms.payments) {
      res.status(403).json({error: 'Missing required permission to send order notifications'});
      return;
    }

    const body = (req.body || {}) as Partial<OrderStatusTelegramPayload> & {
      customerEmail?: string;
      customerName?: string;
      serverId?: string;
    };
    const orderNumber = String(body.orderNumber || '').trim().slice(0, 32);
    const orderStatus = body.orderStatus;
    const productName = String(body.productName || '').trim().slice(0, 120);
    const packageName = String(body.packageName || '').trim().slice(0, 120);

    if (
      !orderNumber ||
      !orderStatus ||
      !['pending', 'processing', 'completed', 'cancelled', 'expired'].includes(orderStatus) ||
      !productName ||
      !packageName
    ) {
      res.status(400).json({error: 'Invalid order status notification payload'});
      return;
    }

    const paymentStatus =
      body.paymentStatus && ['pending', 'verified', 'rejected'].includes(body.paymentStatus)
        ? body.paymentStatus
        : undefined;

    const cleanCustomerUid = body.customerUid ? String(body.customerUid).trim().slice(0, 128) : undefined;
    const cleanCustomerEmail = body.customerEmail ? String(body.customerEmail).trim().slice(0, 160) : undefined;
    const cleanCustomerName = body.customerName ? String(body.customerName).trim().slice(0, 100) : undefined;
    const cleanPlayerUid = body.playerUid ? String(body.playerUid).trim().slice(0, 80) : undefined;
    const cleanServerId = body.serverId ? String(body.serverId).trim().slice(0, 80) : undefined;
    const cleanPaymentMethod = body.paymentMethodName
      ? String(body.paymentMethodName).trim().slice(0, 60)
      : undefined;
    const cleanTrxId = body.trxId ? String(body.trxId).trim().slice(0, 64) : undefined;
    const cleanVoucher = body.voucherCode ? String(body.voucherCode).trim().slice(0, 500) : undefined;
    const cleanNote = body.note ? String(body.note).trim().slice(0, 500) : undefined;
    const cleanAmount = typeof body.totalAmount === 'number' ? body.totalAmount : undefined;

    const [tgResult, emailResult] = await Promise.all([
      sendTelegramOrderStatusUpdate({
        orderNumber,
        orderStatus,
        paymentStatus,
        productName,
        packageName,
        playerUid: cleanPlayerUid,
        totalAmount: cleanAmount,
        paymentMethodName: cleanPaymentMethod,
        trxId: cleanTrxId,
        voucherCode: cleanVoucher,
        note: cleanNote,
        customerUid: cleanCustomerUid,
        chatId: body.chatId,
      }),
      sendCustomerOrderEmail({
        toEmail: cleanCustomerEmail,
        customerName: cleanCustomerName,
        orderNumber,
        orderStatus,
        paymentStatus,
        productName,
        packageName,
        playerUid: cleanPlayerUid,
        serverId: cleanServerId,
        totalAmount: cleanAmount,
        paymentMethodName: cleanPaymentMethod,
        trxId: cleanTrxId,
        voucherCode: cleanVoucher,
        note: cleanNote,
      }),
    ]);

    res.json({
      ok: true,
      sent: tgResult.sent,
      telegramSent: tgResult.sent,
      telegramReason: tgResult.reason,
      emailSent: emailResult.sent,
      emailReason: emailResult.reason,
      toEmail: emailResult.toEmail,
    });
  };

  app.post('/api/admin/orders/telegram-notify', requireAdmin(), handleAdminCustomerOrderNotify);
  app.post('/api/admin/orders/notify-customer', requireAdmin(), handleAdminCustomerOrderNotify);

  app.post('/api/admin/customer-email-event', requireAdmin(), async (req: AuthedRequest, res: Response) => {
    const perms = req.adminSession!.permissions;
    if (req.adminSession!.role !== 'super_admin' && !perms.payments && !perms.customers && !perms.orders) {
      res.status(403).json({error: 'Missing required permission'});
      return;
    }
    const body = (req.body || {}) as {
      toEmail?: string;
      customerName?: string;
      subject?: string;
      headline?: string;
      message?: string;
      rows?: Array<{label?: string; value?: string}>;
    };
    const safeRows = Array.isArray(body.rows)
      ? body.rows
          .slice(0, 12)
          .map((r) => ({
            label: String(r?.label || '').trim().slice(0, 60),
            value: String(r?.value || '').trim().slice(0, 240),
          }))
          .filter((r) => r.label && r.value)
      : [];
    const result = await sendCustomerGenericEmail({
      toEmail: String(body.toEmail || '').trim().slice(0, 160),
      customerName: String(body.customerName || '').trim().slice(0, 100),
      subject: String(body.subject || 'Account Notification').trim().slice(0, 140),
      headline: String(body.headline || 'Account Update').trim().slice(0, 140),
      message: body.message ? String(body.message).trim().slice(0, 1500) : undefined,
      rows: safeRows,
    });
    res.json({ok: true, ...result});
  });

  // Server Security & Auth Logs
  app.get('/api/admin/server-logs', requireAdmin(), (_req, res) => {
    const store = readStore();
    res.json({logs: store.serverLogs});
  });

  // Advanced Commerce Routes (Coupons, Flash Sales, VIP Tiers, Vault PINs, Fraud Guard, Loyalty/Referrals, Gateway, Auto-Verified Orders & Deposits)
  registerCommerceRoutes(app, getCommerceDeps());

  // Multer & API error handler
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError || err instanceof Error) {
      res.status(400).json({error: err.message});
      return;
    }
    next(err);
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  } else {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StrikeVault server running on http://0.0.0.0:${PORT}`);
    const mailCfg = resolveSmtpConfig(readStore());
    if (mailCfg.useBrevo && mailCfg.enabled) {
      console.log(
        `[Admin Email] Brevo API ready (from=${mailCfg.brevoSenderEmail}, to=${mailCfg.toEmail})`,
      );
    } else if (mailCfg.useBrevo && !mailCfg.enabled) {
      console.warn(
        '[Admin Email] Brevo API configured (BREVO_API_KEY present), but sender email (BREVO_SENDER_EMAIL / SMTP_USER / EMAIL_USER) is missing.',
      );
    } else if (mailCfg.enabled) {
      console.log(`[Admin Email] SMTP ready (host=${mailCfg.host}:${mailCfg.port}, to=${mailCfg.toEmail})`);
    } else {
      console.warn(
        '[Admin Email] Email transport missing or disabled. Set BREVO_API_KEY + BREVO_SENDER_EMAIL (recommended) or SMTP_USER/SMTP_PASSWORD.',
      );
    }
    startTelegramBusinessBot();
    startPendingOrderExpiryCron();
    startFirestoreAdminEmailWatcher();
  });
}

const PENDING_ORDER_EXPIRY_MS = 30 * 60 * 1000;
const PENDING_ORDER_CRON_INTERVAL_MS = 60 * 1000;

const orderExpiryCronState = {
  running: false,
  inFlight: false,
  lastCheckAt: '',
  totalExpired: 0,
  lastError: '',
};

function parseFirestoreTimestampMillis(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof val === 'object') {
    const maybeTs = val as {toMillis?: () => number; seconds?: number; _seconds?: number};
    if (typeof maybeTs.toMillis === 'function') {
      return maybeTs.toMillis();
    }
    if (typeof maybeTs.seconds === 'number') {
      return maybeTs.seconds * 1000;
    }
    if (typeof maybeTs._seconds === 'number') {
      return maybeTs._seconds * 1000;
    }
  }
  return 0;
}

let expiryCronPermissionRetryAt = 0;

async function expireStalePendingOrders(manualTrigger = false): Promise<void> {
  if (!adminDb || orderExpiryCronState.inFlight) return;
  if (!manualTrigger && expiryCronPermissionRetryAt > Date.now()) return;
  orderExpiryCronState.inFlight = true;
  orderExpiryCronState.lastCheckAt = new Date().toISOString();

  try {
    const cutoffMs = Date.now() - PENDING_ORDER_EXPIRY_MS;
    const pendingSnap = await adminDb.collection('orders').where('orderStatus', '==', 'pending').get();
    expiryCronPermissionRetryAt = 0;

    for (const docSnap of pendingSnap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const createdMs = parseFirestoreTimestampMillis(data.createdAt);
      if (!createdMs || createdMs > cutoffMs) continue;

      const orderId = docSnap.id;
      const orderNumber = String(data.orderNumber || orderId).trim();

      try {
        const txOutcome = await adminDb.runTransaction(async (tx) => {
          const orderRef = adminDb!.collection('orders').doc(orderId);
          const freshSnap = await tx.get(orderRef);
          if (!freshSnap.exists) return null;

          const fresh = freshSnap.data() as Record<string, unknown>;
          if (fresh.orderStatus !== 'pending') return null;

          const freshCreatedMs = parseFirestoreTimestampMillis(fresh.createdAt);
          if (!freshCreatedMs || freshCreatedMs > Date.now() - PENDING_ORDER_EXPIRY_MS) {
            return null;
          }

          const now = FieldValue.serverTimestamp();
          const customerUid = String(fresh.customerUid || '').trim();
          const totalAmount = Number(fresh.totalAmount || 0);
          const isWalletOrder = fresh.paymentType === 'wallet' || fresh.paymentMethodId === 'wallet';
          const freshOrderNumber = String(fresh.orderNumber || orderNumber || '').trim();

          // Execute ALL transaction reads before any writes
          const needsWalletRefundCheck =
            isWalletOrder && !fresh.walletRefunded && totalAmount > 0 && Boolean(customerUid);
          const custRef = needsWalletRefundCheck
            ? adminDb!.collection('customers').doc(customerUid)
            : null;
          const trackingRef = freshOrderNumber
            ? adminDb!.collection('orderTracking').doc(freshOrderNumber)
            : null;

          const [custSnap, trackingSnap] = await Promise.all([
            custRef ? tx.get(custRef) : Promise.resolve(null),
            trackingRef ? tx.get(trackingRef) : Promise.resolve(null),
          ]);

          // Execute ALL transaction writes after all reads
          let refundedAmount = 0;
          if (custRef && custSnap?.exists) {
            const curBal = Number((custSnap.data() as {walletBalance?: number}).walletBalance || 0);
            const nextBal = Number((curBal + totalAmount).toFixed(2));
            tx.update(custRef, {
              walletBalance: nextBal,
              updatedAt: now,
            });
            refundedAmount = totalAmount;
          }

          const expiryNote =
            refundedAmount > 0
              ? `Order automatically expired after 30 minutes pending; ৳${refundedAmount} refunded to wallet.`
              : 'Order automatically expired after remaining pending for more than 30 minutes.';

          const orderPatch: Record<string, unknown> = {
            orderStatus: 'expired',
            adminNote: String(fresh.adminNote || '').trim() || expiryNote,
            notificationMessage: expiryNote.slice(0, 500),
            updatedAt: now,
          };
          if (refundedAmount > 0) {
            orderPatch.walletRefunded = true;
          }
          tx.update(orderRef, orderPatch);

          if (trackingRef && trackingSnap?.exists) {
            tx.update(trackingRef, {
              orderStatus: 'expired',
              notificationMessage: expiryNote.slice(0, 500),
              updatedAt: now,
            });
          }

          return {
            orderNumber: String(fresh.orderNumber || orderId),
            customerUid,
            customerName: String(fresh.customerName || ''),
            customerEmail: String(fresh.customerEmail || ''),
            productName: String(fresh.productName || 'Top-up'),
            packageName: String(fresh.packageName || 'Package'),
            playerUid: String(fresh.playerUid || ''),
            serverId: String(fresh.serverId || ''),
            totalAmount,
            paymentMethodName: String(fresh.paymentMethodName || ''),
            paymentStatus: (fresh.paymentStatus === 'verified' || fresh.paymentStatus === 'rejected'
              ? fresh.paymentStatus
              : 'pending') as 'pending' | 'verified' | 'rejected',
            trxId: String(fresh.trxId || ''),
            refundedAmount,
            expiryNote,
          };
        });

        if (!txOutcome) continue;

        orderExpiryCronState.totalExpired += 1;

        const store = readStore();
        appendServerLog(
          store,
          'order_expiry_cron',
          'ORDER_AUTO_EXPIRED',
          `Order ${txOutcome.orderNumber} marked expired after 30m pending${txOutcome.refundedAmount > 0 ? ` (wallet refunded ৳${txOutcome.refundedAmount})` : ''}`,
        );
        writeStore(store);

        const telegramNote =
          txOutcome.refundedAmount > 0
            ? `৩০ মিনিটের বেশি সময় পেন্ডিং থাকায় অর্ডারটি স্বয়ংক্রিয়ভাবে এক্সপায়ার্ড হয়েছে এবং ৳${txOutcome.refundedAmount} আপনার ওয়ালেটে রিফান্ড করা হয়েছে।`
            : '৩০ মিনিটের বেশি সময় পেন্ডিং থাকায় অর্ডারটি স্বয়ংক্রিয়ভাবে এক্সপায়ার্ড হয়েছে। অনুগ্রহ করে নতুন অর্ডার করুন বা সাপোর্টে যোগাযোগ করুন।';

        const [tgResult, emailResult] = await Promise.all([
          sendTelegramOrderStatusUpdate({
            orderNumber: txOutcome.orderNumber,
            orderStatus: 'expired',
            paymentStatus: txOutcome.paymentStatus,
            productName: txOutcome.productName,
            packageName: txOutcome.packageName,
            playerUid: txOutcome.playerUid || undefined,
            totalAmount: txOutcome.totalAmount > 0 ? txOutcome.totalAmount : undefined,
            paymentMethodName: txOutcome.paymentMethodName || undefined,
            trxId: txOutcome.trxId || undefined,
            note: telegramNote,
            customerUid: txOutcome.customerUid || undefined,
          }),
          sendCustomerOrderEmail({
            toEmail: txOutcome.customerEmail,
            customerName: txOutcome.customerName,
            orderNumber: txOutcome.orderNumber,
            orderStatus: 'expired',
            paymentStatus: txOutcome.paymentStatus,
            productName: txOutcome.productName,
            packageName: txOutcome.packageName,
            playerUid: txOutcome.playerUid || undefined,
            serverId: txOutcome.serverId || undefined,
            totalAmount: txOutcome.totalAmount > 0 ? txOutcome.totalAmount : undefined,
            paymentMethodName: txOutcome.paymentMethodName || undefined,
            trxId: txOutcome.trxId || undefined,
            note: txOutcome.expiryNote,
          }),
        ]);

        console.log(
          `[Order Expiry Cron] Order ${txOutcome.orderNumber} expired (Telegram=${tgResult.sent}, Email=${emailResult.sent})`,
        );
      } catch (orderErr) {
        const msg = orderErr instanceof Error ? orderErr.message : String(orderErr);
        console.error(`[Order Expiry Cron] Failed to expire order ${orderNumber}:`, msg);
      }
    }

    orderExpiryCronState.lastError = '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    orderExpiryCronState.lastError = msg;
    if (/PERMISSION_DENIED|insufficient permissions/i.test(msg) && firebaseInitMode === 'project_config') {
      expiryCronPermissionRetryAt = Date.now() + 5 * 60_000;
      console.warn(
        '[Order Expiry Cron] Backing off 5m due to Firestore Admin PERMISSION_DENIED (awaiting project IAM grant).',
      );
    } else {
      console.error('[Order Expiry Cron] Query error:', msg);
    }
  } finally {
    orderExpiryCronState.inFlight = false;
  }
}

function startPendingOrderExpiryCron(): void {
  if (!adminDb) {
    orderExpiryCronState.running = false;
    console.warn('[Order Expiry Cron] Skipped (Firestore Admin not initialized).');
    return;
  }
  if (orderExpiryCronState.running) return;
  orderExpiryCronState.running = true;
  console.log('[Order Expiry Cron] Active (checks pending orders > 30m every 60s)');

  // Initial check shortly after server startup, then every 60 seconds
  setTimeout(() => {
    void expireStalePendingOrders();
  }, 15_000).unref();

  setInterval(() => {
    void expireStalePendingOrders();
  }, PENDING_ORDER_CRON_INTERVAL_MS).unref();
}

function startFirestoreAdminEmailWatcher(): void {
  if (!adminDb || firebaseInitMode !== 'service_account') {
    return;
  }

  const getCreatedMs = (val: unknown): number => {
    if (!val) return 0;
    if (typeof (val as {toMillis?: () => number}).toMillis === 'function') {
      return (val as {toMillis: () => number}).toMillis();
    }
    return 0;
  };

  let ordersInitialized = false;
  adminDb.collection('orders').onSnapshot(
    (snap) => {
      if (!ordersInitialized) {
        ordersInitialized = true;
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const d = change.doc.data() as Record<string, unknown>;
        const createdMs = getCreatedMs(d.createdAt);
        if (createdMs && createdMs < SERVER_BOOT_TIME_MS - 10000) continue;
        const orderNumber = String(d.orderNumber || change.doc.id).trim();
        if (!orderNumber || !markNotificationEventSent(`order:${orderNumber}`)) continue;

        void sendAdminNotificationEmail(
          `New Order ${orderNumber} — ${String(d.productName || 'Top-up').slice(0, 80)}`,
          [
            {label: 'Order Number', value: orderNumber},
            {label: 'Product', value: String(d.productName || '—')},
            {label: 'Package', value: String(d.packageName || '—')},
            {label: 'Amount', value: `৳${Number(d.totalAmount || 0)}`},
            {label: 'Player UID', value: String(d.playerUid || '—')},
            {label: 'Server ID', value: String(d.serverId || 'N/A')},
            {label: 'Payment Method', value: String(d.paymentMethodName || '—')},
            {label: 'TrxID', value: String(d.trxId || '—')},
            {label: 'Customer Name', value: String(d.customerName || '—')},
            {label: 'Customer Email', value: String(d.customerEmail || '—')},
            {label: 'Customer Phone', value: String(d.customerPhone || '—')},
            {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
          ],
          String(d.customerEmail || 'firestore_watcher'),
        );
        const customerEmail = String(d.customerEmail || '').trim();
        if (customerEmail && markNotificationEventSent(`cust_order:${orderNumber}:pending`)) {
          void sendCustomerOrderEmail({
            toEmail: customerEmail,
            customerName: String(d.customerName || ''),
            orderNumber,
            orderStatus: (String(d.orderStatus || 'pending') as
              | 'pending'
              | 'processing'
              | 'completed'
              | 'cancelled'
              | 'expired'),
            paymentStatus: (String(d.paymentStatus || 'pending') as 'pending' | 'verified' | 'rejected'),
            productName: String(d.productName || 'Top-up'),
            packageName: String(d.packageName || 'Package'),
            playerUid: String(d.playerUid || ''),
            serverId: String(d.serverId || ''),
            totalAmount: Number(d.totalAmount || 0),
            paymentMethodName: String(d.paymentMethodName || ''),
            trxId: String(d.trxId || ''),
            note: String(d.notificationMessage || ''),
            isNewOrder: true,
          });
        }
      }
    },
    (err) => {
      console.error('[Firestore Watcher] orders error:', err instanceof Error ? err.message : err);
    },
  );

  let ticketsInitialized = false;
  adminDb.collection('tickets').onSnapshot(
    (snap) => {
      if (!ticketsInitialized) {
        ticketsInitialized = true;
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const d = change.doc.data() as Record<string, unknown>;
        const createdMs = getCreatedMs(d.createdAt);
        if (createdMs && createdMs < SERVER_BOOT_TIME_MS - 10000) continue;
        const ticketId = String(d.id || change.doc.id).trim();
        if (!ticketId || !markNotificationEventSent(`ticket:${ticketId}`)) continue;

        const subjectLine = String(d.subject || 'New Ticket').slice(0, 140);
        void sendAdminNotificationEmail(
          `Customer Complaint / Support: ${subjectLine}`,
          [
            {label: 'Ticket ID', value: ticketId},
            {label: 'Order Number', value: String(d.orderNumber || 'Not specified')},
            {label: 'Subject', value: subjectLine},
            {label: 'Complaint / Message', value: String(d.message || '—').slice(0, 1500)},
            {label: 'Customer Name', value: String(d.customerName || '—')},
            {label: 'Customer Email', value: String(d.customerEmail || '—')},
            {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
          ],
          String(d.customerEmail || 'firestore_watcher'),
        );
      }
    },
    (err) => {
      console.error('[Firestore Watcher] tickets error:', err instanceof Error ? err.message : err);
    },
  );

  let depositsInitialized = false;
  adminDb.collection('walletTopups').onSnapshot(
    (snap) => {
      if (!depositsInitialized) {
        depositsInitialized = true;
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const d = change.doc.data() as Record<string, unknown>;
        const createdMs = getCreatedMs(d.createdAt);
        if (createdMs && createdMs < SERVER_BOOT_TIME_MS - 10000) continue;
        const trxId = String(d.trxId || change.doc.id).trim();
        if (!trxId || !markNotificationEventSent(`deposit:${trxId}`)) continue;

        const amount = `৳${Number(d.amount || 0)}`;
        void sendAdminNotificationEmail(
          `New Wallet Deposit Request (${amount})`,
          [
            {label: 'Deposit Amount', value: amount},
            {label: 'Payment Method', value: String(d.paymentMethodName || '—')},
            {label: 'TrxID', value: trxId},
            {label: 'Customer Name', value: String(d.customerName || '—')},
            {label: 'Customer Email', value: String(d.customerEmail || '—')},
            {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
          ],
          String(d.customerEmail || 'firestore_watcher'),
        );
      }
    },
    (err) => {
      console.error('[Firestore Watcher] walletTopups error:', err instanceof Error ? err.message : err);
    },
  );
}

void startServer();
