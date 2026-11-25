import React, {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  KeyRound,
  Package,
  RefreshCw,
  Search,
  User,
  X,
  XCircle,
} from 'lucide-react';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {Order} from '../../types';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {StoreLayout} from '../../components/store/StoreLayout';

export function MyOrdersPage() {
  const {firebaseUser, authReady, signInCustomerWithGoogle} = useAuth();
  const {products} = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

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

  const getProductSlug = (order: Order) => {
    const found = products.find((p) => p.id === order.productId);
    return found?.slug || order.productId;
  };

  const getProductImage = (order: Order) => {
    if (order.productImage) return order.productImage;
    const found = products.find((p) => p.id === order.productId);
    return found?.images?.[0] || '';
  };

  const renderStatusPill = (status: Order['orderStatus']) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
          <CheckCircle2 className="w-3.5 h-3.5" /> Completed
        </span>
      );
    }
    if (status === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
          <XCircle className="w-3.5 h-3.5" /> Cancelled
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold capitalize">
        <Clock className="w-3.5 h-3.5" /> {status}
      </span>
    );
  };

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        <div className="flex items-end justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display">
            My orders
          </h1>
          <Link
            to="/track"
            className="inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-slate-600 hover:text-cyan-600">
            <Search className="w-3.5 h-3.5" /> Track a guest order
          </Link>
        </div>

        {!authReady ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading orders...
          </div>
        ) : !firebaseUser ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 font-display">Sign in to view orders</h2>
            <p className="text-xs sm:text-sm text-slate-600">
              View your past diamond top-ups, live order statuses, and quick repeat-order links.
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer">
              Sign in with Google
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center space-y-3">
            <Package className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-900">No orders yet</p>
            <p className="text-xs text-slate-500">
              Your diamond top-ups and game voucher orders will appear here.
            </p>
            <Link
              to="/"
              className="inline-flex px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold">
              Browse Top-Ups
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4 shadow-xs">
                {/* Card Header: Order # + Placed Date + Status */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base sm:text-lg font-extrabold text-slate-900 font-mono tabular-nums">
                      {order.orderNumber}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      Placed {new Date(timestampToMillis(order.createdAt)).toLocaleString()} · 1 item
                    </p>
                  </div>
                  {renderStatusPill(order.orderStatus)}
                </div>

                {/* Product Summary */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                      <ImageWithFallback
                        src={getProductImage(order)}
                        alt={order.productName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-sm font-semibold text-slate-700 truncate">
                      {order.productName}
                    </p>
                  </div>
                  <p className="text-sm sm:text-base font-extrabold text-slate-900 tabular-nums">
                    Paid {formatCurrency(order.totalAmount)}
                  </p>
                  <div className="text-xs text-slate-600 space-y-0.5">
                    <p>
                      {order.productName} — {order.packageName}
                    </p>
                    {order.playerUid && (
                      <p className="font-mono text-slate-500">PLAYER ID: {order.playerUid}</p>
                    )}
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className={`grid gap-2 ${order.voucherCode ? 'grid-cols-2' : 'grid-cols-2'}`}>
                    <Link
                      to={`/product/${getProductSlug(order)}`}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" /> Top up again
                    </Link>

                    {order.voucherCode ? (
                      <Link
                        to="/codes"
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 transition-colors">
                        <KeyRound className="w-3.5 h-3.5 text-cyan-600" /> Codes
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDetailOrder(order)}
                        className="inline-flex items-center justify-center px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 transition-colors cursor-pointer">
                        View details
                      </button>
                    )}
                  </div>

                  {order.voucherCode && (
                    <button
                      type="button"
                      onClick={() => setDetailOrder(order)}
                      className="w-full inline-flex items-center justify-center px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 transition-colors cursor-pointer">
                      View details
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 font-display">
                  Order {detailOrder.orderNumber}
                </h2>
                <p className="text-xs text-slate-500">{detailOrder.productName}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Package</span>
                <span className="font-semibold text-slate-900">{detailOrder.packageName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Player UID</span>
                <span className="font-mono font-semibold text-slate-900">{detailOrder.playerUid || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method</span>
                <span className="font-semibold text-slate-900">{detailOrder.paymentMethodName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">TrxID</span>
                <span className="font-mono text-slate-900">{detailOrder.trxId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Status</span>
                <span className="font-semibold capitalize">{detailOrder.paymentStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Order Status</span>
                <span className="font-semibold capitalize">{detailOrder.orderStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Paid</span>
                <span className="font-extrabold text-cyan-600 tabular-nums">
                  {formatCurrency(detailOrder.totalAmount)}
                </span>
              </div>
            </div>

            {detailOrder.notificationMessage && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
                <span className="font-bold text-slate-900 block mb-0.5">Latest Update</span>
                {detailOrder.notificationMessage}
              </div>
            )}

            {detailOrder.voucherCode && (
              <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-3 text-xs space-y-1">
                <span className="font-bold text-cyan-900 block">Delivered Voucher Code</span>
                <p className="font-mono font-bold text-slate-900 break-all">{detailOrder.voucherCode}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Link
                to={`/track?order=${detailOrder.orderNumber}`}
                className="flex-1 text-center px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold">
                Live Tracker
              </Link>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </StoreLayout>
  );
}
