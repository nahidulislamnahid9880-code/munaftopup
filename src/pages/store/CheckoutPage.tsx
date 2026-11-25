import React, {useEffect, useMemo, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import {doc, getDoc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {
  OperationType,
  db,
  formatCurrency,
  handleFirestoreError,
  normalizeTrxKey,
} from '../../lib/firebase';
import {ImageUploadField} from '../../components/ImageUploadField';
import {ImageWithFallback} from '../../components/ImageWithFallback';
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

  const [playerUid, setPlayerUid] = useState(initialUid);
  const [serverId, setServerId] = useState(initialServer);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
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
    if (!selectedMethod) {
      setError('Please select a payment method.');
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
    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Please enter your name and contact phone number.');
      return;
    }
    if (senderNumber.trim().length < 5 || trxId.trim().length < 4) {
      setError('Please provide a valid sender number and Transaction ID (TrxID).');
      return;
    }

    setSubmitting(true);
    try {
      const trxKey = normalizeTrxKey(selectedMethod.id, trxId);
      const existingTrx = await getDoc(doc(db, 'trxRegistry', trxKey));
      if (existingTrx.exists()) {
        setError('This Transaction ID (TrxID) has already been used on another order. Duplicate TrxIDs are not permitted.');
        setSubmitting(false);
        return;
      }

      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const orderNumber = `SV-${Math.floor(100000 + Math.random() * 900000)}`;
      const now = serverTimestamp();

      const batch = writeBatch(db);

      batch.set(doc(db, 'orders', orderId), {
        id: orderId,
        orderNumber,
        customerUid: firebaseUser.uid,
        customerName: customerName.trim().slice(0, 100),
        customerEmail: firebaseUser.email || '',
        customerPhone: customerPhone.trim().slice(0, 30),
        productId: product.id,
        productName: product.name.slice(0, 120),
        packageId: selectedPackage.id,
        packageName: selectedPackage.name.slice(0, 120),
        quantityLabel: selectedPackage.quantityLabel.slice(0, 80),
        unitPrice: selectedPackage.price,
        totalAmount: selectedPackage.price,
        playerUid: playerUid.trim().slice(0, 80),
        serverId: serverId.trim().slice(0, 80),
        paymentMethodId: selectedMethod.id,
        paymentMethodName: selectedMethod.name.slice(0, 60),
        senderNumber: senderNumber.trim().slice(0, 40),
        trxId: trxId.trim().toUpperCase().slice(0, 64),
        trxKey,
        screenshotUrl: screenshotUrl.trim().slice(0, 1000),
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
        paymentMethodId: selectedMethod.id,
        amount: selectedPackage.price,
        status: 'pending',
        createdAt: now,
      });

      await batch.commit();
      setConfirmedOrderNumber(orderNumber);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('already exists')) {
        setError('Unable to submit order: verify your TrxID is unique and your account is active.');
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
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-16">
          <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-5">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900 font-display">
                Order Submitted Successfully
              </h1>
              <p className="text-sm text-slate-600">
                Your payment details have been queued for verification. Save your Order ID to track fulfillment.
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1">
              <span className="text-xs text-slate-500">Order Reference</span>
              <p className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {confirmedOrderNumber}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Link
                to={`/track?order=${confirmedOrderNumber}`}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
                Track Order Live
              </Link>
              <Link
                to="/"
                className="px-5 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors">
                Continue Shopping
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900 font-display">
            No Package Selected
          </h1>
          <p className="text-sm text-slate-600">
            Select a product and diamond package before proceeding to checkout.
          </p>
          <Link
            to="/"
            className="inline-flex px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold">
            Browse Products
          </Link>
        </div>
      </StoreLayout>
    );
  }

  return (
    <StoreLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display mb-8">
          Secure Checkout
        </h1>

        <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Form */}
          <div className="lg:col-span-7 space-y-6">
            {/* Auth check banner */}
            {!firebaseUser && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-slate-900">Sign in to complete checkout</h2>
                  <p className="text-xs text-slate-600">
                    Sign in with Google so your order receipt, TrxID protection, and support tickets stay linked to your account.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signInCustomerWithGoogle()}
                  className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer">
                  Sign in with Google
                </button>
              </div>
            )}

            {/* Player & Customer Info */}
            <div className="rounded-xl bg-white border border-slate-200 p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900 font-display">
                1. Player &amp; Customer Information
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {product.requiresUid && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {product.uidLabel || 'Player UID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={playerUid}
                      onChange={(e) => setPlayerUid(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                )}
                {product.requiresServerId && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {product.serverLabel || 'Server ID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={serverId}
                      onChange={(e) => setServerId(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
              </div>
            </div>

            {/* Payment Method & Verification */}
            <div className="rounded-xl bg-white border border-slate-200 p-6 space-y-5">
              <h2 className="text-base font-bold text-slate-900 font-display flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600" />
                2. Payment Method &amp; Transaction Verification
              </h2>

              {activeMethods.length === 0 ? (
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
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-600/20'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}>
                          <div className="flex items-center gap-2">
                            {method.logoUrl && (
                              <ImageWithFallback
                                src={method.logoUrl}
                                alt={method.name}
                                className="w-6 h-6 rounded object-cover"
                              />
                            )}
                            <span className="text-sm font-bold text-slate-900">{method.name}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            {method.accountType}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedMethod && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <span className="text-xs text-slate-500 block">
                            Send {formatCurrency(selectedPackage.price)} to ({selectedMethod.name} {selectedMethod.accountType})
                          </span>
                          <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                            {selectedMethod.accountNumber}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyAccount()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer">
                          <Copy className="w-3.5 h-3.5" />
                          {copiedNumber ? 'Copied' : 'Copy Number'}
                        </button>
                      </div>
                      {selectedMethod.instructions && (
                        <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed border-t border-slate-200 pt-2.5">
                          {selectedMethod.instructions}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Your Sender Number *
                      </label>
                      <input
                        type="text"
                        required
                        value={senderNumber}
                        onChange={(e) => setSenderNumber(e.target.value)}
                        placeholder="01XXXXXXXXX"
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Transaction ID (TrxID) *
                      </label>
                      <input
                        type="text"
                        required
                        value={trxId}
                        onChange={(e) => setTrxId(e.target.value)}
                        placeholder="e.g. 9K2M7P4X1Q"
                        className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                    </div>
                  </div>

                  {firebaseUser && (
                    <ImageUploadField
                      label="Payment Screenshot (Optional)"
                      value={screenshotUrl}
                      onChange={setScreenshotUrl}
                      endpoint="/api/upload"
                      compact
                    />
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-2.5 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right Summary */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <div className="rounded-xl bg-white border border-slate-200 p-6 space-y-5">
              <h2 className="text-base font-bold text-slate-900 font-display">Order Summary</h2>
              <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
                <div className="w-16 h-14 rounded-lg overflow-hidden bg-slate-900 shrink-0">
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
                  <span className="font-mono font-medium text-slate-900">{playerUid || '—'}</span>
                </div>
                {product.requiresServerId && (
                  <div className="flex justify-between text-slate-600">
                    <span>{product.serverLabel || 'Server'}</span>
                    <span className="font-medium text-slate-900">{serverId || '—'}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Payment Method</span>
                  <span className="font-medium text-slate-900">{selectedMethod?.name || '—'}</span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="font-bold text-slate-900">Total Payable</span>
                  <span className="text-xl font-bold text-blue-600 tabular-nums">
                    {formatCurrency(selectedPackage.price)}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !firebaseUser || activeMethods.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-semibold transition-colors cursor-pointer">
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
