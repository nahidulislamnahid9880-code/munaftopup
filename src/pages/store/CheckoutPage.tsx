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
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  normalizeTrxKey,
} from '../../lib/firebase';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {PaymentMethodLogo} from '../../components/PaymentMethodLogo';
import {StoreLayout} from '../../components/store/StoreLayout';

export function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const {products, paymentMethods} = useStore();
  const {firebaseUser, customerProfile, signInCustomerWithGoogle} = useAuth();

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
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  const maskUid = (uid: string) => {
    const clean = uid.trim();
    if (clean.length <= 4) return clean;
    return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firebaseUser) {
      setError('Please sign in with Google above to submit and track your order.');
      return;
    }
    if (customerProfile?.suspended) {
      setError(`Your account is currently suspended: ${customerProfile.suspendedReason || 'Contact support.'}`);
      return;
    }
    if (!product || !selectedPackage) {
      setError('Selected product or package is no longer available.');
      return;
    }
    if (product.requiresUid && !playerUid.trim()) {
      setError(`Please enter your ${product.uidLabel || 'Player UID'}.`);
      return;
    }
    if (product.requiresServerId && !serverId.trim()) {
      setError(`Please enter your ${product.serverLabel || 'Server ID'}.`);
      return;
    }
    if (!customerName.trim()) {
      setError('Please enter your name.');
      return;
    }
    const effectivePhone = (
      customerProfile?.phone?.trim() && customerProfile.phone.trim().length >= 5
        ? customerProfile.phone.trim()
        : 'Not Required'
    ).slice(0, 30);

    if (paymentMode === 'wallet') {
      if (selectedPackage.price <= 0 || walletBalance < selectedPackage.price) {
        setError('Insufficient Wallet Balance. Add money or use bKash / Nagad.');
        return;
      }
    } else {
      if (!selectedMethod) {
        setError('Please select a payment method.');
        return;
      }
      if (trxId.trim().length < 4 || trxId.trim().length > 64) {
        setError('Please provide a valid Transaction ID (TrxID) between 4 and 64 characters.');
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
          setError('Insufficient Wallet Balance. Add money or use bKash / Nagad.');
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
            setError('This Transaction ID (TrxID) has already been used. Duplicate TrxIDs are not permitted.');
            setSubmitting(false);
            return;
          }
        } catch (checkErr) {
          const checkMsg = checkErr instanceof Error ? checkErr.message.toLowerCase() : '';
          if (checkMsg.includes('permission')) {
            setError('This Transaction ID (TrxID) has already been used. Duplicate TrxIDs are not permitted.');
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
          await fetch('/api/notify/admin', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              type: 'order',
              details: {
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
        } catch {
          // Non-blocking notification failure should never block order confirmation
        }
      })();

      setConfirmedOrderNumber(orderNumber);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('already exists')) {
        setError('Unable to submit order: verify your TrxID is unique, wallet balance is sufficient, and account is active.');
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
          <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-7 text-center space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
            <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 font-display">
                Order Placed Successfully
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">
                {paymentMode === 'wallet'
                  ? 'Paid with your Wallet Balance! Your order is queued for top-up delivery.'
                  : 'Your payment details have been submitted for verification. Track fulfillment live below.'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 border-[1.5px] border-slate-200/95 p-4 space-y-1">
              <span className="text-xs text-slate-500">Order Reference</span>
              <p className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {confirmedOrderNumber}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
              <Link
                to="/orders"
                className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-sm font-semibold transition-colors">
                View My Orders
              </Link>
              <Link
                to={`/track?order=${confirmedOrderNumber}`}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 border border-cyan-600 text-white text-sm font-semibold transition-colors">
                Track Order Live
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
          <h1 className="text-2xl font-bold text-slate-900 font-display">
            No Package Selected
          </h1>
          <p className="text-sm text-slate-600">
            Select a product and diamond package before proceeding to checkout.
          </p>
          <Link
            to="/"
            className="inline-flex px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold">
            Browse Products
          </Link>
        </div>
      </StoreLayout>
    );
  }

  return (
    <StoreLayout>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display mb-5">
          Secure Checkout
        </h1>

        <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Form */}
          <div className="lg:col-span-7 space-y-5">
            {!firebaseUser && (
              <div className="rounded-2xl bg-cyan-50/80 border-[1.5px] border-cyan-300/90 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-slate-900">Sign in to complete checkout</h2>
                  <p className="text-xs text-slate-600">
                    Sign in with Google to use Wallet Balance, track orders, and protect your TrxID.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signInCustomerWithGoogle()}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer">
                  Sign in with Google
                </button>
              </div>
            )}

            {/* Player & Customer Info */}
            <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 sm:p-6 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display border-b border-slate-100 pb-3">
                1. Player &amp; Contact Information
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {product.requiresUid && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {product.uidLabel || 'Player UID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={playerUid}
                      onChange={(e) => setPlayerUid(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                )}
                {product.requiresServerId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {product.serverLabel || 'Server ID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={serverId}
                      onChange={(e) => setServerId(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                )}
                  <div className={product.requiresUid && product.requiresServerId ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Enter your name"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

            {/* Payment Option Switcher: Manual bKash/Nagad vs Wallet Balance */}
            <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-4 sm:p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display flex items-center gap-2 border-b border-slate-100 pb-3">
                <CreditCard className="w-4 h-4 text-cyan-600" />
                2. Choose Payment Method
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMode('manual')}
                  className={`p-3.5 rounded-xl text-left transition-all cursor-pointer ${
                    paymentMode === 'manual'
                      ? 'border-2 border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-500/20 shadow-xs'
                      : 'border-[1.5px] border-slate-200/95 hover:border-slate-300 bg-white'
                  }`}>
                  <span className="text-sm font-bold text-slate-900 block">
                    bKash / Nagad Manual Pay
                  </span>
                  <span className="text-xs text-slate-500">Send Money &amp; submit TrxID</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMode('wallet')}
                  className={`p-3.5 rounded-xl text-left transition-all cursor-pointer ${
                    paymentMode === 'wallet'
                      ? 'border-2 border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-500/20 shadow-xs'
                      : 'border-[1.5px] border-slate-200/95 hover:border-slate-300 bg-white'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <Wallet className="w-4 h-4 text-cyan-600" /> Wallet Balance
                    </span>
                    <span className="text-xs font-extrabold text-cyan-700 tabular-nums">
                      {formatCurrency(walletBalance)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 block mt-0.5">
                    {canPayWithWallet
                      ? 'Instant verification from your balance'
                      : 'Insufficient balance — add money first'}
                  </span>
                </button>
              </div>

              {paymentMode === 'wallet' ? (
                <div className="rounded-xl bg-slate-50/90 border-[1.5px] border-slate-200/95 p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Current Wallet Balance</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {formatCurrency(walletBalance)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Order Total</span>
                    <span className="font-bold text-cyan-700 tabular-nums">
                      {formatCurrency(selectedPackage.price)}
                    </span>
                  </div>
                  {!canPayWithWallet && (
                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-3">
                      <span className="text-xs text-amber-700 font-medium">
                        You need {formatCurrency(Math.max(0, selectedPackage.price - walletBalance))} more.
                      </span>
                      <Link
                        to="/add-money"
                        className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 border border-cyan-600 text-white text-xs font-semibold whitespace-nowrap">
                        Add Money
                      </Link>
                    </div>
                  )}
                </div>
              ) : activeMethods.length === 0 ? (
                <p className="text-sm text-red-600">
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
                              ? 'border-2 border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-500/20 shadow-xs'
                              : 'border-[1.5px] border-slate-200/95 hover:border-slate-300 bg-white'
                          }`}>
                          <PaymentMethodLogo name={method.name} logoUrl={method.logoUrl} size="sm" />
                          <div className="min-w-0">
                            <span className="text-sm font-bold text-slate-900 block truncate">
                              {method.name}
                            </span>
                            <span className="text-[11px] text-slate-500 block">
                              {method.accountType}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedMethod && (
                    <div className="rounded-xl bg-slate-50/90 border-[1.5px] border-slate-200/95 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <PaymentMethodLogo
                            name={selectedMethod.name}
                            logoUrl={selectedMethod.logoUrl}
                            size="md"
                          />
                          <div className="min-w-0">
                            <span className="text-xs text-slate-500 block">
                              Send {formatCurrency(selectedPackage.price)} to ({selectedMethod.name} {selectedMethod.accountType})
                            </span>
                            <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                              {selectedMethod.accountNumber}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyAccount()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border-[1.5px] border-slate-300 hover:border-cyan-500 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shrink-0 transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                          {copiedNumber ? 'Copied' : 'Copy Number'}
                        </button>
                      </div>
                      {selectedMethod.instructions && (
                        <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed border-t border-slate-200/90 pt-2.5">
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
                      required={paymentMode === 'manual'}
                      value={trxId}
                      onChange={(e) => setTrxId(e.target.value)}
                      placeholder="Enter Transaction ID (TrxID)"
                      className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 hover:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
                  </div>
                </>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border-[1.5px] border-red-200 p-4 flex items-start gap-2.5 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right Summary */}
          <div className="lg:col-span-5 lg:sticky lg:top-20">
            <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-5 sm:p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
              <h2 className="text-base font-bold text-slate-900 font-display border-b border-slate-100 pb-3">
                Order Summary
              </h2>
              <div className="flex items-center gap-3.5 pb-4 border-b border-slate-200/70">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 border-[1.5px] border-slate-200 shrink-0">
                  <ImageWithFallback
                    src={selectedPackage.imageUrl || product.images?.[0]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{product.name}</p>
                  <p className="text-xs text-slate-600">{selectedPackage.name}</p>
                  <p className="text-xs text-slate-500">{selectedPackage.quantityLabel}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{product.uidLabel || 'Player UID'}</span>
                  <span className="font-mono font-semibold text-slate-900">{playerUid || '—'}</span>
                </div>
                {product.requiresServerId && (
                  <div className="flex justify-between text-slate-600">
                    <span>{product.serverLabel || 'Server'}</span>
                    <span className="font-medium text-slate-900">{serverId || '—'}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Payment Method</span>
                  <span className="font-semibold text-slate-900">
                    {paymentMode === 'wallet' ? 'Wallet Balance' : selectedMethod?.name || '—'}
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="font-bold text-slate-900">Total Payable</span>
                  <span className="text-xl font-extrabold text-cyan-600 tabular-nums">
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
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 border border-slate-800 disabled:border-slate-300 text-white text-sm font-bold transition-colors cursor-pointer shadow-xs">
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting Order...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" /> Confirm &amp; Place Order
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
