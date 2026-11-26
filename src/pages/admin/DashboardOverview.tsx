import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  PackageCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
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

export function DashboardOverview() {
  const {adminUser, firebaseUser} = useAuth();
  const {catalogInitialized} = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const canReadOrders = Boolean(firebaseUser && adminUser);

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
    let todaySales = 0;
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let cancelled = 0;

    for (const o of orders) {
      if (o.orderStatus === 'pending') pending += 1;
      if (o.orderStatus === 'processing') processing += 1;
      if (o.orderStatus === 'completed') completed += 1;
      if (o.orderStatus === 'cancelled' || o.orderStatus === 'expired') cancelled += 1;

      if (o.orderStatus !== 'cancelled' && o.orderStatus !== 'expired' && o.paymentStatus !== 'rejected') {
        totalRevenue += Number(o.totalAmount || 0);
        if (timestampToMillis(o.createdAt) >= todayMs) {
          todaySales += Number(o.totalAmount || 0);
        }
      }
    }

    return {
      totalRevenue,
      todaySales,
      totalOrders: orders.length,
      pending,
      processing,
      completed,
      cancelled,
      totalCustomers: customers.length,
    };
  }, [orders, customers]);

  const chartData = useMemo(() => {
    const days: Array<{dateKey: string; label: string; revenue: number; orders: number}> = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      days.push({
        dateKey,
        label: d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'}),
        revenue: 0,
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
        bucket.revenue += Number(o.totalAmount || 0);
        bucket.orders += 1;
      }
    }
    return days;
  }, [orders]);

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
    {label: "Today's Sales", value: formatCurrency(stats.todaySales), icon: TrendingUp, color: 'text-blue-600 dark:text-blue-400'},
    {label: 'Total Orders', value: stats.totalOrders.toLocaleString(), icon: ShoppingBag, color: 'text-slate-700 dark:text-slate-300'},
    {label: 'Pending Orders', value: stats.pending.toLocaleString(), icon: Clock, color: 'text-amber-600 dark:text-amber-400'},
    {label: 'Processing Orders', value: stats.processing.toLocaleString(), icon: PackageCheck, color: 'text-blue-600 dark:text-blue-400'},
    {label: 'Completed Orders', value: stats.completed.toLocaleString(), icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400'},
    {label: 'Cancelled Orders', value: stats.cancelled.toLocaleString(), icon: XCircle, color: 'text-red-600 dark:text-red-400'},
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

        {/* Sales Analytics Chart */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 dark:text-white">
                Sales Analytics (Last 14 Days)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Daily verified and pending non-cancelled revenue
              </p>
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
