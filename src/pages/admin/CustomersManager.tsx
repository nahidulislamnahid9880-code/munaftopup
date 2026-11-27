import React, {useEffect, useMemo, useState} from 'react';
import {
  Ban,
  CheckCircle2,
  Eye,
  MessageSquare,
  Send,
  Users,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {CustomerProfile, Order, SupportTicket} from '../../types';
import {AdminLayout} from '../../components/admin/AdminLayout';

export function CustomersManager() {
  const {adminUser, firebaseUser, adminFetch} = useAuth();
  const canEdit = adminUser?.role === 'super_admin' || adminUser?.permissions.customers;

  const [tab, setTab] = useState<'customers' | 'tickets'>('customers');
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerProfile | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [replyTarget, setReplyTarget] = useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (!firebaseUser || !canEdit) return;
    const unsubCust = onSnapshot(
      collection(db, 'customers'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as CustomerProfile);
        setCustomers(list);
        setSelectedCustomer((prev) => (prev ? list.find((c) => c.uid === prev.uid) || null : null));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers'),
    );
    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      (snap) => setOrders(snap.docs.map((d) => d.data() as Order)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders'),
    );
    const unsubTickets = onSnapshot(
      query(collection(db, 'tickets'), orderBy('createdAt', 'desc')),
      (snap) => setTickets(snap.docs.map((d) => d.data() as SupportTicket)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'tickets'),
    );

    return () => {
      unsubCust();
      unsubOrders();
      unsubTickets();
    };
  }, [firebaseUser, canEdit]);

  const customerStats = useMemo(() => {
    const map = new Map<string, {count: number; spent: number}>();
    for (const o of orders) {
      const prev = map.get(o.customerUid) || {count: 0, spent: 0};
      prev.count += 1;
      if (o.orderStatus !== 'cancelled' && o.orderStatus !== 'expired' && o.paymentStatus !== 'rejected') {
        prev.spent += Number(o.totalAmount || 0);
      }
      map.set(o.customerUid, prev);
    }
    return map;
  }, [orders]);

  const handleToggleSuspend = async (cust: CustomerProfile, suspend: boolean) => {
    if (!adminUser || !canEdit) return;
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      batch.update(doc(db, 'customers', cust.uid), {
        suspended: suspend,
        suspendedReason: suspend ? (suspendReason.trim() || 'Suspended by administrator') : '',
        updatedAt: now,
      });
      const logId = `log_${Date.now()}`;
      batch.set(doc(db, 'auditLogs', logId), {
        id: logId,
        actorEmail: adminUser.email,
        actorRole: adminUser.role,
        action: suspend ? 'CUSTOMER_SUSPENDED' : 'CUSTOMER_UNBLOCKED',
        targetType: 'customer',
        targetId: cust.uid,
        details: `${cust.email} · ${suspend ? suspendReason || 'Suspended' : 'Unblocked'}`,
        createdAt: now,
      });
      await batch.commit();
      setSuspendReason('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `customers/${cust.uid}`);
    }
  };

  const handleReplyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyTarget || !adminUser || !canEdit || !replyText.trim()) return;
    try {
      const now = serverTimestamp();
      await updateDoc(doc(db, 'tickets', replyTarget.id), {
        status: 'replied',
        adminReply: replyText.trim().slice(0, 2000),
        repliedBy: adminUser.email,
        updatedAt: now,
      });
      if (replyTarget.customerEmail) {
        void adminFetch('/api/admin/customer-email-event', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            toEmail: replyTarget.customerEmail,
            customerName: replyTarget.customerName,
            subject: `Support Reply: ${replyTarget.subject}`,
            headline: 'Support Ticket Updated',
            message: replyText.trim().slice(0, 1500),
            rows: [
              {label: 'Ticket ID', value: replyTarget.id},
              {label: 'Subject', value: replyTarget.subject},
              ...(replyTarget.orderNumber ? [{label: 'Order', value: replyTarget.orderNumber}] : []),
              {label: 'Replied By', value: adminUser.email},
            ],
          }),
        }).catch(() => null);
      }
      setReplyTarget(null);
      setReplyText('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${replyTarget.id}`);
    }
  };

  if (!canEdit) {
    return (
      <AdminLayout title="Customers & Support">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to manage customers.
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Customer Management & Support">
      <div className="space-y-6">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setTab('customers')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'customers'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}>
            <Users className="w-3.5 h-3.5" /> Customers ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('tickets')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'tickets'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}>
            <MessageSquare className="w-3.5 h-3.5" /> Support Tickets (
            {tickets.filter((t) => t.status === 'open').length} open)
          </button>
        </div>

        {/* Customers Table */}
        {tab === 'customers' && (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            {customers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No registered customers yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">Wallet</th>
                      <th className="px-4 py-3 font-medium">Orders</th>
                      <th className="px-4 py-3 font-medium">Total Spent</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {customers.map((c) => {
                      const st = customerStats.get(c.uid) || {count: 0, spent: 0};
                      return (
                        <tr key={c.uid}>
                          <td className="px-4 py-3">
                            <p className="font-semibold">{c.displayName || 'Customer'}</p>
                            <p className="text-xs text-slate-500">{c.email}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{c.phone || '—'}</td>
                          <td className="px-4 py-3 font-semibold text-cyan-600 dark:text-cyan-400 tabular-nums">
                            {formatCurrency(c.walletBalance || 0)}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{st.count}</td>
                          <td className="px-4 py-3 font-semibold tabular-nums">
                            {formatCurrency(st.spent)}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            {c.suspended ? (
                              <span className="text-red-600">Suspended</span>
                            ) : (
                              <span className="text-emerald-600">Active</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedCustomer(c)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                              <Eye className="w-3.5 h-3.5" /> Profile &amp; Orders
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Support Tickets */}
        {tab === 'tickets' && (
          <div className="space-y-3">
            {tickets.length === 0 ? (
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
                No customer support tickets yet.
              </div>
            ) : (
              tickets.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold">{t.subject}</h3>
                      <p className="text-xs text-slate-500">
                        {t.customerName} ({t.customerEmail})
                        {t.orderNumber && ` · Order ${t.orderNumber}`} ·{' '}
                        <span className="capitalize font-semibold">{t.status}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTarget(t);
                        setReplyText(t.adminReply || '');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer">
                      <Send className="w-3.5 h-3.5" /> Reply
                    </button>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
                    {t.message}
                  </p>
                  {t.adminReply && (
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 text-xs">
                      <span className="font-semibold text-blue-600 block mb-0.5">
                        Admin Reply ({t.repliedBy})
                      </span>
                      <p className="text-sm">{t.adminReply}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Customer Detail & Suspension Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold font-display">
                  {selectedCustomer.displayName || 'Customer'}
                </h2>
                <p className="text-xs text-slate-500">{selectedCustomer.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  Account State:{' '}
                  {selectedCustomer.suspended ? (
                    <span className="text-red-600">Suspended</span>
                  ) : (
                    <span className="text-emerald-600">Active</span>
                  )}
                </span>
                {selectedCustomer.suspended ? (
                  <button
                    type="button"
                    onClick={() => void handleToggleSuspend(selectedCustomer, false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Unblock Account
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleToggleSuspend(selectedCustomer, true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer">
                    <Ban className="w-3.5 h-3.5" /> Suspend Account
                  </button>
                )}
              </div>
              {!selectedCustomer.suspended && (
                <input
                  type="text"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Optional suspension reason..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              )}
              {selectedCustomer.suspended && selectedCustomer.suspendedReason && (
                <p className="text-xs text-red-600">Reason: {selectedCustomer.suspendedReason}</p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-bold">Customer Order History</h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                {orders
                  .filter((o) => o.customerUid === selectedCustomer.uid)
                  .map((o) => (
                    <div key={o.id} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono font-semibold">{o.orderNumber}</span> ·{' '}
                        <span>{o.packageName}</span>
                        <span className="block text-slate-500">
                          {new Date(timestampToMillis(o.createdAt)).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold tabular-nums block">
                          {formatCurrency(o.totalAmount)}
                        </span>
                        <span className="capitalize text-slate-500">{o.orderStatus}</span>
                      </div>
                    </div>
                  ))}
                {orders.filter((o) => o.customerUid === selectedCustomer.uid).length === 0 && (
                  <p className="p-4 text-xs text-slate-500 text-center">No orders found.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reply Ticket Modal */}
      {replyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
          <form
            onSubmit={handleReplyTicket}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold font-display">
                Reply to: {replyTarget.subject}
              </h2>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">{replyTarget.message}</p>
            <textarea
              rows={4}
              required
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write your official support response..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer">
                Send Reply
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  );
}
