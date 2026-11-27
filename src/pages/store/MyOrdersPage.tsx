import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Search,
  User,
  X,
  XCircle,
} from 'lucide-react';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {Order, OrderStatus} from '../../types';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {StoreLayout} from '../../components/store/StoreLayout';

export function MyOrdersPage() {
  const {firebaseUser, authReady, signInCustomerWithGoogle} = useAuth();
  const {products, siteSettings} = useStore();
  const {t} = useLanguage();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setOrders([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'orders'),
        where('customerUid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => setOrders(snap.docs.map((d) => d.data() as Order)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders'),
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  const counts = useMemo(() => {
    const map = {all: orders.length, pending: 0, processing: 0, completed: 0, cancelled: 0, expired: 0};
    for (const o of orders) {
      if (o.orderStatus in map) {
        map[o.orderStatus] += 1;
      }
    }
    return map;
  }, [orders]);

  const filteredOrders = useMemo(
    () => (statusFilter === 'all' ? orders : orders.filter((o) => o.orderStatus === statusFilter)),
    [orders, statusFilter],
  );

  const getProductSlug = (order: Order) => {
    const found = products.find((p) => p.id === order.productId);
    return found?.slug || order.productId;
  };

  const getProductImage = (order: Order) => {
    if (order.productImage) return order.productImage;
    const found = products.find((p) => p.id === order.productId);
    return found?.images?.[0] || '';
  };

  const getCancelReason = (order: Order) => {
    if (order.orderStatus !== 'cancelled' && order.paymentStatus !== 'rejected') return '';
    return (
      order.adminNote?.trim() ||
      order.notificationMessage?.trim() ||
      'Order was cancelled by administrator.'
    );
  };

  const escapeHtmlText = (val: unknown) =>
    String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const handleDownloadHtmlReceipt = (order: Order) => {
    const brand = escapeHtmlText(siteSettings.brandName || 'MUNAFTOPUP.bd');
    const createdStr = escapeHtmlText(new Date(timestampToMillis(order.createdAt)).toLocaleString());
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${escapeHtmlText(order.orderNumber)} — ${brand}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; max-width: 680px; margin: 32px auto; padding: 24px; border: 1px solid #cbd5e1; border-radius: 14px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .muted { color: #64748b; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  td, th { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 14px; }
  .right { text-align: right; }
  .total { font-weight: 800; font-size: 16px; color: #0891b2; }
  .pin { margin-top: 16px; padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; font-family: monospace; font-weight: 700; }
</style>
</head>
<body>
  <h1>${brand} — Official Payment Receipt</h1>
  <p class="muted">Order #${escapeHtmlText(order.orderNumber)} · ${createdStr}</p>
  <table>
    <tr><th>Customer</th><td class="right">${escapeHtmlText(order.customerName)} (${escapeHtmlText(order.customerEmail)})</td></tr>
    <tr><th>Product</th><td class="right">${escapeHtmlText(order.productName)}</td></tr>
    <tr><th>Package</th><td class="right">${escapeHtmlText(order.packageName)}</td></tr>
    <tr><th>Player UID / Server</th><td class="right">${escapeHtmlText(order.playerUid || '—')} / ${escapeHtmlText(order.serverId || 'N/A')}</td></tr>
    <tr><th>Payment Method</th><td class="right">${escapeHtmlText(order.paymentMethodName)}</td></tr>
    <tr><th>TrxID</th><td class="right">${escapeHtmlText(order.trxId)}</td></tr>
    <tr><th>Order Status</th><td class="right" style="text-transform:capitalize;">${escapeHtmlText(order.orderStatus)}</td></tr>
    ${order.flashSaleDiscount ? `<tr><th>Flash Sale Discount</th><td class="right">-${escapeHtmlText(formatCurrency(order.flashSaleDiscount))}</td></tr>` : ''}
    ${order.tierDiscount ? `<tr><th>${escapeHtmlText((order.appliedTier || 'Member').toUpperCase())} Discount</th><td class="right">-${escapeHtmlText(formatCurrency(order.tierDiscount))}</td></tr>` : ''}
    ${order.couponDiscount ? `<tr><th>Promo (${escapeHtmlText(order.couponCode || '')})</th><td class="right">-${escapeHtmlText(formatCurrency(order.couponDiscount))}</td></tr>` : ''}
    <tr><th class="total">Total Paid</th><td class="right total">${escapeHtmlText(formatCurrency(order.totalAmount))}</td></tr>
  </table>
  ${order.voucherCode ? `<div class="pin">Voucher PIN: ${escapeHtmlText(order.voucherCode)}</div>` : ''}
</body>
</html>`;
    const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${order.orderNumber}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded receipt-${order.orderNumber}.html`);
  };

  const renderStatusBadge = (status: Order['orderStatus']) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5" /> {t('orders.completed')}
        </span>
      );
    }
    if (status === 'processing') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300 text-xs font-bold whitespace-nowrap">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('orders.processing')}
        </span>
      );
    }
    if (status === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5" /> {t('orders.cancelled')}
        </span>
      );
    }
    if (status === 'expired') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold whitespace-nowrap">
          <Clock className="w-3.5 h-3.5" /> {t('orders.expired')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-bold whitespace-nowrap">
        <Clock className="w-3.5 h-3.5" /> {t('orders.pending')}
      </span>
    );
  };

  const filterTabs: Array<{key: 'all' | OrderStatus; label: string}> = [
    {key: 'all', label: t('orders.all')},
    {key: 'pending', label: t('orders.pending')},
    {key: 'processing', label: t('orders.processing')},
    {key: 'completed', label: t('orders.completed')},
    {key: 'cancelled', label: t('orders.cancelled')},
    {key: 'expired', label: t('orders.expired')},
  ];

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-display">
              {t('orders.title')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('orders.subtitle')}
            </p>
          </div>
          <Link
            to="/track"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-[1.5px] border-slate-200/95 dark:border-slate-700 hover:border-cyan-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-cyan-600 transition-colors whitespace-nowrap shadow-2xs">
            <Search className="w-3.5 h-3.5" /> {t('orders.trackBtn')}
          </Link>
        </div>

        {/* Interactive Status Filter Buttons */}
        {firebaseUser && orders.length > 0 && (
          <div className="flex items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            {filterTabs.map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                    active
                      ? 'bg-gradient-to-r from-slate-900 to-slate-800 dark:from-cyan-600 dark:to-blue-600 border-slate-900 dark:border-cyan-500 text-white shadow-xs'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}>
                  {tab.label} ({counts[tab.key]})
                </button>
              );
            })}
          </div>
        )}

        {!authReady ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-36 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              />
            ))}
          </div>
        ) : !firebaseUser ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-8 text-center space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              {t('orders.signInTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {t('orders.signInDesc')}
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 border border-slate-800 dark:border-cyan-500 text-white text-sm font-semibold cursor-pointer">
              {t('nav.signInGoogle')}
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-10 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <Package className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {statusFilter === 'all' ? t('orders.empty') : `No ${statusFilter} orders`}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {statusFilter === 'all'
                ? t('orders.emptyHint')
                : 'Switch filter tabs above to view your other orders.'}
            </p>
            {statusFilter === 'all' && (
              <Link
                to="/"
                className="inline-flex px-4 py-2 rounded-xl bg-slate-900 dark:bg-cyan-600 border border-slate-800 dark:border-cyan-500 text-white text-xs font-semibold">
                {t('home.browseTopUps')}
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              const cancelReason = getCancelReason(order);
              return (
                <div
                  key={order.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-300/90 dark:hover:border-cyan-500/70 p-4 sm:p-5 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none transition-all">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">
                        {order.orderNumber}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {new Date(timestampToMillis(order.createdAt)).toLocaleString()}
                      </p>
                    </div>
                    {renderStatusBadge(order.orderStatus)}
                  </div>

                  {/* Product Summary */}
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border-[1.5px] border-slate-200/85 dark:border-slate-800 p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border-[1.5px] border-slate-200 dark:border-slate-700 shrink-0">
                        <ImageWithFallback
                          src={getProductImage(order)}
                          alt={order.productName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {order.productName}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                          {order.packageName}
                        </p>
                        {order.playerUid && (
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            UID: {order.playerUid}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        {t('orders.paid')}
                      </span>
                      <span className="text-sm sm:text-base font-extrabold text-cyan-700 dark:text-cyan-400 tabular-nums">
                        {formatCurrency(order.totalAmount)}
                      </span>
                    </div>
                  </div>

                  {/* Cancel Reason Notice */}
                  {cancelReason && (
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border-[1.5px] border-rose-200 dark:border-rose-800 p-3 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
                      <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">{t('orders.cancelReason')}</span>
                        <p className="mt-0.5">{cancelReason}</p>
                      </div>
                    </div>
                  )}

                  {/* Processing / Active Status Update */}
                  {!cancelReason && order.notificationMessage && (
                    <div
                      className={`rounded-xl border-[1.5px] px-3.5 py-2.5 text-xs ${
                        order.orderStatus === 'processing'
                          ? 'bg-cyan-50/70 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800 text-cyan-900 dark:text-cyan-200'
                          : order.orderStatus === 'completed'
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                            : order.orderStatus === 'expired'
                              ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                              : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                      }`}>
                      <span className="font-bold">{t('orders.statusNote')}: </span>
                      <span>{order.notificationMessage}</span>
                    </div>
                  )}

                  {/* Action Buttons Row */}
                  <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-800 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                    <Link
                      to={`/product/${getProductSlug(order)}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 dark:from-cyan-600 dark:to-blue-600 hover:from-cyan-600 hover:to-blue-600 border border-slate-800 dark:border-cyan-500 text-white text-xs sm:text-sm font-bold transition-all shadow-2xs">
                      <RefreshCw className="w-3.5 h-3.5" /> {t('orders.topUpAgain')}
                    </Link>

                    <button
                      type="button"
                      onClick={() => setDetailOrder(order)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[1.5px] border-slate-200/95 dark:border-slate-700 hover:border-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer">
                      <Eye className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />{' '}
                      {t('orders.viewDetails')}
                    </button>

                    <Link
                      to={`/track?order=${order.orderNumber}`}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[1.5px] border-cyan-200 dark:border-cyan-800 bg-cyan-50/60 dark:bg-cyan-950/50 hover:bg-cyan-100/70 text-xs sm:text-sm font-bold text-cyan-800 dark:text-cyan-300 transition-colors">
                      <Search className="w-3.5 h-3.5" /> {t('orders.track')}
                    </Link>

                    <button
                      type="button"
                      onClick={() => setInvoiceOrder(order)}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[1.5px] border-slate-200/95 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-cyan-400 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors">
                      <FileText className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" /> {t('invoice.title')}
                    </button>

                    {order.voucherCode && (
                      <Link
                        to="/codes"
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 text-white text-xs sm:text-sm font-bold transition-colors">
                        <KeyRound className="w-3.5 h-3.5" /> {t('orders.codes')}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-[1px]">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border-[1.5px] border-slate-200 dark:border-slate-800 max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  Order {detailOrder.orderNumber}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {detailOrder.productName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Package</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {detailOrder.packageName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Player UID</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {detailOrder.playerUid || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Payment Method</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {detailOrder.paymentMethodName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">TrxID</span>
                <span className="font-mono text-slate-900 dark:text-white">{detailOrder.trxId}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Payment Status</span>
                <span className="font-semibold capitalize text-slate-900 dark:text-white">
                  {detailOrder.paymentStatus}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Order Status</span>
                {renderStatusBadge(detailOrder.orderStatus)}
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Total Paid</span>
                <span className="font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                  {formatCurrency(detailOrder.totalAmount)}
                </span>
              </div>
            </div>

            {getCancelReason(detailOrder) ? (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border-[1.5px] border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-800 dark:text-rose-200">
                <span className="font-bold block mb-0.5">{t('orders.cancelReason')}</span>
                {getCancelReason(detailOrder)}
              </div>
            ) : (
              detailOrder.notificationMessage && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border-[1.5px] border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-bold text-slate-900 dark:text-white block mb-0.5">
                    {t('track.latestUpdate')}
                  </span>
                  {detailOrder.notificationMessage}
                </div>
              )
            )}

            {detailOrder.voucherCode && (
              <div className="rounded-xl bg-cyan-50 dark:bg-cyan-950/50 border-[1.5px] border-cyan-200 dark:border-cyan-800 p-3 text-xs space-y-1">
                <span className="font-bold text-cyan-900 dark:text-cyan-300 block">
                  Delivered Voucher Code
                </span>
                <p className="font-mono font-bold text-slate-900 dark:text-white break-all">
                  {detailOrder.voucherCode}
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Link
                to={`/track?order=${detailOrder.orderNumber}`}
                className="flex-1 text-center px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 border border-slate-800 dark:border-cyan-500 text-white text-xs font-semibold">
                {t('checkout.trackLive')}
              </Link>
              <button
                type="button"
                onClick={() => {
                  const target = detailOrder;
                  setDetailOrder(null);
                  setInvoiceOrder(target);
                }}
                className="px-4 py-2.5 rounded-xl border-[1.5px] border-cyan-300 dark:border-cyan-700 text-xs font-semibold text-cyan-700 dark:text-cyan-300 cursor-pointer">
                {t('invoice.title')}
              </button>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="px-4 py-2.5 rounded-xl border-[1.5px] border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable & Downloadable Invoice Modal */}
      {invoiceOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-[1px] overflow-y-auto">
          <div className="print-invoice-root bg-white dark:bg-slate-900 rounded-2xl border-[1.5px] border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 space-y-5 shadow-2xl my-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white font-display">
                  {siteSettings.brandName || 'MUNAFTOPUP.bd'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Official Order Invoice · {invoiceOrder.orderNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInvoiceOrder(null)}
                className="no-print p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Date</span>
                <span className="text-slate-900 dark:text-white tabular-nums">
                  {new Date(timestampToMillis(invoiceOrder.createdAt)).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Customer</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {invoiceOrder.customerName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Item</span>
                <span className="font-semibold text-slate-900 dark:text-white text-right">
                  {invoiceOrder.productName} — {invoiceOrder.packageName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Player UID / Server</span>
                <span className="font-mono text-slate-900 dark:text-white">
                  {invoiceOrder.playerUid || '—'} / {invoiceOrder.serverId || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Payment</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {invoiceOrder.paymentMethodName} ({invoiceOrder.trxId})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Base Price</span>
                <span className="tabular-nums text-slate-900 dark:text-white">
                  {formatCurrency(invoiceOrder.unitPrice)}
                </span>
              </div>
              {Boolean(invoiceOrder.flashSaleDiscount) && (
                <div className="flex justify-between text-rose-600 dark:text-rose-400">
                  <span>Flash Sale Discount</span>
                  <span className="tabular-nums">-{formatCurrency(invoiceOrder.flashSaleDiscount || 0)}</span>
                </div>
              )}
              {Boolean(invoiceOrder.tierDiscount) && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span className="uppercase">{invoiceOrder.appliedTier || 'Member'} Discount</span>
                  <span className="tabular-nums">-{formatCurrency(invoiceOrder.tierDiscount || 0)}</span>
                </div>
              )}
              {Boolean(invoiceOrder.couponDiscount) && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Promo ({invoiceOrder.couponCode})</span>
                  <span className="tabular-nums">-{formatCurrency(invoiceOrder.couponDiscount || 0)}</span>
                </div>
              )}
              <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
                <span className="font-bold text-slate-900 dark:text-white">Total Paid</span>
                <span className="text-lg font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                  {formatCurrency(invoiceOrder.totalAmount)}
                </span>
              </div>
            </div>

            {invoiceOrder.voucherCode && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 block">
                    Voucher PIN
                  </span>
                  <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white break-all">
                    {invoiceOrder.voucherCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(invoiceOrder.voucherCode || '');
                    toast.success('PIN copied');
                  }}
                  className="no-print p-2 rounded-lg bg-emerald-600 text-white cursor-pointer shrink-0">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="no-print flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 text-white text-xs font-bold cursor-pointer">
                <Printer className="w-4 h-4" /> {t('invoice.print')}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadHtmlReceipt(invoiceOrder)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold cursor-pointer">
                <Download className="w-4 h-4" /> {t('invoice.download')}
              </button>
            </div>
          </div>
        </div>
      )}
    </StoreLayout>
  );
}
