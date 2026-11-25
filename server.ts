import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import express, {type NextFunction, type Request, type Response} from 'express';
import {getApp, getApps, initializeApp as initializeAdminApp} from 'firebase-admin/app';
import {getAuth as getAdminAuth} from 'firebase-admin/auth';
import multer from 'multer';
import nodemailer from 'nodemailer';

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

interface SystemSettingsStore {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  notificationEmail: string;
  smtpEnabled: boolean;
  distributorBaseUrl: string;
  distributorMerchantId: string;
  distributorApiKey: string;
  distributorEnabled: boolean;
  updatedAt: string;
}

interface AdminStoreData {
  primaryAdminName: string;
  primaryPasswordHash: string | null;
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
}

const FULL_PERMISSIONS: StaffPermissions = {
  products: true,
  orders: true,
  payments: true,
  customers: true,
  customization: true,
  settings: true,
};

function getFirebaseProjectId(): string | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as {projectId?: string};
    if (!raw.projectId || raw.projectId === 'remixed-project-id') return null;
    return raw.projectId;
  } catch {
    return null;
  }
}

const firebaseProjectId = getFirebaseProjectId();
if (firebaseProjectId) {
  const adminApp = getApps().length ? getApp() : initializeAdminApp({projectId: firebaseProjectId});
  void adminApp;
}

const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  crypto.randomBytes(32).toString('hex');

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
      distributorBaseUrl: '',
      distributorMerchantId: '',
      distributorApiKey: '',
      distributorEnabled: false,
      updatedAt: now,
    },
    serverLogs: [],
  };
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
    } else if (!parsed.systemSettings.notificationEmail) {
      parsed.systemSettings.notificationEmail = DEFAULT_NOTIFICATION_EMAIL;
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

function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
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

async function requireSignedInFirebase(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Authentication required'});
    return;
  }
  const token = authHeader.slice(7).trim();
  const adminSession = verifySessionToken(token);
  if (adminSession) {
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

function resolveSmtpConfig(store: AdminStoreData) {
  const s = store.systemSettings;
  const host = (s.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(s.smtpPort || process.env.SMTP_PORT || 587) || 587;
  const user = (s.smtpUser || process.env.SMTP_USER || '').trim();
  const pass = (s.smtpPassword || process.env.SMTP_PASSWORD || '').trim();
  const fromEmail = (s.smtpFromEmail || process.env.SMTP_FROM_EMAIL || user).trim();
  const toEmail = (
    s.notificationEmail ||
    process.env.NOTIFICATION_EMAIL ||
    DEFAULT_NOTIFICATION_EMAIL
  ).trim();
  const envConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  const enabled = Boolean((s.smtpEnabled || envConfigured) && host && user && pass && toEmail);
  return {host, port, user, pass, fromEmail, toEmail, enabled};
}

async function sendAdminNotificationEmail(
  subject: string,
  rows: Array<{label: string; value: string}>,
  actorEmail: string,
): Promise<{sent: boolean; reason?: string; toEmail?: string}> {
  const store = readStore();
  const cfg = resolveSmtpConfig(store);

  if (!cfg.enabled) {
    appendServerLog(
      store,
      actorEmail,
      'EMAIL_NOTIFY_SKIPPED',
      `Notification "${subject}" skipped (configure SMTP username & App Password in Admin Settings or env vars).`,
    );
    writeStore(store);
    return {sent: false, reason: 'SMTP credentials not configured yet', toEmail: cfg.toEmail};
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
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: {user: cfg.user, pass: cfg.pass},
    });
    await transporter.sendMail({
      from: cfg.fromEmail || cfg.user,
      to: cfg.toEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });
    appendServerLog(store, actorEmail, 'EMAIL_NOTIFY_SENT', `Sent "${subject}" to ${cfg.toEmail}`);
    writeStore(store);
    return {sent: true, toEmail: cfg.toEmail};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendServerLog(store, actorEmail, 'EMAIL_NOTIFY_FAILED', `Failed "${subject}": ${msg}`);
    writeStore(store);
    return {sent: false, reason: msg, toEmail: cfg.toEmail};
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

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
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

  // Customer -> Admin email notification endpoint (Orders, Support Complaints, Deposits)
  app.post('/api/notify/admin', requireSignedInFirebase, async (req, res) => {
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

    if (type === 'order') {
      const orderNumber = safeStr(details.orderNumber, 40);
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
    } else if (type === 'ticket') {
      const subjectLine = safeStr(details.subject, 140);
      subject = `Customer Complaint / Support: ${subjectLine || 'New Ticket'}`;
      rows = [
        {label: 'Ticket ID', value: safeStr(details.ticketId, 60) || '—'},
        {label: 'Order Number', value: safeStr(details.orderNumber, 40) || 'Not specified'},
        {label: 'Subject', value: subjectLine || '—'},
        {label: 'Complaint / Message', value: safeStr(details.message, 1500) || '—'},
        {label: 'Customer Name', value: safeStr(details.customerName, 100) || '—'},
        {label: 'Customer Email', value: safeStr(details.customerEmail, 160) || '—'},
        {label: 'Time (BD)', value: timestamp},
      ];
    } else {
      const amount = safeStr(details.amount, 40);
      subject = `New Wallet Deposit Request (${amount})`;
      rows = [
        {label: 'Deposit Amount', value: amount || '—'},
        {label: 'Payment Method', value: safeStr(details.paymentMethod, 60) || '—'},
        {label: 'TrxID', value: safeStr(details.trxId, 64) || '—'},
        {label: 'Customer Name', value: safeStr(details.customerName, 100) || '—'},
        {label: 'Customer Email', value: safeStr(details.customerEmail, 160) || '—'},
        {label: 'Time (BD)', value: timestamp},
      ];
    }

    const result = await sendAdminNotificationEmail(
      subject,
      rows,
      safeStr(details.customerEmail, 160) || 'customer',
    );
    res.json({ok: true, ...result});
  });

  // SMTP & Authorized Distributor API Settings (Server-Only Secrets)
  app.get('/api/admin/system-settings', requireAdmin('settings'), (_req, res) => {
    const store = readStore();
    const s = store.systemSettings;
    const cfg = resolveSmtpConfig(store);
    res.json({
      settings: {
        smtpHost: s.smtpHost || cfg.host,
        smtpPort: s.smtpPort || cfg.port,
        smtpUser: s.smtpUser || (process.env.SMTP_USER ? '(Configured via ENV)' : ''),
        hasSmtpPassword: Boolean(s.smtpPassword || process.env.SMTP_PASSWORD),
        smtpFromEmail: s.smtpFromEmail,
        notificationEmail: s.notificationEmail || cfg.toEmail || DEFAULT_NOTIFICATION_EMAIL,
        smtpEnabled: s.smtpEnabled || Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD),
        distributorBaseUrl: s.distributorBaseUrl,
        distributorMerchantId: s.distributorMerchantId,
        hasDistributorApiKey: Boolean(s.distributorApiKey),
        distributorEnabled: s.distributorEnabled,
        updatedAt: s.updatedAt,
      },
    });
  });

  app.put('/api/admin/system-settings', requireAdmin('settings'), (req: AuthedRequest, res) => {
    const body = req.body as Partial<SystemSettingsStore>;
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

    store.systemSettings = {
      smtpHost: String(body.smtpHost ?? prev.smtpHost ?? 'smtp.gmail.com').trim().slice(0, 160),
      smtpPort: Math.min(65535, Math.max(1, Number(body.smtpPort ?? prev.smtpPort) || 587)),
      smtpUser: safeUser,
      smtpPassword: body.smtpPassword ? String(body.smtpPassword) : prev.smtpPassword,
      smtpFromEmail: String(body.smtpFromEmail ?? prev.smtpFromEmail).trim().slice(0, 160),
      notificationEmail: cleanNotifEmail || DEFAULT_NOTIFICATION_EMAIL,
      smtpEnabled: Boolean(body.smtpEnabled ?? prev.smtpEnabled),
      distributorBaseUrl: cleanDistUrl,
      distributorMerchantId: String(body.distributorMerchantId ?? prev.distributorMerchantId).trim().slice(0, 120),
      distributorApiKey: body.distributorApiKey ? String(body.distributorApiKey) : prev.distributorApiKey,
      distributorEnabled: Boolean(body.distributorEnabled ?? prev.distributorEnabled),
      updatedAt: new Date().toISOString(),
    };
    appendServerLog(
      store,
      req.adminSession!.email,
      'SYSTEM_SETTINGS_UPDATED',
      `Updated SMTP (${store.systemSettings.notificationEmail}) and Distributor API configuration`,
    );
    writeStore(store);

    res.json({ok: true});
  });

  app.post('/api/admin/test-email', requireAdmin('settings'), async (req: AuthedRequest, res) => {
    const result = await sendAdminNotificationEmail(
      'Test Notification — Order & Complaint Email Alerts Active',
      [
        {label: 'Status', value: 'SMTP connection working'},
        {label: 'Triggered By', value: req.adminSession!.email},
        {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
      ],
      req.adminSession!.email,
    );
    if (!result.sent) {
      res.status(400).json({error: result.reason || 'Failed to send test email', ...result});
      return;
    }
    res.json({ok: true, toEmail: result.toEmail});
  });

  // Server Security & Auth Logs
  app.get('/api/admin/server-logs', requireAdmin(), (_req, res) => {
    const store = readStore();
    res.json({logs: store.serverLogs});
  });

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
  });
}

void startServer();
