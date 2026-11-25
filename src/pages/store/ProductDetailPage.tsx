import React, {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, ArrowRight, CheckCircle2, Circle, Info, ShieldCheck} from 'lucide-react';
import {useStore} from '../../contexts/StoreContext';
import {formatCurrency} from '../../lib/firebase';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {StoreLayout} from '../../components/store/StoreLayout';

const LAST_UID_KEY = 'sv_last_player_uid';

export function ProductDetailPage() {
  const {slug} = useParams<{slug: string}>();
  const navigate = useNavigate();
  const {products, loading} = useStore();

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
      setFormError(`Please enter your ${product.uidLabel || 'Player UID'}.`);
      return;
    }
    if (product.requiresServerId && !serverId.trim()) {
      setFormError(`Please select or enter your ${product.serverLabel || 'Server ID'}.`);
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="h-80 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        </div>
      </StoreLayout>
    );
  }

  if (!product || !product.active) {
    return (
      <StoreLayout>
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900 font-display">Product Not Found</h1>
          <p className="text-sm text-slate-600">
            This top-up product may have been removed or disabled by the administrator.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold">
            <ArrowLeft className="w-4 h-4" /> Back to Home
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
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Link to="/" className="inline-flex items-center gap-1 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" /> Home
          </Link>
          <span>/</span>
          <span>{product.categoryName}</span>
          <span>/</span>
          <span className="text-slate-900 font-semibold truncate">{product.name}</span>
        </div>

        {/* Top Product Heading Card */}
        <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 shadow-xs">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
            <ImageWithFallback
              src={images[activeImgIdx] || images[0]}
              alt={product.name}
              fallbackLabel={product.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-600">
              {product.categoryName}
            </span>
            <h1 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-display leading-tight">
              {product.name}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 line-clamp-2">
              {product.shortDescription}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Left / Main Purchase Column */}
          <form onSubmit={handleContinue} className="lg:col-span-8 space-y-4 sm:space-y-5">
            {/* Step 1: Select Recharge */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3.5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-cyan-500 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                    Select Recharge
                  </h2>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">
                  {activePackages.length} packages
                </span>
              </div>

              {activePackages.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                  No active packages are currently available for this product.
                </p>
              ) : (
                <div
                  className={`grid gap-2.5 ${
                    hasLongPackageNames ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'
                  }`}>
                  {activePackages.map((pkg) => {
                    const isSelected = selectedPackage?.id === pkg.id;
                    const hasDiscount = pkg.originalPrice > pkg.price;
                    const hasCustomImage = Boolean(pkg.imageUrl && pkg.imageUrl.trim());
                    const showSubtitle =
                      pkg.quantityLabel &&
                      pkg.quantityLabel.trim().toLowerCase() !== pkg.name.trim().toLowerCase();

                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPkgId(pkg.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 shadow-2xs ${
                          isSelected
                            ? 'border-cyan-500 bg-cyan-50/70 ring-1 ring-cyan-500/40'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {isSelected ? (
                            <CheckCircle2 className="w-4 h-4 text-cyan-500 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                          )}
                          {hasCustomImage && (
                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                              <ImageWithFallback
                                src={pkg.imageUrl}
                                alt={pkg.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug break-words">
                              {pkg.name}
                            </p>
                            {(showSubtitle || pkg.promoLabel) && (
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                                {showSubtitle && (
                                  <span className="text-[10px] text-slate-500">
                                    {pkg.quantityLabel}
                                  </span>
                                )}
                                {pkg.promoLabel && (
                                  <span className="text-[10px] font-semibold text-amber-700">
                                    {showSubtitle ? `· ${pkg.promoLabel}` : pkg.promoLabel}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="block text-xs sm:text-sm font-extrabold text-cyan-600 tabular-nums whitespace-nowrap">
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
            <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3.5 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-cyan-500 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                  2
                </span>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                  Account Info
                </h2>
              </div>

              {product.requiresUid && savedUid && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Used before:</span>
                  <button
                    type="button"
                    onClick={() => setPlayerUid(savedUid)}
                    className="px-3 py-1 rounded-full border border-cyan-400 bg-cyan-50/50 text-xs font-mono font-semibold text-slate-800 hover:bg-cyan-100/60 cursor-pointer">
                    {savedUid}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {product.requiresUid && (
                  <div className={product.requiresServerId ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {product.uidLabel || 'Player UID'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={playerUid}
                      onChange={(e) => setPlayerUid(e.target.value)}
                      placeholder="Enter exact Player UID (e.g. 2481950312)"
                      className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
                    />
                  </div>
                )}

                {product.requiresServerId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {product.serverLabel || 'Server / Zone ID'} *
                    </label>
                    {product.serverOptions && product.serverOptions.length > 0 ? (
                      <select
                        value={serverId}
                        onChange={(e) => setServerId(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500">
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
                        placeholder="Enter Server ID"
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
                      />
                    )}
                  </div>
                )}
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {formError}
                </div>
              )}
            </div>

            {/* Step 3: Order Summary & Continue CTA */}
            {selectedPackage && (
              <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-cyan-500 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                    Order Summary
                  </h2>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Selected Package</span>
                    <span className="font-bold text-slate-900 text-right">{selectedPackage.name}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Quantity</span>
                    <span className="font-medium text-slate-700">{selectedPackage.quantityLabel}</span>
                  </div>
                  {product.requiresUid && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">{product.uidLabel || 'Player UID'}</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {playerUid.trim() || 'Not entered yet'}
                      </span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
                    <span className="font-bold text-slate-900">Payable Amount</span>
                    <span className="text-lg font-extrabold text-cyan-600 tabular-nums">
                      {formatCurrency(selectedPackage.price)}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors cursor-pointer">
                  Continue to Checkout <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-600" />
                  Supports Wallet Balance &amp; manual bKash / Nagad checkout
                </p>
              </div>
            )}
          </form>

          {/* Right Column: Gallery & Order Instructions */}
          <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
            {images.length > 1 && (
              <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2 shadow-xs">
                <div className="aspect-square rounded-xl overflow-hidden bg-slate-100">
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
                        activeImgIdx === idx ? 'border-cyan-500' : 'border-transparent opacity-70'
                      }`}>
                      <ImageWithFallback src={img} alt={`${product.name} ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3 shadow-xs">
              <h2 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-600" />
                Top-Up Instructions
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 whitespace-pre-line leading-relaxed">
                {product.instructions || 'Enter your accurate Player UID and select a package to proceed.'}
              </p>
              {product.description && (
                <div className="pt-3 border-t border-slate-100">
                  <h3 className="text-xs font-semibold text-slate-500 mb-1">Details</h3>
                  <p className="text-xs sm:text-sm text-slate-600 whitespace-pre-line leading-relaxed">
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
