import React, {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  Circle,
  Flame,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
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
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {PackageVisual} from '../../components/PackageTypeIcon';
import {ReviewsSection} from '../../components/store/ReviewsSection';
import {StoreLayout} from '../../components/store/StoreLayout';

const LAST_UID_KEY = 'sv_last_player_uid';

export function ProductDetailPage() {
  const {slug} = useParams<{slug: string}>();
  const navigate = useNavigate();
  const {products, flashSales, programConfig, loading} = useStore();
  const {firebaseUser, customerProfile, saveCustomerPlayerUid, removeCustomerPlayerUid} = useAuth();
  const {t} = useLanguage();
  const toast = useToast();

  const product = useMemo(
    () => products.find((p) => p.slug === slug || p.id === slug),
    [products, slug],
  );

  const activeFlashSale = useMemo(
    () => (product ? getActiveFlashSaleForProduct(flashSales, product.id) : null),
    [flashSales, product],
  );

  const activePackages = useMemo(() => {
    if (!product) return [];
    return [...(product.packages || [])]
      .filter((pkg) => pkg.active)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [product]);

  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [selectedPkgId, setSelectedPkgId] = useState<string>('');
  const [playerUid, setPlayerUid] = useState('');
  const [savedUid, setSavedUid] = useState('');
  const [serverId, setServerId] = useState('');
  const [formError, setFormError] = useState('');
  const [showSaveUidForm, setShowSaveUidForm] = useState(false);
  const [uidLabel, setUidLabel] = useState('');
  const [savingUid, setSavingUid] = useState(false);
  const [verifiedIgn, setVerifiedIgn] = useState('');
  const [ignRegion, setIgnRegion] = useState('');
  const [ignStatus, setIgnStatus] = useState<'idle' | 'checking' | 'verified' | 'fallback' | 'invalid'>('idle');
  const [ignMessage, setIgnMessage] = useState('');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LAST_UID_KEY) || '';
      if (stored) setSavedUid(stored);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    setActiveImgIdx(0);
    if (activePackages.length > 0 && !activePackages.some((p) => p.id === selectedPkgId)) {
      setSelectedPkgId(activePackages[0].id);
    }
    if (product?.serverOptions?.length && !serverId) {
      setServerId(product.serverOptions[0]);
    }
  }, [product, activePackages, selectedPkgId, serverId]);

  const selectedPackage = activePackages.find((p) => p.id === selectedPkgId) || activePackages[0];
  const selectedPricing = useMemo(
    () =>
      selectedPackage
        ? calculatePackagePricing(
            selectedPackage.price,
            activeFlashSale,
            customerProfile?.tier,
            programConfig,
          )
        : null,
    [selectedPackage, activeFlashSale, customerProfile?.tier, programConfig],
  );

  const isNumericUidGame = useMemo(
    () => (product ? validatePlayerUidForProduct(product.name, '123456') === null && validatePlayerUidForProduct(product.name, 'abcde') !== null : false),
    [product],
  );

  const runIgnLookup = async (uidValue: string, showToastOnError = false) => {
    if (!product?.requiresUid) return;
    const cleanUid = uidValue.trim();
    if (cleanUid.length < 4) {
      setVerifiedIgn('');
      setIgnRegion('');
      setIgnStatus('idle');
      setIgnMessage('');
      return;
    }
    setIgnStatus('checking');
    try {
      const qs = new URLSearchParams({
        uid: cleanUid,
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
        setIgnMessage(data.message || `Player Name: ${data.ign}`);
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
    if (clean.length < 5) {
      setVerifiedIgn('');
      setIgnRegion('');
      setIgnStatus('idle');
      setIgnMessage('');
      return;
    }
    const timer = window.setTimeout(() => {
      void runIgnLookup(clean, false);
    }, 650);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerUid, serverId, product?.id]);

  const handleSaveUidProfile = async () => {
    if (!product || !playerUid.trim()) {
      toast.error('Enter a Player UID first');
      return;
    }
    const uidErr = validatePlayerUidForProduct(product.name, playerUid);
    if (uidErr) {
      toast.error(uidErr);
      return;
    }
    setSavingUid(true);
    try {
      await saveCustomerPlayerUid({
        label: uidLabel.trim() || `${product.name.split(' ')[0]} ID`,
        gameName: product.name,
        playerUid: playerUid.trim(),
        serverId: serverId.trim() || 'N/A',
      });
      toast.success('Player UID saved to your profile!');
      setShowSaveUidForm(false);
      setUidLabel('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save UID');
    } finally {
      setSavingUid(false);
    }
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!product || !selectedPackage) return;
    const trimmedUid = playerUid.trim();
    if (product.requiresUid) {
      const uidErr = validatePlayerUidForProduct(product.name, trimmedUid);
      if (uidErr) {
        setFormError(uidErr);
        toast.error(uidErr);
        return;
      }
    }
    if (product.requiresServerId && !serverId.trim()) {
      const msg = `Please select or enter your ${product.serverLabel || 'Server ID'}.`;
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (trimmedUid) {
      try {
        window.localStorage.setItem(LAST_UID_KEY, trimmedUid);
      } catch {
        // ignore storage errors
      }
    }

    const params = new URLSearchParams({
      productId: product.id,
      packageId: selectedPackage.id,
      uid: trimmedUid,
      server: serverId.trim(),
      ...(verifiedIgn ? {ign: verifiedIgn} : {}),
    });
    navigate(`/checkout?${params.toString()}`);
  };

  if (loading) {
    return (
      <StoreLayout>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5 animate-pulse">
          <div className="h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 h-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
            <div className="lg:col-span-4 h-72 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          </div>
        </div>
      </StoreLayout>
    );
  }

  if (!product || !product.active) {
    return (
      <StoreLayout>
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
            {t('product.notFound')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('product.notFoundDesc')}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 text-white text-sm font-semibold">
            <ArrowLeft className="w-4 h-4" /> {t('product.backToHome')}
          </Link>
        </div>
      </StoreLayout>
    );
  }

  const images = product.images?.length ? product.images : [''];
  const hasLongPackageNames = activePackages.some((p) => p.name.length > 26);

  return (
    <StoreLayout>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Link to="/" className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" /> {t('nav.home')}
          </Link>
          <span>/</span>
          <span>{product.categoryName}</span>
          <span>/</span>
          <span className="text-slate-900 dark:text-white font-semibold truncate">{product.name}</span>
        </div>

        {/* Top Product Heading Card */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border-[1.5px] border-slate-200 dark:border-slate-700 shrink-0">
            <ImageWithFallback
              src={images[activeImgIdx] || images[0]}
              alt={product.name}
              fallbackLabel={product.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
              {product.categoryName}
            </span>
            <h1 className="text-lg sm:text-2xl font-extrabold text-slate-900 dark:text-white font-display leading-tight">
              {product.name}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
              {product.shortDescription}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Left / Main Purchase Column */}
          <form onSubmit={handleContinue} className="lg:col-span-8 space-y-4 sm:space-y-5">
            {/* Step 1: Select Recharge */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3.5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 shadow-2xs">
                    1
                  </span>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display">
                    {t('product.selectRecharge')}
                  </h2>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {activePackages.length} {t('product.packagesCount')}
                </span>
              </div>

              {activePackages.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                  {t('product.noPackages')}
                </p>
              ) : (
                <div
                  className={`grid gap-2.5 ${
                    hasLongPackageNames ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'
                  }`}>
                  {activePackages.map((pkg) => {
                    const isSelected = selectedPackage?.id === pkg.id;
                    const pkgPricing = calculatePackagePricing(
                      pkg.price,
                      activeFlashSale,
                      customerProfile?.tier,
                      programConfig,
                    );
                    const strikethroughPrice =
                      pkgPricing.hasDiscount
                        ? pkg.price
                        : pkg.originalPrice > pkg.price
                          ? pkg.originalPrice
                          : 0;
                    const showSubtitle =
                      pkg.quantityLabel &&
                      pkg.quantityLabel.trim().toLowerCase() !== pkg.name.trim().toLowerCase();
                    const badgeLabel =
                      pkg.badgeType === 'best_selling'
                        ? t('home.bestSelling')
                        : pkg.badgeType === 'popular'
                          ? t('home.popular')
                          : '';

                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPkgId(pkg.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2.5 shadow-2xs ${
                          isSelected
                            ? 'border-2 border-cyan-500 bg-cyan-50/75 dark:bg-cyan-950/45 ring-2 ring-cyan-500/20'
                            : 'border-[1.5px] border-slate-200/95 dark:border-slate-700/90 bg-white dark:bg-slate-950/60 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}>
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {isSelected ? (
                            <CheckCircle2 className="w-4 h-4 text-cyan-500 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                          )}

                          <PackageVisual pkg={pkg} size="sm" />

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words">
                                {pkg.name}
                              </p>
                              {activeFlashSale && (
                                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-rose-600 text-white shrink-0">
                                  -{activeFlashSale.discountPercent}%
                                </span>
                              )}
                              {badgeLabel && (
                                <span
                                  className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide shrink-0 ${
                                    pkg.badgeType === 'best_selling'
                                      ? 'bg-amber-500/90 text-slate-950'
                                      : 'bg-cyan-600 text-white'
                                  }`}>
                                  {badgeLabel}
                                </span>
                              )}
                            </div>

                            {(showSubtitle || pkg.bonusLabel || pkg.promoLabel) && (
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                                {showSubtitle && (
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                    {pkg.quantityLabel}
                                  </span>
                                )}
                                {pkg.bonusLabel && (
                                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                    {showSubtitle ? `· ${pkg.bonusLabel}` : pkg.bonusLabel}
                                  </span>
                                )}
                                {pkg.promoLabel && (
                                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                    {showSubtitle || pkg.bonusLabel ? `· ${pkg.promoLabel}` : pkg.promoLabel}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="block text-xs sm:text-sm font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums whitespace-nowrap">
                            {formatCurrency(pkgPricing.finalPriceBeforeCoupon)}
                          </span>
                          {strikethroughPrice > pkgPricing.finalPriceBeforeCoupon && (
                            <span className="block text-[10px] text-slate-400 line-through tabular-nums whitespace-nowrap">
                              {formatCurrency(strikethroughPrice)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Step 2: Account Info */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3.5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 shadow-2xs">
                  2
                </span>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display">
                  {t('product.accountInfo')}
                </h2>
              </div>

              {product.requiresUid && (customerProfile?.savedUids?.length || savedUid) ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
                    {t('uid.savedProfiles')}:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {(customerProfile?.savedUids || []).map((su) => (
                      <div
                        key={su.id}
                        className="inline-flex items-center rounded-lg border-[1.5px] border-cyan-400/80 dark:border-cyan-700 bg-cyan-50/70 dark:bg-cyan-950/40 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            setPlayerUid(su.playerUid);
                            if (su.serverId && su.serverId !== 'N/A' && product.requiresServerId) {
                              setServerId(su.serverId);
                            }
                            toast.info(`Applied ${su.label}: ${su.playerUid}`);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-cyan-200 hover:bg-cyan-100/70 dark:hover:bg-cyan-900/60 cursor-pointer flex items-center gap-1.5">
                          <span>{su.label}</span>
                          <span className="font-mono text-cyan-700 dark:text-cyan-300">{su.playerUid}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${su.label}`}
                          onClick={() => void removeCustomerPlayerUid(su.id)}
                          className="px-1.5 py-1 text-slate-400 hover:text-rose-600 cursor-pointer border-l border-cyan-200/70 dark:border-cyan-800">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {!(customerProfile?.savedUids || []).some((u) => u.playerUid === savedUid) && savedUid && (
                      <button
                        type="button"
                        onClick={() => {
                          setPlayerUid(savedUid);
                          toast.info(`Applied saved UID: ${savedUid}`);
                        }}
                        className="px-3 py-1 rounded-lg border-[1.5px] border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 hover:border-cyan-400 cursor-pointer">
                        {savedUid}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {product.requiresUid && (
                  <div className={product.requiresServerId ? '' : 'sm:col-span-2'}>
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {product.uidLabel || 'Player UID'} *
                      </label>
                      {firebaseUser && playerUid.trim() && (
                        <button
                          type="button"
                          onClick={() => setShowSaveUidForm((v) => !v)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer">
                          <BookmarkPlus className="w-3.5 h-3.5" /> {t('uid.saveCurrent')}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode={isNumericUidGame ? 'numeric' : 'text'}
                        required
                        value={playerUid}
                        onChange={(e) => setPlayerUid(e.target.value)}
                        placeholder={t('product.enterUid')}
                        className="flex-1 px-3.5 py-2.5 text-sm font-mono rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                      />
                      <button
                        type="button"
                        disabled={ignStatus === 'checking' || playerUid.trim().length < 4}
                        onClick={() => void runIgnLookup(playerUid, true)}
                        className="px-3.5 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 transition-colors">
                        {ignStatus === 'checking' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                        <span>Check Name</span>
                      </button>
                    </div>
                    {ignStatus === 'checking' && (
                      <p className="text-[11px] text-cyan-600 dark:text-cyan-400 mt-1.5 flex items-center gap-1.5 font-medium">
                        <Loader2 className="w-3 h-3 animate-spin" /> Checking in-game player nickname...
                      </p>
                    )}
                    {ignStatus === 'verified' && verifiedIgn && (
                      <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                          <UserCheck className="w-4 h-4 shrink-0" />
                          Player IGN: {verifiedIgn}
                        </span>
                        {ignRegion && (
                          <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            {ignRegion}
                          </span>
                        )}
                      </div>
                    )}
                    {ignStatus === 'fallback' && ignMessage && (
                      <p className="text-[11px] text-cyan-700 dark:text-cyan-400 mt-1.5 font-medium">
                        {ignMessage}
                      </p>
                    )}
                    {ignStatus === 'invalid' && ignMessage && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5 flex items-center gap-1 font-semibold">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {ignMessage}
                      </p>
                    )}
                    {isNumericUidGame && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {t('uid.numericHint')}
                      </p>
                    )}
                    {showSaveUidForm && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={uidLabel}
                          onChange={(e) => setUidLabel(e.target.value)}
                          placeholder="Label (e.g. Main FF ID)"
                          className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          disabled={savingUid}
                          onClick={() => void handleSaveUidProfile()}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold cursor-pointer">
                          {savingUid ? '...' : 'Save'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {product.requiresServerId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {product.serverLabel || 'Server / Zone ID'} *
                    </label>
                    {product.serverOptions && product.serverOptions.length > 0 ? (
                      <select
                        value={serverId}
                        onChange={(e) => setServerId(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors">
                        {product.serverOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        required
                        value={serverId}
                        onChange={(e) => setServerId(e.target.value)}
                        placeholder={t('product.enterServer')}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                      />
                    )}
                  </div>
                )}
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border-[1.5px] border-red-200 dark:border-red-800 text-xs font-medium text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}
            </div>

            {/* Step 3: Order Summary & Continue CTA */}
            {selectedPackage && selectedPricing && (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-4 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 shadow-2xs">
                    3
                  </span>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display">
                    {t('product.orderSummary')}
                  </h2>
                </div>
                <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border-[1.5px] border-slate-200/90 dark:border-slate-800 p-3.5 space-y-2 text-xs sm:text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('product.selectedPackage')}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white text-right inline-flex items-center gap-2">
                      <PackageVisual pkg={selectedPackage} size="sm" />
                      <span>{selectedPackage.name}</span>
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('product.quantity')}
                    </span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {selectedPackage.quantityLabel}
                    </span>
                  </div>
                  {product.requiresUid && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">
                        {product.uidLabel || 'Player UID'}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">
                        {playerUid.trim() || t('product.notEntered')}
                      </span>
                    </div>
                  )}
                  {selectedPricing.flashSaleDiscount > 0 && (
                    <div className="flex justify-between gap-3 text-rose-600 dark:text-rose-400">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <Flame className="w-3.5 h-3.5" /> Flash Sale ({selectedPricing.flashSalePercent}%)
                      </span>
                      <span className="font-bold tabular-nums">
                        -{formatCurrency(selectedPricing.flashSaleDiscount)}
                      </span>
                    </div>
                  )}
                  {selectedPricing.tierDiscount > 0 && (
                    <div className="flex justify-between gap-3 text-emerald-700 dark:text-emerald-400">
                      <span className="font-semibold uppercase">
                        {selectedPricing.appliedTier} {t('tier.discount')} ({selectedPricing.tierPercent}%)
                      </span>
                      <span className="font-bold tabular-nums">
                        -{formatCurrency(selectedPricing.tierDiscount)}
                      </span>
                    </div>
                  )}
                  {selectedPricing.estimatedLoyaltyPoints > 0 && (
                    <div className="flex justify-between gap-3 text-amber-700 dark:text-amber-400 text-xs">
                      <span>{t('loyalty.earnPreview')}</span>
                      <span className="font-bold">+{selectedPricing.estimatedLoyaltyPoints} pts</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {t('product.payableAmount')}
                    </span>
                    <span className="text-lg font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                      {formatCurrency(selectedPricing.finalPriceBeforeCoupon)}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 dark:from-cyan-600 dark:to-blue-600 hover:from-cyan-600 hover:to-blue-600 border border-slate-800 dark:border-cyan-500 text-white text-sm font-bold transition-all cursor-pointer shadow-sm">
                  {t('product.continueCheckout')} <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  {t('product.checkoutNote')}
                </p>
              </div>
            )}
          </form>

          {/* Right Column: Gallery & Order Instructions */}
          <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-24">
            {images.length > 1 && (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-3 space-y-2 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
                <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700">
                  <ImageWithFallback
                    src={images[activeImgIdx] || images[0]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto">
                  {images.map((img, idx) => (
                    <button
                      key={`${img}-${idx}`}
                      type="button"
                      onClick={() => setActiveImgIdx(idx)}
                      className={`w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer ${
                        activeImgIdx === idx
                          ? 'border-cyan-500'
                          : 'border-slate-200 dark:border-slate-700 opacity-75'
                      }`}>
                      <ImageWithFallback
                        src={img}
                        alt={`${product.name} ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <Info className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                {t('product.instructions')}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                {product.instructions ||
                  'Enter your accurate Player UID and select a package to proceed.'}
              </p>
              {product.description && (
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    {t('product.details')}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                    {product.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <ReviewsSection productId={product.id} productName={product.name} initialLimit={6} />
    </StoreLayout>
  );
}
