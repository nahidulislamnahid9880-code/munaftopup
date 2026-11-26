import React, {useEffect, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {
  Bell,
  Check,
  ChevronRight,
  KeyRound,
  LogOut,
  MessageSquare,
  Package,
  PlusCircle,
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
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import {resolveTelegramHref, resolveWhatsAppHref} from '../../lib/supportLinks';
import type {CustomerNotification, Order, SupportTicket} from '../../types';
import {TelegramIcon, WhatsAppIcon} from '../../components/SupportIcons';
import {StoreLayout} from '../../components/store/StoreLayout';

export function CustomerAccountPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {siteSettings} = useStore();
  const {
    firebaseUser,
    authReady,
    customerProfile,
    signInCustomerWithGoogle,
    signOutCustomer,
    updateCustomerPhone,
  } = useAuth();
  const whatsappHref = resolveWhatsAppHref(siteSettings.contact);
  const telegramHref = resolveTelegramHref(siteSettings.contact);

  const initialTab =
    (searchParams.get('tab') as 'overview' | 'notifications' | 'support' | 'profile') || 'overview';
  const [tab, setTab] = useState<'overview' | 'notifications' | 'support' | 'profile'>(initialTab);

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
    if (t === 'overview' || t === 'notifications' || t === 'support' || t === 'profile') {
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

      const submittedOrder = ticketOrder.trim().toUpperCase();
      const submittedSubject = ticketSubject.trim();
      const submittedMessage = ticketMessage.trim();
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
              type: 'ticket',
              details: {
                ticketId: id,
                orderNumber: submittedOrder,
                subject: submittedSubject,
                message: submittedMessage,
                customerName: customerProfile?.displayName || firebaseUser.displayName || 'Customer',
                customerEmail: firebaseUser.email || '',
              },
            }),
          });
        } catch {
          // Non-blocking notification failure should not block ticket submission
        }
      })();

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
        <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-slate-500">
          Loading account...
        </div>
      </StoreLayout>
    );
  }

  if (!firebaseUser) {
    return (
      <StoreLayout>
        <div className="max-w-md mx-auto px-4 py-16">
          <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-8 text-center space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200/70 text-cyan-600 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 font-display">My Profile</h1>
            <p className="text-sm text-slate-600">
              Sign in with Google to view your wallet balance, top-up orders, delivered codes, and support tickets.
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="w-full px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-sm font-semibold cursor-pointer transition-colors">
              Sign in with Google
            </button>
          </div>
        </div>
      </StoreLayout>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const completedCount = orders.filter((o) => o.orderStatus === 'completed').length;
  const codeCount = orders.filter((o) => Boolean(o.voucherCode?.trim())).length;
  const walletBalance = customerProfile?.walletBalance ?? 0;

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        {/* User Profile Header */}
        <div className="flex items-start justify-between gap-4 pb-3 border-b-[1.5px] border-slate-200/90">
          <div className="space-y-0.5 min-w-0">
            <h1 className="text-2xl font-extrabold text-slate-900 font-display truncate">
              {customerProfile?.displayName || firebaseUser.displayName || 'Customer'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 truncate">{firebaseUser.email}</p>
            {customerProfile?.phone && (
              <p className="text-xs text-slate-500 font-mono">{customerProfile.phone}</p>
            )}
            {customerProfile?.suspended && (
              <span className="inline-block text-xs text-red-600 font-semibold pt-1">
                Account Suspended: {customerProfile.suspendedReason}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void signOutCustomer()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-[1.5px] border-slate-200/95 hover:border-red-300 bg-white hover:bg-red-50/40 text-xs font-semibold text-slate-700 cursor-pointer shrink-0 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>

        {/* Current Wallet Balance Card */}
        <div className="rounded-2xl bg-slate-100/90 border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-5 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
          <span className="text-xs sm:text-sm font-medium text-slate-600 block">
            Current Balance
          </span>
          <div className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl bg-white border-[1.5px] border-cyan-300/80 shadow-xs">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display tabular-nums">
              {formatCurrency(walletBalance)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <Link
              to="/add-money"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-xs sm:text-sm font-bold transition-colors">
              <PlusCircle className="w-4 h-4" /> Add Money
            </Link>
            <Link
              to="/orders"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white border-[1.5px] border-slate-300 hover:border-cyan-400 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-bold transition-colors">
              My Orders
            </Link>
          </div>
        </div>

        {/* Account Navigation Tabs */}
        <div className="flex items-center gap-1 p-1.5 bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] rounded-2xl overflow-x-auto shadow-2xs">
          <button
            type="button"
            onClick={() => switchTab('overview')}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'overview'
                ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}>
            Account Menu
          </button>
          <button
            type="button"
            onClick={() => switchTab('notifications')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'notifications'
                ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}>
            <Bell className="w-3.5 h-3.5" /> Notifications ({unreadCount})
          </button>
          <button
            type="button"
            onClick={() => switchTab('support')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'support'
                ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}>
            <MessageSquare className="w-3.5 h-3.5" /> Support ({tickets.length})
          </button>
          <button
            type="button"
            onClick={() => switchTab('profile')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'profile'
                ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}>
            <User className="w-3.5 h-3.5" /> Edit Profile
          </button>
        </div>

        {/* Overview List Cards */}
        {tab === 'overview' && (
          <div className="space-y-3">
            <Link
              to="/orders"
              className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-200/70 text-cyan-600 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900">Orders</p>
                  <p className="text-xs text-slate-500">
                    {completedCount} completed · {orders.length} total
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>

            <Link
              to="/codes"
              className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-200/70 text-cyan-600 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900">Codes</p>
                  <p className="text-xs text-slate-500">
                    {codeCount > 0 ? `${codeCount} voucher codes available` : 'Voucher codes from your Orders'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>

            <button
              type="button"
              onClick={() => switchTab('notifications')}
              className="w-full text-left rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] cursor-pointer">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-200/70 text-cyan-600 flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900">Notifications</p>
                  <p className="text-xs text-slate-500">
                    {unreadCount} unread order updates
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => switchTab('support')}
              className="w-full text-left rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] cursor-pointer">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-200/70 text-cyan-600 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900">Support Tickets</p>
                  <p className="text-xs text-slate-500">
                    Get help with UID orders or payments
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        )}

        {/* Tab: Notifications */}
        {tab === 'notifications' && (
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-10 text-center text-sm text-slate-500 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-2xl border-[1.5px] p-4 flex items-start justify-between gap-4 shadow-2xs ${
                    n.read ? 'bg-white border-slate-200/95' : 'bg-cyan-50/50 border-cyan-300'
                  }`}>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-bold text-slate-900">{n.title}</span>
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
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border-[1.5px] border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 shrink-0 cursor-pointer">
                      <Check className="w-3.5 h-3.5" /> Read
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Support Tickets */}
        {tab === 'support' && (
          <div className="space-y-5">
            {(whatsappHref || telegramHref) && (
              <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Instant Live Support</h2>
                  <p className="text-xs text-slate-500">Chat directly with our support team on WhatsApp or Telegram.</p>
                </div>
                <div className="flex flex-wrap gap-2.5 shrink-0">
                  {whatsappHref && (
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 text-white text-xs font-bold transition-colors">
                      <WhatsAppIcon className="w-4 h-4" /> WhatsApp
                    </a>
                  )}
                  {telegramHref && (
                    <a
                      href={telegramHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 border border-sky-600 text-white text-xs font-bold transition-colors">
                      <TelegramIcon className="w-4 h-4" /> Telegram
                    </a>
                  )}
                </div>
              </div>
            )}

            <form
              onSubmit={handleCreateTicket}
              className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-5 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
              <h2 className="text-base font-bold text-slate-900 font-display border-b border-slate-100 pb-2.5">
                Open Support Ticket
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Order Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={ticketOrder}
                    onChange={(e) => setTicketOrder(e.target.value)}
                    placeholder="Enter Order Number"
                    className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Subject *
                  </label>
                  <input
                    type="text"
                    required
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="Describe your issue briefly"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Message *
                </label>
                <textarea
                  rows={3}
                  required
                  value={ticketMessage}
                  onChange={(e) => setTicketMessage(e.target.value)}
                  placeholder="Include your Player UID or TrxID if applicable..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
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
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-sm font-semibold cursor-pointer">
                <Send className="w-4 h-4" /> Submit Ticket
              </button>
            </form>

            <div className="space-y-3">
              {tickets.length === 0 ? (
                <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-8 text-center text-sm text-slate-500 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
                  No support tickets submitted.
                </div>
              ) : (
                tickets.map((t) => (
                  <div key={t.id} className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-5 space-y-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)]">
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
                          className="px-3 py-1 rounded-lg border-[1.5px] border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                          Close
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-line">{t.message}</p>
                    {t.adminReply && (
                      <div className="rounded-xl bg-slate-50 border-[1.5px] border-slate-200/90 p-3.5 space-y-1">
                        <span className="text-xs font-semibold text-cyan-700 block">
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
            className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-5 sm:p-6 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
            <h2 className="text-base font-bold text-slate-900 font-display border-b border-slate-100 pb-2.5">
              Profile Settings
            </h2>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Display Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Default Phone Number</label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="Enter phone number"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
              />
            </div>
            {profileMsg && <p className="text-xs text-emerald-700 font-medium">{profileMsg}</p>}
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-sm font-semibold cursor-pointer">
              Save Profile
            </button>
          </form>
        )}
      </div>
    </StoreLayout>
  );
}
