import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import {useStore} from '../../contexts/StoreContext';
import {formatCurrency} from '../../lib/firebase';
import {resolveTelegramHref, resolveWhatsAppHref} from '../../lib/supportLinks';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {TelegramIcon, WhatsAppIcon} from '../../components/SupportIcons';
import {StoreLayout} from '../../components/store/StoreLayout';
import type {Product} from '../../types';

export function HomePage() {
  const {siteSettings, categories, products, loading, catalogInitialized} = useStore();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bannerIdx, setBannerIdx] = useState(0);

  const whatsappHref = resolveWhatsAppHref(siteSettings.contact);
  const telegramHref = resolveTelegramHref(siteSettings.contact);

  const activeBanners = useMemo(() => {
    const configured = (siteSettings.banners || []).filter((b) => b.active);
    if (configured.length > 0) return configured;
    return [
      {
        id: 'default_hero',
        title: siteSettings.heroTitle || 'Instant Game Top-Up via Player UID',
        subtitle:
          siteSettings.heroSubtitle ||
          'Fast delivery for Free Fire Diamonds, Memberships, and digital game vouchers.',
        imageUrl: '/src/assets/images/hero_battle_royale_1795604332736.jpg',
        linkUrl: '#products',
        active: true,
      },
    ];
  }, [siteSettings.banners, siteSettings.heroTitle, siteSettings.heroSubtitle]);

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

  const getLowestPackagePrice = (product: Product): number | null => {
    const activePkgs = (product.packages || []).filter((pkg) => pkg.active && pkg.price > 0);
    if (activePkgs.length === 0) return null;
    return Math.min(...activePkgs.map((pkg) => pkg.price));
  };

  return (
    <StoreLayout>
      <div className="max-w-[1248px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6 sm:space-y-8">
        {/* 1200x450 Exact Proportioned Hero Banner */}
        {currentBanner && (
          <section className="relative rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/80 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
            <Link
              to={currentBanner.linkUrl?.startsWith('#') ? '/' : currentBanner.linkUrl || '/'}
              onClick={(e) => {
                if (currentBanner.linkUrl?.startsWith('#')) {
                  e.preventDefault();
                  document
                    .getElementById(currentBanner.linkUrl.slice(1))
                    ?.scrollIntoView({behavior: 'smooth'});
                }
              }}
              className="block relative group">
              <div className="w-full aspect-[1200/450] min-h-[168px] overflow-hidden bg-slate-950">
                <ImageWithFallback
                  src={currentBanner.imageUrl}
                  alt={currentBanner.title}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/50 to-slate-950/15 flex flex-col justify-end sm:justify-center p-4 sm:p-8 lg:p-12">
                <div className="max-w-xl space-y-1.5 sm:space-y-3">
                  <h1 className="text-lg sm:text-3xl lg:text-[40px] font-extrabold text-white font-display leading-[1.12] tracking-tight text-balance">
                    {currentBanner.title}
                  </h1>
                  {currentBanner.subtitle && (
                    <p className="text-xs sm:text-sm lg:text-base text-slate-200/95 line-clamp-2 leading-relaxed max-w-lg">
                      {currentBanner.subtitle}
                    </p>
                  )}
                  <div className="hidden sm:flex items-center gap-3 pt-1">
                    <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white text-xs sm:text-sm font-bold shadow-md shadow-cyan-500/25 group-hover:from-cyan-400 group-hover:to-teal-400 transition-all whitespace-nowrap">
                      <span>{siteSettings.heroCtaText || 'Browse Top-Ups'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>

            {activeBanners.length > 1 && (
              <>
                <div className="absolute top-3.5 right-3.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Previous banner"
                    onClick={() =>
                      setBannerIdx((prev) => (prev - 1 + activeBanners.length) % activeBanners.length)
                    }
                    className="p-2 rounded-full bg-slate-950/65 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-sm cursor-pointer transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next banner"
                    onClick={() => setBannerIdx((prev) => (prev + 1) % activeBanners.length)}
                    className="p-2 rounded-full bg-slate-950/65 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-sm cursor-pointer transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="absolute bottom-3.5 right-5 flex items-center gap-1.5">
                  {activeBanners.map((b, i) => (
                    <button
                      key={b.id}
                      type="button"
                      aria-label={`Banner ${i + 1}`}
                      onClick={() => setBannerIdx(i)}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        i === bannerIdx % activeBanners.length
                          ? 'w-6 bg-cyan-400'
                          : 'w-1.5 bg-white/45 hover:bg-white/75'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* Value & Trust Strip */}
        <section aria-label="Service highlights">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="rounded-2xl bg-white border border-slate-200/80 px-3.5 py-3 flex items-center gap-3 shadow-2xs">
              <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">Instant UID Top-Up</p>
                <p className="text-[11px] text-slate-500 truncate">Direct in-game delivery</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white border border-slate-200/80 px-3.5 py-3 flex items-center gap-3 shadow-2xs">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">bKash, Nagad &amp; Wallet</p>
                <p className="text-[11px] text-slate-500 truncate">Verified fast checkout</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white border border-slate-200/80 px-3.5 py-3 flex items-center gap-3 shadow-2xs">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">100% Account Safe</p>
                <p className="text-[11px] text-slate-500 truncate">No password needed</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white border border-slate-200/80 px-3.5 py-3 flex items-center gap-3 shadow-2xs">
              <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">Active Support</p>
                <p className="text-[11px] text-slate-500 truncate">WhatsApp &amp; Telegram</p>
              </div>
            </div>
          </div>
        </section>

        {/* Search & Category Filter Bar */}
        <section id="categories">
          <div className="rounded-2xl bg-white border border-slate-200/90 p-2 sm:p-2.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games or passes..."
                className="w-full pl-10 pr-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
              />
            </div>

            {activeCategories.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                    selectedCategory === 'all'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100/80 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  }`}>
                  All Categories
                </button>
                {activeCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                      selectedCategory === cat.id
                        ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-sm shadow-cyan-500/20'
                        : 'bg-slate-100/80 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                    }`}>
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Category-Grouped 3-Column Square Product Grids */}
        <section id="products" className="space-y-8 sm:space-y-10">
          {loading ? (
            <div className="space-y-4">
              <div className="h-6 w-32 bg-slate-200 rounded mx-auto animate-pulse" />
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div key={n} className="space-y-2 animate-pulse">
                    <div className="aspect-square rounded-2xl bg-slate-200" />
                    <div className="h-3 w-4/5 mx-auto bg-slate-200 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : !catalogInitialized && products.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-3 shadow-xs">
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
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-1.5 shadow-xs">
              <p className="text-sm font-semibold text-slate-900">No matching products found</p>
              <p className="text-xs text-slate-500">
                Try clearing your search or selecting All Categories.
              </p>
            </div>
          ) : (
            categorySections.map((group) => (
              <div key={group.id} className="space-y-4 sm:space-y-5">
                <div className="flex items-end justify-between gap-4 border-b border-slate-200/80 pb-3">
                  <div className="space-y-1">
                    <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-display tracking-tight">
                      {group.name}
                    </h2>
                    <div className="w-12 h-1 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" />
                  </div>
                  {selectedCategory === 'all' && activeCategories.some((c) => c.id === group.id) ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory(group.id)}
                      className="text-xs sm:text-sm font-semibold text-cyan-600 hover:text-cyan-700 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1">
                      View all <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : selectedCategory !== 'all' ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('all')}
                      className="text-xs sm:text-sm font-semibold text-cyan-600 hover:text-cyan-700 whitespace-nowrap shrink-0 cursor-pointer">
                      Show all categories
                    </button>
                  ) : null}
                </div>

                {/* 3-Column Square Product Grid on Mobile -> 4/6 on Tablet & Desktop */}
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-5">
                  {group.items.map((product) => {
                    const minPrice = getLowestPackagePrice(product);
                    return (
                      <Link
                        key={product.id}
                        to={`/product/${product.slug}`}
                        className="group rounded-2xl bg-white border border-slate-200/80 p-1.5 sm:p-2 shadow-xs hover:shadow-[0_14px_30px_rgba(8,145,178,0.14)] hover:border-cyan-400 hover:-translate-y-0.5 transition-all duration-200 flex flex-col text-center focus:outline-none">
                        <div className="w-full aspect-square rounded-xl overflow-hidden bg-slate-100">
                          <ImageWithFallback
                            src={product.images?.[0]}
                            alt={product.name}
                            fallbackLabel={product.name}
                            className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-300"
                          />
                        </div>
                        <div className="pt-2 pb-1 px-0.5 flex-1 flex flex-col justify-between gap-1">
                          <h3 className="text-[11px] sm:text-sm font-bold text-slate-900 group-hover:text-cyan-600 transition-colors leading-snug line-clamp-2">
                            {product.name}
                          </h3>
                          {minPrice !== null && (
                            <p className="text-[10px] sm:text-xs font-semibold text-cyan-700 tabular-nums">
                              From {formatCurrency(minPrice)}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>

        {/* Admin-Controlled Promotional Offers */}
        {siteSettings.homepageSections?.showPromos && activePromos.length > 0 && (
          <section className="pt-2 space-y-4">
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 font-display">
              Featured Offers
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activePromos.map((promo) => (
                <div
                  key={promo.id}
                  className="rounded-2xl bg-white border border-slate-200/90 overflow-hidden grid grid-cols-5 items-stretch shadow-xs hover:shadow-md transition-shadow">
                  <div className="col-span-2 bg-slate-900">
                    <ImageWithFallback
                      src={promo.imageUrl}
                      alt={promo.title}
                      className="w-full h-full object-cover aspect-square sm:aspect-auto"
                    />
                  </div>
                  <div className="col-span-3 p-4 sm:p-5 flex flex-col justify-center space-y-1.5">
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

        {/* Customer Support Banner: WhatsApp & Telegram Buttons */}
        <section className="rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white p-5 sm:p-8 border border-slate-800 shadow-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-1.5 max-w-xl">
              <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold">
                <Headphones className="w-4 h-4" />
                <span>Customer Support Desk</span>
              </div>
              <h2 className="text-lg sm:text-2xl font-extrabold font-display tracking-tight">
                Need Help With an Order or Deposit?
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Message our support team directly on WhatsApp or Telegram for quick UID verification and payment assistance.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <WhatsAppIcon className="w-5 h-5" />
                  <span>WhatsApp Support</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <WhatsAppIcon className="w-5 h-5" />
                  <span>WhatsApp Support</span>
                </Link>
              )}

              {telegramHref ? (
                <a
                  href={telegramHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs sm:text-sm font-bold shadow-lg shadow-sky-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <TelegramIcon className="w-5 h-5" />
                  <span>Telegram Support</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs sm:text-sm font-bold shadow-lg shadow-sky-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <TelegramIcon className="w-5 h-5" />
                  <span>Telegram Support</span>
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* How It Works */}
        {siteSettings.homepageSections?.showHowItWorks && (
          <section className="pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex items-start gap-3 shadow-2xs">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">1. Enter Player UID</h3>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Pick a service and enter only your Player UID—no password ever needed.
                  </p>
                </div>
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex items-start gap-3 shadow-2xs">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">2. Wallet or bKash/Nagad</h3>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Pay instantly with your Wallet Balance or submit your verified TrxID.
                  </p>
                </div>
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex items-start gap-3 shadow-2xs">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">3. Fast Fulfillment</h3>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
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
