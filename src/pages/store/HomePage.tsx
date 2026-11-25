import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import {useStore} from '../../contexts/StoreContext';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {StoreLayout} from '../../components/store/StoreLayout';
import type {Product} from '../../types';

export function HomePage() {
  const {siteSettings, categories, products, loading, catalogInitialized} = useStore();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bannerIdx, setBannerIdx] = useState(0);

  const activeBanners = useMemo(
    () => (siteSettings.banners || []).filter((b) => b.active),
    [siteSettings.banners],
  );

  const activeCategories = useMemo(
    () => [...categories].filter((c) => c.active).sort((a, b) => a.displayOrder - b.displayOrder),
    [categories],
  );

  const activePromos = useMemo(
    () => (siteSettings.promos || []).filter((p) => p.active),
    [siteSettings.promos],
  );

  const activeProducts = useMemo(() => {
    return [...products]
      .filter((p) => p.active)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.categoryName.toLowerCase().includes(q) ||
          p.shortDescription.toLowerCase().includes(q)
        );
      });
  }, [products, searchQuery]);

  // Group active products by active category order
  const categorySections = useMemo(() => {
    const visibleCategories =
      selectedCategory === 'all'
        ? activeCategories
        : activeCategories.filter((c) => c.id === selectedCategory);

    const groups: Array<{id: string; name: string; items: Product[]}> = [];
    const assignedProductIds = new Set<string>();

    for (const cat of visibleCategories) {
      const items = activeProducts.filter((p) => p.categoryId === cat.id);
      if (items.length > 0) {
        items.forEach((p) => assignedProductIds.add(p.id));
        groups.push({id: cat.id, name: cat.name, items});
      }
    }

    if (selectedCategory === 'all') {
      const unassigned = activeProducts.filter((p) => !assignedProductIds.has(p.id));
      if (unassigned.length > 0) {
        groups.push({id: 'other', name: 'More Top-Ups', items: unassigned});
      }
    }

    return groups;
  }, [activeCategories, activeProducts, selectedCategory]);

  useEffect(() => {
    if (activeBanners.length <= 1) return;
    const timer = setInterval(() => {
      setBannerIdx((prev) => (prev + 1) % activeBanners.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [activeBanners.length]);

  const currentBanner = activeBanners[bannerIdx % Math.max(1, activeBanners.length)];

  return (
    <StoreLayout>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6 sm:space-y-8">
        {/* Compact Dynamic Slider Banner (Admin-controlled) */}
        {currentBanner && (
          <section className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 shadow-xs">
            <Link to={currentBanner.linkUrl || '/'} className="block relative">
              <ImageWithFallback
                src={currentBanner.imageUrl}
                alt={currentBanner.title}
                className="w-full h-36 sm:h-56 md:h-64 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent flex flex-col justify-end p-4 sm:p-6">
                <h1 className="text-base sm:text-2xl font-bold text-white font-display leading-snug">
                  {currentBanner.title}
                </h1>
                {currentBanner.subtitle && (
                  <p className="text-xs sm:text-sm text-slate-200 mt-0.5 line-clamp-2 max-w-xl">
                    {currentBanner.subtitle}
                  </p>
                )}
              </div>
            </Link>
            {activeBanners.length > 1 && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous banner"
                  onClick={() =>
                    setBannerIdx((prev) => (prev - 1 + activeBanners.length) % activeBanners.length)
                  }
                  className="p-1.5 rounded-full bg-slate-950/70 hover:bg-slate-900 text-white border border-white/15 cursor-pointer">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next banner"
                  onClick={() => setBannerIdx((prev) => (prev + 1) % activeBanners.length)}
                  className="p-1.5 rounded-full bg-slate-950/70 hover:bg-slate-900 text-white border border-white/15 cursor-pointer">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </section>
        )}

        {/* Quick Search & Category Filter Row */}
        <section id="categories" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games or passes..."
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
              />
            </div>

            {activeCategories.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                  }`}>
                  All Categories
                </button>
                {activeCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      selectedCategory === cat.id
                        ? 'bg-cyan-500 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                    }`}>
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Category-Grouped 3-Column Square Product Grids (Matching Reference) */}
        <section id="products" className="space-y-8">
          {loading ? (
            <div className="space-y-4">
              <div className="h-6 w-32 bg-slate-200 rounded mx-auto animate-pulse" />
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div key={n} className="space-y-2 animate-pulse">
                    <div className="aspect-square rounded-2xl bg-slate-200" />
                    <div className="h-3 w-4/5 mx-auto bg-slate-200 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : !catalogInitialized && products.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-3">
              <h2 className="text-lg font-bold text-slate-900 font-display">
                Storefront Ready for Initial Catalog Setup
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto">
                All products, square category icons, diamond packages, and payment numbers load dynamically from the database. Sign in as Admin to publish the live catalog.
              </p>
              <div className="pt-1">
                <Link
                  to="/admin/login"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">
                  Open Admin Login <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ) : categorySections.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-900">No matching products found</p>
              <p className="text-xs text-slate-500">
                Try clearing your search or selecting All Categories.
              </p>
            </div>
          ) : (
            categorySections.map((group) => (
              <div key={group.id} className="space-y-4">
                {/* Centered Category Header + View all */}
                <div className="text-center space-y-1">
                  <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-display tracking-tight">
                    {group.name}
                  </h2>
                  {selectedCategory === 'all' && activeCategories.some((c) => c.id === group.id) ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory(group.id)}
                      className="text-xs sm:text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-cyan-600 cursor-pointer">
                      View all
                    </button>
                  ) : selectedCategory !== 'all' ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('all')}
                      className="text-xs sm:text-sm font-medium text-cyan-600 underline underline-offset-4 hover:text-cyan-700 cursor-pointer">
                      Show all categories
                    </button>
                  ) : null}
                </div>

                {/* 3-Column Square Product Grid on Mobile -> 4/6 on Tablet & Desktop */}
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-5">
                  {group.items.map((product) => (
                    <Link
                      key={product.id}
                      to={`/product/${product.slug}`}
                      className="group flex flex-col items-center text-center focus:outline-none">
                      <div className="w-full aspect-square rounded-2xl overflow-hidden bg-white border border-slate-200/90 shadow-xs group-hover:shadow-md group-hover:-translate-y-0.5 transition-all duration-200">
                        <ImageWithFallback
                          src={product.images?.[0]}
                          alt={product.name}
                          fallbackLabel={product.name}
                          className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
                        />
                      </div>
                      <h3 className="mt-2 text-xs sm:text-sm font-semibold text-slate-800 group-hover:text-cyan-600 transition-colors leading-snug line-clamp-2 px-0.5">
                        {product.name}
                      </h3>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        {/* Admin-Controlled Promotional Offers */}
        {siteSettings.homepageSections?.showPromos && activePromos.length > 0 && (
          <section className="pt-4 space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-display text-center sm:text-left">
              Featured Offers
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activePromos.map((promo) => (
                <div
                  key={promo.id}
                  className="rounded-2xl bg-white border border-slate-200 overflow-hidden grid grid-cols-5 items-stretch shadow-xs">
                  <div className="col-span-2 bg-slate-900">
                    <ImageWithFallback
                      src={promo.imageUrl}
                      alt={promo.title}
                      className="w-full h-full object-cover aspect-square sm:aspect-auto"
                    />
                  </div>
                  <div className="col-span-3 p-4 flex flex-col justify-center space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-cyan-700">
                      <span>{promo.discountText || 'Special Offer'}</span>
                      {promo.code && <span className="font-mono text-slate-500">· {promo.code}</span>}
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                      {promo.title}
                    </h3>
                    <p className="text-xs text-slate-600 line-clamp-2">{promo.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* How It Works */}
        {siteSettings.homepageSections?.showHowItWorks && (
          <section className="pt-4 border-t border-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
                <Zap className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">1. Enter Player UID</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Pick a service and enter only your Player UID—no password ever needed.
                  </p>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">2. Wallet or bKash/Nagad</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Pay instantly with your Wallet Balance or submit your verified TrxID.
                  </p>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">3. Fast Fulfillment</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Track live order updates or copy delivered voucher pins in My Codes.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </StoreLayout>
  );
}
