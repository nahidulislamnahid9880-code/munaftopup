import crypto from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import {FieldValue} from 'firebase-admin/firestore';
import {
  dispatchDistributorWithLog,
  normalizeCommerceSettings,
  reconcilePendingTransactionsForSms,
  settleOrderCompletionEffects,
  type CommerceDeps,
} from './server-commerce.ts';

export interface TelegramAdminDeps {
  adminDb: Firestore | null;
  firebaseInitMode: string;
  websiteUrl: string;
  superAdminEmail: string;
  callTelegramApi: <T>(
    token: string,
    method: string,
    payload?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<T>;
  sendTelegramReply: (
    token: string,
    chatId: number,
    text: string,
    businessConnectionId?: string,
    replyMarkup?: Record<string, unknown>,
  ) => Promise<void>;
  sendTelegramOrderStatusUpdate: (params: {
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
  }) => Promise<{sent: boolean; skipped?: boolean; reason?: string}>;
  sendCustomerOrderEmail: (params: {
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
  }) => Promise<{sent: boolean; skipped?: boolean; reason?: string; toEmail?: string}>;
  sendCustomerGenericEmail: (params: {
    toEmail?: string;
    customerName?: string;
    subject: string;
    headline: string;
    rows: Array<{label: string; value: string}>;
    message?: string;
  }) => Promise<{sent: boolean; skipped?: boolean; reason?: string}>;
  sendAdminNotificationEmail: (
    subject: string,
    rows: Array<{label: string; value: string}>,
    actorEmail: string,
  ) => Promise<{sent: boolean; reason?: string; toEmail?: string; transport?: 'brevo' | 'smtp'}>;
  readStore: () => {
    primaryPasswordHash: string | null;
    staff: Record<
      string,
      {
        email: string;
        name: string;
        role: 'super_admin' | 'admin' | 'sub_admin';
        active: boolean;
        permissions: {
          products: boolean;
          orders: boolean;
          payments: boolean;
          customers: boolean;
          customization: boolean;
          settings: boolean;
        };
        passwordHash?: string;
      }
    >;
    systemSettings: {
      smtpEnabled: boolean;
      customerEmailNotificationsEnabled: boolean;
      telegramQuickRepliesEnabled: boolean;
      telegramAdminChatIds: string[];
      telegramAdminOrderAlerts: boolean;
      notificationEmail: string;
      distributorEnabled?: boolean;
      distributorBaseUrl?: string;
      commerce?: unknown;
      updatedAt?: string;
    };
    serverLogs: Array<{
      id: string;
      actorEmail: string;
      action: string;
      details: string;
      createdAt: string;
    }>;
  };
  writeStore: (data: any) => void;
  appendServerLog: (store: any, actorEmail: string, action: string, details: string) => void;
  verifyPassword: (password: string, storedHash: string) => boolean;
  timingSafeEqualsText: (a: string, b: string) => boolean;
  parseTimestampMillis: (val: unknown) => number;
  invalidateBotStoreCache: () => void;
  runOrderExpiryNow: () => Promise<void>;
  getCommerceDeps: () => CommerceDeps;
  recordManualSmsPayment: (
    rawText: string,
    hintMethod?: string,
  ) => Promise<
    | {
        ok: true;
        trxId: string;
        amount: number;
        method: string;
        duplicate: boolean;
        reconciled?: {
          matched: boolean;
          matchedType?: 'order' | 'wallet_topup';
          orderNumber?: string;
          orderStatus?: string;
          topupId?: string;
          amount?: number;
        };
      }
    | {ok: false; error: string}
  >;
  resolveMailStatus: () => {
    transport: 'brevo' | 'smtp' | 'none';
    enabled: boolean;
    customerEnabled: boolean;
    sender: string;
    toEmail: string;
  };
  getBotRuntimeStats: () => {
    running: boolean;
    username: string;
    processedUpdates: number;
    lastPollAt: string;
    lastError: string;
    expiryRunning: boolean;
    expiryLastCheckAt: string;
    expiryTotalExpired: number;
    expiryLastError: string;
  };
  sendTelegramDocument?: (
    token: string,
    chatId: number,
    filename: string,
    content: string,
    caption?: string,
  ) => Promise<void>;
  generateCsvReport?: (
    type: 'orders' | 'transactions' | 'daily_summary',
    days: number,
  ) => Promise<{filename: string; csvContent: string; rowCount: number}>;
  sendDailySummaryReport?: (manual?: boolean) => Promise<{sent: boolean; summary: any}>;
  seed100Reviews?: (forceSeed?: boolean) => Promise<{seeded: number; alreadyExists: boolean}>;
  onOrderCompletedPush?: (params: {
    customerUid: string;
    orderNumber: string;
    productName: string;
    packageName: string;
    voucherCode?: string;
  }) => Promise<unknown> | void;
  broadcastFlashSalePush?: (payload: {
    title: string;
    body: string;
    url?: string;
  }) => Promise<{sent: number; failed: number}>;
}

interface TelegramAdminPromptState {
  type:
    | 'login_password'
    | 'order_search'
    | 'order_voucher'
    | 'order_note'
    | 'ticket_reply'
    | 'package_price'
    | 'package_cost'
    | 'package_add'
    | 'product_add'
    | 'payment_number'
    | 'payment_add'
    | 'sms_search'
    | 'sms_add'
    | 'coupon_add'
    | 'flash_add'
    | 'vault_add'
    | 'notice_text'
    | 'site_field'
    | 'customer_search'
    | 'customer_wallet'
    | 'customer_points'
    | 'admin_chat_id_add'
    | 'reseller_key_add';
  targetId?: string;
  extraIndex?: number;
  extraText?: string;
  createdAt: number;
}

interface InlineButton {
  text: string;
  callback_data: string;
}

const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PROMPT_TTL_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const authenticatedAdminSessions = new Map<number, {expiresAt: number; label: string; email: string}>();
const failedLoginAttempts = new Map<number, {count: number; lockUntil: number}>();
const adminPromptStates = new Map<number, TelegramAdminPromptState>();

// Short reference map so callback_data never exceeds Telegram's 64-byte limit
const refToId = new Map<string, string>();
const idToRef = new Map<string, string>();
let refCounter = 1;

export function makeAdminOrderCallback(orderId: string): string {
  return `adm:oi:${encodeRef(orderId)}`;
}

function encodeRef(fullId: string): string {
  const clean = String(fullId || '').trim();
  if (clean.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(clean)) {
    return clean;
  }
  const existing = idToRef.get(clean);
  if (existing) return existing;
  const code = `r${(refCounter++).toString(36)}`;
  if (refToId.size > 4000) {
    refToId.clear();
    idToRef.clear();
  }
  refToId.set(code, clean);
  idToRef.set(clean, code);
  return code;
}

function decodeRef(ref: string): string {
  return refToId.get(ref) || ref;
}

export function getConfiguredTelegramAdminChatIds(deps: TelegramAdminDeps): number[] {
  const ids = new Set<number>();
  const envRaw = (process.env.ADMIN_TELEGRAM_CHAT_ID || '').trim();
  if (envRaw) {
    for (const part of envRaw.split(/[\s,;]+/)) {
      const n = Number(part.trim());
      if (Number.isSafeInteger(n) && n !== 0) ids.add(n);
    }
  }
  const storeIds = deps.readStore().systemSettings.telegramAdminChatIds || [];
  for (const part of storeIds) {
    const n = Number(String(part).trim());
    if (Number.isSafeInteger(n) && n !== 0) ids.add(n);
  }
  return Array.from(ids);
}

export function isTelegramAdminAuthorized(
  deps: TelegramAdminDeps,
  chatId: number,
  fromId?: number,
  businessConnectionId?: string,
): boolean {
  if (businessConnectionId) return false;
  if (fromId && fromId !== chatId) return false;

  if (getConfiguredTelegramAdminChatIds(deps).includes(chatId)) {
    return true;
  }
  const sess = authenticatedAdminSessions.get(chatId);
  if (sess && sess.expiresAt > Date.now()) {
    return true;
  }
  if (sess) authenticatedAdminSessions.delete(chatId);
  return false;
}

export function hasActiveAdminPrompt(chatId: number): boolean {
  const p = adminPromptStates.get(chatId);
  if (!p) return false;
  if (Date.now() - p.createdAt > PROMPT_TTL_MS) {
    adminPromptStates.delete(chatId);
    return false;
  }
  return true;
}

export async function notifyTelegramAdmins(
  deps: TelegramAdminDeps,
  token: string,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  if (!token) return;
  const store = deps.readStore();
  if (store.systemSettings.telegramAdminOrderAlerts === false) return;

  const recipients = new Set<number>(getConfiguredTelegramAdminChatIds(deps));
  for (const [cid, sess] of authenticatedAdminSessions.entries()) {
    if (sess.expiresAt > Date.now()) recipients.add(cid);
  }
  if (recipients.size === 0) return;

  await Promise.allSettled(
    Array.from(recipients).map((cid) =>
      deps.sendTelegramReply(token, cid, text, undefined, replyMarkup),
    ),
  );
}

async function sendOrEditPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId: number | undefined,
  text: string,
  buttons: InlineButton[][],
): Promise<void> {
  const safeText = text.length > 3950 ? `${text.slice(0, 3940)}\n…` : text;
  const reply_markup = {inline_keyboard: buttons};
  if (messageId) {
    try {
      await deps.callTelegramApi(
        token,
        'editMessageText',
        {
          chat_id: chatId,
          message_id: messageId,
          text: safeText,
          reply_markup,
        },
        12000,
      );
      return;
    } catch {
      // Fallback to sending a fresh message if message cannot be edited
    }
  }
  await deps.sendTelegramReply(token, chatId, safeText, undefined, reply_markup);
}

function formatShortDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Asia/Dhaka',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function maskPinPreview(code: string): string {
  const c = String(code || '').trim();
  if (c.length <= 6) return '***';
  return `${c.slice(0, 4)}****${c.slice(-3)}`;
}

function slugify(val: string): string {
  return (
    val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `item-${Date.now()}`
  );
}

function friendlyFirestoreError(deps: TelegramAdminDeps, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/PERMISSION_DENIED|insufficient permissions/i.test(msg)) {
    return (
      '⚠️ Firestore Admin SDK PERMISSION_DENIED (IAM অনুমোদন নেই বা প্রোজেক্ট পারমিশন বাকি)।\n' +
      `প্রোজেক্ট মোড: ${deps.firebaseInitMode}`
    );
  }
  return `⚠️ ডাটাবেস এরর: ${msg}`;
}

function verifyTelegramAdminPassword(
  deps: TelegramAdminDeps,
  candidate: string,
):
  | {valid: true; email: string; role: string}
  | {valid: false; reason: 'no_password_configured' | 'wrong_password'} {
  const clean = candidate.trim();
  if (!clean) return {valid: false, reason: 'wrong_password'};

  const envPass = (process.env.ADMIN_PASSCODE || '').trim();
  const store = deps.readStore();
  const staffEntries = Object.values(store.staff || {}).filter(
    (s) => s && s.active && typeof s.passwordHash === 'string' && s.passwordHash.includes(':'),
  );

  let anyPasswordConfigured = Boolean(envPass || store.primaryPasswordHash || staffEntries.length > 0);

  if (envPass && deps.timingSafeEqualsText(clean, envPass)) {
    return {valid: true, email: deps.superAdminEmail, role: 'super_admin'};
  }

  if (store.primaryPasswordHash) {
    try {
      if (deps.verifyPassword(clean, store.primaryPasswordHash)) {
        return {valid: true, email: deps.superAdminEmail, role: 'super_admin'};
      }
    } catch {
      // ignore malformed hash
    }
  }

  for (const staff of staffEntries) {
    try {
      if (staff.passwordHash && deps.verifyPassword(clean, staff.passwordHash)) {
        return {valid: true, email: staff.email, role: staff.role};
      }
    } catch {
      // ignore
    }
  }

  if (!anyPasswordConfigured) {
    return {valid: false, reason: 'no_password_configured'};
  }
  return {valid: false, reason: 'wrong_password'};
}

async function renderAdminHome(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
): Promise<void> {
  const stats = deps.getBotRuntimeStats();
  const mail = deps.resolveMailStatus();
  let dbStatusLine = '🟢 Firestore Connected';
  let pendingOrders = 0;
  let processingOrders = 0;
  let fraudOrders = 0;
  let todayOrders = 0;
  let todayRevenue = 0;
  let pendingTopups = 0;
  let openTickets = 0;
  let unusedSms = 0;
  let unusedPins = 0;
  let activePromos = 0;

  if (!deps.adminDb) {
    dbStatusLine = '🔴 Firestore Admin SDK Not Initialized';
  } else {
    try {
      const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
      const [ordersSnap, topupsSnap, ticketsSnap, smsSnap, pinsSnap, couponsSnap, flashSnap] =
        await Promise.all([
          deps.adminDb.collection('orders').get(),
          deps.adminDb.collection('walletTopups').where('status', '==', 'pending').get(),
          deps.adminDb.collection('tickets').where('status', '==', 'open').get(),
          deps.adminDb.collection('sms_payments').where('used', '==', false).get(),
          deps.adminDb.collection('voucherStock').where('status', '==', 'unused').get(),
          deps.adminDb.collection('coupons').where('active', '==', true).get(),
          deps.adminDb.collection('flashSales').where('active', '==', true).get(),
        ]);

      pendingTopups = topupsSnap.size;
      openTickets = ticketsSnap.size;
      unusedSms = smsSnap.size;
      unusedPins = pinsSnap.size;
      activePromos = couponsSnap.size + flashSnap.size;

      for (const docSnap of ordersSnap.docs) {
        const d = docSnap.data() as Record<string, unknown>;
        const st = String(d.orderStatus || 'pending');
        const pay = String(d.paymentStatus || 'pending');
        const amt = Number(d.totalAmount || 0);
        const createdMs = deps.parseTimestampMillis(d.createdAt);

        if (st === 'pending') pendingOrders += 1;
        if (st === 'processing') processingOrders += 1;
        if (d.fraudFlag === true) fraudOrders += 1;
        if (createdMs >= cutoff24h) {
          todayOrders += 1;
          if (st !== 'cancelled' && st !== 'expired' && pay !== 'rejected') {
            todayRevenue += Number.isFinite(amt) ? amt : 0;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dbStatusLine = /PERMISSION_DENIED/i.test(msg)
        ? '🟡 Firestore Admin PERMISSION_DENIED (IAM প্রয়োজন)'
        : '🟡 Firestore Error';
    }
  }

  const mailLabel =
    mail.transport === 'brevo'
      ? mail.enabled
        ? '🟢 Brevo HTTPS Ready'
        : '🟡 Brevo (Sender Missing)'
      : mail.transport === 'smtp'
        ? '🟢 SMTP Ready'
        : '🔴 Email Not Configured';

  const isPermanentAdmin = getConfiguredTelegramAdminChatIds(deps).includes(chatId);

  const text = [
    '🛡️ MUNAFTOPUP.bd — Full Telegram Admin Panel',
    '',
    `🤖 Bot: ${stats.running ? `@${stats.username || 'active'} (Online)` : 'Offline'}`,
    `${dbStatusLine}`,
    `📧 Mail: ${mailLabel}`,
    `🆔 Admin ID: ${chatId} (${isPermanentAdmin ? 'Permanent ✅' : 'Session Only'})`,
    '',
    '📊 লাইভ ড্যাশবোর্ড:',
    `• পেন্ডিং অর্ডার: ${pendingOrders} | প্রসেসিং: ${processingOrders}${fraudOrders > 0 ? ` | 🚨 Fraud: ${fraudOrders}` : ''}`,
    `• ২৪ ঘণ্টার অর্ডার: ${todayOrders} (৳${todayRevenue.toFixed(0)})`,
    `• পেন্ডিং ওয়ালেট টপ-আপ: ${pendingTopups} | আনইউজড SMS: ${unusedSms}`,
    `• ওপেন টিকেট: ${openTickets} | PIN স্টক: ${unusedPins} | অ্যাক্টিভ অফার: ${activePromos}`,
    '',
    'ওয়েব এডমিন প্যানেলের সব ফিচার নিচে থেকে সরাসরি পরিচালনা করুন:',
  ].join('\n');

  const buttons: InlineButton[][] = [
    [
      {text: `📦 Pending (${pendingOrders})`, callback_data: 'adm:ol:pending:0'},
      {text: `⏳ Processing (${processingOrders})`, callback_data: 'adm:ol:processing:0'},
    ],
    [
      {text: '📋 All Orders', callback_data: 'adm:ol:all:0'},
      {text: `🚨 Fraud (${fraudOrders})`, callback_data: 'adm:ol:fraud:0'},
      {text: '🔍 Search', callback_data: 'adm:os'},
    ],
    [
      {text: `💳 Payments & SMS (${unusedSms})`, callback_data: 'adm:pay'},
      {text: `💰 Top-Ups (${pendingTopups})`, callback_data: 'adm:tl:pending:0'},
    ],
    [
      {text: `🎟️ Promos & PINs (${unusedPins})`, callback_data: 'adm:pr'},
      {text: '💎 Products & Price', callback_data: 'adm:pl:0'},
    ],
    [
      {text: `🎫 Tickets (${openTickets})`, callback_data: 'adm:kl:0'},
      {text: '👥 Customers & Tiers', callback_data: 'adm:cl:0'},
    ],
    [
      {text: '🎨 Storefront & Notice', callback_data: 'adm:cu'},
      {text: '📊 Analytics', callback_data: 'adm:st'},
    ],
    [
      {text: '📥 Reports & CSV', callback_data: 'adm:rp'},
      {text: '⭐ Reviews (Approve)', callback_data: 'adm:rv:pending:0'},
    ],
    [
      {text: '🔑 Reseller API Keys', callback_data: 'adm:rk:0'},
      {text: '📜 Audit & API Logs', callback_data: 'adm:lg:srv'},
    ],
    [
      {text: '⚙️ Settings & Chat IDs', callback_data: 'adm:sy'},
      ...(!isPermanentAdmin
        ? [{text: '📌 Save My Chat ID', callback_data: 'adm:sy_id_self'}]
        : [{text: '🔄 Refresh', callback_data: 'adm:home'}]),
    ],
    [
      ...(isPermanentAdmin ? [] : [{text: '🔄 Refresh', callback_data: 'adm:home'}]),
      {text: '🔒 Logout', callback_data: 'adm:logout'},
    ].filter(Boolean) as InlineButton[],
  ];

  await sendOrEditPanel(deps, token, chatId, messageId, text, buttons);
}

// ---------------------------------------------------------------------------
// ORDERS MANAGER (Pending, Processing, Completed, Cancelled, Expired, Fraud, All)
// ---------------------------------------------------------------------------

async function renderOrdersList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  filter: string,
  page: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) {
    await sendOrEditPanel(deps, token, chatId, messageId, '🔴 Firestore Admin SDK সংযুক্ত নয়।', [
      [{text: '⬅️ Admin Home', callback_data: 'adm:home'}],
    ]);
    return;
  }

  try {
    const snap =
      filter === 'all' || filter === 'fraud'
        ? await deps.adminDb.collection('orders').get()
        : await deps.adminDb.collection('orders').where('orderStatus', '==', filter).get();

    const list = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          orderNumber: String(data.orderNumber || d.id),
          packageName: String(data.packageName || data.productName || 'Order'),
          totalAmount: Number(data.totalAmount || 0),
          orderStatus: String(data.orderStatus || 'pending'),
          paymentStatus: String(data.paymentStatus || 'pending'),
          playerUid: String(data.playerUid || ''),
          fraudFlag: data.fraudFlag === true,
          createdAtMs: deps.parseTimestampMillis(data.createdAt),
        };
      })
      .filter((o) => (filter === 'fraud' ? o.fraudFlag : true))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines: string[] = [
      `📦 Orders — ${filter.toUpperCase()} (${list.length} টি)`,
      `পৃষ্ঠা ${safePage + 1}/${totalPages}`,
      '',
    ];

    if (slice.length === 0) {
      lines.push('এই ক্যাটাগরিতে কোনো অর্ডার পাওয়া যায়নি।');
    } else {
      for (const o of slice) {
        lines.push(
          `• ${o.fraudFlag ? '🚨 ' : ''}${o.orderNumber} | ৳${o.totalAmount} | ${o.packageName}\n  UID: ${o.playerUid || '—'} | Pay: ${o.paymentStatus} | ${formatShortDate(o.createdAtMs)}`,
        );
      }
    }

    const buttons: InlineButton[][] = slice.map((o) => [
      {
        text: `${o.fraudFlag ? '🚨' : '🔎'} ${o.orderNumber} · ৳${o.totalAmount} (${o.orderStatus})`,
        callback_data: `adm:oi:${encodeRef(o.id)}`,
      },
    ]);

    const navRow: InlineButton[] = [];
    if (safePage > 0) navRow.push({text: '⬅️ Prev', callback_data: `adm:ol:${filter}:${safePage - 1}`});
    if (safePage + 1 < totalPages) navRow.push({text: 'Next ➡️', callback_data: `adm:ol:${filter}:${safePage + 1}`});
    if (navRow.length > 0) buttons.push(navRow);

    buttons.push([
      {text: 'Pending', callback_data: 'adm:ol:pending:0'},
      {text: 'Processing', callback_data: 'adm:ol:processing:0'},
      {text: 'Completed', callback_data: 'adm:ol:completed:0'},
    ]);
    buttons.push([
      {text: 'Cancelled', callback_data: 'adm:ol:cancelled:0'},
      {text: 'Expired', callback_data: 'adm:ol:expired:0'},
      {text: '🚨 Fraud', callback_data: 'adm:ol:fraud:0'},
    ]);
    buttons.push([
      {text: '🔍 Search Order', callback_data: 'adm:os'},
      {text: '🏠 Admin Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderOrderInspector(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  orderId: string,
  messageId?: number,
  bannerMsg?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('orders').doc(orderId).get();
    if (!snap.exists) {
      await sendOrEditPanel(deps, token, chatId, messageId, '❌ অর্ডারটি পাওয়া যায়নি।', [
        [{text: '📋 All Orders', callback_data: 'adm:ol:all:0'}],
        [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
      ]);
      return;
    }

    const o = snap.data() as Record<string, unknown>;
    const orderNumber = String(o.orderNumber || snap.id);
    const orderStatus = String(o.orderStatus || 'pending');
    const paymentStatus = String(o.paymentStatus || 'pending');
    const createdMs = deps.parseTimestampMillis(o.createdAt);

    const lines: string[] = [
      ...(bannerMsg ? [bannerMsg, ''] : []),
      `🧾 Order Inspector: ${orderNumber}`,
      ...(o.fraudFlag === true
        ? [
            `🚨 FRAUD WARNING (Score: ${Number(o.fraudScore || 0)}): ${
              Array.isArray(o.fraudReasons) ? o.fraudReasons.join(', ') : 'Suspicious activity'
            }`,
          ]
        : []),
      '',
      `🎮 Product: ${String(o.productName || '—')}`,
      `💎 Package: ${String(o.packageName || '—')}`,
      `🆔 Player UID: ${String(o.playerUid || '—')}`,
      ...(o.serverId && o.serverId !== 'N/A' ? [`🌐 Server: ${String(o.serverId)}`] : []),
      `💰 Total: ৳${Number(o.totalAmount || 0)}${
        Number(o.unitPrice || 0) > Number(o.totalAmount || 0) ? ` (Base ৳${Number(o.unitPrice)})` : ''
      }`,
      ...(o.couponCode ? [`🎟️ Coupon: ${String(o.couponCode)} (-৳${Number(o.couponDiscount || 0)})`] : []),
      ...(o.appliedTier && o.appliedTier !== 'regular'
        ? [`🏅 Tier: ${String(o.appliedTier).toUpperCase()} (-৳${Number(o.tierDiscount || 0)})`]
        : []),
      `💳 Payment: ${String(o.paymentMethodName || '—')} (${paymentStatus.toUpperCase()})`,
      `🔑 TrxID: ${String(o.trxId || '—')}`,
      ...(o.senderNumber ? [`📱 Sender: ${String(o.senderNumber)}`] : []),
      ...(o.screenshotUrl ? [`🖼️ Proof: ${String(o.screenshotUrl)}`] : []),
      `📌 Order Status: ${orderStatus.toUpperCase()}`,
      ...(o.distributorStatus && o.distributorStatus !== 'none'
        ? [`🚀 Distributor: ${String(o.distributorStatus).toUpperCase()}${o.distributorRef ? ` (${o.distributorRef})` : ''}`]
        : []),
      `👤 Customer: ${String(o.customerName || '—')}`,
      ...(o.customerEmail ? [`📧 Email: ${String(o.customerEmail)}`] : []),
      ...(o.customerPhone ? [`📞 Phone/UID: ${String(o.customerPhone)}`] : []),
      ...(o.voucherCode ? [`🎁 Voucher: ${String(o.voucherCode)}`] : []),
      ...(o.adminNote ? [`📝 Note: ${String(o.adminNote)}`] : []),
      `🕒 Time: ${formatShortDate(createdMs)}`,
    ];

    const ref = encodeRef(snap.id);
    const buttons: InlineButton[][] = [];

    if (paymentStatus !== 'verified') {
      buttons.push([
        {text: '✅ Approve Payment', callback_data: `adm:oa:ap:${ref}`},
        {text: '❌ Reject Payment', callback_data: `adm:oa:rp:${ref}`},
      ]);
    }
    buttons.push([
      {text: '⏳ Mark Processing', callback_data: `adm:oa:pr:${ref}`},
      {text: '🎉 Mark Completed', callback_data: `adm:oa:cp:${ref}`},
    ]);
    buttons.push([
      {text: '⚡ Claim Vault PIN & Complete', callback_data: `adm:oa:vp:${ref}`},
      {text: '🚀 Dispatch API', callback_data: `adm:oa:dp:${ref}`},
    ]);
    buttons.push([
      {text: '🔑 Custom Voucher', callback_data: `adm:op:vo:${ref}`},
      {text: '💬 Msg + Email', callback_data: `adm:op:nt:${ref}`},
    ]);
    if (orderStatus !== 'cancelled') {
      buttons.push([{text: '🚫 Cancel (& Refund Wallet)', callback_data: `adm:oa:ca:${ref}`}]);
    }
    buttons.push([
      {text: '🔄 Refresh', callback_data: `adm:oi:${ref}`},
      {text: '⬅️ Orders', callback_data: 'adm:ol:pending:0'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function executeAdminOrderAction(
  deps: TelegramAdminDeps,
  action: 'ap' | 'rp' | 'pr' | 'cp' | 'ca' | 'vp' | 'dp',
  orderId: string,
  extraInput?: string,
): Promise<{ok: boolean; msg: string}> {
  if (!deps.adminDb) return {ok: false, msg: 'Firestore Admin SDK unavailable'};

  try {
    if (action === 'dp') {
      const snap = await deps.adminDb.collection('orders').doc(orderId).get();
      if (!snap.exists) return {ok: false, msg: 'Order not found'};
      const o = snap.data() as Record<string, unknown>;
      if (String(o.paymentStatus || '') !== 'verified') {
        return {ok: false, msg: '⚠️ আগে পেমেন্ট Approve করুন (Verify payment first)!'};
      }
      const distRes = await dispatchDistributorWithLog(deps.getCommerceDeps(), {
        orderId: snap.id,
        orderNumber: String(o.orderNumber || snap.id),
        productId: String(o.productId || ''),
        productName: String(o.productName || ''),
        packageId: String(o.packageId || ''),
        packageName: String(o.packageName || ''),
        playerUid: String(o.playerUid || ''),
        serverId: String(o.serverId || ''),
        amount: Number(o.totalAmount || 0),
      });
      return {
        ok: distRes.dispatched,
        msg: distRes.dispatched
          ? `🚀 Dispatched cleanly (${distRes.statusText}${distRes.externalRef ? ` • Ref: ${distRes.externalRef}` : ''})`
          : `⚠️ Distributor: ${distRes.statusText}`,
      };
    }

    let candidatePinRef: FirebaseFirestore.DocumentReference | null = null;
    if (action === 'vp') {
      const preSnap = await deps.adminDb.collection('orders').doc(orderId).get();
      if (!preSnap.exists) return {ok: false, msg: 'Order not found'};
      const pre = preSnap.data() as Record<string, unknown>;
      if (String(pre.paymentStatus || '') !== 'verified') {
        return {ok: false, msg: '⚠️ আগে পেমেন্ট Approve করুন অথবা Pending SMS Verify করুন!'};
      }
      const productId = String(pre.productId || '').trim();
      const packageId = String(pre.packageId || '').trim();
      if (!productId || !packageId) {
        return {ok: false, msg: '⚠️ Order missing productId/packageId for PIN vault'};
      }
      const pinsSnap = await deps.adminDb
        .collection('voucherStock')
        .where('productId', '==', productId)
        .where('packageId', '==', packageId)
        .where('status', '==', 'unused')
        .limit(1)
        .get();
      if (pinsSnap.empty) {
        return {ok: false, msg: '⚠️ এই প্যাকেজের জন্য Voucher Vault-এ কোনো আনইউজড PIN নেই!'};
      }
      candidatePinRef = pinsSnap.docs[0].ref;
    }

    const txResult = await deps.adminDb.runTransaction(async (tx) => {
      const orderRef = deps.adminDb!.collection('orders').doc(orderId);
      const snap = await tx.get(orderRef);
      if (!snap.exists) return {ok: false as const, error: 'Order not found'};

      const o = snap.data() as Record<string, unknown>;
      const orderNumber = String(o.orderNumber || snap.id);
      const curOrderStatus = String(o.orderStatus || 'pending') as
        | 'pending'
        | 'processing'
        | 'completed'
        | 'cancelled'
        | 'expired';
      const curPaymentStatus = String(o.paymentStatus || 'pending') as 'pending' | 'verified' | 'rejected';
      const customerUid = String(o.customerUid || '');
      const trxKey = String(o.trxKey || '');
      const totalAmount = Number(o.totalAmount || 0);
      const isWalletOrder = o.paymentType === 'wallet' || o.paymentMethodId === 'wallet';

      if ((action === 'cp' || action === 'vp') && curPaymentStatus !== 'verified' && !extraInput) {
        return {ok: false as const, error: 'আগে পেমেন্ট Approve করুন (Verify payment first)!'};
      }

      const needWalletRefund =
        action === 'ca' &&
        isWalletOrder &&
        curOrderStatus !== 'cancelled' &&
        !o.walletRefunded &&
        totalAmount > 0 &&
        Boolean(customerUid);

      const custRef = needWalletRefund ? deps.adminDb!.collection('customers').doc(customerUid) : null;
      const trackRef = orderNumber ? deps.adminDb!.collection('orderTracking').doc(orderNumber) : null;
      const trxRef =
        (action === 'ap' || action === 'rp') && trxKey
          ? deps.adminDb!.collection('trxRegistry').doc(trxKey)
          : null;

      const [custSnap, trackSnap, trxSnap, pinSnap] = await Promise.all([
        custRef ? tx.get(custRef) : Promise.resolve(null),
        trackRef ? tx.get(trackRef) : Promise.resolve(null),
        trxRef ? tx.get(trxRef) : Promise.resolve(null),
        candidatePinRef ? tx.get(candidatePinRef) : Promise.resolve(null),
      ]);

      const now = FieldValue.serverTimestamp();
      let nextPaymentStatus = curPaymentStatus;
      let nextOrderStatus = curOrderStatus;
      let refundedAmount = 0;
      let message = String(o.notificationMessage || '');
      let nextVoucher = String(o.voucherCode || '');

      if (action === 'ap') {
        nextPaymentStatus = 'verified';
        nextOrderStatus = curOrderStatus === 'pending' ? 'processing' : curOrderStatus;
        message = 'Payment verified via Telegram Admin Panel. Your top-up is now processing.';
      } else if (action === 'rp') {
        nextPaymentStatus = 'rejected';
        nextOrderStatus = 'cancelled';
        message = 'Payment rejected during verification. Please check your TrxID or contact support.';
      } else if (action === 'pr') {
        nextOrderStatus = 'processing';
        message = 'Your top-up order is currently being fulfilled to your Player UID.';
      } else if (action === 'vp') {
        if (!pinSnap?.exists || pinSnap.data()?.status !== 'unused') {
          return {ok: false as const, error: 'Selected PIN was already claimed. Try again!'};
        }
        nextVoucher = String(pinSnap.data()?.code || '').trim();
        nextOrderStatus = 'completed';
        message = `Order completed! Redeem/Voucher Code: ${nextVoucher}`;
        tx.update(candidatePinRef!, {
          status: 'claimed',
          claimedOrderId: snap.id,
          claimedOrderNumber: orderNumber,
          claimedAt: now,
        });
      } else if (action === 'cp') {
        if (extraInput) nextVoucher = extraInput.trim().slice(0, 500);
        nextOrderStatus = 'completed';
        message = nextVoucher
          ? `Order completed! Redeem/Voucher Code: ${nextVoucher}`
          : 'Diamonds / voucher fulfilled to your Player UID. Thank you!';
      } else if (action === 'ca') {
        nextOrderStatus = 'cancelled';
        if (custRef && custSnap?.exists) {
          const curBal = Number((custSnap.data() as {walletBalance?: number}).walletBalance || 0);
          const nextBal = Number((curBal + totalAmount).toFixed(2));
          tx.update(custRef, {walletBalance: nextBal, updatedAt: now});
          refundedAmount = totalAmount;
          message = `Order cancelled by admin. ৳${refundedAmount} refunded to your Wallet Balance.`;
        } else {
          message = 'Order cancelled by administrator.';
        }
      }

      const orderPatch: Record<string, unknown> = {
        paymentStatus: nextPaymentStatus,
        orderStatus: nextOrderStatus,
        notificationMessage: message.slice(0, 500),
        updatedAt: now,
      };
      if (nextVoucher) orderPatch.voucherCode = nextVoucher;
      if (nextOrderStatus === 'completed') orderPatch.completedAt = now;
      if (refundedAmount > 0) orderPatch.walletRefunded = true;

      tx.update(orderRef, orderPatch);

      if (trackRef && trackSnap?.exists) {
        tx.update(trackRef, {
          paymentStatus: nextPaymentStatus,
          orderStatus: nextOrderStatus,
          notificationMessage: message.slice(0, 500),
          updatedAt: now,
        });
      }

      if (trxRef && trxSnap?.exists) {
        tx.update(trxRef, {status: nextPaymentStatus});
      }

      if (action === 'ap' || action === 'rp') {
        const histId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(deps.adminDb!.collection('paymentHistory').doc(histId), {
          id: histId,
          orderId: snap.id,
          orderNumber,
          trxId: String(o.trxId || ''),
          paymentMethodName: String(o.paymentMethodName || ''),
          senderNumber: String(o.senderNumber || ''),
          amount: totalAmount,
          action: action === 'ap' ? 'approved' : 'rejected',
          note: 'Updated via Telegram Admin Panel',
          adminEmail: 'telegram_admin',
          createdAt: now,
        });
      }

      if (customerUid) {
        const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
          id: notifId,
          customerUid,
          orderId: snap.id,
          orderNumber,
          title:
            refundedAmount > 0
              ? 'Order Cancelled & Refunded'
              : action === 'ap'
                ? 'Payment Approved'
                : action === 'rp'
                  ? 'Payment Rejected'
                  : `Order ${nextOrderStatus.toUpperCase()}`,
          message: message.slice(0, 500),
          read: false,
          createdAt: now,
        });
      }

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      tx.set(deps.adminDb!.collection('auditLogs').doc(logId), {
        id: logId,
        actorEmail: 'telegram_admin',
        actorRole: 'super_admin',
        action: `TG_ADMIN_ORDER_${action.toUpperCase()}`,
        targetType: 'order',
        targetId: orderNumber,
        details: `Updated via Telegram Admin Panel -> payment=${nextPaymentStatus}, status=${nextOrderStatus}${refundedAmount > 0 ? `, refunded=৳${refundedAmount}` : ''}`,
        createdAt: now,
      });

      return {
        ok: true as const,
        orderNumber,
        customerUid,
        customerName: String(o.customerName || ''),
        customerEmail: String(o.customerEmail || ''),
        productId: String(o.productId || ''),
        packageId: String(o.packageId || ''),
        productName: String(o.productName || 'Top-up'),
        packageName: String(o.packageName || 'Package'),
        playerUid: String(o.playerUid || ''),
        serverId: String(o.serverId || ''),
        totalAmount,
        paymentMethodName: String(o.paymentMethodName || ''),
        trxId: String(o.trxId || ''),
        voucherCode: nextVoucher,
        paymentStatus: nextPaymentStatus,
        orderStatus: nextOrderStatus,
        message,
        refundedAmount,
      };
    });

    if (!txResult.ok) {
      return {ok: false, msg: `⚠️ ${txResult.error}`};
    }

    let loyaltyNote = '';
    if (txResult.orderStatus === 'completed') {
      const settled = await settleOrderCompletionEffects(deps.getCommerceDeps(), orderId).catch(() => null);
      if (settled?.settled && settled.pointsAwarded > 0) {
        loyaltyNote = ` • +${settled.pointsAwarded} pts`;
      }
      if (txResult.customerUid) {
        void Promise.resolve(
          deps.onOrderCompletedPush?.({
            customerUid: txResult.customerUid,
            orderNumber: txResult.orderNumber,
            productName: txResult.productName,
            packageName: txResult.packageName,
            voucherCode: txResult.voucherCode || undefined,
          }),
        ).catch(() => null);
      }
    }

    if (action === 'vp' && txResult.productId && txResult.packageId && deps.adminDb) {
      void deps.adminDb
        .collection('voucherStock')
        .where('productId', '==', txResult.productId)
        .where('packageId', '==', txResult.packageId)
        .where('status', '==', 'unused')
        .get()
        .then((remSnap) => {
          if (remSnap.size < 5) {
            return deps.getCommerceDeps().onLowVoucherStock?.({
              productId: txResult.productId,
              productName: txResult.productName,
              packageId: txResult.packageId,
              packageName: txResult.packageName,
              remaining: remSnap.size,
            });
          }
          return undefined;
        })
        .catch(() => null);
    }

    const [emailRes, tgRes] = await Promise.all([
      deps.sendCustomerOrderEmail({
        toEmail: txResult.customerEmail,
        customerName: txResult.customerName,
        orderNumber: txResult.orderNumber,
        orderStatus: txResult.orderStatus,
        paymentStatus: txResult.paymentStatus,
        productName: txResult.productName,
        packageName: txResult.packageName,
        playerUid: txResult.playerUid || undefined,
        serverId: txResult.serverId || undefined,
        totalAmount: txResult.totalAmount,
        paymentMethodName: txResult.paymentMethodName || undefined,
        trxId: txResult.trxId || undefined,
        voucherCode: txResult.voucherCode || undefined,
        note: txResult.message,
      }),
      deps.sendTelegramOrderStatusUpdate({
        orderNumber: txResult.orderNumber,
        orderStatus: txResult.orderStatus,
        paymentStatus: txResult.paymentStatus,
        productName: txResult.productName,
        packageName: txResult.packageName,
        playerUid: txResult.playerUid || undefined,
        totalAmount: txResult.totalAmount,
        paymentMethodName: txResult.paymentMethodName || undefined,
        trxId: txResult.trxId || undefined,
        voucherCode: txResult.voucherCode || undefined,
        note: txResult.message,
        customerUid: txResult.customerUid || undefined,
      }),
    ]);

    const notifyNotes: string[] = [];
    if (emailRes.sent) notifyNotes.push('Email sent');
    if (tgRes.sent) notifyNotes.push('Telegram sent');

    return {
      ok: true,
      msg: `✅ Order ${txResult.orderNumber} updated (${txResult.orderStatus})${loyaltyNote}${
        txResult.refundedAmount > 0 ? ` • Refunded ৳${txResult.refundedAmount}` : ''
      }${notifyNotes.length > 0 ? ` • ${notifyNotes.join(' & ')}` : ''}`,
    };
  } catch (err) {
    return {ok: false, msg: friendlyFirestoreError(deps, err)};
  }
}

// ---------------------------------------------------------------------------
// PAYMENTS, WALLET TOP-UPS & SMS AUTO-VERIFY HUB
// ---------------------------------------------------------------------------

async function renderPaymentsHub(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const [topupsSnap, smsSnap, methodsSnap] = await Promise.all([
      deps.adminDb.collection('walletTopups').where('status', '==', 'pending').get(),
      deps.adminDb.collection('sms_payments').get(),
      deps.adminDb.collection('paymentMethods').get(),
    ]);
    let unusedSms = 0;
    let usedSms = 0;
    for (const d of smsSnap.docs) {
      if (d.data()?.used === true) usedSms += 1;
      else unusedSms += 1;
    }

    const lines = [
      ...(banner ? [banner, ''] : []),
      '💳 Payments, Deposits & SMS Hub',
      '',
      `• পেন্ডিং Wallet Top-Up: ${topupsSnap.size}`,
      `• SMS Payments: ${unusedSms} Unused / ${usedSms} Used (${smsSnap.size} Total)`,
      `• পেমেন্ট নম্বর/মেথড: ${methodsSnap.size}`,
    ];

    const buttons: InlineButton[][] = [
      [
        {text: `💰 Pending Top-Ups (${topupsSnap.size})`, callback_data: 'adm:tl:pending:0'},
        {text: '📋 All Top-Ups', callback_data: 'adm:tl:all:0'},
      ],
      [
        {text: `📲 Unused SMS (${unusedSms})`, callback_data: 'adm:sl:unused:0'},
        {text: '📲 All SMS Logs', callback_data: 'adm:sl:all:0'},
      ],
      [
        {text: '⚡ Auto-Reconcile Pending', callback_data: 'adm:sl_rec'},
        {text: '➕ Add SMS / Verify', callback_data: 'adm:sl_add'},
      ],
      [
        {text: '🔍 Search TrxID in SMS', callback_data: 'adm:sl_src'},
        {text: '📜 Payment History', callback_data: 'adm:ph:0'},
      ],
      [
        {text: '💳 Payment Numbers', callback_data: 'adm:ml'},
        {text: '🏠 Admin Home', callback_data: 'adm:home'},
      ],
    ];

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderWalletTopupsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  filter: string,
  page: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap =
      filter === 'all'
        ? await deps.adminDb.collection('walletTopups').get()
        : await deps.adminDb.collection('walletTopups').where('status', '==', filter).get();
    const list = snap.docs
      .map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          customerName: String(x.customerName || 'Customer'),
          customerEmail: String(x.customerEmail || ''),
          amount: Number(x.amount || 0),
          method: String(x.paymentMethodName || ''),
          trxId: String(x.trxId || ''),
          status: String(x.status || 'pending'),
          createdAtMs: deps.parseTimestampMillis(x.createdAt),
        };
      })
      .sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return b.createdAtMs - a.createdAtMs;
      });

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      `💰 Wallet Top-Ups — ${filter.toUpperCase()} (${list.length} টি)`,
      `পৃষ্ঠা ${safePage + 1}/${totalPages}`,
      '',
    ];
    if (slice.length === 0) {
      lines.push('কোনো ওয়ালেট ডিপোজিট রিকোয়েস্ট নেই।');
    } else {
      for (const t of slice) {
        lines.push(`• ৳${t.amount} (${t.method}) — ${t.customerName} | TrxID: ${t.trxId} | [${t.status}]`);
      }
    }

    const buttons: InlineButton[][] = slice.map((t) => [
      {
        text: `💳 ৳${t.amount} · ${t.trxId} (${t.status})`,
        callback_data: `adm:ti:${encodeRef(t.id)}`,
      },
    ]);
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:tl:${filter}:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:tl:${filter}:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([
      {text: 'Pending', callback_data: 'adm:tl:pending:0'},
      {text: 'Approved', callback_data: 'adm:tl:approved:0'},
      {text: 'All', callback_data: 'adm:tl:all:0'},
    ]);
    buttons.push([
      {text: '⬅️ Payments Hub', callback_data: 'adm:pay'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderWalletTopupInspector(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  topupId: string,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('walletTopups').doc(topupId).get();
    if (!snap.exists) {
      await sendOrEditPanel(deps, token, chatId, messageId, '❌ ডিপোজিট রিকোয়েস্ট পাওয়া যায়নি।', [
        [{text: '⬅️ Top-Ups', callback_data: 'adm:tl:pending:0'}],
      ]);
      return;
    }
    const t = snap.data() as Record<string, unknown>;
    const status = String(t.status || 'pending');
    const lines = [
      ...(banner ? [banner, ''] : []),
      '💰 Wallet Deposit Request',
      '',
      `👤 Customer: ${String(t.customerName || '—')}`,
      `📧 Email: ${String(t.customerEmail || '—')}`,
      `💵 Amount: ৳${Number(t.amount || 0)}`,
      `💳 Method: ${String(t.paymentMethodName || '—')}`,
      `📱 Sender: ${String(t.senderNumber || '—')}`,
      `🔑 TrxID: ${String(t.trxId || '—')}`,
      ...(t.screenshotUrl ? [`🖼️ Proof: ${String(t.screenshotUrl)}`] : []),
      `📌 Status: ${status.toUpperCase()}`,
      ...(t.adminNote ? [`📝 Note: ${String(t.adminNote)}`] : []),
      `🕒 Time: ${formatShortDate(deps.parseTimestampMillis(t.createdAt))}`,
    ];
    const ref = encodeRef(snap.id);
    const buttons: InlineButton[][] = [];
    if (status === 'pending') {
      buttons.push([
        {text: '✅ Approve & Add Balance', callback_data: `adm:ta:ap:${ref}`},
        {text: '❌ Reject Deposit', callback_data: `adm:ta:rj:${ref}`},
      ]);
    }
    buttons.push([
      {text: '⬅️ Top-Ups', callback_data: 'adm:tl:pending:0'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderSmsPaymentsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  filter: 'unused' | 'used' | 'all',
  page: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap =
      filter === 'all'
        ? await deps.adminDb.collection('sms_payments').get()
        : await deps.adminDb.collection('sms_payments').where('used', '==', filter === 'used').get();

    const list = snap.docs
      .map((d) => {
        const s = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          trxId: String(s.trxId || d.id),
          method: String(s.method || 'bKash'),
          amount: Number(s.amount || 0),
          used: s.used === true,
          orderRef: String(s.usedOrderNumber || s.usedOrderId || ''),
          receivedMs: deps.parseTimestampMillis(s.receivedAt),
        };
      })
      .sort((a, b) => b.receivedMs - a.receivedMs);

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `📲 SMS Auto-Payments — ${filter.toUpperCase()} (${list.length})`,
      `পৃষ্ঠা ${safePage + 1}/${totalPages}`,
      '',
    ];
    if (slice.length === 0) {
      lines.push('কোনো SMS পেমেন্ট রেকর্ড পাওয়া যায়নি।');
    } else {
      for (const s of slice) {
        lines.push(
          `• ${s.used ? '⚪ Used' : '🟢 Unused'} | ${s.trxId} | ${s.method} ৳${s.amount}${s.orderRef ? ` (${s.orderRef})` : ''}`,
        );
      }
    }

    const buttons: InlineButton[][] = [];
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:sl:${filter}:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:sl:${filter}:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);

    buttons.push([
      {text: '🟢 Unused', callback_data: 'adm:sl:unused:0'},
      {text: '⚪ Used', callback_data: 'adm:sl:used:0'},
      {text: '📋 All', callback_data: 'adm:sl:all:0'},
    ]);
    buttons.push([
      {text: '⚡ Reconcile Unused', callback_data: 'adm:sl_rec'},
      {text: '➕ Add SMS', callback_data: 'adm:sl_add'},
      {text: '🔍 Search TrxID', callback_data: 'adm:sl_src'},
    ]);
    buttons.push([
      {text: '⬅️ Payments Hub', callback_data: 'adm:pay'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Payments Hub', callback_data: 'adm:pay'}],
    ]);
  }
}

async function renderPaymentHistoryList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('paymentHistory').get();
    const list = snap.docs
      .map((d) => {
        const h = d.data() as Record<string, unknown>;
        return {
          orderNumber: String(h.orderNumber || '—'),
          trxId: String(h.trxId || '—'),
          method: String(h.paymentMethodName || '—'),
          amount: Number(h.amount || 0),
          action: String(h.action || '—'),
          admin: String(h.adminEmail || '—'),
          ms: deps.parseTimestampMillis(h.createdAt),
        };
      })
      .sort((a, b) => b.ms - a.ms);

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      `📜 Payment Verification History (${list.length})`,
      `পৃষ্ঠা ${safePage + 1}/${totalPages}`,
      '',
      ...(slice.length === 0
        ? ['কোনো হিস্ট্রি নেই।']
        : slice.map(
            (h) =>
              `• ${h.action === 'approved' ? '✅' : '❌'} ${h.orderNumber} | ৳${h.amount} (${h.method}) | ${h.trxId} | ${formatShortDate(h.ms)}`,
          )),
    ];

    const buttons: InlineButton[][] = [];
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:ph:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:ph:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([
      {text: '⬅️ Payments Hub', callback_data: 'adm:pay'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Payments Hub', callback_data: 'adm:pay'}],
    ]);
  }
}

async function renderPaymentMethodsPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('paymentMethods').get();
    const list = snap.docs
      .map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: String(x.name || d.id),
          accountNumber: String(x.accountNumber || ''),
          accountType: String(x.accountType || 'Personal'),
          active: x.active !== false,
          displayOrder: Number(x.displayOrder ?? 0),
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `💳 Payment Methods (${list.length} টি)`,
      'ট্যাপ করে Active/Off, Type (Personal/Merchant/Agent), অথবা নম্বর পরিবর্তন করুন:',
      '',
      ...list.map(
        (m) => `• ${m.active ? '🟢' : '🔴'} ${m.name} (${m.accountType}): ${m.accountNumber}`,
      ),
    ];

    const buttons: InlineButton[][] = list.map((m) => {
      const ref = encodeRef(m.id);
      return [
        {text: `${m.active ? '🟢' : '🔴'} ${m.name}`, callback_data: `adm:mt:${ref}`},
        {text: `🏷️ ${m.accountType}`, callback_data: `adm:mty:${ref}`},
        {text: `✏️ ..${m.accountNumber.slice(-4)}`, callback_data: `adm:mn:${ref}`},
      ];
    });
    buttons.push([{text: '➕ Add Payment Number', callback_data: 'adm:ma'}]);
    buttons.push([
      {text: '⬅️ Payments Hub', callback_data: 'adm:pay'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// PROMOTIONS, COUPONS, FLASH SALES & VOUCHER PIN VAULT
// ---------------------------------------------------------------------------

async function renderPromotionsHub(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const [couponsSnap, flashSnap, vaultSnap] = await Promise.all([
      deps.adminDb.collection('coupons').get(),
      deps.adminDb.collection('flashSales').get(),
      deps.adminDb.collection('voucherStock').get(),
    ]);
    const activeCoupons = couponsSnap.docs.filter((d) => d.data()?.active === true).length;
    const activeFlash = flashSnap.docs.filter((d) => d.data()?.active === true).length;
    const unusedPins = vaultSnap.docs.filter((d) => d.data()?.status === 'unused').length;

    const lines = [
      ...(banner ? [banner, ''] : []),
      '🎟️ Promotions, Flash Sales & PIN Vault',
      '',
      `• Promo Coupons: ${activeCoupons} Active / ${couponsSnap.size} Total`,
      `• Flash Sales: ${activeFlash} Live / ${flashSnap.size} Total`,
      `• Voucher PIN Vault: ${unusedPins} Unused / ${vaultSnap.size} Total`,
    ];

    const buttons: InlineButton[][] = [
      [
        {text: `🏷️ Coupons (${couponsSnap.size})`, callback_data: 'adm:cp:l:0'},
        {text: '➕ Create Coupon', callback_data: 'adm:cp:a'},
      ],
      [
        {text: `🔥 Flash Sales (${flashSnap.size})`, callback_data: 'adm:fs:l:0'},
        {text: '➕ New Flash Sale', callback_data: 'adm:fs:p'},
      ],
      [
        {text: `🔑 PIN Vault (${unusedPins} left)`, callback_data: 'adm:vp:s'},
        {text: '📥 Upload Bulk PINs', callback_data: 'adm:vp:p'},
      ],
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderCouponsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('coupons').get();
    const list = snap.docs
      .map((d) => {
        const c = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          code: String(c.code || d.id),
          discountType: String(c.discountType || 'percent'),
          discountValue: Number(c.discountValue || 0),
          minOrderAmount: Number(c.minOrderAmount || 0),
          usedCount: Number(c.usedCount || 0),
          usageLimit: Number(c.usageLimit || 0),
          active: c.active === true,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `🏷️ Promo Coupons (${list.length})`,
      '',
      ...(slice.length === 0
        ? ['কোনো কুপন নেই।']
        : slice.map(
            (c) =>
              `• ${c.active ? '🟢' : '🔴'} ${c.code} — ${
                c.discountType === 'percent' ? `${c.discountValue}%` : `৳${c.discountValue}`
              } (Min ৳${c.minOrderAmount}) · Used ${c.usedCount}/${c.usageLimit || '∞'}`,
          )),
    ];

    const buttons: InlineButton[][] = slice.map((c) => {
      const ref = encodeRef(c.id);
      return [
        {text: `${c.active ? '🟢' : '🔴'} ${c.code}`, callback_data: `adm:cp:t:${ref}`},
        {text: '🗑️ Delete', callback_data: `adm:cp:d:${ref}`},
      ];
    });
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:cp:l:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:cp:l:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([{text: '➕ Create Coupon', callback_data: 'adm:cp:a'}]);
    buttons.push([
      {text: '⬅️ Promos Hub', callback_data: 'adm:pr'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Promos Hub', callback_data: 'adm:pr'}],
    ]);
  }
}

async function renderFlashSalesList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('flashSales').get();
    const list = snap.docs
      .map((d) => {
        const f = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: String(f.title || 'Flash Sale'),
          productName: String(f.productName || ''),
          discountPercent: Number(f.discountPercent || 0),
          endsAt: String(f.endsAt || ''),
          active: f.active === true,
          ms: deps.parseTimestampMillis(f.createdAt),
        };
      })
      .sort((a, b) => b.ms - a.ms);

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `🔥 Flash Sales (${list.length})`,
      '',
      ...(slice.length === 0
        ? ['কোনো ফ্ল্যাশ সেল নেই।']
        : slice.map(
            (f) =>
              `• ${f.active ? '🟢 LIVE' : '🔴 OFF'} -${f.discountPercent}% · ${f.title} (${f.productName})`,
          )),
    ];

    const buttons: InlineButton[][] = slice.map((f) => {
      const ref = encodeRef(f.id);
      return [
        {text: `${f.active ? '🟢' : '🔴'} ${f.productName.slice(0, 18)} (-${f.discountPercent}%)`, callback_data: `adm:fs:t:${ref}`},
        {text: '🗑️ Delete', callback_data: `adm:fs:d:${ref}`},
      ];
    });
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:fs:l:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:fs:l:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([{text: '➕ Launch Flash Sale', callback_data: 'adm:fs:p'}]);
    buttons.push([
      {text: '⬅️ Promos Hub', callback_data: 'adm:pr'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Promos Hub', callback_data: 'adm:pr'}],
    ]);
  }
}

async function renderVaultSummary(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('voucherStock').get();
    const counts = new Map<string, {productName: string; packageName: string; unused: number; claimed: number}>();
    const unusedItems: Array<{id: string; masked: string; label: string}> = [];

    for (const d of snap.docs) {
      const v = d.data() as Record<string, unknown>;
      const key = `${String(v.productId || '')}::${String(v.packageId || '')}`;
      const entry = counts.get(key) || {
        productName: String(v.productName || 'Product'),
        packageName: String(v.packageName || 'Package'),
        unused: 0,
        claimed: 0,
      };
      if (v.status === 'unused') {
        entry.unused += 1;
        if (unusedItems.length < 8) {
          unusedItems.push({
            id: d.id,
            masked: maskPinPreview(String(v.code || '')),
            label: `${entry.productName} · ${entry.packageName}`,
          });
        }
      } else {
        entry.claimed += 1;
      }
      counts.set(key, entry);
    }

    const summaryLines = Array.from(counts.values()).map(
      (e) => `• ${e.productName} (${e.packageName}): ${e.unused} unused / ${e.claimed} claimed`,
    );

    const lines = [
      ...(banner ? [banner, ''] : []),
      `🔑 Voucher PIN Vault (${snap.size} Total)`,
      '',
      ...(summaryLines.length === 0 ? ['Vault খালি আছে।'] : summaryLines.slice(0, 15)),
      ...(unusedItems.length > 0
        ? ['', '🗑️ নিচের যেকোনো Unused PIN ডিলিট করতে ট্যাপ করুন:']
        : []),
    ];

    const buttons: InlineButton[][] = [
      [{text: '📥 Upload Bulk PINs', callback_data: 'adm:vp:p'}],
      ...unusedItems.map((u) => [
        {text: `🗑️ ${u.masked} (${u.label.slice(0, 22)})`, callback_data: `adm:vp:d:${encodeRef(u.id)}`},
      ]),
      [
        {text: '⬅️ Promos Hub', callback_data: 'adm:pr'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ];

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Promos Hub', callback_data: 'adm:pr'}],
    ]);
  }
}

async function renderProductPickerForAction(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  mode: 'flash' | 'vault',
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('products').get();
    const list = snap.docs
      .map((d) => ({
        id: d.id,
        name: String(d.data()?.name || d.id),
        displayOrder: Number(d.data()?.displayOrder ?? 0),
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .slice(0, 18);

    const buttons: InlineButton[][] = list.map((p) => [
      {
        text: p.name,
        callback_data: mode === 'flash' ? `adm:fs:c:${encodeRef(p.id)}` : `adm:vp:k:${encodeRef(p.id)}`,
      },
    ]);
    buttons.push([{text: '⬅️ Back', callback_data: 'adm:pr'}]);

    await sendOrEditPanel(
      deps,
      token,
      chatId,
      messageId,
      mode === 'flash'
        ? '🔥 কোন প্রোডাক্টে Flash Sale চালু করবেন সিলেক্ট করুন:'
        : '🔑 কোন প্রোডাক্টে Voucher PIN আপলোড করবেন সিলেক্ট করুন:',
      buttons,
    );
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Promos Hub', callback_data: 'adm:pr'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// SUPPORT TICKETS
// ---------------------------------------------------------------------------

async function renderTicketsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('tickets').get();
    const list = snap.docs
      .map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          subject: String(x.subject || 'Ticket'),
          customerName: String(x.customerName || 'Customer'),
          status: String(x.status || 'open'),
          createdAtMs: deps.parseTimestampMillis(x.createdAt),
        };
      })
      .sort((a, b) => {
        if (a.status === 'open' && b.status !== 'open') return -1;
        if (b.status === 'open' && a.status !== 'open') return 1;
        return b.createdAtMs - a.createdAtMs;
      });

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      `🎫 Support Tickets (${list.filter((i) => i.status === 'open').length} Open / ${list.length} Total)`,
      '',
    ];
    if (slice.length === 0) lines.push('কোনো সাপোর্ট টিকেট পাওয়া যায়নি।');
    for (const k of slice) {
      lines.push(`• [${k.status.toUpperCase()}] ${k.subject} — ${k.customerName}`);
    }

    const buttons: InlineButton[][] = slice.map((k) => [
      {
        text: `🎫 [${k.status}] ${k.subject.slice(0, 28)}`,
        callback_data: `adm:ki:${encodeRef(k.id)}`,
      },
    ]);
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:kl:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:kl:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([{text: '🏠 Admin Home', callback_data: 'adm:home'}]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderTicketInspector(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  ticketId: string,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('tickets').doc(ticketId).get();
    if (!snap.exists) {
      await sendOrEditPanel(deps, token, chatId, messageId, '❌ টিকেটটি পাওয়া যায়নি।', [
        [{text: '⬅️ Tickets', callback_data: 'adm:kl:0'}],
      ]);
      return;
    }
    const k = snap.data() as Record<string, unknown>;
    const status = String(k.status || 'open');
    const ref = encodeRef(snap.id);
    const lines = [
      ...(banner ? [banner, ''] : []),
      `🎫 Ticket: ${String(k.subject || '—')}`,
      `📌 Status: ${status.toUpperCase()}`,
      `👤 Customer: ${String(k.customerName || '—')} (${String(k.customerEmail || '—')})`,
      ...(k.orderNumber ? [`🧾 Order #: ${String(k.orderNumber)}`] : []),
      '',
      `💬 Customer Message:\n${String(k.message || '—')}`,
      ...(k.adminReply ? ['', `✅ Admin Reply:\n${String(k.adminReply)}`] : []),
    ];
    const buttons: InlineButton[][] = [
      [{text: '✍️ Reply to Customer', callback_data: `adm:kp:${ref}`}],
      ...(status !== 'closed' ? [[{text: '🔒 Close Ticket', callback_data: `adm:kc:${ref}`}]] : []),
      [
        {text: '⬅️ Tickets', callback_data: 'adm:kl:0'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// PRODUCTS, PACKAGES & CATEGORIES
// ---------------------------------------------------------------------------

async function renderProductsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('products').get();
    const list = snap.docs
      .map((d) => {
        const p = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: String(p.name || d.id),
          active: p.active !== false,
          featured: p.featured === true,
          pkgCount: Array.isArray(p.packages) ? p.packages.length : 0,
          displayOrder: Number(p.displayOrder ?? 0),
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `💎 Products & Packages (${list.length} টি প্রোডাক্ট)`,
      '',
    ];
    for (const p of slice) {
      lines.push(`• ${p.active ? '🟢' : '🔴'}${p.featured ? '⭐' : ''} ${p.name} (${p.pkgCount} packages)`);
    }

    const buttons: InlineButton[][] = slice.map((p) => [
      {
        text: `${p.active ? '🟢' : '🔴'}${p.featured ? '⭐' : ''} ${p.name}`,
        callback_data: `adm:pi:${encodeRef(p.id)}`,
      },
    ]);
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:pl:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:pl:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([
      {text: '➕ Add Product', callback_data: 'adm:pa'},
      {text: '🗂️ Categories', callback_data: 'adm:cat:l'},
    ]);
    buttons.push([{text: '🏠 Admin Home', callback_data: 'adm:home'}]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderCategoriesList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('categories').get();
    const list = snap.docs
      .map((d) => {
        const c = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: String(c.name || d.id),
          active: c.active !== false,
          displayOrder: Number(c.displayOrder ?? 0),
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `🗂️ Categories (${list.length})`,
      '',
      ...list.map((c) => `• ${c.active ? '🟢' : '🔴'} ${c.name}`),
    ];
    const buttons: InlineButton[][] = list.map((c) => [
      {text: `${c.active ? '🟢' : '🔴'} ${c.name} (Tap to Toggle)`, callback_data: `adm:cat:t:${encodeRef(c.id)}`},
    ]);
    buttons.push([
      {text: '⬅️ Products', callback_data: 'adm:pl:0'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '⬅️ Products', callback_data: 'adm:pl:0'}],
    ]);
  }
}

async function renderProductInspector(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  productId: string,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('products').doc(productId).get();
    if (!snap.exists) {
      await sendOrEditPanel(deps, token, chatId, messageId, '❌ প্রোডাক্ট পাওয়া যায়নি।', [
        [{text: '⬅️ Products', callback_data: 'adm:pl:0'}],
      ]);
      return;
    }
    const p = snap.data() as {
      name?: string;
      categoryName?: string;
      active?: boolean;
      featured?: boolean;
      packages?: Array<{id?: string; name?: string; price?: number; costPrice?: number; active?: boolean}>;
    };
    const pkgs = Array.isArray(p.packages) ? p.packages : [];
    const ref = encodeRef(snap.id);
    const lines = [
      ...(banner ? [banner, ''] : []),
      `🎮 ${p.name || snap.id}`,
      `Category: ${p.categoryName || '—'}`,
      `Status: ${p.active !== false ? '🟢 Active' : '🔴 Hidden'} | Featured: ${p.featured ? '⭐ Yes' : 'No'}`,
      '',
      '📦 Packages (ট্যাপ করে On/Off, Sale Price বা Cost Price পরিবর্তন করুন):',
      ...pkgs.map(
        (pkg, idx) =>
          `${idx + 1}. ${pkg.active !== false ? '🟢' : '🔴'} ${pkg.name || 'Package'} — ৳${Number(pkg.price || 0)}${
            Number(pkg.costPrice || 0) > 0 ? ` (Cost ৳${Number(pkg.costPrice)})` : ''
          }`,
      ),
    ];

    const buttons: InlineButton[][] = [
      [
        {
          text: p.active !== false ? '🔴 Hide' : '🟢 Activate',
          callback_data: `adm:pt:${ref}`,
        },
        {
          text: p.featured ? '⭐ Unfeature' : '☆ Make Featured',
          callback_data: `adm:pf:${ref}`,
        },
      ],
      [{text: '➕ Add New Package', callback_data: `adm:pka:${ref}`}],
    ];
    for (let i = 0; i < Math.min(pkgs.length, 12); i++) {
      const pkg = pkgs[i];
      buttons.push([
        {
          text: `${pkg.active !== false ? '🟢' : '🔴'} ${(pkg.name || '').slice(0, 15)}`,
          callback_data: `adm:gt:${ref}:${i}`,
        },
        {
          text: `💵 ৳${Number(pkg.price || 0)}`,
          callback_data: `adm:gp:${ref}:${i}`,
        },
        {
          text: `📉 Cost ৳${Number(pkg.costPrice || 0)}`,
          callback_data: `adm:gc:${ref}:${i}`,
        },
      ]);
    }
    buttons.push([{text: '🗑️ Delete Product', callback_data: `adm:pdel:${ref}`}]);
    buttons.push([
      {text: '⬅️ Products', callback_data: 'adm:pl:0'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// STOREFRONT CUSTOMIZATION & NOTICE (syncs settings/site + settings/storefront)
// ---------------------------------------------------------------------------

async function readSiteSettingsDoc(deps: TelegramAdminDeps): Promise<Record<string, any>> {
  if (!deps.adminDb) return {};
  const siteSnap = await deps.adminDb.collection('settings').doc('site').get();
  if (siteSnap.exists) return siteSnap.data() || {};
  const legSnap = await deps.adminDb.collection('settings').doc('storefront').get();
  return legSnap.exists ? legSnap.data() || {} : {};
}

async function patchSiteSettingsDoc(deps: TelegramAdminDeps, patch: Record<string, unknown>): Promise<void> {
  if (!deps.adminDb) return;
  const now = FieldValue.serverTimestamp();
  const payload = {...patch, updatedAt: now};
  await Promise.all([
    deps.adminDb.collection('settings').doc('site').set(payload, {merge: true}),
    deps.adminDb.collection('settings').doc('storefront').set(payload, {merge: true}).catch(() => null),
  ]);
  deps.invalidateBotStoreCache();
}

async function renderCustomizationPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const s = await readSiteSettingsDoc(deps);
    const contact = (s.contact || {}) as Record<string, string>;
    const lines = [
      ...(banner ? [banner, ''] : []),
      '🎨 Storefront Customization & Notice',
      '',
      `🏷️ Brand Name: ${s.brandName || 'MUNAFTOPUP.bd'}`,
      `✨ Tagline: ${s.brandTagline || '—'}`,
      `🦸 Hero Title: ${s.heroTitle || '—'}`,
      `📢 Notice Bar: ${s.noticeActive ? '🟢 ON' : '🔴 OFF'}`,
      `   Text: ${s.noticeText || '(empty)'}`,
      `📱 WhatsApp: ${contact.whatsapp || '—'}`,
      `✈️ Telegram: ${contact.telegram || '—'}`,
      `📧 Support Email: ${contact.email || '—'}`,
    ];
    const buttons: InlineButton[][] = [
      [
        {
          text: s.noticeActive ? '🔴 Notice OFF' : '🟢 Notice ON',
          callback_data: 'adm:nt_tog',
        },
        {text: '✏️ Edit Notice Text', callback_data: 'adm:nt_ed'},
      ],
      [
        {text: '🏷️ Brand Name', callback_data: 'adm:cu_e:brandName'},
        {text: '🦸 Hero Title', callback_data: 'adm:cu_e:heroTitle'},
      ],
      [
        {text: '📱 WhatsApp Link', callback_data: 'adm:cu_e:whatsapp'},
        {text: '✈️ Telegram Link', callback_data: 'adm:cu_e:telegram'},
      ],
      [
        {text: '📧 Support Email', callback_data: 'adm:cu_e:email'},
        {text: '🏠 Admin Home', callback_data: 'adm:home'},
      ],
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// CUSTOMERS, VIP TIERS & LOYALTY
// ---------------------------------------------------------------------------

async function renderCustomersList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('customers').get();
    const list = snap.docs
      .map((d) => {
        const c = d.data() as Record<string, unknown>;
        return {
          uid: d.id,
          name: String(c.displayName || c.email || d.id),
          email: String(c.email || ''),
          balance: Number(c.walletBalance || 0),
          tier: String(c.tier || 'regular').toUpperCase(),
          suspended: Boolean(c.suspended),
          updatedMs: deps.parseTimestampMillis(c.updatedAt),
        };
      })
      .sort((a, b) => b.updatedMs - a.updatedMs);

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [`👥 Customers (${list.length} জন)`, `পৃষ্ঠা ${safePage + 1}/${totalPages}`, ''];
    for (const c of slice) {
      lines.push(
        `• ${c.suspended ? '🚫' : '🟢'} [${c.tier}] ${c.name} — ৳${c.balance}${c.email ? ` (${c.email})` : ''}`,
      );
    }

    const buttons: InlineButton[][] = slice.map((c) => [
      {
        text: `${c.suspended ? '🚫' : '👤'} ${c.name.slice(0, 20)} (৳${c.balance} · ${c.tier})`,
        callback_data: `adm:ci:${encodeRef(c.uid)}`,
      },
    ]);
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:cl:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:cl:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([
      {text: '🔍 Search Customer', callback_data: 'adm:cs'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderCustomerInspector(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  uid: string,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const [snap, ordersSnap] = await Promise.all([
      deps.adminDb.collection('customers').doc(uid).get(),
      deps.adminDb.collection('orders').where('customerUid', '==', uid).get(),
    ]);
    if (!snap.exists) {
      await sendOrEditPanel(deps, token, chatId, messageId, '❌ কাস্টমার পাওয়া যায়নি।', [
        [{text: '⬅️ Customers', callback_data: 'adm:cl:0'}],
      ]);
      return;
    }
    const c = snap.data() as Record<string, unknown>;
    const suspended = Boolean(c.suspended);
    const tier = String(c.tier || 'regular');
    const ref = encodeRef(snap.id);

    const recentOrders = ordersSnap.docs
      .map((d) => {
        const o = d.data() as Record<string, unknown>;
        return {
          orderNumber: String(o.orderNumber || d.id),
          amount: Number(o.totalAmount || 0),
          status: String(o.orderStatus || 'pending'),
          ms: deps.parseTimestampMillis(o.createdAt),
        };
      })
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3);

    const lines = [
      ...(banner ? [banner, ''] : []),
      '👤 Customer Profile',
      '',
      `Name: ${String(c.displayName || '—')}`,
      `Email: ${String(c.email || '—')}`,
      `Phone: ${String(c.phone || '—')}`,
      `Wallet Balance: ৳${Number(c.walletBalance || 0)}`,
      `VIP Tier: ${tier.toUpperCase()}${c.tierLocked === true ? ' (Locked)' : ''}`,
      `Loyalty Points: ${Number(c.loyaltyPoints || 0)} pts`,
      `Total Spent: ৳${Number(c.totalSpent || 0)}`,
      ...(c.referralCode ? [`Referral Code: ${String(c.referralCode)}`] : []),
      `Status: ${suspended ? '🚫 SUSPENDED' : '🟢 ACTIVE'}`,
      ...(c.suspendedReason ? [`Reason: ${String(c.suspendedReason)}`] : []),
      ...(recentOrders.length > 0
        ? [
            '',
            `🧾 Recent Orders (${ordersSnap.size} total):`,
            ...recentOrders.map((o) => `• ${o.orderNumber} — ৳${o.amount} (${o.status})`),
          ]
        : []),
    ];
    const buttons: InlineButton[][] = [
      [
        {
          text: suspended ? '✅ Unsuspend' : '🚫 Suspend',
          callback_data: `adm:ct:${ref}`,
        },
        {text: '💵 Wallet (+/-)', callback_data: `adm:cw:${ref}`},
      ],
      [
        {text: `🏅 Cycle Tier (${tier.toUpperCase()})`, callback_data: `adm:cr:${ref}`},
        {text: '⭐ Points (+/-)', callback_data: `adm:cy:${ref}`},
      ],
      [
        {text: '⬅️ Customers', callback_data: 'adm:cl:0'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// ANALYTICS & LOGS
// ---------------------------------------------------------------------------

async function renderAnalyticsPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const [ordersSnap, customersSnap, topupsSnap, smsSnap, pinsSnap] = await Promise.all([
      deps.adminDb.collection('orders').get(),
      deps.adminDb.collection('customers').get(),
      deps.adminDb.collection('walletTopups').where('status', '==', 'approved').get(),
      deps.adminDb.collection('sms_payments').where('used', '==', false).get(),
      deps.adminDb.collection('voucherStock').where('status', '==', 'unused').get(),
    ]);
    const now = Date.now();
    const d24 = now - 24 * 60 * 60 * 1000;
    const d7 = now - 7 * 24 * 60 * 60 * 1000;

    let total = 0;
    let totalRev = 0;
    let totalNetProfit = 0;
    let o24 = 0;
    let r24 = 0;
    let tg24 = 0;
    let o7 = 0;
    let r7 = 0;
    let completed = 0;
    let pending = 0;
    let processing = 0;
    let cancelled = 0;
    let expired = 0;

    for (const docSnap of ordersSnap.docs) {
      const o = docSnap.data() as Record<string, unknown>;
      total += 1;
      const st = String(o.orderStatus || 'pending');
      const pay = String(o.paymentStatus || 'pending');
      const amt = Number(o.totalAmount || 0);
      const net = typeof o.netProfit === 'number' ? Number(o.netProfit) : 0;
      const ms = deps.parseTimestampMillis(o.createdAt);
      const validRev = st !== 'cancelled' && st !== 'expired' && pay !== 'rejected';
      const isTg =
        String(o.customerUid || '').startsWith('tg_') ||
        String(o.senderNumber || '').toLowerCase() === 'telegram';

      if (st === 'completed') completed += 1;
      else if (st === 'pending') pending += 1;
      else if (st === 'processing') processing += 1;
      else if (st === 'cancelled') cancelled += 1;
      else if (st === 'expired') expired += 1;

      if (validRev && Number.isFinite(amt)) {
        totalRev += amt;
        if (Number.isFinite(net)) totalNetProfit += net;
      }
      if (ms >= d24) {
        o24 += 1;
        if (isTg) tg24 += 1;
        if (validRev && Number.isFinite(amt)) r24 += amt;
      }
      if (ms >= d7) {
        o7 += 1;
        if (validRev && Number.isFinite(amt)) r7 += amt;
      }
    }

    let totalWalletLiability = 0;
    for (const d of customersSnap.docs) {
      totalWalletLiability += Number(d.data()?.walletBalance || 0);
    }

    let approvedDeposits = 0;
    for (const d of topupsSnap.docs) {
      approvedDeposits += Number(d.data()?.amount || 0);
    }

    const lines = [
      '📊 Full Store Analytics Report',
      '',
      '🕒 গত ২৪ ঘণ্টা:',
      `• মোট অর্ডার: ${o24} (Telegram Bot: ${tg24})`,
      `• আয়: ৳${r24.toFixed(0)}`,
      '',
      '📅 গত ৭ দিন:',
      `• মোট অর্ডার: ${o7} | আয়: ৳${r7.toFixed(0)}`,
      '',
      '🏆 সর্বমোট (All-Time):',
      `• মোট অর্ডার: ${total} (Completed: ${completed})`,
      `• Pending: ${pending} | Processing: ${processing}`,
      `• Cancelled: ${cancelled} | Expired: ${expired}`,
      `• মোট বিক্রি: ৳${totalRev.toFixed(0)}`,
      ...(totalNetProfit > 0 ? [`• আনুমানিক নেট লাভ: ৳${totalNetProfit.toFixed(0)}`] : []),
      `• Approved Wallet Deposits: ৳${approvedDeposits.toFixed(0)}`,
      `• মোট কাস্টমার: ${customersSnap.size} (Wallet Liability: ৳${totalWalletLiability.toFixed(0)})`,
      `• Unused SMS: ${smsSnap.size} | Vault PIN Stock: ${pinsSnap.size}`,
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), [
      [
        {text: '📥 Reports & CSV', callback_data: 'adm:rp'},
        {text: '🔄 Refresh', callback_data: 'adm:st'},
      ],
      [
        {text: '📜 Logs', callback_data: 'adm:lg:srv'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ]);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderReportsAndCsvPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const vaultSnap = await deps.adminDb.collection('voucherStock').where('status', '==', 'unused').get();
    const buckets = new Map<string, {name: string; count: number}>();
    for (const d of vaultSnap.docs) {
      const v = d.data() as {productName?: string; packageName?: string; productId?: string; packageId?: string};
      const k = `${v.productId || ''}::${v.packageId || ''}`;
      const cur = buckets.get(k) || {
        name: `${v.productName || 'Product'} (${v.packageName || 'Pkg'})`,
        count: 0,
      };
      cur.count += 1;
      buckets.set(k, cur);
    }
    const lowStock = Array.from(buckets.values()).filter((b) => b.count < 5);

    const lines = [
      ...(banner ? [banner, ''] : []),
      '📥 Real-Time CSV Reports & Daily Auto-Summary',
      '',
      'নিচের যেকোনো বাটনে ট্যাপ করলে Excel-ready CSV ফাইল সরাসরি আপনার টেলিগ্রাম চ্যাটে ডাউনলোড হয়ে যাবে:',
      '',
      '⚠️ Low-Stock PIN Alerts (< 5 unused):',
      ...(lowStock.length > 0
        ? lowStock.slice(0, 6).map((b) => `• ${b.name}: মাত্র ${b.count} টি PIN বাকি`)
        : ['• ✅ সব প্যাকেজের PIN স্টক পর্যাপ্ত আছে']),
      '',
      '🕛 প্রতিদিন রাত ১২:০০ টায় (BD Time) অটো-সামারি টেলিগ্রাম ও ইমেইলে পাঠানো হয়।',
    ];

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), [
      [
        {text: '📄 Orders CSV (30d)', callback_data: 'adm:rp:orders:30'},
        {text: '📈 Daily Profit CSV', callback_data: 'adm:rp:daily_summary:30'},
      ],
      [
        {text: '💳 Deposits CSV (30d)', callback_data: 'adm:rp:transactions:30'},
        {text: '📨 Send Daily Summary Now', callback_data: 'adm:rp:daily'},
      ],
      [
        {text: '📊 Analytics', callback_data: 'adm:st'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ]);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderReviewsAdminPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  mode: 'pending' | 'list',
  page: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('reviews').get();
    const all = snap.docs
      .map((d) => {
        const r = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          customerName: String(r.customerName || 'Gamer'),
          productName: String(r.productName || 'Top-Up'),
          rating: Number(r.rating || 5),
          comment: String(r.comment || ''),
          approved: r.approved === true,
          source: String(r.source || 'customer'),
          createdMs: deps.parseTimestampMillis(r.createdAt),
        };
      })
      .sort((a, b) => b.createdMs - a.createdMs);

    const pendingCount = all.filter((r) => !r.approved).length;
    const filtered = mode === 'pending' ? all.filter((r) => !r.approved) : all;
    const perPage = 5;
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = filtered.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `⭐ Customer Reviews Moderation (${pendingCount} Pending / ${all.length} Total)`,
      `View: ${mode === 'pending' ? 'Pending Approval' : 'All Reviews'} (Page ${safePage + 1}/${totalPages})`,
      '',
      ...(slice.length === 0
        ? [mode === 'pending' ? '✅ কোনো পেন্ডিং রিভিউ নেই।' : 'কোনো রিভিউ নেই।']
        : slice.map(
            (r) =>
              `• ${r.approved ? '🟢' : '🟡'} ${'★'.repeat(Math.min(5, Math.max(1, r.rating)))} ${r.customerName} (${r.productName})\n  "${r.comment.slice(0, 85)}"`,
          )),
    ];

    const buttons: InlineButton[][] = slice.map((r) => {
      const ref = encodeRef(r.id);
      return r.approved
        ? [
            {text: `🚫 Hide (${r.customerName.slice(0, 14)})`, callback_data: `adm:rv_hd:${ref}`},
            {text: '🗑️ Delete', callback_data: `adm:rv_del:${ref}`},
          ]
        : [
            {text: `✅ Approve (${r.customerName.slice(0, 14)})`, callback_data: `adm:rv_ap:${ref}`},
            {text: '🗑️ Delete', callback_data: `adm:rv_del:${ref}`},
          ];
    });

    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:rv:${mode}:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:rv:${mode}:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);

    buttons.push([
      {text: `🟡 Pending (${pendingCount})`, callback_data: 'adm:rv:pending:0'},
      {text: `📋 All (${all.length})`, callback_data: 'adm:rv:list:0'},
    ]);
    buttons.push([
      {text: '🌱 Seed 100 Reviews', callback_data: 'adm:rv_seed'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderResellerKeysPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('resellerKeys').get();
    const list = snap.docs
      .map((d) => {
        const k = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          label: String(k.label || 'Reseller Key'),
          customerEmail: String(k.customerEmail || ''),
          keyPrefix: String(k.keyPrefix || 'mk_live_...'),
          active: k.active === true,
          totalRequests: Number(k.totalRequests || 0),
          totalSpent: Number(k.totalSpent || 0),
          createdMs: deps.parseTimestampMillis(k.createdAt),
        };
      })
      .sort((a, b) => b.createdMs - a.createdMs);

    const perPage = 5;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [
      ...(banner ? [banner, ''] : []),
      `🔑 Public Reseller API v1 Keys (${list.length} টি)`,
      'Endpoints: /api/v1/products · /api/v1/balance · /api/v1/order',
      '',
      ...(slice.length === 0
        ? ['এখনো কোনো Reseller API Key তৈরি করা হয়নি।']
        : slice.map(
            (k) =>
              `• ${k.active ? '🟢' : '🔴'} ${k.label} (${k.keyPrefix})\n  ${k.customerEmail || '—'} · Req: ${k.totalRequests} · Spent: ৳${k.totalSpent}`,
          )),
    ];

    const buttons: InlineButton[][] = slice.map((k) => {
      const ref = encodeRef(k.id);
      return [
        {text: `${k.active ? '🔴 Disable' : '🟢 Enable'} ${k.label.slice(0, 14)}`, callback_data: `adm:rk_t:${ref}`},
        {text: '🗑️ Revoke', callback_data: `adm:rk_d:${ref}`},
      ];
    });
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:rk:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:rk:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);

    buttons.push([
      {text: '➕ Issue New API Key', callback_data: 'adm:rk_add'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderLogsPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  kind: 'srv' | 'aud' | 'api',
  messageId?: number,
): Promise<void> {
  try {
    let lines: string[] = [];
    if (kind === 'srv') {
      const logs = deps.readStore().serverLogs.slice(0, 12);
      lines = [
        '📜 Server Auth & System Logs (Last 12)',
        '',
        ...(logs.length === 0
          ? ['কোনো লগ নেই।']
          : logs.map((l) => `• ${l.action} — ${l.details.slice(0, 90)}`)),
      ];
    } else if (kind === 'aud' && deps.adminDb) {
      const snap = await deps.adminDb.collection('auditLogs').get();
      const sorted: Array<Record<string, unknown> & {ms: number}> = snap.docs
        .map((d) => ({...(d.data() as Record<string, unknown>), ms: deps.parseTimestampMillis(d.data()?.createdAt)}))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12);
      lines = [
        '🛡️ Firestore Audit Logs (Last 12)',
        '',
        ...(sorted.length === 0
          ? ['কোনো অডিট লগ নেই।']
          : sorted.map(
              (l) =>
                `• ${String(l['action'] || '')} (${String(l['targetId'] || '')}) — ${String(l['details'] || '').slice(0, 70)}`,
            )),
      ];
    } else if (kind === 'api' && deps.adminDb) {
      const snap = await deps.adminDb.collection('apiLogs').get();
      const sorted: Array<Record<string, unknown> & {ms: number}> = snap.docs
        .map((d) => ({...(d.data() as Record<string, unknown>), ms: deps.parseTimestampMillis(d.data()?.createdAt)}))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12);
      lines = [
        '⚡ API, Gateway, PIN Vault & Fraud Logs (Last 12)',
        '',
        ...(sorted.length === 0
          ? ['কোনো API লগ নেই।']
          : sorted.map(
              (l) =>
                `• [${String(l['type'] || '')}/${String(l['status'] || '')}] ${String(l['orderNumber'] || '')} — ${String(l['message'] || '').slice(0, 70)}`,
            )),
      ];
    }

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), [
      [
        {text: 'Server Logs', callback_data: 'adm:lg:srv'},
        {text: 'Audit Logs', callback_data: 'adm:lg:aud'},
        {text: 'API Logs', callback_data: 'adm:lg:api'},
      ],
      [
        {text: '⚙️ System', callback_data: 'adm:sy'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ]);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

// ---------------------------------------------------------------------------
// SYSTEM, EMAIL (BREVO/SMTP), TELEGRAM ADMIN CHAT IDS, SUB-ADMINS & COMMERCE
// ---------------------------------------------------------------------------

async function renderSystemPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  const store = deps.readStore();
  const s = store.systemSettings;
  const stats = deps.getBotRuntimeStats();
  const mail = deps.resolveMailStatus();
  const adminIds = getConfiguredTelegramAdminChatIds(deps);

  const lines = [
    ...(banner ? [banner, ''] : []),
    '⚙️ System, Email & Bot Controls',
    '',
    `📧 Mail Transport: ${
      mail.transport === 'brevo'
        ? `🟢 Brevo REST API (${mail.sender || 'no sender'})`
        : mail.transport === 'smtp'
          ? `🟢 SMTP (${mail.sender || 'configured'})`
          : '🔴 Not Configured'
    }`,
    `📬 Admin Alert Email: ${mail.toEmail}`,
    `📩 Customer Emails: ${s.customerEmailNotificationsEnabled !== false ? '🟢 ON' : '🔴 OFF'}`,
    `🚨 Admin Telegram Alerts: ${s.telegramAdminOrderAlerts !== false ? '🟢 ON' : '🔴 OFF'}`,
    `🔘 Bot Quick Replies: ${s.telegramQuickRepliesEnabled !== false ? '🟢 ON' : '🔴 OFF'}`,
    `🔌 Outbound SMTP Toggle: ${s.smtpEnabled ? '🟢 ON' : '🔴 OFF'}`,
    `🛡️ Authorized Telegram Admins: ${adminIds.length}`,
    '',
    `🤖 Updates Processed: ${stats.processedUpdates}`,
    `⏱️ Expiry Cron: ${stats.expiryRunning ? 'Active' : 'Stopped'} (Expired: ${stats.expiryTotalExpired})`,
    ...(stats.expiryLastError ? [`⚠️ Cron Note: ${stats.expiryLastError.slice(0, 120)}`] : []),
    `🆔 Your Chat ID: ${chatId}`,
  ];

  const buttons: InlineButton[][] = [
    [
      {text: `Cust Email: ${s.customerEmailNotificationsEnabled !== false ? 'ON' : 'OFF'}`, callback_data: 'adm:sy_t:cust_email'},
      {text: `Admin Alerts: ${s.telegramAdminOrderAlerts !== false ? 'ON' : 'OFF'}`, callback_data: 'adm:sy_t:alerts'},
    ],
    [
      {text: `Quick Replies: ${s.telegramQuickRepliesEnabled !== false ? 'ON' : 'OFF'}`, callback_data: 'adm:sy_t:qr'},
      {text: `SMTP Toggle: ${s.smtpEnabled ? 'ON' : 'OFF'}`, callback_data: 'adm:sy_t:smtp'},
    ],
    [
      {text: '✉️ Test Email (Brevo/SMTP)', callback_data: 'adm:sy_mail'},
      {text: '⏱️ Run Expiry Now', callback_data: 'adm:sy_exp'},
    ],
    [
      {text: `🆔 Admin Chat IDs (${adminIds.length})`, callback_data: 'adm:sy_ids'},
      {text: '👥 Sub-Admins', callback_data: 'adm:sy_sub'},
    ],
    [
      {text: '📊 Commerce Rules', callback_data: 'adm:sy_com'},
      {text: '📜 Logs', callback_data: 'adm:lg:srv'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ],
  ];

  await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
}

async function renderAdminChatIdsPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  const store = deps.readStore();
  const storeIds = store.systemSettings.telegramAdminChatIds || [];
  const allIds = getConfiguredTelegramAdminChatIds(deps);

  const lines = [
    ...(banner ? [banner, ''] : []),
    `🆔 Authorized Telegram Admin Chat IDs (${allIds.length})`,
    'স্থায়ী অনুমোদিত এডমিনরা পাসওয়ার্ড ছাড়াই /admin খুলতে পারবেন।',
    '',
    ...allIds.map((id) => {
      const inStore = storeIds.includes(String(id));
      return `• ${id}${id === chatId ? ' (You)' : ''} ${inStore ? '[Saved]' : '[ENV]'}`;
    }),
  ];

  const buttons: InlineButton[][] = [
    [
      ...(!storeIds.includes(String(chatId))
        ? [{text: '📌 Add My Chat ID', callback_data: 'adm:sy_id_self'}]
        : []),
      {text: '➕ Add Other Chat ID', callback_data: 'adm:sy_id_add'},
    ],
    ...storeIds.slice(0, 8).map((id) => [
      {text: `🗑️ Remove ${id}`, callback_data: `adm:sy_id_del:${id}`},
    ]),
    [
      {text: '⬅️ System', callback_data: 'adm:sy'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ],
  ];

  await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
}

async function renderSubAdminsPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  const store = deps.readStore();
  const staffList = Object.values(store.staff || {});

  const lines = [
    ...(banner ? [banner, ''] : []),
    `👥 Admin & Sub-Admin Accounts (${staffList.length})`,
    '',
    ...staffList.map(
      (s) =>
        `• ${s.active ? '🟢' : '🔴'} ${s.name} (${s.role})\n  ${s.email}`,
    ),
  ];

  const buttons: InlineButton[][] = staffList
    .filter((s) => s.email !== deps.superAdminEmail)
    .slice(0, 10)
    .map((s) => [
      {
        text: `${s.active ? '🟢 Disable' : '🔴 Enable'}: ${s.email.slice(0, 26)}`,
        callback_data: `adm:sy_sub_t:${encodeRef(s.email)}`,
      },
    ]);
  buttons.push([
    {text: '⬅️ System', callback_data: 'adm:sy'},
    {text: '🏠 Home', callback_data: 'adm:home'},
  ]);

  await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
}

// ---------------------------------------------------------------------------
// TEXT COMMANDS & PROMPT SUBMISSIONS
// ---------------------------------------------------------------------------

export async function handleTelegramAdminCommand(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  fromId: number | undefined,
  rawText: string,
  businessConnectionId?: string,
): Promise<boolean> {
  if (businessConnectionId) return false;
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  if (lower === '/myid' || lower === '/id') {
    const isAuth = isTelegramAdminAuthorized(deps, chatId, fromId, businessConnectionId);
    await deps.sendTelegramReply(
      token,
      chatId,
      [
        `🆔 আপনার Telegram Chat ID: ${chatId}`,
        `🛡️ Admin Status: ${isAuth ? 'Authorized ✅' : 'Not Authorized'}`,
        '',
        'স্থায়ী অ্যাক্সেসের জন্য ওয়েবসাইটের Admin Settings > Telegram Admin Chat IDs-এ এই ID যোগ করুন, অথবা `/admin আপনার_পাসওয়ার্ড` লিখে লগইন করুন।',
      ].join('\n'),
    );
    return true;
  }

  // Handle pending admin interactive text prompt (e.g. login password, voucher, note, price edit)
  const prompt = adminPromptStates.get(chatId);
  if (prompt) {
    if (Date.now() - prompt.createdAt > PROMPT_TTL_MS) {
      adminPromptStates.delete(chatId);
    } else if (/^(?:বাতিল|cancel|\/cancel)$/i.test(trimmed)) {
      adminPromptStates.delete(chatId);
      if (isTelegramAdminAuthorized(deps, chatId, fromId, businessConnectionId)) {
        await renderAdminHome(deps, token, chatId);
      } else {
        await deps.sendTelegramReply(token, chatId, '❌ বাতিল করা হয়েছে।');
      }
      return true;
    } else if (prompt.type === 'login_password') {
      // Allow /admin or /panel commands inside login prompt without failing
      if (lower === '/admin' || lower === '/panel') {
        await deps.sendTelegramReply(
          token,
          chatId,
          [
            '🔐 আপনার Admin Password লিখে পাঠান:',
            `🆔 Chat ID: ${chatId}`,
            '❌ বাতিল করতে "cancel" লিখুন।',
          ].join('\n'),
        );
        return true;
      }
      if (/^\/admin\s+/i.test(trimmed)) {
        const arg = trimmed.replace(/^\/admin\s+/i, '').trim();
        await attemptAdminPasswordLogin(deps, token, chatId, arg);
        return true;
      }
      // Keep prompt active inside attemptAdminPasswordLogin until success, cancel, or lockout!
      await attemptAdminPasswordLogin(deps, token, chatId, trimmed);
      return true;
    } else if (isTelegramAdminAuthorized(deps, chatId, fromId, businessConnectionId)) {
      adminPromptStates.delete(chatId);
      await handleAdminPromptSubmission(deps, token, chatId, prompt, trimmed);
      return true;
    }
  }

  // /order <query> shortcut for authorized admins
  if (/^\/order\s+/i.test(trimmed) && isTelegramAdminAuthorized(deps, chatId, fromId, businessConnectionId)) {
    const queryText = trimmed.replace(/^\/order\s+/i, '').trim();
    await searchAndShowOrders(deps, token, chatId, queryText);
    return true;
  }

  if (lower === '/admin' || lower === '/panel' || /^\/(?:admin|panel)\s+/i.test(trimmed)) {
    const arg = trimmed.replace(/^\/(?:admin|panel)\s*/i, '').trim();
    if (arg) {
      await attemptAdminPasswordLogin(deps, token, chatId, arg);
      return true;
    }
    if (isTelegramAdminAuthorized(deps, chatId, fromId, businessConnectionId)) {
      await renderAdminHome(deps, token, chatId);
      return true;
    }
    adminPromptStates.set(chatId, {type: 'login_password', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      [
        '🔐 Telegram Admin Panel লগইন:',
        '',
        'অনুগ্রহ করে আপনার Admin Password পাঠান (ওয়েবসাইটের Admin Login-এ যে পাসওয়ার্ড ব্যবহার করেন অথবা ADMIN_PASSCODE)।',
        `🆔 আপনার Chat ID: ${chatId}`,
        '',
        '💡 টিপস: ওয়েবসাইটের Admin Settings > Telegram Admin Chat IDs-এ উপরের Chat ID যোগ করলে আর পাসওয়ার্ড লাগবে না।',
        '❌ বাতিল করতে "cancel" লিখুন।',
      ].join('\n'),
    );
    return true;
  }

  return false;
}

async function attemptAdminPasswordLogin(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  password: string,
): Promise<void> {
  const attempt = failedLoginAttempts.get(chatId);
  if (attempt && attempt.lockUntil > Date.now()) {
    adminPromptStates.delete(chatId);
    const mins = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
    await deps.sendTelegramReply(
      token,
      chatId,
      `⏳ অনেকবার ভুল পাসওয়ার্ড দেওয়ায় ${mins} মিনিটের জন্য লক করা হয়েছে।`,
    );
    return;
  }

  const check = verifyTelegramAdminPassword(deps, password);
  if (!check.valid) {
    if (check.reason === 'no_password_configured') {
      adminPromptStates.delete(chatId);
      await deps.sendTelegramReply(
        token,
        chatId,
        [
          '⚠️ সার্ভারে এখনো কোনো Admin Password সেট করা নেই!',
          '',
          'সমাধান (যেকোনো একটি করুন):',
          '1) ওয়েবসাইটের /admin লগইন পেজ থেকে Google Sign-In করে Settings > Security-তে একটি Admin Password সেট করুন,',
          `2) অথবা Admin Settings > Telegram Admin Chat IDs-এ আপনার Chat ID (${chatId}) যোগ করে Save করুন।`,
        ].join('\n'),
      );
      return;
    }

    const nextCount = (attempt?.count || 0) + 1;
    const locked = nextCount >= MAX_FAILED_ATTEMPTS;
    failedLoginAttempts.set(chatId, {
      count: nextCount,
      lockUntil: locked ? Date.now() + LOCKOUT_MS : 0,
    });
    if (locked) {
      adminPromptStates.delete(chatId);
      await deps.sendTelegramReply(
        token,
        chatId,
        '⏳ পরপর ৫ বার ভুল পাসওয়ার্ড দেওয়ায় ১৫ মিনিটের জন্য লক করা হয়েছে।',
      );
      return;
    }

    // Keep login prompt active so user can immediately retry without falling into customer bot!
    adminPromptStates.set(chatId, {type: 'login_password', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      [
        `❌ ভুল Admin Password! (${nextCount}/${MAX_FAILED_ATTEMPTS})`,
        'আবার সঠিক Admin Password পাঠান (অথবা বাতিল করতে "cancel" লিখুন)।',
        `🆔 Chat ID: ${chatId}`,
      ].join('\n'),
    );
    return;
  }

  failedLoginAttempts.delete(chatId);
  adminPromptStates.delete(chatId);
  authenticatedAdminSessions.set(chatId, {
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
    label: `tg_admin_${chatId}`,
    email: check.email,
  });

  const store = deps.readStore();
  deps.appendServerLog(
    store,
    check.email || `tg_admin_${chatId}`,
    'TELEGRAM_ADMIN_LOGIN',
    `Telegram chat ${chatId} authenticated to Admin Panel`,
  );
  deps.writeStore(store);

  await deps.sendTelegramReply(
    token,
    chatId,
    `✅ Telegram Admin Panel-এ স্বাগতম (${check.email})!\n🔒 নিরাপত্তার জন্য চ্যাট থেকে আপনার পাসওয়ার্ড মেসেজটি ডিলিট করে দিন।`,
  );
  await renderAdminHome(deps, token, chatId);
}

async function searchAndShowOrders(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  queryStr: string,
): Promise<void> {
  if (!deps.adminDb) {
    await deps.sendTelegramReply(token, chatId, '🔴 Firestore Admin SDK সংযুক্ত নয়।');
    return;
  }
  const q = queryStr.trim().toLowerCase();
  try {
    const snap = await deps.adminDb.collection('orders').get();
    const matches = snap.docs
      .map((d) => {
        const o = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          orderNumber: String(o.orderNumber || d.id),
          trxId: String(o.trxId || ''),
          playerUid: String(o.playerUid || ''),
          customerEmail: String(o.customerEmail || ''),
          packageName: String(o.packageName || ''),
          totalAmount: Number(o.totalAmount || 0),
          orderStatus: String(o.orderStatus || 'pending'),
          createdAtMs: deps.parseTimestampMillis(o.createdAt),
        };
      })
      .filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.trxId.toLowerCase().includes(q) ||
          o.playerUid.toLowerCase().includes(q) ||
          o.customerEmail.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 8);

    if (matches.length === 1) {
      await renderOrderInspector(deps, token, chatId, matches[0].id);
      return;
    }

    if (matches.length === 0) {
      await deps.sendTelegramReply(token, chatId, `🔍 "${queryStr}" অনুযায়ী কোনো অর্ডার পাওয়া যায়নি।`, undefined, {
        inline_keyboard: [[{text: '🏠 Admin Home', callback_data: 'adm:home'}]],
      });
      return;
    }

    await sendOrEditPanel(
      deps,
      token,
      chatId,
      undefined,
      `🔍 Search Results for "${queryStr}" (${matches.length} টি):`,
      [
        ...matches.map((o) => [
          {
            text: `${o.orderNumber} · ৳${o.totalAmount} · ${o.playerUid || o.trxId} (${o.orderStatus})`,
            callback_data: `adm:oi:${encodeRef(o.id)}`,
          },
        ]),
        [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
      ],
    );
  } catch (err) {
    await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
  }
}

async function handleAdminPromptSubmission(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  prompt: TelegramAdminPromptState,
  inputText: string,
): Promise<void> {
  if (prompt.type === 'order_search') {
    await searchAndShowOrders(deps, token, chatId, inputText);
    return;
  }

  if (prompt.type === 'order_voucher' && prompt.targetId) {
    const res = await executeAdminOrderAction(deps, 'cp', prompt.targetId, inputText);
    await renderOrderInspector(deps, token, chatId, prompt.targetId, undefined, res.msg);
    return;
  }

  if (prompt.type === 'order_note' && prompt.targetId && deps.adminDb) {
    try {
      const orderRef = deps.adminDb.collection('orders').doc(prompt.targetId);
      const snap = await orderRef.get();
      if (!snap.exists) {
        await deps.sendTelegramReply(token, chatId, '❌ অর্ডার পাওয়া যায়নি।');
        return;
      }
      const o = snap.data() as Record<string, unknown>;
      const orderNumber = String(o.orderNumber || snap.id);
      const cleanNote = inputText.trim().slice(0, 500);
      const now = FieldValue.serverTimestamp();
      const batch = deps.adminDb.batch();
      batch.update(orderRef, {notificationMessage: cleanNote, adminNote: cleanNote, updatedAt: now});
      batch.set(
        deps.adminDb.collection('orderTracking').doc(orderNumber),
        {notificationMessage: cleanNote, updatedAt: now},
        {merge: true},
      );
      if (o.customerUid) {
        const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(deps.adminDb.collection('notifications').doc(notifId), {
          id: notifId,
          customerUid: String(o.customerUid),
          orderId: snap.id,
          orderNumber,
          title: 'Order Update',
          message: cleanNote,
          read: false,
          createdAt: now,
        });
      }
      await batch.commit();

      const status = String(o.orderStatus || 'pending') as
        | 'pending'
        | 'processing'
        | 'completed'
        | 'cancelled'
        | 'expired';
      const payStatus = String(o.paymentStatus || 'pending') as 'pending' | 'verified' | 'rejected';
      await Promise.all([
        deps.sendCustomerOrderEmail({
          toEmail: String(o.customerEmail || ''),
          customerName: String(o.customerName || ''),
          orderNumber,
          orderStatus: status,
          paymentStatus: payStatus,
          productName: String(o.productName || 'Top-up'),
          packageName: String(o.packageName || 'Package'),
          playerUid: String(o.playerUid || ''),
          totalAmount: Number(o.totalAmount || 0),
          trxId: String(o.trxId || ''),
          voucherCode: String(o.voucherCode || ''),
          note: cleanNote,
        }),
        deps.sendTelegramOrderStatusUpdate({
          orderNumber,
          orderStatus: status,
          paymentStatus: payStatus,
          productName: String(o.productName || 'Top-up'),
          packageName: String(o.packageName || 'Package'),
          playerUid: String(o.playerUid || ''),
          totalAmount: Number(o.totalAmount || 0),
          note: cleanNote,
          customerUid: String(o.customerUid || ''),
        }),
      ]);

      await renderOrderInspector(deps, token, chatId, prompt.targetId, undefined, '✅ কাস্টমারকে বার্তা ও ইমেইল পাঠানো হয়েছে!');
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'ticket_reply' && prompt.targetId && deps.adminDb) {
    try {
      const tktRef = deps.adminDb.collection('tickets').doc(prompt.targetId);
      const snap = await tktRef.get();
      if (!snap.exists) {
        await deps.sendTelegramReply(token, chatId, '❌ টিকেট পাওয়া যায়নি।');
        return;
      }
      const k = snap.data() as Record<string, unknown>;
      const reply = inputText.trim().slice(0, 2000);
      const now = FieldValue.serverTimestamp();
      const batch = deps.adminDb.batch();
      batch.update(tktRef, {
        status: 'replied',
        adminReply: reply,
        repliedBy: 'telegram_admin',
        updatedAt: now,
      });
      if (k.customerUid) {
        const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(deps.adminDb.collection('notifications').doc(notifId), {
          id: notifId,
          customerUid: String(k.customerUid),
          orderId: snap.id,
          orderNumber: String(k.orderNumber || snap.id).slice(0, 32),
          title: `Support Reply: ${String(k.subject || 'Ticket').slice(0, 80)}`,
          message: reply.slice(0, 500),
          read: false,
          createdAt: now,
        });
      }
      await batch.commit();

      await deps.sendCustomerGenericEmail({
        toEmail: String(k.customerEmail || ''),
        customerName: String(k.customerName || ''),
        subject: `Support Ticket Reply — ${String(k.subject || snap.id)}`,
        headline: 'Support Team Replied to Your Ticket',
        message: reply,
        rows: [
          {label: 'Ticket Subject', value: String(k.subject || '—')},
          ...(k.orderNumber ? [{label: 'Order Number', value: String(k.orderNumber)}] : []),
          {label: 'Status', value: 'REPLIED'},
        ],
      });

      await renderTicketInspector(deps, token, chatId, prompt.targetId, undefined, '✅ টিকেটে রিপ্লাই ও ইমেইল পাঠানো হয়েছে!');
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (
    (prompt.type === 'package_price' || prompt.type === 'package_cost') &&
    prompt.targetId &&
    typeof prompt.extraIndex === 'number' &&
    deps.adminDb
  ) {
    const numVal = Number(inputText.replace(/[^\d.]/g, ''));
    const isCost = prompt.type === 'package_cost';
    if (!Number.isFinite(numVal) || (isCost ? numVal < 0 : numVal <= 0) || numVal > 1000000) {
      await deps.sendTelegramReply(token, chatId, '❌ সঠিক সংখ্যা (যেমন: 165) দিন।');
      return;
    }
    try {
      const prodRef = deps.adminDb.collection('products').doc(prompt.targetId);
      const snap = await prodRef.get();
      if (!snap.exists) return;
      const p = snap.data() as {packages?: Array<Record<string, unknown>>};
      const pkgs = Array.isArray(p.packages) ? [...p.packages] : [];
      if (!pkgs[prompt.extraIndex]) return;
      pkgs[prompt.extraIndex] = {
        ...pkgs[prompt.extraIndex],
        ...(isCost ? {costPrice: Number(numVal.toFixed(2))} : {price: Number(numVal.toFixed(2))}),
      };
      await prodRef.update({packages: pkgs, updatedAt: FieldValue.serverTimestamp()});
      deps.invalidateBotStoreCache();
      await renderProductInspector(
        deps,
        token,
        chatId,
        prompt.targetId,
        undefined,
        `✅ প্যাকেজ ${isCost ? 'Cost Price' : 'Sale Price'} ৳${numVal} আপডেট হয়েছে!`,
      );
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'package_add' && prompt.targetId && deps.adminDb) {
    // Format: Name | Price | Optional CostPrice
    const parts = inputText.split('|').map((s) => s.trim());
    const name = parts[0] || '';
    const price = Number((parts[1] || '').replace(/[^\d.]/g, ''));
    const costPrice = parts[2] ? Math.max(0, Number(parts[2].replace(/[^\d.]/g, '')) || 0) : 0;
    if (name.length < 2 || !Number.isFinite(price) || price <= 0) {
      await deps.sendTelegramReply(token, chatId, '❌ ফরম্যাট সঠিক নয়। লিখুন: Package Name | Price | CostPrice\nযেমন: 115 Diamonds | 85 | 78');
      return;
    }
    try {
      const prodRef = deps.adminDb.collection('products').doc(prompt.targetId);
      const snap = await prodRef.get();
      if (!snap.exists) return;
      const pkgs = [...((snap.data()?.packages as Array<Record<string, unknown>>) || [])];
      pkgs.push({
        id: `pkg_${Date.now()}`,
        name: name.slice(0, 80),
        quantityLabel: name.slice(0, 80),
        price: Number(price.toFixed(2)),
        originalPrice: Number(price.toFixed(2)),
        costPrice,
        promoLabel: '',
        imageUrl: '',
        active: true,
        displayOrder: pkgs.length + 1,
      });
      await prodRef.update({packages: pkgs, updatedAt: FieldValue.serverTimestamp()});
      deps.invalidateBotStoreCache();
      await renderProductInspector(deps, token, chatId, prompt.targetId, undefined, `✅ নতুন প্যাকেজ "${name}" (৳${price}) যোগ হয়েছে!`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'product_add' && deps.adminDb) {
    // Format: Product Name | Category Name | First Package Name | Price
    const parts = inputText.split('|').map((s) => s.trim());
    const pName = parts[0] || '';
    const catName = parts[1] || 'Top-Up';
    const pkgName = parts[2] || '100 Diamonds';
    const price = Number((parts[3] || '').replace(/[^\d.]/g, '')) || 100;
    if (pName.length < 2) {
      await deps.sendTelegramReply(token, chatId, '❌ লিখুন: Product Name | Category | Package Name | Price');
      return;
    }
    try {
      const catsSnap = await deps.adminDb.collection('categories').get();
      const existingCat = catsSnap.docs.find((d) => String(d.data()?.name || '').toLowerCase() === catName.toLowerCase());
      let resolvedCatId = existingCat?.id || '';
      let resolvedCatName = String(existingCat?.data()?.name || catName).slice(0, 80);
      if (!resolvedCatId) {
        resolvedCatId = `cat_${Date.now()}`;
        resolvedCatName = catName.slice(0, 80);
        await deps.adminDb.collection('categories').doc(resolvedCatId).set({
          id: resolvedCatId,
          name: resolvedCatName,
          slug: slugify(catName).slice(0, 80),
          description: '',
          imageUrl: '',
          displayOrder: catsSnap.size + 1,
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      const prodId = `prod_${Date.now()}`;
      const now = FieldValue.serverTimestamp();
      await deps.adminDb.collection('products').doc(prodId).set({
        id: prodId,
        name: pName.slice(0, 120),
        slug: slugify(pName).slice(0, 120),
        categoryId: resolvedCatId,
        categoryName: resolvedCatName,
        shortDescription: `${pName} instant digital top-up`,
        description: `${pName} fast & automated delivery.`,
        instructions: 'Enter your Player UID carefully before payment.',
        images: ['/src/assets/images/product_ff_diamonds_1795604333340.jpg'],
        requiresUid: true,
        uidLabel: 'Player UID',
        requiresServerId: false,
        serverLabel: 'Server ID',
        serverOptions: [],
        packages: [
          {
            id: `pkg_${Date.now()}`,
            name: pkgName.slice(0, 80),
            quantityLabel: pkgName.slice(0, 80),
            price,
            originalPrice: price,
            promoLabel: '',
            imageUrl: '',
            active: true,
            displayOrder: 1,
          },
        ],
        active: true,
        featured: true,
        displayOrder: 1,
        createdAt: now,
        updatedAt: now,
      });
      deps.invalidateBotStoreCache();
      await renderProductInspector(deps, token, chatId, prodId, undefined, `✅ নতুন প্রোডাক্ট "${pName}" তৈরি হয়েছে!`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'payment_number' && prompt.targetId && deps.adminDb) {
    const cleanNum = inputText.trim().slice(0, 40);
    if (cleanNum.length < 3) {
      await deps.sendTelegramReply(token, chatId, '❌ সঠিক অ্যাকাউন্ট নম্বর দিন।');
      return;
    }
    try {
      await deps.adminDb
        .collection('paymentMethods')
        .doc(prompt.targetId)
        .update({accountNumber: cleanNum, updatedAt: FieldValue.serverTimestamp()});
      deps.invalidateBotStoreCache();
      await renderPaymentMethodsPanel(deps, token, chatId, undefined, `✅ নম্বর আপডেট হয়েছে: ${cleanNum}`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'payment_add' && deps.adminDb) {
    // Format: Provider | Number | Type(Personal/Merchant/Agent)
    const parts = inputText.split('|').map((s) => s.trim());
    const name = (parts[0] || '').slice(0, 60);
    const num = (parts[1] || '').slice(0, 40);
    const rawType = (parts[2] || 'Personal').toLowerCase();
    const accountType = rawType.includes('merch')
      ? 'Merchant'
      : rawType.includes('agent')
        ? 'Agent'
        : 'Personal';
    if (!name || num.length < 3) {
      await deps.sendTelegramReply(token, chatId, '❌ লিখুন: Provider | Number | Personal/Merchant/Agent\nযেমন: Rocket | 017XXXXXXXX | Personal');
      return;
    }
    try {
      const id = `pm_${Date.now()}`;
      await deps.adminDb.collection('paymentMethods').doc(id).set({
        id,
        name,
        accountNumber: num,
        accountType,
        instructions: `Open ${name} App → Send Money → Enter ${num} → Copy and enter your TrxID below.`,
        logoUrl: '',
        active: true,
        displayOrder: 5,
        updatedAt: FieldValue.serverTimestamp(),
      });
      deps.invalidateBotStoreCache();
      await renderPaymentMethodsPanel(deps, token, chatId, undefined, `✅ ${name} (${num}) যোগ করা হয়েছে!`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'sms_search' && deps.adminDb) {
    const q = inputText.trim().toUpperCase();
    try {
      const snap = await deps.adminDb.collection('sms_payments').get();
      const rows = snap.docs.map((d) => {
        const data = (d.data() || {}) as {
          trxId?: string;
          usedOrderNumber?: string;
          used?: boolean;
          method?: string;
          amount?: number;
        };
        return {
          id: d.id,
          trxId: data.trxId,
          usedOrderNumber: data.usedOrderNumber,
          used: data.used,
          method: data.method,
          amount: data.amount,
        };
      });
      const matches = rows
        .filter(
          (s) =>
            String(s.trxId || s.id).toUpperCase().includes(q) ||
            String(s.usedOrderNumber || '').toUpperCase().includes(q),
        )
        .slice(0, 10);
      const lines = [
        `🔍 SMS TrxID Search: "${q}" (${matches.length} টি)`,
        '',
        ...(matches.length === 0
          ? ['কোনো ম্যাচিং SMS পাওয়া যায়নি।']
          : matches.map(
              (s) =>
                `• ${s.used === true ? '⚪ Used' : '🟢 Unused'} | ${String(s.trxId || s.id)} | ${String(s.method || '')} ৳${Number(s.amount || 0)}${
                  s.usedOrderNumber ? ` (${String(s.usedOrderNumber)})` : ''
                }`,
            )),
      ];
      await sendOrEditPanel(deps, token, chatId, undefined, lines.join('\n'), [
        [
          {text: '⬅️ SMS List', callback_data: 'adm:sl:unused:0'},
          {text: '🏠 Home', callback_data: 'adm:home'},
        ],
      ]);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'sms_add') {
    const trimmed = inputText.trim();
    // Accept either short syntax "bKash 500 9B4X2K7M1P" or full raw bKash/Nagad SMS text
    const shortMatch = trimmed.match(/^(bkash|nagad)\s+(\d+(?:\.\d{1,2})?)\s+([a-zA-Z0-9_-]{4,32})$/i);
    const rawSms = shortMatch
      ? `${shortMatch[1]} received Tk ${shortMatch[2]}. TrxID ${shortMatch[3].toUpperCase()}`
      : trimmed;
    const res = await deps.recordManualSmsPayment(rawSms, shortMatch?.[1]);
    if (!res.ok) {
      await deps.sendTelegramReply(
        token,
        chatId,
        `❌ ${res.error}\nউদাহরণ: bKash 500 9B4X2K7M1P অথবা পুরো SMS পেস্ট করুন।`,
      );
      return;
    }
    const msg = res.reconciled?.matched
      ? res.reconciled.matchedType === 'order'
        ? `⚡ Saved & Auto-Verified Order ${res.reconciled.orderNumber} (${res.reconciled.orderStatus?.toUpperCase()})!`
        : `⚡ Saved & Auto-Approved Deposit ৳${res.reconciled.amount} (${res.reconciled.topupId})!`
      : res.duplicate
        ? `ℹ️ Duplicate SMS TrxID ${res.trxId} (${res.method} ৳${res.amount})`
        : `✅ Saved ${res.method} ৳${res.amount} (TrxID: ${res.trxId})`;
    await renderSmsPaymentsList(deps, token, chatId, 'unused', 0, undefined, msg);
    return;
  }

  if (prompt.type === 'coupon_add' && deps.adminDb) {
    // Format: CODE | percent/fixed | VALUE | MIN_ORDER | LIMIT
    const parts = inputText.split('|').map((s) => s.trim());
    const code = (parts[0] || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const dType = (parts[1] || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent';
    const dVal = Math.max(1, Number((parts[2] || '').replace(/[^\d.]/g, '')) || 0);
    const minOrder = Math.max(0, Number((parts[3] || '0').replace(/[^\d.]/g, '')) || 0);
    const limit = Math.max(0, Math.round(Number((parts[4] || '100').replace(/[^\d]/g, '')) || 0));
    if (code.length < 2 || dVal <= 0) {
      await deps.sendTelegramReply(
        token,
        chatId,
        '❌ ফরম্যাট: CODE | percent/fixed | VALUE | MIN_ORDER | LIMIT\nযেমন: EID2026 | percent | 10 | 100 | 50',
      );
      return;
    }
    try {
      const id = `cpn_${code}`;
      const now = FieldValue.serverTimestamp();
      await deps.adminDb.collection('coupons').doc(id).set({
        id,
        code,
        title: `${code} Promo`,
        discountType: dType,
        discountValue: dVal,
        minOrderAmount: minOrder,
        maxDiscountAmount: dType === 'percent' ? 200 : 0,
        usageLimit: limit,
        perUserLimit: 1,
        usedCount: 0,
        active: true,
        expiresAt: '',
        createdAt: now,
        updatedAt: now,
      });
      await renderCouponsList(deps, token, chatId, 0, undefined, `✅ Coupon ${code} তৈরি হয়েছে!`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'flash_add' && prompt.targetId && deps.adminDb) {
    // Format: DISCOUNT% | TITLE | HOURS
    const parts = inputText.split('|').map((s) => s.trim());
    const pct = Number((parts[0] || '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
      await deps.sendTelegramReply(token, chatId, '❌ লিখুন: Discount% | Title | Hours\nযেমন: 15 | Night Blast | 24');
      return;
    }
    try {
      const prodSnap = await deps.adminDb.collection('products').doc(prompt.targetId).get();
      const prodName = String(prodSnap.data()?.name || prompt.targetId);
      const title = (parts[1] || `${prodName} Flash Deal`).slice(0, 120);
      const hours = Number((parts[2] || '0').replace(/[^\d.]/g, '')) || 0;
      const nowMs = Date.now();
      const endsAt = hours > 0 ? new Date(nowMs + hours * 3600 * 1000).toISOString() : '';
      const id = `fs_${nowMs}`;
      const now = FieldValue.serverTimestamp();
      await deps.adminDb.collection('flashSales').doc(id).set({
        id,
        title,
        productId: prompt.targetId,
        productName: prodName.slice(0, 120),
        discountPercent: pct,
        badgeText: 'FLASH DEAL',
        startsAt: '',
        endsAt,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      void Promise.resolve(
        deps.broadcastFlashSalePush?.({
          title: `🔥 Flash Sale Live (-${pct}%) — ${prodName}`,
          body: `${title}! Grab your top-up now before the deal ends.`,
          url: '/',
        }),
      ).catch(() => null);
      await renderFlashSalesList(deps, token, chatId, 0, undefined, `✅ Flash Sale "-${pct}%" চালু হয়েছে!`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'vault_add' && prompt.targetId && typeof prompt.extraIndex === 'number' && deps.adminDb) {
    const lines = Array.from(
      new Set(
        inputText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length >= 3 && l.length <= 240),
      ),
    ).slice(0, 200);
    if (lines.length === 0) {
      await deps.sendTelegramReply(token, chatId, '❌ প্রতি লাইনে অন্তত ১টি সঠিক PIN (কমপক্ষে ৩ অক্ষর) দিন।');
      return;
    }
    try {
      const prodSnap = await deps.adminDb.collection('products').doc(prompt.targetId).get();
      if (!prodSnap.exists) return;
      const pData = prodSnap.data() as Record<string, unknown>;
      const pkgs = Array.isArray(pData.packages) ? pData.packages : [];
      const pkg = pkgs[prompt.extraIndex] as Record<string, unknown> | undefined;
      if (!pkg) return;

      const batch = deps.adminDb.batch();
      const now = FieldValue.serverTimestamp();
      for (const code of lines) {
        const id = `pin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        batch.set(deps.adminDb.collection('voucherStock').doc(id), {
          id,
          productId: prompt.targetId,
          productName: String(pData.name || '').slice(0, 120),
          packageId: String(pkg.id || ''),
          packageName: String(pkg.name || '').slice(0, 120),
          code,
          status: 'unused',
          createdAt: now,
        });
      }
      await batch.commit();
      await renderVaultSummary(
        deps,
        token,
        chatId,
        undefined,
        `✅ ${lines.length} টি নতুন Voucher PIN (${String(pkg.name || '')}) Vault-এ যোগ হয়েছে!`,
      );
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'notice_text' && deps.adminDb) {
    const cleanNotice = inputText.trim().slice(0, 300);
    try {
      await patchSiteSettingsDoc(deps, {noticeText: cleanNotice, noticeActive: true});
      await renderCustomizationPanel(deps, token, chatId, undefined, '✅ নোটিশ টেক্সট আপডেট ও চালু করা হয়েছে!');
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'site_field' && prompt.targetId && deps.adminDb) {
    const val = inputText.trim().slice(0, 200);
    try {
      const s = await readSiteSettingsDoc(deps);
      if (prompt.targetId === 'brandName' || prompt.targetId === 'heroTitle') {
        await patchSiteSettingsDoc(deps, {[prompt.targetId]: val});
      } else {
        const contact = {...((s.contact as Record<string, string>) || {})};
        contact[prompt.targetId] = val;
        await patchSiteSettingsDoc(deps, {contact});
      }
      await renderCustomizationPanel(deps, token, chatId, undefined, `✅ ${prompt.targetId} আপডেট হয়েছে!`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'customer_search' && deps.adminDb) {
    const q = inputText.trim().toLowerCase();
    try {
      const snap = await deps.adminDb.collection('customers').get();
      const matches = snap.docs
        .map((d): Record<string, unknown> & {uid: string} => ({
          ...(d.data() as Record<string, unknown>),
          uid: d.id,
        }))
        .filter(
          (c) =>
            String(c['email'] || '').toLowerCase().includes(q) ||
            String(c['displayName'] || '').toLowerCase().includes(q) ||
            String(c['phone'] || '').toLowerCase().includes(q),
        )
        .slice(0, 6);
      if (matches.length === 1) {
        await renderCustomerInspector(deps, token, chatId, matches[0].uid);
      } else if (matches.length === 0) {
        await deps.sendTelegramReply(token, chatId, `🔍 "${inputText}" অনুযায়ী কোনো কাস্টমার পাওয়া যায়নি।`);
      } else {
        await sendOrEditPanel(
          deps,
          token,
          chatId,
          undefined,
          `🔍 Customer Results (${matches.length} জন):`,
          [
            ...matches.map((c) => [
              {
                text: `${String(c.displayName || c.email || c.uid).slice(0, 24)} (৳${Number(c.walletBalance || 0)})`,
                callback_data: `adm:ci:${encodeRef(c.uid)}`,
              },
            ]),
            [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
          ],
        );
      }
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if ((prompt.type === 'customer_wallet' || prompt.type === 'customer_points') && prompt.targetId && deps.adminDb) {
    const delta = Number(inputText.trim());
    const isPoints = prompt.type === 'customer_points';
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 500000) {
      await deps.sendTelegramReply(token, chatId, '❌ সঠিক সংখ্যা লিখুন (যেমন: +100 অথবা -50)।');
      return;
    }
    try {
      const uid = prompt.targetId;
      const result = await deps.adminDb.runTransaction(async (tx) => {
        const ref = deps.adminDb!.collection('customers').doc(uid);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const field = isPoints ? 'loyaltyPoints' : 'walletBalance';
        const cur = Number((snap.data() as Record<string, unknown>)[field] || 0);
        const next = isPoints ? Math.max(0, Math.round(cur + delta)) : Math.max(0, Number((cur + delta).toFixed(2)));
        const now = FieldValue.serverTimestamp();
        tx.update(ref, {[field]: next, updatedAt: now});
        const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(deps.adminDb!.collection('auditLogs').doc(logId), {
          id: logId,
          actorEmail: 'telegram_admin',
          actorRole: 'super_admin',
          action: isPoints ? 'TG_ADMIN_POINTS_ADJUST' : 'TG_ADMIN_WALLET_ADJUST',
          targetType: 'customer',
          targetId: uid,
          details: `Adjusted ${field} by ${delta > 0 ? `+${delta}` : delta} (${cur} -> ${next})`,
          createdAt: now,
        });
        return next;
      });
      if (result === null) {
        await deps.sendTelegramReply(token, chatId, '❌ কাস্টমার পাওয়া যায়নি।');
        return;
      }
      await renderCustomerInspector(
        deps,
        token,
        chatId,
        uid,
        undefined,
        isPoints ? `✅ নতুন Loyalty Points: ${result} pts` : `✅ নতুন ওয়ালেট ব্যালেন্স: ৳${result}`,
      );
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
    return;
  }

  if (prompt.type === 'admin_chat_id_add') {
    const cleanId = inputText.trim();
    if (!/^-?\d{5,20}$/.test(cleanId)) {
      await deps.sendTelegramReply(token, chatId, '❌ সঠিক Telegram Chat ID (যেমন: 8139244263) দিন।');
      return;
    }
    const store = deps.readStore();
    const nextIds = Array.from(new Set([...(store.systemSettings.telegramAdminChatIds || []), cleanId]));
    store.systemSettings.telegramAdminChatIds = nextIds;
    store.systemSettings.updatedAt = new Date().toISOString();
    deps.appendServerLog(store, `tg_admin_${chatId}`, 'TG_ADMIN_ID_ADDED', `Added authorized Telegram Chat ID ${cleanId}`);
    deps.writeStore(store);
    await renderAdminChatIdsPanel(deps, token, chatId, undefined, `✅ Chat ID ${cleanId} স্থায়ীভাবে যোগ করা হয়েছে!`);
    return;
  }

  if (prompt.type === 'reseller_key_add' && deps.adminDb) {
    // Format: customerEmail | Label
    const parts = inputText.split('|').map((s) => s.trim());
    const email = (parts[0] || '').toLowerCase();
    const label = (parts[1] || 'Telegram Reseller Key').slice(0, 100);
    if (!email || !email.includes('@')) {
      await deps.sendTelegramReply(token, chatId, '❌ সঠিক ফরম্যাটে লিখুন:\n`customer@email.com | Store Name`');
      return;
    }
    try {
      const custSnap = await deps.adminDb
        .collection('customers')
        .where('email', '==', email)
        .limit(1)
        .get();
      if (custSnap.empty) {
        await deps.sendTelegramReply(token, chatId, `❌ "${email}" ইমেইলে কোনো কাস্টমার পাওয়া যায়নি।`);
        return;
      }
      const rawKey = `mk_live_${crypto.randomBytes(20).toString('hex')}`;
      const keyPrefix = `${rawKey.slice(0, 14)}...`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const id = `rkey_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await deps.adminDb.collection('resellerKeys').doc(id).set({
        id,
        label,
        customerUid: custSnap.docs[0].id,
        customerEmail: email,
        keyPrefix,
        keyHash,
        active: true,
        totalRequests: 0,
        totalSpent: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      await deps.sendTelegramReply(
        token,
        chatId,
        [
          `✅ নতুন Reseller API Key তৈরি হয়েছে!`,
          `👤 Customer: ${email}`,
          `🏷️ Label: ${label}`,
          '',
          `🔑 API Key (শুধুমাত্র একবারই দেখা যাবে, কপি করে রাখুন):`,
          rawKey,
        ].join('\n'),
      );
      await renderResellerKeysPanel(deps, token, chatId, 0);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
  }
}

// ---------------------------------------------------------------------------
// CALLBACK QUERY ROUTER
// ---------------------------------------------------------------------------

export async function handleTelegramAdminCallback(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  fromId: number | undefined,
  messageId: number | undefined,
  data: string,
  businessConnectionId?: string,
): Promise<boolean> {
  if (!data.startsWith('adm:')) return false;

  if (!isTelegramAdminAuthorized(deps, chatId, fromId, businessConnectionId)) {
    await deps.sendTelegramReply(
      token,
      chatId,
      '🔒 আপনার Admin সেশন শেষ বা অনুমোদিত নয়। পুনরায় খুলতে `/admin` লিখে লগইন করুন।',
      businessConnectionId,
    );
    return true;
  }

  const parts = data.split(':');
  const section = parts[1];

  if (section === 'logout') {
    authenticatedAdminSessions.delete(chatId);
    adminPromptStates.delete(chatId);
    await sendOrEditPanel(deps, token, chatId, messageId, '🔒 Telegram Admin Panel লক করা হয়েছে। পুনরায় খুলতে `/admin` লিখুন।', []);
    return true;
  }

  if (section === 'home') {
    await renderAdminHome(deps, token, chatId, messageId);
    return true;
  }

  // ---- Orders ----
  if (section === 'ol') {
    await renderOrdersList(deps, token, chatId, parts[2] || 'pending', Number(parts[3] || 0) || 0, messageId);
    return true;
  }

  if (section === 'oi') {
    await renderOrderInspector(deps, token, chatId, decodeRef(parts[2] || ''), messageId);
    return true;
  }

  if (section === 'oa') {
    const act = parts[2] as 'ap' | 'rp' | 'pr' | 'cp' | 'ca' | 'vp' | 'dp';
    const orderId = decodeRef(parts[3] || '');
    const res = await executeAdminOrderAction(deps, act, orderId);
    await renderOrderInspector(deps, token, chatId, orderId, messageId, res.msg);
    return true;
  }

  if (section === 'op') {
    const pType = parts[2];
    const orderId = decodeRef(parts[3] || '');
    adminPromptStates.set(chatId, {
      type: pType === 'vo' ? 'order_voucher' : 'order_note',
      targetId: orderId,
      createdAt: Date.now(),
    });
    await deps.sendTelegramReply(
      token,
      chatId,
      pType === 'vo'
        ? '🔑 এই অর্ডারের জন্য Voucher / Redeem Code টি লিখে পাঠান (পাঠানোর সাথে সাথেই Completed হয়ে ইমেইল ও টেলিগ্রামে যাবে):\n❌ বাতিল করতে "cancel" লিখুন।'
        : '💬 কাস্টমারকে যে আপডেট মেসেজ পাঠাতে চান তা লিখে পাঠান (ইমেইল + টেলিগ্রাম + অ্যাকাউন্টে যাবে):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'os') {
    adminPromptStates.set(chatId, {type: 'order_search', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '🔍 Order Number (যেমন: SV...), Player UID, TrxID বা Email লিখে পাঠান:\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  // ---- Payments, Wallet Top-Ups, SMS & History ----
  if (section === 'pay') {
    await renderPaymentsHub(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'tl') {
    const filter = parts.length >= 4 ? parts[2] || 'pending' : 'pending';
    const page = parts.length >= 4 ? Number(parts[3] || 0) || 0 : Number(parts[2] || 0) || 0;
    await renderWalletTopupsList(deps, token, chatId, filter, page, messageId);
    return true;
  }

  if (section === 'ti') {
    await renderWalletTopupInspector(deps, token, chatId, decodeRef(parts[2] || ''), messageId);
    return true;
  }

  if (section === 'ta' && deps.adminDb) {
    const act = parts[2];
    const topupId = decodeRef(parts[3] || '');
    try {
      const outcome = await deps.adminDb.runTransaction(async (tx) => {
        const ref = deps.adminDb!.collection('walletTopups').doc(topupId);
        const snap = await tx.get(ref);
        if (!snap.exists) return {ok: false as const, error: 'Deposit not found'};
        const t = snap.data() as Record<string, unknown>;
        if (t.status !== 'pending') return {ok: false as const, error: 'Already processed'};

        const customerUid = String(t.customerUid || '');
        const trxKey = String(t.trxKey || '');
        const amount = Number(t.amount || 0);
        const custRef = customerUid ? deps.adminDb!.collection('customers').doc(customerUid) : null;
        const trxRef = trxKey ? deps.adminDb!.collection('trxRegistry').doc(trxKey) : null;

        const [custSnap, trxSnap] = await Promise.all([
          custRef ? tx.get(custRef) : Promise.resolve(null),
          trxRef ? tx.get(trxRef) : Promise.resolve(null),
        ]);

        const now = FieldValue.serverTimestamp();
        const nextStatus = act === 'ap' ? 'approved' : 'rejected';
        let newBalance = 0;

        if (act === 'ap' && custRef && custSnap?.exists && amount > 0) {
          const curBal = Number((custSnap.data() as {walletBalance?: number}).walletBalance || 0);
          newBalance = Number((curBal + amount).toFixed(2));
          tx.update(custRef, {walletBalance: newBalance, updatedAt: now});
        }

        tx.update(ref, {
          status: nextStatus,
          adminNote: `${nextStatus === 'approved' ? 'Approved' : 'Rejected'} via Telegram Admin Panel`,
          updatedAt: now,
        });
        if (trxRef && trxSnap?.exists) {
          tx.update(trxRef, {status: act === 'ap' ? 'verified' : 'rejected'});
        }
        const shortRef = `TOPUP-${snap.id.slice(-6).toUpperCase()}`;
        const histId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(deps.adminDb!.collection('paymentHistory').doc(histId), {
          id: histId,
          orderId: snap.id,
          orderNumber: shortRef,
          trxId: String(t.trxId || ''),
          paymentMethodName: String(t.paymentMethodName || ''),
          senderNumber: String(t.senderNumber || ''),
          amount,
          action: nextStatus,
          note: 'Wallet Add Money via Telegram Admin',
          adminEmail: 'telegram_admin',
          createdAt: now,
        });
        if (customerUid) {
          const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
            id: notifId,
            customerUid,
            orderId: snap.id,
            orderNumber: shortRef,
            title: act === 'ap' ? 'Wallet Deposit Approved' : 'Wallet Deposit Rejected',
            message:
              act === 'ap'
                ? `৳${amount} added to your Wallet Balance.`
                : 'Your wallet deposit request was rejected.',
            read: false,
            createdAt: now,
          });
        }
        return {
          ok: true as const,
          amount,
          nextStatus,
          newBalance,
          customerEmail: String(t.customerEmail || ''),
          customerName: String(t.customerName || ''),
          trxId: String(t.trxId || ''),
          method: String(t.paymentMethodName || ''),
        };
      });

      if (!outcome.ok) {
        await renderWalletTopupInspector(deps, token, chatId, topupId, messageId, `⚠️ ${outcome.error}`);
        return true;
      }

      await deps.sendCustomerGenericEmail({
        toEmail: outcome.customerEmail,
        customerName: outcome.customerName,
        subject:
          outcome.nextStatus === 'approved'
            ? `Wallet Deposit Approved (+৳${outcome.amount})`
            : `Wallet Deposit Rejected (${outcome.trxId})`,
        headline:
          outcome.nextStatus === 'approved'
            ? 'Your Wallet Has Been Credited!'
            : 'Wallet Deposit Request Rejected',
        message:
          outcome.nextStatus === 'approved'
            ? `৳${outcome.amount} has been added to your wallet. New Balance: ৳${outcome.newBalance}.`
            : 'Your deposit could not be verified. Please contact support with your TrxID.',
        rows: [
          {label: 'Amount', value: `৳${outcome.amount}`},
          {label: 'Method', value: outcome.method || '—'},
          {label: 'TrxID', value: outcome.trxId || '—'},
          {label: 'Status', value: outcome.nextStatus.toUpperCase()},
        ],
      });

      await renderWalletTopupInspector(
        deps,
        token,
        chatId,
        topupId,
        messageId,
        `✅ Deposit ${outcome.nextStatus}!`,
      );
    } catch (err) {
      await renderWalletTopupInspector(deps, token, chatId, topupId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'sl') {
    const f = (parts[2] === 'used' || parts[2] === 'all' ? parts[2] : 'unused') as 'unused' | 'used' | 'all';
    await renderSmsPaymentsList(deps, token, chatId, f, Number(parts[3] || 0) || 0, messageId);
    return true;
  }

  if (section === 'sl_rec' && deps.adminDb) {
    try {
      const snap = await deps.adminDb.collection('sms_payments').where('used', '==', false).get();
      let matchedCount = 0;
      const cDeps = deps.getCommerceDeps();
      for (const d of snap.docs) {
        const s = d.data() as Record<string, unknown>;
        const out = await reconcilePendingTransactionsForSms(cDeps, {
          trxId: String(s.trxId || d.id),
          amount: Number(s.amount || 0),
          method: String(s.method || 'bKash'),
        });
        if (out.matched) matchedCount += 1;
      }
      await renderSmsPaymentsList(
        deps,
        token,
        chatId,
        'unused',
        0,
        messageId,
        `⚡ Auto-Reconcile সম্পন্ন: ${matchedCount} টি Pending Order/Deposit ভেরিফাই হয়েছে (Checked ${snap.size} unused SMS)!`,
      );
    } catch (err) {
      await renderPaymentsHub(deps, token, chatId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'sl_add') {
    adminPromptStates.set(chatId, {type: 'sms_add', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '📲 নতুন পেমেন্ট SMS বা তথ্য পাঠান (বট সাথে সাথেই Matching Order/Deposit Auto-Verify করবে):\nউদাহরণ:\n`bKash 500 9B4X2K7M1P`\nঅথবা পুরো bKash/Nagad SMS কপি-পেস্ট করুন।\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'sl_src') {
    adminPromptStates.set(chatId, {type: 'sms_search', createdAt: Date.now()});
    await deps.sendTelegramReply(token, chatId, '🔍 SMS Payments-এ খুঁজতে TrxID বা Order Number লিখুন:\n❌ বাতিল করতে "cancel" লিখুন।');
    return true;
  }

  if (section === 'ph') {
    await renderPaymentHistoryList(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
    return true;
  }

  if (section === 'ml') {
    await renderPaymentMethodsPanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'mt' && deps.adminDb) {
    const methodId = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('paymentMethods').doc(methodId);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = (snap.data() as {active?: boolean}).active !== false;
        await ref.update({active: !cur, updatedAt: FieldValue.serverTimestamp()});
        deps.invalidateBotStoreCache();
        await renderPaymentMethodsPanel(deps, token, chatId, messageId, `✅ Payment method ${!cur ? 'Enabled' : 'Disabled'}`);
      }
    } catch (err) {
      await renderPaymentMethodsPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'mty' && deps.adminDb) {
    const methodId = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('paymentMethods').doc(methodId);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = String(snap.data()?.accountType || 'Personal');
        const next = cur === 'Personal' ? 'Merchant' : cur === 'Merchant' ? 'Agent' : 'Personal';
        await ref.update({accountType: next, updatedAt: FieldValue.serverTimestamp()});
        deps.invalidateBotStoreCache();
        await renderPaymentMethodsPanel(deps, token, chatId, messageId, `✅ Account Type: ${next}`);
      }
    } catch (err) {
      await renderPaymentMethodsPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'mn') {
    const methodId = decodeRef(parts[2] || '');
    adminPromptStates.set(chatId, {type: 'payment_number', targetId: methodId, createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '📱 নতুন অ্যাকাউন্ট নম্বরটি লিখে পাঠান (যেমন: 017XXXXXXXX):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'ma') {
    adminPromptStates.set(chatId, {type: 'payment_add', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '💳 নতুন পেমেন্ট মেথড লিখুন (এই ফরম্যাটে):\n`Name | Number | Personal/Merchant/Agent`\nউদাহরণ: `Rocket | 017XXXXXXXX | Personal`\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  // ---- Promotions, Coupons, Flash Sales & PIN Vault ----
  if (section === 'pr') {
    await renderPromotionsHub(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'cp') {
    const sub = parts[2];
    if (sub === 'l') {
      await renderCouponsList(deps, token, chatId, Number(parts[3] || 0) || 0, messageId);
      return true;
    }
    if (sub === 'a') {
      adminPromptStates.set(chatId, {type: 'coupon_add', createdAt: Date.now()});
      await deps.sendTelegramReply(
        token,
        chatId,
        '🏷️ নতুন কুপন তৈরি করতে লিখুন:\n`CODE | percent/fixed | VALUE | MIN_ORDER | LIMIT`\nউদাহরণ: `EID2026 | percent | 10 | 100 | 50`\n❌ বাতিল করতে "cancel" লিখুন।',
      );
      return true;
    }
    if (sub === 't' && deps.adminDb) {
      const id = decodeRef(parts[3] || '');
      const ref = deps.adminDb.collection('coupons').doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = snap.data()?.active === true;
        await ref.update({active: !cur, updatedAt: FieldValue.serverTimestamp()});
        await renderCouponsList(deps, token, chatId, 0, messageId, `✅ Coupon ${!cur ? 'Activated' : 'Paused'}`);
      }
      return true;
    }
    if (sub === 'd' && deps.adminDb) {
      const id = decodeRef(parts[3] || '');
      await deps.adminDb.collection('coupons').doc(id).delete();
      await renderCouponsList(deps, token, chatId, 0, messageId, '🗑️ Coupon deleted!');
      return true;
    }
  }

  if (section === 'fs') {
    const sub = parts[2];
    if (sub === 'l') {
      await renderFlashSalesList(deps, token, chatId, Number(parts[3] || 0) || 0, messageId);
      return true;
    }
    if (sub === 'p') {
      await renderProductPickerForAction(deps, token, chatId, 'flash', messageId);
      return true;
    }
    if (sub === 'c') {
      const prodId = decodeRef(parts[3] || '');
      adminPromptStates.set(chatId, {type: 'flash_add', targetId: prodId, createdAt: Date.now()});
      await deps.sendTelegramReply(
        token,
        chatId,
        '🔥 Flash Sale বিস্তারিত লিখুন:\n`Discount% | Title | DurationHours`\nউদাহরণ: `15 | Midnight Deal | 12` (সময় না দিলে 0 দিন)\n❌ বাতিল করতে "cancel" লিখুন।',
      );
      return true;
    }
    if (sub === 't' && deps.adminDb) {
      const id = decodeRef(parts[3] || '');
      const ref = deps.adminDb.collection('flashSales').doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = snap.data()?.active === true;
        await ref.update({active: !cur, updatedAt: FieldValue.serverTimestamp()});
        await renderFlashSalesList(deps, token, chatId, 0, messageId, `✅ Flash Sale ${!cur ? 'Live' : 'Off'}`);
      }
      return true;
    }
    if (sub === 'd' && deps.adminDb) {
      const id = decodeRef(parts[3] || '');
      await deps.adminDb.collection('flashSales').doc(id).delete();
      await renderFlashSalesList(deps, token, chatId, 0, messageId, '🗑️ Flash Sale deleted!');
      return true;
    }
  }

  if (section === 'vp') {
    const sub = parts[2];
    if (sub === 's') {
      await renderVaultSummary(deps, token, chatId, messageId);
      return true;
    }
    if (sub === 'p') {
      await renderProductPickerForAction(deps, token, chatId, 'vault', messageId);
      return true;
    }
    if (sub === 'k' && deps.adminDb) {
      const prodId = decodeRef(parts[3] || '');
      const snap = await deps.adminDb.collection('products').doc(prodId).get();
      if (!snap.exists) return true;
      const p = snap.data() as {name?: string; packages?: Array<{name?: string; price?: number}>};
      const pkgs = Array.isArray(p.packages) ? p.packages : [];
      const prodRef = encodeRef(snap.id);
      const buttons: InlineButton[][] = pkgs.slice(0, 16).map((pkg, idx) => [
        {
          text: `${pkg.name || 'Package'} (৳${Number(pkg.price || 0)})`,
          callback_data: `adm:vp:u:${prodRef}:${idx}`,
        },
      ]);
      buttons.push([{text: '⬅️ Back', callback_data: 'adm:vp:p'}]);
      await sendOrEditPanel(deps, token, chatId, messageId, `📦 ${p.name || ''} — কোন প্যাকেজে PIN আপলোড করবেন?`, buttons);
      return true;
    }
    if (sub === 'u') {
      const prodId = decodeRef(parts[3] || '');
      const pkgIdx = Number(parts[4] ?? -1);
      if (pkgIdx >= 0) {
        adminPromptStates.set(chatId, {type: 'vault_add', targetId: prodId, extraIndex: pkgIdx, createdAt: Date.now()});
        await deps.sendTelegramReply(
          token,
          chatId,
          '🔑 Voucher / Redeem PIN কোডগুলো পাঠান (প্রতি লাইনে একটি করে PIN):\n❌ বাতিল করতে "cancel" লিখুন।',
        );
      }
      return true;
    }
    if (sub === 'd' && deps.adminDb) {
      const id = decodeRef(parts[3] || '');
      await deps.adminDb.collection('voucherStock').doc(id).delete();
      await renderVaultSummary(deps, token, chatId, messageId, '🗑️ Unused PIN deleted from vault.');
      return true;
    }
  }

  // ---- Tickets ----
  if (section === 'kl') {
    await renderTicketsList(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
    return true;
  }

  if (section === 'ki') {
    await renderTicketInspector(deps, token, chatId, decodeRef(parts[2] || ''), messageId);
    return true;
  }

  if (section === 'kp') {
    const tktId = decodeRef(parts[2] || '');
    adminPromptStates.set(chatId, {type: 'ticket_reply', targetId: tktId, createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '✍️ এই টিকেটের জন্য আপনার রিপ্লাই লিখে পাঠান (কাস্টমারের অ্যাকাউন্ট ও ইমেইলে যাবে):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'kc' && deps.adminDb) {
    const tktId = decodeRef(parts[2] || '');
    try {
      await deps.adminDb
        .collection('tickets')
        .doc(tktId)
        .update({status: 'closed', updatedAt: FieldValue.serverTimestamp()});
      await renderTicketInspector(deps, token, chatId, tktId, messageId, '🔒 টিকেট ক্লোজ করা হয়েছে।');
    } catch (err) {
      await renderTicketInspector(deps, token, chatId, tktId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  // ---- Products, Categories & Packages ----
  if (section === 'pl') {
    await renderProductsList(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
    return true;
  }

  if (section === 'pa') {
    adminPromptStates.set(chatId, {type: 'product_add', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '💎 নতুন প্রোডাক্ট যোগ করতে লিখুন:\n`Product Name | Category Name | First Package | Price`\nউদাহরণ: `PUBG Mobile UC | PUBG | 60 UC | 120`\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'cat') {
    if (parts[2] === 'l') {
      await renderCategoriesList(deps, token, chatId, messageId);
      return true;
    }
    if (parts[2] === 't' && deps.adminDb) {
      const catId = decodeRef(parts[3] || '');
      const ref = deps.adminDb.collection('categories').doc(catId);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = snap.data()?.active !== false;
        await ref.update({active: !cur, updatedAt: FieldValue.serverTimestamp()});
        deps.invalidateBotStoreCache();
        await renderCategoriesList(deps, token, chatId, messageId, `✅ Category ${!cur ? 'Activated' : 'Hidden'}`);
      }
      return true;
    }
  }

  if (section === 'pi') {
    await renderProductInspector(deps, token, chatId, decodeRef(parts[2] || ''), messageId);
    return true;
  }

  if (section === 'pt' && deps.adminDb) {
    const productId = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('products').doc(productId);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = (snap.data() as {active?: boolean}).active !== false;
        await ref.update({active: !cur, updatedAt: FieldValue.serverTimestamp()});
        deps.invalidateBotStoreCache();
        await renderProductInspector(deps, token, chatId, productId, messageId, `✅ Product ${!cur ? 'Activated' : 'Hidden'}`);
      }
    } catch (err) {
      await renderProductInspector(deps, token, chatId, productId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'pf' && deps.adminDb) {
    const productId = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('products').doc(productId);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = Boolean((snap.data() as {featured?: boolean}).featured);
        await ref.update({featured: !cur, updatedAt: FieldValue.serverTimestamp()});
        deps.invalidateBotStoreCache();
        await renderProductInspector(deps, token, chatId, productId, messageId, `⭐ Featured: ${!cur ? 'ON' : 'OFF'}`);
      }
    } catch (err) {
      await renderProductInspector(deps, token, chatId, productId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'pka') {
    const productId = decodeRef(parts[2] || '');
    adminPromptStates.set(chatId, {type: 'package_add', targetId: productId, createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '📦 নতুন প্যাকেজের তথ্য লিখুন:\n`Package Name | Sale Price | Cost Price (Optional)`\nউদাহরণ: `230 Diamonds | 165 | 150`\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'pdel') {
    const refStr = parts[2] || '';
    await sendOrEditPanel(deps, token, chatId, messageId, '⚠️ আপনি কি নিশ্চিতভাবে এই প্রোডাক্টটি ডিলিট করতে চান?', [
      [
        {text: '🗑️ হ্যাঁ, ডিলিট করুন', callback_data: `adm:pdelok:${refStr}`},
        {text: '❌ না, ফিরে যান', callback_data: `adm:pi:${refStr}`},
      ],
    ]);
    return true;
  }

  if (section === 'pdelok' && deps.adminDb) {
    const productId = decodeRef(parts[2] || '');
    await deps.adminDb.collection('products').doc(productId).delete();
    deps.invalidateBotStoreCache();
    await renderProductsList(deps, token, chatId, 0, messageId, '🗑️ প্রোডাক্ট ডিলিট করা হয়েছে!');
    return true;
  }

  if (section === 'gt' && deps.adminDb) {
    const productId = decodeRef(parts[2] || '');
    const idx = Number(parts[3] ?? -1);
    try {
      const ref = deps.adminDb.collection('products').doc(productId);
      const snap = await ref.get();
      if (snap.exists && idx >= 0) {
        const pkgs = [...((snap.data() as {packages?: Array<Record<string, unknown>>}).packages || [])];
        if (pkgs[idx]) {
          const cur = pkgs[idx].active !== false;
          pkgs[idx] = {...pkgs[idx], active: !cur};
          await ref.update({packages: pkgs, updatedAt: FieldValue.serverTimestamp()});
          deps.invalidateBotStoreCache();
          await renderProductInspector(deps, token, chatId, productId, messageId, `✅ Package ${!cur ? 'Enabled' : 'Disabled'}`);
        }
      }
    } catch (err) {
      await renderProductInspector(deps, token, chatId, productId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'gp' || section === 'gc') {
    const productId = decodeRef(parts[2] || '');
    const idx = Number(parts[3] ?? -1);
    if (idx >= 0) {
      adminPromptStates.set(chatId, {
        type: section === 'gc' ? 'package_cost' : 'package_price',
        targetId: productId,
        extraIndex: idx,
        createdAt: Date.now(),
      });
      await deps.sendTelegramReply(
        token,
        chatId,
        section === 'gc'
          ? '📉 প্যাকেজটির নতুন Cost Price (৳) লিখুন (Profit হিসাবের জন্য, যেমন: 150):\n❌ বাতিল করতে "cancel" লিখুন।'
          : '💵 প্যাকেজটির নতুন Sale Price (৳ শুধু সংখ্যা, যেমন: 165) লিখে পাঠান:\n❌ বাতিল করতে "cancel" লিখুন।',
      );
    }
    return true;
  }

  // ---- Storefront Customization & Notice ----
  if (section === 'cu' || section === 'nt') {
    await renderCustomizationPanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'nt_tog' && deps.adminDb) {
    try {
      const s = await readSiteSettingsDoc(deps);
      const cur = Boolean(s.noticeActive);
      await patchSiteSettingsDoc(deps, {noticeActive: !cur});
      await renderCustomizationPanel(deps, token, chatId, messageId, `✅ Notice Bar ${!cur ? 'ON' : 'OFF'} করা হয়েছে।`);
    } catch (err) {
      await renderCustomizationPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'nt_ed') {
    adminPromptStates.set(chatId, {type: 'notice_text', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '📢 হোমপেজের নোটিশ বারের জন্য নতুন লেখা পাঠান (সর্বোচ্চ ৩০০ অক্ষর):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'cu_e') {
    const field = parts[2] || 'brandName';
    adminPromptStates.set(chatId, {type: 'site_field', targetId: field, createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      `✏️ "${field}" এর জন্য নতুন মান লিখে পাঠান:\n❌ বাতিল করতে "cancel" লিখুন।`,
    );
    return true;
  }

  // ---- Customers & VIP Tiers ----
  if (section === 'cl') {
    await renderCustomersList(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
    return true;
  }

  if (section === 'cs') {
    adminPromptStates.set(chatId, {type: 'customer_search', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '🔍 কাস্টমারের নাম, ইমেইল বা ফোন লিখে পাঠান:\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'ci') {
    await renderCustomerInspector(deps, token, chatId, decodeRef(parts[2] || ''), messageId);
    return true;
  }

  if (section === 'ct' && deps.adminDb) {
    const uid = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('customers').doc(uid);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = Boolean((snap.data() as {suspended?: boolean}).suspended);
        await ref.update({
          suspended: !cur,
          suspendedReason: !cur ? 'Suspended via Telegram Admin Panel' : '',
          updatedAt: FieldValue.serverTimestamp(),
        });
        await renderCustomerInspector(
          deps,
          token,
          chatId,
          uid,
          messageId,
          !cur ? '🚫 Account Suspended' : '✅ Account Activated',
        );
      }
    } catch (err) {
      await renderCustomerInspector(deps, token, chatId, uid, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'cr' && deps.adminDb) {
    const uid = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('customers').doc(uid);
      const snap = await ref.get();
      if (snap.exists) {
        const cur = String(snap.data()?.tier || 'regular');
        const next = cur === 'regular' ? 'vip' : cur === 'vip' ? 'reseller' : 'regular';
        await ref.update({tier: next, tierLocked: true, updatedAt: FieldValue.serverTimestamp()});
        await renderCustomerInspector(deps, token, chatId, uid, messageId, `🏅 Tier updated to ${next.toUpperCase()}!`);
      }
    } catch (err) {
      await renderCustomerInspector(deps, token, chatId, uid, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'cw' || section === 'cy') {
    const uid = decodeRef(parts[2] || '');
    const isPoints = section === 'cy';
    adminPromptStates.set(chatId, {
      type: isPoints ? 'customer_points' : 'customer_wallet',
      targetId: uid,
      createdAt: Date.now(),
    });
    await deps.sendTelegramReply(
      token,
      chatId,
      isPoints
        ? '⭐ কত Loyalty Points যোগ বা বিয়োগ করতে চান লিখুন (যেমন: +50 অথবা -20):\n❌ বাতিল করতে "cancel" লিখুন।'
        : '💵 কত টাকা যোগ বা বিয়োগ করতে চান লিখুন (যেমন: +100 অথবা -50):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  // ---- Analytics & Logs ----
  if (section === 'st') {
    await renderAnalyticsPanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'lg') {
    const kind = (parts[2] === 'aud' || parts[2] === 'api' ? parts[2] : 'srv') as 'srv' | 'aud' | 'api';
    await renderLogsPanel(deps, token, chatId, kind, messageId);
    return true;
  }

  // ---- System, Email (Brevo/SMTP), Chat IDs, Sub-Admins & Commerce ----
  if (section === 'sy') {
    await renderSystemPanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'sy_t') {
    const key = parts[2];
    const store = deps.readStore();
    if (key === 'smtp') store.systemSettings.smtpEnabled = !store.systemSettings.smtpEnabled;
    if (key === 'cust_email') {
      store.systemSettings.customerEmailNotificationsEnabled =
        store.systemSettings.customerEmailNotificationsEnabled === false;
    }
    if (key === 'alerts') {
      store.systemSettings.telegramAdminOrderAlerts =
        store.systemSettings.telegramAdminOrderAlerts === false;
    }
    if (key === 'qr') {
      store.systemSettings.telegramQuickRepliesEnabled =
        store.systemSettings.telegramQuickRepliesEnabled === false;
    }
    deps.appendServerLog(store, `tg_admin_${chatId}`, 'SYSTEM_TOGGLE', `Toggled ${key} via Telegram Admin Panel`);
    deps.writeStore(store);
    await renderSystemPanel(deps, token, chatId, messageId, '✅ সেটিংস আপডেট হয়েছে!');
    return true;
  }

  if (section === 'sy_mail') {
    const mail = deps.resolveMailStatus();
    const res = await deps.sendAdminNotificationEmail(
      'Telegram Admin Panel — Email Transport Test',
      [
        {
          label: 'Transport',
          value: mail.transport === 'brevo' ? 'Brevo REST API (HTTPS)' : mail.transport.toUpperCase(),
        },
        {label: 'Status', value: 'Working cleanly'},
        {label: 'Triggered By', value: `Telegram Admin (${chatId})`},
        {label: 'Time (BD)', value: new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'})},
      ],
      `tg_admin_${chatId}`,
    );
    await renderSystemPanel(
      deps,
      token,
      chatId,
      messageId,
      res.sent
        ? `✅ Test email sent to ${res.toEmail} via ${(res.transport || mail.transport).toUpperCase()}!`
        : `❌ Email failed: ${res.reason}`,
    );
    return true;
  }

  if (section === 'sy_exp') {
    await deps.runOrderExpiryNow();
    await renderSystemPanel(deps, token, chatId, messageId, '✅ Pending order expiry check সম্পন্ন হয়েছে।');
    return true;
  }

  if (section === 'sy_ids') {
    await renderAdminChatIdsPanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'sy_id_self') {
    const store = deps.readStore();
    const cid = String(chatId);
    store.systemSettings.telegramAdminChatIds = Array.from(
      new Set([...(store.systemSettings.telegramAdminChatIds || []), cid]),
    );
    store.systemSettings.updatedAt = new Date().toISOString();
    deps.appendServerLog(store, `tg_admin_${chatId}`, 'TG_ADMIN_ID_SAVED', `Saved own Telegram Chat ID ${cid}`);
    deps.writeStore(store);
    await renderAdminChatIdsPanel(deps, token, chatId, messageId, `✅ আপনার Chat ID (${cid}) স্থায়ীভাবে সংরক্ষিত হয়েছে!`);
    return true;
  }

  if (section === 'sy_id_add') {
    adminPromptStates.set(chatId, {type: 'admin_chat_id_add', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '🆔 স্থায়ী Admin হিসেবে যোগ করতে Telegram Chat ID লিখুন (যেমন: 8139244263):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'sy_id_del') {
    const targetId = parts[2] || '';
    const store = deps.readStore();
    store.systemSettings.telegramAdminChatIds = (store.systemSettings.telegramAdminChatIds || []).filter(
      (id) => id !== targetId,
    );
    store.systemSettings.updatedAt = new Date().toISOString();
    deps.appendServerLog(store, `tg_admin_${chatId}`, 'TG_ADMIN_ID_REMOVED', `Removed Chat ID ${targetId}`);
    deps.writeStore(store);
    await renderAdminChatIdsPanel(deps, token, chatId, messageId, `🗑️ Chat ID ${targetId} সরানো হয়েছে।`);
    return true;
  }

  if (section === 'sy_sub') {
    await renderSubAdminsPanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'sy_sub_t') {
    const email = decodeRef(parts[2] || '').toLowerCase();
    const store = deps.readStore();
    if (email && store.staff[email] && email !== deps.superAdminEmail) {
      store.staff[email].active = !store.staff[email].active;
      deps.appendServerLog(
        store,
        `tg_admin_${chatId}`,
        'TG_SUBADMIN_TOGGLE',
        `${email} active=${store.staff[email].active}`,
      );
      deps.writeStore(store);
      await renderSubAdminsPanel(
        deps,
        token,
        chatId,
        messageId,
        `✅ ${email} ${store.staff[email].active ? 'Enabled' : 'Disabled'}`,
      );
    }
    return true;
  }

  if (section === 'sy_com') {
    const s = deps.readStore().systemSettings;
    const cfg = normalizeCommerceSettings(s.commerce as any);
    const lines = [
      '📊 Commerce, Loyalty & Automation Rules',
      '',
      `🏅 VIP Tier: Spend ≥ ৳${cfg.vipSpendThreshold} → ${cfg.vipDiscountPercent}% Discount`,
      `🏢 Reseller Tier: Spend ≥ ৳${cfg.resellerSpendThreshold} → ${cfg.resellerDiscountPercent}% Discount`,
      `⭐ Loyalty Rewards: ${cfg.loyaltyPercent}% Earn | 1 Pt = ৳${cfg.loyaltyPointValueBdt}`,
      `🤝 Referral Bonus: ৳${cfg.referralBonusAmount} on 1st Completed Order`,
      `🛡️ Fraud Guard: Max ${cfg.fraudMaxFailedTrxPerHour} failed Trx/hr · ${cfg.fraudMaxOrdersPer10Min} orders/10m`,
      `💳 Gateway: ${cfg.gatewayEnabled ? `${cfg.gatewayProvider} (Active)` : 'Manual / SMS Mode'}`,
      `🚀 Distributor API: ${s.distributorEnabled && s.distributorBaseUrl ? '🟢 Enabled' : '🔴 Disabled'}`,
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), [
      [
        {text: '⬅️ System', callback_data: 'adm:sy'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ]);
    return true;
  }

  // Legacy alias support for sy_log
  if (section === 'sy_log') {
    await renderLogsPanel(deps, token, chatId, 'srv', messageId);
    return true;
  }

  // ---- Reports & CSV Export + Midnight Daily Summary ----
  if (section === 'rp') {
    const sub = parts[2];
    if (!sub) {
      await renderReportsAndCsvPanel(deps, token, chatId, messageId);
      return true;
    }
    if (sub === 'daily' && deps.sendDailySummaryReport) {
      await deps.sendDailySummaryReport(true);
      await renderReportsAndCsvPanel(deps, token, chatId, messageId, '✅ আজকের Daily Report টেলিগ্রাম ও ইমেইলে পাঠানো হয়েছে!');
      return true;
    }
    if ((sub === 'orders' || sub === 'transactions' || sub === 'daily_summary') && deps.generateCsvReport && deps.sendTelegramDocument) {
      const days = Math.min(365, Math.max(1, Number(parts[3] || 30) || 30));
      try {
        const csv = await deps.generateCsvReport(sub, days);
        await deps.sendTelegramDocument(
          token,
          chatId,
          csv.filename,
          csv.csvContent,
          `📊 ${csv.filename} (${csv.rowCount} rows · Last ${days} days)`,
        );
      } catch (err) {
        await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
      }
      return true;
    }
  }

  // ---- Customer Reviews Moderation & Seed ----
  if (section === 'rv') {
    const mode = parts[2] === 'list' ? 'list' : 'pending';
    const pg = Number(parts[3] || 0) || 0;
    await renderReviewsAdminPanel(deps, token, chatId, mode, pg, messageId);
    return true;
  }

  if ((section === 'rv_ap' || section === 'rv_hd' || section === 'rv_del') && deps.adminDb) {
    const reviewId = decodeRef(parts[2] || '');
    try {
      if (section === 'rv_del') {
        await deps.adminDb.collection('reviews').doc(reviewId).delete();
        await renderReviewsAdminPanel(deps, token, chatId, 'pending', 0, messageId, '🗑️ Review deleted!');
      } else {
        const approved = section === 'rv_ap';
        await deps.adminDb
          .collection('reviews')
          .doc(reviewId)
          .update({approved, updatedAt: FieldValue.serverTimestamp()});
        await renderReviewsAdminPanel(
          deps,
          token,
          chatId,
          approved ? 'pending' : 'list',
          0,
          messageId,
          approved ? '✅ Review approved & published live!' : '🚫 Review hidden from public view.',
        );
      }
    } catch (err) {
      await renderReviewsAdminPanel(deps, token, chatId, 'pending', 0, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  if (section === 'rv_seed' && deps.seed100Reviews) {
    const out = await deps.seed100Reviews(true);
    await renderReviewsAdminPanel(
      deps,
      token,
      chatId,
      'list',
      0,
      messageId,
      `🌱 ${out.seeded} টি রিভিউ সফলভাবে সিড হয়েছে!`,
    );
    return true;
  }

  // ---- Reseller API Keys ----
  if (section === 'rk') {
    await renderResellerKeysPanel(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
    return true;
  }

  if (section === 'rk_add') {
    adminPromptStates.set(chatId, {type: 'reseller_key_add', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '🔑 নতুন Reseller API Key তৈরি করতে লিখুন:\n`customer@email.com | Label`\nউদাহরণ: `reseller@gmail.com | TopUp Partner BD`\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if ((section === 'rk_t' || section === 'rk_d') && deps.adminDb) {
    const keyId = decodeRef(parts[2] || '');
    try {
      const ref = deps.adminDb.collection('resellerKeys').doc(keyId);
      if (section === 'rk_d') {
        await ref.delete();
        await renderResellerKeysPanel(deps, token, chatId, 0, messageId, '🗑️ Reseller API Key revoked & deleted!');
      } else {
        const snap = await ref.get();
        if (snap.exists) {
          const cur = snap.data()?.active === true;
          await ref.update({active: !cur});
          await renderResellerKeysPanel(
            deps,
            token,
            chatId,
            0,
            messageId,
            `✅ API Key ${!cur ? 'Enabled' : 'Disabled'}!`,
          );
        }
      }
    } catch (err) {
      await renderResellerKeysPanel(deps, token, chatId, 0, messageId, friendlyFirestoreError(deps, err));
    }
    return true;
  }

  return false;
}
