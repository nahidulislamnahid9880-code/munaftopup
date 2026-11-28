import React, {useEffect, useMemo, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  CreditCard,
  FileText,
  Flame,
  Gift,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Tag,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {formatCurrency} from '../../lib/firebase';
import {
  calculatePackagePricing,
  getActiveFlashSaleForProduct,
  validatePlayerUidForProduct,
} from '../../lib/pricing';
import type {Order} from '../../types';
import {PackageVisual} from '../../components/PackageTypeIcon';
import {PaymentMethodLogo} from '../../components/PaymentMethodLogo';
import {OrderReceiptModal} from '../../components/store/OrderReceiptModal';
import {StoreLayout} from '../../components/store/StoreLayout';

interface AppliedCouponState {
  code: string;
  title: string;
  discountAmount: number;
}

interface ConfirmedOrderResult {
  orderNumber: string;
  totalAmount: number;
  paymentStatus: string;
  orderStatus: string;
  autoVerified?: boolean;
  voucherCode?: string;
  fraudFlag?: boolean;
}

export function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const {products, paymentMethods, flashSales, programConfig, siteSettings} = useStore();
  const {firebaseUser, customerProfile, signInCustomerWithGoogle} = useAuth();
  const {t} = useLanguage();
  const toast = useToast();

  const productId = searchParams.get('productId') || '';
  const packageId = searchParams.get('packageId') || '';
  const initialUid = searchParams.get('uid') || '';
  const initialServer = searchParams.get('server') || '';
  const initialIgn = searchParams.get('ign') || '';
  const gatewayReturnStatus = searchParams.get('status') || '';

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
  const activeFlashSale = useMemo(
    () => (product ? getActiveFlashSaleForProduct(flashSales, product.id) : null),
    [flashSales, product],
  );

  const pricing = useMemo(
    () =>
      calculatePackagePricing(
        selectedPackage?.price || 0,
        activeFlashSale,
        customerProfile?.tier,
        programConfig,
      ),
    [selectedPackage?.price, activeFlashSale, customerProfile?.tier, programConfig],
  );

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCouponState | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const finalTotal = useMemo(() => {
    const disc = appliedCoupon?.discountAmount || 0;
    return Math.max(1, Number((pricing.finalPriceBeforeCoupon - disc).toFixed(2)));
  }, [pricing.finalPriceBeforeCoupon, appliedCoupon]);

  const walletBalance = customerProfile?.walletBalance ?? 0;
  const canPayWithWallet = Boolean(
    firebaseUser && selectedPackage && finalTotal > 0 && walletBalance >= finalTotal,
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
  const [gatewayRedirecting, setGatewayRedirecting] = useState(false);
  const [error, setError] = useState('');
  const [duplicateOrderWarning, setDuplicateOrderWarning] = useState<string | null>(null);
  const [confirmedResult, setConfirmedResult] = useState<ConfirmedOrderResult | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const [verifiedIgn, setVerifiedIgn] = useState(initialIgn);
  const [ignRegion, setIgnRegion] = useState('');
  const [ignStatus, setIgnStatus] = useState<'idle' | 'checking' | 'verified' | 'fallback' | 'invalid'>(
    initialIgn ? 'verified' : 'idle',
  );
  const [ignMessage, setIgnMessage] = useState('');

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

  useEffect(() => {
    if (gatewayReturnStatus === 'failed') {
      toast.error('Payment gateway returned a failed status. You can retry or pay manually.');
    } else if (gatewayReturnStatus === 'cancelled') {
      toast.info('Payment gateway session was cancelled.');
    }
  }, [gatewayReturnStatus, toast]);

  const runIgnLookup = async (uidValue: string, showToastOnError = false) => {
    if (!product?.requiresUid) return;
    const clean = uidValue.trim();
    if (clean.length < 4) {
      setVerifiedIgn('');
      setIgnRegion('');
      setIgnStatus('idle');
      setIgnMessage('');
      return;
    }
    setIgnStatus('checking');
    try {
      const qs = new URLSearchParams({
        uid: clean,
        productName: product.name,
        ...(serverId ? {serverId: serverId.trim()} : {}),
      });
      const res = await fetch(`/api/store/lookup-player?${qs.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        validFormat?: boolean;
        verified?: boolean;
        ign?: string;
        region?: string;
        message?: string;
      };
      if (!data.validFormat) {
        setVerifiedIgn('');
        setIgnRegion('');
        setIgnStatus('invalid');
        setIgnMessage(data.message || 'Invalid Player UID format.');
        if (showToastOnError) toast.error(data.message || 'Invalid Player UID format.');
        return;
      }
      if (data.verified && data.ign) {
        setVerifiedIgn(data.ign);
        setIgnRegion(data.region || '');
        setIgnStatus('verified');
        setIgnMessage(data.message || `Player IGN: ${data.ign}`);
      } else {
        setVerifiedIgn('');
        setIgnRegion('');
        setIgnStatus('fallback');
        setIgnMessage(data.message || 'UID format looks valid.');
      }
    } catch {
      setIgnStatus('idle');
    }
  };

  useEffect(() => {
    if (!product?.requiresUid) return;
    const clean = playerUid.trim();
    if (!clean || clean.length < 5) {
      setVerifiedIgn('');
      setIgnRegion('');
      setIgnStatus('idle');
      setIgnMessage('');
      return;
    }
    if (clean === initialUid && initialIgn && verifiedIgn === initialIgn) return;
    const timer = window.setTimeout(() => {
      void runIgnLookup(clean, false);
    }, 650);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerUid, serverId, product?.id]);

  const selectedMethod = activeMethods.find((m) => m.id === selectedMethodId) || activeMethods[0];

  const handleCopyText = async (val: string, label: string) => {
    if (!val) return;
    await navigator.clipboard.writeText(val);
    toast.success(`${label} copied`);
  };

  const handleCopyAccount = async () => {
    if (!selectedMethod?.accountNumber) return;
    await handleCopyText(selectedMethod.accountNumber, selectedMethod.name);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  const failValidation = (msg: string) => {
    setError(msg);
    toast.error(msg);
  };

  const handleApplyCoupon = async () => {
    if (!firebaseUser) {
      toast.error('Please sign in first to apply a promo code');
      return;
    }
    const cleanCode = couponInput.trim().toUpperCase();
    if (!cleanCode) {
      toast.error('Enter a promo code');
      return;
    }
    setValidatingCoupon(true);
    setError('');
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/store/validate-coupon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: cleanCode,
          productId: product?.id,
          packageId: selectedPackage?.id,
          amount: pricing.finalPriceBeforeCoupon,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        coupon?: AppliedCouponState;
      };
      if (!res.ok || !data.coupon) {
        throw new Error(data.error || 'Promo code is invalid');
      }
      setAppliedCoupon(data.coupon);
      setCouponInput(data.coupon.code);
      toast.success(`Coupon ${data.coupon.code} applied (-${formatCurrency(data.coupon.discountAmount)})`);
    } catch (err) {
      setAppliedCoupon(null);
      toast.error(err instanceof Error ? err.message : 'Unable to apply promo code');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const submitOrderEnhanced = async (confirmDuplicate: boolean) => {
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
    if (product.requiresUid) {
      const uidErr = validatePlayerUidForProduct(product.name, playerUid);
      if (uidErr) {
        failValidation(uidErr);
        return;
      }
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
      customerPhone.trim().length >= 5
        ? customerPhone.trim()
        : customerProfile?.phone?.trim() && customerProfile.phone.trim().length >= 5
          ? customerProfile.phone.trim()
          : 'Not Required'
    ).slice(0, 30);

    if (paymentMode === 'wallet') {
      if (finalTotal <= 0 || walletBalance < finalTotal) {
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
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/orders/create-enhanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productId: product.id,
          packageId: selectedPackage.id,
          playerUid: playerUid.trim(),
          ...(verifiedIgn ? {playerIgn: verifiedIgn} : {}),
          serverId: serverId.trim() || 'N/A',
          customerName: customerName.trim(),
          customerPhone: effectivePhone,
          paymentType: paymentMode,
          paymentMethodId: paymentMode === 'wallet' ? 'wallet' : selectedMethod?.id,
          senderNumber: paymentMode === 'wallet' ? 'WALLET' : effectivePhone,
          trxId: paymentMode === 'wallet' ? '' : trxId.trim().toUpperCase(),
          couponCode: appliedCoupon?.code || '',
          confirmDuplicate,
        }),
      });

      const payload = (await res.json()) as {
        ok?: boolean;
        code?: string;
        existingOrderNumber?: string;
        error?: string;
        orderNumber?: string;
        totalAmount?: number;
        paymentStatus?: string;
        orderStatus?: string;
        autoVerified?: boolean;
        voucherCode?: string;
        fraudFlag?: boolean;
      };

      if (res.status === 409 && payload.code === 'DUPLICATE_PENDING_ORDER') {
        setDuplicateOrderWarning(payload.existingOrderNumber || 'recent order');
        return;
      }

      if (!res.ok || !payload.ok || !payload.orderNumber) {
        throw new Error(payload.error || 'Unable to place order. Please review your details.');
      }

      setDuplicateOrderWarning(null);
      toast.success(
        payload.autoVerified
          ? `Order ${payload.orderNumber} placed & payment verified automatically!`
          : `Order ${payload.orderNumber} placed!`,
      );
      setConfirmedResult({
        orderNumber: payload.orderNumber,
        totalAmount: payload.totalAmount ?? finalTotal,
        paymentStatus: payload.paymentStatus || 'pending',
        orderStatus: payload.orderStatus || 'pending',
        autoVerified: payload.autoVerified,
        voucherCode: payload.voucherCode,
        fraudFlag: payload.fraudFlag,
      });
    } catch (err) {
      failValidation(err instanceof Error ? err.message : 'Unable to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitOrderEnhanced(false);
  };

  const handleMerchantGatewayPay = async () => {
    if (!firebaseUser) {
      failValidation('Please sign in with Google first to use instant gateway payment.');
      return;
    }
    if (!product || !selectedPackage) return;
    if (product.requiresUid) {
      const uidErr = validatePlayerUidForProduct(product.name, playerUid);
      if (uidErr) {
        failValidation(uidErr);
        return;
      }
    }
    if (product.requiresServerId && !serverId.trim()) {
      failValidation(`Please enter your ${product.serverLabel || 'Server ID'}.`);
      return;
    }
    setGatewayRedirecting(true);
    setError('');
    try {
      const token = await firebaseUser.getIdToken();
      const effectivePhone = (
        customerPhone.trim().length >= 5
          ? customerPhone.trim()
          : customerProfile?.phone?.trim() && customerProfile.phone.trim().length >= 5
            ? customerProfile.phone.trim()
            : 'Not Required'
      ).slice(0, 30);
      const res = await fetch('/api/payment-gateway/create-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          purpose: 'order',
          productId: product.id,
          packageId: selectedPackage.id,
          playerUid: product.requiresUid ? playerUid.trim() : 'N/A',
          ...(verifiedIgn ? {playerIgn: verifiedIgn} : {}),
          serverId: serverId.trim() || 'N/A',
          amount: finalTotal,
          customerName: customerName.trim() || customerProfile?.displayName || firebaseUser.displayName || 'Customer',
          customerEmail: firebaseUser.email || '',
          customerPhone: effectivePhone,
        }),
      });
      const data = (await res.json()) as {ok?: boolean; paymentUrl?: string; error?: string};
      if (!res.ok || !data.paymentUrl) {
        throw new Error(data.error || 'Automated gateway is not configured yet');
      }
      window.location.assign(data.paymentUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to launch payment gateway');
    } finally {
      setGatewayRedirecting(false);
    }
  };

  if (confirmedResult) {
    const receiptOrderObj: Order = {
      id: confirmedResult.orderNumber,
      orderNumber: confirmedResult.orderNumber,
      customerUid: firebaseUser?.uid || '',
      customerName: customerName.trim() || customerProfile?.displayName || firebaseUser?.displayName || 'Customer',
      customerEmail: firebaseUser?.email || '',
      customerPhone: customerPhone.trim() || customerProfile?.phone || 'Not Required',
      productId: product?.id || '',
      productName: product?.name || 'Game Top-Up',
      productImage: product?.images?.[0] || '',
      packageId: selectedPackage?.id || '',
      packageName: selectedPackage?.name || 'Package',
      quantityLabel: selectedPackage?.quantityLabel || '',
      unitPrice: pricing.basePrice,
      totalAmount: confirmedResult.totalAmount,
      couponCode: appliedCoupon?.code,
      couponDiscount: appliedCoupon?.discountAmount,
      tierDiscount: pricing.tierDiscount,
      flashSaleDiscount: pricing.flashSaleDiscount,
      appliedTier: pricing.appliedTier,
      playerUid: product?.requiresUid === false ? 'N/A' : playerUid.trim(),
      playerIgn: verifiedIgn || undefined,
      serverId: product?.requiresServerId ? serverId.trim() || 'N/A' : 'N/A',
      paymentType: paymentMode,
      paymentMethodId: paymentMode === 'wallet' ? 'wallet' : selectedMethod?.id || 'manual',
      paymentMethodName:
        paymentMode === 'wallet' ? 'Wallet Balance' : selectedMethod?.name || 'Mobile Banking',
      senderNumber: paymentMode === 'wallet' ? 'WALLET' : customerPhone.trim() || 'Not Required',
      trxId: paymentMode === 'wallet' ? `WAL_${confirmedResult.orderNumber}` : trxId.trim().toUpperCase(),
      trxKey: paymentMode === 'wallet' ? `WAL_${confirmedResult.orderNumber}` : trxId.trim().toUpperCase(),
      screenshotUrl: '',
      voucherCode: confirmedResult.voucherCode,
      paymentStatus: confirmedResult.paymentStatus === 'verified' ? 'verified' : 'pending',
      orderStatus:
        confirmedResult.orderStatus === 'completed'
          ? 'completed'
          : confirmedResult.orderStatus === 'processing'
            ? 'processing'
            : 'pending',
      adminNote: '',
      notificationMessage: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

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
                {confirmedResult.voucherCode
                  ? 'Payment verified & your Voucher PIN has been delivered automatically!'
                  : confirmedResult.autoVerified
                    ? 'Payment verified automatically. Processing top-up.'
                    : confirmedResult.paymentStatus === 'verified'
                      ? t('checkout.placedWallet')
                      : t('checkout.placedManual')}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('checkout.orderRef')}
              </span>
              <p className="text-xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                {confirmedResult.orderNumber}
              </p>
              <p className="text-xs text-cyan-600 dark:text-cyan-400 font-bold">
                {formatCurrency(confirmedResult.totalAmount)} ·{' '}
                <span className="capitalize">{confirmedResult.orderStatus}</span>
              </p>
            </div>

            {confirmedResult.voucherCode && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border-[1.5px] border-emerald-300 dark:border-emerald-700 p-4 space-y-2 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4" /> Instant Delivered PIN
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyText(confirmedResult.voucherCode || '', 'Voucher PIN')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer">
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </div>
                <p className="font-mono text-sm font-extrabold text-slate-900 dark:text-white break-all">
                  {confirmedResult.voucherCode}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center pt-1">
              <button
                type="button"
                onClick={() => setShowReceiptModal(true)}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 text-white text-sm font-semibold cursor-pointer transition-colors">
                <FileText className="w-4 h-4" /> Download PNG / PDF Receipt
              </button>
              <Link
                to="/orders"
                className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 border border-slate-800 dark:border-slate-700 text-white text-sm font-semibold transition-colors">
                {t('checkout.viewOrders')}
              </Link>
              <Link
                to={`/track?order=${confirmedResult.orderNumber}`}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 border border-cyan-600 text-white text-sm font-semibold transition-colors">
                {t('checkout.trackLive')}
              </Link>
            </div>
          </div>
        </div>
        {showReceiptModal && (
          <OrderReceiptModal
            order={receiptOrderObj}
            brandName={siteSettings.brandName || 'MUNAFTOPUP.bd'}
            onClose={() => setShowReceiptModal(false)}
          />
        )}
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
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        value={playerUid}
                        onChange={(e) => setPlayerUid(e.target.value)}
                        className="flex-1 px-3.5 py-2.5 text-sm font-mono rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                      />
                      <button
                        type="button"
                        disabled={ignStatus === 'checking' || playerUid.trim().length < 4}
                        onClick={() => void runIgnLookup(playerUid, true)}
                        className="px-3 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer inline-flex items-center gap-1 transition-colors">
                        {ignStatus === 'checking' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                        <span>Check</span>
                      </button>
                    </div>
                    {ignStatus === 'checking' && (
                      <p className="text-[11px] text-cyan-600 dark:text-cyan-400 mt-1 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Verifying player name...
                      </p>
                    )}
                    {ignStatus === 'verified' && verifiedIgn && (
                      <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 shrink-0" /> IGN: {verifiedIgn}
                        </span>
                        {ignRegion && <span className="font-mono text-[10px]">{ignRegion}</span>}
                      </div>
                    )}
                    {ignStatus === 'invalid' && ignMessage && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1 font-semibold">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {ignMessage}
                      </p>
                    )}
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

            {/* Promo Code Section */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> {t('promo.label')}
                </label>
                {appliedCoupon && (
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    -{formatCurrency(appliedCoupon.discountAmount)}
                  </span>
                )}
              </div>

              {appliedCoupon ? (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                  <div className="text-xs">
                    <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                      {appliedCoupon.code}
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400 ml-2">
                      {appliedCoupon.title} (-{formatCurrency(appliedCoupon.discountAmount)})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAppliedCoupon(null)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer">
                    <X className="w-3.5 h-3.5" /> {t('promo.remove')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder={t('promo.placeholder')}
                    className="flex-1 px-3.5 py-2 text-sm font-mono uppercase rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    disabled={validatingCoupon || !couponInput.trim()}
                    onClick={() => void handleApplyCoupon()}
                    className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:opacity-50 text-white text-xs sm:text-sm font-bold cursor-pointer">
                    {validatingCoupon ? '...' : t('promo.apply')}
                  </button>
                </div>
              )}
            </div>

            {/* Payment Option Switcher */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-6 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  {t('checkout.step2')}
                </h2>
                {programConfig.gatewayEnabled && (
                  <button
                    type="button"
                    disabled={gatewayRedirecting}
                    onClick={() => void handleMerchantGatewayPay()}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">
                    {gatewayRedirecting
                      ? 'Redirecting...'
                      : `Pay Instantly (${programConfig.gatewayProvider})`}
                  </button>
                )}
              </div>

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
                      {formatCurrency(finalTotal)}
                    </span>
                  </div>
                  {!canPayWithWallet && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                      <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        You need {formatCurrency(Math.max(0, finalTotal - walletBalance))} more.
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
                              {t('checkout.sendTo')} {formatCurrency(finalTotal)} → ({selectedMethod.name}{' '}
                              {selectedMethod.accountType})
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
                {verifiedIgn && (
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Verified IGN</span>
                    <span className="font-bold">
                      {verifiedIgn}
                      {ignRegion ? ` (${ignRegion})` : ''}
                    </span>
                  </div>
                )}
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
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Base Price</span>
                  <span className="tabular-nums">{formatCurrency(pricing.basePrice)}</span>
                </div>
                {pricing.flashSaleDiscount > 0 && (
                  <div className="flex justify-between text-rose-600 dark:text-rose-400 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5" /> Flash Sale ({pricing.flashSalePercent}%)
                    </span>
                    <span className="tabular-nums">-{formatCurrency(pricing.flashSaleDiscount)}</span>
                  </div>
                )}
                {pricing.tierDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-medium">
                    <span className="uppercase">
                      {pricing.appliedTier} {t('tier.discount')} ({pricing.tierPercent}%)
                    </span>
                    <span className="tabular-nums">-{formatCurrency(pricing.tierDiscount)}</span>
                  </div>
                )}
                {appliedCoupon && (
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-medium">
                    <span>Promo ({appliedCoupon.code})</span>
                    <span className="tabular-nums">-{formatCurrency(appliedCoupon.discountAmount)}</span>
                  </div>
                )}
                {pricing.estimatedLoyaltyPoints > 0 && (
                  <div className="flex justify-between text-xs text-amber-700 dark:text-amber-400">
                    <span className="inline-flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5" /> {t('loyalty.earnPreview')}
                    </span>
                    <span className="font-bold">+{pricing.estimatedLoyaltyPoints} pts</span>
                  </div>
                )}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
                  <span className="font-bold text-slate-900 dark:text-white">
                    {t('checkout.totalPayable')}
                  </span>
                  <span className="text-xl font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                    {formatCurrency(finalTotal)}
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

      {/* Duplicate Pending Order Confirmation Modal */}
      {duplicateOrderWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-[1px]">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border-[1.5px] border-amber-300 dark:border-amber-700 max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  {t('dup.title')}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                  You already placed an active order (<span className="font-mono font-bold">{duplicateOrderWarning}</span>) for the same package and Player UID within the last 10 minutes. Do you still want to place another order?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDuplicateOrderWarning(null)}
                className="px-4 py-2 rounded-xl border-[1.5px] border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitOrderEnhanced(true)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer">
                {submitting ? 'Submitting...' : t('dup.confirmAnyway')}
              </button>
            </div>
          </div>
        </div>
      )}
    </StoreLayout>
  );
}
