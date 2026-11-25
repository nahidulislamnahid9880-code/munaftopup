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
import {formatCurrency} from '../../lib/firebase';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {StoreLayout} from '../../components/store/StoreLayout';

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
    () => categories.filter((c) => c.active),
    [categories],
  );

  const activePromos = useMemo(
    () => (siteSettings.promos || []).filter((p) => p.active),
    [siteSettings.promos],
  );

  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => p.active)
      .filter((p) => (selectedCategory === 'all' ? true : p.categoryId === selectedCategory))
      .filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.categoryName.toLowerCase().includes(q) ||
          p.shortDescription.toLowerCase().includes(q)
        );
      });
  }, [products, selectedCategory, searchQuery]);

  useEffect(() => {
    if (activeBanners.length <= 1) return;
    const timer = setInterval(() => {
      setBannerIdx((prev) => (prev + 1) % activeBanners.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [activeBanners.length]);

  const currentBanner = activeBanners[bannerIdx % Math.max(1, activeBanners.length)];

  const getStartingPrice = (p: (typeof products)[number]) => {
    const activePkgs = (p.packages || []).filter((pkg) => pkg.active);
    if (activePkgs.length === 0) return 0;
    return Math.min(...activePkgs.map((pkg) => pkg.price));
  };

  return (
    <StoreLayout>
      {/* Storefront Hero Section */}
      <section className="bg-slate-950 text-white border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <div className="lg:col-span-5 flex flex-col justify-center space-y-5">
              <p className="text-xs font-medium text-blue-400 tracking-wide">
                Direct Player UID Fulfillment · bKash &amp; Nagad Verified
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight text-balance font-display">
                {siteSettings.heroTitle}
              </h1>
              <p className="text-slate-300 text-base leading-relaxed max-w-xl">
                {siteSettings.heroSubtitle}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href={siteSettings.heroCtaLink || '#products'}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap transition-colors">
                  {siteSettings.heroCtaText || 'Browse Top-Ups'}
                  <ArrowRight className="w-4 h-4" />
                </a>
                <Link
                  to="/track"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-sm font-medium whitespace-nowrap transition-colors">
                  Track Order
                </Link>
              </div>
            </div>

            {/* Dynamic Banner Slider */}
            <div className="lg:col-span-7 relative rounded-xl overflow-hidden border border-slate-800 bg-slate-900 min-h-[240px] sm:min-h-[320px]">
              {currentBanner ? (
                <>
                  <ImageWithFallback
                    src={currentBanner.imageUrl}
                    alt={currentBanner.title}
                    className="w-full h-full object-cover aspect-video lg:aspect-auto"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent flex flex-col justify-end p-6">
                    <h2 className="text-xl sm:text-2xl font-bold text-white font-display">
                      {currentBanner.title}
                    </h2>
                    <p className="text-sm text-slate-300 mt-1 max-w-lg">
                      {currentBanner.subtitle}
                    </p>
                    {currentBanner.linkUrl && (
                      <Link
                        to={currentBanner.linkUrl}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300 w-fit">
                        View Offer <ArrowRight className="w-4 h-4" />
                      </Link>
                    )}
                  </div>
                  {activeBanners.length > 1 && (
                    <div className="absolute top-4 right-4 flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Previous banner"
                        onClick={() =>
                          setBannerIdx((prev) => (prev - 1 + activeBanners.length) % activeBanners.length)
                        }
                        className="p-2 rounded-lg bg-slate-950/75 hover:bg-slate-900 text-white border border-slate-700 cursor-pointer">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Next banner"
                        onClick={() => setBannerIdx((prev) => (prev + 1) % activeBanners.length)}
                        className="p-2 rounded-lg bg-slate-950/75 hover:bg-slate-900 text-white border border-slate-700 cursor-pointer">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
                  <Sparkles className="w-8 h-8 text-blue-400 mb-3" />
                  <p className="text-sm font-medium text-slate-200">
                    Dynamic Banner Slot
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Configure homepage slider banners from the Admin Customization panel.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Catalog & Category Section */}
      <section id="products" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-10">
        {/* Categories Showcase */}
        {siteSettings.homepageSections?.showCategories && activeCategories.length > 0 && (
          <div id="categories" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-slate-900 font-display">
                {siteSettings.homepageSections.categoriesTitle || 'Browse by Category'}
              </h2>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search games or packages..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
            </div>

            {/* Interactive Category Filter Bar */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl overflow-x-auto">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}>
                All Products
              </button>
              {activeCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}>
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Products Grid */}
        {siteSettings.homepageSections?.showFeatured !== false && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900 font-display">
                {siteSettings.homepageSections?.featuredTitle || 'Top-Up Products'}
              </h2>
              <span className="text-xs font-medium text-slate-500 tabular-nums">
                {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
              </span>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="rounded-xl bg-white border border-slate-200 overflow-hidden animate-pulse">
                    <div className="aspect-[4/3] bg-slate-200" />
                    <div className="p-4 space-y-2.5">
                      <div className="h-3 w-24 bg-slate-200 rounded" />
                      <div className="h-5 w-4/5 bg-slate-200 rounded" />
                      <div className="h-4 w-1/2 bg-slate-200 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !catalogInitialized && products.length === 0 ? (
              <div className="rounded-xl bg-white border border-slate-200 p-10 text-center space-y-3">
                <h3 className="text-lg font-semibold text-slate-900">
                  Storefront Ready for Initial Catalog Setup
                </h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  All products, diamond packages, banners, and payment numbers are managed dynamically from the Admin Panel. Sign in as Admin to publish the live catalog.
                </p>
                <div className="pt-2">
                  <Link
                    to="/admin/login"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
                    Open Admin Login <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-xl bg-white border border-slate-200 p-10 text-center space-y-2">
                <p className="text-base font-semibold text-slate-900">No matching products found</p>
                <p className="text-sm text-slate-500">
                  Try clearing your search or switching product categories.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {filteredProducts.map((product) => {
                  const startPrice = getStartingPrice(product);
                  const activePkgCount = (product.packages || []).filter((p) => p.active).length;
                  return (
                    <Link
                      key={product.id}
                      to={`/product/${product.slug}`}
                      className="group rounded-xl bg-white border border-slate-200 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                      <div className="aspect-[4/3] bg-slate-900 overflow-hidden">
                        <ImageWithFallback
                          src={product.images?.[0]}
                          alt={product.name}
                          fallbackLabel={product.name}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                      </div>
                      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="truncate">{product.categoryName || 'Digital Top-Up'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums shrink-0">{activePkgCount} packs</span>
                          </div>
                          <h3 className="text-base font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                            {product.name}
                          </h3>
                        </div>
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          <div>
                            <span className="text-[11px] text-slate-500 block">Starting from</span>
                            <span className="text-base font-bold text-slate-950 tabular-nums">
                              {formatCurrency(startPrice)}
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 group-hover:bg-blue-600 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0">
                            Top Up <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Promotional Offers */}
        {siteSettings.homepageSections?.showPromos && activePromos.length > 0 && (
          <div className="pt-4 space-y-5">
            <h2 className="text-2xl font-bold text-slate-900 font-display">
              Featured Offers
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {activePromos.map((promo) => (
                <div
                  key={promo.id}
                  className="rounded-xl bg-white border border-slate-200 overflow-hidden grid grid-cols-1 sm:grid-cols-5 items-stretch">
                  <div className="sm:col-span-2 bg-slate-900 min-h-[160px]">
                    <ImageWithFallback
                      src={promo.imageUrl}
                      alt={promo.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="sm:col-span-3 p-5 flex flex-col justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                        <span>{promo.discountText || 'Special Offer'}</span>
                        {promo.code && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{promo.code}</span>
                          </>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 font-display">
                        {promo.title}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {promo.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How It Works */}
        {siteSettings.homepageSections?.showHowItWorks && (
          <div className="pt-4 border-t border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                <Zap className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">1. Enter Player UID</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Select your game and enter your numeric Player UID—never share your account password.
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">2. Pay &amp; Verify TrxID</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Send the exact amount via bKash or Nagad and submit your unique Transaction ID.
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">3. Track Live Fulfillment</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Follow live payment verification and diamond delivery status using your Order ID.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </StoreLayout>
  );
}
