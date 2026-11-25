import React, {useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {
  Bell,
  Check,
  LogOut,
  MessageSquare,
  Package,
  Send,
  User,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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
import type {CustomerNotification, Order, SupportTicket} from '../../types';
import {StoreLayout} from '../../components/store/StoreLayout';

export function CustomerAccountPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    firebaseUser,
    authReady,
    customerProfile,
    signInCustomerWithGoogle,
    signOutCustomer,
    updateCustomerPhone,
  } = useAuth();

  const initialTab = (searchParams.get('tab') as 'orders' | 'notifications' | 'support' | 'profile') || 'orders';
  const [tab, setTab] = useState<'orders' | 'notifications' | 'support' | 'profile'>(initialTab);

  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);

  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [profileMsg, setProfileMsg] = useState('');

  const [ticketOrder, setTicketOrder] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [ticketSaved, setTicketSaved] = useState(false);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'orders' || t === 'notifications' || t === 'support' || t === 'profile') {
      setTab(t);
    }
  }, [searchParams]);

  useEffect(() => {
    if (customerProfile) {
      setEditName(customerProfile.displayName || '');
      setEditPhone(customerProfile.phone || '');
    }
  }, [customerProfile]);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setOrders([]);
      setNotifications([]);
      setTickets([]);
      return;
    }

    const unsubOrders = onSnapshot(
      query(
        collection(db, 'orders'),
        where('customerUid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => setOrders(snap.docs.map((d) => d.data() as Order)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders'),
    );

    const unsubNotifs = onSnapshot(
      query(
        collection(db, 'notifications'),
        where('customerUid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => setNotifications(snap.docs.map((d) => d.data() as CustomerNotification)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications'),
    );

    const unsubTickets = onSnapshot(
      query(
        collection(db, 'tickets'),
        where('customerUid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => setTickets(snap.docs.map((d) => d.data() as SupportTicket)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'tickets'),
    );

    return () => {
      unsubOrders();
      unsubNotifs();
      unsubTickets();
    };
  }, [authReady, firebaseUser]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    await updateCustomerPhone(editName, editPhone);
    setProfileMsg('Profile saved.');
  };

  const handleMarkNotifRead = async (n: CustomerNotification) => {
    if (n.read) return;
    try {
      await updateDoc(doc(db, 'notifications', n.id), {read: true});
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${n.id}`);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setTicketError('');
    setTicketSaved(false);
    if (!firebaseUser) return;
    if (customerProfile?.suspended) {
      setTicketError('Suspended accounts cannot submit new support tickets.');
      return;
    }
    if (ticketSubject.trim().length < 2 || ticketMessage.trim().length < 5) {
      setTicketError('Please enter a subject and detailed message.');
      return;
    }
    const id = `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = serverTimestamp();
    try {
      await setDoc(doc(db, 'tickets', id), {
        id,
        customerUid: firebaseUser.uid,
        customerName: customerProfile?.displayName || firebaseUser.displayName || 'Customer',
        customerEmail: firebaseUser.email || '',
        orderNumber: ticketOrder.trim().toUpperCase().slice(0, 32),
        subject: ticketSubject.trim().slice(0, 140),
        message: ticketMessage.trim().slice(0, 2000),
        status: 'open',
        adminReply: '',
        repliedBy: '',
        createdAt: now,
        updatedAt: now,
      });
      setTicketSubject('');
      setTicketMessage('');
      setTicketOrder('');
      setTicketSaved(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `tickets/${id}`);
    }
  };

  const handleCloseTicket = async (ticket: SupportTicket) => {
    try {
      await updateDoc(doc(db, 'tickets', ticket.id), {
        status: 'closed',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${ticket.id}`);
    }
  };

  const switchTab = (next: typeof tab) => {
    setTab(next);
    setSearchParams({tab: next});
  };

  if (!authReady) {
    return (
      <StoreLayout>
        <div className="max-w-5xl mx-auto px-4 py-16 text-center text-sm text-slate-500">
          Loading account...
        </div>
      </StoreLayout>
    );
  }

  if (!firebaseUser) {
    return (
      <StoreLayout>
        <div className="max-w-md mx-auto px-4 py-16">
          <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 font-display">Customer Account</h1>
            <p className="text-sm text-slate-600">
              Sign in with Google to view your top-up orders, live admin notifications, and support tickets.
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="w-full px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer transition-colors">
              Sign in with Google
            </button>
          </div>
        </div>
      </StoreLayout>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <StoreLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="rounded-xl bg-white border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900 font-display">
              {customerProfile?.displayName || firebaseUser.displayName || 'Customer Account'}
            </h1>
            <p className="text-sm text-slate-500">
              {firebaseUser.email}
              {customerProfile?.suspended && (
                <span className="ml-2 text-red-600 font-semibold">· Account Suspended</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOutCustomer()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer self-start sm:self-auto">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl overflow-x-auto w-fit max-w-full">
          <button
            type="button"
            onClick={() => switchTab('orders')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'orders' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}>
            <Package className="w-3.5 h-3.5" /> Orders ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => switchTab('notifications')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'notifications' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}>
            <Bell className="w-3.5 h-3.5" /> Notifications ({unreadCount})
          </button>
          <button
            type="button"
            onClick={() => switchTab('support')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'support' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}>
            <MessageSquare className="w-3.5 h-3.5" /> Support Tickets ({tickets.length})
          </button>
          <button
            type="button"
            onClick={() => switchTab('profile')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'profile' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}>
            <User className="w-3.5 h-3.5" /> Profile
          </button>
        </div>

        {/* Tab: Orders */}
        {tab === 'orders' && (
          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
            {orders.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No orders placed yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Order ID</th>
                      <th className="px-4 py-3 font-medium">Product</th>
                      <th className="px-4 py-3 font-medium">UID / TrxID</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Payment</th>
                      <th className="px-4 py-3 font-medium">Order Status</th>
                      <th className="px-4 py-3 font-medium">Update</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                          {order.orderNumber}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{order.productName}</p>
                          <p className="text-xs text-slate-500">{order.packageName}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          <div>UID: {order.playerUid}</div>
                          <div>Trx: {order.trxId}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums">
                          {formatCurrency(order.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold capitalize">
                          {order.paymentStatus}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold capitalize">
                          {order.orderStatus}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                          {order.notificationMessage || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: Notifications */}
        {tab === 'notifications' && (
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="rounded-xl bg-white border border-slate-200 p-10 text-center text-sm text-slate-500">
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-xl border p-4 flex items-start justify-between gap-4 ${
                    n.read ? 'bg-white border-slate-200' : 'bg-blue-50/50 border-blue-200'
                  }`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-900">{n.title}</span>
                      {n.orderNumber && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{n.orderNumber}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="tabular-nums">
                        {new Date(timestampToMillis(n.createdAt)).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">{n.message}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => void handleMarkNotifRead(n)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 shrink-0 cursor-pointer">
                      <Check className="w-3.5 h-3.5" /> Mark Read
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Support Tickets */}
        {tab === 'support' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleCreateTicket}
              className="lg:col-span-5 rounded-xl bg-white border border-slate-200 p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900 font-display">
                Open Support Ticket
              </h2>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Order Number (Optional)
                </label>
                <input
                  type="text"
                  value={ticketOrder}
                  onChange={(e) => setTicketOrder(e.target.value)}
                  placeholder="SV-123456"
                  className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subject *
                </label>
                <input
                  type="text"
                  required
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  placeholder="Describe your issue briefly"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Message *
                </label>
                <textarea
                  rows={4}
                  required
                  value={ticketMessage}
                  onChange={(e) => setTicketMessage(e.target.value)}
                  placeholder="Include your Player UID or TrxID if applicable..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              {ticketError && <p className="text-xs text-red-600">{ticketError}</p>}
              {ticketSaved && (
                <p className="text-xs text-emerald-700 font-medium">
                  Support ticket submitted. An admin will reply shortly.
                </p>
              )}
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer">
                <Send className="w-4 h-4" /> Submit Ticket
              </button>
            </form>

            <div className="lg:col-span-7 space-y-3">
              {tickets.length === 0 ? (
                <div className="rounded-xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
                  No support tickets submitted.
                </div>
              ) : (
                tickets.map((t) => (
                  <div key={t.id} className="rounded-xl bg-white border border-slate-200 p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{t.subject}</h3>
                        <p className="text-xs text-slate-500">
                          Status: <span className="capitalize font-semibold">{t.status}</span>
                          {t.orderNumber && ` · Order ${t.orderNumber}`}
                        </p>
                      </div>
                      {t.status !== 'closed' && (
                        <button
                          type="button"
                          onClick={() => void handleCloseTicket(t)}
                          className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                          Close Ticket
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-line">{t.message}</p>
                    {t.adminReply && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                        <span className="text-xs font-semibold text-blue-700 block">
                          Support Reply ({t.repliedBy || 'Admin'})
                        </span>
                        <p className="text-sm text-slate-800 whitespace-pre-line">{t.adminReply}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab: Profile */}
        {tab === 'profile' && (
          <form
            onSubmit={handleSaveProfile}
            className="max-w-lg rounded-xl bg-white border border-slate-200 p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900 font-display">Profile Settings</h2>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Display Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Default Phone Number</label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            {profileMsg && <p className="text-xs text-emerald-700 font-medium">{profileMsg}</p>}
            <button
              type="submit"
              className="px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer">
              Save Profile
            </button>
          </form>
        )}
      </div>
    </StoreLayout>
  );
}
