import React, {useEffect, useState} from 'react';
import {Edit3, Plus, Save, Trash2, X} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {PaymentHistoryEntry, PaymentMethod} from '../../types';
import {ImageUploadField} from '../../components/ImageUploadField';
import {AdminLayout} from '../../components/admin/AdminLayout';

export function PaymentsManager() {
  const {adminUser, firebaseUser} = useAuth();
  const {paymentMethods} = useStore();
  const canEdit = adminUser?.role === 'super_admin' || adminUser?.permissions.payments;

  const [tab, setTab] = useState<'methods' | 'history' | 'trx'>('methods');
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<PaymentHistoryEntry[]>([]);
  const [trxEntries, setTrxEntries] = useState<
    Array<{trxKey: string; trxId: string; orderId: string; amount: number; status: string; createdAt: unknown}>
  >([]);

  useEffect(() => {
    if (!firebaseUser || !canEdit) return;
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
    return () => {
      unsubHist();
      unsubTrx();
    };
  }, [firebaseUser, canEdit]);

  const handleSaveMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !canEdit || !adminUser) return;
    setSaving(true);
    try {
      const now = serverTimestamp();
      const payload: PaymentMethod = {
        ...editing,
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
      handleFirestoreError(err, OperationType.WRITE, `paymentMethods/${editing.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMethod = async (m: PaymentMethod) => {
    if (!canEdit || !adminUser) return;
    try {
      await deleteDoc(doc(db, 'paymentMethods', m.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `paymentMethods/${m.id}`);
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

  return (
    <AdminLayout title="Payment Management & TrxID Audit">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('methods')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'methods'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Payment Numbers ({paymentMethods.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'history'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Verification History ({history.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('trx')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'trx'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Duplicate TrxID Registry ({trxEntries.length})
            </button>
          </div>

          {tab === 'methods' && (
            <button
              type="button"
              onClick={() => {
                setIsNew(true);
                setEditing({
                  id: `pm_${Date.now()}`,
                  name: '',
                  accountNumber: '',
                  accountType: 'Personal',
                  instructions: '',
                  logoUrl: '',
                  active: true,
                  displayOrder: paymentMethods.length + 1,
                });
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
              <Plus className="w-4 h-4" /> Add Payment Method
            </button>
          )}
        </div>

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

                <ImageUploadField
                  label="Provider Logo (Optional)"
                  value={editing.logoUrl}
                  onChange={(url) => setEditing({...editing, logoUrl: url})}
                  compact
                />

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
                    <div>
                      <h3 className="text-base font-bold font-display">
                        {m.name}{' '}
                        <span className="text-xs font-normal text-slate-500">({m.accountType})</span>
                      </h3>
                      <p className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5">
                        {m.accountNumber}
                      </p>
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
                      <th className="px-4 py-3 font-medium">Order</th>
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
                          <span className="block font-mono text-slate-500">{h.senderNumber}</span>
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
                      <th className="px-4 py-3 font-medium">Order Ref</th>
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
