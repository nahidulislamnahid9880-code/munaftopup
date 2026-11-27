import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Check, Copy, KeyRound, User} from 'lucide-react';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useToast} from '../../contexts/ToastContext';
import {OperationType, db, handleFirestoreError, timestampToMillis} from '../../lib/firebase';
import type {Order} from '../../types';
import {StoreLayout} from '../../components/store/StoreLayout';

export function MyCodesPage() {
  const {firebaseUser, authReady, signInCustomerWithGoogle} = useAuth();
  const {t} = useLanguage();
  const toast = useToast();
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
    toast.success('Voucher code copied');
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-display">
          {t('codes.title')}
        </h1>

        {!authReady ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="h-32 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              />
            ))}
          </div>
        ) : !firebaseUser ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-8 text-center space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              {t('codes.signInTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {t('codes.signInDesc')}
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 border border-slate-800 dark:border-cyan-500 text-white text-sm font-semibold cursor-pointer">
              {t('nav.signInGoogle')}
            </button>
          </div>
        ) : voucherOrders.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-10 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <KeyRound className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {t('codes.empty')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('codes.emptyHint')}
            </p>
            <Link
              to="/"
              className="inline-flex px-4 py-2 rounded-xl bg-slate-900 dark:bg-cyan-600 border border-slate-800 dark:border-cyan-500 text-white text-xs font-semibold">
              {t('codes.browseVouchers')}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {voucherOrders.map((order) => (
              <div
                key={order.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-300/90 dark:hover:border-cyan-500/70 p-4 sm:p-5 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none transition-all">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display">
                    {order.productName} - {order.packageName}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Order {order.orderNumber} · Delivered{' '}
                    {new Date(timestampToMillis(order.updatedAt || order.createdAt)).toLocaleString()}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950 border-[1.5px] border-slate-200/95 dark:border-slate-800 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200/90 dark:border-slate-800 flex items-center justify-between gap-2 bg-white dark:bg-slate-900">
                    <span className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
                      {t('orders.codes')}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(order.id, order.voucherCode || '')}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 border border-slate-800 dark:border-cyan-500 text-white text-xs font-semibold cursor-pointer">
                      {copiedId === order.id ? t('checkout.copied') : t('codes.copyCode')}
                    </button>
                  </div>
                  <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                    <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white break-all">
                      {order.voucherCode}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(order.id, order.voucherCode || '')}
                      aria-label="Copy voucher code"
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer">
                      {copiedId === order.id ? (
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
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
