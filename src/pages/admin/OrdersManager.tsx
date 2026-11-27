import React, {useEffect, useMemo, useState} from 'react';
import {
  CheckCircle2,
  Eye,
  Search,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
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
import type {Order, OrderStatus} from '../../types';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {AdminLayout} from '../../components/admin/AdminLayout';

export function OrdersManager() {
  const {adminUser, firebaseUser, adminFetch} = useAuth();
  const canOrders = adminUser?.role === 'super_admin' || adminUser?.permissions.orders;
  const canPayments = adminUser?.role === 'super_admin' || adminUser?.permissions.payments;

  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [adminNote, setAdminNote] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [notifText, setNotifText] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!firebaseUser || (!canOrders && !canPayments)) return;
    const unsub = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Order);
        setOrders(list);
        setSelectedOrder((prev) => (prev ? list.find((o) => o.id === prev.id) || null : null));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders'),
    );
    return () => unsub();
  }, [firebaseUser, canOrders, canPayments]);

  const filtered = useMemo(() => {
    return orders
      .filter((o) => (statusFilter === 'all' ? true : o.orderStatus === statusFilter))
      .filter((o) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          o.orderNumber.toLowerCase().includes(q) ||
          o.playerUid.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerEmail.toLowerCase().includes(q) ||
          o.customerPhone.toLowerCase().includes(q) ||
          o.trxId.toLowerCase().includes(q)
        );
      });
  }, [orders, statusFilter, searchQuery]);

  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    setAdminNote(order.adminNote || '');
    setVoucherCode(order.voucherCode || '');
    setNotifText('');
    setFeedback('');
  };

  const notifyCustomerOrderUpdate = async (params: {
    order: Order;
    orderStatus: OrderStatus;
    paymentStatus: Order['paymentStatus'];
    voucherCode?: string;
    note?: string;
  }): Promise<{telegramSent: boolean; emailSent: boolean}> => {
    try {
      const res = await adminFetch('/api/admin/orders/notify-customer', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          orderNumber: params.order.orderNumber,
          orderStatus: params.orderStatus,
          paymentStatus: params.paymentStatus,
          productName: params.order.productName,
          packageName: params.order.packageName,
          playerUid: params.order.playerUid,
          serverId: params.order.serverId,
          totalAmount: params.order.totalAmount,
          paymentMethodName: params.order.paymentMethodName,
          trxId: params.order.trxId,
          voucherCode: params.voucherCode,
          note: params.note,
          customerUid: params.order.customerUid,
          customerEmail: params.order.customerEmail,
          customerName: params.order.customerName,
        }),
      });
      if (!res.ok) return {telegramSent: false, emailSent: false};
      const data = (await res.json()) as {telegramSent?: boolean; sent?: boolean; emailSent?: boolean};
      return {
        telegramSent: Boolean(data.telegramSent ?? data.sent),
        emailSent: Boolean(data.emailSent),
      };
    } catch {
      return {telegramSent: false, emailSent: false};
    }
  };

  const handleVerifyPayment = async (order: Order, decision: 'approved' | 'rejected') => {
    if (!adminUser || !canPayments) return;
    setProcessingId(order.id);
    setFeedback('');
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      const nextPaymentStatus = decision === 'approved' ? 'verified' : 'rejected';
      const nextOrderStatus: OrderStatus =
        decision === 'approved'
          ? order.orderStatus === 'pending'
            ? 'processing'
            : order.orderStatus
          : 'cancelled';
      const msg =
        decision === 'approved'
          ? 'Payment verified. Your top-up is now processing.'
          : `Payment rejected (${adminNote || 'TrxID verification failed'}).`;

      batch.update(doc(db, 'orders', order.id), {
        paymentStatus: nextPaymentStatus,
        orderStatus: nextOrderStatus,
        adminNote: adminNote.slice(0, 1000),
        notificationMessage: msg,
        updatedAt: now,
      });

      batch.update(doc(db, 'orderTracking', order.orderNumber), {
        paymentStatus: nextPaymentStatus,
        orderStatus: nextOrderStatus,
        notificationMessage: msg,
        updatedAt: now,
      });

      batch.update(doc(db, 'trxRegistry', order.trxKey), {
        status: nextPaymentStatus,
      });

      const histId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'paymentHistory', histId), {
        id: histId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        trxId: order.trxId,
        paymentMethodName: order.paymentMethodName,
        senderNumber: order.senderNumber,
        amount: order.totalAmount,
        action: decision,
        note: adminNote.slice(0, 500),
        adminEmail: adminUser.email,
        createdAt: now,
      });

      const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        customerUid: order.customerUid,
        orderId: order.id,
        orderNumber: order.orderNumber,
        title: decision === 'approved' ? 'Payment Approved' : 'Payment Rejected',
        message: msg,
        read: false,
        createdAt: now,
      });

      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'auditLogs', logId), {
        id: logId,
        actorEmail: adminUser.email,
        actorRole: adminUser.role,
        action: `PAYMENT_${decision.toUpperCase()}`,
        targetType: 'order',
        targetId: order.orderNumber,
        details: `TrxID ${order.trxId} ${decision}. ${adminNote}`,
        createdAt: now,
      });

      await batch.commit();
      const notifyRes = await notifyCustomerOrderUpdate({
        order,
        orderStatus: nextOrderStatus,
        paymentStatus: nextPaymentStatus,
        note: msg,
      });
      const channels = [
        notifyRes.emailSent ? 'Email' : '',
        notifyRes.telegramSent ? 'Telegram' : '',
      ].filter(Boolean);
      setFeedback(
        `Payment marked as ${nextPaymentStatus}.${
          channels.length ? ` Customer notified via ${channels.join(' & ')}.` : ''
        }`,
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleUpdateOrderStatus = async (order: Order, nextStatus: OrderStatus) => {
    if (!adminUser || !canOrders) return;
    if (nextStatus === 'completed' && order.paymentStatus !== 'verified') {
      setFeedback('Verify payment first before manually marking an order as completed.');
      return;
    }
    setProcessingId(order.id);
    setFeedback('');
    try {
      const refundedAmount = await runTransaction(db, async (tx) => {
        const orderRef = doc(db, 'orders', order.id);
        const orderSnap = await tx.get(orderRef);
        const freshOrder = orderSnap.exists() ? (orderSnap.data() as Order) : order;
        const now = serverTimestamp();

        const isWalletOrder =
          freshOrder.paymentType === 'wallet' || freshOrder.paymentMethodId === 'wallet';
        const shouldRefundWallet =
          nextStatus === 'cancelled' &&
          isWalletOrder &&
          freshOrder.orderStatus !== 'cancelled' &&
          !freshOrder.walletRefunded &&
          Number(freshOrder.totalAmount || 0) > 0;

        let credited = 0;
        if (shouldRefundWallet) {
          const custRef = doc(db, 'customers', freshOrder.customerUid);
          const custSnap = await tx.get(custRef);
          if (custSnap.exists()) {
            const currentBal = Number(
              (custSnap.data() as {walletBalance?: number}).walletBalance || 0,
            );
            credited = Number(freshOrder.totalAmount || 0);
            const nextBal = Number((currentBal + credited).toFixed(2));
            tx.update(custRef, {
              walletBalance: nextBal,
              updatedAt: now,
            });
          }
        }

        const statusMessages: Record<OrderStatus, string> = {
          pending: 'Order is pending review.',
          processing: 'Top-up is currently being fulfilled to your Player UID.',
          completed: 'Diamonds / voucher fulfilled to your Player UID. Thank you!',
          cancelled:
            credited > 0
              ? `${adminNote ? `${adminNote} — ` : ''}${formatCurrency(credited)} has been refunded to your Wallet Balance.`
              : adminNote || 'Order cancelled by administrator.',
          expired:
            credited > 0
              ? `Order expired after 30 minutes pending — ${formatCurrency(credited)} refunded to Wallet Balance.`
              : adminNote || 'Order expired automatically after 30 minutes pending.',
        };
        const msg = notifText.trim() || statusMessages[nextStatus];

        const orderPatch: Record<string, unknown> = {
          orderStatus: nextStatus,
          voucherCode: voucherCode.trim().slice(0, 500),
          adminNote: adminNote.slice(0, 1000),
          notificationMessage: msg.slice(0, 500),
          updatedAt: now,
        };
        if (nextStatus === 'completed') {
          orderPatch.completedAt = now;
        }
        if (credited > 0) {
          orderPatch.walletRefunded = true;
        }

        tx.update(orderRef, orderPatch);

        tx.update(doc(db, 'orderTracking', freshOrder.orderNumber), {
          paymentStatus: freshOrder.paymentStatus,
          orderStatus: nextStatus,
          notificationMessage: msg.slice(0, 500),
          updatedAt: now,
        });

        const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(doc(db, 'notifications', notifId), {
          id: notifId,
          customerUid: freshOrder.customerUid,
          orderId: freshOrder.id,
          orderNumber: freshOrder.orderNumber,
          title:
            credited > 0
              ? 'Order Cancelled & Refunded'
              : `Order ${nextStatus.toUpperCase()}`,
          message: msg.slice(0, 500),
          read: false,
          createdAt: now,
        });

        const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        tx.set(doc(db, 'auditLogs', logId), {
          id: logId,
          actorEmail: adminUser.email,
          actorRole: adminUser.role,
          action:
            credited > 0
              ? 'ORDER_CANCELLED_WALLET_REFUNDED'
              : `ORDER_STATUS_${nextStatus.toUpperCase()}`,
          targetType: 'order',
          targetId: freshOrder.orderNumber,
          details:
            credited > 0
              ? `Cancelled wallet order and refunded ${formatCurrency(credited)} to customer wallet. Note: ${adminNote}`
              : `Set status=${nextStatus}. Note: ${adminNote}`,
          createdAt: now,
        });

        return credited;
      });

      const tgStatusMsg =
        notifText.trim() ||
        (nextStatus === 'cancelled'
          ? adminNote.trim() || 'Order cancelled by administrator.'
          : nextStatus === 'completed'
            ? 'Diamonds / voucher fulfilled to your Player UID.'
            : nextStatus === 'processing'
              ? 'Top-up is currently being fulfilled to your Player UID.'
              : '');

      const notifyRes = await notifyCustomerOrderUpdate({
        order,
        orderStatus: nextStatus,
        paymentStatus: order.paymentStatus,
        voucherCode: voucherCode.trim(),
        note: tgStatusMsg,
      });
      const channels = [
        notifyRes.emailSent ? 'Email' : '',
        notifyRes.telegramSent ? 'Telegram' : '',
      ].filter(Boolean);

      setFeedback(
        (refundedAmount > 0
          ? `Order cancelled & ${formatCurrency(refundedAmount)} automatically refunded to customer wallet.`
          : `Order status updated to ${nextStatus}.`) +
          (channels.length ? ` Customer notified via ${channels.join(' & ')}.` : ''),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleSendNoteAndNotification = async (order: Order) => {
    if (!adminUser || !canOrders) return;
    setProcessingId(order.id);
    setFeedback('');
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      const msg = notifText.trim() || order.notificationMessage || 'Order note updated by admin.';

      batch.update(doc(db, 'orders', order.id), {
        voucherCode: voucherCode.trim().slice(0, 500),
        adminNote: adminNote.slice(0, 1000),
        notificationMessage: msg.slice(0, 500),
        updatedAt: now,
      });

      batch.update(doc(db, 'orderTracking', order.orderNumber), {
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        notificationMessage: msg.slice(0, 500),
        updatedAt: now,
      });

      if (notifText.trim()) {
        const notifId = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(doc(db, 'notifications', notifId), {
          id: notifId,
          customerUid: order.customerUid,
          orderId: order.id,
          orderNumber: order.orderNumber,
          title: 'Order Update',
          message: notifText.trim().slice(0, 500),
          read: false,
          createdAt: now,
        });
      }

      await batch.commit();
      const notifyRes =
        notifText.trim() || voucherCode.trim()
          ? await notifyCustomerOrderUpdate({
              order,
              orderStatus: order.orderStatus,
              paymentStatus: order.paymentStatus,
              voucherCode: voucherCode.trim(),
              note: msg,
            })
          : {telegramSent: false, emailSent: false};
      const channels = [
        notifyRes.emailSent ? 'Email' : '',
        notifyRes.telegramSent ? 'Telegram' : '',
      ].filter(Boolean);
      setNotifText('');
      setFeedback(
        `Admin note & customer notification saved.${
          channels.length ? ` Customer notified via ${channels.join(' & ')}.` : ''
        }`,
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
    } finally {
      setProcessingId(null);
    }
  };

  if (!canOrders && !canPayments) {
    return (
      <AdminLayout title="Order Management">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to manage orders.
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Order Management">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Order ID, Player UID, Customer, or TrxID..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl overflow-x-auto">
            {(['all', 'pending', 'processing', 'completed', 'cancelled', 'expired'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}>
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No matching orders found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Product / UID</th>
                    <th className="px-4 py-3 font-medium">Payment / TrxID</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold tabular-nums block">
                          {o.orderNumber}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {new Date(timestampToMillis(o.createdAt)).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.customerName}</p>
                        {o.customerPhone && o.customerPhone !== 'Not Required' && (
                          <p className="text-xs text-slate-500">{o.customerPhone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.packageName}</p>
                        <p className="text-xs font-mono text-slate-500">UID: {o.playerUid}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold">
                          {o.paymentMethodName} · <span className="capitalize">{o.paymentStatus}</span>
                        </p>
                        <p className="text-xs font-mono text-slate-500">{o.trxId}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {formatCurrency(o.totalAmount)}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold capitalize">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            o.orderStatus === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                              : o.orderStatus === 'processing'
                                ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-400'
                                : o.orderStatus === 'cancelled'
                                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400'
                                  : o.orderStatus === 'expired'
                                    ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                          }`}>
                          {o.orderStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openOrder(o)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer">
                          <Eye className="w-3.5 h-3.5" /> Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Order Inspection & Fulfillment Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold font-display">
                  Order {selectedOrder.orderNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedOrder.productName} · {selectedOrder.packageName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block">Customer</span>
                <span className="font-semibold">{selectedOrder.customerName}</span>
                <span className="block text-slate-500">{selectedOrder.customerEmail}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Player UID</span>
                <span className="font-mono font-bold text-sm">{selectedOrder.playerUid}</span>
                {selectedOrder.serverId && (
                  <span className="block text-slate-500">Server: {selectedOrder.serverId}</span>
                )}
              </div>
              <div>
                <span className="text-slate-500 block">Payment Info</span>
                <span className="font-semibold">
                  {selectedOrder.paymentMethodName} · {formatCurrency(selectedOrder.totalAmount)}
                </span>
                <span className="block font-mono">TrxID: {selectedOrder.trxId}</span>
                {selectedOrder.walletRefunded && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Refunded to Wallet
                  </span>
                )}
                {selectedOrder.senderNumber && selectedOrder.senderNumber !== 'Not Required' && (
                  <span className="block font-mono text-slate-500">
                    From: {selectedOrder.senderNumber}
                  </span>
                )}
              </div>
            </div>

            {selectedOrder.screenshotUrl && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-500 block">Payment Screenshot</span>
                <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 max-h-60 bg-slate-950">
                  <ImageWithFallback
                    src={selectedOrder.screenshotUrl}
                    alt="Payment screenshot"
                    className="w-full h-full object-contain max-h-60"
                  />
                </div>
              </div>
            )}

            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <label className="block text-xs font-medium mb-1">
                  Deliver Voucher Code / Redeem PIN (Appears in customer My Codes)
                </label>
                <input
                  type="text"
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value)}
                  placeholder="Optional e.g. BDMB-Q-S-03861208..."
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Admin Note / Cancel Reason (Shown to customer if cancelled)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    'Invalid Player UID',
                    'TrxID Not Found / Invalid',
                    'Insufficient Payment Amount',
                    'Wrong Server Selected',
                  ].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setAdminNote(reason)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer">
                      {reason}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Enter verification note or cancel reason..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Send Customer Notification Message
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={notifText}
                    onChange={(e) => setNotifText(e.target.value)}
                    placeholder="e.g. Diamonds delivered to your Free Fire mailbox."
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    disabled={processingId === selectedOrder.id}
                    onClick={() => void handleSendNoteAndNotification(selectedOrder)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold cursor-pointer">
                    <Send className="w-3.5 h-3.5" /> Send
                  </button>
                </div>
              </div>
            </div>

            {feedback && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-xs font-medium text-blue-700 dark:text-blue-300">
                {feedback}
              </div>
            )}

            {/* Verification & Fulfillment Actions */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              {canPayments && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={processingId === selectedOrder.id || selectedOrder.paymentStatus === 'verified'}
                    onClick={() => void handleVerifyPayment(selectedOrder, 'approved')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve Payment
                  </button>
                  <button
                    type="button"
                    disabled={
                      processingId === selectedOrder.id ||
                      selectedOrder.paymentStatus === 'rejected' ||
                      selectedOrder.paymentType === 'wallet' ||
                      selectedOrder.paymentMethodId === 'wallet'
                    }
                    onClick={() => void handleVerifyPayment(selectedOrder, 'rejected')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer">
                    <XCircle className="w-3.5 h-3.5" /> Reject Payment
                  </button>
                </div>
              )}

              {canOrders && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={processingId === selectedOrder.id}
                    onClick={() => void handleUpdateOrderStatus(selectedOrder, 'processing')}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                    Mark Processing
                  </button>
                  <button
                    type="button"
                    disabled={processingId === selectedOrder.id || selectedOrder.paymentStatus !== 'verified'}
                    title={
                      selectedOrder.paymentStatus !== 'verified'
                        ? 'Approve payment before marking completed'
                        : 'Mark completed after UID fulfillment'
                    }
                    onClick={() => void handleUpdateOrderStatus(selectedOrder, 'completed')}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer">
                    Mark Completed
                  </button>
                  <button
                    type="button"
                    disabled={processingId === selectedOrder.id || selectedOrder.orderStatus === 'cancelled'}
                    onClick={() => void handleUpdateOrderStatus(selectedOrder, 'cancelled')}
                    className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 disabled:opacity-40 text-red-600 text-xs font-semibold cursor-pointer">
                    {selectedOrder.paymentType === 'wallet' || selectedOrder.paymentMethodId === 'wallet'
                      ? 'Cancel & Refund Wallet'
                      : 'Cancel'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
