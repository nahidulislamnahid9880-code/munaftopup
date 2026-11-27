import React, {useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {
  Gem,
  HelpCircle,
  Home,
  KeyRound,
  Languages,
  LogIn,
  LogOut,
  Megaphone,
  Moon,
  Package,
  PlusCircle,
  Search,
  ShoppingBag,
  Sun,
  User,
  Wallet,
  X,
} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {useTheme} from '../../contexts/ThemeContext';
import {formatCurrency} from '../../lib/firebase';
import {resolveTelegramHref, resolveWhatsAppHref} from '../../lib/supportLinks';
import {ImageWithFallback} from '../ImageWithFallback';
import {TelegramIcon, WhatsAppIcon} from '../SupportIcons';

export function StoreLayout({children}: {children: React.ReactNode}) {
  const {siteSettings} = useStore();
  const {firebaseUser, customerProfile, signInCustomerWithGoogle, signOutCustomer} = useAuth();
  const {dark, toggleDark} = useTheme();
  const {lang, toggleLang, t} = useLanguage();
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  const walletBalance = customerProfile?.walletBalance ?? 0;
  const avatarUrl = customerProfile?.photoURL || firebaseUser?.photoURL || '';
  const displayName = customerProfile?.displayName || firebaseUser?.displayName || 'Guest User';
  const userInitial = (displayName[0] || 'U').toUpperCase();

  const whatsappHref = resolveWhatsAppHref(siteSettings.contact);
  const telegramHref = resolveTelegramHref(siteSettings.contact);

  const desktopLinks = [
    {label: t('nav.home'), to: '/'},
    {label: t('nav.addMoney'), to: '/add-money'},
    {label: t('nav.myOrders'), to: '/orders'},
    {label: t('nav.myCodes'), to: '/codes'},
    {label: t('nav.trackOrder'), to: '/track'},
  ];

  const bottomNavItems = [
    {label: t('nav.home'), to: '/', icon: Home},
    {label: t('nav.addMoney'), to: '/add-money', icon: PlusCircle},
    {label: t('nav.myOrders'), to: '/orders', icon: Package},
    {label: t('nav.myCodes'), to: '/codes', icon: KeyRound},
    {label: t('nav.profile'), to: '/account', icon: User},
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Larger 3D scrolling dismissible notice bar controlled by Admin */}
      {siteSettings.noticeActive && siteSettings.noticeText && !noticeDismissed && (
        <div
          role="region"
          aria-label="Store announcement"
          className="notice-bar-3d text-slate-100 min-h-[54px] sm:min-h-[64px] py-2 px-3 sm:px-6 border-b border-slate-800/90 flex items-center">
          <div className="max-w-[1248px] mx-auto w-full flex items-center gap-2.5 sm:gap-4 min-w-0">
            <span className="notice-3d-badge shrink-0 inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-white">
              <Megaphone className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{t('nav.notice')}</span>
            </span>

            <div className="notice-3d-stage flex-1 min-w-0 overflow-hidden rounded-xl py-2 sm:py-2.5 border border-slate-700/70">
              <div className="notice-3d-plane">
                <div className="notice-marquee-track">
                  <div className="notice-marquee-segment">
                    <span className="notice-3d-text text-sm sm:text-base font-bold whitespace-nowrap tracking-wide">
                      {siteSettings.noticeText}
                    </span>
                    <span className="notice-3d-sep text-cyan-400 text-xs" aria-hidden="true">
                      ◆
                    </span>
                  </div>
                  <div
                    className="notice-marquee-segment notice-marquee-segment-clone"
                    aria-hidden="true">
                    <span className="notice-3d-text text-sm sm:text-base font-bold whitespace-nowrap tracking-wide">
                      {siteSettings.noticeText}
                    </span>
                    <span className="notice-3d-sep text-cyan-400 text-xs">◆</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              aria-label="Dismiss announcement"
              className="text-slate-300 hover:text-white shrink-0 p-2 rounded-lg hover:bg-slate-800/80 transition-colors cursor-pointer">
              <X className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            </button>
          </div>
        </div>
      )}

      {/* Top Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b-[1.5px] border-slate-200/95 dark:border-slate-800 shadow-[0_4px_20px_rgba(15,23,42,0.05)] dark:shadow-[0_4px_20px_rgba(2,6,23,0.45)] transition-colors">
        <div className="max-w-[1248px] mx-auto px-3 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-3">
          {/* Left: Website Logo + Brand Name */}
          <Link
            to="/"
            className="flex items-center gap-2 sm:gap-2.5 text-base sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap min-w-0 font-display">
            {siteSettings.logoUrl ? (
              <ImageWithFallback
                src={siteSettings.logoUrl}
                alt={siteSettings.brandName}
                className="h-10 sm:h-13 w-auto min-w-[40px] max-w-[110px] sm:max-w-[240px] rounded-xl object-contain border border-slate-200/80 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 shrink-0"
              />
            ) : (
              <span className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 border border-cyan-400/50 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Gem className="w-5 h-5 sm:w-6 sm:h-6" />
              </span>
            )}
            <span className="truncate max-w-[130px] sm:max-w-none">{siteSettings.brandName}</span>
          </Link>

          {/* Center: Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            {desktopLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors hover:text-slate-950 dark:hover:text-white ${
                  isActive(item.to)
                    ? 'text-cyan-600 dark:text-cyan-400 font-semibold border-cyan-500'
                    : 'border-transparent'
                }`}>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right: Language + Theme + Orders Bag + Wallet + Profile Avatar */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleLang}
              aria-label="Switch language"
              title={lang === 'en' ? 'বাংলায় দেখুন' : 'Switch to English'}
              className="h-9 px-2.5 rounded-lg border-[1.5px] border-slate-200 dark:border-slate-700 hover:border-cyan-500 dark:hover:border-cyan-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors">
              {lang === 'en' ? 'বাং' : 'EN'}
            </button>

            <button
              type="button"
              onClick={toggleDark}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={dark ? t('nav.lightTheme') : t('nav.darkTheme')}
              className="w-9 h-9 rounded-lg border-[1.5px] border-slate-200 dark:border-slate-700 hover:border-cyan-500 dark:hover:border-cyan-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-amber-300 flex items-center justify-center shrink-0 cursor-pointer transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <Link
              to="/orders"
              aria-label={t('nav.myOrders')}
              className="hidden sm:flex w-9 h-9 rounded-lg border-[1.5px] border-slate-200 dark:border-slate-700 hover:border-cyan-500 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 items-center justify-center transition-colors">
              <ShoppingBag className="w-4 h-4" />
            </Link>

            <Link
              to="/add-money"
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 border border-cyan-400/60 text-white text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-sm shadow-cyan-500/20 transition-all tabular-nums">
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>{formatCurrency(walletBalance)}</span>
            </Link>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open account menu"
              className="w-9 h-9 rounded-full overflow-hidden border-2 border-slate-200 dark:border-slate-700 hover:border-cyan-500 bg-slate-900 text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors">
              {firebaseUser && avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : firebaseUser ? (
                <span className="text-xs font-bold">{userInitial}</span>
              ) : (
                <User className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Slide-out Account Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close menu backdrop"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px] cursor-pointer"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full border-l-[1.5px] border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div className="p-5 space-y-5">
              {/* Drawer User Header */}
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center shrink-0 border-2 border-slate-200 dark:border-slate-700">
                    {firebaseUser && avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold">{firebaseUser ? userInitial : <User className="w-5 h-5" />}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {firebaseUser ? displayName : t('nav.welcomeGuest')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {firebaseUser?.email || t('nav.signInSync')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close drawer"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Wallet Box */}
              <Link
                to="/add-money"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-cyan-50/80 dark:bg-cyan-950/40 border-[1.5px] border-cyan-300/80 dark:border-cyan-700/60 text-cyan-900 dark:text-cyan-200 hover:border-cyan-400 transition-colors">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Wallet className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  <span>{t('nav.walletBalance')}</span>
                </div>
                <span className="text-sm font-extrabold tabular-nums">
                  {formatCurrency(walletBalance)}
                </span>
              </Link>

              {/* Theme & Language Preferences */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={toggleDark}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-[1.5px] border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer hover:border-cyan-500 transition-colors">
                  {dark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
                  <span>{dark ? t('nav.lightTheme') : t('nav.darkTheme')}</span>
                </button>
                <button
                  type="button"
                  onClick={toggleLang}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-[1.5px] border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer hover:border-cyan-500 transition-colors">
                  <Languages className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span>{lang === 'en' ? 'বাংলা' : 'English'}</span>
                </button>
              </div>

              {/* Drawer Navigation Links */}
              <nav className="space-y-1">
                <Link
                  to="/account"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <User className="w-4 h-4 text-slate-500 dark:text-slate-400" /> {t('nav.myAccount')}
                </Link>
                <Link
                  to="/orders"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <Package className="w-4 h-4 text-slate-500 dark:text-slate-400" /> {t('nav.myOrders')}
                </Link>
                <Link
                  to="/codes"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <KeyRound className="w-4 h-4 text-slate-500 dark:text-slate-400" /> {t('nav.myCodes')}
                </Link>
                <Link
                  to="/add-money"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <PlusCircle className="w-4 h-4 text-slate-500 dark:text-slate-400" /> {t('nav.addMoney')}
                </Link>
                <Link
                  to="/track"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <Search className="w-4 h-4 text-slate-500 dark:text-slate-400" /> {t('nav.trackOrder')}
                </Link>
                <Link
                  to="/account?tab=support"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <HelpCircle className="w-4 h-4 text-slate-500 dark:text-slate-400" /> {t('nav.supportDesk')}
                </Link>
              </nav>

              {/* Direct Support Buttons in Drawer */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {whatsappHref ? (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                    <WhatsAppIcon className="w-4 h-4 shrink-0" />
                    <span>WhatsApp</span>
                  </a>
                ) : (
                  <Link
                    to="/account?tab=support"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                    <WhatsAppIcon className="w-4 h-4 shrink-0" />
                    <span>WhatsApp</span>
                  </Link>
                )}

                {telegramHref ? (
                  <a
                    href={telegramHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
                    <TelegramIcon className="w-4 h-4 shrink-0" />
                    <span>Telegram</span>
                  </a>
                ) : (
                  <Link
                    to="/account?tab=support"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
                    <TelegramIcon className="w-4 h-4 shrink-0" />
                    <span>Telegram</span>
                  </Link>
                )}
              </div>

              {/* Auth Action */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                {firebaseUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      void signOutCustomer();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                    <LogOut className="w-4 h-4" /> {t('nav.logout')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      void signInCustomerWithGoogle();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 text-white text-sm font-semibold cursor-pointer">
                    <LogIn className="w-4 h-4" /> {t('nav.signInGoogle')}
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <Link to="/terms" onClick={() => setDrawerOpen(false)} className="hover:text-slate-600 dark:hover:text-slate-200">
                {t('nav.terms')}
              </Link>
              <Link to="/privacy" onClick={() => setDrawerOpen(false)} className="hover:text-slate-600 dark:hover:text-slate-200">
                {t('nav.privacy')}
              </Link>
              <Link to="/admin/login" onClick={() => setDrawerOpen(false)} className="hover:text-slate-600 dark:hover:text-slate-200">
                Admin
              </Link>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 pb-24 md:pb-12">{children}</main>

      {/* Floating Customer Support Buttons (WhatsApp + Telegram) */}
      <div
        aria-label="Customer support quick actions"
        className="fixed right-2.5 sm:right-5 bottom-[74px] md:bottom-6 z-30 flex flex-col items-end gap-2">
        {telegramHref ? (
          <a
            href={telegramHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram Customer Support"
            title="Telegram Support"
            className="group inline-flex items-center justify-center gap-2 w-10 h-10 sm:w-auto sm:h-11 sm:px-3.5 rounded-full bg-sky-500 hover:bg-sky-600 border-2 border-white/90 dark:border-slate-900 text-white shadow-[0_8px_20px_rgba(2,132,199,0.3)] hover:-translate-y-0.5 transition-all">
            <TelegramIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">Telegram</span>
          </a>
        ) : (
          <Link
            to="/account?tab=support"
            aria-label="Telegram Customer Support"
            title="Telegram Support"
            className="group inline-flex items-center justify-center gap-2 w-10 h-10 sm:w-auto sm:h-11 sm:px-3.5 rounded-full bg-sky-500 hover:bg-sky-600 border-2 border-white/90 dark:border-slate-900 text-white shadow-[0_8px_20px_rgba(2,132,199,0.3)] hover:-translate-y-0.5 transition-all">
            <TelegramIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">Telegram</span>
          </Link>
        )}

        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp Customer Support"
            title="WhatsApp Support"
            className="group inline-flex items-center justify-center gap-2 w-10 h-10 sm:w-auto sm:h-11 sm:px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 border-2 border-white/90 dark:border-slate-900 text-white shadow-[0_8px_20px_rgba(5,150,105,0.3)] hover:-translate-y-0.5 transition-all">
            <WhatsAppIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">WhatsApp</span>
          </a>
        ) : (
          <Link
            to="/account?tab=support"
            aria-label="WhatsApp Customer Support"
            title="WhatsApp Support"
            className="group inline-flex items-center justify-center gap-2 w-10 h-10 sm:w-auto sm:h-11 sm:px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 border-2 border-white/90 dark:border-slate-900 text-white shadow-[0_8px_20px_rgba(5,150,105,0.3)] hover:-translate-y-0.5 transition-all">
            <WhatsAppIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">WhatsApp</span>
          </Link>
        )}
      </div>

      {/* Dynamic Footer */}
      <footer className="bg-slate-950 text-slate-300 border-t-2 border-cyan-500/30 pb-20 md:pb-0">
        <div className="max-w-[1248px] mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-2.5 md:col-span-2">
            <div className="flex items-center gap-3 text-white font-bold text-lg font-display">
              {siteSettings.logoUrl ? (
                <ImageWithFallback
                  src={siteSettings.logoUrl}
                  alt={siteSettings.brandName}
                  className="h-10 sm:h-12 w-auto max-w-[180px] rounded-lg object-contain"
                />
              ) : (
                <span className="w-10 h-10 rounded-xl bg-cyan-500 text-white flex items-center justify-center">
                  <Gem className="w-5 h-5" />
                </span>
              )}
              <span>{siteSettings.brandName}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md leading-relaxed">
              {siteSettings.brandTagline}
            </p>
            {siteSettings.contact.supportHours && (
              <p className="text-xs text-slate-400">
                {t('nav.supportHours')}: {siteSettings.contact.supportHours}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                  <WhatsAppIcon className="w-4 h-4" />
                  <span>{t('home.whatsappSupport')}</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                  <WhatsAppIcon className="w-4 h-4" />
                  <span>{t('home.whatsappSupport')}</span>
                </Link>
              )}
              {telegramHref ? (
                <a
                  href={telegramHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
                  <TelegramIcon className="w-4 h-4" />
                  <span>{t('home.telegramSupport')}</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
                  <TelegramIcon className="w-4 h-4" />
                  <span>{t('home.telegramSupport')}</span>
                </Link>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white">
              {t('nav.quickLinks')}
            </h4>
            <ul className="space-y-1.5 text-xs sm:text-sm text-slate-400">
              <li>
                <Link to="/add-money" className="hover:text-white transition-colors">
                  {t('nav.addMoney')}
                </Link>
              </li>
              <li>
                <Link to="/orders" className="hover:text-white transition-colors">
                  {t('nav.myOrders')}
                </Link>
              </li>
              <li>
                <Link to="/codes" className="hover:text-white transition-colors">
                  {t('nav.myCodes')}
                </Link>
              </li>
              <li>
                <Link to="/track" className="hover:text-white transition-colors">
                  {t('nav.trackOrder')}
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-white transition-colors">
                  {t('nav.terms')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-white transition-colors">
                  {t('nav.privacy')}
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white">
              {t('nav.contact')}
            </h4>
            <ul className="space-y-1.5 text-xs sm:text-sm text-slate-400">
              {siteSettings.contact.email && <li>{siteSettings.contact.email}</li>}
              {siteSettings.contact.phone && <li>{siteSettings.contact.phone}</li>}
              {siteSettings.contact.address && <li>{siteSettings.contact.address}</li>}
              <li className="flex flex-wrap gap-3 pt-1">
                {siteSettings.socials.facebook && (
                  <a href={siteSettings.socials.facebook} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline">
                    Facebook
                  </a>
                )}
                {siteSettings.socials.instagram && (
                  <a href={siteSettings.socials.instagram} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline">
                    Instagram
                  </a>
                )}
                {siteSettings.socials.youtube && (
                  <a href={siteSettings.socials.youtube} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline">
                    YouTube
                  </a>
                )}
                {siteSettings.socials.discord && (
                  <a href={siteSettings.socials.discord} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline">
                    Discord
                  </a>
                )}
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-900">
          <div className="max-w-[1248px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <p>{siteSettings.footerText}</p>
            <Link to="/admin/login" className="hover:text-slate-300 transition-colors">
              {t('nav.staffConsole')}
            </Link>
          </div>
        </div>
      </footer>

      {/* Fixed Mobile Bottom Navigation */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/98 dark:bg-slate-900/95 backdrop-blur-md border-t-[1.5px] border-slate-200/95 dark:border-slate-800 px-1 py-1.5 flex items-center justify-around shadow-[0_-6px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_-6px_24px_rgba(2,6,23,0.5)]">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          const isProfile = item.to === '/account';
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-xl border min-w-[58px] transition-colors ${
                active
                  ? 'text-cyan-700 dark:text-cyan-300 bg-cyan-50/75 dark:bg-cyan-950/60 border-cyan-200/90 dark:border-cyan-700/60'
                  : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-white'
              }`}>
              {isProfile && firebaseUser && avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className={`w-5 h-5 rounded-full object-cover border ${
                    active ? 'border-cyan-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
              ) : (
                <Icon className="w-5 h-5" />
              )}
              <span className={`text-[10px] leading-tight whitespace-nowrap ${active ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
