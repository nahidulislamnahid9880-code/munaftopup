import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Check, Copy, KeyRound, User} from 'lucide-react';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {OperationType, db, handleFirestoreError, timestampToMillis} from '../../lib/firebase';
import type {Order} from '../../types';
import {StoreLayout} from '../../components/store/StoreLayout';

export function MyCodesPage() {
  const {firebaseUser, authReady, signInCustomerWithGoogle} = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const voucherOrders = useMemo(
    () => orders.filter((o) => Boolean(o.voucherCode && o.voucherCode.trim())),
    [orders],
  );

  const handleCopyCode = async (orderId: string, code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(orderId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display">
          My Codes
        </h1>

        {!authReady ? (
          <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-8 text-center text-sm text-slate-500 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
            Loading codes...
          </div>
        ) : !firebaseUser ? (
          <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-8 text-center space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200/70 text-cyan-600 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 font-display">Sign in to access your codes</h2>
            <p className="text-xs sm:text-sm text-slate-600">
              All UniPin and game voucher pins delivered to your account appear here.
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-sm font-semibold cursor-pointer">
              Sign in with Google
            </button>
          </div>
        ) : voucherOrders.length === 0 ? (
          <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-10 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
            <KeyRound className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-900">No voucher codes delivered yet</p>
            <p className="text-xs text-slate-500">
              When you purchase a Free Fire Voucher or digital pin and an admin fulfills it, your code will show here.
            </p>
            <Link
              to="/"
              className="inline-flex px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-semibold">
              Browse Vouchers
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {voucherOrders.map((order) => (
              <div
                key={order.id}
                className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] hover:border-cyan-300/90 p-4 sm:p-5 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] transition-all">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display">
                    {order.productName} - {order.packageName}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Order {order.orderNumber} · Delivered {new Date(timestampToMillis(order.updatedAt || order.createdAt)).toLocaleString()}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50/90 border-[1.5px] border-slate-200/95 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200/90 flex items-center justify-between gap-2 bg-white">
                    <span className="text-xs sm:text-sm font-semibold text-slate-600">Codes</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(order.id, order.voucherCode || '')}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-xs font-semibold cursor-pointer">
                      {copiedId === order.id ? 'Copied' : 'Copy Code'}
                    </button>
                  </div>
                  <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                    <p className="font-mono text-sm font-semibold text-slate-900 break-all">
                      {order.voucherCode}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(order.id, order.voucherCode || '')}
                      aria-label="Copy voucher code"
                      className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 shrink-0 cursor-pointer">
                      {copiedId === order.id ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </StoreLayout>
  );
}
