import crypto from 'node:crypto';
import type {Express, NextFunction, Request, Response} from 'express';
import {FieldValue, Timestamp, type Firestore} from 'firebase-admin/firestore';

export type CustomerTier = 'regular' | 'vip' | 'reseller';
export type GatewayProvider = 'none' | 'uddoktapay' | 'sslcommerz' | 'bkash_merchant' | 'nagad_merchant';

export interface CommerceSettings {
  vipSpendThreshold: number;
  vipDiscountPercent: number;
  resellerSpendThreshold: number;
  resellerDiscountPercent: number;
  referralBonusAmount: number;
  loyaltyPercent: number;
  loyaltyPointValueBdt: number;
  fraudMaxFailedTrxPerHour: number;
  fraudMaxOrdersPer10Min: number;
  gatewayEnabled: boolean;
  gatewayProvider: GatewayProvider;
  gatewayBaseUrl: string;
  gatewayApiKey: string;
  gatewayWebhookSecret: string;
}

export const DEFAULT_COMMERCE_SETTINGS: CommerceSettings = {
  vipSpendThreshold: 5000,
  vipDiscountPercent: 2,
  resellerSpendThreshold: 20000,
  resellerDiscountPercent: 5,
  referralBonusAmount: 20,
  loyaltyPercent: 1,
  loyaltyPointValueBdt: 1,
  fraudMaxFailedTrxPerHour: 5,
  fraudMaxOrdersPer10Min: 4,
  gatewayEnabled: false,
  gatewayProvider: 'none',
  gatewayBaseUrl: '',
  gatewayApiKey: '',
  gatewayWebhookSecret: '',
};

export interface CommerceDeps {
  adminDb: Firestore | null;
  readStore: () => any;
  writeStore: (store: any) => void;
  appendServerLog: (store: any, actorEmail: string, action: string, details: string) => void;
  requireSignedInFirebase: (req: any, res: Response, next: NextFunction) => Promise<void> | void;
  requireAdmin: (permission?: any) => (req: any, res: Response, next: NextFunction) => Promise<void> | void;
  timingSafeEqualsText: (a: string, b: string) => boolean;
  markNotificationEventSent: (key: string) => boolean;
  sendAdminNotificationEmail: (
    subject: string,
    rows: Array<{label: string; value: string}>,
    actorEmail: string,
  ) => Promise<{sent: boolean; reason?: string; toEmail?: string}>;
  sendCustomerOrderEmail: (params: any) => Promise<{sent: boolean; skipped?: boolean; reason?: string; toEmail?: string}>;
  sendCustomerGenericEmail: (params: {
    toEmail?: string;
    customerName?: string;
    subject: string;
    headline: string;
    rows: Array<{label: string; value: string}>;
    message?: string;
  }) => Promise<{sent: boolean; skipped?: boolean; reason?: string}>;
  sendTelegramOrderStatusUpdate: (params: any) => Promise<{sent: boolean; skipped?: boolean; reason?: string}>;
  notifyTelegramAdmins: (text: string, replyMarkup?: any) => Promise<void>;
  makeAdminOrderCallback: (orderId: string) => string;
  websiteUrl: string;
  onLowVoucherStock?: (params: {
    productId: string;
    productName: string;
    packageId: string;
    packageName: string;
    remaining: number;
  }) => Promise<void> | void;
  onDistributorFailed?: (params: {
    orderNumber: string;
    productName: string;
    packageName: string;
    errorText: string;
    endpoint?: string;
  }) => Promise<void> | void;
  onOrderCompletedPush?: (params: {
    customerUid: string;
    orderNumber: string;
    productName: string;
    packageName: string;
    voucherCode?: string;
  }) => Promise<void> | void;
}

export function normalizeCommerceSettings(raw?: Partial<CommerceSettings> | null): CommerceSettings {
  const num = (val: unknown, fallback: number, min = 0, max = 10000000) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const validProviders: GatewayProvider[] = ['none', 'uddoktapay', 'sslcommerz', 'bkash_merchant', 'nagad_merchant'];
  const prov = validProviders.includes(raw?.gatewayProvider as GatewayProvider)
    ? (raw?.gatewayProvider as GatewayProvider)
    : 'none';

  return {
    vipSpendThreshold: num(raw?.vipSpendThreshold, DEFAULT_COMMERCE_SETTINGS.vipSpendThreshold, 100, 1000000),
    vipDiscountPercent: num(raw?.vipDiscountPercent, DEFAULT_COMMERCE_SETTINGS.vipDiscountPercent, 0, 50),
    resellerSpendThreshold: num(raw?.resellerSpendThreshold, DEFAULT_COMMERCE_SETTINGS.resellerSpendThreshold, 500, 5000000),
    resellerDiscountPercent: num(raw?.resellerDiscountPercent, DEFAULT_COMMERCE_SETTINGS.resellerDiscountPercent, 0, 60),
    referralBonusAmount: num(raw?.referralBonusAmount, DEFAULT_COMMERCE_SETTINGS.referralBonusAmount, 0, 5000),
    loyaltyPercent: num(raw?.loyaltyPercent, DEFAULT_COMMERCE_SETTINGS.loyaltyPercent, 0, 25),
    loyaltyPointValueBdt: num(raw?.loyaltyPointValueBdt, DEFAULT_COMMERCE_SETTINGS.loyaltyPointValueBdt, 0.1, 100),
    fraudMaxFailedTrxPerHour: Math.round(num(raw?.fraudMaxFailedTrxPerHour, DEFAULT_COMMERCE_SETTINGS.fraudMaxFailedTrxPerHour, 1, 50)),
    fraudMaxOrdersPer10Min: Math.round(num(raw?.fraudMaxOrdersPer10Min, DEFAULT_COMMERCE_SETTINGS.fraudMaxOrdersPer10Min, 1, 50)),
    gatewayEnabled: Boolean(raw?.gatewayEnabled),
    gatewayProvider: prov,
    gatewayBaseUrl: String(raw?.gatewayBaseUrl || '').trim().slice(0, 300),
    gatewayApiKey: String(raw?.gatewayApiKey || '').trim().slice(0, 400),
    gatewayWebhookSecret: String(raw?.gatewayWebhookSecret || '').trim().slice(0, 400),
  };
}

// Sliding-window in-memory fraud / rate limit trackers
const failedTrxAttempts = new Map<string, number[]>();
const recentCheckoutAttempts = new Map<string, number[]>();

function recordAndCountWindow(map: Map<string, number[]>, key: string, windowMs: number, recordNew: boolean): number {
  const now = Date.now();
  const prev = (map.get(key) || []).filter((ts) => now - ts <= windowMs);
  if (recordNew) prev.push(now);
  if (prev.length > 0) {
    map.set(key, prev);
  } else {
    map.delete(key);
  }
  return prev.length;
}

function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SV${datePart}${rand}`;
}

function generateReferralCode(uid: string): string {
  const hash = crypto.createHash('sha256').update(uid).digest('hex').slice(0, 6).toUpperCase();
  return `MN${hash}`;
}

function maskPlayerUid(uid: string): string {
  const cleaned = uid.trim();
  if (!cleaned) return 'N/A';
  if (cleaned.length <= 4) return '****';
  return `${cleaned.slice(0, 2)}${'*'.repeat(Math.max(2, cleaned.length - 4))}${cleaned.slice(-2)}`;
}

async function resolveSmsPaymentRef(adminDb: Firestore, rawTrxId: string) {
  const upperTrx = rawTrxId.trim().toUpperCase();
  const exactRef = adminDb.collection('sms_payments').doc(upperTrx);
  const exactSnap = await exactRef.get();
  if (exactSnap.exists) {
    return exactRef;
  }

  // Case-insensitive fallback scan over unused records in case an entry was created with lowercase/mixed-case ID
  const unusedSnap = await adminDb.collection('sms_payments').where('used', '==', false).get();
  const matchedUnused = unusedSnap.docs.find((d) => {
    const data = d.data() as Record<string, unknown>;
    return (
      d.id.trim().toUpperCase() === upperTrx ||
      String(data.trxId || '').trim().toUpperCase() === upperTrx
    );
  });
  if (matchedUnused) {
    return matchedUnused.ref;
  }

  // Fallback check if any matching TrxID already exists in lowercase/mixed case as used
  const lowerRef = adminDb.collection('sms_payments').doc(rawTrxId.trim().toLowerCase());
  const lowerSnap = await lowerRef.get();
  if (lowerSnap.exists) {
    return lowerRef;
  }

  return exactRef;
}

function isFlashSaleCurrentlyActive(sale: Record<string, unknown>, productId: string): boolean {
  if (!sale || sale.active !== true) return false;
  if (String(sale.productId || '').trim() !== productId) return false;
  const pct = Number(sale.discountPercent || 0);
  if (!(pct > 0 && pct <= 90)) return false;
  const now = Date.now();
  const startsMs = sale.startsAt ? Date.parse(String(sale.startsAt)) : 0;
  const endsMs = sale.endsAt ? Date.parse(String(sale.endsAt)) : 0;
  if (Number.isFinite(startsMs) && startsMs > 0 && now < startsMs) return false;
  if (Number.isFinite(endsMs) && endsMs > 0 && now > endsMs) return false;
  return true;
}

async function writeApiLog(
  adminDb: Firestore | null,
  entry: {
    type: 'distributor' | 'payment_gateway' | 'pin_vault' | 'fraud_guard';
    orderNumber: string;
    endpoint: string;
    status: 'success' | 'failed' | 'pending';
    httpStatus?: number;
    message: string;
    responsePreview?: string;
  },
): Promise<void> {
  if (!adminDb) return;
  try {
    const id = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await adminDb.collection('apiLogs').doc(id).set({
      id,
      type: entry.type,
      orderNumber: String(entry.orderNumber || 'SYSTEM').slice(0, 32),
      endpoint: String(entry.endpoint || '').slice(0, 300),
      status: entry.status,
      ...(typeof entry.httpStatus === 'number' ? {httpStatus: entry.httpStatus} : {}),
      message: String(entry.message || '').slice(0, 1000),
      ...(entry.responsePreview ? {responsePreview: String(entry.responsePreview).slice(0, 1000)} : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[apiLogs] write warning:', err instanceof Error ? err.message : err);
  }
}

export async function dispatchDistributorWithLog(
  deps: CommerceDeps,
  params: {
    orderId?: string;
    orderNumber: string;
    productId: string;
    productName: string;
    packageId: string;
    packageName: string;
    playerUid: string;
    serverId?: string;
    amount: number;
  },
): Promise<{dispatched: boolean; status: 'none' | 'dispatched' | 'success' | 'failed'; httpStatus?: number; statusText: string; externalRef?: string}> {
  const store = deps.readStore();
  const s = store.systemSettings || {};
  if (!s.distributorEnabled || !s.distributorBaseUrl || !s.distributorApiKey) {
    return {dispatched: false, status: 'none', statusText: 'Distributor API not enabled or missing credentials'};
  }

  let endpoint = '';
  try {
    const parsedUrl = new URL(String(s.distributorBaseUrl));
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return {dispatched: false, status: 'failed', statusText: 'Invalid distributor URL protocol'};
    }
    endpoint = `${parsedUrl.toString().replace(/\/$/, '')}/orders`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const idempotencyKey = `munaf_${params.orderNumber}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.distributorApiKey}`,
        'X-Merchant-Id': String(s.distributorMerchantId || ''),
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        orderNumber: params.orderNumber,
        idempotencyKey,
        productId: params.productId,
        productName: params.productName,
        packageId: params.packageId,
        packageName: params.packageName,
        playerUid: params.playerUid,
        serverId: params.serverId || 'N/A',
        amount: params.amount,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const bodyText = await res.text().catch(() => '');
    let externalRef = '';
    try {
      const parsedBody = JSON.parse(bodyText) as {reference?: string; ref?: string; id?: string; order_id?: string};
      externalRef = String(parsedBody.reference || parsedBody.ref || parsedBody.order_id || parsedBody.id || '').slice(0, 128);
    } catch {
      // ignore non-json
    }
    const status: 'success' | 'failed' = res.ok ? 'success' : 'failed';
    await writeApiLog(deps.adminDb, {
      type: 'distributor',
      orderNumber: params.orderNumber,
      endpoint,
      status,
      httpStatus: res.status,
      message: res.ok ? `Dispatched cleanly (HTTP ${res.status})` : `Distributor rejected (HTTP ${res.status})`,
      responsePreview: bodyText.slice(0, 500),
    });

    if (deps.adminDb && params.orderId) {
      await deps.adminDb
        .collection('orders')
        .doc(params.orderId)
        .update({
          distributorStatus: res.ok ? 'dispatched' : 'failed',
          ...(externalRef ? {distributorRef: externalRef} : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => null);
    }

    if (!res.ok && deps.onDistributorFailed) {
      void deps.onDistributorFailed({
        orderNumber: params.orderNumber,
        productName: params.productName,
        packageName: params.packageName,
        errorText: `HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
        endpoint,
      });
    }

    return {
      dispatched: res.ok,
      status: res.ok ? 'dispatched' : 'failed',
      httpStatus: res.status,
      statusText: `HTTP ${res.status}`,
      externalRef: externalRef || undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeApiLog(deps.adminDb, {
      type: 'distributor',
      orderNumber: params.orderNumber,
      endpoint: endpoint || String(s.distributorBaseUrl || ''),
      status: 'failed',
      message: msg,
    });
    if (deps.adminDb && params.orderId) {
      await deps.adminDb
        .collection('orders')
        .doc(params.orderId)
        .update({
          distributorStatus: 'failed',
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => null);
    }
    if (deps.onDistributorFailed) {
      void deps.onDistributorFailed({
        orderNumber: params.orderNumber,
        productName: params.productName,
        packageName: params.packageName,
        errorText: msg,
        endpoint: endpoint || String(s.distributorBaseUrl || ''),
      });
    }
    return {dispatched: false, status: 'failed', statusText: msg};
  }
}

export async function settleOrderCompletionEffects(
  deps: CommerceDeps,
  orderId: string,
): Promise<{settled: boolean; pointsAwarded: number; referralBonusAwarded: number; newTier?: CustomerTier}> {
  if (!deps.adminDb) return {settled: false, pointsAwarded: 0, referralBonusAwarded: 0};

  const store = deps.readStore();
  const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);

  try {
    const outcome = await deps.adminDb.runTransaction(async (tx) => {
      const orderRef = deps.adminDb!.collection('orders').doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return null;

      const order = orderSnap.data() as Record<string, unknown>;
      if (order.orderStatus !== 'completed') return null;
      if (Number(order.loyaltyPointsEarned || 0) > 0) {
        return {alreadySettled: true, pointsAwarded: 0, referralBonusAwarded: 0};
      }

      const customerUid = String(order.customerUid || '').trim();
      const totalAmount = Number(order.totalAmount || 0);
      if (!customerUid || customerUid.startsWith('tg_') || !(totalAmount > 0)) {
        return {alreadySettled: true, pointsAwarded: 0, referralBonusAwarded: 0};
      }

      const custRef = deps.adminDb!.collection('customers').doc(customerUid);
      const custSnap = await tx.get(custRef);
      if (!custSnap.exists) return null;

      const cust = custSnap.data() as Record<string, unknown>;
      const referrerUid =
        typeof cust.referredBy === 'string' &&
        cust.referredBy.trim() &&
        cust.referredBy.trim() !== customerUid &&
        cust.referralRewarded !== true
          ? cust.referredBy.trim()
          : '';
      const referrerRef = referrerUid ? deps.adminDb!.collection('customers').doc(referrerUid) : null;
      const referrerSnap = referrerRef ? await tx.get(referrerRef) : null;

      // ALL READS COMPLETED BEFORE WRITES
      const now = FieldValue.serverTimestamp();
      const pointsToAdd = Math.max(1, Math.floor((totalAmount * cfg.loyaltyPercent) / 100));
      const nextPoints = Number(cust.loyaltyPoints || 0) + pointsToAdd;
      const nextSpent = Number((Number(cust.totalSpent || 0) + totalAmount).toFixed(2));

      let nextTier: CustomerTier =
        cust.tier === 'vip' || cust.tier === 'reseller' ? cust.tier : 'regular';
      if (cust.tierLocked !== true) {
        if (nextSpent >= cfg.resellerSpendThreshold) nextTier = 'reseller';
        else if (nextSpent >= cfg.vipSpendThreshold) nextTier = 'vip';
        else nextTier = 'regular';
      }

      const custUpdate: Record<string, unknown> = {
        loyaltyPoints: nextPoints,
        totalSpent: nextSpent,
        tier: nextTier,
        updatedAt: now,
      };
      if (!cust.referralCode) {
        custUpdate.referralCode = generateReferralCode(customerUid);
      }

      let referralBonusAwarded = 0;
      if (referrerRef && referrerSnap?.exists && cfg.referralBonusAmount > 0) {
        const refData = referrerSnap.data() as Record<string, unknown>;
        const nextRefWallet = Number((Number(refData.walletBalance || 0) + cfg.referralBonusAmount).toFixed(2));
        tx.update(referrerRef, {
          walletBalance: nextRefWallet,
          updatedAt: now,
        });
        custUpdate.referralRewarded = true;
        referralBonusAwarded = cfg.referralBonusAmount;

        const refEventId = `ref_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        tx.set(deps.adminDb!.collection('referralEvents').doc(refEventId), {
          id: refEventId,
          referrerUid,
          referredUid: customerUid,
          referredEmail: String(cust.email || ''),
          eventType: 'referral_bonus',
          orderNumber: String(order.orderNumber || orderId),
          walletDelta: cfg.referralBonusAmount,
          pointsDelta: 0,
          note: `Referral bonus credited for 1st completed order ${String(order.orderNumber || orderId)}`,
          createdAt: now,
        });
      }

      tx.update(custRef, custUpdate);
      tx.update(orderRef, {
        loyaltyPointsEarned: pointsToAdd,
        updatedAt: now,
      });

      const loyaltyEventId = `loy_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      tx.set(deps.adminDb!.collection('referralEvents').doc(loyaltyEventId), {
        id: loyaltyEventId,
        referrerUid: customerUid,
        referredUid: customerUid,
        referredEmail: String(cust.email || ''),
        eventType: 'loyalty_earn',
        orderNumber: String(order.orderNumber || orderId),
        walletDelta: 0,
        pointsDelta: pointsToAdd,
        note: `Earned ${pointsToAdd} loyalty points from order ${String(order.orderNumber || orderId)}`,
        createdAt: now,
      });

      return {
        alreadySettled: false,
        pointsAwarded: pointsToAdd,
        referralBonusAwarded,
        newTier: nextTier,
      };
    });

    if (!outcome || outcome.alreadySettled) {
      return {settled: false, pointsAwarded: 0, referralBonusAwarded: 0};
    }
    return {
      settled: true,
      pointsAwarded: outcome.pointsAwarded,
      referralBonusAwarded: outcome.referralBonusAwarded,
      newTier: outcome.newTier,
    };
  } catch (err) {
    console.warn('[settleOrderCompletionEffects] warning:', err instanceof Error ? err.message : err);
    return {settled: false, pointsAwarded: 0, referralBonusAwarded: 0};
  }
}

export function registerCommerceRoutes(app: Express, deps: CommerceDeps): void {
  // Public program configuration (VIP thresholds, loyalty %, referral bonus, gateway availability — NO secrets)
  app.get('/api/store/program-config', (_req, res) => {
    const store = deps.readStore();
    const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);
    const distEnabled = Boolean(
      store.systemSettings?.distributorEnabled &&
        store.systemSettings?.distributorBaseUrl &&
        store.systemSettings?.distributorApiKey,
    );
    res.json({
      vipSpendThreshold: cfg.vipSpendThreshold,
      vipDiscountPercent: cfg.vipDiscountPercent,
      resellerSpendThreshold: cfg.resellerSpendThreshold,
      resellerDiscountPercent: cfg.resellerDiscountPercent,
      referralBonusAmount: cfg.referralBonusAmount,
      loyaltyPercent: cfg.loyaltyPercent,
      loyaltyPointValueBdt: cfg.loyaltyPointValueBdt,
      fraudMaxFailedTrxPerHour: cfg.fraudMaxFailedTrxPerHour,
      fraudMaxOrdersPer10Min: cfg.fraudMaxOrdersPer10Min,
      gatewayEnabled: Boolean(cfg.gatewayEnabled && cfg.gatewayProvider !== 'none' && cfg.gatewayApiKey && cfg.gatewayBaseUrl),
      gatewayProvider: cfg.gatewayProvider,
      distributorEnabled: distEnabled,
    });
  });

  // Admin Commerce & Gateway Settings
  app.get('/api/admin/commerce-settings', deps.requireAdmin('settings'), (_req, res) => {
    const store = deps.readStore();
    const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);
    res.json({
      settings: {
        vipSpendThreshold: cfg.vipSpendThreshold,
        vipDiscountPercent: cfg.vipDiscountPercent,
        resellerSpendThreshold: cfg.resellerSpendThreshold,
        resellerDiscountPercent: cfg.resellerDiscountPercent,
        referralBonusAmount: cfg.referralBonusAmount,
        loyaltyPercent: cfg.loyaltyPercent,
        loyaltyPointValueBdt: cfg.loyaltyPointValueBdt,
        fraudMaxFailedTrxPerHour: cfg.fraudMaxFailedTrxPerHour,
        fraudMaxOrdersPer10Min: cfg.fraudMaxOrdersPer10Min,
        gatewayEnabled: cfg.gatewayEnabled,
        gatewayProvider: cfg.gatewayProvider,
        gatewayBaseUrl: cfg.gatewayBaseUrl,
        hasGatewayApiKey: Boolean(cfg.gatewayApiKey),
        hasGatewayWebhookSecret: Boolean(cfg.gatewayWebhookSecret),
      },
    });
  });

  app.put('/api/admin/commerce-settings', deps.requireAdmin('settings'), (req: any, res: Response) => {
    const body = (req.body || {}) as Partial<CommerceSettings>;
    const store = deps.readStore();
    const prev = normalizeCommerceSettings(store.systemSettings?.commerce);
    const merged = normalizeCommerceSettings({
      ...prev,
      ...body,
      gatewayApiKey: body.gatewayApiKey ? String(body.gatewayApiKey).trim() : prev.gatewayApiKey,
      gatewayWebhookSecret: body.gatewayWebhookSecret
        ? String(body.gatewayWebhookSecret).trim()
        : prev.gatewayWebhookSecret,
    });
    if (!store.systemSettings) store.systemSettings = {};
    store.systemSettings.commerce = merged;
    store.systemSettings.updatedAt = new Date().toISOString();
    deps.appendServerLog(
      store,
      req.adminSession?.email || 'admin',
      'COMMERCE_SETTINGS_UPDATED',
      `Updated VIP/Reseller/Loyalty/Fraud/Gateway settings (gateway=${merged.gatewayProvider})`,
    );
    deps.writeStore(store);
    res.json({ok: true});
  });

  // Ensure customer referralCode + defaults exist
  app.post('/api/customer/ensure-rewards-profile', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    const uid = String(req.firebaseAuthUid || '').trim();
    if (!uid || !deps.adminDb) {
      res.status(400).json({error: 'Customer authentication required'});
      return;
    }
    try {
      const custRef = deps.adminDb.collection('customers').doc(uid);
      const snap = await custRef.get();
      if (!snap.exists) {
        res.json({ok: true, initialized: false});
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (!data.referralCode) patch.referralCode = generateReferralCode(uid);
      if (!data.tier) patch.tier = 'regular';
      if (typeof data.loyaltyPoints !== 'number') patch.loyaltyPoints = 0;
      if (typeof data.totalSpent !== 'number') patch.totalSpent = 0;
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = FieldValue.serverTimestamp();
        await custRef.update(patch);
      }
      res.json({ok: true, referralCode: String(patch.referralCode || data.referralCode || '')});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to initialize rewards profile'});
    }
  });

  // Claim a referral code (once per new customer)
  app.post('/api/customer/referral-claim', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    const uid = String(req.firebaseAuthUid || '').trim();
    const rawCode = String(req.body?.referralCode || '').trim().toUpperCase().slice(0, 32);
    if (!uid || !deps.adminDb) {
      res.status(400).json({error: 'Authentication required'});
      return;
    }
    if (!rawCode || !/^[A-Z0-9_-]{4,32}$/.test(rawCode)) {
      res.status(400).json({error: 'Invalid referral code format'});
      return;
    }
    try {
      const custRef = deps.adminDb.collection('customers').doc(uid);
      const [custSnap, referrerQuery] = await Promise.all([
        custRef.get(),
        deps.adminDb.collection('customers').where('referralCode', '==', rawCode).limit(1).get(),
      ]);
      if (!custSnap.exists) {
        res.status(404).json({error: 'Customer profile not found'});
        return;
      }
      const custData = custSnap.data() as Record<string, unknown>;
      if (custData.referredBy) {
        res.json({ok: true, alreadyClaimed: true});
        return;
      }
      if (referrerQuery.empty) {
        res.status(404).json({error: 'Referral code not found'});
        return;
      }
      const referrerDoc = referrerQuery.docs[0];
      if (referrerDoc.id === uid) {
        res.status(400).json({error: 'You cannot use your own referral code'});
        return;
      }
      await custRef.update({
        referredBy: referrerDoc.id,
        referralRewarded: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      res.json({ok: true, referredBy: referrerDoc.id});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to apply referral code'});
    }
  });

  // Redeem Loyalty Points -> Wallet Balance atomically
  app.post('/api/customer/loyalty-redeem', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    const uid = String(req.firebaseAuthUid || '').trim();
    const requestedPoints = Math.floor(Number(req.body?.points || 0));
    if (!uid || !deps.adminDb) {
      res.status(401).json({error: 'Authentication required'});
      return;
    }
    if (!(requestedPoints >= 10)) {
      res.status(400).json({error: 'Minimum 10 loyalty points required to redeem'});
      return;
    }
    const store = deps.readStore();
    const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);

    try {
      const result = await deps.adminDb.runTransaction(async (tx) => {
        const custRef = deps.adminDb!.collection('customers').doc(uid);
        const custSnap = await tx.get(custRef);
        if (!custSnap.exists) throw new Error('Customer profile not found');
        const cust = custSnap.data() as Record<string, unknown>;
        if (cust.suspended === true) throw new Error('Account suspended');

        const currentPoints = Number(cust.loyaltyPoints || 0);
        if (currentPoints < requestedPoints) {
          throw new Error(`Insufficient points. You have ${currentPoints} points.`);
        }
        const bdtValue = Number((requestedPoints * cfg.loyaltyPointValueBdt).toFixed(2));
        const nextPoints = currentPoints - requestedPoints;
        const nextWallet = Number((Number(cust.walletBalance || 0) + bdtValue).toFixed(2));
        const now = FieldValue.serverTimestamp();

        tx.update(custRef, {
          loyaltyPoints: nextPoints,
          walletBalance: nextWallet,
          updatedAt: now,
        });

        const evId = `redeem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        tx.set(deps.adminDb!.collection('referralEvents').doc(evId), {
          id: evId,
          referrerUid: uid,
          referredUid: uid,
          referredEmail: String(cust.email || ''),
          eventType: 'loyalty_redeem',
          walletDelta: bdtValue,
          pointsDelta: -requestedPoints,
          note: `Redeemed ${requestedPoints} loyalty points for ৳${bdtValue} wallet credit`,
          createdAt: now,
        });

        return {nextPoints, nextWallet, bdtValue};
      });

      res.json({ok: true, ...result});
    } catch (err) {
      res.status(400).json({error: err instanceof Error ? err.message : 'Unable to redeem points'});
    }
  });

  // Validate coupon / preview server pricing
  app.post('/api/store/validate-coupon', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    const uid = String(req.firebaseAuthUid || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase().slice(0, 40);
    const productId = String(req.body?.productId || '').trim().slice(0, 128);
    const packageId = String(req.body?.packageId || '').trim().slice(0, 128);

    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    if (!code) {
      res.status(400).json({error: 'Enter a promo code'});
      return;
    }

    try {
      const [couponSnap, productSnap, custSnap, flashSnap] = await Promise.all([
        deps.adminDb.collection('coupons').where('code', '==', code).limit(1).get(),
        productId ? deps.adminDb.collection('products').doc(productId).get() : Promise.resolve(null),
        uid ? deps.adminDb.collection('customers').doc(uid).get() : Promise.resolve(null),
        productId
          ? deps.adminDb.collection('flashSales').where('productId', '==', productId).get()
          : Promise.resolve(null),
      ]);

      if (couponSnap.empty) {
        res.status(404).json({error: 'Invalid promo code'});
        return;
      }

      const coupon = couponSnap.docs[0].data() as Record<string, unknown>;
      if (coupon.active !== true) {
        res.status(400).json({error: 'This promo code is inactive'});
        return;
      }
      if (coupon.expiresAt && Date.parse(String(coupon.expiresAt)) > 0 && Date.now() > Date.parse(String(coupon.expiresAt))) {
        res.status(400).json({error: 'This promo code has expired'});
        return;
      }
      const usageLimit = Number(coupon.usageLimit || 0);
      const usedCount = Number(coupon.usedCount || 0);
      if (usageLimit > 0 && usedCount >= usageLimit) {
        res.status(400).json({error: 'Promo code usage limit reached'});
        return;
      }

      const perUserLimit = Number(coupon.perUserLimit || 0);
      if (perUserLimit > 0 && uid) {
        const userOrdersSnap = await deps.adminDb
          .collection('orders')
          .where('customerUid', '==', uid)
          .where('couponCode', '==', code)
          .get();
        const validUses = userOrdersSnap.docs.filter((d) => d.data().orderStatus !== 'cancelled' && d.data().orderStatus !== 'expired').length;
        if (validUses >= perUserLimit) {
          res.status(400).json({error: `You have already used ${code} the maximum (${perUserLimit}) times`});
          return;
        }
      }

      let baseAmount = Number(req.body?.amount || 0);
      let flashDiscount = 0;
      let tierDiscount = 0;

      if (productSnap?.exists && packageId) {
        const prod = productSnap.data() as {packages?: Array<{id: string; price: number}>};
        const pkg = (prod.packages || []).find((p) => p.id === packageId);
        if (pkg) {
          baseAmount = Number(pkg.price || 0);
          const activeSale = flashSnap?.docs
            .map((d) => d.data() as Record<string, unknown>)
            .find((s) => isFlashSaleCurrentlyActive(s, productId));
          if (activeSale) {
            flashDiscount = Number(((baseAmount * Number(activeSale.discountPercent || 0)) / 100).toFixed(2));
          }
          const store = deps.readStore();
          const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);
          const tier = (custSnap?.data()?.tier as CustomerTier) || 'regular';
          const tierPct =
            tier === 'reseller' ? cfg.resellerDiscountPercent : tier === 'vip' ? cfg.vipDiscountPercent : 0;
          if (tierPct > 0) {
            tierDiscount = Number((((Math.max(1, baseAmount - flashDiscount)) * tierPct) / 100).toFixed(2));
          }
        }
      }

      const subtotalAfterTier = Math.max(1, Number((baseAmount - flashDiscount - tierDiscount).toFixed(2)));
      const minOrderAmount = Number(coupon.minOrderAmount || 0);
      if (minOrderAmount > 0 && subtotalAfterTier < minOrderAmount) {
        res.status(400).json({error: `Minimum order of ৳${minOrderAmount} required for ${code}`});
        return;
      }

      let discountAmount =
        coupon.discountType === 'percent'
          ? Number(((subtotalAfterTier * Number(coupon.discountValue || 0)) / 100).toFixed(2))
          : Number(coupon.discountValue || 0);

      const maxDiscount = Number(coupon.maxDiscountAmount || 0);
      if (maxDiscount > 0 && discountAmount > maxDiscount) {
        discountAmount = maxDiscount;
      }
      discountAmount = Math.min(Math.max(0, discountAmount), Math.max(0, subtotalAfterTier - 1));

      res.json({
        ok: true,
        coupon: {
          id: couponSnap.docs[0].id,
          code,
          title: String(coupon.title || code),
          discountType: coupon.discountType,
          discountValue: Number(coupon.discountValue || 0),
          discountAmount: Number(discountAmount.toFixed(2)),
        },
      });
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to validate promo code'});
    }
  });

  // Enhanced Server-Authoritative Order Creation (Promo + VIP Tier + Flash Sale + Vault PIN + Fraud Guard + SMS Auto-Verify + Distributor)
  const handleCreateOrder = async (req: any, res: Response) => {
    const uid = String(req.firebaseAuthUid || '').trim();
    if (!uid || !deps.adminDb) {
      res.status(401).json({error: 'Customer authentication required'});
      return;
    }

    const store = deps.readStore();
    const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);
    const body = (req.body || {}) as {
      productId?: string;
      packageId?: string;
      playerUid?: string;
      playerIgn?: string;
      serverId?: string;
      customerName?: string;
      customerPhone?: string;
      paymentType?: 'manual' | 'wallet';
      paymentMethodId?: string;
      senderNumber?: string;
      trxId?: string;
      screenshotUrl?: string;
      couponCode?: string;
      confirmDuplicate?: boolean;
    };

    const productId = String(body.productId || '').trim().slice(0, 128);
    const packageId = String(body.packageId || '').trim().slice(0, 128);
    const playerUid = String(body.playerUid || '').trim().slice(0, 80);
    const playerIgn = String(body.playerIgn || '').trim().slice(0, 80);
    const serverId = String(body.serverId || 'N/A').trim().slice(0, 80) || 'N/A';
    const rawCustomerName = String(body.customerName || '').trim().slice(0, 100);
    const rawCustomerPhone = String(body.customerPhone || '').trim().slice(0, 30);
    const paymentType = body.paymentType === 'wallet' ? 'wallet' : 'manual';
    const paymentMethodId = paymentType === 'wallet' ? 'wallet' : String(body.paymentMethodId || '').trim().slice(0, 128);
    const rawSenderNumber =
      paymentType === 'wallet' ? 'WALLET' : String(body.senderNumber || '').trim().slice(0, 40);
    const rawTrxId = paymentType === 'wallet' ? '' : String(body.trxId || '').trim().toUpperCase().slice(0, 64);
    const screenshotUrl = String(body.screenshotUrl || '').trim().slice(0, 1000);
    const couponCode = String(body.couponCode || '').trim().toUpperCase().slice(0, 40);
    const confirmDuplicate = Boolean(body.confirmDuplicate);

    if (!productId || !packageId) {
      res.status(400).json({error: 'Missing required product or package ID'});
      return;
    }

    // Check failed TrxID rate limit
    const recentFailures = recordAndCountWindow(failedTrxAttempts, uid, 60 * 60 * 1000, false);
    if (recentFailures >= cfg.fraudMaxFailedTrxPerHour) {
      await writeApiLog(deps.adminDb, {
        type: 'fraud_guard',
        orderNumber: 'BLOCKED',
        endpoint: req.path || '/api/orders',
        status: 'failed',
        message: `Blocked checkout for UID ${uid} due to ${recentFailures} failed payment attempts in 1h.`,
      });
      res.status(429).json({
        error: 'Too many invalid or duplicate TrxID attempts. Please wait before trying again.',
      });
      return;
    }

    if (paymentType === 'manual') {
      if (!paymentMethodId) {
        res.status(400).json({error: 'Select a payment method'});
        return;
      }
      if (rawTrxId.length < 4) {
        res.status(400).json({error: 'Provide a valid TrxID (min 4 chars)'});
        return;
      }
    }

    try {
      const [prodSnap, pmSnap, flashSnap, couponQuery, duplicateOrdersSnap] = await Promise.all([
        deps.adminDb.collection('products').doc(productId).get(),
        paymentType === 'manual' ? deps.adminDb.collection('paymentMethods').doc(paymentMethodId).get() : Promise.resolve(null),
        deps.adminDb.collection('flashSales').where('productId', '==', productId).get(),
        couponCode ? deps.adminDb.collection('coupons').where('code', '==', couponCode).limit(1).get() : Promise.resolve(null),
        deps.adminDb
          .collection('orders')
          .where('customerUid', '==', uid)
          .where('productId', '==', productId)
          .where('packageId', '==', packageId)
          .get(),
      ]);

      if (!prodSnap.exists) {
        res.status(404).json({error: 'Product not found'});
        return;
      }
      const product = prodSnap.data() as {
        id: string;
        name: string;
        images?: string[];
        requiresUid?: boolean;
        requiresServerId?: boolean;
        active?: boolean;
        packages?: Array<{
          id: string;
          name: string;
          quantityLabel: string;
          price: number;
          costPrice?: number;
          active?: boolean;
        }>;
      };
      if (product.active === false) {
        res.status(400).json({error: 'This product is currently unavailable'});
        return;
      }
      if (product.requiresUid !== false) {
        if (!playerUid || playerUid.length < 4) {
          res.status(400).json({error: 'Provide a valid Player UID (at least 4 characters)'});
          return;
        }
        // Strict numeric check if the product explicitly looks like a numeric game UID (Free Fire, MLBB, PUBG, etc.)
        const looksNumericGame = /free\s*fire|pubg|mobile\s*legends|mlbb|ff/i.test(product.name || '');
        if (looksNumericGame && !/^\d{5,15}$/.test(playerUid)) {
          res.status(400).json({
            error: 'Invalid Player UID format: must be 5 to 15 digits (numbers only) for this game.',
          });
          return;
        }
      }

      const selectedPkg = (product.packages || []).find((p) => p.id === packageId && p.active !== false);
      if (!selectedPkg) {
        res.status(404).json({error: 'Selected package is unavailable'});
        return;
      }

      if (paymentType === 'manual' && (!pmSnap || !pmSnap.exists || pmSnap.data()?.active === false)) {
        res.status(400).json({error: 'Selected payment method is inactive or missing'});
        return;
      }

      // Duplicate pending order guard (same customer + product + package + playerUid within 10 minutes)
      if (!confirmDuplicate) {
        const tenMinAgo = Date.now() - 10 * 60 * 1000;
        const recentDup = duplicateOrdersSnap.docs.find((d) => {
          const data = d.data() as Record<string, unknown>;
          if (data.orderStatus !== 'pending' && data.orderStatus !== 'processing') return false;
          if (String(data.playerUid || '') !== (playerUid || 'N/A')) return false;
          const ts = data.createdAt as {toMillis?: () => number} | undefined;
          const createdMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
          return createdMs >= tenMinAgo;
        });
        if (recentDup) {
          res.status(409).json({
            code: 'DUPLICATE_PENDING_ORDER',
            existingOrderNumber: String(recentDup.data().orderNumber || recentDup.id),
            error: `You already placed a similar order (${String(recentDup.data().orderNumber || recentDup.id)}) within the last 10 minutes.`,
          });
          return;
        }
      }

      // Velocity check for Fraud Guard
      const ordersIn10m = recordAndCountWindow(recentCheckoutAttempts, uid, 10 * 60 * 1000, true);
      const fraudReasons: string[] = [];
      if (ordersIn10m > cfg.fraudMaxOrdersPer10Min) {
        fraudReasons.push(`High order burst (${ordersIn10m} orders in 10m)`);
      }
      if (recentFailures >= Math.max(2, Math.floor(cfg.fraudMaxFailedTrxPerHour / 2))) {
        fraudReasons.push(`Multiple recent TrxID failures (${recentFailures})`);
      }

      const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const orderNumber = generateOrderNumber();
      const paymentMethodName =
        paymentType === 'wallet' ? 'Wallet Balance' : String(pmSnap?.data()?.name || 'Mobile Banking');
      const finalTrxId = paymentType === 'wallet' ? `WAL_${orderNumber}` : rawTrxId;
      const trxKey =
        paymentType === 'wallet'
          ? `WAL_${orderNumber}`.replace(/[^a-zA-Z0-9_-]/g, '_')
          : `${paymentMethodId}_${rawTrxId}`.replace(/[^a-zA-Z0-9_-]/g, '_');

      const activeFlashSale = flashSnap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .find((s) => isFlashSaleCurrentlyActive(s, productId));

      const couponDocRef = couponQuery && !couponQuery.empty ? couponQuery.docs[0].ref : null;
      let perUserCouponUses = 0;
      if (couponDocRef) {
        const couponData = couponQuery!.docs[0].data() as Record<string, unknown>;
        if (Number(couponData.perUserLimit || 0) > 0) {
          const usedSnap = await deps.adminDb
            .collection('orders')
            .where('customerUid', '==', uid)
            .where('couponCode', '==', couponCode)
            .get();
          perUserCouponUses = usedSnap.docs.filter(
            (d) => d.data().orderStatus !== 'cancelled' && d.data().orderStatus !== 'expired',
          ).length;
        }
      } else if (couponCode) {
        res.status(400).json({error: `Promo code "${couponCode}" was not found`});
        return;
      }

      // Check if an unused voucher PIN exists for this (productId, packageId) and resolve SMS payment ref (case-insensitive)
      const [unusedPinsSnap, candidateSmsRef] = await Promise.all([
        deps.adminDb
          .collection('voucherStock')
          .where('productId', '==', productId)
          .where('packageId', '==', packageId)
          .where('status', '==', 'unused')
          .limit(6)
          .get(),
        paymentType === 'manual' ? resolveSmsPaymentRef(deps.adminDb, rawTrxId) : Promise.resolve(null),
      ]);
      const candidatePinRef = !unusedPinsSnap.empty ? unusedPinsSnap.docs[0].ref : null;
      const remainingStockAfterClaim = Math.max(0, unusedPinsSnap.size - 1);

      const txResult = await deps.adminDb.runTransaction(async (tx) => {
        const custRef = deps.adminDb!.collection('customers').doc(uid);
        const trxRef = deps.adminDb!.collection('trxRegistry').doc(trxKey);
        const smsRef = candidateSmsRef;

        const [custSnap, trxSnap, smsSnap, couponSnap, pinSnap] = await Promise.all([
          tx.get(custRef),
          tx.get(trxRef),
          smsRef ? tx.get(smsRef) : Promise.resolve(null),
          couponDocRef ? tx.get(couponDocRef) : Promise.resolve(null),
          candidatePinRef ? tx.get(candidatePinRef) : Promise.resolve(null),
        ]);

        if (!custSnap.exists) {
          throw new Error('Customer profile not initialized. Please refresh and try again.');
        }
        const cust = custSnap.data() as Record<string, unknown>;
        if (cust.suspended === true) {
          throw new Error(String(cust.suspendedReason || 'Your account is suspended from placing orders.'));
        }

        if (paymentType === 'manual' && trxSnap.exists) {
          throw new Error('DUPLICATE_TRX_ID');
        }

        const basePrice = Number(selectedPkg.price || 0);
        const flashSaleDiscount = activeFlashSale
          ? Number(((basePrice * Number(activeFlashSale.discountPercent || 0)) / 100).toFixed(2))
          : 0;
        const afterFlash = Math.max(1, Number((basePrice - flashSaleDiscount).toFixed(2)));

        const appliedTier: CustomerTier =
          cust.tier === 'reseller' ? 'reseller' : cust.tier === 'vip' ? 'vip' : 'regular';
        const tierPct =
          appliedTier === 'reseller'
            ? cfg.resellerDiscountPercent
            : appliedTier === 'vip'
              ? cfg.vipDiscountPercent
              : 0;
        const tierDiscount = tierPct > 0 ? Number(((afterFlash * tierPct) / 100).toFixed(2)) : 0;
        const afterTier = Math.max(1, Number((afterFlash - tierDiscount).toFixed(2)));

        let couponDiscount = 0;
        let appliedCouponCode = '';
        if (couponDocRef && couponSnap?.exists) {
          const c = couponSnap.data() as Record<string, unknown>;
          if (c.active !== true) throw new Error('Promo code is inactive');
          if (c.expiresAt && Date.parse(String(c.expiresAt)) > 0 && Date.now() > Date.parse(String(c.expiresAt))) {
            throw new Error('Promo code has expired');
          }
          const usageLimit = Number(c.usageLimit || 0);
          const usedCount = Number(c.usedCount || 0);
          if (usageLimit > 0 && usedCount >= usageLimit) throw new Error('Promo code usage limit reached');
          const perUserLimit = Number(c.perUserLimit || 0);
          if (perUserLimit > 0 && perUserCouponUses >= perUserLimit) {
            throw new Error(`Promo code limit (${perUserLimit} per user) reached`);
          }
          const minAmt = Number(c.minOrderAmount || 0);
          if (minAmt > 0 && afterTier < minAmt) {
            throw new Error(`Minimum order amount of ৳${minAmt} required for coupon ${couponCode}`);
          }
          couponDiscount =
            c.discountType === 'percent'
              ? Number(((afterTier * Number(c.discountValue || 0)) / 100).toFixed(2))
              : Number(c.discountValue || 0);
          const maxDisc = Number(c.maxDiscountAmount || 0);
          if (maxDisc > 0 && couponDiscount > maxDisc) couponDiscount = maxDisc;
          couponDiscount = Math.min(Math.max(0, couponDiscount), Math.max(0, afterTier - 1));
          appliedCouponCode = couponCode;
        }

        const totalAmount = Math.max(1, Number((afterTier - couponDiscount).toFixed(2)));
        const unitCost = Number(selectedPkg.costPrice || 0);
        const netProfit = unitCost > 0 ? Number((totalAmount - unitCost).toFixed(2)) : undefined;

        // Check wallet or SMS verification
        let paymentStatus: 'pending' | 'verified' = 'pending';
        let orderStatus: 'pending' | 'processing' | 'completed' = 'pending';
        let matchedSmsPayment = false;

        if (paymentType === 'wallet') {
          const bal = Number(cust.walletBalance || 0);
          if (bal < totalAmount) {
            throw new Error(`Insufficient wallet balance (Available: ৳${bal}, Required: ৳${totalAmount})`);
          }
          paymentStatus = 'verified';
          orderStatus = 'processing';
        } else if (smsSnap?.exists) {
          const sms = smsSnap.data() as {used?: boolean; amount?: number; method?: string};
          if (sms.used) {
            throw new Error('DUPLICATE_TRX_ID');
          }
          const smsAmt = Number(sms.amount || 0);
          if (smsAmt + 0.01 >= totalAmount) {
            paymentStatus = 'verified';
            orderStatus = 'processing';
            matchedSmsPayment = true;
          } else if (smsAmt > 0) {
            fraudReasons.push(`SMS amount mismatch (Received ৳${smsAmt}, Required ৳${totalAmount})`);
          }
        }

        // Claim Vault PIN automatically ONLY if payment is already verified!
        let claimedVoucherCode = '';
        if (paymentStatus === 'verified' && pinSnap?.exists && pinSnap.data()?.status === 'unused') {
          claimedVoucherCode = String(pinSnap.data()?.code || '').trim();
          if (claimedVoucherCode) {
            orderStatus = 'completed';
          }
        }

        const resolvedCustomerName = (
          rawCustomerName ||
          String(cust.displayName || req.firebaseAuthName || 'Customer')
        )
          .trim()
          .slice(0, 100);
        const resolvedCustomerPhone = (
          rawCustomerPhone.length >= 5
            ? rawCustomerPhone
            : String(cust.phone || '').trim().length >= 5
              ? String(cust.phone).trim()
              : 'Not Required'
        ).slice(0, 30);
        const resolvedSenderNumber =
          paymentType === 'wallet'
            ? 'WALLET'
            : (rawSenderNumber.length >= 3 ? rawSenderNumber : resolvedCustomerPhone).slice(0, 40);

        const fraudFlag = fraudReasons.length > 0;
        const fraudScore = Math.min(100, fraudReasons.length * 40);
        const now = FieldValue.serverTimestamp();

        const notificationMessage = claimedVoucherCode
          ? `Payment verified automatically & voucher code delivered instantly (${claimedVoucherCode}).`
          : paymentStatus === 'verified'
            ? paymentType === 'wallet'
              ? 'Paid via Wallet Balance. Top-up is processing.'
              : 'Payment verified automatically. Processing top-up.'
            : 'Order placed. Awaiting payment verification.';

        // ALL WRITES BELOW
        if (paymentType === 'wallet') {
          const nextBal = Number((Number(cust.walletBalance || 0) - totalAmount).toFixed(2));
          tx.update(custRef, {
            walletBalance: nextBal,
            updatedAt: now,
          });
        } else {
          tx.set(trxRef, {
            trxKey,
            trxId: rawTrxId,
            orderId,
            customerUid: uid,
            paymentMethodId,
            amount: totalAmount,
            status: paymentStatus,
            createdAt: now,
          });
        }

        if (matchedSmsPayment && smsRef) {
          tx.update(smsRef, {
            used: true,
            usedAt: now,
            usedOrderId: orderId,
            usedOrderNumber: orderNumber,
          });
        }

        if (couponDocRef && couponSnap?.exists) {
          tx.update(couponDocRef, {
            usedCount: Number(couponSnap.data()?.usedCount || 0) + 1,
            updatedAt: now,
          });
        }

        if (claimedVoucherCode && candidatePinRef) {
          tx.update(candidatePinRef, {
            status: 'claimed',
            claimedOrderId: orderId,
            claimedOrderNumber: orderNumber,
            claimedAt: now,
          });
        }

        const orderDoc: Record<string, unknown> = {
          id: orderId,
          orderNumber,
          customerUid: uid,
          customerName: resolvedCustomerName,
          customerEmail: String(req.firebaseAuthEmail || cust.email || ''),
          customerPhone: resolvedCustomerPhone,
          productId: product.id,
          productName: product.name,
          productImage: product.images?.[0] || '',
          packageId: selectedPkg.id,
          packageName: selectedPkg.name,
          quantityLabel: selectedPkg.quantityLabel || '',
          unitPrice: basePrice,
          totalAmount,
          ...(appliedCouponCode ? {couponCode: appliedCouponCode} : {}),
          ...(couponDiscount > 0 ? {couponDiscount} : {}),
          ...(tierDiscount > 0 ? {tierDiscount} : {}),
          ...(flashSaleDiscount > 0 ? {flashSaleDiscount} : {}),
          appliedTier,
          ...(unitCost > 0 ? {unitCost} : {}),
          ...(typeof netProfit === 'number' ? {netProfit} : {}),
          loyaltyPointsEarned: 0,
          fraudFlag,
          fraudScore,
          ...(fraudReasons.length > 0 ? {fraudReasons} : {}),
          distributorStatus: 'none',
          playerUid: product.requiresUid === false ? 'N/A' : playerUid,
          ...(playerIgn ? {playerIgn} : {}),
          serverId: product.requiresServerId ? serverId : 'N/A',
          paymentType,
          paymentMethodId,
          paymentMethodName,
          senderNumber: resolvedSenderNumber,
          trxId: finalTrxId,
          trxKey,
          screenshotUrl,
          voucherCode: claimedVoucherCode,
          walletRefunded: false,
          paymentStatus,
          orderStatus,
          adminNote: claimedVoucherCode
            ? 'Auto-delivered from Voucher PIN Vault.'
            : matchedSmsPayment
              ? 'Auto-verified via incoming payment SMS.'
              : '',
          notificationMessage,
          createdAt: now,
          updatedAt: now,
          ...(orderStatus === 'completed' ? {completedAt: now} : {}),
        };

        tx.set(deps.adminDb!.collection('orders').doc(orderId), orderDoc);
        tx.set(deps.adminDb!.collection('orderTracking').doc(orderNumber), {
          orderNumber,
          productName: product.name,
          packageName: selectedPkg.name,
          playerUidMasked: maskPlayerUid(product.requiresUid === false ? 'N/A' : playerUid),
          paymentStatus,
          orderStatus,
          notificationMessage,
          createdAt: now,
          updatedAt: now,
        });

        if (paymentStatus === 'verified') {
          const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
            id: notifId,
            customerUid: uid,
            orderId,
            orderNumber,
            title: claimedVoucherCode
              ? `Voucher Delivered — ${orderNumber}`
              : `Payment Verified — ${orderNumber}`,
            message: notificationMessage,
            read: false,
            createdAt: now,
          });
        }

        return {
          orderId,
          orderNumber,
          productId: product.id,
          productName: product.name,
          packageId: selectedPkg.id,
          packageName: selectedPkg.name,
          playerUid: product.requiresUid === false ? 'N/A' : playerUid,
          serverId: product.requiresServerId ? serverId : 'N/A',
          customerName: resolvedCustomerName,
          customerEmail: String(req.firebaseAuthEmail || cust.email || ''),
          customerPhone: resolvedCustomerPhone,
          paymentMethodName,
          trxId: finalTrxId,
          totalAmount,
          couponDiscount,
          tierDiscount,
          flashSaleDiscount,
          appliedCouponCode,
          appliedTier,
          paymentStatus,
          orderStatus,
          claimedVoucherCode,
          matchedSmsPayment,
          fraudFlag,
          fraudReasons,
        };
      });

      // Deduplicate watcher emails
      deps.markNotificationEventSent(`order:${txResult.orderNumber}`);
      deps.markNotificationEventSent(`cust_order:${txResult.orderNumber}:pending`);
      deps.markNotificationEventSent(`cust_order:${txResult.orderNumber}:${txResult.orderStatus}`);

      if (txResult.claimedVoucherCode) {
        await writeApiLog(deps.adminDb, {
          type: 'pin_vault',
          orderNumber: txResult.orderNumber,
          endpoint: 'voucherStock',
          status: 'success',
          message: `Auto-claimed PIN for ${txResult.packageName}. Approx remaining unused in batch: ${remainingStockAfterClaim}.`,
        });
        if (remainingStockAfterClaim < 5) {
          if (deps.onLowVoucherStock) {
            void deps.onLowVoucherStock({
              productId: txResult.productId,
              productName: txResult.productName,
              packageId: txResult.packageId,
              packageName: txResult.packageName,
              remaining: remainingStockAfterClaim,
            });
          } else {
            void deps.notifyTelegramAdmins(
              `⚠️ Low Voucher PIN Stock Alert!\n📦 ${txResult.productName} · ${txResult.packageName}\n🔑 Remaining unused PINs: ${remainingStockAfterClaim}`,
            );
          }
        }
      }

      if (txResult.fraudFlag) {
        await writeApiLog(deps.adminDb, {
          type: 'fraud_guard',
          orderNumber: txResult.orderNumber,
          endpoint: '/api/orders/create-enhanced',
          status: 'pending',
          message: txResult.fraudReasons.join('; '),
        });
      }

      // If verified and NOT already completed via Vault PIN, try Distributor API
      if (txResult.paymentStatus === 'verified' && txResult.orderStatus !== 'completed') {
        void dispatchDistributorWithLog(deps, {
          orderId: txResult.orderId,
          orderNumber: txResult.orderNumber,
          productId: txResult.productId,
          productName: txResult.productName,
          packageId: txResult.packageId,
          packageName: txResult.packageName,
          playerUid: txResult.playerUid,
          serverId: txResult.serverId,
          amount: txResult.totalAmount,
        });
      }

      // Settle loyalty + tier + referral bonus & push if already completed via Vault PIN
      if (txResult.orderStatus === 'completed') {
        void settleOrderCompletionEffects(deps, txResult.orderId);
        if (deps.onOrderCompletedPush && uid) {
          void deps.onOrderCompletedPush({
            customerUid: uid,
            orderNumber: txResult.orderNumber,
            productName: txResult.productName,
            packageName: txResult.packageName,
            voucherCode: txResult.claimedVoucherCode || undefined,
          });
        }
      }

      // Trigger Admin Email + Customer Email + Telegram Admin Alert
      const amountText = `৳${txResult.totalAmount}`;
      void deps.sendAdminNotificationEmail(
        `${txResult.fraudFlag ? '[⚠️ FRAUD CHECK] ' : ''}New Order ${txResult.orderNumber} — ${txResult.productName}`,
        [
          {label: 'Order Number', value: txResult.orderNumber},
          {label: 'Product', value: txResult.productName},
          {label: 'Package', value: txResult.packageName},
          {label: 'Amount', value: amountText},
          ...(txResult.appliedCouponCode ? [{label: 'Coupon', value: `${txResult.appliedCouponCode} (-৳${txResult.couponDiscount})`}] : []),
          ...(txResult.tierDiscount > 0 ? [{label: 'Tier Discount', value: `${txResult.appliedTier.toUpperCase()} (-৳${txResult.tierDiscount})`}] : []),
          {label: 'Player UID', value: txResult.playerUid},
          {label: 'Server ID', value: txResult.serverId},
          {label: 'Payment Method', value: txResult.paymentMethodName},
          {label: 'TrxID', value: txResult.trxId},
          {label: 'Customer', value: `${txResult.customerName} (${txResult.customerEmail})`},
          {label: 'Phone', value: txResult.customerPhone},
          ...(txResult.fraudFlag ? [{label: 'Fraud Warning', value: txResult.fraudReasons.join(' | ')}] : []),
        ],
        txResult.customerEmail || 'customer',
      );

      if (txResult.customerEmail) {
        void deps.sendCustomerOrderEmail({
          toEmail: txResult.customerEmail,
          customerName: txResult.customerName,
          orderNumber: txResult.orderNumber,
          orderStatus: txResult.orderStatus,
          paymentStatus: txResult.paymentStatus,
          productName: txResult.productName,
          packageName: txResult.packageName,
          playerUid: txResult.playerUid,
          serverId: txResult.serverId,
          totalAmount: txResult.totalAmount,
          paymentMethodName: txResult.paymentMethodName,
          trxId: txResult.trxId,
          voucherCode: txResult.claimedVoucherCode || undefined,
          note: txResult.claimedVoucherCode
            ? 'Payment verified automatically and your voucher code is ready above!'
            : txResult.matchedSmsPayment
              ? 'Payment verified automatically. Processing top-up.'
              : txResult.paymentStatus === 'verified'
                ? 'Payment verified! Your top-up is queued for delivery.'
                : 'Order received. Pending verification.',
          isNewOrder: txResult.orderStatus !== 'completed',
        });
      }

      const tgAlertLines = [
        `${txResult.fraudFlag ? '⚠️ [FRAUD FLAG] ' : ''}🛒 New Order: ${txResult.orderNumber}`,
        `🎮 ${txResult.productName} · ${txResult.packageName}`,
        `🆔 UID: ${txResult.playerUid} | 💰 ৳${txResult.totalAmount}`,
        `💳 ${txResult.paymentMethodName} | TrxID: ${txResult.trxId}`,
        `👤 ${txResult.customerName} (${txResult.customerEmail})`,
        ...(txResult.matchedSmsPayment ? [`✅ Payment auto-verified via SMS`] : []),
        ...(txResult.claimedVoucherCode ? [`🔑 Instant PIN delivered from Vault`] : []),
        ...(txResult.fraudFlag ? [`🚨 Flag: ${txResult.fraudReasons.join(', ')}`] : []),
      ].join('\n');

      void deps.notifyTelegramAdmins(tgAlertLines, {
        inline_keyboard: [
          [{text: `🔎 Inspect ${txResult.orderNumber}`, callback_data: deps.makeAdminOrderCallback(txResult.orderId)}],
        ],
      });

      res.status(201).json({
        ok: true,
        orderId: txResult.orderId,
        orderNumber: txResult.orderNumber,
        totalAmount: txResult.totalAmount,
        paymentStatus: txResult.paymentStatus,
        orderStatus: txResult.orderStatus,
        autoVerified: txResult.matchedSmsPayment,
        voucherCode: txResult.claimedVoucherCode,
        couponDiscount: txResult.couponDiscount,
        tierDiscount: txResult.tierDiscount,
        flashSaleDiscount: txResult.flashSaleDiscount,
        fraudFlag: txResult.fraudFlag,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      if (msg === 'DUPLICATE_TRX_ID') {
        recordAndCountWindow(failedTrxAttempts, uid, 60 * 60 * 1000, true);
        await writeApiLog(deps.adminDb, {
          type: 'fraud_guard',
          orderNumber: 'DUP_TRX',
          endpoint: req.path || '/api/orders',
          status: 'failed',
          message: `Duplicate TrxID attempt by UID ${uid}: ${rawTrxId}`,
        });
        res.status(409).json({
          error: 'This Transaction ID (TrxID) has already been used. Please double check your payment.',
        });
        return;
      }
      res.status(400).json({error: msg});
    }
  };

  app.post('/api/orders', deps.requireSignedInFirebase, handleCreateOrder);
  app.post('/api/orders/create-enhanced', deps.requireSignedInFirebase, handleCreateOrder);

  // Add Money (Wallet Deposit) with Instant SMS Auto-Approval against sms_payments
  app.post('/api/wallet-topups/create', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    const uid = String(req.firebaseAuthUid || '').trim();
    if (!uid || !deps.adminDb) {
      res.status(401).json({error: 'Customer authentication required'});
      return;
    }

    const body = (req.body || {}) as {
      amount?: number | string;
      paymentMethodId?: string;
      trxId?: string;
      senderNumber?: string;
      screenshotUrl?: string;
    };

    const numAmount = Number(body.amount);
    const paymentMethodId = String(body.paymentMethodId || '').trim().slice(0, 128);
    const rawTrxId = String(body.trxId || '').trim().toUpperCase().slice(0, 64);
    const rawSender = String(body.senderNumber || '').trim().slice(0, 40);
    const screenshotUrl = String(body.screenshotUrl || '').trim().slice(0, 1000);

    if (!Number.isFinite(numAmount) || numAmount < 10 || numAmount > 500000) {
      res.status(400).json({error: 'Enter a valid amount between ৳10 and ৳500,000.'});
      return;
    }
    if (!paymentMethodId) {
      res.status(400).json({error: 'Select a payment gateway.'});
      return;
    }
    if (rawTrxId.length < 4 || rawTrxId.length > 64) {
      res.status(400).json({error: 'Enter a valid Transaction ID (TrxID) between 4 and 64 characters.'});
      return;
    }

    const recentFailures = recordAndCountWindow(failedTrxAttempts, uid, 60 * 60 * 1000, false);
    const cfg = normalizeCommerceSettings(deps.readStore().systemSettings?.commerce);
    if (recentFailures >= cfg.fraudMaxFailedTrxPerHour) {
      res.status(429).json({
        error: 'Too many invalid or duplicate TrxID attempts. Please wait before trying again.',
      });
      return;
    }

    try {
      const pmSnap = await deps.adminDb.collection('paymentMethods').doc(paymentMethodId).get();
      if (!pmSnap.exists || pmSnap.data()?.active === false) {
        res.status(400).json({error: 'Selected payment gateway is inactive or unavailable.'});
        return;
      }
      const pmName = String(pmSnap.data()?.name || 'Mobile Banking').slice(0, 60);
      const trxKey = `${paymentMethodId}_${rawTrxId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (trxKey.length < 4) {
        res.status(400).json({error: 'Enter a valid Transaction ID (TrxID).'});
        return;
      }

      const topupId = `top_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const smsCandidateRef = await resolveSmsPaymentRef(deps.adminDb, rawTrxId);

      const txResult = await deps.adminDb.runTransaction(async (tx) => {
        const custRef = deps.adminDb!.collection('customers').doc(uid);
        const trxRef = deps.adminDb!.collection('trxRegistry').doc(trxKey);
        const topupRef = deps.adminDb!.collection('walletTopups').doc(topupId);

        const [custSnap, trxSnap, smsSnap] = await Promise.all([
          tx.get(custRef),
          tx.get(trxRef),
          tx.get(smsCandidateRef),
        ]);

        if (!custSnap.exists) {
          throw new Error('Customer profile not initialized. Please refresh and try again.');
        }
        const cust = custSnap.data() as Record<string, unknown>;
        if (cust.suspended === true) {
          throw new Error(String(cust.suspendedReason || 'Suspended accounts cannot submit wallet deposits.'));
        }
        if (trxSnap.exists) {
          throw new Error('DUPLICATE_TRX_ID');
        }

        let autoApproved = false;
        let matchedSmsMethod = '';
        let matchedSmsAmount = 0;
        if (smsSnap.exists) {
          const sms = smsSnap.data() as {used?: boolean; amount?: number; method?: string};
          if (sms.used) {
            throw new Error('DUPLICATE_TRX_ID');
          }
          const smsAmt = Number(sms.amount || 0);
          if (smsAmt + 0.01 >= numAmount) {
            autoApproved = true;
            matchedSmsMethod = String(sms.method || pmName);
            matchedSmsAmount = smsAmt;
          }
        }

        const now = FieldValue.serverTimestamp();
        const customerName = String(cust.displayName || req.firebaseAuthName || 'Customer')
          .trim()
          .slice(0, 100);
        const customerEmail = String(req.firebaseAuthEmail || cust.email || '')
          .trim()
          .slice(0, 160);
        const senderNumber = (
          rawSender.length >= 5
            ? rawSender
            : String(cust.phone || '').trim().length >= 5
              ? String(cust.phone).trim()
              : 'Not Required'
        ).slice(0, 40);

        const topupStatus: 'pending' | 'approved' = autoApproved ? 'approved' : 'pending';
        const prevBalance = Number(cust.walletBalance || 0);
        const newWalletBalance = autoApproved
          ? Number((prevBalance + numAmount).toFixed(2))
          : prevBalance;

        tx.set(trxRef, {
          trxKey,
          trxId: rawTrxId,
          orderId: topupId,
          customerUid: uid,
          paymentMethodId,
          amount: numAmount,
          status: autoApproved ? 'verified' : 'pending',
          createdAt: now,
        });

        tx.set(topupRef, {
          id: topupId,
          customerUid: uid,
          customerName,
          customerEmail,
          amount: numAmount,
          paymentMethodId,
          paymentMethodName: pmName,
          senderNumber,
          trxId: rawTrxId,
          trxKey,
          screenshotUrl,
          status: topupStatus,
          adminNote: autoApproved
            ? `Auto-approved via ${matchedSmsMethod} SMS (৳${matchedSmsAmount}).`
            : '',
          createdAt: now,
          updatedAt: now,
        });

        if (autoApproved) {
          tx.update(smsCandidateRef, {
            used: true,
            usedAt: now,
            usedOrderId: topupId,
            usedOrderNumber: topupId,
            usedType: 'wallet_topup',
          });
          tx.update(custRef, {
            walletBalance: newWalletBalance,
            updatedAt: now,
          });
          const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
            id: notifId,
            customerUid: uid,
            orderId: topupId,
            orderNumber: topupId,
            title: `Wallet Deposit Approved — ৳${numAmount}`,
            message: `Your Add Money deposit of ৳${numAmount} (${rawTrxId}) was verified automatically and credited to your wallet.`,
            read: false,
            createdAt: now,
          });
        }

        return {
          topupId,
          status: topupStatus,
          autoApproved,
          amount: numAmount,
          newWalletBalance,
          customerName,
          customerEmail,
          pmName,
          trxId: rawTrxId,
        };
      });

      deps.markNotificationEventSent(`deposit:${txResult.trxId}`);

      const timeStr = new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'});
      void deps.sendAdminNotificationEmail(
        txResult.autoApproved
          ? `Wallet Deposit Auto-Approved (৳${txResult.amount})`
          : `New Wallet Deposit Request (৳${txResult.amount})`,
        [
          {label: 'Deposit ID', value: txResult.topupId},
          {label: 'Deposit Amount', value: `৳${txResult.amount}`},
          {label: 'Payment Method', value: txResult.pmName},
          {label: 'TrxID', value: txResult.trxId},
          {label: 'Status', value: txResult.autoApproved ? 'APPROVED (Auto-Verified via SMS)' : 'PENDING REVIEW'},
          {label: 'Customer Name', value: txResult.customerName},
          {label: 'Customer Email', value: txResult.customerEmail || '—'},
          {label: 'Time (BD)', value: timeStr},
        ],
        txResult.customerEmail || 'customer',
      );

      if (txResult.autoApproved && txResult.customerEmail) {
        void deps.sendCustomerGenericEmail({
          toEmail: txResult.customerEmail,
          customerName: txResult.customerName,
          subject: `Wallet Deposit Approved — ৳${txResult.amount}`,
          headline: 'Your Wallet Deposit Has Been Credited Automatically!',
          message: `We verified your ${txResult.pmName} payment automatically and added ৳${txResult.amount} to your wallet balance.`,
          rows: [
            {label: 'Deposit ID', value: txResult.topupId},
            {label: 'Amount Credited', value: `৳${txResult.amount}`},
            {label: 'Payment Method', value: txResult.pmName},
            {label: 'TrxID', value: txResult.trxId},
            {label: 'New Wallet Balance', value: `৳${txResult.newWalletBalance}`},
          ],
        });
      }

      const tgAlertText = [
        txResult.autoApproved
          ? `✅ Wallet Deposit Auto-Approved: ৳${txResult.amount}`
          : `💰 New Wallet Deposit Request: ৳${txResult.amount}`,
        `💳 ${txResult.pmName} | TrxID: ${txResult.trxId}`,
        `👤 ${txResult.customerName} (${txResult.customerEmail || uid})`,
        ...(txResult.autoApproved ? [`💵 New Wallet Balance: ৳${txResult.newWalletBalance}`] : []),
      ].join('\n');
      void deps.notifyTelegramAdmins(tgAlertText, {
        inline_keyboard: [[{text: '🛡️ Open Admin Panel', callback_data: 'adm:home'}]],
      });

      res.status(201).json({
        ok: true,
        ...txResult,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to submit wallet deposit';
      if (msg === 'DUPLICATE_TRX_ID') {
        recordAndCountWindow(failedTrxAttempts, uid, 60 * 60 * 1000, true);
        res.status(409).json({
          error: 'This Transaction ID (TrxID) has already been submitted or used.',
        });
        return;
      }
      res.status(400).json({error: msg});
    }
  });

  // Admin: Claim Vault PIN & Complete Order
  app.post('/api/admin/orders/:orderId/fulfill-pin', deps.requireAdmin('orders'), async (req: any, res: Response) => {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId || !deps.adminDb) {
      res.status(400).json({error: 'Invalid order ID'});
      return;
    }

    try {
      const orderSnap = await deps.adminDb.collection('orders').doc(orderId).get();
      if (!orderSnap.exists) {
        res.status(404).json({error: 'Order not found'});
        return;
      }
      const orderData = orderSnap.data() as Record<string, unknown>;
      if (orderData.voucherCode) {
        res.status(409).json({error: 'This order already has a voucher code assigned'});
        return;
      }

      const pinsSnap = await deps.adminDb
        .collection('voucherStock')
        .where('productId', '==', String(orderData.productId || ''))
        .where('packageId', '==', String(orderData.packageId || ''))
        .where('status', '==', 'unused')
        .limit(6)
        .get();

      if (pinsSnap.empty) {
        res.status(404).json({error: 'No unused PINs available in Vault for this package'});
        return;
      }

      const pinRef = pinsSnap.docs[0].ref;
      const remaining = Math.max(0, pinsSnap.size - 1);

      const claimed = await deps.adminDb.runTransaction(async (tx) => {
        const oRef = deps.adminDb!.collection('orders').doc(orderId);
        const [oSnap, pSnap] = await Promise.all([tx.get(oRef), tx.get(pinRef)]);
        if (!oSnap.exists || !pSnap.exists) throw new Error('Order or PIN no longer exists');
        const pData = pSnap.data() as {status?: string; code?: string};
        if (pData.status !== 'unused' || !pData.code) throw new Error('Selected PIN was just claimed; retry');

        const o = oSnap.data() as Record<string, unknown>;
        const orderNumber = String(o.orderNumber || orderId);
        const code = String(pData.code).trim();
        const now = FieldValue.serverTimestamp();
        const msg = `Payment verified & voucher code delivered from Vault: ${code}`;

        tx.update(pRefFallback(pinRef), {
          status: 'claimed',
          claimedOrderId: orderId,
          claimedOrderNumber: orderNumber,
          claimedAt: now,
        });
        tx.update(oRef, {
          paymentStatus: 'verified',
          orderStatus: 'completed',
          voucherCode: code,
          notificationMessage: msg.slice(0, 500),
          adminNote: String(o.adminNote || '').trim() || `Delivered Vault PIN by ${req.adminSession?.email || 'admin'}`,
          completedAt: now,
          updatedAt: now,
        });
        if (orderNumber) {
          tx.update(deps.adminDb!.collection('orderTracking').doc(orderNumber), {
            paymentStatus: 'verified',
            orderStatus: 'completed',
            notificationMessage: msg.slice(0, 500),
            updatedAt: now,
          });
        }
        const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        if (o.customerUid) {
          tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
            id: notifId,
            customerUid: String(o.customerUid),
            orderId,
            orderNumber,
            title: `Code Delivered — ${orderNumber}`,
            message: msg.slice(0, 500),
            read: false,
            createdAt: now,
          });
        }

        return {
          code,
          orderNumber,
          customerUid: String(o.customerUid || ''),
          customerEmail: String(o.customerEmail || ''),
          customerName: String(o.customerName || ''),
          productName: String(o.productName || ''),
          packageName: String(o.packageName || ''),
          playerUid: String(o.playerUid || ''),
          serverId: String(o.serverId || ''),
          totalAmount: Number(o.totalAmount || 0),
          paymentMethodName: String(o.paymentMethodName || ''),
          trxId: String(o.trxId || ''),
        };
      });

      await settleOrderCompletionEffects(deps, orderId);
      await writeApiLog(deps.adminDb, {
        type: 'pin_vault',
        orderNumber: claimed.orderNumber,
        endpoint: 'voucherStock',
        status: 'success',
        message: `Admin ${req.adminSession?.email} claimed Vault PIN. Approx remaining: ${remaining}.`,
      });
      if (remaining < 5) {
        if (deps.onLowVoucherStock) {
          void deps.onLowVoucherStock({
            productId: String(orderData.productId || ''),
            productName: claimed.productName,
            packageId: String(orderData.packageId || ''),
            packageName: claimed.packageName,
            remaining,
          });
        } else {
          void deps.notifyTelegramAdmins(
            `⚠️ Low Voucher PIN Stock!\n📦 ${claimed.productName} · ${claimed.packageName}\n🔑 Remaining unused PINs: ${remaining}`,
          );
        }
      }
      if (deps.onOrderCompletedPush && claimed.customerUid) {
        void deps.onOrderCompletedPush({
          customerUid: claimed.customerUid,
          orderNumber: claimed.orderNumber,
          productName: claimed.productName,
          packageName: claimed.packageName,
          voucherCode: claimed.code,
        });
      }
      if (claimed.customerEmail) {
        void deps.sendCustomerOrderEmail({
          toEmail: claimed.customerEmail,
          customerName: claimed.customerName,
          orderNumber: claimed.orderNumber,
          orderStatus: 'completed',
          paymentStatus: 'verified',
          productName: claimed.productName,
          packageName: claimed.packageName,
          playerUid: claimed.playerUid,
          serverId: claimed.serverId,
          totalAmount: claimed.totalAmount,
          paymentMethodName: claimed.paymentMethodName,
          trxId: claimed.trxId,
          voucherCode: claimed.code,
        });
      }
      if (claimed.customerUid.startsWith('tg_')) {
        void deps.sendTelegramOrderStatusUpdate({
          orderNumber: claimed.orderNumber,
          orderStatus: 'completed',
          paymentStatus: 'verified',
          productName: claimed.productName,
          packageName: claimed.packageName,
          playerUid: claimed.playerUid,
          totalAmount: claimed.totalAmount,
          paymentMethodName: claimed.paymentMethodName,
          trxId: claimed.trxId,
          voucherCode: claimed.code,
          customerUid: claimed.customerUid,
        });
      }

      res.json({ok: true, voucherCode: claimed.code, remainingStock: remaining});
    } catch (err) {
      res.status(400).json({error: err instanceof Error ? err.message : 'Failed to deliver PIN'});
    }
  });

  // Admin: Trigger Completion Effects (Loyalty, Tier, 1st-order Referral Bonus)
  app.post('/api/admin/orders/:orderId/complete-effects', deps.requireAdmin(), async (req: any, res: Response) => {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) {
      res.status(400).json({error: 'Missing orderId'});
      return;
    }
    const result = await settleOrderCompletionEffects(deps, orderId);
    res.json({ok: true, ...result});
  });

  // Admin: Dispatch / Retry Distributor API
  app.post('/api/admin/orders/:orderId/distributor-dispatch', deps.requireAdmin('orders'), async (req: any, res: Response) => {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId || !deps.adminDb) {
      res.status(400).json({error: 'Order ID missing or database unavailable'});
      return;
    }
    try {
      const snap = await deps.adminDb.collection('orders').doc(orderId).get();
      if (!snap.exists) {
        res.status(404).json({error: 'Order not found'});
        return;
      }
      const o = snap.data() as Record<string, unknown>;
      const result = await dispatchDistributorWithLog(deps, {
        orderId,
        orderNumber: String(o.orderNumber || orderId),
        productId: String(o.productId || ''),
        productName: String(o.productName || ''),
        packageId: String(o.packageId || ''),
        packageName: String(o.packageName || ''),
        playerUid: String(o.playerUid || ''),
        serverId: String(o.serverId || ''),
        amount: Number(o.totalAmount || 0),
      });
      if (!result.dispatched) {
        res.status(result.status === 'none' ? 400 : 502).json({ok: false, error: result.statusText, ...result});
        return;
      }
      res.json({ok: true, ...result});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Distributor dispatch error'});
    }
  });

  // Admin: Test Distributor API Connection
  app.post('/api/admin/distributor/test', deps.requireAdmin('settings'), async (req: any, res: Response) => {
    const store = deps.readStore();
    const s = store.systemSettings || {};
    const baseUrl = String(req.body?.distributorBaseUrl || s.distributorBaseUrl || '').trim().replace(/\/$/, '');
    const apiKey = String(req.body?.distributorApiKey || s.distributorApiKey || '').trim();
    const merchantId = String(req.body?.distributorMerchantId || s.distributorMerchantId || '').trim();
    if (!baseUrl || !apiKey) {
      res.status(400).json({error: 'Distributor Base URL and API Key are required before testing'});
      return;
    }
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        res.status(400).json({error: 'Invalid URL protocol'});
        return;
      }
      const endpoint = `${parsed.toString().replace(/\/$/, '')}/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const pingRes = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Merchant-Id': merchantId,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const preview = await pingRes.text().catch(() => '');
      await writeApiLog(deps.adminDb, {
        type: 'distributor',
        orderNumber: 'TEST_PING',
        endpoint,
        status: pingRes.ok ? 'success' : 'failed',
        httpStatus: pingRes.status,
        message: `Manual connection test -> HTTP ${pingRes.status}`,
        responsePreview: preview.slice(0, 400),
      });
      res.json({ok: pingRes.ok, httpStatus: pingRes.status, preview: preview.slice(0, 240)});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await writeApiLog(deps.adminDb, {
        type: 'distributor',
        orderNumber: 'TEST_PING',
        endpoint: baseUrl,
        status: 'failed',
        message: `Manual connection test failed: ${msg}`,
      });
      res.status(502).json({ok: false, error: msg});
    }
  });

  // Admin: API Logs Viewer
  app.get('/api/admin/api-logs', deps.requireAdmin('settings'), async (_req, res) => {
    if (!deps.adminDb) {
      res.json({logs: []});
      return;
    }
    try {
      const snap = await deps.adminDb.collection('apiLogs').orderBy('createdAt', 'desc').limit(50).get();
      const logs = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.createdAt as {toDate?: () => Date} | undefined;
        return {
          ...data,
          createdAtIso: ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : '',
        };
      });
      res.json({logs});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load API logs'});
    }
  });

  // Admin: Voucher Vault Bulk Upload / Summary / Delete
  app.get('/api/admin/voucher-stock', deps.requireAdmin('products'), async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.json({items: []});
      return;
    }
    try {
      const limit = Math.min(250, Math.max(20, Number(req.query.limit || 150)));
      const snap = await deps.adminDb.collection('voucherStock').orderBy('createdAt', 'desc').limit(limit).get();
      const items = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const rawCode = String(data.code || '');
        const maskedCode =
          rawCode.length > 6 ? `${rawCode.slice(0, 3)}••••${rawCode.slice(-3)}` : '••••••';
        const ts = data.createdAt as {toDate?: () => Date} | undefined;
        return {
          id: d.id,
          productId: data.productId,
          productName: data.productName,
          packageId: data.packageId,
          packageName: data.packageName,
          maskedCode,
          status: data.status,
          claimedOrderNumber: data.claimedOrderNumber || '',
          createdAtIso: ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : '',
        };
      });
      res.json({items});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to fetch voucher stock'});
    }
  });

  app.post('/api/admin/voucher-stock/bulk', deps.requireAdmin('products'), async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    const {productId, productName, packageId, packageName, codesText} = (req.body || {}) as {
      productId?: string;
      productName?: string;
      packageId?: string;
      packageName?: string;
      codesText?: string;
    };
    if (!productId || !packageId || !codesText) {
      res.status(400).json({error: 'Product, package, and PIN codes are required'});
      return;
    }
    const lines = Array.from(
      new Set(
        codesText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length >= 3 && l.length <= 240),
      ),
    ).slice(0, 200);
    if (lines.length === 0) {
      res.status(400).json({error: 'No valid PIN codes found (minimum 3 characters per line)'});
      return;
    }
    try {
      const batch = deps.adminDb.batch();
      const now = FieldValue.serverTimestamp();
      for (const code of lines) {
        const id = `pin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        batch.set(deps.adminDb.collection('voucherStock').doc(id), {
          id,
          productId: String(productId).slice(0, 128),
          productName: String(productName || '').slice(0, 120),
          packageId: String(packageId).slice(0, 128),
          packageName: String(packageName || '').slice(0, 120),
          code,
          status: 'unused',
          createdAt: now,
        });
      }
      await batch.commit();
      res.status(201).json({ok: true, addedCount: lines.length});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to import PIN codes'});
    }
  });

  app.delete('/api/admin/voucher-stock/:stockId', deps.requireAdmin('products'), async (req: any, res: Response) => {
    const stockId = String(req.params.stockId || '').trim();
    if (!stockId || !deps.adminDb) {
      res.status(400).json({error: 'Invalid stock ID'});
      return;
    }
    try {
      await deps.adminDb.collection('voucherStock').doc(stockId).delete();
      res.json({ok: true});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to remove PIN item'});
    }
  });

  // Merchant Payment Gateway Session & Verified Webhook (UddoktaPay / SSLCommerz / bKash Merchant / Nagad Merchant)
  const completeOrderViaGateway = async (params: {
    orderNumber: string;
    provider: string;
    gatewayTrxId: string;
    paidAmount: number;
  }) => {
    if (!deps.adminDb) return false;
    const snap = await deps.adminDb
      .collection('orders')
      .where('orderNumber', '==', params.orderNumber)
      .limit(1)
      .get();
    if (snap.empty) return false;
    const orderDoc = snap.docs[0];
    const preData = orderDoc.data() as Record<string, unknown>;
    if (preData.paymentStatus === 'verified') return true;

    const productId = String(preData.productId || '');
    const packageId = String(preData.packageId || '');
    const unusedPinsSnap =
      productId && packageId
        ? await deps.adminDb
            .collection('voucherStock')
            .where('productId', '==', productId)
            .where('packageId', '==', packageId)
            .where('status', '==', 'unused')
            .limit(6)
            .get()
        : null;
    const candidatePinRef = unusedPinsSnap && !unusedPinsSnap.empty ? unusedPinsSnap.docs[0].ref : null;
    const remainingAfterClaim = unusedPinsSnap ? Math.max(0, unusedPinsSnap.size - 1) : 0;

    const outcome = await deps.adminDb.runTransaction(async (tx) => {
      const freshSnap = await tx.get(orderDoc.ref);
      if (!freshSnap.exists) return null;
      const o = freshSnap.data() as Record<string, unknown>;
      if (o.paymentStatus === 'verified') return null;

      const pinSnap = candidatePinRef ? await tx.get(candidatePinRef) : null;
      let claimedVoucherCode = '';
      if (pinSnap?.exists && pinSnap.data()?.status === 'unused') {
        claimedVoucherCode = String(pinSnap.data()?.code || '').trim();
      }
      const nextStatus: 'processing' | 'completed' = claimedVoucherCode ? 'completed' : 'processing';
      const now = FieldValue.serverTimestamp();
      const msg = claimedVoucherCode
        ? `Instant payment verified via ${params.provider} & voucher code delivered (${claimedVoucherCode}).`
        : `Instant payment verified via ${params.provider}. Processing top-up.`;

      tx.update(orderDoc.ref, {
        paymentStatus: 'verified',
        orderStatus: nextStatus,
        ...(claimedVoucherCode ? {voucherCode: claimedVoucherCode} : {}),
        ...(params.gatewayTrxId ? {trxId: params.gatewayTrxId} : {}),
        adminNote: `Verified by ${params.provider} gateway webhook (${params.gatewayTrxId || 'PGW'})`,
        notificationMessage: msg,
        updatedAt: now,
        ...(nextStatus === 'completed' ? {completedAt: now} : {}),
      });

      if (claimedVoucherCode && candidatePinRef) {
        tx.update(candidatePinRef, {
          status: 'claimed',
          claimedOrderId: freshSnap.id,
          claimedOrderNumber: params.orderNumber,
          claimedAt: now,
        });
      }

      const trackingRef = deps.adminDb!.collection('orderTracking').doc(params.orderNumber);
      tx.set(
        trackingRef,
        {
          orderNumber: params.orderNumber,
          paymentStatus: 'verified',
          orderStatus: nextStatus,
          notificationMessage: msg,
          updatedAt: now,
        },
        {merge: true},
      );

      const customerUid = String(o.customerUid || '');
      if (customerUid) {
        const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
          id: notifId,
          customerUid,
          orderId: freshSnap.id,
          orderNumber: params.orderNumber,
          title: claimedVoucherCode
            ? `Order Completed — ${params.orderNumber}`
            : `Instant Payment Verified — ${params.orderNumber}`,
          message: msg,
          read: false,
          createdAt: now,
        });
      }

      return {
        orderId: freshSnap.id,
        customerUid,
        customerName: String(o.customerName || 'Customer'),
        customerEmail: String(o.customerEmail || ''),
        productId,
        productName: String(o.productName || 'Top-up'),
        packageId,
        packageName: String(o.packageName || 'Package'),
        playerUid: String(o.playerUid || 'N/A'),
        serverId: String(o.serverId || 'N/A'),
        totalAmount: Number(o.totalAmount || params.paidAmount || 0),
        nextStatus,
        claimedVoucherCode,
        msg,
      };
    });

    if (!outcome) return false;

    if (outcome.claimedVoucherCode && remainingAfterClaim < 5 && deps.onLowVoucherStock) {
      void deps.onLowVoucherStock({
        productId: outcome.productId,
        productName: outcome.productName,
        packageId: outcome.packageId,
        packageName: outcome.packageName,
        remaining: remainingAfterClaim,
      });
    }

    if (outcome.nextStatus === 'completed') {
      void settleOrderCompletionEffects(deps, outcome.orderId);
      if (deps.onOrderCompletedPush && outcome.customerUid) {
        void deps.onOrderCompletedPush({
          customerUid: outcome.customerUid,
          orderNumber: params.orderNumber,
          productName: outcome.productName,
          packageName: outcome.packageName,
          voucherCode: outcome.claimedVoucherCode || undefined,
        });
      }
    } else {
      void dispatchDistributorWithLog(deps, {
        orderId: outcome.orderId,
        orderNumber: params.orderNumber,
        productId: outcome.productId,
        productName: outcome.productName,
        packageId: outcome.packageId,
        packageName: outcome.packageName,
        playerUid: outcome.playerUid,
        serverId: outcome.serverId,
        amount: outcome.totalAmount,
      });
    }

    if (outcome.customerEmail) {
      void deps.sendCustomerOrderEmail({
        toEmail: outcome.customerEmail,
        customerName: outcome.customerName,
        orderNumber: params.orderNumber,
        orderStatus: outcome.nextStatus,
        paymentStatus: 'verified',
        productName: outcome.productName,
        packageName: outcome.packageName,
        playerUid: outcome.playerUid,
        serverId: outcome.serverId,
        totalAmount: outcome.totalAmount,
        paymentMethodName: params.provider.toUpperCase(),
        trxId: params.gatewayTrxId || params.orderNumber,
        voucherCode: outcome.claimedVoucherCode || undefined,
        note: outcome.msg,
      });
    }

    void deps.notifyTelegramAdmins(
      [
        `⚡ Gateway Payment Verified (${params.provider.toUpperCase()})!`,
        `🧾 Order: ${params.orderNumber} (${outcome.nextStatus.toUpperCase()})`,
        `🎮 ${outcome.productName} · ${outcome.packageName}`,
        `💰 ৳${outcome.totalAmount} | 🔑 ${params.gatewayTrxId || 'PGW'}`,
      ].join('\n'),
      {
        inline_keyboard: [
          [{text: `🔎 Inspect ${params.orderNumber}`, callback_data: deps.makeAdminOrderCallback(outcome.orderId)}],
        ],
      },
    );
    return true;
  };

  const completeWalletTopupViaGateway = async (params: {
    topupId: string;
    provider: string;
    gatewayTrxId: string;
  }) => {
    if (!deps.adminDb) return false;
    const topupRef = deps.adminDb.collection('walletTopups').doc(params.topupId);
    const outcome = await deps.adminDb.runTransaction(async (tx) => {
      const topupSnap = await tx.get(topupRef);
      if (!topupSnap.exists) return null;
      const t = topupSnap.data() as Record<string, unknown>;
      if (t.status === 'approved') return null;

      const customerUid = String(t.customerUid || '').trim();
      if (!customerUid) return null;
      const custRef = deps.adminDb!.collection('customers').doc(customerUid);
      const custSnap = await tx.get(custRef);
      if (!custSnap.exists) return null;

      const amount = Number(t.amount || 0);
      const nextWalletBalance = Number((Number(custSnap.data()?.walletBalance || 0) + amount).toFixed(2));
      const now = FieldValue.serverTimestamp();

      tx.update(topupRef, {
        status: 'approved',
        ...(params.gatewayTrxId ? {trxId: params.gatewayTrxId} : {}),
        adminNote: `Auto-approved via ${params.provider} gateway webhook (${params.gatewayTrxId || 'PGW'}).`,
        updatedAt: now,
      });
      tx.update(custRef, {walletBalance: nextWalletBalance, updatedAt: now});

      const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
        id: notifId,
        customerUid,
        orderId: params.topupId,
        orderNumber: params.topupId,
        title: `Wallet Deposit Credited — ৳${amount}`,
        message: `Your instant ${params.provider} deposit of ৳${amount} has been credited to your wallet.`,
        read: false,
        createdAt: now,
      });

      return {
        customerUid,
        customerName: String(t.customerName || 'Customer'),
        customerEmail: String(t.customerEmail || ''),
        amount,
        nextWalletBalance,
      };
    });

    if (!outcome) return false;
    if (outcome.customerEmail) {
      void deps.sendCustomerGenericEmail({
        toEmail: outcome.customerEmail,
        customerName: outcome.customerName,
        subject: `Instant Wallet Deposit Credited — ৳${outcome.amount}`,
        headline: 'Instant Gateway Deposit Credited!',
        message: `Your payment via ${params.provider.toUpperCase()} was verified and added to your wallet balance.`,
        rows: [
          {label: 'Deposit ID', value: params.topupId},
          {label: 'Amount Credited', value: `৳${outcome.amount}`},
          {label: 'Gateway TrxID', value: params.gatewayTrxId || params.topupId},
          {label: 'New Wallet Balance', value: `৳${outcome.nextWalletBalance}`},
        ],
      });
    }
    void deps.notifyTelegramAdmins(
      `⚡ Instant Gateway Deposit Approved (${params.provider.toUpperCase()})\n💰 Credited: ৳${outcome.amount}\n👤 ${outcome.customerName} | Balance: ৳${outcome.nextWalletBalance}`,
      {inline_keyboard: [[{text: '🛡️ Open Admin Panel', callback_data: 'adm:home'}]]},
    );
    return true;
  };

  app.post('/api/payment-gateway/create-session', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    const store = deps.readStore();
    const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);
    if (!cfg.gatewayEnabled || cfg.gatewayProvider === 'none' || !cfg.gatewayBaseUrl || !cfg.gatewayApiKey) {
      res.status(501).json({
        ok: false,
        configured: false,
        status: 'pending_configuration',
        error: 'Automated payment gateway merchant credentials are not configured yet. Please use Wallet or Manual Send Money.',
      });
      return;
    }

    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }

    const uid = String(req.firebaseAuthUid || '').trim();
    const purpose: 'order' | 'wallet_topup' = req.body?.purpose === 'wallet_topup' ? 'wallet_topup' : 'order';
    const customerName = String(req.body?.customerName || req.firebaseAuthName || 'Customer').trim().slice(0, 100);
    const customerEmail = String(req.body?.customerEmail || req.firebaseAuthEmail || 'customer@munaftopup.bd').trim().slice(0, 160);
    const customerPhone = String(req.body?.customerPhone || '01700000000').trim().slice(0, 30);

    let referenceId = String(req.body?.orderNumber || '').trim();
    let finalAmount = Number(req.body?.amount || 0);

    try {
      // Create pending Firestore record automatically when initiating instant gateway checkout or Add Money
      if (purpose === 'wallet_topup') {
        if (!(finalAmount >= 10 && finalAmount <= 500000)) {
          res.status(400).json({error: 'Deposit amount must be between ৳10 and ৳500,000'});
          return;
        }
        const topupId = `gwtop_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const now = FieldValue.serverTimestamp();
        await deps.adminDb.collection('walletTopups').doc(topupId).set({
          id: topupId,
          customerUid: uid,
          customerName,
          customerEmail,
          amount: finalAmount,
          paymentMethodId: cfg.gatewayProvider,
          paymentMethodName: `${cfg.gatewayProvider.toUpperCase()} Instant`,
          senderNumber: customerPhone,
          trxId: `PGW_${topupId}`,
          trxKey: `PGW_${topupId}`,
          screenshotUrl: '',
          status: 'pending',
          adminNote: `Initiated ${cfg.gatewayProvider} instant deposit session`,
          createdAt: now,
          updatedAt: now,
        });
        referenceId = topupId;
      } else if (!referenceId && req.body?.productId && req.body?.packageId) {
        const productId = String(req.body.productId).trim();
        const packageId = String(req.body.packageId).trim();
        const playerUid = String(req.body.playerUid || 'N/A').trim();
        const playerIgn = String(req.body.playerIgn || '').trim().slice(0, 80);
        const serverId = String(req.body.serverId || 'N/A').trim();
        const [prodSnap, custSnap, flashSnap] = await Promise.all([
          deps.adminDb.collection('products').doc(productId).get(),
          deps.adminDb.collection('customers').doc(uid).get(),
          deps.adminDb.collection('flashSales').where('productId', '==', productId).get(),
        ]);
        if (!prodSnap.exists) {
          res.status(404).json({error: 'Product not found'});
          return;
        }
        const prod = prodSnap.data() as any;
        const pkg = (prod.packages || []).find((k: any) => k.id === packageId && k.active !== false);
        if (!pkg) {
          res.status(404).json({error: 'Package not found'});
          return;
        }
        const activeFlash = flashSnap.docs
          .map((d) => d.data() as Record<string, unknown>)
          .find((s) => isFlashSaleCurrentlyActive(s, productId));
        const basePrice = Number(pkg.price || 0);
        const flashDisc = activeFlash
          ? Number(((basePrice * Number(activeFlash.discountPercent || 0)) / 100).toFixed(2))
          : 0;
        const afterFlash = Math.max(1, Number((basePrice - flashDisc).toFixed(2)));
        const cust = custSnap.exists ? (custSnap.data() as any) : {};
        const tier: CustomerTier = cust.tier === 'reseller' ? 'reseller' : cust.tier === 'vip' ? 'vip' : 'regular';
        const tierPct =
          tier === 'reseller' ? cfg.resellerDiscountPercent : tier === 'vip' ? cfg.vipDiscountPercent : 0;
        const tierDisc = tierPct > 0 ? Number(((afterFlash * tierPct) / 100).toFixed(2)) : 0;
        finalAmount = Math.max(1, Number((afterFlash - tierDisc).toFixed(2)));

        const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const orderNumber = generateOrderNumber();
        const now = FieldValue.serverTimestamp();
        await deps.adminDb.collection('orders').doc(orderId).set({
          id: orderId,
          orderNumber,
          customerUid: uid,
          customerName,
          customerEmail,
          customerPhone,
          productId: prod.id,
          productName: prod.name,
          productImage: prod.images?.[0] || '',
          packageId: pkg.id,
          packageName: pkg.name,
          quantityLabel: pkg.quantityLabel || '',
          unitPrice: basePrice,
          flashSaleDiscount: flashDisc,
          tierDiscount: tierDisc,
          appliedTier: tier,
          totalAmount: finalAmount,
          playerUid,
          ...(playerIgn ? {playerIgn} : {}),
          serverId,
          paymentType: 'manual',
          paymentMethodId: cfg.gatewayProvider,
          paymentMethodName: `${cfg.gatewayProvider.toUpperCase()} Instant`,
          senderNumber: customerPhone,
          trxId: `PGW_${orderNumber}`,
          trxKey: `PGW_${orderNumber}`,
          screenshotUrl: '',
          voucherCode: '',
          walletRefunded: false,
          paymentStatus: 'pending',
          orderStatus: 'pending',
          adminNote: `Initiated ${cfg.gatewayProvider} instant checkout`,
          notificationMessage: 'Awaiting instant payment gateway confirmation.',
          createdAt: now,
          updatedAt: now,
        });
        await deps.adminDb.collection('orderTracking').doc(orderNumber).set({
          orderNumber,
          productName: prod.name,
          packageName: pkg.name,
          playerUidMasked: maskPlayerUid(playerUid),
          paymentStatus: 'pending',
          orderStatus: 'pending',
          notificationMessage: 'Awaiting instant payment gateway confirmation.',
          createdAt: now,
          updatedAt: now,
        });
        referenceId = orderNumber;
      }

      if (!referenceId || !(finalAmount > 0)) {
        res.status(400).json({error: 'Valid reference and positive amount required'});
        return;
      }

      const base = cfg.gatewayBaseUrl.replace(/\/$/, '');
      const siteBase = deps.websiteUrl.replace(/\/$/, '');
      const redirectOk =
        purpose === 'wallet_topup'
          ? `${siteBase}/add-money?status=paid&ref=${encodeURIComponent(referenceId)}`
          : `${siteBase}/orders?order=${encodeURIComponent(referenceId)}`;
      const webhookUrl = `${siteBase}/api/payment-gateway/webhook/${cfg.gatewayProvider}`;

      let paymentUrl = '';
      let endpoint = '';
      let gwStatus = 200;
      let errMsg = '';

      if (cfg.gatewayProvider === 'sslcommerz') {
        endpoint = `${base}/gwprocess/v4/api.php`;
        const form = new URLSearchParams({
          store_id: cfg.gatewayApiKey,
          store_passwd: cfg.gatewayWebhookSecret,
          total_amount: String(finalAmount),
          currency: 'BDT',
          tran_id: referenceId,
          success_url: redirectOk,
          fail_url: `${siteBase}/${purpose === 'wallet_topup' ? 'add-money' : 'checkout'}?status=failed`,
          cancel_url: `${siteBase}/${purpose === 'wallet_topup' ? 'add-money' : 'checkout'}?status=cancelled`,
          ipn_url: webhookUrl,
          cus_name: customerName,
          cus_email: customerEmail,
          cus_phone: customerPhone,
          cus_add1: 'Dhaka',
          cus_city: 'Dhaka',
          cus_country: 'Bangladesh',
          shipping_method: 'NO',
          product_name: purpose === 'wallet_topup' ? 'Wallet Deposit' : `Order ${referenceId}`,
          product_category: 'Digital Goods',
          product_profile: 'non-physical-goods',
          value_a: purpose,
          value_b: referenceId,
        });
        const gwRes = await fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: form.toString(),
          signal: AbortSignal.timeout(12000),
        });
        gwStatus = gwRes.status;
        const payload = (await gwRes.json().catch(() => ({}))) as {
          GatewayPageURL?: string;
          failedreason?: string;
        };
        paymentUrl = String(payload.GatewayPageURL || '');
        errMsg = String(payload.failedreason || '');
      } else if (cfg.gatewayProvider === 'bkash_merchant') {
        endpoint = `${base}/tokenized/checkout/token/grant`;
        const tokenRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            username: customerName,
            password: cfg.gatewayWebhookSecret,
          },
          body: JSON.stringify({app_key: cfg.gatewayApiKey, app_secret: cfg.gatewayWebhookSecret}),
          signal: AbortSignal.timeout(10000),
        });
        const tokenData = (await tokenRes.json().catch(() => ({}))) as {id_token?: string; statusMessage?: string};
        if (tokenRes.ok && tokenData.id_token) {
          const createUrl = `${base}/tokenized/checkout/create`;
          const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: tokenData.id_token,
              'X-APP-Key': cfg.gatewayApiKey,
            },
            body: JSON.stringify({
              mode: '0011',
              payerReference: uid,
              callbackURL: `${webhookUrl}?purpose=${purpose}&ref=${encodeURIComponent(referenceId)}`,
              amount: String(finalAmount),
              currency: 'BDT',
              intent: 'sale',
              merchantInvoiceNumber: referenceId,
            }),
            signal: AbortSignal.timeout(12000),
          });
          gwStatus = createRes.status;
          const createData = (await createRes.json().catch(() => ({}))) as {bkashURL?: string; statusMessage?: string};
          paymentUrl = String(createData.bkashURL || '');
          errMsg = String(createData.statusMessage || '');
        } else {
          gwStatus = tokenRes.status;
          errMsg = String(tokenData.statusMessage || 'bKash token grant failed');
        }
      } else if (cfg.gatewayProvider === 'nagad_merchant') {
        endpoint = `${base}/api/dfs/check-out/initialize`;
        const gwRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-KM-Api-Version': 'v-0.2.0',
            Authorization: `Bearer ${cfg.gatewayApiKey}`,
          },
          body: JSON.stringify({
            orderId: referenceId,
            amount: String(finalAmount),
            purpose,
            callbackUrl: webhookUrl,
            redirectUrl: redirectOk,
          }),
          signal: AbortSignal.timeout(12000),
        });
        gwStatus = gwRes.status;
        const payload = (await gwRes.json().catch(() => ({}))) as {callBackUrl?: string; payment_url?: string; message?: string};
        paymentUrl = String(payload.callBackUrl || payload.payment_url || '');
        errMsg = String(payload.message || '');
      } else {
        // UddoktaPay
        endpoint = `${base}/api/checkout-v2`;
        const gwRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'RT-UDDOKTAPAY-API-KEY': cfg.gatewayApiKey,
            Authorization: `Bearer ${cfg.gatewayApiKey}`,
          },
          body: JSON.stringify({
            full_name: customerName,
            email: customerEmail,
            amount: finalAmount,
            metadata: {order_number: referenceId, purpose, reference_id: referenceId},
            redirect_url: redirectOk,
            cancel_url: `${siteBase}/${purpose === 'wallet_topup' ? 'add-money' : 'checkout'}?status=cancelled`,
            webhook_url: webhookUrl,
          }),
          signal: AbortSignal.timeout(12000),
        });
        gwStatus = gwRes.status;
        const payload = (await gwRes.json().catch(() => ({}))) as {payment_url?: string; message?: string};
        paymentUrl = String(payload.payment_url || '');
        errMsg = String(payload.message || '');
      }

      await writeApiLog(deps.adminDb, {
        type: 'payment_gateway',
        orderNumber: referenceId,
        endpoint,
        status: paymentUrl ? 'success' : 'failed',
        httpStatus: gwStatus,
        message: paymentUrl ? `Gateway session created (${cfg.gatewayProvider})` : errMsg || `HTTP ${gwStatus}`,
      });
      if (!paymentUrl) {
        res.status(502).json({error: errMsg || 'Gateway did not return payment URL'});
        return;
      }
      res.json({ok: true, paymentUrl, referenceId});
    } catch (err) {
      res.status(502).json({error: err instanceof Error ? err.message : 'Payment gateway error'});
    }
  });

  app.post('/api/payment-gateway/webhook/:provider', async (req: Request, res: Response) => {
    const provider = String(req.params.provider || '').trim();
    const store = deps.readStore();
    const cfg = normalizeCommerceSettings(store.systemSettings?.commerce);
    if (!cfg.gatewayWebhookSecret && !cfg.gatewayApiKey) {
      res.status(503).json({error: 'Payment gateway webhook secret is not configured'});
      return;
    }

    const body = (req.body || {}) as Record<string, any>;
    const expectedSecret = cfg.gatewayWebhookSecret || cfg.gatewayApiKey;

    // Verify webhook signature/authenticity
    let verifiedWebhook = false;
    if (provider === 'sslcommerz') {
      // Verify SSLCommerz IPN via store_id match + optional val_id server validation
      const storeIdMatch = body.store_id && deps.timingSafeEqualsText(String(body.store_id), cfg.gatewayApiKey);
      if (storeIdMatch && body.val_id && cfg.gatewayBaseUrl) {
        try {
          const valUrl = `${cfg.gatewayBaseUrl.replace(/\/$/, '')}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(String(body.val_id))}&store_id=${encodeURIComponent(cfg.gatewayApiKey)}&store_passwd=${encodeURIComponent(cfg.gatewayWebhookSecret)}&format=json`;
          const valRes = await fetch(valUrl, {signal: AbortSignal.timeout(8000)});
          const valData = (await valRes.json().catch(() => ({}))) as {status?: string};
          verifiedWebhook = valRes.ok && (valData.status === 'VALID' || valData.status === 'VALIDATED');
        } catch {
          verifiedWebhook = false;
        }
      } else if (storeIdMatch && (body.status === 'VALID' || body.status === 'VALIDATED')) {
        verifiedWebhook = true;
      }
    } else {
      const provided = String(
        req.headers['rt-uddoktapay-api-key'] || req.headers['x-webhook-secret'] || '',
      ).trim();
      verifiedWebhook = Boolean(provided && deps.timingSafeEqualsText(provided, expectedSecret));
    }

    if (!verifiedWebhook) {
      res.status(401).json({error: 'Invalid gateway webhook signature or validation failed'});
      return;
    }

    const meta = (body.metadata || {}) as Record<string, any>;
    const purpose = String(meta.purpose || body.value_a || req.query.purpose || 'order');
    const referenceId = String(
      meta.reference_id || meta.order_number || body.value_b || body.tran_id || body.orderNumber || req.query.ref || '',
    ).trim();
    const gwStatus = String(body.status || '').toUpperCase();
    const isCompleted = ['COMPLETED', 'VALID', 'VALIDATED', 'SUCCESS', 'PAID'].includes(gwStatus);
    const gatewayTrxId = String(body.transaction_id || body.bank_tran_id || body.trxID || '').trim();
    const paidAmount = Number(body.amount || 0);

    if (!referenceId || !deps.adminDb) {
      res.status(400).json({error: 'Missing order/deposit reference'});
      return;
    }

    await writeApiLog(deps.adminDb, {
      type: 'payment_gateway',
      orderNumber: referenceId,
      endpoint: `/api/payment-gateway/webhook/${provider}`,
      status: isCompleted ? 'success' : 'pending',
      message: `Webhook (${purpose}): status=${gwStatus || 'UNKNOWN'} trx=${gatewayTrxId || '—'}`,
    });

    if (isCompleted) {
      if (purpose === 'wallet_topup' || referenceId.startsWith('gwtop_')) {
        await completeWalletTopupViaGateway({topupId: referenceId, provider, gatewayTrxId});
      } else {
        await completeOrderViaGateway({orderNumber: referenceId, provider, gatewayTrxId, paidAmount});
      }
    }

    res.json({ok: true});
  });
}

export interface SmsReconcileOutcome {
  matched: boolean;
  matchedType?: 'order' | 'wallet_topup';
  orderId?: string;
  orderNumber?: string;
  orderStatus?: 'processing' | 'completed';
  voucherCode?: string;
  topupId?: string;
  amount?: number;
  newWalletBalance?: number;
}

export async function reconcilePendingTransactionsForSms(
  deps: CommerceDeps,
  sms: {
    trxId: string;
    amount: number;
    method: string;
  },
): Promise<SmsReconcileOutcome> {
  if (!deps.adminDb) return {matched: false};

  const upperTrx = sms.trxId.trim().toUpperCase();
  if (!upperTrx) return {matched: false};
  const smsAmt = Number(sms.amount || 0);
  if (!(smsAmt > 0)) return {matched: false};

  const smsRef = await resolveSmsPaymentRef(deps.adminDb, upperTrx);

  // 1. Check existing Pending Website Orders matching this TrxID (case-insensitive) & amount >= totalAmount
  try {
    const pendingOrdersSnap = await deps.adminDb
      .collection('orders')
      .where('paymentStatus', '==', 'pending')
      .get();

    const matchedOrderDoc = pendingOrdersSnap.docs.find((d) => {
      const o = d.data() as Record<string, unknown>;
      if (o.orderStatus !== 'pending') return false;
      if (o.paymentType === 'wallet') return false;
      const orderTrx = String(o.trxId || '').trim().toUpperCase();
      const requiredTotal = Number(o.totalAmount || 0);
      return orderTrx === upperTrx && requiredTotal > 0 && smsAmt + 0.01 >= requiredTotal;
    });

    if (matchedOrderDoc) {
      const o = matchedOrderDoc.data() as Record<string, unknown>;
      const productId = String(o.productId || '').trim();
      const packageId = String(o.packageId || '').trim();
      const unusedPinsSnap =
        productId && packageId
          ? await deps.adminDb
              .collection('voucherStock')
              .where('productId', '==', productId)
              .where('packageId', '==', packageId)
              .where('status', '==', 'unused')
              .limit(6)
              .get()
          : null;
      const candidatePinRef = unusedPinsSnap && !unusedPinsSnap.empty ? unusedPinsSnap.docs[0].ref : null;
      const remainingStockAfterClaim = unusedPinsSnap ? Math.max(0, unusedPinsSnap.size - 1) : 0;

      const orderTxOutcome = await deps.adminDb.runTransaction(async (tx) => {
        const orderRef = matchedOrderDoc.ref;
        const orderNumber = String(o.orderNumber || matchedOrderDoc.id).trim();
        const trxKey = String(o.trxKey || '').trim();
        const trackingRef = deps.adminDb!.collection('orderTracking').doc(orderNumber);
        const trxRef = trxKey ? deps.adminDb!.collection('trxRegistry').doc(trxKey) : null;

        const [smsSnap, freshOrderSnap, trxSnap, trackingSnap, pinSnap] = await Promise.all([
          tx.get(smsRef),
          tx.get(orderRef),
          trxRef ? tx.get(trxRef) : Promise.resolve(null),
          tx.get(trackingRef),
          candidatePinRef ? tx.get(candidatePinRef) : Promise.resolve(null),
        ]);

        if (!smsSnap.exists || smsSnap.data()?.used === true) {
          return null;
        }
        if (!freshOrderSnap.exists) return null;
        const freshOrder = freshOrderSnap.data() as Record<string, unknown>;
        if (freshOrder.paymentStatus !== 'pending' || freshOrder.orderStatus !== 'pending') {
          return null;
        }

        let claimedVoucherCode = '';
        if (pinSnap?.exists && pinSnap.data()?.status === 'unused') {
          claimedVoucherCode = String(pinSnap.data()?.code || '').trim();
        }

        const nextOrderStatus: 'processing' | 'completed' = claimedVoucherCode ? 'completed' : 'processing';
        const notificationMessage = claimedVoucherCode
          ? `Payment verified automatically & voucher code delivered instantly (${claimedVoucherCode}).`
          : 'Payment verified automatically. Processing top-up.';
        const now = FieldValue.serverTimestamp();
        const orderId = freshOrderSnap.id;

        tx.update(smsRef, {
          used: true,
          usedAt: now,
          usedOrderId: orderId,
          usedOrderNumber: orderNumber,
        });

        tx.update(orderRef, {
          paymentStatus: 'verified',
          orderStatus: nextOrderStatus,
          ...(claimedVoucherCode ? {voucherCode: claimedVoucherCode} : {}),
          adminNote: claimedVoucherCode
            ? `Auto-verified via incoming ${sms.method} SMS (৳${smsAmt}) & delivered PIN from Vault.`
            : `Auto-verified via incoming ${sms.method} SMS (৳${smsAmt}).`,
          notificationMessage,
          updatedAt: now,
          ...(nextOrderStatus === 'completed' ? {completedAt: now} : {}),
        });

        if (trackingSnap.exists) {
          tx.update(trackingRef, {
            paymentStatus: 'verified',
            orderStatus: nextOrderStatus,
            notificationMessage,
            updatedAt: now,
          });
        } else {
          tx.set(trackingRef, {
            orderNumber,
            productName: String(freshOrder.productName || 'Top-up').slice(0, 120),
            packageName: String(freshOrder.packageName || 'Package').slice(0, 120),
            playerUidMasked: maskPlayerUid(String(freshOrder.playerUid || 'N/A')),
            paymentStatus: 'verified',
            orderStatus: nextOrderStatus,
            notificationMessage,
            createdAt: now,
            updatedAt: now,
          });
        }

        if (trxRef && trxSnap?.exists) {
          tx.update(trxRef, {status: 'verified'});
        }

        if (claimedVoucherCode && candidatePinRef) {
          tx.update(candidatePinRef, {
            status: 'claimed',
            claimedOrderId: orderId,
            claimedOrderNumber: orderNumber,
            claimedAt: now,
          });
        }

        const histId = `ph_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        tx.set(deps.adminDb!.collection('paymentHistory').doc(histId), {
          id: histId,
          orderId,
          orderNumber,
          trxId: upperTrx,
          paymentMethodName: String(freshOrder.paymentMethodName || sms.method).slice(0, 60),
          senderNumber: String(freshOrder.senderNumber || 'N/A').slice(0, 40),
          amount: Number(freshOrder.totalAmount || smsAmt),
          action: 'approved',
          note: `Auto-verified via incoming ${sms.method} SMS (৳${smsAmt}).`,
          adminEmail: 'sms_auto_verifier',
          createdAt: now,
        });

        const customerUid = String(freshOrder.customerUid || '').trim();
        if (customerUid) {
          const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
            id: notifId,
            customerUid,
            orderId,
            orderNumber,
            title: claimedVoucherCode
              ? `Order Completed — ${orderNumber}`
              : `Payment Verified — ${orderNumber}`,
            message: notificationMessage,
            read: false,
            createdAt: now,
          });
        }

        return {
          orderId,
          orderNumber,
          customerUid,
          customerName: String(freshOrder.customerName || 'Customer'),
          customerEmail: String(freshOrder.customerEmail || ''),
          customerPhone: String(freshOrder.customerPhone || ''),
          productId: String(freshOrder.productId || ''),
          productName: String(freshOrder.productName || 'Top-up'),
          packageId: String(freshOrder.packageId || ''),
          packageName: String(freshOrder.packageName || 'Package'),
          playerUid: String(freshOrder.playerUid || 'N/A'),
          serverId: String(freshOrder.serverId || 'N/A'),
          totalAmount: Number(freshOrder.totalAmount || 0),
          paymentMethodName: String(freshOrder.paymentMethodName || sms.method),
          orderStatus: nextOrderStatus,
          claimedVoucherCode,
          notificationMessage,
        };
      });

      if (orderTxOutcome) {
        deps.markNotificationEventSent(`cust_order:${orderTxOutcome.orderNumber}:verified`);
        deps.markNotificationEventSent(`cust_order:${orderTxOutcome.orderNumber}:${orderTxOutcome.orderStatus}`);

        if (orderTxOutcome.claimedVoucherCode) {
          await writeApiLog(deps.adminDb, {
            type: 'pin_vault',
            orderNumber: orderTxOutcome.orderNumber,
            endpoint: 'voucherStock',
            status: 'success',
            message: `Auto-claimed PIN after incoming SMS verification. Remaining unused in batch: ${remainingStockAfterClaim}.`,
          });
          if (remainingStockAfterClaim < 5) {
            if (deps.onLowVoucherStock) {
              void deps.onLowVoucherStock({
                productId: orderTxOutcome.productId,
                productName: orderTxOutcome.productName,
                packageId: orderTxOutcome.packageId,
                packageName: orderTxOutcome.packageName,
                remaining: remainingStockAfterClaim,
              });
            } else {
              void deps.notifyTelegramAdmins(
                `⚠️ Low Voucher PIN Stock Alert!\n📦 ${orderTxOutcome.productName} · ${orderTxOutcome.packageName}\n🔑 Remaining unused PINs: ${remainingStockAfterClaim}`,
              );
            }
          }
        }

        if (orderTxOutcome.orderStatus !== 'completed') {
          void dispatchDistributorWithLog(deps, {
            orderId: orderTxOutcome.orderId,
            orderNumber: orderTxOutcome.orderNumber,
            productId: orderTxOutcome.productId,
            productName: orderTxOutcome.productName,
            packageId: orderTxOutcome.packageId,
            packageName: orderTxOutcome.packageName,
            playerUid: orderTxOutcome.playerUid,
            serverId: orderTxOutcome.serverId,
            amount: orderTxOutcome.totalAmount,
          });
        } else {
          void settleOrderCompletionEffects(deps, orderTxOutcome.orderId);
          if (deps.onOrderCompletedPush && orderTxOutcome.customerUid) {
            void deps.onOrderCompletedPush({
              customerUid: orderTxOutcome.customerUid,
              orderNumber: orderTxOutcome.orderNumber,
              productName: orderTxOutcome.productName,
              packageName: orderTxOutcome.packageName,
              voucherCode: orderTxOutcome.claimedVoucherCode || undefined,
            });
          }
        }

        if (orderTxOutcome.customerEmail) {
          void deps.sendCustomerOrderEmail({
            toEmail: orderTxOutcome.customerEmail,
            customerName: orderTxOutcome.customerName,
            orderNumber: orderTxOutcome.orderNumber,
            orderStatus: orderTxOutcome.orderStatus,
            paymentStatus: 'verified',
            productName: orderTxOutcome.productName,
            packageName: orderTxOutcome.packageName,
            playerUid: orderTxOutcome.playerUid,
            serverId: orderTxOutcome.serverId,
            totalAmount: orderTxOutcome.totalAmount,
            paymentMethodName: orderTxOutcome.paymentMethodName,
            trxId: upperTrx,
            voucherCode: orderTxOutcome.claimedVoucherCode || undefined,
            note: orderTxOutcome.notificationMessage,
          });
        }

        void deps.sendTelegramOrderStatusUpdate({
          orderNumber: orderTxOutcome.orderNumber,
          orderStatus: orderTxOutcome.orderStatus,
          paymentStatus: 'verified',
          productName: orderTxOutcome.productName,
          packageName: orderTxOutcome.packageName,
          playerUid: orderTxOutcome.playerUid,
          totalAmount: orderTxOutcome.totalAmount,
          paymentMethodName: orderTxOutcome.paymentMethodName,
          trxId: upperTrx,
          voucherCode: orderTxOutcome.claimedVoucherCode || undefined,
          note: orderTxOutcome.notificationMessage,
          customerUid: orderTxOutcome.customerUid,
        });

        void deps.sendAdminNotificationEmail(
          `Payment Auto-Verified via SMS — Order ${orderTxOutcome.orderNumber}`,
          [
            {label: 'Order Number', value: orderTxOutcome.orderNumber},
            {label: 'Product', value: `${orderTxOutcome.productName} · ${orderTxOutcome.packageName}`},
            {label: 'Amount', value: `৳${orderTxOutcome.totalAmount}`},
            {label: 'SMS Received', value: `${sms.method} ৳${smsAmt}`},
            {label: 'TrxID', value: upperTrx},
            {label: 'New Order Status', value: orderTxOutcome.orderStatus.toUpperCase()},
            {label: 'Customer', value: `${orderTxOutcome.customerName} (${orderTxOutcome.customerEmail || orderTxOutcome.customerUid})`},
          ],
          'sms_auto_verifier',
        );

        void deps.notifyTelegramAdmins(
          [
            `⚡ Order Auto-Verified by Incoming ${sms.method} SMS!`,
            `🧾 Order: ${orderTxOutcome.orderNumber} (${orderTxOutcome.orderStatus.toUpperCase()})`,
            `🎮 ${orderTxOutcome.productName} · ${orderTxOutcome.packageName}`,
            `💰 ৳${orderTxOutcome.totalAmount} | 🔑 TrxID: ${upperTrx}`,
            ...(orderTxOutcome.claimedVoucherCode ? [`🔑 Instant PIN Delivered`] : []),
          ].join('\n'),
          {
            inline_keyboard: [
              [
                {
                  text: `🔎 Inspect ${orderTxOutcome.orderNumber}`,
                  callback_data: deps.makeAdminOrderCallback(orderTxOutcome.orderId),
                },
              ],
            ],
          },
        );

        return {
          matched: true,
          matchedType: 'order',
          orderId: orderTxOutcome.orderId,
          orderNumber: orderTxOutcome.orderNumber,
          orderStatus: orderTxOutcome.orderStatus,
          voucherCode: orderTxOutcome.claimedVoucherCode || undefined,
          amount: orderTxOutcome.totalAmount,
        };
      }
    }
  } catch (err) {
    console.error('[SMS Reconcile Orders] Error:', err instanceof Error ? err.message : err);
  }

  // 2. Check existing Pending Add Money Wallet Deposits matching this TrxID (case-insensitive) & amount >= topup.amount
  try {
    const pendingTopupsSnap = await deps.adminDb
      .collection('walletTopups')
      .where('status', '==', 'pending')
      .get();

    const matchedTopupDoc = pendingTopupsSnap.docs.find((d) => {
      const t = d.data() as Record<string, unknown>;
      const topupTrx = String(t.trxId || '').trim().toUpperCase();
      const requiredAmt = Number(t.amount || 0);
      return topupTrx === upperTrx && requiredAmt > 0 && smsAmt + 0.01 >= requiredAmt;
    });

    if (matchedTopupDoc) {
      const t = matchedTopupDoc.data() as Record<string, unknown>;
      const topupTxOutcome = await deps.adminDb.runTransaction(async (tx) => {
        const topupRef = matchedTopupDoc.ref;
        const customerUid = String(t.customerUid || '').trim();
        if (!customerUid) return null;
        const custRef = deps.adminDb!.collection('customers').doc(customerUid);
        const trxKey = String(t.trxKey || '').trim();
        const trxRef = trxKey ? deps.adminDb!.collection('trxRegistry').doc(trxKey) : null;

        const [smsSnap, freshTopupSnap, custSnap, trxSnap] = await Promise.all([
          tx.get(smsRef),
          tx.get(topupRef),
          tx.get(custRef),
          trxRef ? tx.get(trxRef) : Promise.resolve(null),
        ]);

        if (!smsSnap.exists || smsSnap.data()?.used === true) return null;
        if (!freshTopupSnap.exists || !custSnap.exists) return null;
        const freshTopup = freshTopupSnap.data() as Record<string, unknown>;
        if (freshTopup.status !== 'pending') return null;

        const topupAmount = Number(freshTopup.amount || 0);
        const prevBalance = Number(custSnap.data()?.walletBalance || 0);
        const newWalletBalance = Number((prevBalance + topupAmount).toFixed(2));
        const now = FieldValue.serverTimestamp();
        const topupId = freshTopupSnap.id;

        tx.update(smsRef, {
          used: true,
          usedAt: now,
          usedOrderId: topupId,
          usedOrderNumber: topupId,
          usedType: 'wallet_topup',
        });

        tx.update(topupRef, {
          status: 'approved',
          adminNote: `Auto-approved via incoming ${sms.method} SMS (৳${smsAmt}).`,
          updatedAt: now,
        });

        tx.update(custRef, {
          walletBalance: newWalletBalance,
          updatedAt: now,
        });

        if (trxRef && trxSnap?.exists) {
          tx.update(trxRef, {status: 'verified'});
        }

        const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        tx.set(deps.adminDb!.collection('notifications').doc(notifId), {
          id: notifId,
          customerUid,
          orderId: topupId,
          orderNumber: topupId,
          title: `Wallet Deposit Approved — ৳${topupAmount}`,
          message: `Your Add Money deposit of ৳${topupAmount} (${upperTrx}) was verified automatically and credited to your wallet.`,
          read: false,
          createdAt: now,
        });

        return {
          topupId,
          customerUid,
          customerName: String(freshTopup.customerName || custSnap.data()?.displayName || 'Customer'),
          customerEmail: String(freshTopup.customerEmail || custSnap.data()?.email || ''),
          paymentMethodName: String(freshTopup.paymentMethodName || sms.method),
          amount: topupAmount,
          newWalletBalance,
        };
      });

      if (topupTxOutcome) {
        deps.markNotificationEventSent(`deposit:${upperTrx}`);

        if (topupTxOutcome.customerEmail) {
          void deps.sendCustomerGenericEmail({
            toEmail: topupTxOutcome.customerEmail,
            customerName: topupTxOutcome.customerName,
            subject: `Wallet Deposit Approved — ৳${topupTxOutcome.amount}`,
            headline: 'Your Wallet Deposit Has Been Credited Automatically!',
            message: `We verified your ${topupTxOutcome.paymentMethodName} payment automatically via SMS and added ৳${topupTxOutcome.amount} to your wallet balance.`,
            rows: [
              {label: 'Deposit ID', value: topupTxOutcome.topupId},
              {label: 'Amount Credited', value: `৳${topupTxOutcome.amount}`},
              {label: 'Payment Method', value: topupTxOutcome.paymentMethodName},
              {label: 'TrxID', value: upperTrx},
              {label: 'New Wallet Balance', value: `৳${topupTxOutcome.newWalletBalance}`},
            ],
          });
        }

        void deps.sendAdminNotificationEmail(
          `Wallet Deposit Auto-Approved via SMS (৳${topupTxOutcome.amount})`,
          [
            {label: 'Deposit ID', value: topupTxOutcome.topupId},
            {label: 'Amount Credited', value: `৳${topupTxOutcome.amount}`},
            {label: 'SMS Received', value: `${sms.method} ৳${smsAmt}`},
            {label: 'TrxID', value: upperTrx},
            {label: 'Customer', value: `${topupTxOutcome.customerName} (${topupTxOutcome.customerEmail || topupTxOutcome.customerUid})`},
            {label: 'New Wallet Balance', value: `৳${topupTxOutcome.newWalletBalance}`},
          ],
          'sms_auto_verifier',
        );

        void deps.notifyTelegramAdmins(
          [
            `⚡ Wallet Deposit Auto-Approved by Incoming ${sms.method} SMS!`,
            `💰 Credited: ৳${topupTxOutcome.amount} | TrxID: ${upperTrx}`,
            `👤 ${topupTxOutcome.customerName} (${topupTxOutcome.customerEmail || topupTxOutcome.customerUid})`,
            `💵 New Balance: ৳${topupTxOutcome.newWalletBalance}`,
          ].join('\n'),
          {inline_keyboard: [[{text: '🛡️ Open Admin Panel', callback_data: 'adm:home'}]]},
        );

        return {
          matched: true,
          matchedType: 'wallet_topup',
          topupId: topupTxOutcome.topupId,
          amount: topupTxOutcome.amount,
          newWalletBalance: topupTxOutcome.newWalletBalance,
        };
      }
    }
  } catch (err) {
    console.error('[SMS Reconcile WalletTopups] Error:', err instanceof Error ? err.message : err);
  }

  return {matched: false};
}

function pRefFallback<T>(ref: T): T {
  return ref;
}
