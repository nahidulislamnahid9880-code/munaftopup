import React, {useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {CheckCircle2, Clock, FileText, PackageCheck, Search, XCircle} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
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
import type {Order, OrderTracking} from '../../types';
import {OrderReceiptModal} from '../../components/store/OrderReceiptModal';
import {StoreLayout} from '../../components/store/StoreLayout';

export function OrderTrackingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {firebaseUser, authReady} = useAuth();
  const {siteSettings} = useStore();
  const {t} = useLanguage();
  const toast = useToast();

  const [orderInput, setOrderInput] = useState(searchParams.get('order') || '');
  const [lookupResult, setLookupResult] = useState<OrderTracking | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [searching, setSearching] = useState(false);

  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);

  const performLookup = async (orderNum: string) => {
    const clean = orderNum.trim().toUpperCase();
    if (!clean) return;
    setSearching(true);
    setLookupError('');
    setLookupResult(null);
    try {
      const snap = await getDoc(doc(db, 'orderTracking', clean));
      if (!snap.exists()) {
        const msg = `No order found with reference "${clean}". Check your Order ID and try again.`;
        setLookupError(msg);
        toast.error(`Order "${clean}" not found`);
      } else {
        setLookupResult(snap.data() as OrderTracking);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `orderTracking/${clean}`);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const initial = searchParams.get('order');
    if (initial) {
      setOrderInput(initial);
      void performLookup(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setMyOrders([]);
      return;
    }
    const q = query(
      collection(db, 'orders'),
      where('customerUid', '==', firebaseUser.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMyOrders(snap.docs.map((d) => d.data() as Order));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'orders');
      },
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderInput.trim()) return;
    setSearchParams({order: orderInput.trim().toUpperCase()});
    void performLookup(orderInput);
  };

  const renderStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
      case 'verified':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> {status.toUpperCase()}
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-400">
            <PackageCheck className="w-3.5 h-3.5" /> PROCESSING
          </span>
        );
      case 'cancelled':
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
            <XCircle className="w-3.5 h-3.5" /> {status.toUpperCase()}
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5" /> EXPIRED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <Clock className="w-3.5 h-3.5" /> PENDING
          </span>
        );
    }
  };

  const renderStatusTimeline = (tracking: OrderTracking) => {
    const terminated =
      tracking.orderStatus === 'cancelled' ||
      tracking.orderStatus === 'expired' ||
      tracking.paymentStatus === 'rejected';

    if (terminated) {
      return (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-4 py-3 flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-rose-700 dark:text-rose-300">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>
            Order status: {tracking.orderStatus.toUpperCase()} ({tracking.paymentStatus})
          </span>
        </div>
      );
    }

    const steps = [
      {label: t('track.stepPlaced'), done: true},
      {label: t('track.stepPayment'), done: tracking.paymentStatus === 'verified'},
      {
        label: t('track.stepProcessing'),
        done: tracking.orderStatus === 'processing' || tracking.orderStatus === 'completed',
      },
      {label: t('track.stepDone'), done: tracking.orderStatus === 'completed'},
    ];

    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 text-xs font-semibold transition-colors ${
              step.done
                ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
            }`}>
            <span
              className={`w-5 h-5 rounded-md text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums ${
                step.done
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}>
              {i + 1}
            </span>
            <span className="truncate">{step.label}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <StoreLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-display">
            {t('track.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('track.subtitle')}
          </p>
        </div>

        <form
          onSubmit={handleSearch}
          className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-3 sm:p-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value)}
              placeholder={t('track.placeholder')}
              className="w-full pl-10 pr-4 py-3 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-6 py-3 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 border border-slate-800 dark:border-cyan-500 text-white text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50 shadow-2xs transition-colors">
            {searching ? t('track.checking') : t('track.checkStatus')}
          </button>
        </form>

        {lookupError && (
          <div className="rounded-2xl bg-red-50 dark:bg-red-950/40 border-[1.5px] border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
            {lookupError}
          </div>
        )}

        {lookupResult && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-4">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  {t('track.orderRef')}
                </span>
                <span className="text-xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                  {lookupResult.orderNumber}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    {t('track.payment')}
                  </span>
                  {renderStatusLabel(lookupResult.paymentStatus)}
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    {t('track.fulfillment')}
                  </span>
                  {renderStatusLabel(lookupResult.orderStatus)}
                </div>
              </div>
            </div>

            {renderStatusTimeline(lookupResult)}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  {t('track.product')}
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {lookupResult.productName}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  {t('track.package')}
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {lookupResult.packageName}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">
                  {t('track.playerUid')}
                </span>
                <span className="font-mono text-slate-900 dark:text-white">
                  {lookupResult.playerUidMasked || '—'}
                </span>
              </div>
            </div>

            {lookupResult.notificationMessage && (
              <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border-[1.5px] border-slate-200/90 dark:border-slate-800 p-3.5 text-sm text-slate-700 dark:text-slate-300">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('track.latestUpdate')}
                </span>
                {lookupResult.notificationMessage}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  const matched = myOrders.find((o) => o.orderNumber === lookupResult.orderNumber);
                  if (matched) {
                    setReceiptOrder(matched);
                    return;
                  }
                  setReceiptOrder({
                    id: lookupResult.orderNumber,
                    orderNumber: lookupResult.orderNumber,
                    customerUid: firebaseUser?.uid || '',
                    customerName: firebaseUser?.displayName || 'Customer',
                    customerEmail: firebaseUser?.email || '',
                    customerPhone: '',
                    productId: '',
                    productName: lookupResult.productName,
                    packageId: '',
                    packageName: lookupResult.packageName,
                    quantityLabel: '',
                    unitPrice: 0,
                    totalAmount: 0,
                    playerUid: lookupResult.playerUidMasked || '—',
                    serverId: 'N/A',
                    paymentType: 'manual',
                    paymentMethodId: 'tracked',
                    paymentMethodName: 'Verified Payment',
                    senderNumber: '',
                    trxId: lookupResult.orderNumber,
                    trxKey: lookupResult.orderNumber,
                    screenshotUrl: '',
                    paymentStatus: lookupResult.paymentStatus,
                    orderStatus: lookupResult.orderStatus,
                    adminNote: '',
                    notificationMessage: lookupResult.notificationMessage || '',
                    createdAt: lookupResult.createdAt,
                    updatedAt: lookupResult.updatedAt,
                  });
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors">
                <FileText className="w-3.5 h-3.5" /> Receipt (PNG / PDF)
              </button>
            </div>
          </div>
        )}

        {firebaseUser && (
          <div className="space-y-4 pt-4 border-t-[1.5px] border-slate-200/90 dark:border-slate-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              {t('track.recentOrders')}
            </h2>
            {myOrders.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('orders.empty')}
              </p>
            ) : (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 overflow-hidden shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 border-b-[1.5px] border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Order ID</th>
                        <th className="px-4 py-3 font-medium">Product &amp; Package</th>
                        <th className="px-4 py-3 font-medium">Player UID</th>
                        <th className="px-4 py-3 font-medium">Amount</th>
                        <th className="px-4 py-3 font-medium">Payment</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium text-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {myOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                            {order.orderNumber}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-white">
                              {order.productName}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {order.packageName}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                            {order.playerUid}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white tabular-nums">
                            {formatCurrency(order.totalAmount)}
                          </td>
                          <td className="px-4 py-3">{renderStatusLabel(order.paymentStatus)}</td>
                          <td className="px-4 py-3">{renderStatusLabel(order.orderStatus)}</td>
                          <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            {new Date(timestampToMillis(order.createdAt)).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setReceiptOrder(order)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-cyan-400 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                              <FileText className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" /> Receipt
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {receiptOrder && (
        <OrderReceiptModal
          order={receiptOrder}
          brandName={siteSettings.brandName || 'MUNAFTOPUP.bd'}
          onClose={() => setReceiptOrder(null)}
        />
      )}
    </StoreLayout>
  );
}
