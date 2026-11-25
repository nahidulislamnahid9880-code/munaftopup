import React, {useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {CheckCircle2, Clock, PackageCheck, Search, XCircle} from 'lucide-react';
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
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {Order, OrderTracking} from '../../types';
import {StoreLayout} from '../../components/store/StoreLayout';

export function OrderTrackingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {firebaseUser, authReady} = useAuth();

  const [orderInput, setOrderInput] = useState(searchParams.get('order') || '');
  const [lookupResult, setLookupResult] = useState<OrderTracking | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [searching, setSearching] = useState(false);

  const [myOrders, setMyOrders] = useState<Order[]>([]);

  const performLookup = async (orderNum: string) => {
    const clean = orderNum.trim().toUpperCase();
    if (!clean) return;
    setSearching(true);
    setLookupError('');
    setLookupResult(null);
    try {
      const snap = await getDoc(doc(db, 'orderTracking', clean));
      if (!snap.exists()) {
        setLookupError(`No order found with reference "${clean}". Check your Order ID and try again.`);
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
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> {status.toUpperCase()}
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
            <PackageCheck className="w-3.5 h-3.5" /> PROCESSING
          </span>
        );
      case 'cancelled':
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <XCircle className="w-3.5 h-3.5" /> {status.toUpperCase()}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <Clock className="w-3.5 h-3.5" /> PENDING
          </span>
        );
    }
  };

  return (
    <StoreLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display">
            Track Your Order
          </h1>
          <p className="text-sm text-slate-600">
            Enter your Order ID (e.g. SV-123456) to check payment verification and diamond delivery status.
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value)}
              placeholder="Enter Order ID (e.g. SV-100420)"
              className="w-full pl-10 pr-4 py-3 text-sm font-mono uppercase rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50">
            {searching ? 'Checking...' : 'Check Status'}
          </button>
        </form>

        {lookupError && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {lookupError}
          </div>
        )}

        {lookupResult && (
          <div className="rounded-xl bg-white border border-slate-200 p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <span className="text-xs text-slate-500 block">Order Reference</span>
                <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                  {lookupResult.orderNumber}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[11px] text-slate-500 block">Payment</span>
                  {renderStatusLabel(lookupResult.paymentStatus)}
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">Fulfillment</span>
                  {renderStatusLabel(lookupResult.orderStatus)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">Product</span>
                <span className="font-semibold text-slate-900">{lookupResult.productName}</span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Package</span>
                <span className="font-semibold text-slate-900">{lookupResult.packageName}</span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Player UID</span>
                <span className="font-mono text-slate-900">{lookupResult.playerUidMasked || '—'}</span>
              </div>
            </div>

            {lookupResult.notificationMessage && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-sm text-slate-700">
                <span className="text-xs font-semibold text-slate-500 block mb-0.5">
                  Latest Update
                </span>
                {lookupResult.notificationMessage}
              </div>
            )}
          </div>
        )}

        {firebaseUser && (
          <div className="space-y-4 pt-4 border-t border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 font-display">
              Your Recent Orders
            </h2>
            {myOrders.length === 0 ? (
              <p className="text-sm text-slate-500">You have not placed any orders yet.</p>
            ) : (
              <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Order ID</th>
                        <th className="px-4 py-3 font-medium">Product &amp; Package</th>
                        <th className="px-4 py-3 font-medium">Player UID</th>
                        <th className="px-4 py-3 font-medium">Amount</th>
                        <th className="px-4 py-3 font-medium">Payment</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {myOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                            {order.orderNumber}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{order.productName}</p>
                            <p className="text-xs text-slate-500">{order.packageName}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700">{order.playerUid}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                            {formatCurrency(order.totalAmount)}
                          </td>
                          <td className="px-4 py-3">{renderStatusLabel(order.paymentStatus)}</td>
                          <td className="px-4 py-3">{renderStatusLabel(order.orderStatus)}</td>
                          <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                            {new Date(timestampToMillis(order.createdAt)).toLocaleDateString()}
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
    </StoreLayout>
  );
}
