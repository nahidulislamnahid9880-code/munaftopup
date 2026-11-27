import React, {useEffect, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {
  Award,
  Bell,
  BellRing,
  BookmarkCheck,
  Check,
  ChevronRight,
  Coins,
  Copy,
  Gift,
  KeyRound,
  Link2,
  LogOut,
  MessageSquare,
  Package,
  PlusCircle,
  Send,
  Trash2,
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
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {useBrowserPushAlerts} from '../../hooks/useBrowserPushAlerts';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import {resolveTelegramHref, resolveWhatsAppHref} from '../../lib/supportLinks';
import type {CustomerNotification, Order, ReferralEvent, SupportTicket} from '../../types';
import {TelegramIcon, WhatsAppIcon} from '../../components/SupportIcons';
import {StoreLayout} from '../../components/store/StoreLayout';

export function CustomerAccountPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {siteSettings, products, programConfig} = useStore();
  const {t} = useLanguage();
  const toast = useToast();
  const {
    firebaseUser,
    authReady,
    customerProfile,
    signInCustomerWithGoogle,
    signOutCustomer,
    updateCustomerPhone,
    saveCustomerPlayerUid,
    removeCustomerPlayerUid,
  } = useAuth();
  const {supported: pushSupported, enabled: pushEnabled, requestAndEnable: enablePushAlerts, disableAlerts: disablePushAlerts} =
    useBrowserPushAlerts(firebaseUser?.uid);

  const whatsappHref = resolveWhatsAppHref(siteSettings.contact);
  const telegramHref = resolveTelegramHref(siteSettings.contact);

  const initialTab =
    (searchParams.get('tab') as 'overview' | 'notifications' | 'support' | 'profile') || 'overview';
  const [tab, setTab] = useState<'overview' | 'notifications' | 'support' | 'profile'>(initialTab);

  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [referralEvents, setReferralEvents] = useState<ReferralEvent[]>([]);

  const [redeemPointsInput, setRedeemPointsInput] = useState('10');
  const [redeemingPoints, setRedeemingPoints] = useState(false);

  const [newUidLabel, setNewUidLabel] = useState('');
  const [newUidGame, setNewUidGame] = useState('');
  const [newUidValue, setNewUidValue] = useState('');
  const [newUidServer, setNewUidServer] = useState('');

  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [profileMsg, setProfileMsg] = useState('');

  const [ticketOrder, setTicketOrder] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [ticketSaved, setTicketSaved] = useState(false);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (
      tabParam === 'overview' ||
      tabParam === 'notifications' ||
      tabParam === 'support' ||
      tabParam === 'profile'
    ) {
      setTab(tabParam);
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

    const unsubReferrals = onSnapshot(
      query(
        collection(db, 'referralEvents'),
        where('referrerUid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => setReferralEvents(snap.docs.map((d) => d.data() as ReferralEvent)),
      () => {
        // non-blocking
      },
    );

    return () => {
      unsubOrders();
      unsubNotifs();
      unsubTickets();
      unsubReferrals();
    };
  }, [authReady, firebaseUser]);

  const handleRedeemPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    const pts = Math.floor(Number(redeemPointsInput || 0));
    if (pts < 10) {
      toast.error('Minimum 10 points required to redeem');
      return;
    }
    setRedeemingPoints(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/customer/loyalty-redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({points: pts}),
      });
      const data = (await res.json()) as {ok?: boolean; bdtValue?: number; error?: string};
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Unable to redeem points');
      }
      toast.success(`Redeemed ${pts} points for ${formatCurrency(data.bdtValue || 0)} wallet balance!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Redemption failed');
    } finally {
      setRedeemingPoints(false);
    }
  };

  const handleAddSavedUid = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveCustomerPlayerUid({
        label: newUidLabel.trim() || 'Main ID',
        gameName: newUidGame.trim() || products[0]?.name || 'Free Fire',
        playerUid: newUidValue.trim(),
        serverId: newUidServer.trim() || 'N/A',
      });
      setNewUidLabel('');
      setNewUidValue('');
      setNewUidServer('');
      toast.success('Player UID saved!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save UID');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    await updateCustomerPhone(editName, editPhone);
    setProfileMsg('Profile saved.');
    toast.success('Profile updated');
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
      const msg = 'Suspended accounts cannot submit new support tickets.';
      setTicketError(msg);
      toast.error(msg);
      return;
    }
    if (ticketSubject.trim().length < 2 || ticketMessage.trim().length < 5) {
      const msg = 'Please enter a subject and detailed message.';
      setTicketError(msg);
      toast.error(msg);
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
          const notifyRes = await fetch('/api/notify/admin', {
            method: 'POST',
            keepalive: true,
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
          if (!notifyRes.ok) {
            console.error('Ticket admin notify HTTP error:', notifyRes.status);
          } else {
            const notifyData = (await notifyRes.json()) as {sent?: boolean; reason?: string};
            if (notifyData.sent === false) {
              console.warn('Ticket admin email skipped:', notifyData.reason);
            }
          }
        } catch (notifyErr) {
          console.error('Ticket admin notify request failed:', notifyErr);
        }
      })();

      setTicketSubject('');
      setTicketMessage('');
      setTicketOrder('');
      setTicketSaved(true);
      toast.success('Support ticket submitted');
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
      toast.info('Support ticket closed');
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
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4 animate-pulse">
          <div className="h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="h-44 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        </div>
      </StoreLayout>
    );
  }

  if (!firebaseUser) {
    return (
      <StoreLayout>
        <div className="max-w-md mx-auto px-4 py-16">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-8 text-center space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto">
              <User className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
              {t('account.title')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('account.signInDesc')}
            </p>
            <button
              type="button"
              onClick={() => void signInCustomerWithGoogle()}
              className="w-full px-5 py-3 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 border border-slate-800 dark:border-cyan-500 text-white text-sm font-semibold cursor-pointer transition-colors">
              {t('nav.signInGoogle')}
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
  const loyaltyPoints = customerProfile?.loyaltyPoints ?? 0;
  const totalSpent = customerProfile?.totalSpent ?? 0;
  const tier = customerProfile?.tier || 'regular';
  const tierDiscountPct =
    tier === 'reseller'
      ? programConfig.resellerDiscountPercent
      : tier === 'vip'
        ? programConfig.vipDiscountPercent
        : 0;
  const nextThreshold =
    tier === 'regular'
      ? programConfig.vipSpendThreshold
      : tier === 'vip'
        ? programConfig.resellerSpendThreshold
        : programConfig.resellerSpendThreshold;
  const tierProgressPct = Math.min(100, Math.round((totalSpent / Math.max(1, nextThreshold)) * 100));
  const referralUrl = customerProfile?.referralCode
    ? `${window.location.origin}/?ref=${customerProfile.referralCode}`
    : '';

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
        {/* User Profile Header */}
        <div className="flex items-start justify-between gap-4 pb-3 border-b-[1.5px] border-slate-200/90 dark:border-slate-800">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white font-display truncate">
                {customerProfile?.displayName || firebaseUser.displayName || 'Customer'}
              </h1>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider ${
                  tier === 'reseller'
                    ? 'bg-amber-500 text-slate-950'
                    : tier === 'vip'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}>
                {tier === 'reseller'
                  ? t('tier.reseller')
                  : tier === 'vip'
                    ? t('tier.vip')
                    : t('tier.regular')}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
              {firebaseUser.email}
            </p>
            {customerProfile?.phone && (
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {customerProfile.phone}
              </p>
            )}
            {customerProfile?.suspended && (
              <span className="inline-block text-xs text-red-600 dark:text-red-400 font-semibold pt-1">
                Account Suspended: {customerProfile.suspendedReason}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void signOutCustomer()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-[1.5px] border-slate-200/95 dark:border-slate-700 hover:border-red-300 bg-white dark:bg-slate-900 hover:bg-red-50/40 dark:hover:bg-red-950/30 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shrink-0 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> {t('account.signOut')}
          </button>
        </div>

        {/* Current Wallet Balance Card */}
        <div className="rounded-2xl bg-slate-100/90 dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-5 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
          <span className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 block">
            {t('account.currentBalance')}
          </span>
          <div className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl bg-white dark:bg-slate-950 border-[1.5px] border-cyan-300/80 dark:border-cyan-700/70 shadow-xs">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-display tabular-nums">
              {formatCurrency(walletBalance)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <Link
              to="/add-money"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 border border-slate-800 dark:border-cyan-500 text-white text-xs sm:text-sm font-bold transition-colors">
              <PlusCircle className="w-4 h-4" /> {t('nav.addMoney')}
            </Link>
            <Link
              to="/orders"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white dark:bg-slate-800 border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-cyan-400 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-bold transition-colors">
              {t('nav.myOrders')}
            </Link>
          </div>
        </div>

        {/* Account Navigation Tabs */}
        <div className="flex items-center gap-1 p-1.5 bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-2xs">
          <button
            type="button"
            onClick={() => switchTab('overview')}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'overview'
                ? 'bg-slate-900 dark:bg-cyan-600 border-slate-900 dark:border-cyan-500 text-white shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}>
            {t('account.menu')}
          </button>
          <button
            type="button"
            onClick={() => switchTab('notifications')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'notifications'
                ? 'bg-slate-900 dark:bg-cyan-600 border-slate-900 dark:border-cyan-500 text-white shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}>
            <Bell className="w-3.5 h-3.5" /> {t('account.notifications')} ({unreadCount})
          </button>
          <button
            type="button"
            onClick={() => switchTab('support')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'support'
                ? 'bg-slate-900 dark:bg-cyan-600 border-slate-900 dark:border-cyan-500 text-white shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}>
            <MessageSquare className="w-3.5 h-3.5" /> {t('account.support')} ({tickets.length})
          </button>
          <button
            type="button"
            onClick={() => switchTab('profile')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
              tab === 'profile'
                ? 'bg-slate-900 dark:bg-cyan-600 border-slate-900 dark:border-cyan-500 text-white shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}>
            <User className="w-3.5 h-3.5" /> {t('account.editProfile')}
          </button>
        </div>

        {/* Overview List Cards */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Tier + Loyalty + Referral Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tier & Loyalty Card */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                    <Award className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                    {tier === 'reseller'
                      ? t('tier.reseller')
                      : tier === 'vip'
                        ? t('tier.vip')
                        : t('tier.regular')}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {tierDiscountPct > 0 ? `${tierDiscountPct}% Instant Discount` : '0% Discount'}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Spent: {formatCurrency(totalSpent)}</span>
                    <span>
                      {tier === 'reseller'
                        ? 'Max Tier Reached'
                        : `Next: ${formatCurrency(nextThreshold)}`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full"
                      style={{width: `${tierProgressPct}%`}}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                      <Coins className="w-4 h-4 text-amber-500" /> {t('loyalty.points')}
                    </span>
                    <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">
                      {loyaltyPoints} pts (1 pt = {formatCurrency(programConfig.loyaltyPointValueBdt)})
                    </span>
                  </div>
                  <form onSubmit={handleRedeemPoints} className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={Math.max(10, loyaltyPoints)}
                      value={redeemPointsInput}
                      onChange={(e) => setRedeemPointsInput(e.target.value)}
                      className="w-24 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={redeemingPoints || loyaltyPoints < 10}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-bold cursor-pointer">
                      {redeemingPoints ? '...' : t('loyalty.redeemTitle')}
                    </button>
                  </form>
                </div>
              </div>

              {/* Referral Card */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                    <Gift className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    {t('referral.title')}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    +{formatCurrency(programConfig.referralBonusAmount)} / friend
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Share your link. When a friend completes their first order, you earn {formatCurrency(programConfig.referralBonusAmount)} wallet bonus automatically!
                </p>
                {referralUrl ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                      <span className="truncate">{referralUrl}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(referralUrl);
                        toast.success('Referral link copied!');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold cursor-pointer shrink-0">
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Initializing your referral code...</p>
                )}

                {referralEvents.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 max-h-24 overflow-y-auto">
                    {referralEvents.slice(0, 4).map((ev) => (
                      <div key={ev.id} className="flex justify-between text-[11px] text-slate-600 dark:text-slate-400">
                        <span className="truncate pr-2">{ev.note}</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                          {ev.walletDelta > 0 ? `+${formatCurrency(ev.walletDelta)}` : `+${ev.pointsDelta} pts`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Link
              to="/orders"
              className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {t('nav.myOrders')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {completedCount} completed · {orders.length} total
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>

            <Link
              to="/codes"
              className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {t('nav.myCodes')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {codeCount > 0 ? `${codeCount} voucher codes available` : 'Voucher codes from your Orders'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>

            <button
              type="button"
              onClick={() => switchTab('notifications')}
              className="w-full text-left rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none cursor-pointer">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {t('account.notifications')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {unreadCount} unread order updates
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => switchTab('support')}
              className="w-full text-left rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 flex items-center justify-between gap-4 hover:border-cyan-500 transition-colors shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none cursor-pointer">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/70 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {t('nav.supportDesk')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
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
            {/* Live Browser Push Alert Toggle */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <BellRing className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                <div>
                  <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    {t('alerts.browserTitle')}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Get desktop/mobile alerts immediately when an order updates.
                  </p>
                </div>
              </div>
              {!pushSupported ? (
                <span className="text-[11px] text-slate-400">Unsupported</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (pushEnabled) {
                      disablePushAlerts();
                      toast.info('Browser alerts paused');
                    } else {
                      void enablePushAlerts().then((ok) => {
                        if (ok) toast.success('Live browser alerts enabled!');
                        else toast.error('Notification permission denied in browser settings');
                      });
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    pushEnabled
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-900 dark:bg-cyan-600 text-white'
                  }`}>
                  {pushEnabled ? 'Enabled' : 'Enable Alerts'}
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-10 text-center text-sm text-slate-500 dark:text-slate-400 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-2xl border-[1.5px] p-4 flex items-start justify-between gap-4 shadow-2xs ${
                    n.read
                      ? 'bg-white dark:bg-slate-900 border-slate-200/95 dark:border-slate-800'
                      : 'bg-cyan-50/50 dark:bg-cyan-950/40 border-cyan-300 dark:border-cyan-700'
                  }`}>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-bold text-slate-900 dark:text-white">{n.title}</span>
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
                    <p className="text-sm text-slate-700 dark:text-slate-300">{n.message}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => void handleMarkNotifRead(n)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border-[1.5px] border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 shrink-0 cursor-pointer">
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
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Instant Live Support
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chat directly with our support team on WhatsApp or Telegram.
                  </p>
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
              className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-5 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display border-b border-slate-100 dark:border-slate-800 pb-2.5">
                Open Support Ticket
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Order Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={ticketOrder}
                    onChange={(e) => setTicketOrder(e.target.value)}
                    placeholder="Enter Order Number"
                    className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Subject *
                  </label>
                  <input
                    type="text"
                    required
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="Describe your issue briefly"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Message *
                </label>
                <textarea
                  rows={3}
                  required
                  value={ticketMessage}
                  onChange={(e) => setTicketMessage(e.target.value)}
                  placeholder="Include your Player UID or TrxID if applicable..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                />
              </div>
              {ticketError && <p className="text-xs text-red-600 dark:text-red-400">{ticketError}</p>}
              {ticketSaved && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  Support ticket submitted. An admin will reply shortly.
                </p>
              )}
              <button
                type="submit"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 border border-slate-800 dark:border-cyan-500 text-white text-sm font-semibold cursor-pointer">
                <Send className="w-4 h-4" /> Submit Ticket
              </button>
            </form>

            <div className="space-y-3">
              {tickets.length === 0 ? (
                <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                  No support tickets submitted.
                </div>
              ) : (
                tickets.map((tItem) => (
                  <div
                    key={tItem.id}
                    className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-5 space-y-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {tItem.subject}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Status: <span className="capitalize font-semibold">{tItem.status}</span>
                          {tItem.orderNumber && ` · Order ${tItem.orderNumber}`}
                        </p>
                      </div>
                      {tItem.status !== 'closed' && (
                        <button
                          type="button"
                          onClick={() => void handleCloseTicket(tItem)}
                          className="px-3 py-1 rounded-lg border-[1.5px] border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                          Close
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
                      {tItem.message}
                    </p>
                    {tItem.adminReply && (
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border-[1.5px] border-slate-200/90 dark:border-slate-800 p-3.5 space-y-1">
                        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 block">
                          Support Reply ({tItem.repliedBy || 'Admin'})
                        </span>
                        <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line">
                          {tItem.adminReply}
                        </p>
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
          <div className="space-y-5">
            <form
              onSubmit={handleSaveProfile}
              className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display border-b border-slate-100 dark:border-slate-800 pb-2.5">
                {t('account.profileSettings')}
              </h2>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t('account.displayName')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t('account.defaultPhone')}
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Enter phone number"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                />
              </div>
              {profileMsg && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  {profileMsg}
                </p>
              )}
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 border border-slate-800 dark:border-cyan-500 text-white text-sm font-semibold cursor-pointer">
                {t('account.saveProfile')}
              </button>
            </form>

            {/* Saved Player UIDs Manager */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <BookmarkCheck className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                {t('uid.savedProfiles')}
              </h2>

              <form onSubmit={handleAddSavedUid} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={newUidLabel}
                  onChange={(e) => setNewUidLabel(e.target.value)}
                  placeholder="Profile Label (e.g. Main FF)"
                  className="px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  value={newUidGame}
                  onChange={(e) => setNewUidGame(e.target.value)}
                  placeholder="Game Name (e.g. Free Fire)"
                  className="px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  required
                  value={newUidValue}
                  onChange={(e) => setNewUidValue(e.target.value)}
                  placeholder="Player UID *"
                  className="px-3.5 py-2 text-xs sm:text-sm font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  value={newUidServer}
                  onChange={(e) => setNewUidServer(e.target.value)}
                  placeholder="Server ID (Optional)"
                  className="px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs sm:text-sm font-bold cursor-pointer">
                  + Add Saved Player UID
                </button>
              </form>

              {(customerProfile?.savedUids || []).length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No saved player UIDs yet.</p>
              ) : (
                <div className="space-y-2">
                  {(customerProfile?.savedUids || []).map((su) => (
                    <div
                      key={su.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                          {su.label} <span className="text-slate-400 font-normal">· {su.gameName}</span>
                        </p>
                        <p className="text-xs font-mono text-cyan-600 dark:text-cyan-400">
                          {su.playerUid} {su.serverId && su.serverId !== 'N/A' ? `(${su.serverId})` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeCustomerPlayerUid(su.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </StoreLayout>
  );
}
