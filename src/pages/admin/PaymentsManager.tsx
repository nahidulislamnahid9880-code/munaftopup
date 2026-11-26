import React, {useEffect, useState} from 'react';
import {
  CheckCircle2,
  Edit3,
  Plus,
  Save,
  Trash2,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  auth,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {
  CustomerProfile,
  PaymentHistoryEntry,
  PaymentMethod,
  SmsPaymentRecord,
  WalletTopup,
} from '../../types';
import {ImageUploadField} from '../../components/ImageUploadField';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {PaymentMethodLogo} from '../../components/PaymentMethodLogo';
import {AdminLayout} from '../../components/admin/AdminLayout';

const GATEWAY_PRESETS = [
  {
    name: 'bKash',
    accountType: 'Personal' as const,
    instructions: 'Open bKash App → Send Money → Enter the number above → Copy and enter your TrxID below.',
  },
  {
    name: 'Nagad',
    accountType: 'Personal' as const,
    instructions: 'Open Nagad App → Send Money → Enter the number above → Copy and enter your TrxID below.',
  },
  {
    name: 'Upay',
    accountType: 'Personal' as const,
    instructions: 'Open Upay App → Send Money → Enter the number above → Copy and enter your TrxID below.',
  },
  {
    name: 'Rocket',
    accountType: 'Personal' as const,
    instructions: 'Open Rocket App → Send Money → Enter the number above → Copy and enter your TrxID below.',
  },
];

export function PaymentsManager() {
  const {adminUser, firebaseUser, adminLinkGoogleForSync} = useAuth();
  const {paymentMethods} = useStore();
  const canEdit = adminUser?.role === 'super_admin' || adminUser?.permissions.payments;

  const [tab, setTab] = useState<'topups' | 'methods' | 'sms' | 'history' | 'trx'>('topups');
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingTopupId, setProcessingTopupId] = useState<string | null>(null);
  const [topupNotes, setTopupNotes] = useState<Record<string, string>>({});

  const [topups, setTopups] = useState<WalletTopup[]>([]);
  const [smsPayments, setSmsPayments] = useState<SmsPaymentRecord[]>([]);
  const [history, setHistory] = useState<PaymentHistoryEntry[]>([]);
  const [trxEntries, setTrxEntries] = useState<
    Array<{trxKey: string; trxId: string; orderId: string; amount: number; status: string; createdAt: unknown}>
  >([]);

  useEffect(() => {
    if (!firebaseUser || !canEdit) return;
    const unsubTopups = onSnapshot(
      query(collection(db, 'walletTopups'), orderBy('createdAt', 'desc')),
      (snap) => setTopups(snap.docs.map((d) => d.data() as WalletTopup)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'walletTopups'),
    );
    const unsubHist = onSnapshot(
      query(collection(db, 'paymentHistory'), orderBy('createdAt', 'desc')),
      (snap) => setHistory(snap.docs.map((d) => d.data() as PaymentHistoryEntry)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'paymentHistory'),
    );
    const unsubTrx = onSnapshot(
      query(collection(db, 'trxRegistry'), orderBy('createdAt', 'desc')),
      (snap) =>
        setTrxEntries(
          snap.docs.map(
            (d) =>
              d.data() as {
                trxKey: string;
                trxId: string;
                orderId: string;
                amount: number;
                status: string;
                createdAt: unknown;
              },
          ),
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'trxRegistry'),
    );
    const unsubSms = onSnapshot(
      query(collection(db, 'sms_payments'), orderBy('receivedAt', 'desc')),
      (snap) => setSmsPayments(snap.docs.map((d) => d.data() as SmsPaymentRecord)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'sms_payments'),
    );
    return () => {
      unsubTopups();
      unsubHist();
      unsubTrx();
      unsubSms();
    };
  }, [firebaseUser, canEdit]);

  const [methodError, setMethodError] = useState('');

  const startPresetMethod = (preset?: (typeof GATEWAY_PRESETS)[number]) => {
    setMethodError('');
    setIsNew(true);
    setEditing({
      id: `pm_${Date.now()}`,
      name: preset?.name || '',
      accountNumber: '',
      accountType: preset?.accountType || 'Personal',
      instructions: preset?.instructions || '',
      logoUrl: '',
      active: true,
      displayOrder: paymentMethods.length + 1,
    });
  };

  const handleSaveMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !canEdit || !adminUser) return;
    setMethodError('');
    if (!editing.name.trim()) {
      setMethodError('Provider name is required.');
      return;
    }
    if (editing.accountNumber.trim().length < 3) {
      setMethodError('Account number must be at least 3 characters.');
      return;
    }

    setSaving(true);
    try {
      const currentEmail = auth.currentUser?.email?.toLowerCase();
      if (!auth.currentUser || currentEmail !== adminUser.email.toLowerCase()) {
        await adminLinkGoogleForSync();
      }
      const now = serverTimestamp();
      const payload: PaymentMethod = {
        ...editing,
        name: editing.name.trim().slice(0, 60),
        accountNumber: editing.accountNumber.trim().slice(0, 40),
        instructions: editing.instructions.trim().slice(0, 1500),
        logoUrl: editing.logoUrl.trim().slice(0, 1000),
        displayOrder: Number(editing.displayOrder) || 1,
        updatedAt: now,
      };
      await setDoc(doc(db, 'paymentMethods', payload.id), payload);
      const logId = `log_${Date.now()}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        id: logId,
        actorEmail: adminUser.email,
        actorRole: adminUser.role,
        action: isNew ? 'PAYMENT_METHOD_CREATED' : 'PAYMENT_METHOD_UPDATED',
        targetType: 'paymentMethod',
        targetId: payload.id,
        details: `${payload.name} (${payload.accountNumber})`,
        createdAt: now,
      });
      setEditing(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMethodError(msg || 'Failed to save payment method.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMethod = async (m: PaymentMethod) => {
    if (!canEdit || !adminUser) return;
    try {
      const currentEmail = auth.currentUser?.email?.toLowerCase();
      if (!auth.currentUser || currentEmail !== adminUser.email.toLowerCase()) {
        await adminLinkGoogleForSync();
      }
      await deleteDoc(doc(db, 'paymentMethods', m.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `paymentMethods/${m.id}`);
    }
  };

  const handleDecideTopup = async (topup: WalletTopup, decision: 'approved' | 'rejected') => {
    if (!canEdit || !adminUser || topup.status !== 'pending') return;
    setProcessingTopupId(topup.id);
    try {
      const note = (topupNotes[topup.id] || '').trim().slice(0, 500);
      const now = serverTimestamp();
      const batch = writeBatch(db);

      if (decision === 'approved') {
        const custRef = doc(db, 'customers', topup.customerUid);
        const custSnap = await getDoc(custRef);
        const currentBalance = custSnap.exists()
          ? Number((custSnap.data() as Partial<CustomerProfile>).walletBalance || 0)
          : 0;
        const nextBalance = Number((currentBalance + topup.amount).toFixed(2));
        batch.update(custRef, {
          walletBalance: nextBalance,
          updatedAt: now,
        });
      }

      batch.update(doc(db, 'walletTopups', topup.id), {
        status: decision,
        adminNote: note,
        updatedAt: now,
      });

      batch.update(doc(db, 'trxRegistry', topup.trxKey), {
        status: decision === 'approved' ? 'verified' : 'rejected',
      });

      const shortRef = `TOPUP-${topup.id.slice(-6).toUpperCase()}`;
      const histId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'paymentHistory', histId), {
        id: histId,
        orderId: topup.id,
        orderNumber: shortRef,
        trxId: topup.trxId,
        paymentMethodName: topup.paymentMethodName,
        senderNumber: topup.senderNumber,
        amount: topup.amount,
        action: decision,
        note: note || `Wallet Add Money ${decision}`,
        adminEmail: adminUser.email,
        createdAt: now,
      });

      const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        customerUid: topup.customerUid,
        orderId: topup.id,
        orderNumber: shortRef,
        title: decision === 'approved' ? 'Wallet Credited' : 'Deposit Rejected',
        message:
          decision === 'approved'
            ? `${formatCurrency(topup.amount)} has been added to your wallet balance.`
            : `Your wallet deposit request (${topup.trxId}) was rejected. ${note}`,
        read: false,
        createdAt: now,
      });

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'auditLogs', logId), {
        id: logId,
        actorEmail: adminUser.email,
        actorRole: adminUser.role,
        action: `WALLET_TOPUP_${decision.toUpperCase()}`,
        targetType: 'walletTopup',
        targetId: topup.id,
        details: `${topup.customerEmail} · ${formatCurrency(topup.amount)} · TrxID ${topup.trxId}`,
        createdAt: now,
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `walletTopups/${topup.id}`);
    } finally {
      setProcessingTopupId(null);
    }
  };

  if (!canEdit) {
    return (
      <AdminLayout title="Payment Management">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to manage payments.
        </div>
      </AdminLayout>
    );
  }

  const pendingTopupsCount = topups.filter((t) => t.status === 'pending').length;

  return (
    <AdminLayout title="Payment Management & Wallet Deposits">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl overflow-x-auto">
            <button
              type="button"
              onClick={() => setTab('topups')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                tab === 'topups'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              <Wallet className="w-3.5 h-3.5" /> Wallet Top-Ups ({pendingTopupsCount} pending)
            </button>
            <button
              type="button"
              onClick={() => setTab('methods')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                tab === 'methods'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Payment Numbers ({paymentMethods.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('sms')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                tab === 'sms'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              SMS Auto-Payments ({smsPayments.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                tab === 'history'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Verification History ({history.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('trx')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                tab === 'trx'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              TrxID Registry ({trxEntries.length})
            </button>
          </div>

          {tab === 'methods' && (
            <div className="flex flex-wrap items-center gap-2">
              {GATEWAY_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => startPresetMethod(preset)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> {preset.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => startPresetMethod()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                <Plus className="w-4 h-4" /> Add Custom Method
              </button>
            </div>
          )}
        </div>

        {/* Tab: Wallet Top-Ups */}
        {tab === 'topups' && (
          <div className="space-y-4">
            {topups.length === 0 ? (
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center text-sm text-slate-500">
                No customer Add Money deposit requests yet.
              </div>
            ) : (
              topups.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-extrabold font-display tabular-nums">
                          {formatCurrency(t.amount)}
                        </span>
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                          via {t.paymentMethodName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {t.customerName} ({t.customerEmail}) ·{' '}
                        {new Date(timestampToMillis(t.createdAt)).toLocaleString()}
                      </p>
                      <p className="text-xs font-mono mt-1">
                        TrxID: <span className="font-bold">{t.trxId}</span>
                        {t.senderNumber && t.senderNumber !== 'Not Required' && (
                          <>
                            {' · '}Sender: <span>{t.senderNumber}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize ${
                        t.status === 'approved'
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                          : t.status === 'rejected'
                            ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400'
                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400'
                      }`}>
                      {t.status}
                    </span>
                  </div>

                  {t.screenshotUrl && (
                    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 max-h-56 bg-slate-950">
                      <ImageWithFallback
                        src={t.screenshotUrl}
                        alt="Deposit screenshot"
                        className="w-full h-full object-contain max-h-56"
                      />
                    </div>
                  )}

                  {t.status === 'pending' ? (
                    <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <input
                        type="text"
                        value={topupNotes[t.id] || ''}
                        onChange={(e) =>
                          setTopupNotes((prev) => ({...prev, [t.id]: e.target.value}))
                        }
                        placeholder="Optional admin note..."
                        className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={processingTopupId === t.id}
                          onClick={() => void handleDecideTopup(t, 'approved')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-40">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve &amp; Credit
                        </button>
                        <button
                          type="button"
                          disabled={processingTopupId === t.id}
                          onClick={() => void handleDecideTopup(t, 'rejected')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-40">
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    t.adminNote && (
                      <p className="text-xs text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
                        Admin Note: {t.adminNote}
                      </p>
                    )
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Payment Methods */}
        {tab === 'methods' && (
          <div className="space-y-4">
            {editing && (
              <form
                onSubmit={handleSaveMethod}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold font-display">
                    {isNew ? 'New Payment Method' : `Edit ${editing.name}`}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">Provider Name *</label>
                    <input
                      type="text"
                      required
                      value={editing.name}
                      onChange={(e) => setEditing({...editing, name: e.target.value})}
                      placeholder="bKash, Nagad, Rocket..."
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Account Number *</label>
                    <input
                      type="text"
                      required
                      value={editing.accountNumber}
                      onChange={(e) => setEditing({...editing, accountNumber: e.target.value})}
                      placeholder="01XXXXXXXXX"
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Account Type</label>
                    <select
                      value={editing.accountType}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          accountType: e.target.value as PaymentMethod['accountType'],
                        })
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                      <option value="Personal">Personal</option>
                      <option value="Merchant">Merchant</option>
                      <option value="Agent">Agent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Display Order</label>
                    <input
                      type="number"
                      min={0}
                      value={editing.displayOrder}
                      onChange={(e) =>
                        setEditing({...editing, displayOrder: Number(e.target.value)})
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">
                    Customer Payment Instructions
                  </label>
                  <textarea
                    rows={3}
                    value={editing.instructions}
                    onChange={(e) => setEditing({...editing, instructions: e.target.value})}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  <div className="lg:col-span-9">
                    <ImageUploadField
                      label="Provider Logo (Upload custom logo or leave blank for auto bKash / Nagad / Upay / Rocket logo)"
                      value={editing.logoUrl}
                      onChange={(url) => setEditing({...editing, logoUrl: url})}
                    />
                  </div>
                  <div className="lg:col-span-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <PaymentMethodLogo name={editing.name || 'Gateway'} logoUrl={editing.logoUrl} size="md" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-500 block">Gateway Preview</span>
                      <span className="text-xs font-bold truncate block">
                        {editing.name || 'Provider'}
                      </span>
                    </div>
                  </div>
                </div>

                {methodError && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">{methodError}</p>
                )}

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editing.active}
                      onChange={(e) => setEditing({...editing, active: e.target.checked})}
                    />
                    Active at Checkout
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                    <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save Method'}
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {paymentMethods.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <PaymentMethodLogo name={m.name} logoUrl={m.logoUrl} size="md" />
                      <div className="min-w-0">
                        <h3 className="text-base font-bold font-display truncate">
                          {m.name}{' '}
                          <span className="text-xs font-normal text-slate-500">({m.accountType})</span>
                        </h3>
                        <p className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5 truncate">
                          {m.accountNumber}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          m.active
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}>
                        {m.active ? 'Active' : 'Disabled'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsNew(false);
                          setEditing(m);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteMethod(m)}
                        className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-line">
                    {m.instructions}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: SMS Auto-Payments */}
        {tab === 'sms' && (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            {smsPayments.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No automated SMS payments received via /api/sms-webhook yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">TrxID</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Order Ref</th>
                      <th className="px-4 py-3 font-medium">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {smsPayments.map((sp) => (
                      <tr key={sp.trxId}>
                        <td className="px-4 py-3 font-mono font-semibold">{sp.trxId}</td>
                        <td className="px-4 py-3 text-xs font-semibold">{sp.method}</td>
                        <td className="px-4 py-3 font-semibold tabular-nums">
                          {formatCurrency(sp.amount)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              sp.used
                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                            }`}>
                            {sp.used ? 'Used' : 'Available'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {sp.usedOrderNumber || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                          {sp.receivedAt ? new Date(timestampToMillis(sp.receivedAt)).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: Payment Verification History */}
        {tab === 'history' && (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            {history.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No payment verification actions logged yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Reference</th>
                      <th className="px-4 py-3 font-medium">Method / Sender</th>
                      <th className="px-4 py-3 font-medium">TrxID</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Decision</th>
                      <th className="px-4 py-3 font-medium">Verified By</th>
                      <th className="px-4 py-3 font-medium">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-3 font-mono font-semibold">{h.orderNumber}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-semibold">{h.paymentMethodName}</span>
                          {h.senderNumber && h.senderNumber !== 'Not Required' && (
                            <span className="block font-mono text-slate-500">{h.senderNumber}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{h.trxId}</td>
                        <td className="px-4 py-3 font-semibold tabular-nums">
                          {formatCurrency(h.amount)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold capitalize">
                          <span
                            className={
                              h.action === 'approved' ? 'text-emerald-600' : 'text-red-600'
                            }>
                            {h.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">{h.adminEmail}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                          {new Date(timestampToMillis(h.createdAt)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: TrxID Registry */}
        {tab === 'trx' && (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            {trxEntries.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No Transaction IDs registered yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">TrxID</th>
                      <th className="px-4 py-3 font-medium">Lock Key</th>
                      <th className="px-4 py-3 font-medium">Reference ID</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {trxEntries.map((t) => (
                      <tr key={t.trxKey}>
                        <td className="px-4 py-3 font-mono font-semibold">{t.trxId}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.trxKey}</td>
                        <td className="px-4 py-3 font-mono text-xs">{t.orderId}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold">
                          {formatCurrency(t.amount)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold capitalize">{t.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
