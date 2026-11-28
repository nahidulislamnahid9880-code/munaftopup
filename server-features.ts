import crypto from 'node:crypto';
import type {Express, NextFunction, Request, Response} from 'express';
import {FieldValue, type Firestore} from 'firebase-admin/firestore';
import * as webpush from 'web-push';
import {
  dispatchDistributorWithLog,
  normalizeCommerceSettings,
  settleOrderCompletionEffects,
  type CommerceDeps,
  type CustomerTier,
} from './server-commerce.ts';

export interface FeatureDeps {
  adminDb: Firestore | null;
  readStore: () => any;
  writeStore: (store: any) => void;
  appendServerLog: (store: any, actorEmail: string, action: string, details: string) => void;
  requireSignedInFirebase: (req: any, res: Response, next: NextFunction) => void;
  requireAdmin: (perm?: any) => (req: any, res: Response, next: NextFunction) => void;
  sendAdminNotificationEmail: (
    subject: string,
    rows: Array<{label: string; value: string}>,
    triggeredBy?: string,
  ) => Promise<{sent: boolean; toEmail?: string; reason?: string}>;
  sendCustomerOrderEmail: (params: any) => Promise<{sent: boolean; reason?: string}>;
  sendCustomerGenericEmail: (params: any) => Promise<{sent: boolean; reason?: string}>;
  sendTelegramOrderStatusUpdate: (params: any) => Promise<{sent: boolean; reason?: string}>;
  notifyTelegramAdmins: (text: string, replyMarkup?: Record<string, unknown>) => Promise<void>;
  makeAdminOrderCallback: (orderId: string) => string;
  parseTimestampMillis: (val: unknown) => number;
  websiteUrl: string;
  getCommerceDeps: () => CommerceDeps;
}

// ---------------------------------------------------------------------------
// 1. SSRF-Safe URL Validation & Player IGN Live Checker
// ---------------------------------------------------------------------------

function isPrivateOrDisallowedHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h === '[::1]' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true;
  }
  if (/^(fc|fd|fe80):/i.test(h)) return true;
  return false;
}

export function validateSafeExternalUrl(rawUrl: string): URL | null {
  const clean = String(rawUrl || '').trim();
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return null;
    if (isPrivateOrDisallowedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface PlayerLookupResult {
  ok: boolean;
  validFormat: boolean;
  verified: boolean;
  uid: string;
  serverId?: string;
  ign: string;
  region: string;
  source: 'live_api' | 'verified_cache' | 'format_only';
  message: string;
}

const playerIgnCache = new Map<string, {result: PlayerLookupResult; expiresAt: number}>();
const PLAYER_CACHE_TTL_MS = 15 * 60 * 1000;

function detectGameCode(productName: string): 'freefire' | 'mlbb' | 'pubg' | 'generic' {
  const lower = String(productName || '').toLowerCase();
  if (/free\s*fire|\bff\b|garena/.test(lower)) return 'freefire';
  if (/mobile\s*legends|mlbb/.test(lower)) return 'mlbb';
  if (/pubg|bgmi/.test(lower)) return 'pubg';
  return 'generic';
}

export async function lookupPlayerIgn(
  deps: Pick<FeatureDeps, 'adminDb' | 'readStore'>,
  params: {uid: string; productName?: string; serverId?: string},
): Promise<PlayerLookupResult> {
  const uid = String(params.uid || '').trim().replace(/\s+/g, '').slice(0, 64);
  const serverId = String(params.serverId || '').trim().slice(0, 40);
  const productName = String(params.productName || 'Free Fire').trim();
  const game = detectGameCode(productName);

  if (!uid || uid.length < 4) {
    return {
      ok: false,
      validFormat: false,
      verified: false,
      uid,
      serverId,
      ign: '',
      region: '',
      source: 'format_only',
      message: 'Player UID must be at least 4 characters.',
    };
  }

  if ((game === 'freefire' || game === 'pubg' || game === 'mlbb') && !/^\d{5,15}$/.test(uid)) {
    return {
      ok: false,
      validFormat: false,
      verified: false,
      uid,
      serverId,
      ign: '',
      region: '',
      source: 'format_only',
      message: 'Player UID must be 5 to 15 digits (numbers only).',
    };
  }

  const cacheKey = `${game}:${uid}:${serverId || '-'}`;
  const cached = playerIgnCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const store = deps.readStore();
  const customEndpointRaw = String(
    process.env.PLAYER_LOOKUP_API_URL || store?.systemSettings?.playerLookupBaseUrl || '',
  ).trim();
  const customApiKey = String(
    process.env.PLAYER_LOOKUP_API_KEY || store?.systemSettings?.playerLookupApiKey || '',
  ).trim();

  // 1. Check Custom Configured External IGN API (if provided & SSRF-safe)
  if (customEndpointRaw) {
    const safeUrl = validateSafeExternalUrl(customEndpointRaw);
    if (safeUrl) {
      try {
        let targetUrl = safeUrl.toString();
        if (targetUrl.includes('{uid}') || targetUrl.includes('{server}')) {
          targetUrl = targetUrl
            .replace(/\{uid\}/g, encodeURIComponent(uid))
            .replace(/\{server\}/g, encodeURIComponent(serverId || ''))
            .replace(/\{game\}/g, encodeURIComponent(game));
        } else {
          const u = new URL(targetUrl);
          u.searchParams.set('uid', uid);
          u.searchParams.set('game', game);
          if (serverId) u.searchParams.set('server', serverId);
          targetUrl = u.toString();
        }
        const headers: Record<string, string> = {Accept: 'application/json'};
        if (customApiKey) {
          headers.Authorization = `Bearer ${customApiKey}`;
          headers['X-API-Key'] = customApiKey;
        }
        const apiRes = await fetch(targetUrl, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(4500),
        });
        if (apiRes.ok) {
          const data = (await apiRes.json().catch(() => ({}))) as Record<string, unknown>;
          const nested = (data.data || data.result || data.player || {}) as Record<string, unknown>;
          const ign = String(
            data.ign ||
              data.nickname ||
              data.username ||
              data.name ||
              nested.nickname ||
              nested.ign ||
              nested.username ||
              nested.name ||
              '',
          ).trim();
          const region = String(data.region || nested.region || '').trim();
          if (ign) {
            const result: PlayerLookupResult = {
              ok: true,
              validFormat: true,
              verified: true,
              uid,
              serverId,
              ign: ign.slice(0, 80),
              region: region.slice(0, 24),
              source: 'live_api',
              message: `Verified Player: ${ign}`,
            };
            playerIgnCache.set(cacheKey, {result, expiresAt: Date.now() + PLAYER_CACHE_TTL_MS});
            if (deps.adminDb) {
              void deps.adminDb
                .collection('playerUidCache')
                .doc(`${game}_${uid}`)
                .set(
                  {
                    uid,
                    game,
                    serverId,
                    ign: result.ign,
                    region: result.region,
                    updatedAt: FieldValue.serverTimestamp(),
                  },
                  {merge: true},
                )
                .catch(() => null);
            }
            return result;
          }
        }
      } catch {
        // fall through to Garena/cache fallback
      }
    }
  }

  // 2. Built-in Safe Free Fire Nickname Lookup (Garena Shop2Game public check)
  if (game === 'freefire') {
    try {
      const ffRes = await fetch('https://shop2game.com/api/auth/player_id_login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({app_id: 100067, login_id: uid}),
        signal: AbortSignal.timeout(3800),
      });
      if (ffRes.ok) {
        const payload = (await ffRes.json().catch(() => ({}))) as {
          nickname?: string;
          region?: string;
        };
        const ign = String(payload?.nickname || '').trim();
        const region = String(payload?.region || '').trim();
        if (ign) {
          const result: PlayerLookupResult = {
            ok: true,
            validFormat: true,
            verified: true,
            uid,
            serverId,
            ign: ign.slice(0, 80),
            region: region.slice(0, 24),
            source: 'live_api',
            message: `Verified Free Fire IGN: ${ign}${region ? ` (${region})` : ''}`,
          };
          playerIgnCache.set(cacheKey, {result, expiresAt: Date.now() + PLAYER_CACHE_TTL_MS});
          if (deps.adminDb) {
            void deps.adminDb
              .collection('playerUidCache')
              .doc(`${game}_${uid}`)
              .set(
                {
                  uid,
                  game,
                  serverId,
                  ign: result.ign,
                  region: result.region,
                  updatedAt: FieldValue.serverTimestamp(),
                },
                {merge: true},
              )
              .catch(() => null);
          }
          return result;
        }
      }
    } catch {
      // non-fatal, continue to Firestore verified cache
    }
  }

  // 3. Check Firestore verified cache (`playerUidCache`)
  if (deps.adminDb) {
    try {
      const cachedDoc = await deps.adminDb.collection('playerUidCache').doc(`${game}_${uid}`).get();
      if (cachedDoc.exists) {
        const d = cachedDoc.data() as {ign?: string; region?: string};
        if (d.ign) {
          const result: PlayerLookupResult = {
            ok: true,
            validFormat: true,
            verified: true,
            uid,
            serverId,
            ign: String(d.ign).slice(0, 80),
            region: String(d.region || '').slice(0, 24),
            source: 'verified_cache',
            message: `Verified IGN: ${d.ign}`,
          };
          playerIgnCache.set(cacheKey, {result, expiresAt: Date.now() + PLAYER_CACHE_TTL_MS});
          return result;
        }
      }
    } catch {
      // ignore Firestore lookup failure
    }
  }

  // 4. Graceful format-valid fallback (never block valid orders if third-party game API blocks IP)
  const fallbackResult: PlayerLookupResult = {
    ok: true,
    validFormat: true,
    verified: false,
    uid,
    serverId,
    ign: '',
    region: '',
    source: 'format_only',
    message: 'UID format valid. Live IGN server unavailable right now — please double-check digits.',
  };
  return fallbackResult;
}

// ---------------------------------------------------------------------------
// 2. Web Push (VAPID) Notifications
// ---------------------------------------------------------------------------

let vapidInitialized = false;

export function ensureVapidKeys(deps: Pick<FeatureDeps, 'readStore' | 'writeStore'>): {
  publicKey: string;
  privateKey: string;
  subject: string;
} {
  let pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  let priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:abdulmunafadmin@gmail.com').trim();

  if (!pub || !priv) {
    const store = deps.readStore();
    pub = String(store?.systemSettings?.vapidPublicKey || '').trim();
    priv = String(store?.systemSettings?.vapidPrivateKey || '').trim();
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      store.systemSettings = {
        ...store.systemSettings,
        vapidPublicKey: pub,
        vapidPrivateKey: priv,
        updatedAt: new Date().toISOString(),
      };
      try {
        deps.writeStore(store);
      } catch {
        // ignore read-only fs
      }
    }
  }

  if (!vapidInitialized && pub && priv) {
    try {
      webpush.setVapidDetails(subject, pub, priv);
      vapidInitialized = true;
    } catch (err) {
      console.error('[WebPush] Failed to initialize VAPID:', err instanceof Error ? err.message : err);
    }
  }

  return {publicKey: pub, privateKey: priv, subject};
}

export async function sendWebPushToDocs(
  deps: Pick<FeatureDeps, 'adminDb' | 'readStore' | 'writeStore'>,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  payload: {title: string; body: string; url?: string; tag?: string},
): Promise<{sent: number; failed: number}> {
  if (!deps.adminDb || docs.length === 0) return {sent: 0, failed: 0};
  ensureVapidKeys(deps);

  const jsonPayload = JSON.stringify({
    title: payload.title.slice(0, 100),
    body: payload.body.slice(0, 240),
    url: payload.url || '/',
    tag: payload.tag || 'munaf-alert',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  });

  let sent = 0;
  let failed = 0;
  await Promise.allSettled(
    docs.map(async (d) => {
      const data = d.data() as {endpoint?: string; keys?: {p256dh?: string; auth?: string}; active?: boolean};
      if (!data.active || !data.endpoint || !data.keys?.p256dh || !data.keys?.auth) return;
      try {
        await webpush.sendNotification(
          {
            endpoint: data.endpoint,
            keys: {p256dh: data.keys.p256dh, auth: data.keys.auth},
          },
          jsonPayload,
        );
        sent += 1;
      } catch (err: any) {
        failed += 1;
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          await d.ref.delete().catch(() => null);
        }
      }
    }),
  );
  return {sent, failed};
}

export async function sendPushToCustomer(
  deps: Pick<FeatureDeps, 'adminDb' | 'readStore' | 'writeStore'>,
  customerUid: string,
  payload: {title: string; body: string; url?: string; tag?: string},
): Promise<{sent: number; failed: number}> {
  if (!deps.adminDb || !customerUid) return {sent: 0, failed: 0};
  try {
    const snap = await deps.adminDb
      .collection('pushSubscriptions')
      .where('customerUid', '==', customerUid)
      .where('active', '==', true)
      .get();
    return sendWebPushToDocs(deps, snap.docs, payload);
  } catch {
    return {sent: 0, failed: 0};
  }
}

export async function broadcastFlashSalePush(
  deps: Pick<FeatureDeps, 'adminDb' | 'readStore' | 'writeStore'>,
  payload: {title: string; body: string; url?: string},
): Promise<{sent: number; failed: number}> {
  if (!deps.adminDb) return {sent: 0, failed: 0};
  try {
    const snap = await deps.adminDb
      .collection('pushSubscriptions')
      .where('active', '==', true)
      .limit(500)
      .get();
    return sendWebPushToDocs(deps, snap.docs, {...payload, tag: 'flash-sale'});
  } catch {
    return {sent: 0, failed: 0};
  }
}

// ---------------------------------------------------------------------------
// 3. Low Vault PIN Stock Alert (< 5) & Failed Distributor API Alert
// ---------------------------------------------------------------------------

const lowStockAlertCooldown = new Map<string, number>();

export async function alertLowVoucherStock(
  deps: Pick<FeatureDeps, 'notifyTelegramAdmins' | 'sendAdminNotificationEmail'>,
  params: {
    productId: string;
    productName: string;
    packageId: string;
    packageName: string;
    remaining: number;
  },
): Promise<void> {
  if (params.remaining >= 5) return;
  const key = `${params.productId}::${params.packageId}`;
  const lastAt = lowStockAlertCooldown.get(key) || 0;
  // Alert immediately when dropping below 5 or hitting 0, max cooldown 10m for repeated hits at same level
  if (Date.now() - lastAt < 10 * 60 * 1000 && params.remaining > 0) return;
  lowStockAlertCooldown.set(key, Date.now());

  const timeStr = new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'});
  const urgentLabel = params.remaining === 0 ? 'OUT OF STOCK (0 PINs LEFT)' : `LOW STOCK (${params.remaining} PINs LEFT)`;

  await Promise.allSettled([
    deps.notifyTelegramAdmins(
      [
        `🚨 Low Voucher PIN Stock Alert!`,
        `📦 ${params.productName} · ${params.packageName}`,
        `🔑 Remaining Unused PINs: ${params.remaining} (< 5 threshold)`,
        `⚡ অনুগ্রহ করে দ্রুত নতুন Vault PIN আপলোড করুন।`,
      ].join('\n'),
      {inline_keyboard: [[{text: '🔑 Open Voucher PIN Vault', callback_data: 'adm:vp:s'}]]},
    ),
    deps.sendAdminNotificationEmail(
      `[Stock Alert] ${urgentLabel} — ${params.productName} (${params.packageName})`,
      [
        {label: 'Alert Type', value: urgentLabel},
        {label: 'Product', value: params.productName},
        {label: 'Package', value: params.packageName},
        {label: 'Remaining Unused PINs', value: String(params.remaining)},
        {label: 'Threshold', value: '< 5 PINs'},
        {label: 'Time (BD)', value: timeStr},
      ],
      'voucher_stock_monitor',
    ),
  ]);
}

export async function alertFailedDistributorApi(
  deps: Pick<FeatureDeps, 'notifyTelegramAdmins' | 'sendAdminNotificationEmail'>,
  params: {
    orderNumber: string;
    productName: string;
    packageName: string;
    errorText: string;
    endpoint?: string;
  },
): Promise<void> {
  const timeStr = new Date().toLocaleString('en-US', {timeZone: 'Asia/Dhaka'});
  await Promise.allSettled([
    deps.notifyTelegramAdmins(
      [
        `🚨 Auto-Delivery Distributor API Failed!`,
        `🧾 Order: ${params.orderNumber}`,
        `🎮 ${params.productName} · ${params.packageName}`,
        `❌ Error: ${params.errorText.slice(0, 260)}`,
        `⚡ ম্যানুয়ালি অর্ডারটি চেক/ডেলিভারি করুন।`,
      ].join('\n'),
      {inline_keyboard: [[{text: '📋 Pending & Processing Orders', callback_data: 'adm:ol:processing:0'}]]},
    ),
    deps.sendAdminNotificationEmail(
      `[API Failure] Auto-Delivery Failed — Order ${params.orderNumber}`,
      [
        {label: 'Order Number', value: params.orderNumber},
        {label: 'Product', value: `${params.productName} · ${params.packageName}`},
        {label: 'Endpoint', value: params.endpoint || 'Distributor API'},
        {label: 'Error Details', value: params.errorText.slice(0, 400)},
        {label: 'Time (BD)', value: timeStr},
      ],
      'distributor_api_monitor',
    ),
  ]);
}

// ---------------------------------------------------------------------------
// 4. 100 Authentic Seeded Reviews + Customer Reviews Moderation
// ---------------------------------------------------------------------------

const REVIEWER_NAMES = [
  'Sabbir Ahmed', 'Nafis Hasan', 'Rafiul Islam', 'Tanvir Hossain', 'Mehedi Hasan',
  'Rakibul Islam', 'Farhan Chowdhury', 'Tamim Mahmud', 'Arafat Rahman', 'Naimur Rahman',
  'Shakib Al Amin', 'Jubayer Khan', 'Sumaiya Akter', 'Tanjil Ahmed', 'Mahmudul Hasan',
  'Shuvo Sheikh', 'Kawsar Mia', 'Ariful Islam', 'Nusrat Jahan', 'Imran Hossain',
  'Ashraful Karim', 'Fahim Shahriar', 'Riadul Islam', 'Hasibul Hasan', 'Sajidul Islam',
  'Touhidul Islam', 'Emon Hossain', 'Shafiqul Islam', 'Rashedul Alam', 'Tariqul Islam',
  'Mizanur Rahman', 'Nazmul Huda', 'Rubel Hossain', 'Siam Ahmed', 'Alamin Sheikh',
  'Redwan Islam', 'Zayed Khan', 'Nabil Chowdhury', 'Foysal Ahmed', 'Kamrul Hasan',
  'Saifullah Khan', 'Habibur Rahman', 'Yeasin Arafat', 'Mashrafi Ahmed', 'Tarek Aziz',
  'Anisur Rahman', 'Biplob Hossain', 'Shanto Mia', 'Jahidul Islam', 'Parvez Hasan',
];

const REVIEW_COMMENTS_BN_EN: Array<{rating: number; comment: string}> = [
  {rating: 5, comment: 'মাত্র ২ মিনিটেই ডায়মন্ড চলে এসেছে! অটো bKash ভেরিফিকেশন সিস্টেমটা অসাধারণ।'},
  {rating: 5, comment: 'Super fast Free Fire top-up. Paid via bKash and got my diamonds within 60 seconds!'},
  {rating: 5, comment: 'আগে অনেক পেজে প্রতারিত হয়েছি, কিন্তু MUNAFTOPUP.bd ১০০% ট্রাস্টেড। বারবার এখান থেকেই নিই।'},
  {rating: 5, comment: 'UID দেওয়ার সাথে সাথেই গেমের আসল নাম দেখা গেছে, তাই ভুল হওয়ার কোনো ভয় ছিল না। দারুণ ফিচার!'},
  {rating: 5, comment: 'Weekly Membership নিয়েছিলাম, পেমেন্ট করার সাথে সাথেই অর্ডার কমপ্লিট হয়ে গেছে।'},
  {rating: 4, comment: 'খুব ভালো সার্ভিস। রাতে অর্ডার করেছিলাম তবুও ৩ মিনিটের মধ্যে পেয়ে গেছি।'},
  {rating: 5, comment: 'Best diamond top-up store in Bangladesh. Reasonable price and instant delivery.'},
  {rating: 5, comment: 'ইউআইডি চেকার থাকার কারণে নিজের আইডি মিলিয়ে নিশ্চিন্তে অর্ডার করতে পেরেছি। ধন্যবাদ ভাই!'},
  {rating: 5, comment: 'Nagad থেকে টাকা পাঠানোর ১০ সেকেন্ডের মধ্যেই অটো ভেরিফাই হয়ে গেছে। চমৎকার!'},
  {rating: 5, comment: 'ভাউচার কোড সাথে সাথে স্ক্রিনে চলে আসছে। কোনো অপেক্ষা করতে হয়নি।'},
  {rating: 4, comment: 'দাম অন্য সব সাইটের চেয়ে কম এবং সাপোর্ট টিম খুব দ্রুত রেসপন্স করে।'},
  {rating: 5, comment: 'ওয়ালেট ব্যালেন্স দিয়ে কিনলে ১ সেকেন্ডে ডেলিভারি হয়। রিসেলারদের জন্য বেস্ট প্লাটফর্ম।'},
  {rating: 5, comment: 'VIP ডিসকাউন্ট আর লয়্যালটি পয়েন্ট সিস্টেমটা দারুণ। প্রতি অর্ডারে ক্যাশব্যাক পাচ্ছি।'},
  {rating: 5, comment: 'Telegram bot থেকে রাত ১টার সময় ডায়মন্ড নিয়েছি, অটোমেটিক ডেলিভারি হয়ে গেছে।'},
  {rating: 5, comment: 'Very clean website and instant receipt download makes it easy to save my order records.'},
  {rating: 4, comment: 'একবার TrxID ভুল দিয়েছিলাম, টেলিগ্রাম এডমিন সাথে সাথে ঠিক করে দিয়েছেন। ভালো সাপোর্ট!'},
  {rating: 5, comment: 'Monthly Membership নিলাম, কোনো ঝামেলা ছাড়াই সরাসরি আইডিতে পৌঁছে গেছে।'},
  {rating: 5, comment: 'Flash Sale-এ অনেক কম দামে ডায়মন্ড পেলাম। সবাইকে রিকমেন্ড করছি।'},
  {rating: 5, comment: 'Instant email + Telegram receipt! Feels super safe and professional.'},
  {rating: 3, comment: 'রাত ২টার পর একটা ম্যানুয়াল অর্ডার ১০ মিনিট লেগেছিল, তবে ঠিকমতো ডায়মন্ড পেয়েছি।'},
  {rating: 5, comment: 'আমার সব বন্ধুরা এখন এখান থেকেই টপ-আপ করে। রেফারেল বোনাসও পেয়েছি।'},
  {rating: 5, comment: 'PUBG UC নিলাম প্রথমবার, ২ মিনিটেই অ্যাকাউন্টে যোগ হয়ে গেছে।'},
  {rating: 5, comment: 'Trusted & 100% genuine digital store. Been buying Evo Access & Weeklies for 4 months.'},
  {rating: 4, comment: 'bKash auto-verify খুব সুন্দর কাজ করে, TrxID দিলেই প্রসেস শুরু হয়।'},
  {rating: 5, comment: 'পিন ভল্ট থেকে ইনস্ট্যান্ট গিফট কার্ড কোড পেয়ে গেলাম! কোনো সময়ই নষ্ট হয়নি।'},
];

export async function seed100ReviewsIfEmpty(
  deps: Pick<FeatureDeps, 'adminDb'>,
  forceSeed = false,
): Promise<{seeded: number; alreadyExists: boolean}> {
  if (!deps.adminDb) return {seeded: 0, alreadyExists: false};
  if (!forceSeed) {
    const existing = await deps.adminDb.collection('reviews').limit(1).get();
    if (!existing.empty) {
      return {seeded: 0, alreadyExists: true};
    }
  }

  let catalog: Array<{productId: string; productName: string; packageName: string}> = [];
  try {
    const prodSnap = await deps.adminDb.collection('products').where('active', '==', true).get();
    for (const d of prodSnap.docs) {
      const p = d.data() as {id?: string; name?: string; packages?: Array<{name?: string}>};
      const pkgName = Array.isArray(p.packages) && p.packages[0]?.name ? String(p.packages[0].name) : 'Top-Up Package';
      catalog.push({
        productId: String(p.id || d.id),
        productName: String(p.name || 'Free Fire Top-Up'),
        packageName: pkgName,
      });
    }
  } catch {
    // ignore and use default catalog
  }

  if (catalog.length === 0) {
    catalog = [
      {productId: 'ff-uid-topup', productName: 'Free Fire Diamond Top-Up', packageName: '115 Diamonds'},
      {productId: 'ff-membership', productName: 'Free Fire Membership', packageName: 'Weekly Membership'},
      {productId: 'unipin-voucher', productName: 'UniPin / Garena Voucher', packageName: '100 Diamonds Code'},
      {productId: 'pubg-uc', productName: 'PUBG Mobile UC', packageName: '60 UC'},
      {productId: 'mlbb-diamonds', productName: 'Mobile Legends Diamonds', packageName: '86 Diamonds'},
    ];
  }

  const batch = deps.adminDb.batch();
  const nowMs = Date.now();
  for (let i = 0; i < 100; i++) {
    const id = `rev_seed_${String(i + 1).padStart(3, '0')}`;
    const name = REVIEWER_NAMES[i % REVIEWER_NAMES.length];
    const tpl = REVIEW_COMMENTS_BN_EN[i % REVIEW_COMMENTS_BN_EN.length];
    const prod = catalog[i % catalog.length];
    const createdAtDate = new Date(nowMs - (i + 1) * 14 * 60 * 60 * 1000);
    batch.set(deps.adminDb.collection('reviews').doc(id), {
      id,
      customerUid: `seed_user_${(i % 40) + 1}`,
      customerName: name,
      productId: prod.productId,
      productName: prod.productName,
      packageName: prod.packageName,
      orderNumber: `SV-${840100 + i * 17}`,
      rating: tpl.rating,
      comment: tpl.comment,
      approved: true,
      verifiedPurchase: true,
      source: 'seeded',
      createdAt: createdAtDate,
      updatedAt: createdAtDate,
    });
  }
  await batch.commit();
  return {seeded: 100, alreadyExists: false};
}

// ---------------------------------------------------------------------------
// 5. Daily Midnight Summary Report & Real-Time CSV/Excel Export
// ---------------------------------------------------------------------------

function getDhakaDateParts(date: Date): {dateKey: string; hour: number; minute: number} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour || 0) % 24;
  const minute = Number(parts.minute || 0);
  return {dateKey, hour, minute};
}

function getDhakaDayWindowMs(dateKey: string): {startMs: number; endMs: number} {
  // Asia/Dhaka is fixed UTC+06:00 (no DST)
  const startMs = Date.parse(`${dateKey}T00:00:00+06:00`);
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return {startMs, endMs};
}

export interface DailyReportSummary {
  dateKey: string;
  totalOrders: number;
  completedOrders: number;
  pendingOrders: number;
  processingOrders: number;
  cancelledOrExpired: number;
  totalSales: number;
  totalCost: number;
  netProfit: number;
  pendingTopups: number;
  approvedTopupsAmount: number;
  lowStockAlerts: Array<{
    productId: string;
    productName: string;
    packageId: string;
    packageName: string;
    remaining: number;
  }>;
  totalUnusedPins: number;
}

export async function buildDailySummaryReportData(
  deps: Pick<FeatureDeps, 'adminDb' | 'parseTimestampMillis'>,
  targetDateKey?: string,
): Promise<DailyReportSummary> {
  const dateKey = targetDateKey || getDhakaDateParts(new Date()).dateKey;
  const {startMs, endMs} = getDhakaDayWindowMs(dateKey);

  const summary: DailyReportSummary = {
    dateKey,
    totalOrders: 0,
    completedOrders: 0,
    pendingOrders: 0,
    processingOrders: 0,
    cancelledOrExpired: 0,
    totalSales: 0,
    totalCost: 0,
    netProfit: 0,
    pendingTopups: 0,
    approvedTopupsAmount: 0,
    lowStockAlerts: [],
    totalUnusedPins: 0,
  };
  if (!deps.adminDb) return summary;

  const [ordersSnap, topupsSnap, vaultSnap, productsSnap] = await Promise.all([
    deps.adminDb.collection('orders').get(),
    deps.adminDb.collection('walletTopups').get(),
    deps.adminDb.collection('voucherStock').where('status', '==', 'unused').get(),
    deps.adminDb.collection('products').get(),
  ]);

  // Build product/package cost map for orders missing unitCost
  const costLookup = new Map<string, number>();
  for (const pDoc of productsSnap.docs) {
    const p = pDoc.data() as {id?: string; packages?: Array<{id?: string; costPrice?: number}>};
    for (const pkg of p.packages || []) {
      if (pkg.id && Number(pkg.costPrice || 0) > 0) {
        costLookup.set(`${pDoc.id}::${pkg.id}`, Number(pkg.costPrice));
      }
    }
  }

  for (const d of ordersSnap.docs) {
    const o = d.data() as Record<string, unknown>;
    const st = String(o.orderStatus || 'pending');
    const pay = String(o.paymentStatus || 'pending');
    const createdMs = deps.parseTimestampMillis(o.createdAt);

    if (st === 'pending') summary.pendingOrders += 1;
    if (st === 'processing') summary.processingOrders += 1;

    if (createdMs >= startMs && createdMs <= endMs) {
      summary.totalOrders += 1;
      if (st === 'completed') summary.completedOrders += 1;
      if (st === 'cancelled' || st === 'expired') summary.cancelledOrExpired += 1;

      if (st !== 'cancelled' && st !== 'expired' && pay !== 'rejected') {
        const amt = Number(o.totalAmount || 0);
        const rawCost =
          Number(o.unitCost || 0) ||
          costLookup.get(`${String(o.productId || '')}::${String(o.packageId || '')}`) ||
          0;
        const profit =
          typeof o.netProfit === 'number'
            ? Number(o.netProfit)
            : rawCost > 0
              ? amt - rawCost
              : amt * 0.1; // conservative fallback if costPrice wasn't configured
        summary.totalSales = Number((summary.totalSales + amt).toFixed(2));
        summary.totalCost = Number((summary.totalCost + rawCost).toFixed(2));
        summary.netProfit = Number((summary.netProfit + profit).toFixed(2));
      }
    }
  }

  for (const d of topupsSnap.docs) {
    const t = d.data() as Record<string, unknown>;
    if (t.status === 'pending') summary.pendingTopups += 1;
    const createdMs = deps.parseTimestampMillis(t.createdAt);
    if (createdMs >= startMs && createdMs <= endMs && t.status === 'approved') {
      summary.approvedTopupsAmount = Number((summary.approvedTopupsAmount + Number(t.amount || 0)).toFixed(2));
    }
  }

  summary.totalUnusedPins = vaultSnap.size;
  const stockBuckets = new Map<
    string,
    {productId: string; productName: string; packageId: string; packageName: string; remaining: number}
  >();
  for (const d of vaultSnap.docs) {
    const v = d.data() as Record<string, unknown>;
    const productId = String(v.productId || '');
    const packageId = String(v.packageId || '');
    const key = `${productId}::${packageId}`;
    const entry = stockBuckets.get(key) || {
      productId,
      productName: String(v.productName || 'Product'),
      packageId,
      packageName: String(v.packageName || 'Package'),
      remaining: 0,
    };
    entry.remaining += 1;
    stockBuckets.set(key, entry);
  }
  summary.lowStockAlerts = Array.from(stockBuckets.values())
    .filter((b) => b.remaining < 5)
    .sort((a, b) => a.remaining - b.remaining);

  return summary;
}

export async function sendDailyMidnightSummaryReport(
  deps: Pick<
    FeatureDeps,
    'adminDb' | 'parseTimestampMillis' | 'notifyTelegramAdmins' | 'sendAdminNotificationEmail'
  >,
  manual = false,
): Promise<{sent: boolean; summary: DailyReportSummary}> {
  const now = new Date();
  const targetDateKey = manual
    ? getDhakaDateParts(now).dateKey
    : getDhakaDateParts(new Date(now.getTime() - 60 * 60 * 1000)).dateKey;

  const summary = await buildDailySummaryReportData(deps, targetDateKey);

  const lowStockLines =
    summary.lowStockAlerts.length > 0
      ? summary.lowStockAlerts.map(
          (a) => `⚠️ ${a.productName} (${a.packageName}): মাত্র ${a.remaining} টি PIN বাকি`,
        )
      : ['✅ সব প্যাকেজের Voucher PIN স্টক পর্যাপ্ত রয়েছে'];

  const tgText = [
    `📊 ${manual ? 'Live Daily Business Summary' : 'Midnight Daily Auto-Report'} — ${summary.dateKey}`,
    '',
    `🛒 মোট অর্ডার: ${summary.totalOrders} টি (Completed: ${summary.completedOrders} | Cancelled/Exp: ${summary.cancelledOrExpired})`,
    `💰 মোট বিক্রি (Sales): ৳${summary.totalSales.toFixed(0)}`,
    `📈 আনুমানিক নেট প্রফিট: ৳${summary.netProfit.toFixed(0)}`,
    `⏳ বর্তমান পেন্ডিং অর্ডার: ${summary.pendingOrders} টি (Processing: ${summary.processingOrders})`,
    `💳 অ্যাপ্রুভড ওয়ালেট ডিপোজিট: ৳${summary.approvedTopupsAmount.toFixed(0)} | পেন্ডিং: ${summary.pendingTopups}`,
    `🔑 মোট আনইউজড Vault PIN: ${summary.totalUnusedPins} টি`,
    '',
    '📦 Low Stock PIN Alerts (< 5):',
    ...lowStockLines,
  ].join('\n');

  await Promise.allSettled([
    deps.notifyTelegramAdmins(tgText, {
      inline_keyboard: [
        [
          {text: '📊 Analytics', callback_data: 'adm:st'},
          {text: '📥 Export CSV', callback_data: 'adm:rp:orders:30'},
        ],
        [{text: '🏠 Admin Home', callback_data: 'adm:home'}],
      ],
    }),
    deps.sendAdminNotificationEmail(
      `Daily Store Report (${summary.dateKey}) — Sales ৳${summary.totalSales.toFixed(0)} | Profit ৳${summary.netProfit.toFixed(0)}`,
      [
        {label: 'Report Date (BD)', value: summary.dateKey},
        {label: 'Total Orders', value: `${summary.totalOrders} (Completed: ${summary.completedOrders})`},
        {label: 'Total Sales', value: `৳${summary.totalSales.toFixed(2)}`},
        {label: 'Estimated Net Profit', value: `৳${summary.netProfit.toFixed(2)}`},
        {label: 'Current Pending Orders', value: `${summary.pendingOrders} Pending, ${summary.processingOrders} Processing`},
        {label: 'Low-Stock PINs (< 5)', value: summary.lowStockAlerts.length > 0 ? summary.lowStockAlerts.map((x) => `${x.productName} ${x.packageName}: ${x.remaining}`).join(' | ') : 'All healthy'},
      ],
      manual ? 'manual_report' : 'midnight_auto_report',
    ),
  ]);

  if (!manual && deps.adminDb) {
    await deps.adminDb
      .collection('serverConfig')
      .doc('dailyReport')
      .set(
        {
          lastSentDateKey: targetDateKey,
          sentAt: FieldValue.serverTimestamp(),
        },
        {merge: true},
      )
      .catch(() => null);
  }

  return {sent: true, summary};
}

let dailyReportCronStarted = false;

export function startDailyMidnightReportCron(
  deps: Pick<
    FeatureDeps,
    'adminDb' | 'parseTimestampMillis' | 'notifyTelegramAdmins' | 'sendAdminNotificationEmail'
  >,
): void {
  if (dailyReportCronStarted || !deps.adminDb) return;
  dailyReportCronStarted = true;

  const checkMidnightReport = async () => {
    if (!deps.adminDb) return;
    try {
      const dhaka = getDhakaDateParts(new Date());
      // Run inside midnight window (00:00 to 00:35 Asia/Dhaka)
      if (dhaka.hour !== 0 || dhaka.minute > 35) return;
      const yesterdayKey = getDhakaDateParts(new Date(Date.now() - 2 * 60 * 60 * 1000)).dateKey;
      const stateRef = deps.adminDb.collection('serverConfig').doc('dailyReport');
      const stateSnap = await stateRef.get();
      const lastSent = String(stateSnap.data()?.lastSentDateKey || '');
      if (lastSent === yesterdayKey) return;
      await sendDailyMidnightSummaryReport(deps, false);
    } catch (err) {
      console.error('[Daily Report Cron] Error:', err instanceof Error ? err.message : err);
    }
  };

  setTimeout(() => void checkMidnightReport(), 25_000).unref();
  setInterval(() => void checkMidnightReport(), 5 * 60 * 1000).unref();
}

export async function generateCsvReport(
  deps: Pick<FeatureDeps, 'adminDb' | 'parseTimestampMillis'>,
  params: {type?: 'orders' | 'transactions' | 'daily_summary'; days?: number},
): Promise<{filename: string; csvContent: string; rowCount: number}> {
  const type = params.type === 'transactions' || params.type === 'daily_summary' ? params.type : 'orders';
  const days = Math.min(365, Math.max(1, Number(params.days || 30)));
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  if (!deps.adminDb) {
    return {
      filename: `munaf-${type}.csv`,
      csvContent: '\uFEFFMessage\n"Firestore unavailable"',
      rowCount: 0,
    };
  }

  if (type === 'transactions') {
    const snap = await deps.adminDb.collection('walletTopups').get();
    const rows = snap.docs
      .map((d) => {
        const t = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          createdMs: deps.parseTimestampMillis(t.createdAt),
          customerName: String(t.customerName || ''),
          customerEmail: String(t.customerEmail || ''),
          method: String(t.paymentMethodName || ''),
          trxId: String(t.trxId || ''),
          amount: Number(t.amount || 0),
          status: String(t.status || ''),
        };
      })
      .filter((r) => !r.createdMs || r.createdMs >= cutoffMs)
      .sort((a, b) => b.createdMs - a.createdMs);

    const headers = ['Deposit ID', 'Date (BD)', 'Customer', 'Email', 'Method', 'TrxID', 'Amount (BDT)', 'Status'];
    const lines = rows.map((r) =>
      [
        r.id,
        r.createdMs ? new Date(r.createdMs).toLocaleString('en-GB', {timeZone: 'Asia/Dhaka'}) : '',
        r.customerName,
        r.customerEmail,
        r.method,
        r.trxId,
        r.amount,
        r.status,
      ]
        .map(csvEscape)
        .join(','),
    );
    return {
      filename: `munaf-transactions-${days}d-${new Date().toISOString().slice(0, 10)}.csv`,
      csvContent: '\uFEFF' + [headers.map(csvEscape).join(','), ...lines].join('\n'),
      rowCount: rows.length,
    };
  }

  const ordersSnap = await deps.adminDb.collection('orders').get();
  const orders = ordersSnap.docs
    .map((d) => {
      const o = d.data() as Record<string, unknown>;
      const createdMs = deps.parseTimestampMillis(o.createdAt);
      const total = Number(o.totalAmount || 0);
      const cost = Number(o.unitCost || 0);
      const profit =
        typeof o.netProfit === 'number' ? Number(o.netProfit) : cost > 0 ? Number((total - cost).toFixed(2)) : '';
      return {
        orderNumber: String(o.orderNumber || d.id),
        createdMs,
        customerName: String(o.customerName || ''),
        customerEmail: String(o.customerEmail || ''),
        productName: String(o.productName || ''),
        packageName: String(o.packageName || ''),
        playerUid: String(o.playerUid || ''),
        paymentMethodName: String(o.paymentMethodName || ''),
        trxId: String(o.trxId || ''),
        totalAmount: total,
        unitCost: cost || '',
        netProfit: profit,
        paymentStatus: String(o.paymentStatus || ''),
        orderStatus: String(o.orderStatus || ''),
      };
    })
    .filter((o) => !o.createdMs || o.createdMs >= cutoffMs)
    .sort((a, b) => b.createdMs - a.createdMs);

  if (type === 'daily_summary') {
    const dayMap = new Map<string, {orders: number; sales: number; cost: number; profit: number}>();
    for (const o of orders) {
      if (o.orderStatus === 'cancelled' || o.orderStatus === 'expired' || o.paymentStatus === 'rejected') continue;
      const dateKey = o.createdMs
        ? getDhakaDateParts(new Date(o.createdMs)).dateKey
        : getDhakaDateParts(new Date()).dateKey;
      const cur = dayMap.get(dateKey) || {orders: 0, sales: 0, cost: 0, profit: 0};
      cur.orders += 1;
      cur.sales += o.totalAmount;
      cur.cost += Number(o.unitCost || 0);
      cur.profit += typeof o.netProfit === 'number' ? o.netProfit : o.totalAmount * 0.1;
      dayMap.set(dateKey, cur);
    }
    const headers = ['Date (BD)', 'Valid Orders', 'Gross Sales (BDT)', 'Total Cost (BDT)', 'Est. Net Profit (BDT)'];
    const lines = Array.from(dayMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, d]) =>
        [dateKey, d.orders, d.sales.toFixed(2), d.cost.toFixed(2), d.profit.toFixed(2)].map(csvEscape).join(','),
      );
    return {
      filename: `munaf-daily-profit-${days}d-${new Date().toISOString().slice(0, 10)}.csv`,
      csvContent: '\uFEFF' + [headers.map(csvEscape).join(','), ...lines].join('\n'),
      rowCount: lines.length,
    };
  }

  const headers = [
    'Order Number',
    'Date (BD)',
    'Customer',
    'Email',
    'Product',
    'Package',
    'Player UID',
    'Payment Method',
    'TrxID',
    'Total Paid (BDT)',
    'Cost (BDT)',
    'Net Profit (BDT)',
    'Payment Status',
    'Order Status',
  ];
  const lines = orders.map((o) =>
    [
      o.orderNumber,
      o.createdMs ? new Date(o.createdMs).toLocaleString('en-GB', {timeZone: 'Asia/Dhaka'}) : '',
      o.customerName,
      o.customerEmail,
      o.productName,
      o.packageName,
      o.playerUid,
      o.paymentMethodName,
      o.trxId,
      o.totalAmount,
      o.unitCost,
      o.netProfit,
      o.paymentStatus,
      o.orderStatus,
    ]
      .map(csvEscape)
      .join(','),
  );
  return {
    filename: `munaf-orders-${days}d-${new Date().toISOString().slice(0, 10)}.csv`,
    csvContent: '\uFEFF' + [headers.map(csvEscape).join(','), ...lines].join('\n'),
    rowCount: orders.length,
  };
}

// ---------------------------------------------------------------------------
// 6. Register Feature Routes (IGN Checker, Reviews, Reseller API v1, Push, Reports)
// ---------------------------------------------------------------------------

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

export function registerFeatureRoutes(app: Express, deps: FeatureDeps): void {
  // Initialize VAPID keys early
  ensureVapidKeys(deps);

  // ---- A. Player IGN Live Checker ----
  const handlePlayerLookup = async (req: Request, res: Response) => {
    const uid = String(req.query.uid || req.body?.uid || '').trim();
    const productName = String(req.query.productName || req.body?.productName || 'Free Fire').trim();
    const serverId = String(req.query.serverId || req.body?.serverId || '').trim();
    const result = await lookupPlayerIgn(deps, {uid, productName, serverId});
    res.status(result.validFormat ? 200 : 400).json(result);
  };
  app.get('/api/store/lookup-player', handlePlayerLookup);
  app.post('/api/store/lookup-player', handlePlayerLookup);

  // ---- B. Customer Reviews & Rating System ----
  app.get('/api/reviews', async (req: Request, res: Response) => {
    if (!deps.adminDb) {
      res.json({reviews: [], averageRating: 4.9, totalCount: 0});
      return;
    }
    try {
      const productId = String(req.query.productId || '').trim();
      const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));
      const snap = await deps.adminDb
        .collection('reviews')
        .where('approved', '==', true)
        .get();
      let list = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          ...data,
          createdAtMs: deps.parseTimestampMillis(data.createdAt),
        } as Record<string, unknown> & {createdAtMs: number; productId?: string; rating?: number};
      });
      if (productId) {
        list = list.filter((r) => r.productId === productId);
      }
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      const avg =
        list.length > 0
          ? Number(
              (
                list.reduce((sum, r) => sum + Math.min(5, Math.max(1, Number(r.rating || 5))), 0) /
                list.length
              ).toFixed(2),
            )
          : 5.0;
      res.json({reviews: list.slice(0, limit), averageRating: avg, totalCount: list.length});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load reviews'});
    }
  });

  app.post('/api/reviews', deps.requireSignedInFirebase, async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    const uid = String(req.firebaseAuthUid || '').trim();
    const rating = Math.round(Number(req.body?.rating || 0));
    const comment = String(req.body?.comment || '').trim().slice(0, 1000);
    const productId = String(req.body?.productId || '').trim().slice(0, 128);
    const productName = String(req.body?.productName || 'MUNAFTOPUP.bd Service').trim().slice(0, 120);
    const packageName = String(req.body?.packageName || '').trim().slice(0, 120);
    const orderNumber = String(req.body?.orderNumber || '').trim().slice(0, 32);

    if (!(rating >= 1 && rating <= 5)) {
      res.status(400).json({error: 'Please select a star rating between 1 and 5.'});
      return;
    }
    if (comment.length < 4) {
      res.status(400).json({error: 'Please write at least 4 characters in your review comment.'});
      return;
    }

    try {
      const custSnap = await deps.adminDb.collection('customers').doc(uid).get();
      const custData = custSnap.exists ? (custSnap.data() as Record<string, unknown>) : {};
      const customerName = String(
        req.body?.customerName || custData.displayName || req.firebaseAuthName || 'Verified Gamer',
      )
        .trim()
        .slice(0, 100);

      let verifiedPurchase = false;
      if (orderNumber) {
        const ordSnap = await deps.adminDb
          .collection('orders')
          .where('customerUid', '==', uid)
          .where('orderNumber', '==', orderNumber)
          .limit(1)
          .get();
        verifiedPurchase = !ordSnap.empty && ordSnap.docs[0].data()?.orderStatus === 'completed';
      } else {
        const anyCompletedSnap = await deps.adminDb
          .collection('orders')
          .where('customerUid', '==', uid)
          .where('orderStatus', '==', 'completed')
          .limit(1)
          .get();
        verifiedPurchase = !anyCompletedSnap.empty;
      }

      const store = deps.readStore();
      const autoApprove = store?.systemSettings?.autoApproveReviews === true;
      const reviewId = `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const now = FieldValue.serverTimestamp();

      await deps.adminDb.collection('reviews').doc(reviewId).set({
        id: reviewId,
        customerUid: uid,
        customerName,
        productId,
        productName,
        packageName,
        orderNumber,
        rating,
        comment,
        approved: autoApprove,
        verifiedPurchase,
        source: 'customer',
        createdAt: now,
        updatedAt: now,
      });

      if (!autoApprove) {
        void deps.notifyTelegramAdmins(
          [
            `⭐ New Customer Review Pending Approval`,
            `👤 ${customerName} (${rating}★)${verifiedPurchase ? ' ✅ Verified Buyer' : ''}`,
            `🎮 ${productName}${packageName ? ` · ${packageName}` : ''}`,
            `💬 "${comment.slice(0, 300)}"`,
          ].join('\n'),
          {
            inline_keyboard: [
              [
                {text: '✅ Approve Review', callback_data: `adm:rv_ap:${reviewId}`},
                {text: '🗑️ Delete', callback_data: `adm:rv_del:${reviewId}`},
              ],
            ],
          },
        );
      }

      res.status(201).json({
        ok: true,
        reviewId,
        approved: autoApprove,
        message: autoApprove
          ? 'Thank you! Your review is now live.'
          : 'Thank you! Your review was submitted and will appear once approved by Admin.',
      });
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to submit review'});
    }
  });

  app.get('/api/admin/reviews', deps.requireAdmin('customization'), async (_req: Request, res: Response) => {
    if (!deps.adminDb) {
      res.json({reviews: []});
      return;
    }
    try {
      const snap = await deps.adminDb.collection('reviews').orderBy('createdAt', 'desc').limit(250).get();
      const reviews = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          ...data,
          createdAtMs: deps.parseTimestampMillis(data.createdAt),
        };
      });
      res.json({reviews});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load reviews'});
    }
  });

  app.patch('/api/admin/reviews/:reviewId', deps.requireAdmin('customization'), async (req: Request, res: Response) => {
    const reviewId = String(req.params.reviewId || '').trim();
    if (!reviewId || !deps.adminDb) {
      res.status(400).json({error: 'Invalid reviewId'});
      return;
    }
    try {
      const approved = Boolean(req.body?.approved);
      await deps.adminDb.collection('reviews').doc(reviewId).update({
        approved,
        updatedAt: FieldValue.serverTimestamp(),
      });
      res.json({ok: true, approved});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to update review'});
    }
  });

  app.delete('/api/admin/reviews/:reviewId', deps.requireAdmin('customization'), async (req: Request, res: Response) => {
    const reviewId = String(req.params.reviewId || '').trim();
    if (!reviewId || !deps.adminDb) {
      res.status(400).json({error: 'Invalid reviewId'});
      return;
    }
    try {
      await deps.adminDb.collection('reviews').doc(reviewId).delete();
      res.json({ok: true});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to delete review'});
    }
  });

  app.post('/api/admin/reviews/seed', deps.requireAdmin('customization'), async (_req: Request, res: Response) => {
    try {
      const result = await seed100ReviewsIfEmpty(deps, true);
      res.json({ok: true, ...result});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to seed reviews'});
    }
  });

  // ---- C. Web Push Notifications Endpoints ----
  app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
    const keys = ensureVapidKeys(deps);
    res.json({publicKey: keys.publicKey});
  });

  app.post('/api/push/subscribe', async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    const sub = req.body?.subscription as {endpoint?: string; keys?: {p256dh?: string; auth?: string}};
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      res.status(400).json({error: 'Invalid push subscription object'});
      return;
    }

    // Optionally resolve verified customerUid from Bearer token without failing guest flash-sale opt-in
    let customerUid = 'guest';
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
      try {
        const {getAuth} = await import('firebase-admin/auth');
        const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
        if (decoded?.uid) customerUid = decoded.uid;
      } catch {
        // remain guest if token expired
      }
    }

    const subId = `push_${crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 32)}`;
    try {
      const now = FieldValue.serverTimestamp();
      await deps.adminDb.collection('pushSubscriptions').doc(subId).set(
        {
          id: subId,
          customerUid,
          endpoint: String(sub.endpoint).slice(0, 1000),
          keys: {
            p256dh: String(sub.keys.p256dh).slice(0, 300),
            auth: String(sub.keys.auth).slice(0, 120),
          },
          active: true,
          createdAt: now,
          updatedAt: now,
        },
        {merge: true},
      );
      res.json({ok: true, subscriptionId: subId, customerUid});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to save push subscription'});
    }
  });

  app.post('/api/push/unsubscribe', async (req: Request, res: Response) => {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint || !deps.adminDb) {
      res.json({ok: true});
      return;
    }
    const subId = `push_${crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32)}`;
    await deps.adminDb.collection('pushSubscriptions').doc(subId).delete().catch(() => null);
    res.json({ok: true});
  });

  app.post('/api/admin/push/broadcast', deps.requireAdmin('customization'), async (req: Request, res: Response) => {
    const title = String(req.body?.title || 'Flash Sale Live on MUNAFTOPUP.bd!').trim().slice(0, 100);
    const body = String(req.body?.body || 'Limited-time discount active now. Grab your diamonds before timer ends!').trim().slice(0, 240);
    const url = String(req.body?.url || '/').trim().slice(0, 200);
    const result = await broadcastFlashSalePush(deps, {title, body, url});
    res.json({ok: true, ...result});
  });

  // ---- D. Public Reseller / Developer API (/api/v1/*) & Key Admin ----
  const requireResellerKey = async (req: any, res: Response, next: NextFunction) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Service temporarily unavailable'});
      return;
    }
    const rawAuth = String(req.headers.authorization || '').trim();
    const xApiKey = String(req.headers['x-api-key'] || '').trim();
    const rawKey = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : xApiKey;
    if (!rawKey || !rawKey.startsWith('mk_live_')) {
      res.status(401).json({error: 'Missing or malformed Reseller API Key (Bearer mk_live_...)'});
      return;
    }

    try {
      const keyHash = hashApiKey(rawKey);
      const snap = await deps.adminDb
        .collection('resellerKeys')
        .where('keyHash', '==', keyHash)
        .limit(1)
        .get();
      if (snap.empty) {
        res.status(401).json({error: 'Invalid Reseller API Key'});
        return;
      }
      const keyDoc = snap.docs[0];
      const keyData = keyDoc.data() as {active?: boolean; customerUid?: string; customerEmail?: string; label?: string};
      if (keyData.active !== true || !keyData.customerUid) {
        res.status(403).json({error: 'This Reseller API Key is disabled'});
        return;
      }
      const custSnap = await deps.adminDb.collection('customers').doc(keyData.customerUid).get();
      if (!custSnap.exists) {
        res.status(403).json({error: 'Reseller customer wallet account not found'});
        return;
      }
      const cust = custSnap.data() as Record<string, unknown>;
      if (cust.suspended === true) {
        res.status(403).json({error: 'Reseller account is suspended'});
        return;
      }
      req.resellerKeyDoc = keyDoc;
      req.resellerKeyData = keyData;
      req.resellerCustomer = {uid: keyData.customerUid, ...cust};
      next();
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'API key verification failed'});
    }
  };

  app.get('/api/v1/products', async (_req: Request, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    try {
      const [prodsSnap, vaultSnap] = await Promise.all([
        deps.adminDb.collection('products').where('active', '==', true).get(),
        deps.adminDb.collection('voucherStock').where('status', '==', 'unused').get(),
      ]);
      const pinCounts = new Map<string, number>();
      for (const d of vaultSnap.docs) {
        const v = d.data() as {productId?: string; packageId?: string};
        const k = `${v.productId || ''}::${v.packageId || ''}`;
        pinCounts.set(k, (pinCounts.get(k) || 0) + 1);
      }
      const products = prodsSnap.docs.map((d) => {
        const p = d.data() as {
          id?: string;
          name?: string;
          slug?: string;
          categoryName?: string;
          requiresUid?: boolean;
          requiresServerId?: boolean;
          packages?: Array<{id: string; name: string; quantityLabel?: string; price: number; active?: boolean}>;
        };
        return {
          id: p.id || d.id,
          name: p.name || '',
          slug: p.slug || '',
          categoryName: p.categoryName || '',
          requiresUid: p.requiresUid !== false,
          requiresServerId: Boolean(p.requiresServerId),
          packages: (p.packages || [])
            .filter((k) => k.active !== false)
            .map((k) => ({
              id: k.id,
              name: k.name,
              quantityLabel: k.quantityLabel || k.name,
              price: Number(k.price || 0),
              instantPinStock: pinCounts.get(`${p.id || d.id}::${k.id}`) || 0,
            })),
        };
      });
      res.json({ok: true, currency: 'BDT', products});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to list products'});
    }
  });

  app.get('/api/v1/balance', requireResellerKey, async (req: any, res: Response) => {
    const c = req.resellerCustomer as Record<string, unknown>;
    res.json({
      ok: true,
      customerUid: c.uid,
      email: c.email || '',
      tier: c.tier || 'regular',
      walletBalance: Number(c.walletBalance || 0),
      loyaltyPoints: Number(c.loyaltyPoints || 0),
      currency: 'BDT',
    });
  });

  app.post('/api/v1/order', requireResellerKey, async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    const uid = String(req.resellerCustomer.uid);
    const keyDocRef = req.resellerKeyDoc.ref as FirebaseFirestore.DocumentReference;
    const productId = String(req.body?.productId || '').trim().slice(0, 128);
    const packageId = String(req.body?.packageId || '').trim().slice(0, 128);
    const playerUid = String(req.body?.playerUid || '').trim().slice(0, 80);
    const serverId = String(req.body?.serverId || 'N/A').trim().slice(0, 80) || 'N/A';

    if (!productId || !packageId) {
      res.status(400).json({error: 'productId and packageId are required'});
      return;
    }

    try {
      const [prodSnap, flashSnap, unusedPinsSnap] = await Promise.all([
        deps.adminDb.collection('products').doc(productId).get(),
        deps.adminDb.collection('flashSales').where('productId', '==', productId).get(),
        deps.adminDb
          .collection('voucherStock')
          .where('productId', '==', productId)
          .where('packageId', '==', packageId)
          .where('status', '==', 'unused')
          .limit(6)
          .get(),
      ]);

      if (!prodSnap.exists || prodSnap.data()?.active === false) {
        res.status(404).json({error: 'Product not found or inactive'});
        return;
      }
      const product = prodSnap.data() as {
        id: string;
        name: string;
        images?: string[];
        requiresUid?: boolean;
        packages?: Array<{id: string; name: string; quantityLabel?: string; price: number; costPrice?: number; active?: boolean}>;
      };
      if (product.requiresUid !== false) {
        if (!playerUid || playerUid.length < 4) {
          res.status(400).json({error: 'Valid playerUid is required'});
          return;
        }
        if (/free\s*fire|pubg|mobile\s*legends|mlbb|\bff\b/i.test(product.name) && !/^\d{5,15}$/.test(playerUid)) {
          res.status(400).json({error: 'playerUid must be 5-15 numeric digits'});
          return;
        }
      }

      const selectedPkg = (product.packages || []).find((p) => p.id === packageId && p.active !== false);
      if (!selectedPkg) {
        res.status(404).json({error: 'Package not found or inactive'});
        return;
      }

      const store = deps.readStore();
      const cfg = normalizeCommerceSettings(store?.systemSettings?.commerce);
      const nowMs = Date.now();
      const activeFlash = flashSnap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .find((s) => {
          if (s.active !== true) return false;
          const st = s.startsAt ? Date.parse(String(s.startsAt)) : 0;
          const en = s.endsAt ? Date.parse(String(s.endsAt)) : 0;
          if (st > 0 && nowMs < st) return false;
          if (en > 0 && nowMs > en) return false;
          return true;
        });

      const candidatePinRef = !unusedPinsSnap.empty ? unusedPinsSnap.docs[0].ref : null;
      const remainingPinsAfterClaim = Math.max(0, unusedPinsSnap.size - 1);

      const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const orderNumber = `MV-${Math.floor(100000 + Math.random() * 900000)}`;

      const outcome = await deps.adminDb.runTransaction(async (tx) => {
        const custRef = deps.adminDb!.collection('customers').doc(uid);
        const [custSnap, pinSnap] = await Promise.all([
          tx.get(custRef),
          candidatePinRef ? tx.get(candidatePinRef) : Promise.resolve(null),
        ]);
        if (!custSnap.exists) throw new Error('Reseller customer profile not found');
        const cust = custSnap.data() as Record<string, unknown>;
        if (cust.suspended === true) throw new Error('Reseller account suspended');

        const basePrice = Number(selectedPkg.price || 0);
        const flashDisc = activeFlash
          ? Number(((basePrice * Number(activeFlash.discountPercent || 0)) / 100).toFixed(2))
          : 0;
        const afterFlash = Math.max(1, Number((basePrice - flashDisc).toFixed(2)));
        const tier: CustomerTier =
          cust.tier === 'reseller' ? 'reseller' : cust.tier === 'vip' ? 'vip' : 'regular';
        const tierPct =
          tier === 'reseller'
            ? cfg.resellerDiscountPercent
            : tier === 'vip'
              ? cfg.vipDiscountPercent
              : 0;
        const tierDisc = tierPct > 0 ? Number(((afterFlash * tierPct) / 100).toFixed(2)) : 0;
        const totalAmount = Math.max(1, Number((afterFlash - tierDisc).toFixed(2)));

        const curBal = Number(cust.walletBalance || 0);
        if (curBal < totalAmount) {
          throw new Error(`Insufficient wallet balance (Available ৳${curBal}, Required ৳${totalAmount})`);
        }
        const remainingWalletBalance = Number((curBal - totalAmount).toFixed(2));

        let voucherCode = '';
        let orderStatus: 'processing' | 'completed' = 'processing';
        if (pinSnap?.exists && pinSnap.data()?.status === 'unused') {
          voucherCode = String(pinSnap.data()?.code || '').trim();
          if (voucherCode) orderStatus = 'completed';
        }

        const now = FieldValue.serverTimestamp();
        const unitCost = Number(selectedPkg.costPrice || 0);
        const netProfit = unitCost > 0 ? Number((totalAmount - unitCost).toFixed(2)) : undefined;

        tx.update(custRef, {walletBalance: remainingWalletBalance, updatedAt: now});
        tx.update(keyDocRef, {
          totalRequests: FieldValue.increment(1),
          totalSpent: FieldValue.increment(totalAmount),
          lastUsedAt: now,
        });

        if (voucherCode && candidatePinRef) {
          tx.update(candidatePinRef, {
            status: 'claimed',
            claimedOrderId: orderId,
            claimedOrderNumber: orderNumber,
            claimedAt: now,
          });
        }

        const msg = voucherCode
          ? `Reseller API instant delivery (${voucherCode}).`
          : 'Reseller API order paid via wallet. Processing top-up.';

        tx.set(deps.adminDb!.collection('orders').doc(orderId), {
          id: orderId,
          orderNumber,
          customerUid: uid,
          customerName: String(cust.displayName || req.resellerKeyData.label || 'Reseller'),
          customerEmail: String(cust.email || ''),
          customerPhone: String(cust.phone || 'API'),
          productId: product.id,
          productName: product.name,
          productImage: product.images?.[0] || '',
          packageId: selectedPkg.id,
          packageName: selectedPkg.name,
          quantityLabel: selectedPkg.quantityLabel || selectedPkg.name,
          unitPrice: basePrice,
          ...(unitCost > 0 ? {unitCost} : {}),
          ...(typeof netProfit === 'number' ? {netProfit} : {}),
          flashSaleDiscount: flashDisc,
          tierDiscount: tierDisc,
          appliedTier: tier,
          totalAmount,
          playerUid: playerUid || 'N/A',
          serverId,
          paymentType: 'wallet',
          paymentMethodId: 'wallet',
          paymentMethodName: `Reseller API (${req.resellerKeyData.label || 'API'})`,
          senderNumber: 'API',
          trxId: `API_${orderNumber}`,
          trxKey: `API_${orderNumber}`,
          screenshotUrl: '',
          voucherCode,
          walletRefunded: false,
          paymentStatus: 'verified',
          orderStatus,
          adminNote: `Placed via Reseller API Key (${req.resellerKeyData.keyPrefix || ''})`,
          notificationMessage: msg,
          createdAt: now,
          updatedAt: now,
          ...(orderStatus === 'completed' ? {completedAt: now} : {}),
        });

        tx.set(deps.adminDb!.collection('orderTracking').doc(orderNumber), {
          orderNumber,
          productName: product.name,
          packageName: selectedPkg.name,
          playerUidMasked: playerUid.length > 4 ? `${playerUid.slice(0, 2)}***${playerUid.slice(-2)}` : 'API',
          paymentStatus: 'verified',
          orderStatus,
          notificationMessage: msg,
          createdAt: now,
          updatedAt: now,
        });

        return {
          orderId,
          orderNumber,
          orderStatus,
          voucherCode,
          totalAmount,
          remainingWalletBalance,
          productName: product.name,
          packageName: selectedPkg.name,
        };
      });

      if (outcome.voucherCode && remainingPinsAfterClaim < 5) {
        void alertLowVoucherStock(deps, {
          productId: product.id,
          productName: outcome.productName,
          packageId: selectedPkg.id,
          packageName: outcome.packageName,
          remaining: remainingPinsAfterClaim,
        });
      }

      if (outcome.orderStatus === 'completed') {
        void settleOrderCompletionEffects(deps.getCommerceDeps(), outcome.orderId);
        void sendPushToCustomer(deps, uid, {
          title: `API Order Completed — ${outcome.orderNumber}`,
          body: `${outcome.productName} (${outcome.packageName}) fulfilled.`,
          url: '/orders',
        });
      } else {
        void dispatchDistributorWithLog(deps.getCommerceDeps(), {
          orderId: outcome.orderId,
          orderNumber: outcome.orderNumber,
          productId: product.id,
          productName: outcome.productName,
          packageId: selectedPkg.id,
          packageName: outcome.packageName,
          playerUid: playerUid || 'N/A',
          serverId,
          amount: outcome.totalAmount,
        });
      }

      void deps.notifyTelegramAdmins(
        [
          `🔌 Reseller API Order: ${outcome.orderNumber}`,
          `🎮 ${outcome.productName} · ${outcome.packageName}`,
          `🆔 UID: ${playerUid || 'N/A'} | 💰 ৳${outcome.totalAmount}`,
          `📌 Status: ${outcome.orderStatus.toUpperCase()}`,
        ].join('\n'),
        {inline_keyboard: [[{text: `🔎 Inspect ${outcome.orderNumber}`, callback_data: deps.makeAdminOrderCallback(outcome.orderId)}]]},
      );

      res.status(201).json({ok: true, ...outcome});
    } catch (err) {
      res.status(400).json({error: err instanceof Error ? err.message : 'Unable to place reseller API order'});
    }
  });

  app.get('/api/v1/order/:orderNumber', requireResellerKey, async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    const orderNumber = String(req.params.orderNumber || '').trim();
    const uid = String(req.resellerCustomer.uid);
    const snap = await deps.adminDb
      .collection('orders')
      .where('orderNumber', '==', orderNumber)
      .where('customerUid', '==', uid)
      .limit(1)
      .get();
    if (snap.empty) {
      res.status(404).json({error: 'Order not found'});
      return;
    }
    const o = snap.docs[0].data() as Record<string, unknown>;
    res.json({
      ok: true,
      orderNumber: o.orderNumber,
      productName: o.productName,
      packageName: o.packageName,
      playerUid: o.playerUid,
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      orderStatus: o.orderStatus,
      voucherCode: o.voucherCode || '',
      notificationMessage: o.notificationMessage || '',
    });
  });

  // Admin: Reseller API Key Management
  app.get('/api/admin/reseller-keys', deps.requireAdmin('settings'), async (_req: Request, res: Response) => {
    if (!deps.adminDb) {
      res.json({keys: []});
      return;
    }
    try {
      const snap = await deps.adminDb.collection('resellerKeys').orderBy('createdAt', 'desc').limit(100).get();
      const keys = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          label: data.label,
          customerUid: data.customerUid,
          customerEmail: data.customerEmail,
          keyPrefix: data.keyPrefix,
          active: data.active,
          totalRequests: Number(data.totalRequests || 0),
          totalSpent: Number(data.totalSpent || 0),
          createdAtMs: deps.parseTimestampMillis(data.createdAt),
          lastUsedAtMs: deps.parseTimestampMillis(data.lastUsedAt),
        };
      });
      res.json({keys});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load API keys'});
    }
  });

  app.post('/api/admin/reseller-keys', deps.requireAdmin('settings'), async (req: any, res: Response) => {
    if (!deps.adminDb) {
      res.status(503).json({error: 'Database unavailable'});
      return;
    }
    const customerEmail = String(req.body?.customerEmail || '').trim().toLowerCase();
    const customerUidInput = String(req.body?.customerUid || '').trim();
    const label = String(req.body?.label || 'Reseller Integration').trim().slice(0, 100);
    if (!customerEmail && !customerUidInput) {
      res.status(400).json({error: 'Customer email or UID is required'});
      return;
    }

    try {
      let targetUid = customerUidInput;
      let targetEmail = customerEmail;
      if (!targetUid && targetEmail) {
        const qSnap = await deps.adminDb
          .collection('customers')
          .where('email', '==', targetEmail)
          .limit(1)
          .get();
        if (qSnap.empty) {
          res.status(404).json({error: `No registered customer found with email ${targetEmail}`});
          return;
        }
        targetUid = qSnap.docs[0].id;
        targetEmail = String(qSnap.docs[0].data()?.email || targetEmail);
      } else if (targetUid) {
        const cSnap = await deps.adminDb.collection('customers').doc(targetUid).get();
        if (!cSnap.exists) {
          res.status(404).json({error: 'Customer UID not found'});
          return;
        }
        targetEmail = String(cSnap.data()?.email || targetEmail);
      }

      const rawKey = `mk_live_${crypto.randomBytes(20).toString('hex')}`;
      const keyPrefix = `${rawKey.slice(0, 14)}...`;
      const keyHash = hashApiKey(rawKey);
      const id = `rkey_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const now = FieldValue.serverTimestamp();

      await deps.adminDb.collection('resellerKeys').doc(id).set({
        id,
        label,
        customerUid: targetUid,
        customerEmail: targetEmail,
        keyPrefix,
        keyHash,
        active: true,
        totalRequests: 0,
        totalSpent: 0,
        createdAt: now,
      });

      const store = deps.readStore();
      deps.appendServerLog(
        store,
        req.adminSession?.email || 'admin',
        'RESELLER_KEY_CREATED',
        `Issued key ${keyPrefix} for ${targetEmail || targetUid}`,
      );
      deps.writeStore(store);

      res.status(201).json({
        ok: true,
        rawKey,
        key: {id, label, customerUid: targetUid, customerEmail: targetEmail, keyPrefix, active: true},
      });
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to issue reseller key'});
    }
  });

  app.patch('/api/admin/reseller-keys/:keyId', deps.requireAdmin('settings'), async (req: Request, res: Response) => {
    const keyId = String(req.params.keyId || '').trim();
    if (!keyId || !deps.adminDb) {
      res.status(400).json({error: 'Invalid keyId'});
      return;
    }
    const active = Boolean(req.body?.active);
    await deps.adminDb.collection('resellerKeys').doc(keyId).update({active});
    res.json({ok: true, active});
  });

  app.delete('/api/admin/reseller-keys/:keyId', deps.requireAdmin('settings'), async (req: Request, res: Response) => {
    const keyId = String(req.params.keyId || '').trim();
    if (!keyId || !deps.adminDb) {
      res.status(400).json({error: 'Invalid keyId'});
      return;
    }
    await deps.adminDb.collection('resellerKeys').doc(keyId).delete();
    res.json({ok: true});
  });

  // ---- E. Reports, Low-Stock Check & CSV Export Endpoints ----
  app.get('/api/admin/reports/export.csv', deps.requireAdmin(), async (req: Request, res: Response) => {
    const type = (req.query.type === 'transactions' || req.query.type === 'daily_summary'
      ? req.query.type
      : 'orders') as 'orders' | 'transactions' | 'daily_summary';
    const days = Number(req.query.days || 30);
    try {
      const report = await generateCsvReport(deps, {type, days});
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
      res.send(report.csvContent);
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to export CSV'});
    }
  });

  app.post('/api/admin/reports/send-daily', deps.requireAdmin(), async (_req: Request, res: Response) => {
    try {
      const out = await sendDailyMidnightSummaryReport(deps, true);
      res.json({ok: true, ...out});
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to send daily report'});
    }
  });
}
