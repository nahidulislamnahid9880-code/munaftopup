import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  Headphones,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {formatCurrency} from '../../lib/firebase';
import {
  calculateCountdownParts,
  calculatePackagePricing,
  getActiveFlashSaleForProduct,
  isFlashSaleActive,
} from '../../lib/pricing';
import {resolveTelegramHref, resolveWhatsAppHref} from '../../lib/supportLinks';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {TelegramIcon, WhatsAppIcon} from '../../components/SupportIcons';
import {StoreLayout} from '../../components/store/StoreLayout';
import type {Product} from '../../types';

export function HomePage() {
  const {siteSettings, categories, products, flashSales, programConfig, loading, catalogInitialized} =
    useStore();
  const {customerProfile} = useAuth();
  const {t} = useLanguage();
  const toast = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bannerIdx, setBannerIdx] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  const activeFlashSales = useMemo(
    () => flashSales.filter((s) => isFlashSaleActive(s, nowMs)),
    [flashSales, nowMs],
  );

  useEffect(() => {
    if (flashSales.length === 0) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [flashSales.length]);

  useEffect(() => {
    if (activeBanners.length <= 1) return;
    const timer = setInterval(() => {
      setBannerIdx((prev) => (prev + 1) % activeBanners.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [activeBanners.length]);

  const currentBanner = activeBanners[bannerIdx % Math.max(1, activeBanners.length)];

  const getLowestPackagePrice = (product: Product): {base: number; discounted: number} | null => {
    const activePkgs = (product.packages || []).filter((pkg) => pkg.active && pkg.price > 0);
    if (activePkgs.length === 0) return null;
    const minBase = Math.min(...activePkgs.map((pkg) => pkg.price));
    const sale = getActiveFlashSaleForProduct(flashSales, product.id, nowMs);
    const pricing = calculatePackagePricing(minBase, sale, customerProfile?.tier, programConfig);
    return {base: minBase, discounted: pricing.finalPriceBeforeCoupon};
  };

  const handleCopyPromoCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Promo code ${code} copied!`);
    } catch {
      toast.info(`Promo code: ${code}`);
    }
  };

  const getProductTag = (product: Product, index: number): 'popular' | 'best_selling' | null => {
    const hasBest = (product.packages || []).some((p) => p.active && p.badgeType === 'best_selling');
    if (hasBest) return 'best_selling';
    const hasPopular = (product.packages || []).some((p) => p.active && p.badgeType === 'popular');
    if (hasPopular) return 'popular';
    if (product.featured && index === 0) return 'best_selling';
    if (product.featured && index === 1) return 'popular';
    return null;
  };

  return (
    <StoreLayout>
      <div className="max-w-[1248px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6 sm:space-y-8">
        {/* Hero Banner */}
        {currentBanner && (
          <section className="relative rounded-2xl sm:rounded-3xl overflow-hidden border-2 border-slate-900/15 dark:border-slate-700/80 ring-1 ring-cyan-500/25 bg-slate-950 shadow-[0_20px_50px_rgba(15,23,42,0.16)] dark:shadow-[0_20px_50px_rgba(2,6,23,0.55)]">
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
              <div className="w-full h-[225px] sm:h-[340px] md:h-[420px] lg:h-[480px] overflow-hidden bg-slate-950">
                <ImageWithFallback
                  src={currentBanner.imageUrl}
                  alt={currentBanner.title}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/55 to-slate-950/15 flex flex-col justify-end sm:justify-center p-4 sm:p-8 lg:p-12">
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
                      <span>{siteSettings.heroCtaText || t('home.browseTopUps')}</span>
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
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors px-3.5 py-3 flex items-center gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="w-9 h-9 rounded-xl bg-cyan-50 dark:bg-cyan-950/70 border border-cyan-200/70 dark:border-cyan-800/70 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  {t('home.instantUid')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t('home.instantUidDesc')}
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors px-3.5 py-3 flex items-center gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  {t('home.paymentMethods')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t('home.paymentMethodsDesc')}
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors px-3.5 py-3 flex items-center gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-200/70 dark:border-blue-800/70 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  {t('home.accountSafe')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t('home.accountSafeDesc')}
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors px-3.5 py-3 flex items-center gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950/70 border border-sky-200/70 dark:border-sky-800/70 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  {t('home.activeSupport')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t('home.activeSupportDesc')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Live Flash Sales Strip */}
        {activeFlashSales.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <Flame className="w-4 h-4" />
                </span>
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white font-display">
                  {t('flash.title')}
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeFlashSales.map((sale) => {
                const matchedProd = products.find((p) => p.id === sale.productId && p.active);
                if (!matchedProd) return null;
                const cd = calculateCountdownParts(sale.endsAt, nowMs);
                const lowest = getLowestPackagePrice(matchedProd);
                return (
                  <Link
                    key={sale.id}
                    to={`/product/${matchedProd.slug}`}
                    className="group rounded-2xl bg-gradient-to-br from-rose-50 via-white to-amber-50/70 dark:from-rose-950/35 dark:via-slate-900 dark:to-amber-950/20 border-[1.5px] border-rose-200 dark:border-rose-800/70 hover:border-rose-400 dark:hover:border-rose-500 p-3.5 flex items-center gap-3.5 shadow-[0_8px_20px_-8px_rgba(244,63,94,0.2)] dark:shadow-none transition-all">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-rose-200/80 dark:border-rose-800 shrink-0">
                      <ImageWithFallback
                        src={matchedProd.images?.[0]}
                        alt={matchedProd.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wide">
                          -{sale.discountPercent}% {t('flash.off')}
                        </span>
                        {sale.badgeText && (
                          <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300 truncate">
                            {sale.badgeText}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {sale.title || matchedProd.name}
                      </h3>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        {lowest && (
                          <span className="font-extrabold text-cyan-700 dark:text-cyan-400 tabular-nums">
                            {t('home.from')} {formatCurrency(lowest.discounted)}{' '}
                            <span className="text-[11px] font-normal text-slate-400 line-through">
                              {formatCurrency(lowest.base)}
                            </span>
                          </span>
                        )}
                        {cd && (
                          <span className="font-mono text-[11px] font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                            {cd.days > 0 ? `${cd.days}d ` : ''}
                            {String(cd.hours).padStart(2, '0')}:{String(cd.minutes).padStart(2, '0')}:
                            {String(cd.seconds).padStart(2, '0')}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Search & Category Filter Bar */}
        <section id="categories">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-2 sm:p-2.5 shadow-[0_6px_20px_-6px_rgba(15,23,42,0.06)] dark:shadow-none flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('home.searchPlaceholder')}
                className="w-full pl-10 pr-3.5 py-2 text-xs sm:text-sm rounded-xl border-[1.5px] border-slate-300/90 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500 transition-colors"
              />
            </div>

            {activeCategories.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                    selectedCategory === 'all'
                      ? 'bg-slate-900 dark:bg-cyan-600 border-slate-900 dark:border-cyan-500 text-white shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300'
                  }`}>
                  {t('home.allCategories')}
                </button>
                {activeCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                      selectedCategory === cat.id
                        ? 'bg-gradient-to-r from-cyan-500 to-teal-500 border-cyan-400 text-white shadow-sm shadow-cyan-500/20'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300'
                    }`}>
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Category-Grouped Product Grids */}
        <section id="products" className="space-y-8 sm:space-y-10">
          {loading ? (
            <div className="space-y-4">
              <div className="h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 space-y-2.5 animate-pulse">
                    <div className="aspect-square rounded-xl bg-slate-200 dark:bg-slate-800" />
                    <div className="h-3 w-4/5 mx-auto bg-slate-200 dark:bg-slate-800 rounded" />
                    <div className="h-2.5 w-1/2 mx-auto bg-slate-200 dark:bg-slate-800 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : !catalogInitialized && products.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-8 text-center space-y-3 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                Storefront Ready for Initial Catalog Setup
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                All products, square category icons, diamond packages, and payment numbers load dynamically from the database. Sign in as Admin to publish the live catalog.
              </p>
              <div className="pt-1">
                <Link
                  to="/admin/login"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 text-white text-xs font-semibold">
                  Open Admin Login <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ) : categorySections.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-8 text-center space-y-1.5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('home.noMatchingProducts')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('home.clearSearchHint')}
              </p>
            </div>
          ) : (
            categorySections.map((group) => (
              <div key={group.id} className="space-y-4 sm:space-y-5">
                <div className="flex items-end justify-between gap-4 border-b-[1.5px] border-slate-200/90 dark:border-slate-800 pb-3">
                  <div className="space-y-1">
                    <h2 className="text-lg sm:text-2xl font-extrabold text-slate-900 dark:text-white font-display tracking-tight">
                      {group.name}
                    </h2>
                    <div className="w-12 h-1 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" />
                  </div>
                  {selectedCategory === 'all' && activeCategories.some((c) => c.id === group.id) ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory(group.id)}
                      className="text-xs sm:text-sm font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1">
                      {t('home.viewAll')} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : selectedCategory !== 'all' ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('all')}
                      className="text-xs sm:text-sm font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 whitespace-nowrap shrink-0 cursor-pointer">
                      {t('home.showAllCategories')}
                    </button>
                  ) : null}
                </div>

                {/* 3-Column Square Product Grid on Mobile -> 4/6 on Tablet & Desktop */}
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-5">
                  {group.items.map((product, idx) => {
                    const priceInfo = getLowestPackagePrice(product);
                    const activeSale = getActiveFlashSaleForProduct(flashSales, product.id, nowMs);
                    const tag = getProductTag(product, idx);
                    return (
                      <Link
                        key={product.id}
                        to={`/product/${product.slug}`}
                        className="group relative rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-1.5 sm:p-2 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.06)] dark:shadow-none hover:shadow-[0_14px_30px_rgba(8,145,178,0.16)] hover:border-cyan-500 dark:hover:border-cyan-500 hover:-translate-y-0.5 transition-all duration-200 flex flex-col text-center focus:outline-none">
                        {activeSale ? (
                          <span className="absolute top-2.5 left-2.5 z-10 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide shadow-xs bg-rose-600 text-white">
                            -{activeSale.discountPercent}%
                          </span>
                        ) : (
                          tag && (
                            <span
                              className={`absolute top-2.5 left-2.5 z-10 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold uppercase tracking-wide shadow-xs ${
                                tag === 'best_selling'
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-cyan-600 text-white'
                              }`}>
                              {tag === 'best_selling' ? t('home.bestSelling') : t('home.popular')}
                            </span>
                          )
                        )}
                        <div className="w-full aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/80">
                          <ImageWithFallback
                            src={product.images?.[0]}
                            alt={product.name}
                            fallbackLabel={product.name}
                            className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-300"
                          />
                        </div>
                        <div className="pt-2 pb-1 px-0.5 flex-1 flex flex-col justify-between gap-1">
                          <h3 className="text-[11px] sm:text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors leading-snug line-clamp-2">
                            {product.name}
                          </h3>
                          {priceInfo !== null && (
                            <p className="text-[10px] sm:text-xs font-semibold text-cyan-700 dark:text-cyan-400 tabular-nums">
                              {t('home.from')} {formatCurrency(priceInfo.discounted)}
                              {priceInfo.discounted < priceInfo.base && (
                                <span className="ml-1 text-[9px] text-slate-400 line-through">
                                  {formatCurrency(priceInfo.base)}
                                </span>
                              )}
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
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white font-display">
              {t('home.featuredOffers')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activePromos.map((promo) => (
                <div
                  key={promo.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400 dark:hover:border-cyan-500 overflow-hidden grid grid-cols-5 items-stretch shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none transition-all">
                  <div className="col-span-2 bg-slate-900 border-r border-slate-200/80 dark:border-slate-800">
                    <ImageWithFallback
                      src={promo.imageUrl}
                      alt={promo.title}
                      className="w-full h-full object-cover aspect-square sm:aspect-auto"
                    />
                  </div>
                  <div className="col-span-3 p-4 sm:p-5 flex flex-col justify-center space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-cyan-700 dark:text-cyan-400 flex-wrap">
                      <span>{promo.discountText || t('home.specialOffer')}</span>
                      {promo.code && (
                        <button
                          type="button"
                          onClick={() => void handleCopyPromoCode(promo.code)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 font-mono text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900 cursor-pointer">
                          {promo.code} <Copy className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-display">
                      {promo.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                      {promo.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Customer Support Banner: WhatsApp & Telegram Buttons */}
        <section className="rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white p-5 sm:p-8 border-[1.5px] border-cyan-500/35 ring-1 ring-white/10 shadow-[0_14px_34px_-8px_rgba(15,23,42,0.28)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-1.5 max-w-xl">
              <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold">
                <Headphones className="w-4 h-4" />
                <span>{t('home.supportDeskTag')}</span>
              </div>
              <h2 className="text-lg sm:text-2xl font-extrabold font-display tracking-tight">
                {t('home.needHelpTitle')}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {t('home.needHelpDesc')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 border border-white/20 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <WhatsAppIcon className="w-5 h-5" />
                  <span>{t('home.whatsappSupport')}</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 border border-white/20 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <WhatsAppIcon className="w-5 h-5" />
                  <span>{t('home.whatsappSupport')}</span>
                </Link>
              )}

              {telegramHref ? (
                <a
                  href={telegramHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 border border-white/20 text-white text-xs sm:text-sm font-bold shadow-lg shadow-sky-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <TelegramIcon className="w-5 h-5" />
                  <span>{t('home.telegramSupport')}</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 border border-white/20 text-white text-xs sm:text-sm font-bold shadow-lg shadow-sky-900/30 transition-all cursor-pointer whitespace-nowrap">
                  <TelegramIcon className="w-5 h-5" />
                  <span>{t('home.telegramSupport')}</span>
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* How It Works */}
        {siteSettings.homepageSections?.showHowItWorks && (
          <section className="pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors rounded-2xl p-4 sm:p-5 flex items-start gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.05)] dark:shadow-none">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 dark:bg-cyan-950/70 border border-cyan-200/70 dark:border-cyan-800/70 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('home.step1Title')}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {t('home.step1Desc')}
                  </p>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors rounded-2xl p-4 sm:p-5 flex items-start gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.05)] dark:shadow-none">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 dark:bg-cyan-950/70 border border-cyan-200/70 dark:border-cyan-800/70 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('home.step2Title')}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {t('home.step2Desc')}
                  </p>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 hover:border-cyan-400/80 dark:hover:border-cyan-500/70 transition-colors rounded-2xl p-4 sm:p-5 flex items-start gap-3 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.05)] dark:shadow-none">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 dark:bg-cyan-950/70 border border-cyan-200/70 dark:border-cyan-800/70 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('home.step3Title')}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {t('home.step3Desc')}
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
