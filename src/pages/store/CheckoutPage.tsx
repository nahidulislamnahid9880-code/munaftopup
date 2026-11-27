import React, {useEffect, useMemo, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {doc, getDoc, getDocFromServer, serverTimestamp, writeBatch} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  normalizeTrxKey,
} from '../../lib/firebase';
import {PackageVisual} from '../../components/PackageTypeIcon';
import {PaymentMethodLogo} from '../../components/PaymentMethodLogo';
import {StoreLayout} from '../../components/store/StoreLayout';

export function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const {products, paymentMethods} = useStore();
  const {firebaseUser, customerProfile, signInCustomerWithGoogle} = useAuth();
  const {t} = useLanguage();
  const toast = useToast();

  const productId = searchParams.get('productId') || '';
  const packageId = searchParams.get('packageId') || '';
  const initialUid = searchParams.get('uid') || '';
  const initialServer = searchParams.get('server') || '';

  const product = useMemo(
    () => products.find((p) => p.id === productId || p.slug === productId),
    [products, productId],
  );
  const selectedPackage = useMemo(
    () => product?.packages.find((pkg) => pkg.id === packageId && pkg.active),
    [product, packageId],
  );
  const activeMethods = useMemo(
    () => paymentMethods.filter((m) => m.active),
    [paymentMethods],
  );

  const walletBalance = customerProfile?.walletBalance ?? 0;
  const canPayWithWallet = Boolean(
    firebaseUser && selectedPackage && selectedPackage.price > 0 && walletBalance >= selectedPackage.price,
  );

  const [paymentMode, setPaymentMode] = useState<'manual' | 'wallet'>('manual');
  const [playerUid, setPlayerUid] = useState(initialUid);
  const [serverId, setServerId] = useState(initialServer);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [trxId, setTrxId] = useState('');
  const [copiedNumber, setCopiedNumber] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmedOrderNumber, setConfirmedOrderNumber] = useState('');

  useEffect(() => {
    if (firebaseUser && !customerName) {
      setCustomerName(customerProfile?.displayName || firebaseUser.displayName || '');
    }
    if (customerProfile?.phone && !customerPhone) {
      setCustomerPhone(customerProfile.phone);
    }
  }, [firebaseUser, customerProfile, customerName, customerPhone]);

  useEffect(() => {
    if (activeMethods.length > 0 && !activeMethods.some((m) => m.id === selectedMethodId)) {
      setSelectedMethodId(activeMethods[0].id);
    }
  }, [activeMethods, selectedMethodId]);

  const selectedMethod = activeMethods.find((m) => m.id === selectedMethodId) || activeMethods[0];

  const handleCopyAccount = async () => {
    if (!selectedMethod?.accountNumber) return;
    await navigator.clipboard.writeText(selectedMethod.accountNumber);
    setCopiedNumber(true);
    toast.success(`${selectedMethod.name} number copied`);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  const maskUid = (uid: string) => {
    const clean = uid.trim();
    if (clean.length <= 4) return clean;
    return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
  };

  const failValidation = (msg: string) => {
    setError(msg);
    toast.error(msg);
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firebaseUser) {
      failValidation('Please sign in with Google above to submit and track your order.');
      return;
    }
    if (customerProfile?.suspended) {
      failValidation(
        `Your account is currently suspended: ${customerProfile.suspendedReason || 'Contact support.'}`,
      );
      return;
    }
    if (!product || !selectedPackage) {
      failValidation('Selected product or package is no longer available.');
      return;
    }
    if (product.requiresUid && !playerUid.trim()) {
      failValidation(`Please enter your ${product.uidLabel || 'Player UID'}.`);
      return;
    }
    if (product.requiresServerId && !serverId.trim()) {
      failValidation(`Please enter your ${product.serverLabel || 'Server ID'}.`);
      return;
    }
    if (!customerName.trim()) {
      failValidation('Please enter your name.');
      return;
    }
    const effectivePhone = (
      customerProfile?.phone?.trim() && customerProfile.phone.trim().length >= 5
        ? customerProfile.phone.trim()
        : 'Not Required'
    ).slice(0, 30);

    if (paymentMode === 'wallet') {
      if (selectedPackage.price <= 0 || walletBalance < selectedPackage.price) {
        failValidation('Insufficient Wallet Balance. Add money or use bKash / Nagad.');
        return;
      }
    } else {
      if (!selectedMethod) {
        failValidation('Please select a payment method.');
        return;
      }
      if (trxId.trim().length < 4 || trxId.trim().length > 64) {
        failValidation('Please provide a valid Transaction ID (TrxID) between 4 and 64 characters.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const orderNumber = `SV-${Math.floor(100000 + Math.random() * 900000)}`;
      const now = serverTimestamp();
      const batch = writeBatch(db);
      const thumbUrl = (selectedPackage.imageUrl || product.images?.[0] || '').slice(0, 1000);

      if (paymentMode === 'wallet') {
        const custRef = doc(db, 'customers', firebaseUser.uid);
        let custSnap;
        try {
          custSnap = await getDocFromServer(custRef);
        } catch {
          custSnap = await getDoc(custRef);
        }
        const freshBalance = custSnap.exists()
          ? Number((custSnap.data() as {walletBalance?: number}).walletBalance || 0)
          : walletBalance;

        if (freshBalance < selectedPackage.price) {
          failValidation('Insufficient Wallet Balance. Add money or use bKash / Nagad.');
          setSubmitting(false);
          return;
        }

        const nextBalance = Math.max(0, Number((freshBalance - selectedPackage.price).toFixed(2)));
        const walletTrx = `WALLET-${orderNumber}`;
        const walletTrxKey = `wallet_${orderNumber}`;

        batch.update(custRef, {
          walletBalance: nextBalance,
          updatedAt: now,
        });

        batch.set(doc(db, 'orders', orderId), {
          id: orderId,
          orderNumber,
          customerUid: firebaseUser.uid,
          customerName: customerName.trim().slice(0, 100),
          customerEmail: (firebaseUser.email || '').slice(0, 160),
          customerPhone: effectivePhone,
          productId: product.id,
          productName: product.name.slice(0, 120),
          productImage: thumbUrl,
          packageId: selectedPackage.id,
          packageName: selectedPackage.name.slice(0, 120),
          quantityLabel: selectedPackage.quantityLabel.slice(0, 80),
          unitPrice: selectedPackage.price,
          totalAmount: selectedPackage.price,
          playerUid: playerUid.trim().slice(0, 80),
          serverId: serverId.trim().slice(0, 80),
          paymentType: 'wallet',
          paymentMethodId: 'wallet',
          paymentMethodName: 'Wallet Balance',
          senderNumber: effectivePhone.slice(0, 40),
          trxId: walletTrx,
          trxKey: walletTrxKey,
          screenshotUrl: '',
          voucherCode: '',
          paymentStatus: 'verified',
          orderStatus: 'pending',
          adminNote: '',
          notificationMessage: 'Paid via Wallet Balance. Queued for instant top-up delivery.',
          createdAt: now,
          updatedAt: now,
        });

        batch.set(doc(db, 'orderTracking', orderNumber), {
          orderNumber,
          productName: product.name.slice(0, 120),
          packageName: selectedPackage.name.slice(0, 120),
          playerUidMasked: maskUid(playerUid),
          paymentStatus: 'verified',
          orderStatus: 'pending',
          notificationMessage: 'Paid via Wallet Balance. Queued for instant top-up delivery.',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const trxKey = normalizeTrxKey(selectedMethod!.id, trxId);
        try {
          const existingTrx = await getDoc(doc(db, 'trxRegistry', trxKey));
          if (existingTrx.exists()) {
            failValidation('This Transaction ID (TrxID) has already been used. Duplicate TrxIDs are not permitted.');
            setSubmitting(false);
            return;
          }
        } catch (checkErr) {
          const checkMsg = checkErr instanceof Error ? checkErr.message.toLowerCase() : '';
          if (checkMsg.includes('permission')) {
            failValidation('This Transaction ID (TrxID) has already been used. Duplicate TrxIDs are not permitted.');
            setSubmitting(false);
            return;
          }
          throw checkErr;
        }

        batch.set(doc(db, 'orders', orderId), {
          id: orderId,
          orderNumber,
          customerUid: firebaseUser.uid,
          customerName: customerName.trim().slice(0, 100),
          customerEmail: (firebaseUser.email || '').slice(0, 160),
          customerPhone: effectivePhone,
          productId: product.id,
          productName: product.name.slice(0, 120),
          productImage: thumbUrl,
          packageId: selectedPackage.id,
          packageName: selectedPackage.name.slice(0, 120),
          quantityLabel: selectedPackage.quantityLabel.slice(0, 80),
          unitPrice: selectedPackage.price,
          totalAmount: selectedPackage.price,
          playerUid: playerUid.trim().slice(0, 80),
          serverId: serverId.trim().slice(0, 80),
          paymentType: 'manual',
          paymentMethodId: selectedMethod!.id,
          paymentMethodName: selectedMethod!.name.slice(0, 60),
          senderNumber: effectivePhone.slice(0, 40),
          trxId: trxId.trim().toUpperCase().slice(0, 64),
          trxKey,
          screenshotUrl: '',
          voucherCode: '',
          paymentStatus: 'pending',
          orderStatus: 'pending',
          adminNote: '',
          notificationMessage: 'Order received. Awaiting payment verification.',
          createdAt: now,
          updatedAt: now,
        });

        batch.set(doc(db, 'orderTracking', orderNumber), {
          orderNumber,
          productName: product.name.slice(0, 120),
          packageName: selectedPackage.name.slice(0, 120),
          playerUidMasked: maskUid(playerUid),
          paymentStatus: 'pending',
          orderStatus: 'pending',
          notificationMessage: 'Order received. Awaiting payment verification.',
          createdAt: now,
          updatedAt: now,
        });

        batch.set(doc(db, 'trxRegistry', trxKey), {
          trxKey,
          trxId: trxId.trim().toUpperCase().slice(0, 64),
          orderId,
          customerUid: firebaseUser.uid,
          paymentMethodId: selectedMethod!.id,
          amount: selectedPackage.price,
          status: 'pending',
          createdAt: now,
        });
      }

      await batch.commit();

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
              type: 'order',
              details: {
                orderId,
                orderNumber,
                productName: product.name,
                packageName: `${selectedPackage.name} (${selectedPackage.quantityLabel})`,
                amount: formatCurrency(selectedPackage.price),
                playerUid: playerUid.trim() || 'N/A',
                serverId: serverId.trim() || 'N/A',
                paymentMethod: paymentMode === 'wallet' ? 'Wallet Balance' : selectedMethod?.name || 'Manual',
                trxId: paymentMode === 'wallet' ? `WALLET-${orderNumber}` : trxId.trim().toUpperCase(),
                customerName: customerName.trim(),
                customerEmail: firebaseUser.email || '',
                customerPhone: effectivePhone,
              },
            }),
          });
          if (!notifyRes.ok) {
            console.error('Order admin notify HTTP error:', notifyRes.status);
          } else {
            const notifyData = (await notifyRes.json()) as {sent?: boolean; reason?: string};
            if (notifyData.sent === false) {
              console.warn('Order admin email skipped:', notifyData.reason);
            }
          }
        } catch (notifyErr) {
          console.error('Order admin notify request failed:', notifyErr);
        }
      })();

      toast.success(`Order ${orderNumber} placed!`);
      setConfirmedOrderNumber(orderNumber);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('already exists')) {
        failValidation('Unable to submit order: verify your TrxID is unique, wallet balance is sufficient, and account is active.');
      } else {
        handleFirestoreError(err, OperationType.WRITE, 'orders');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmedOrderNumber) {
    return (
      <StoreLayout>
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-7 text-center space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-display">
                {t('checkout.placedTitle')}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                {paymentMode === 'wallet' ? t('checkout.placedWallet') : t('checkout.placedManual')}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('checkout.orderRef')}
              </span>
              <p className="text-xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                {confirmedOrderNumber}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
              <Link
                to="/orders"
                className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 border border-slate-800 dark:border-slate-700 text-white text-sm font-semibold transition-colors">
                {t('checkout.viewOrders')}
              </Link>
              <Link
                to={`/track?order=${confirmedOrderNumber}`}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 border border-cyan-600 text-white text-sm font-semibold transition-colors">
                {t('checkout.trackLive')}
              </Link>
            </div>
          </div>
        </div>
      </StoreLayout>
    );
  }

  if (!product || !selectedPackage) {
    return (
      <StoreLayout>
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
            {t('checkout.noPackageTitle')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('checkout.noPackageDesc')}
          </p>
          <Link
            to="/"
            className="inline-flex px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 text-white text-sm font-semibold">
            {t('checkout.browseProducts')}
          </Link>
        </div>
      </StoreLayout>
    );
  }

  return (
    <StoreLayout>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-display mb-5">
          {t('checkout.title')}
        </h1>

        <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Form */}
          <div className="lg:col-span-7 space-y-5">
            {!firebaseUser && (
              <div className="rounded-2xl bg-cyan-50/80 dark:bg-cyan-950/40 border-[1.5px] border-cyan-300/90 dark:border-cyan-700/70 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('checkout.signInTitle')}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {t('checkout.signInDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signInCustomerWithGoogle()}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 border border-slate-800 dark:border-cyan-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer">
                  {t('nav.signInGoogle')}
                </button>
              </div>
            )}

            {/* Player & Customer Info */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-6 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display border-b border-slate-100 dark:border-slate-800 pb-3">
                {t('checkout.step1')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {product.requiresUid && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {product.uidLabel || 'Player UID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={playerUid}
                      onChange={(e) => setPlayerUid(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                )}
                {product.requiresServerId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {product.serverLabel || 'Server ID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={serverId}
                      onChange={(e) => setServerId(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                )}
                <div className={product.requiresUid && product.requiresServerId ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t('checkout.fullName')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder={t('checkout.enterName')}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Payment Option Switcher */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <CreditCard className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                {t('checkout.step2')}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMode('manual')}
                  className={`p-3.5 rounded-xl text-left transition-all cursor-pointer ${
                    paymentMode === 'manual'
                      ? 'border-2 border-cyan-500 bg-cyan-50/70 dark:bg-cyan-950/45 ring-2 ring-cyan-500/20 shadow-xs'
                      : 'border-[1.5px] border-slate-200/95 dark:border-slate-700 hover:border-slate-300 bg-white dark:bg-slate-950/50'
                  }`}>
                  <span className="text-sm font-bold text-slate-900 dark:text-white block">
                    {t('checkout.manualPay')}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('checkout.manualPayDesc')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMode('wallet')}
                  className={`p-3.5 rounded-xl text-left transition-all cursor-pointer ${
                    paymentMode === 'wallet'
                      ? 'border-2 border-cyan-500 bg-cyan-50/70 dark:bg-cyan-950/45 ring-2 ring-cyan-500/20 shadow-xs'
                      : 'border-[1.5px] border-slate-200/95 dark:border-slate-700 hover:border-slate-300 bg-white dark:bg-slate-950/50'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                      <Wallet className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />{' '}
                      {t('checkout.walletBalance')}
                    </span>
                    <span className="text-xs font-extrabold text-cyan-700 dark:text-cyan-400 tabular-nums">
                      {formatCurrency(walletBalance)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                    {canPayWithWallet ? t('checkout.walletInstant') : t('checkout.walletLow')}
                  </span>
                </button>
              </div>

              {paymentMode === 'wallet' ? (
                <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400">
                      {t('checkout.currentBalance')}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                      {formatCurrency(walletBalance)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400">
                      {t('checkout.orderTotal')}
                    </span>
                    <span className="font-bold text-cyan-700 dark:text-cyan-400 tabular-nums">
                      {formatCurrency(selectedPackage.price)}
                    </span>
                  </div>
                  {!canPayWithWallet && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                      <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        You need {formatCurrency(Math.max(0, selectedPackage.price - walletBalance))} more.
                      </span>
                      <Link
                        to="/add-money"
                        className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 border border-cyan-600 text-white text-xs font-semibold whitespace-nowrap">
                        {t('nav.addMoney')}
                      </Link>
                    </div>
                  )}
                </div>
              ) : activeMethods.length === 0 ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  No payment methods are currently enabled by the store administrator.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {activeMethods.map((method) => {
                      const active = selectedMethod?.id === method.id;
                      return (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setSelectedMethodId(method.id)}
                          className={`p-3 rounded-xl text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                            active
                              ? 'border-2 border-cyan-500 bg-cyan-50/70 dark:bg-cyan-950/45 ring-2 ring-cyan-500/20 shadow-xs'
                              : 'border-[1.5px] border-slate-200/95 dark:border-slate-700 hover:border-slate-300 bg-white dark:bg-slate-950/50'
                          }`}>
                          <PaymentMethodLogo name={method.name} logoUrl={method.logoUrl} size="sm" />
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

                  {selectedMethod && (
                    <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <PaymentMethodLogo
                            name={selectedMethod.name}
                            logoUrl={selectedMethod.logoUrl}
                            size="md"
                          />
                          <div className="min-w-0">
                            <span className="text-xs text-slate-500 dark:text-slate-400 block">
                              {t('checkout.sendTo')} {formatCurrency(selectedPackage.price)} → ({selectedMethod.name} {selectedMethod.accountType})
                            </span>
                            <span className="text-lg font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                              {selectedMethod.accountNumber}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyAccount()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-cyan-500 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shrink-0 transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                          {copiedNumber ? t('checkout.copied') : t('checkout.copyNumber')}
                        </button>
                      </div>
                      {selectedMethod.instructions && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed border-t border-slate-200/90 dark:border-slate-800 pt-2.5">
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
                      required={paymentMode === 'manual'}
                      value={trxId}
                      onChange={(e) => setTrxId(e.target.value)}
                      placeholder={t('checkout.trxPlaceholder')}
                      className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                </>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border-[1.5px] border-red-200 dark:border-red-800 p-4 flex items-start gap-2.5 text-sm text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right Summary */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-5 sm:p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-display border-b border-slate-100 dark:border-slate-800 pb-3">
                {t('checkout.orderSummary')}
              </h2>
              <div className="flex items-center gap-3.5 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <PackageVisual pkg={selectedPackage} size="lg" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {product.name}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{selectedPackage.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedPackage.quantityLabel}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{product.uidLabel || 'Player UID'}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {playerUid || '—'}
                  </span>
                </div>
                {product.requiresServerId && (
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>{product.serverLabel || 'Server'}</span>
                    <span className="font-medium text-slate-900 dark:text-white">
                      {serverId || '—'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{t('checkout.paymentMethod')}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {paymentMode === 'wallet'
                      ? t('checkout.walletBalance')
                      : selectedMethod?.name || '—'}
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
                  <span className="font-bold text-slate-900 dark:text-white">
                    {t('checkout.totalPayable')}
                  </span>
                  <span className="text-xl font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                    {formatCurrency(selectedPackage.price)}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  !firebaseUser ||
                  (paymentMode === 'manual' && activeMethods.length === 0) ||
                  (paymentMode === 'wallet' && !canPayWithWallet)
                }
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 border border-slate-800 dark:border-cyan-500 disabled:border-slate-300 dark:disabled:border-slate-700 text-white text-sm font-bold transition-colors cursor-pointer shadow-xs">
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> {t('checkout.submitting')}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" /> {t('checkout.confirmOrder')}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </StoreLayout>
  );
}
