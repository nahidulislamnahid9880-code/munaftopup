import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  KeyRound,
  Loader2,
  PackageCheck,
  RefreshCw,
  Send,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import {collection, onSnapshot, orderBy, query} from 'firebase/firestore';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import {initializeDefaultCatalogIfMissing, syncRecommendedCatalog} from '../../lib/seedData';
import type {CustomerProfile, Order} from '../../types';
import {AdminLayout} from '../../components/admin/AdminLayout';

interface TelegramOrders24hData {
  ok: boolean;
  connected: boolean;
  count: number;
  completedCount: number;
  pendingCount: number;
  processingCount: number;
  cancelledOrExpiredCount: number;
  totalRevenue: number;
  botRunning: boolean;
  botUsername: string;
  recentOrders?: Array<{
    orderNumber: string;
    packageName: string;
    totalAmount: number;
    orderStatus: string;
  }>;
  windowHours: number;
  fetchedAt: string;
  reason?: string;
  error?: string;
}

interface VoucherStockRow {
  id: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  status: 'unused' | 'claimed';
}

export function DashboardOverview() {
  const {adminUser, firebaseUser, adminFetch} = useAuth();
  const {catalogInitialized} = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const [tg24h, setTg24h] = useState<TelegramOrders24hData | null>(null);
  const [tg24hLoading, setTg24hLoading] = useState(true);
  const [tg24hError, setTg24hError] = useState('');

  const [chartDays, setChartDays] = useState<7 | 14 | 30>(14);
  const [vaultItems, setVaultItems] = useState<VoucherStockRow[]>([]);
  const [exportingType, setExportingType] = useState<string>('');
  const [sendingDailyReport, setSendingDailyReport] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<{ok: boolean; text: string} | null>(null);

  const canReadOrders = Boolean(firebaseUser && adminUser);
  const canReadVault = Boolean(
    adminUser &&
      (adminUser.role === 'super_admin' ||
        adminUser.permissions.products ||
        adminUser.permissions.orders),
  );

  const fetchTelegramOrders24h = useCallback(async () => {
    if (!adminUser) {
      setTg24hLoading(false);
      return;
    }
    setTg24hLoading(true);
    setTg24hError('');

    const runQuery = async (): Promise<Response> => {
      try {
        return await adminFetch('/api/admin/telegram-orders-24h');
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        return adminFetch('/api/admin/telegram-orders-24h');
      }
    };

    try {
      const res = await runQuery();
      const rawText = await res.text();
      let data: TelegramOrders24hData | null = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText) as TelegramOrders24hData;
        } catch {
          data = null;
        }
      }
      if (!res.ok || !data?.ok) {
        setTg24hError(
          data?.error ||
            data?.reason ||
            `Server returned HTTP ${res.status} while querying Firebase Admin SDK.`,
        );
        setTg24h(null);
      } else {
        setTg24h(data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setTg24hError(
        msg
          ? `Unable to reach server (${msg}). Please wait a moment and click Refresh.`
          : 'Unable to reach server while querying Firebase Admin SDK. Please click Refresh.',
      );
    } finally {
      setTg24hLoading(false);
    }
  }, [adminFetch, adminUser]);

  useEffect(() => {
    void fetchTelegramOrders24h();
  }, [fetchTelegramOrders24h]);

  useEffect(() => {
    if (!canReadVault) return;
    let active = true;
    adminFetch('/api/admin/voucher-stock')
      .then(async (res) => {
        if (!res.ok || !active) return;
        const data = (await res.json()) as {items?: VoucherStockRow[]};
        if (active) setVaultItems(data.items || []);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [adminFetch, canReadVault]);

  useEffect(() => {
    if (!canReadOrders) {
      setLoadingData(false);
      return;
    }

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      (snap) => {
        setOrders(snap.docs.map((d) => d.data() as Order));
        setLoadingData(false);
      },
      (err) => {
        setLoadingData(false);
        handleFirestoreError(err, OperationType.LIST, 'orders');
      },
    );

    const unsubCustomers = onSnapshot(
      collection(db, 'customers'),
      (snap) => {
        setCustomers(snap.docs.map((d) => d.data() as CustomerProfile));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers'),
    );

    return () => {
      unsubOrders();
      unsubCustomers();
    };
  }, [canReadOrders]);

  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    let totalRevenue = 0;
    let totalProfit = 0;
    let costTrackedRevenue = 0;
    let todaySales = 0;
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let cancelled = 0;
    let fraudCount = 0;

    for (const o of orders) {
      if (o.fraudFlag && o.orderStatus !== 'cancelled' && o.orderStatus !== 'expired') {
        fraudCount += 1;
      }
      if (o.orderStatus === 'pending') pending += 1;
      if (o.orderStatus === 'processing') processing += 1;
      if (o.orderStatus === 'completed') completed += 1;
      if (o.orderStatus === 'cancelled' || o.orderStatus === 'expired') cancelled += 1;

      if (o.orderStatus !== 'cancelled' && o.orderStatus !== 'expired' && o.paymentStatus !== 'rejected') {
        const amt = Number(o.totalAmount || 0);
        totalRevenue += amt;
        const unitCost = Number(o.unitCost || 0);
        if (typeof o.netProfit === 'number' && unitCost > 0) {
          totalProfit += o.netProfit;
          costTrackedRevenue += amt;
        } else if (unitCost > 0) {
          totalProfit += amt - unitCost;
          costTrackedRevenue += amt;
        }
        if (timestampToMillis(o.createdAt) >= todayMs) {
          todaySales += amt;
        }
      }
    }

    const profitMarginPct =
      costTrackedRevenue > 0 ? Math.round((totalProfit / costTrackedRevenue) * 1000) / 10 : 0;

    return {
      totalRevenue,
      totalProfit,
      profitMarginPct,
      todaySales,
      totalOrders: orders.length,
      pending,
      processing,
      completed,
      cancelled,
      fraudCount,
      totalCustomers: customers.length,
    };
  }, [orders, customers]);

  const lowStockPins = useMemo(() => {
    const map = new Map<
      string,
      {productId: string; productName: string; packageId: string; packageName: string; remaining: number}
    >();
    for (const item of vaultItems) {
      if (item.status !== 'unused') continue;
      const key = `${item.productId}::${item.packageId}`;
      const cur = map.get(key) || {
        productId: item.productId,
        productName: item.productName,
        packageId: item.packageId,
        packageName: item.packageName,
        remaining: 0,
      };
      cur.remaining += 1;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .filter((entry) => entry.remaining < 5)
      .sort((a, b) => a.remaining - b.remaining);
  }, [vaultItems]);

  const chartData = useMemo(() => {
    const days: Array<{dateKey: string; label: string; revenue: number; profit: number; orders: number}> = [];
    for (let i = chartDays - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      days.push({
        dateKey,
        label: d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'}),
        revenue: 0,
        profit: 0,
        orders: 0,
      });
    }

    const map = new Map(days.map((item) => [item.dateKey, item]));
    for (const o of orders) {
      if (o.orderStatus === 'cancelled' || o.orderStatus === 'expired' || o.paymentStatus === 'rejected') continue;
      const ms = timestampToMillis(o.createdAt);
      if (!ms) continue;
      const key = new Date(ms).toISOString().slice(0, 10);
      const bucket = map.get(key);
      if (bucket) {
        const amt = Number(o.totalAmount || 0);
        const unitCost = Number(o.unitCost || 0);
        bucket.revenue += amt;
        if (typeof o.netProfit === 'number' && unitCost > 0) {
          bucket.profit += Math.max(0, o.netProfit);
        } else if (unitCost > 0) {
          bucket.profit += Math.max(0, amt - unitCost);
        }
        bucket.orders += 1;
      }
    }
    return days;
  }, [orders, chartDays]);

  const chartWindowTotals = useMemo(
    () =>
      chartData.reduce(
        (acc, day) => ({
          revenue: acc.revenue + day.revenue,
          profit: acc.profit + day.profit,
          orders: acc.orders + day.orders,
        }),
        {revenue: 0, profit: 0, orders: 0},
      ),
    [chartData],
  );

  const handleExportCsv = async (type: 'orders' | 'transactions' | 'daily_summary') => {
    setExportingType(type);
    setReportFeedback(null);
    try {
      const res = await adminFetch(`/api/admin/reports/export.csv?type=${type}&days=${chartDays}`);
      if (!res.ok) {
        setReportFeedback({ok: false, text: `Export failed (HTTP ${res.status}).`});
        return;
      }
      const disposition = res.headers.get('content-disposition') || '';
      const nameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = nameMatch?.[1] || `munaf-${type}-${chartDays}d.csv`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setReportFeedback({ok: true, text: `Downloaded ${filename}`});
    } catch {
      setReportFeedback({ok: false, text: 'Network error downloading CSV report.'});
    } finally {
      setExportingType('');
    }
  };

  const handleSendDailyReportNow = async () => {
    setSendingDailyReport(true);
    setReportFeedback(null);
    try {
      const res = await adminFetch('/api/admin/reports/send-daily', {method: 'POST'});
      const data = (await res.json().catch(() => ({}))) as {ok?: boolean; error?: string};
      if (!res.ok || !data.ok) {
        setReportFeedback({ok: false, text: data.error || 'Failed to send daily summary.'});
        return;
      }
      setReportFeedback({
        ok: true,
        text: 'Daily business summary sent to Telegram Admins & notification email.',
      });
    } catch {
      setReportFeedback({ok: false, text: 'Network error sending daily summary.'});
    } finally {
      setSendingDailyReport(false);
    }
  };

  const handleSeedCatalog = async () => {
    if (!adminUser) return;
    setSeeding(true);
    try {
      await initializeDefaultCatalogIfMissing(adminUser.email);
    } finally {
      setSeeding(false);
    }
  };

  const handleSyncCatalog = async () => {
    if (!adminUser) return;
    setSeeding(true);
    try {
      await syncRecommendedCatalog(adminUser.email);
    } finally {
      setSeeding(false);
    }
  };

  const kpis = [
    {label: 'Total Revenue', value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: 'text-emerald-600 dark:text-emerald-400'},
    {
      label: stats.profitMarginPct ? `Est. Profit (${stats.profitMarginPct}%)` : 'Est. Net Profit',
      value: stats.totalProfit > 0 ? formatCurrency(stats.totalProfit) : 'Set Cost Price',
      icon: BarChart3,
      color: 'text-cyan-600 dark:text-cyan-400',
    },
    {label: "Today's Sales", value: formatCurrency(stats.todaySales), icon: TrendingUp, color: 'text-blue-600 dark:text-blue-400'},
    {label: 'Total Orders', value: stats.totalOrders.toLocaleString(), icon: ShoppingBag, color: 'text-slate-700 dark:text-slate-300'},
    {label: 'Pending Orders', value: stats.pending.toLocaleString(), icon: Clock, color: 'text-amber-600 dark:text-amber-400'},
    {label: 'Processing Orders', value: stats.processing.toLocaleString(), icon: PackageCheck, color: 'text-blue-600 dark:text-blue-400'},
    {label: 'Completed Orders', value: stats.completed.toLocaleString(), icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400'},
    {label: 'Total Customers', value: stats.totalCustomers.toLocaleString(), icon: Users, color: 'text-slate-700 dark:text-slate-300'},
  ];

  return (
    <AdminLayout title="Dashboard Overview">
      <div className="space-y-6">
        {firebaseUser && (
          !catalogInitialized ? (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Initialize Default Storefront Catalog
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Populate initial Free Fire BD Server, Membership, Level Up Pass BD, Weekly Lite, Voucher, and PUBG UC categories/products in Firestore.
                </p>
              </div>
              <button
                type="button"
                disabled={seeding}
                onClick={() => void handleSeedCatalog()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50">
                {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {seeding ? 'Initializing...' : 'Initialize Catalog'}
              </button>
            </div>
          ) : adminUser?.role === 'super_admin' ? (
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Sync recommended Free Fire &amp; PUBG 3-column storefront products and square assets anytime.
              </p>
              <button
                type="button"
                disabled={seeding}
                onClick={() => void handleSyncCatalog()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50">
                {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-blue-600" />}
                {seeding ? 'Syncing...' : 'Sync Default Catalog'}
              </button>
            </div>
          ) : null
        )}

        {/* Fraud Alert Banner */}
        {stats.fraudCount > 0 && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-rose-800 dark:text-rose-200 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>
                {stats.fraudCount} active order(s) flagged by Fraud &amp; Velocity Guard for manual review.
              </span>
            </div>
            <Link
              to="/admin/orders?filter=fraud"
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold">
              Review Flagged Orders
            </Link>
          </div>
        )}

        {/* Low Voucher PIN Stock Alert Banner (< 5 PINs) */}
        {lowStockPins.length > 0 && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
                <KeyRound className="w-4 h-4 shrink-0 text-amber-600" />
                <span>
                  Low Voucher PIN Stock Alert ({lowStockPins.length} package(s) below 5 PINs):
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pl-6">
                {lowStockPins.map((entry) => (
                  <span
                    key={`${entry.productId}::${entry.packageId}`}
                    className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 text-[11px] font-semibold tabular-nums">
                    {entry.productName} · {entry.packageName}: {entry.remaining} left
                  </span>
                ))}
              </div>
            </div>
            <Link
              to="/admin/promotions?tab=vault"
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold whitespace-nowrap">
              Restock PIN Vault
            </Link>
          </div>
        )}

        {/* 8 KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {kpi.label}
                  </span>
                  <Icon className={`w-4 h-4 ${kpi.color}`} />
                </div>
                <p className="text-2xl font-bold font-display tabular-nums text-slate-900 dark:text-white">
                  {loadingData ? '—' : kpi.value}
                </p>
              </div>
            );
          })}
        </div>

        {/* Telegram Bot 24h Orders Widget (Firebase Admin SDK) */}
        <section
          aria-label="Telegram Bot Orders Last 24 Hours"
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-950/50 border border-sky-200/80 dark:border-sky-900/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                <Send className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold font-display text-slate-900 dark:text-white">
                  Telegram Bot Orders (Last 24 Hours)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live count queried via Firebase Admin SDK
                  {tg24h?.botUsername ? ` · @${tg24h.botUsername}` : ''}
                  {' · '}
                  {tg24h?.botRunning ? 'Bot Active' : 'Bot Standby'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchTelegramOrders24h()}
              disabled={tg24hLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${tg24hLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {tg24hLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            </div>
          ) : tg24hError ? (
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">{tg24hError}</p>
          ) : !tg24h?.connected ? (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {tg24h?.reason || 'Firebase Admin SDK is not connected on the server.'}
            </p>
          ) : (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-baseline gap-6 pt-2">
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block">
                    Total Telegram Orders (24h)
                  </span>
                  <span className="text-3xl font-bold font-display tabular-nums text-slate-900 dark:text-white">
                    {tg24h.count.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block">
                    24h Telegram Revenue
                  </span>
                  <span className="text-xl font-bold font-display tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(tg24h.totalRevenue)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 pt-2">
                <span className="tabular-nums">
                  Completed: <strong className="text-emerald-600 dark:text-emerald-400">{tg24h.completedCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Processing: <strong className="text-blue-600 dark:text-blue-400">{tg24h.processingCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Pending: <strong className="text-amber-600 dark:text-amber-400">{tg24h.pendingCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Cancelled / Expired: <strong className="text-slate-700 dark:text-slate-200">{tg24h.cancelledOrExpiredCount}</strong>
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Reporting & CSV Export Bar */}
        <section
          aria-label="Reports and CSV Exports"
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold font-display text-slate-900 dark:text-white">
                Real-Time Reports &amp; Telegram Summary
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Download UTF-8 Excel-ready CSV reports ({chartDays}d window) or push today&apos;s midnight summary immediately.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={Boolean(exportingType)}
                onClick={() => void handleExportCsv('orders')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50">
                {exportingType === 'orders' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                )}
                Orders CSV
              </button>
              <button
                type="button"
                disabled={Boolean(exportingType)}
                onClick={() => void handleExportCsv('transactions')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50">
                {exportingType === 'transactions' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                )}
                Deposits CSV
              </button>
              <button
                type="button"
                disabled={Boolean(exportingType)}
                onClick={() => void handleExportCsv('daily_summary')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50">
                {exportingType === 'daily_summary' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-cyan-600" />
                )}
                Daily Profit CSV
              </button>
              <button
                type="button"
                disabled={sendingDailyReport}
                onClick={() => void handleSendDailyReportNow()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                {sendingDailyReport ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send Daily Report Now
              </button>
            </div>
          </div>
          {reportFeedback && (
            <p
              className={`text-xs font-medium ${
                reportFeedback.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}>
              {reportFeedback.text}
            </p>
          )}
        </section>

        {/* Sales & Profit Analytics Chart */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 dark:text-white">
                Revenue &amp; Profit Analytics (Last {chartDays} Days)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Window Sales: <strong className="text-slate-800 dark:text-slate-200">{formatCurrency(chartWindowTotals.revenue)}</strong>
                {' · '}Est. Profit: <strong className="text-emerald-600 dark:text-emerald-400">{formatCurrency(chartWindowTotals.profit)}</strong>
                {' · '}Orders: <strong className="text-slate-800 dark:text-slate-200">{chartWindowTotals.orders}</strong>
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {([7, 14, 30] as const).map((daysOpt) => (
                <button
                  key={daysOpt}
                  type="button"
                  onClick={() => setChartDays(daysOpt)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer tabular-nums ${
                    chartDays === daysOpt
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  {daysOpt}D
                </button>
              ))}
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{top: 10, right: 10, left: 0, bottom: 0}}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" tick={{fontSize: 11}} stroke="#94a3b8" />
                <YAxis tick={{fontSize: 11}} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#1e293b',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue (৳)"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#revFill)"
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  name="Est. Profit (৳)"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#profitFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Orders Table */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-bold font-display">Recent Orders</h2>
            <Link
              to="/admin/orders"
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
              Manage All Orders
            </Link>
          </div>
          {orders.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No orders recorded yet. Customer orders placed at checkout will appear here in real time.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order ID</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Product / Pack</th>
                    <th className="px-4 py-3 font-medium">UID</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Payment</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {orders.slice(0, 8).map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono font-semibold tabular-nums">
                        {o.orderNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.customerName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{o.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.productName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{o.packageName}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{o.playerUid}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {formatCurrency(o.totalAmount)}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold capitalize">
                        {o.paymentStatus}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold capitalize">
                        {o.orderStatus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
