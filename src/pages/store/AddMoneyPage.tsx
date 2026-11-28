import React, {useEffect, useMemo, useState} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  PlusCircle,
  Wallet,
} from 'lucide-react';
import {
  collection,
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
import type {WalletTopup} from '../../types';
import {PaymentMethodLogo} from '../../components/PaymentMethodLogo';
import {StoreLayout} from '../../components/store/StoreLayout';

const PRESET_AMOUNTS = [100, 300, 500, 1000, 2000];

export function AddMoneyPage() {
  const {paymentMethods} = useStore();
  const {firebaseUser, authReady, customerProfile, signInCustomerWithGoogle} = useAuth();
  const {t} = useLanguage();
  const toast = useToast();

  const activeMethods = useMemo(
    () => paymentMethods.filter((m) => m.active),
    [paymentMethods],
  );

  const [amount, setAmount] = useState('500');
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [trxId, setTrxId] = useState('');
  const [copied, setCopied] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [topups, setTopups] = useState<WalletTopup[]>([]);

  useEffect(() => {
    if (activeMethods.length > 0 && !activeMethods.some((m) => m.id === selectedMethodId)) {
      setSelectedMethodId(activeMethods[0].id);
    }
  }, [activeMethods, selectedMethodId]);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setTopups([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'walletTopups'),
        where('customerUid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => setTopups(snap.docs.map((d) => d.data() as WalletTopup)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'walletTopups'),
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  const selectedMethod = activeMethods.find((m) => m.id === selectedMethodId) || activeMethods[0];

  const handleCopy = async () => {
    if (!selectedMethod?.accountNumber) return;
    await navigator.clipboard.writeText(selectedMethod.accountNumber);
    setCopied(true);
    toast.success(`${selectedMethod.name} number copied`);
    setTimeout(() => setCopied(false), 2000);
  };

  const fail = (msg: string) => {
    setError(msg);
    toast.error(msg);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!firebaseUser) {
      fail('Please sign in with Google to add money to your wallet.');
      return;
    }
    if (customerProfile?.suspended) {
      fail('Suspended accounts cannot submit wallet deposits.');
      return;
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 10 || numAmount > 500000) {
      fail('Enter a valid amount between ৳10 and ৳500,000.');
      return;
    }
    if (!selectedMethod) {
      fail('No active payment gateway available.');
      return;
    }
    if (trxId.trim().length < 4 || trxId.trim().length > 64) {
      fail('Enter a valid Transaction ID (TrxID) between 4 and 64 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanTrx = trxId.trim().toUpperCase().slice(0, 64);
      const token = await firebaseUser.getIdToken();
      const defaultSender =
        customerProfile?.phone?.trim() && customerProfile.phone.trim().length >= 5
          ? customerProfile.phone.trim()
          : 'Not Required';

      const res = await fetch('/api/wallet-topups/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: numAmount,
          paymentMethodId: selectedMethod.id,
          trxId: cleanTrx,
          senderNumber: defaultSender,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        autoApproved?: boolean;
        amount?: number;
        newWalletBalance?: number;
      };

      if (!res.ok || !data.ok) {
        fail(data.error || 'Unable to submit deposit. Please verify your TrxID and try again.');
        return;
      }

      setTrxId('');
      if (data.autoApproved) {
        const msg = `Deposit of ${formatCurrency(numAmount)} verified automatically and credited to your wallet!`;
        setSuccessMsg(msg);
        toast.success(`৳${numAmount} added to your wallet instantly!`);
      } else {
        const msg = `Deposit request for ${formatCurrency(numAmount)} submitted! Wallet balance updates automatically once verified.`;
        setSuccessMsg(msg);
        toast.success(`Deposit request for ${formatCurrency(numAmount)} submitted`);
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Unable to submit deposit request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        {/* Wallet Header Card */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 border-[1.5px] border-cyan-500/35 ring-1 ring-white/10 text-white p-5 flex items-center justify-between gap-4 shadow-[0_12px_28px_-8px_rgba(15,23,42,0.28)]">
          <div>
            <span className="text-xs text-slate-300 block">{t('addMoney.currentBalance')}</span>
            <p className="text-2xl sm:text-3xl font-extrabold font-display tabular-nums mt-0.5">
              {formatCurrency(customerProfile?.walletBalance ?? 0)}
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-cyan-500/20 border-[1.5px] border-cyan-400/40 text-cyan-300 flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
        </div>

        {!firebaseUser && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-6 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Sign in to Add Money
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Sign in with Google so approved deposits are credited directly to your wallet.
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 border border-slate-700 dark:border-cyan-500 text-white text-sm font-semibold cursor-pointer">
              {t('nav.signInGoogle')}
            </button>
          </div>
        )}

        {/* Add Money Form Card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
          <div className="border-b-[1.5px] border-slate-200/80 dark:border-slate-800 pb-3">
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white font-display">
              {t('addMoney.title')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('addMoney.subtitle')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
              {t('addMoney.amount')}
            </label>
            <input
              type="number"
              min={10}
              max={500000}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESET_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(String(val))}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                    Number(amount) === val
                      ? 'bg-cyan-500 border-cyan-600 text-white shadow-2xs'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}>
                  ৳{val}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="block text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
              {t('addMoney.gateway')}
            </label>
            {activeMethods.length === 0 ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                No payment gateways are currently enabled by the administrator.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {activeMethods.map((method) => {
                  const active = selectedMethod?.id === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setSelectedMethodId(method.id)}
                      className={`p-3.5 rounded-xl text-center transition-all cursor-pointer flex flex-col items-center gap-2 ${
                        active
                          ? 'border-2 border-cyan-500 bg-cyan-50/70 dark:bg-cyan-950/45 ring-2 ring-cyan-500/20 shadow-xs'
                          : 'border-[1.5px] border-slate-200/95 dark:border-slate-700 bg-white dark:bg-slate-950/50 hover:border-slate-300'
                      }`}>
                      <PaymentMethodLogo name={method.name} logoUrl={method.logoUrl} size="md" />
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-slate-900 dark:text-white block truncate">
                          {method.name}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                          {method.accountType}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedMethod && (
            <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <PaymentMethodLogo name={selectedMethod.name} logoUrl={selectedMethod.logoUrl} size="md" />
                  <div className="min-w-0">
                    <span className="text-xs text-slate-500 dark:text-slate-400 block">
                      {t('checkout.sendTo')} {formatCurrency(Number(amount) || 0)} → ({selectedMethod.name} {selectedMethod.accountType})
                    </span>
                    <span className="text-lg font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                      {selectedMethod.accountNumber}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-cyan-500 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shrink-0 transition-colors">
                  <Copy className="w-3.5 h-3.5" /> {copied ? t('checkout.copied') : t('checkout.copyNumber')}
                </button>
              </div>
              {selectedMethod.instructions && (
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line border-t border-slate-200/90 dark:border-slate-800 pt-2.5 leading-relaxed">
                  {selectedMethod.instructions}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t('checkout.trxId')} *
            </label>
            <input
              type="text"
              required
              value={trxId}
              onChange={(e) => setTrxId(e.target.value)}
              placeholder={t('checkout.trxPlaceholder')}
              className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border-[1.5px] border-red-200 dark:border-red-800 p-3 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border-[1.5px] border-emerald-200 dark:border-emerald-800 p-3 flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !firebaseUser || activeMethods.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 border border-slate-800 dark:border-cyan-500 disabled:border-slate-300 text-white text-sm font-bold cursor-pointer transition-colors shadow-xs">
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> {t('addMoney.submitting')}
              </>
            ) : (
              <>
                <PlusCircle className="w-4 h-4" /> {t('addMoney.title')}
              </>
            )}
          </button>
        </form>

        {/* Recent Deposit History */}
        {firebaseUser && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display border-b border-slate-100 dark:border-slate-800 pb-2.5">
              {t('addMoney.depositHistory')}
            </h2>
            {topups.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                {t('addMoney.noDeposits')}
              </p>
            ) : (
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
                {topups.map((tItem) => (
                  <div key={tItem.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                        {formatCurrency(tItem.amount)} · {tItem.paymentMethodName}
                      </p>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                        TrxID: {tItem.trxId} ·{' '}
                        {new Date(timestampToMillis(tItem.createdAt)).toLocaleString()}
                      </p>
                      {tItem.adminNote && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                          {tItem.adminNote}
                        </p>
                      )}
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold capitalize shrink-0 ${
                        tItem.status === 'approved'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-[1.5px] border-emerald-200 dark:border-emerald-800'
                          : tItem.status === 'rejected'
                            ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-[1.5px] border-red-200 dark:border-red-800'
                            : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-[1.5px] border-amber-200 dark:border-amber-800'
                      }`}>
                      {tItem.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </StoreLayout>
  );
}
