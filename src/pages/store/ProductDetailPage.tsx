import React, {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, ArrowRight, Check, Info} from 'lucide-react';
import {useStore} from '../../contexts/StoreContext';
import {formatCurrency} from '../../lib/firebase';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {StoreLayout} from '../../components/store/StoreLayout';

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
  const [serverId, setServerId] = useState('');
  const [formError, setFormError] = useState('');

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
    if (product.requiresUid && !playerUid.trim()) {
      setFormError(`Please enter your ${product.uidLabel || 'Player UID'}.`);
      return;
    }
    if (product.requiresServerId && !serverId.trim()) {
      setFormError(`Please select or enter your ${product.serverLabel || 'Server ID'}.`);
      return;
    }

    const params = new URLSearchParams({
      productId: product.id,
      packageId: selectedPackage.id,
      uid: playerUid.trim(),
      server: serverId.trim(),
    });
    navigate(`/checkout?${params.toString()}`);
  };

  if (loading) {
    return (
      <StoreLayout>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="h-96 rounded-xl bg-white border border-slate-200 animate-pulse" />
        </div>
      </StoreLayout>
    );
  }

  if (!product || !product.active) {
    return (
      <StoreLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900 font-display">Product Not Found</h1>
          <p className="text-sm text-slate-600">
            This top-up product may have been removed or temporarily disabled by the store administrator.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to Storefront
          </Link>
        </div>
      </StoreLayout>
    );
  }

  const images = product.images?.length ? product.images : [''];

  return (
    <StoreLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Link to="/" className="hover:text-slate-900">Home</Link>
          <span>/</span>
          <span>{product.categoryName}</span>
          <span>/</span>
          <span className="text-slate-900 truncate">{product.name}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Multi-Image Gallery & Instructions */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-24">
            <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
              <div className="aspect-[4/3] bg-slate-900">
                <ImageWithFallback
                  src={images[activeImgIdx] || images[0]}
                  alt={product.name}
                  fallbackLabel={product.name}
                  className="w-full h-full object-cover"
                />
              </div>
              {images.length > 1 && (
                <div className="p-3 border-t border-slate-200 flex items-center gap-2 overflow-x-auto">
                  {images.map((img, idx) => (
                    <button
                      key={`${img}-${idx}`}
                      type="button"
                      onClick={() => setActiveImgIdx(idx)}
                      className={`w-16 h-12 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                        activeImgIdx === idx ? 'border-blue-600' : 'border-transparent opacity-70 hover:opacity-100'
                      }`}>
                      <ImageWithFallback src={img} alt={`${product.name} ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-white border border-slate-200 p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900 font-display flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600" />
                Order Instructions
              </h2>
              <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">
                {product.instructions || 'Enter your accurate Player UID and select a package to proceed.'}
              </p>
              {product.description && (
                <div className="pt-3 border-t border-slate-100">
                  <h3 className="text-xs font-semibold text-slate-500 mb-1.5">About This Product</h3>
                  <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">
                    {product.description}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Contiguous Purchase Module */}
          <form onSubmit={handleContinue} className="lg:col-span-7 space-y-6">
            <div className="rounded-xl bg-white border border-slate-200 p-6 space-y-5">
              <div className="space-y-1">
                <p className="text-xs font-medium text-blue-600">{product.categoryName}</p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display">
                  {product.name}
                </h1>
                <p className="text-sm text-slate-600">{product.shortDescription}</p>
              </div>

              {/* Step 1: Account / UID Details */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <h2 className="text-sm font-bold text-slate-900">1. Player Account Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {product.requiresUid && (
                    <div className={product.requiresServerId ? '' : 'sm:col-span-2'}>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        {product.uidLabel || 'Player UID'} *
                      </label>
                      <input
                        type="text"
                        required
                        value={playerUid}
                        onChange={(e) => setPlayerUid(e.target.value)}
                        placeholder="e.g. 2481950312"
                        className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                      />
                    </div>
                  )}

                  {product.requiresServerId && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        {product.serverLabel || 'Server / Zone ID'} *
                      </label>
                      {product.serverOptions && product.serverOptions.length > 0 ? (
                        <select
                          value={serverId}
                          onChange={(e) => setServerId(e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600">
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
                          className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Diamond / Package Selector */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">2. Select Package</h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {activePackages.length} options available
                  </span>
                </div>

                {activePackages.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">
                    No active packages are currently available for this product.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activePackages.map((pkg) => {
                      const isSelected = selectedPackage?.id === pkg.id;
                      const hasDiscount = pkg.originalPrice > pkg.price;
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => setSelectedPkgId(pkg.id)}
                          className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}>
                          {pkg.imageUrl && (
                            <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                              <ImageWithFallback
                                src={pkg.imageUrl}
                                alt={pkg.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {pkg.name}
                              </span>
                              {isSelected && (
                                <Check className="w-4 h-4 text-blue-600 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-baseline gap-2 mt-0.5">
                              <span className="text-sm font-bold text-blue-700 tabular-nums">
                                {formatCurrency(pkg.price)}
                              </span>
                              {hasDiscount && (
                                <span className="text-xs text-slate-400 line-through tabular-nums">
                                  {formatCurrency(pkg.originalPrice)}
                                </span>
                              )}
                              {pkg.promoLabel && (
                                <span className="text-[11px] font-medium text-amber-700 truncate">
                                  · {pkg.promoLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {formError}
                </div>
              )}

              {/* Purchase Footer */}
              {selectedPackage && (
                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-xs text-slate-500 block">Selected Package</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold text-slate-900">{selectedPackage.name}</span>
                      <span className="text-lg font-bold text-blue-600 tabular-nums">
                        {formatCurrency(selectedPackage.price)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer">
                    Proceed to Checkout <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </StoreLayout>
  );
}
