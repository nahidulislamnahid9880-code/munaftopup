import type {Firestore} from 'firebase-admin/firestore';
import {FieldValue} from 'firebase-admin/firestore';

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
  ) => Promise<{sent: boolean; reason?: string; toEmail?: string}>;
  readStore: () => {
    primaryPasswordHash: string | null;
    systemSettings: {
      smtpEnabled: boolean;
      customerEmailNotificationsEnabled: boolean;
      telegramQuickRepliesEnabled: boolean;
      telegramAdminChatIds: string[];
      telegramAdminOrderAlerts: boolean;
      notificationEmail: string;
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
}

interface TelegramAdminPromptState {
  type:
    | 'login_password'
    | 'order_search'
    | 'order_voucher'
    | 'order_note'
    | 'ticket_reply'
    | 'package_price'
    | 'payment_number'
    | 'notice_text'
    | 'customer_search'
    | 'customer_wallet';
  targetId?: string;
  extraIndex?: number;
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

const authenticatedAdminSessions = new Map<number, {expiresAt: number; label: string}>();
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
  if (clean.length <= 36 && /^[a-zA-Z0-9_-]+$/.test(clean)) {
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

function friendlyFirestoreError(deps: TelegramAdminDeps, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/PERMISSION_DENIED|insufficient permissions/i.test(msg)) {
    return (
      '⚠️ Firestore Admin SDK PERMISSION_DENIED (IAM অনুমোদন নেই বা Starter Tier প্রোজেক্ট)।\n' +
      `প্রোজেক্ট: ${deps.firebaseInitMode}`
    );
  }
  return `⚠️ ডাটাবেস এরর: ${msg}`;
}

function verifyTelegramAdminPassword(deps: TelegramAdminDeps, candidate: string): boolean {
  const clean = candidate.trim();
  if (!clean) return false;
  const envPass = (process.env.ADMIN_PASSCODE || '').trim();
  if (envPass) {
    return deps.timingSafeEqualsText(clean, envPass);
  }
  const store = deps.readStore();
  if (store.primaryPasswordHash) {
    return deps.verifyPassword(clean, store.primaryPasswordHash);
  }
  return false;
}

async function renderAdminHome(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
): Promise<void> {
  const stats = deps.getBotRuntimeStats();
  let dbStatusLine = '🟢 Firestore Connected';
  let pendingOrders = 0;
  let processingOrders = 0;
  let todayOrders = 0;
  let todayRevenue = 0;
  let pendingTopups = 0;
  let openTickets = 0;

  if (!deps.adminDb) {
    dbStatusLine = '🔴 Firestore Admin SDK Not Initialized';
  } else {
    try {
      const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
      const [ordersSnap, topupsSnap, ticketsSnap] = await Promise.all([
        deps.adminDb.collection('orders').get(),
        deps.adminDb.collection('walletTopups').where('status', '==', 'pending').get(),
        deps.adminDb.collection('tickets').where('status', '==', 'open').get(),
      ]);
      pendingTopups = topupsSnap.size;
      openTickets = ticketsSnap.size;

      for (const docSnap of ordersSnap.docs) {
        const d = docSnap.data() as Record<string, unknown>;
        const st = String(d.orderStatus || 'pending');
        const pay = String(d.paymentStatus || 'pending');
        const amt = Number(d.totalAmount || 0);
        const createdMs = deps.parseTimestampMillis(d.createdAt);

        if (st === 'pending') pendingOrders += 1;
        if (st === 'processing') processingOrders += 1;
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
        : `🟡 Firestore Error`;
    }
  }

  const text = [
    '🛡️ MUNAFTOPUP.bd — Telegram Admin Panel',
    '',
    `🤖 Bot: ${stats.running ? `@${stats.username || 'active'} (Online)` : 'Offline'}`,
    `${dbStatusLine}`,
    '',
    '📊 লাইভ সারাংশ:',
    `• পেন্ডিং অর্ডার: ${pendingOrders}`,
    `• প্রসেসিং অর্ডার: ${processingOrders}`,
    `• ২৪ ঘণ্টার অর্ডার: ${todayOrders} (৳${todayRevenue.toFixed(0)})`,
    `• পেন্ডিং ওয়ালেট টপ-আপ: ${pendingTopups}`,
    `• ওপেন সাপোর্ট টিকেট: ${openTickets}`,
    '',
    'নিচের বাটন থেকে যেকোনো সেকশন পরিচালনা করুন:',
  ].join('\n');

  const buttons: InlineButton[][] = [
    [
      {text: `📦 Pending (${pendingOrders})`, callback_data: 'adm:ol:pending:0'},
      {text: `⏳ Processing (${processingOrders})`, callback_data: 'adm:ol:processing:0'},
    ],
    [
      {text: '📋 All Orders', callback_data: 'adm:ol:all:0'},
      {text: '🔍 Search Order', callback_data: 'adm:os'},
    ],
    [
      {text: `💰 Top-Ups (${pendingTopups})`, callback_data: 'adm:tl:0'},
      {text: `🎫 Tickets (${openTickets})`, callback_data: 'adm:kl:0'},
    ],
    [
      {text: '💎 Products & Price', callback_data: 'adm:pl:0'},
      {text: '💳 Payment Numbers', callback_data: 'adm:ml'},
    ],
    [
      {text: '📢 Store Notice', callback_data: 'adm:nt'},
      {text: '👥 Customers', callback_data: 'adm:cl:0'},
    ],
    [
      {text: '📊 24h & 7d Stats', callback_data: 'adm:st'},
      {text: '⚙️ System & Cron', callback_data: 'adm:sy'},
    ],
    [
      {text: '🔄 Refresh', callback_data: 'adm:home'},
      {text: '🔒 Logout', callback_data: 'adm:logout'},
    ],
  ];

  await sendOrEditPanel(deps, token, chatId, messageId, text, buttons);
}

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
      filter === 'all'
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
          createdAtMs: deps.parseTimestampMillis(data.createdAt),
        };
      })
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
          `• ${o.orderNumber} | ৳${o.totalAmount} | ${o.packageName}\n  UID: ${o.playerUid || '—'} | Pay: ${o.paymentStatus} | ${formatShortDate(o.createdAtMs)}`,
        );
      }
    }

    const buttons: InlineButton[][] = slice.map((o) => [
      {
        text: `🔎 ${o.orderNumber} · ৳${o.totalAmount} (${o.orderStatus})`,
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
      {text: '🔍 Search', callback_data: 'adm:os'},
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
      '',
      `🎮 Product: ${String(o.productName || '—')}`,
      `💎 Package: ${String(o.packageName || '—')}`,
      `🆔 Player UID: ${String(o.playerUid || '—')}`,
      ...(o.serverId ? [`🌐 Server: ${String(o.serverId)}`] : []),
      `💰 Amount: ৳${Number(o.totalAmount || 0)}`,
      `💳 Payment: ${String(o.paymentMethodName || '—')} (${paymentStatus.toUpperCase()})`,
      `🔑 TrxID: ${String(o.trxId || '—')}`,
      ...(o.senderNumber ? [`📱 Sender: ${String(o.senderNumber)}`] : []),
      `📌 Order Status: ${orderStatus.toUpperCase()}`,
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
      {text: '🔑 Voucher & Complete', callback_data: `adm:op:vo:${ref}`},
      {text: '💬 Send Msg + Email', callback_data: `adm:op:nt:${ref}`},
    ]);
    if (orderStatus !== 'cancelled') {
      buttons.push([{text: '🚫 Cancel (& Refund Wallet)', callback_data: `adm:oa:ca:${ref}`}]);
    }
    buttons.push([
      {text: '🔄 Refresh', callback_data: `adm:oi:${ref}`},
      {text: '⬅️ Pending Orders', callback_data: 'adm:ol:pending:0'},
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
  action: 'ap' | 'rp' | 'pr' | 'cp' | 'ca',
  orderId: string,
  extraInput?: string,
): Promise<{ok: boolean; msg: string}> {
  if (!deps.adminDb) return {ok: false, msg: 'Firestore Admin SDK unavailable'};

  try {
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

      if (action === 'cp' && curPaymentStatus !== 'verified' && !extraInput) {
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

      const [custSnap, trackSnap, trxSnap] = await Promise.all([
        custRef ? tx.get(custRef) : Promise.resolve(null),
        trackRef ? tx.get(trackRef) : Promise.resolve(null),
        trxRef ? tx.get(trxRef) : Promise.resolve(null),
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
      msg: `✅ Order ${txResult.orderNumber} updated (${txResult.orderStatus})${txResult.refundedAmount > 0 ? ` • Refunded ৳${txResult.refundedAmount}` : ''}${notifyNotes.length > 0 ? ` • ${notifyNotes.join(' & ')}` : ''}`,
    };
  } catch (err) {
    return {ok: false, msg: friendlyFirestoreError(deps, err)};
  }
}

async function renderWalletTopupsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('walletTopups').get();
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
      `💰 Wallet Top-Up Requests (${list.filter((i) => i.status === 'pending').length} Pending / ${list.length} Total)`,
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
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:tl:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:tl:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([{text: '🏠 Admin Home', callback_data: 'adm:home'}]);

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
        [{text: '⬅️ Top-Ups', callback_data: 'adm:tl:0'}],
      ]);
      return;
    }
    const t = snap.data() as Record<string, unknown>;
    const status = String(t.status || 'pending');
    const lines = [
      ...(banner ? [banner, ''] : []),
      `💰 Wallet Deposit Request`,
      '',
      `👤 Customer: ${String(t.customerName || '—')}`,
      `📧 Email: ${String(t.customerEmail || '—')}`,
      `💵 Amount: ৳${Number(t.amount || 0)}`,
      `💳 Method: ${String(t.paymentMethodName || '—')}`,
      `📱 Sender: ${String(t.senderNumber || '—')}`,
      `🔑 TrxID: ${String(t.trxId || '—')}`,
      `📌 Status: ${status.toUpperCase()}`,
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
      {text: '⬅️ Back to Top-Ups', callback_data: 'adm:tl:0'},
      {text: '🏠 Home', callback_data: 'adm:home'},
    ]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

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

async function renderProductsList(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  page: number,
  messageId?: number,
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
          pkgCount: Array.isArray(p.packages) ? p.packages.length : 0,
          displayOrder: Number(p.displayOrder ?? 0),
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [`💎 Products & Packages (${list.length} টি প্রোডাক্ট)`, ''];
    for (const p of slice) {
      lines.push(`• ${p.active ? '🟢' : '🔴'} ${p.name} (${p.pkgCount} packages)`);
    }

    const buttons: InlineButton[][] = slice.map((p) => [
      {text: `${p.active ? '🟢' : '🔴'} ${p.name}`, callback_data: `adm:pi:${encodeRef(p.id)}`},
    ]);
    const nav: InlineButton[] = [];
    if (safePage > 0) nav.push({text: '⬅️ Prev', callback_data: `adm:pl:${safePage - 1}`});
    if (safePage + 1 < totalPages) nav.push({text: 'Next ➡️', callback_data: `adm:pl:${safePage + 1}`});
    if (nav.length > 0) buttons.push(nav);
    buttons.push([{text: '🏠 Admin Home', callback_data: 'adm:home'}]);

    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
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
      active?: boolean;
      packages?: Array<{id?: string; name?: string; price?: number; active?: boolean}>;
    };
    const pkgs = Array.isArray(p.packages) ? p.packages : [];
    const ref = encodeRef(snap.id);
    const lines = [
      ...(banner ? [banner, ''] : []),
      `🎮 ${p.name || snap.id}`,
      `Status: ${p.active !== false ? '🟢 Active' : '🔴 Hidden'}`,
      '',
      '📦 Packages (ট্যাপ করে On/Off বা Price পরিবর্তন করুন):',
      ...pkgs.map(
        (pkg, idx) =>
          `${idx + 1}. ${pkg.active !== false ? '🟢' : '🔴'} ${pkg.name || 'Package'} — ৳${Number(pkg.price || 0)}`,
      ),
    ];

    const buttons: InlineButton[][] = [
      [
        {
          text: p.active !== false ? '🔴 Hide Product' : '🟢 Activate Product',
          callback_data: `adm:pt:${ref}`,
        },
      ],
    ];
    for (let i = 0; i < Math.min(pkgs.length, 16); i++) {
      const pkg = pkgs[i];
      buttons.push([
        {
          text: `${pkg.active !== false ? '🟢' : '🔴'} ${(pkg.name || '').slice(0, 18)}`,
          callback_data: `adm:gt:${ref}:${i}`,
        },
        {
          text: `✏️ ৳${Number(pkg.price || 0)}`,
          callback_data: `adm:gp:${ref}:${i}`,
        },
      ]);
    }
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
      '',
      ...list.map(
        (m) => `• ${m.active ? '🟢' : '🔴'} ${m.name} (${m.accountType}): ${m.accountNumber}`,
      ),
    ];

    const buttons: InlineButton[][] = list.map((m) => {
      const ref = encodeRef(m.id);
      return [
        {
          text: `${m.active ? '🟢' : '🔴'} ${m.name}`,
          callback_data: `adm:mt:${ref}`,
        },
        {
          text: `✏️ Number (${m.accountNumber.slice(-4)})`,
          callback_data: `adm:mn:${ref}`,
        },
      ];
    });
    buttons.push([{text: '🏠 Admin Home', callback_data: 'adm:home'}]);
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderNoticePanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const snap = await deps.adminDb.collection('settings').doc('storefront').get();
    const s = (snap.exists ? snap.data() : {}) as {
      brandName?: string;
      noticeActive?: boolean;
      noticeText?: string;
    };
    const lines = [
      ...(banner ? [banner, ''] : []),
      `📢 Storefront Notice Bar (${s.brandName || 'MUNAFTOPUP.bd'})`,
      '',
      `Status: ${s.noticeActive ? '🟢 Active (দেখাচ্ছে)' : '🔴 Hidden (বন্ধ)'}`,
      `Text:\n${s.noticeText || '(খালি)'}`,
    ];
    const buttons: InlineButton[][] = [
      [
        {
          text: s.noticeActive ? '🔴 Turn Notice OFF' : '🟢 Turn Notice ON',
          callback_data: 'adm:nt_tog',
        },
        {text: '✏️ Edit Notice Text', callback_data: 'adm:nt_ed'},
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
          suspended: Boolean(c.suspended),
          updatedMs: deps.parseTimestampMillis(c.updatedAt),
        };
      })
      .sort((a, b) => b.updatedMs - a.updatedMs);

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * perPage, safePage * perPage + perPage);

    const lines = [`👥 Customers (${list.length} জন)`, ''];
    for (const c of slice) {
      lines.push(
        `• ${c.suspended ? '🚫' : '🟢'} ${c.name} — ৳${c.balance}${c.email ? ` (${c.email})` : ''}`,
      );
    }

    const buttons: InlineButton[][] = slice.map((c) => [
      {
        text: `${c.suspended ? '🚫' : '👤'} ${c.name.slice(0, 22)} (৳${c.balance})`,
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
    const snap = await deps.adminDb.collection('customers').doc(uid).get();
    if (!snap.exists) {
      await sendOrEditPanel(deps, token, chatId, messageId, '❌ কাস্টমার পাওয়া যায়নি।', [
        [{text: '⬅️ Customers', callback_data: 'adm:cl:0'}],
      ]);
      return;
    }
    const c = snap.data() as Record<string, unknown>;
    const suspended = Boolean(c.suspended);
    const ref = encodeRef(snap.id);
    const lines = [
      ...(banner ? [banner, ''] : []),
      `👤 Customer Profile`,
      '',
      `Name: ${String(c.displayName || '—')}`,
      `Email: ${String(c.email || '—')}`,
      `Phone: ${String(c.phone || '—')}`,
      `Wallet Balance: ৳${Number(c.walletBalance || 0)}`,
      `Account Status: ${suspended ? '🚫 SUSPENDED' : '🟢 ACTIVE'}`,
      ...(c.suspendedReason ? [`Reason: ${String(c.suspendedReason)}`] : []),
    ];
    const buttons: InlineButton[][] = [
      [
        {
          text: suspended ? '✅ Unsuspend Account' : '🚫 Suspend Account',
          callback_data: `adm:ct:${ref}`,
        },
        {text: '💵 Adjust Wallet (+/-)', callback_data: `adm:cw:${ref}`},
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

async function renderAnalyticsPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
): Promise<void> {
  if (!deps.adminDb) return;
  try {
    const [ordersSnap, customersSnap] = await Promise.all([
      deps.adminDb.collection('orders').get(),
      deps.adminDb.collection('customers').get(),
    ]);
    const now = Date.now();
    const d24 = now - 24 * 60 * 60 * 1000;
    const d7 = now - 7 * 24 * 60 * 60 * 1000;

    let total = 0;
    let totalRev = 0;
    let o24 = 0;
    let r24 = 0;
    let tg24 = 0;
    let o7 = 0;
    let r7 = 0;
    let completed = 0;
    let pending = 0;
    let processing = 0;
    let expired = 0;

    for (const docSnap of ordersSnap.docs) {
      const o = docSnap.data() as Record<string, unknown>;
      total += 1;
      const st = String(o.orderStatus || 'pending');
      const pay = String(o.paymentStatus || 'pending');
      const amt = Number(o.totalAmount || 0);
      const ms = deps.parseTimestampMillis(o.createdAt);
      const validRev = st !== 'cancelled' && st !== 'expired' && pay !== 'rejected';
      const isTg =
        String(o.customerUid || '').startsWith('tg_') ||
        String(o.senderNumber || '').toLowerCase() === 'telegram';

      if (st === 'completed') completed += 1;
      else if (st === 'pending') pending += 1;
      else if (st === 'processing') processing += 1;
      else if (st === 'expired') expired += 1;

      if (validRev && Number.isFinite(amt)) totalRev += amt;
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

    const lines = [
      '📊 Store Analytics Report',
      '',
      `🕒 গত ২৪ ঘণ্টা:`,
      `• মোট অর্ডার: ${o24} (Telegram Bot: ${tg24})`,
      `• আয়: ৳${r24.toFixed(0)}`,
      '',
      `📅 গত ৭ দিন:`,
      `• মোট অর্ডার: ${o7}`,
      `• আয়: ৳${r7.toFixed(0)}`,
      '',
      `🏆 সর্বমোট (All-Time):`,
      `• মোট অর্ডার: ${total} (Completed: ${completed})`,
      `• Pending: ${pending} | Processing: ${processing} | Expired: ${expired}`,
      `• মোট আয়: ৳${totalRev.toFixed(0)}`,
      `• মোট কাস্টমার: ${customersSnap.size}`,
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), [
      [
        {text: '🔄 Refresh', callback_data: 'adm:st'},
        {text: '🏠 Admin Home', callback_data: 'adm:home'},
      ],
    ]);
  } catch (err) {
    await sendOrEditPanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err), [
      [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
    ]);
  }
}

async function renderSystemPanel(
  deps: TelegramAdminDeps,
  token: string,
  chatId: number,
  messageId?: number,
  banner?: string,
): Promise<void> {
  const s = deps.readStore().systemSettings;
  const stats = deps.getBotRuntimeStats();

  const lines = [
    ...(banner ? [banner, ''] : []),
    '⚙️ System, Email & Bot Controls',
    '',
    `📧 Outbound SMTP: ${s.smtpEnabled ? '🟢 ON' : '🔴 OFF'}`,
    `📩 Customer Order Emails: ${s.customerEmailNotificationsEnabled !== false ? '🟢 ON' : '🔴 OFF'}`,
    `🚨 Admin Telegram Alerts: ${s.telegramAdminOrderAlerts !== false ? '🟢 ON' : '🔴 OFF'}`,
    `🔘 Bot Quick Replies: ${s.telegramQuickRepliesEnabled !== false ? '🟢 ON' : '🔴 OFF'}`,
    '',
    `🤖 Updates Processed: ${stats.processedUpdates}`,
    `⏱️ Expiry Cron: ${stats.expiryRunning ? 'Active' : 'Stopped'} (Expired: ${stats.expiryTotalExpired})`,
    ...(stats.expiryLastError ? [`⚠️ Cron Note: ${stats.expiryLastError.slice(0, 120)}`] : []),
    `🆔 Your Chat ID: ${chatId}`,
  ];

  const buttons: InlineButton[][] = [
    [
      {
        text: `SMTP: ${s.smtpEnabled ? 'ON' : 'OFF'}`,
        callback_data: 'adm:sy_t:smtp',
      },
      {
        text: `Cust Email: ${s.customerEmailNotificationsEnabled !== false ? 'ON' : 'OFF'}`,
        callback_data: 'adm:sy_t:cust_email',
      },
    ],
    [
      {
        text: `Admin Alerts: ${s.telegramAdminOrderAlerts !== false ? 'ON' : 'OFF'}`,
        callback_data: 'adm:sy_t:alerts',
      },
      {
        text: `Quick Replies: ${s.telegramQuickRepliesEnabled !== false ? 'ON' : 'OFF'}`,
        callback_data: 'adm:sy_t:qr',
      },
    ],
    [
      {text: '✉️ Test SMTP Email', callback_data: 'adm:sy_mail'},
      {text: '⏱️ Run Expiry Now', callback_data: 'adm:sy_exp'},
    ],
    [
      {text: '📜 Server Logs', callback_data: 'adm:sy_log'},
      {text: '🏠 Admin Home', callback_data: 'adm:home'},
    ],
  ];

  await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), buttons);
}

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
        'স্থায়ী অ্যাক্সেসের জন্য এই Chat ID ওয়েবসাইটের Admin Settings > Telegram Admin Chat IDs-এ যোগ করুন, অথবা `/admin আপনার_পাসওয়ার্ড` লিখে লগইন করুন।',
      ].join('\n'),
    );
    return true;
  }

  // Handle pending admin interactive text prompt (e.g. voucher input, reply text, price edit)
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
      adminPromptStates.delete(chatId);
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

  if (lower === '/admin' || lower === '/panel' || /^\/admin\s+/i.test(trimmed)) {
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
        '🔐 Admin Panel লগইন প্রয়োজন:',
        '',
        'অনুগ্রহ করে আপনার Admin Password পাঠান (অথবা ওয়েবসাইটের Admin Settings-এ আপনার নিচের Chat ID যোগ করুন):',
        `🆔 Chat ID: ${chatId}`,
        '',
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
    const mins = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
    await deps.sendTelegramReply(
      token,
      chatId,
      `⏳ অনেকবার ভুল পাসওয়ার্ড দেওয়ায় ${mins} মিনিটের জন্য লক করা হয়েছে।`,
    );
    return;
  }

  if (!verifyTelegramAdminPassword(deps, password)) {
    const nextCount = (attempt?.count || 0) + 1;
    failedLoginAttempts.set(chatId, {
      count: nextCount,
      lockUntil: nextCount >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    });
    await deps.sendTelegramReply(token, chatId, '❌ ভুল Admin Password! আবার চেষ্টা করুন অথবা আপনার Chat ID সেট করুন।');
    return;
  }

  failedLoginAttempts.delete(chatId);
  authenticatedAdminSessions.set(chatId, {
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
    label: `tg_admin_${chatId}`,
  });

  const store = deps.readStore();
  deps.appendServerLog(store, `tg_admin_${chatId}`, 'TELEGRAM_ADMIN_LOGIN', `Telegram chat ${chatId} authenticated to Admin Panel`);
  deps.writeStore(store);

  await deps.sendTelegramReply(
    token,
    chatId,
    '✅ Telegram Admin Panel-এ স্বাগতম! নিরাপত্তার জন্য চ্যাট থেকে আপনার পাসওয়ার্ড মেসেজটি ডিলিট করে দিন।',
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
      batch.update(deps.adminDb.collection('orderTracking').doc(orderNumber), {
        notificationMessage: cleanNote,
        updatedAt: now,
      });
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

      const status = (String(o.orderStatus || 'pending') as
        | 'pending'
        | 'processing'
        | 'completed'
        | 'cancelled'
        | 'expired');
      const payStatus = (String(o.paymentStatus || 'pending') as 'pending' | 'verified' | 'rejected');
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

  if (prompt.type === 'package_price' && prompt.targetId && typeof prompt.extraIndex === 'number' && deps.adminDb) {
    const newPrice = Number(inputText.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice > 1000000) {
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
      pkgs[prompt.extraIndex] = {...pkgs[prompt.extraIndex], price: Number(newPrice.toFixed(2))};
      await prodRef.update({packages: pkgs, updatedAt: FieldValue.serverTimestamp()});
      deps.invalidateBotStoreCache();
      await renderProductInspector(
        deps,
        token,
        chatId,
        prompt.targetId,
        undefined,
        `✅ প্যাকেজ মূল্য ৳${newPrice} আপডেট হয়েছে!`,
      );
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

  if (prompt.type === 'notice_text' && deps.adminDb) {
    const cleanNotice = inputText.trim().slice(0, 300);
    try {
      await deps.adminDb
        .collection('settings')
        .doc('storefront')
        .set({noticeText: cleanNotice, noticeActive: true, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      deps.invalidateBotStoreCache();
      await renderNoticePanel(deps, token, chatId, undefined, '✅ নোটিশ টেক্সট আপডেট ও চালু করা হয়েছে!');
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

  if (prompt.type === 'customer_wallet' && prompt.targetId && deps.adminDb) {
    const delta = Number(inputText.trim());
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 500000) {
      await deps.sendTelegramReply(token, chatId, '❌ সঠিক পরিমাণ লিখুন (যেমন: +100 অথবা -50)।');
      return;
    }
    try {
      const uid = prompt.targetId;
      const result = await deps.adminDb.runTransaction(async (tx) => {
        const ref = deps.adminDb!.collection('customers').doc(uid);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const cur = Number((snap.data() as {walletBalance?: number}).walletBalance || 0);
        const next = Math.max(0, Number((cur + delta).toFixed(2)));
        const now = FieldValue.serverTimestamp();
        tx.update(ref, {walletBalance: next, updatedAt: now});
        const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(deps.adminDb!.collection('auditLogs').doc(logId), {
          id: logId,
          actorEmail: 'telegram_admin',
          actorRole: 'super_admin',
          action: 'TG_ADMIN_WALLET_ADJUST',
          targetType: 'customer',
          targetId: uid,
          details: `Adjusted wallet balance by ${delta > 0 ? `+${delta}` : delta} (৳${cur} -> ৳${next})`,
          createdAt: now,
        });
        return next;
      });
      if (result === null) {
        await deps.sendTelegramReply(token, chatId, '❌ কাস্টমার পাওয়া যায়নি।');
        return;
      }
      await renderCustomerInspector(deps, token, chatId, uid, undefined, `✅ নতুন ওয়ালেট ব্যালেন্স: ৳${result}`);
    } catch (err) {
      await deps.sendTelegramReply(token, chatId, friendlyFirestoreError(deps, err));
    }
  }
}

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

  if (section === 'ol') {
    const filter = parts[2] || 'pending';
    const page = Number(parts[3] || 0) || 0;
    await renderOrdersList(deps, token, chatId, filter, page, messageId);
    return true;
  }

  if (section === 'oi') {
    const orderId = decodeRef(parts[2] || '');
    await renderOrderInspector(deps, token, chatId, orderId, messageId);
    return true;
  }

  if (section === 'oa') {
    const act = parts[2] as 'ap' | 'rp' | 'pr' | 'cp' | 'ca';
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
        ? '🔑 অনুগ্রহ করে এই অর্ডারের জন্য Voucher / Redeem Code টি লিখে পাঠান (পাঠানোর সাথে সাথেই অর্ডার Completed হয়ে ইমেইল ও টেলিগ্রামে চলে যাবে):\n❌ বাতিল করতে "cancel" লিখুন।'
        : '💬 কাস্টমারকে যে আপডেট মেসেজ পাঠাতে চান তা লিখে পাঠান (ইমেইল + টেলিগ্রাম + অ্যাকাউন্টে যাবে):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'os') {
    adminPromptStates.set(chatId, {type: 'order_search', createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '🔍 Order Number (যেমন: SV-123456), Player UID, TrxID বা Email লিখে পাঠান:\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'tl') {
    await renderWalletTopupsList(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
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
        if (customerUid) {
          const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
            id: notifId,
            customerUid,
            orderId: snap.id,
            orderNumber: String(t.trxId || snap.id).slice(0, 32),
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

  if (section === 'pl') {
    await renderProductsList(deps, token, chatId, Number(parts[2] || 0) || 0, messageId);
    return true;
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

  if (section === 'gp') {
    const productId = decodeRef(parts[2] || '');
    const idx = Number(parts[3] ?? -1);
    if (idx >= 0) {
      adminPromptStates.set(chatId, {
        type: 'package_price',
        targetId: productId,
        extraIndex: idx,
        createdAt: Date.now(),
      });
      await deps.sendTelegramReply(
        token,
        chatId,
        '💵 প্যাকেজটির নতুন মূল্য (টাকায় শুধু সংখ্যা, যেমন: 165) লিখে পাঠান:\n❌ বাতিল করতে "cancel" লিখুন।',
      );
    }
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

  if (section === 'nt') {
    await renderNoticePanel(deps, token, chatId, messageId);
    return true;
  }

  if (section === 'nt_tog' && deps.adminDb) {
    try {
      const ref = deps.adminDb.collection('settings').doc('storefront');
      const snap = await ref.get();
      const cur = snap.exists ? Boolean((snap.data() as {noticeActive?: boolean}).noticeActive) : false;
      await ref.set({noticeActive: !cur, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      deps.invalidateBotStoreCache();
      await renderNoticePanel(deps, token, chatId, messageId, `✅ Notice Bar ${!cur ? 'ON' : 'OFF'} করা হয়েছে।`);
    } catch (err) {
      await renderNoticePanel(deps, token, chatId, messageId, friendlyFirestoreError(deps, err));
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

  if (section === 'cw') {
    const uid = decodeRef(parts[2] || '');
    adminPromptStates.set(chatId, {type: 'customer_wallet', targetId: uid, createdAt: Date.now()});
    await deps.sendTelegramReply(
      token,
      chatId,
      '💵 কত টাকা যোগ বা বিয়োগ করতে চান লিখুন (যেমন: +100 অথবা -50):\n❌ বাতিল করতে "cancel" লিখুন।',
    );
    return true;
  }

  if (section === 'st') {
    await renderAnalyticsPanel(deps, token, chatId, messageId);
    return true;
  }

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
    const res = await deps.sendAdminNotificationEmail(
      'Telegram Admin Panel — SMTP Test',
      [
        {label: 'Status', value: 'SMTP working'},
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
      res.sent ? `✅ Test email sent to ${res.toEmail}` : `❌ Email failed: ${res.reason}`,
    );
    return true;
  }

  if (section === 'sy_exp') {
    await deps.runOrderExpiryNow();
    await renderSystemPanel(deps, token, chatId, messageId, '✅ Pending order expiry check সম্পন্ন হয়েছে।');
    return true;
  }

  if (section === 'sy_log') {
    const logs = deps.readStore().serverLogs.slice(0, 10);
    const lines = [
      '📜 Recent Server Logs (Last 10)',
      '',
      ...(logs.length === 0
        ? ['কোনো লগ নেই।']
        : logs.map((l) => `• ${l.action} — ${l.details.slice(0, 90)}`)),
    ];
    await sendOrEditPanel(deps, token, chatId, messageId, lines.join('\n'), [
      [
        {text: '⬅️ System', callback_data: 'adm:sy'},
        {text: '🏠 Home', callback_data: 'adm:home'},
      ],
    ]);
    return true;
  }

  return false;
}
