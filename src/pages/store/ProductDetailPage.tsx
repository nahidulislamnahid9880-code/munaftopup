import React, {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, ArrowRight, CheckCircle2, Circle, Info, ShieldCheck} from 'lucide-react';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {formatCurrency} from '../../lib/firebase';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {PackageVisual} from '../../components/PackageTypeIcon';
import {StoreLayout} from '../../components/store/StoreLayout';

const LAST_UID_KEY = 'sv_last_player_uid';

export function ProductDetailPage() {
  const {slug} = useParams<{slug: string}>();
  const navigate = useNavigate();
  const {products, loading} = useStore();
  const {t} = useLanguage();
  const toast = useToast();

  const product = useMemo(
    () => products.find((p) => p.slug === slug || p.id === slug),
    [products, slug],
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

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!product || !selectedPackage) return;
    const trimmedUid = playerUid.trim();
    if (product.requiresUid && !trimmedUid) {
      const msg = `Please enter your ${product.uidLabel || 'Player UID'}.`;
      setFormError(msg);
      toast.error(msg);
      return;
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
                    const hasDiscount = pkg.originalPrice > pkg.price;
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

                          {/* Package Icon or Uploaded Custom Logo */}
                          <PackageVisual pkg={pkg} size="sm" />

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words">
                                {pkg.name}
                              </p>
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
                            {formatCurrency(pkg.price)}
                          </span>
                          {hasDiscount && (
                            <span className="block text-[10px] text-slate-400 line-through tabular-nums whitespace-nowrap">
                              {formatCurrency(pkg.originalPrice)}
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

              {product.requiresUid && savedUid && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('product.savedUid')}:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerUid(savedUid);
                      toast.info(`Applied saved UID: ${savedUid}`);
                    }}
                    className="px-3 py-1 rounded-lg border-[1.5px] border-cyan-400 dark:border-cyan-600 bg-cyan-50/60 dark:bg-cyan-950/50 text-xs font-mono font-semibold text-slate-800 dark:text-cyan-200 hover:bg-cyan-100/70 dark:hover:bg-cyan-900/60 cursor-pointer">
                    {savedUid}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {product.requiresUid && (
                  <div className={product.requiresServerId ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      {product.uidLabel || 'Player UID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={playerUid}
                      onChange={(e) => setPlayerUid(e.target.value)}
                      placeholder={t('product.enterUid')}
                      className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border-[1.5px] border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
                    />
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
            {selectedPackage && (
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
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {t('product.payableAmount')}
                    </span>
                    <span className="text-lg font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                      {formatCurrency(selectedPackage.price)}
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
    </StoreLayout>
  );
}
