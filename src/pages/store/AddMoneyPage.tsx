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
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  normalizeTrxKey,
  timestampToMillis,
} from '../../lib/firebase';
import type {WalletTopup} from '../../types';
import {PaymentMethodLogo} from '../../components/PaymentMethodLogo';
import {StoreLayout} from '../../components/store/StoreLayout';

const PRESET_AMOUNTS = [100, 300, 500, 1000, 2000];

export function AddMoneyPage() {
  const {paymentMethods} = useStore();
  const {firebaseUser, authReady, customerProfile, signInCustomerWithGoogle} = useAuth();

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
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!firebaseUser) {
      setError('Please sign in with Google to add money to your wallet.');
      return;
    }
    if (customerProfile?.suspended) {
      setError('Suspended accounts cannot submit wallet deposits.');
      return;
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 10 || numAmount > 500000) {
      setError('Enter a valid amount between ৳10 and ৳500,000.');
      return;
    }
    if (!selectedMethod) {
      setError('No active payment gateway available.');
      return;
    }
    if (trxId.trim().length < 4 || trxId.trim().length > 64) {
      setError('Enter a valid Transaction ID (TrxID) between 4 and 64 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const trxKey = normalizeTrxKey(selectedMethod.id, trxId);
      if (trxKey.length < 4) {
        setError('Enter a valid Transaction ID (TrxID).');
        setSubmitting(false);
        return;
      }

      try {
        const existingTrx = await getDoc(doc(db, 'trxRegistry', trxKey));
        if (existingTrx.exists()) {
          setError('This Transaction ID (TrxID) has already been submitted. Duplicate TrxIDs are blocked.');
          setSubmitting(false);
          return;
        }
      } catch (checkErr) {
        const checkMsg = checkErr instanceof Error ? checkErr.message.toLowerCase() : '';
        if (checkMsg.includes('permission')) {
          setError('This Transaction ID (TrxID) has already been submitted. Duplicate TrxIDs are blocked.');
          setSubmitting(false);
          return;
        }
        throw checkErr;
      }

      const topupId = `top_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const now = serverTimestamp();
      const batch = writeBatch(db);

      const defaultSender =
        customerProfile?.phone?.trim() && customerProfile.phone.trim().length >= 5
          ? customerProfile.phone.trim()
          : 'Not Required';

      batch.set(doc(db, 'walletTopups', topupId), {
        id: topupId,
        customerUid: firebaseUser.uid,
        customerName: (customerProfile?.displayName || firebaseUser.displayName || 'Customer').slice(0, 100),
        customerEmail: (firebaseUser.email || '').slice(0, 160),
        amount: numAmount,
        paymentMethodId: selectedMethod.id,
        paymentMethodName: selectedMethod.name.slice(0, 60),
        senderNumber: defaultSender.slice(0, 40),
        trxId: trxId.trim().toUpperCase().slice(0, 64),
        trxKey,
        screenshotUrl: '',
        status: 'pending',
        adminNote: '',
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, 'trxRegistry', trxKey), {
        trxKey,
        trxId: trxId.trim().toUpperCase().slice(0, 64),
        orderId: topupId,
        customerUid: firebaseUser.uid,
        paymentMethodId: selectedMethod.id,
        amount: numAmount,
        status: 'pending',
        createdAt: now,
      });

      await batch.commit();

      const submittedTrx = trxId.trim().toUpperCase();
      const submittedMethod = selectedMethod.name;
      void (async () => {
        try {
          const token = await firebaseUser.getIdToken();
          await fetch('/api/notify/admin', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              type: 'deposit',
              details: {
                amount: formatCurrency(numAmount),
                paymentMethod: submittedMethod,
                trxId: submittedTrx,
                customerName: customerProfile?.displayName || firebaseUser.displayName || 'Customer',
                customerEmail: firebaseUser.email || '',
              },
            }),
          });
        } catch {
          // Non-blocking notification failure should not block deposit confirmation
        }
      })();

      setTrxId('');
      setSuccessMsg(`Deposit request for ${formatCurrency(numAmount)} submitted! Wallet balance updates automatically once verified.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('already exists')) {
        setError('Unable to submit deposit: verify your TrxID is unique and your account is active.');
      } else {
        handleFirestoreError(err, OperationType.WRITE, 'walletTopups');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        {/* Wallet Header Card */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 flex items-center justify-between gap-4 shadow-xs">
          <div>
            <span className="text-xs text-slate-300 block">Current Wallet Balance</span>
            <p className="text-2xl sm:text-3xl font-extrabold font-display tabular-nums mt-0.5">
              {formatCurrency(customerProfile?.walletBalance ?? 0)}
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
        </div>

        {!firebaseUser && (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-3 shadow-xs">
            <h1 className="text-lg font-bold text-slate-900 font-display">Sign in to Add Money</h1>
            <p className="text-xs sm:text-sm text-slate-600">
              Sign in with Google so approved deposits are credited directly to your wallet.
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer">
              Sign in with Google
            </button>
          </div>
        )}

        {/* Add Money Form Card (Matching SRBD Screenshot) */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-6 space-y-5 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 font-display">
              Add Money
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Deposit via bKash or Nagad and use your balance for instant UID top-ups.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs sm:text-sm font-bold text-slate-800">Amount (৳)</label>
            <input
              type="number"
              min={10}
              max={500000}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESET_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(String(val))}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    Number(amount) === val
                      ? 'bg-cyan-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}>
                  ৳{val}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="block text-xs sm:text-sm font-bold text-slate-800">
              Payment Gateway
            </label>
            {activeMethods.length === 0 ? (
              <p className="text-xs text-red-600">
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
                      className={`p-3.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-2 ${
                        active
                          ? 'border-cyan-500 bg-cyan-50/60 ring-2 ring-cyan-500/20 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}>
                      <PaymentMethodLogo name={method.name} logoUrl={method.logoUrl} size="md" />
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-slate-900 block truncate">
                          {method.name}
                        </span>
                        <span className="text-[11px] text-slate-500 block">{method.accountType}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedMethod && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <PaymentMethodLogo name={selectedMethod.name} logoUrl={selectedMethod.logoUrl} size="md" />
                  <div className="min-w-0">
                    <span className="text-xs text-slate-500 block">
                      Send {formatCurrency(Number(amount) || 0)} to ({selectedMethod.name} {selectedMethod.accountType})
                    </span>
                    <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                      {selectedMethod.accountNumber}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                  <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {selectedMethod.instructions && (
                <p className="text-xs text-slate-600 whitespace-pre-line border-t border-slate-200 pt-2">
                  {selectedMethod.instructions}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Transaction ID (TrxID) *
            </label>
            <input
              type="text"
              required
              value={trxId}
              onChange={(e) => setTrxId(e.target.value)}
              placeholder="Enter Transaction ID (TrxID)"
              className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2 text-xs text-emerald-700 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !firebaseUser || activeMethods.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-bold cursor-pointer transition-colors">
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Submitting Deposit...
              </>
            ) : (
              <>
                <PlusCircle className="w-4 h-4" /> Add Money
              </>
            )}
          </button>
        </form>

        {/* Recent Deposit History */}
        {firebaseUser && (
          <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3 shadow-xs">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
              Deposit Requests
            </h2>
            {topups.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No wallet deposit requests submitted yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {topups.map((t) => (
                  <div key={t.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(t.amount)} · {t.paymentMethodName}
                      </p>
                      <p className="text-xs font-mono text-slate-500 truncate">
                        TrxID: {t.trxId} · {new Date(timestampToMillis(t.createdAt)).toLocaleString()}
                      </p>
                      {t.adminNote && (
                        <p className="text-xs text-slate-600 mt-0.5">{t.adminNote}</p>
                      )}
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold capitalize shrink-0 ${
                        t.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : t.status === 'rejected'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                      {t.status}
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
