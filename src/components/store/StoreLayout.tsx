import React, {useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {
  Gem,
  HelpCircle,
  Home,
  KeyRound,
  LogIn,
  LogOut,
  Package,
  PlusCircle,
  Search,
  ShoppingBag,
  User,
  Wallet,
  X,
} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {formatCurrency} from '../../lib/firebase';
import {resolveTelegramHref, resolveWhatsAppHref} from '../../lib/supportLinks';
import {ImageWithFallback} from '../ImageWithFallback';
import {TelegramIcon, WhatsAppIcon} from '../SupportIcons';

export function StoreLayout({children}: {children: React.ReactNode}) {
  const {siteSettings} = useStore();
  const {firebaseUser, customerProfile, signInCustomerWithGoogle, signOutCustomer} = useAuth();
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
    {label: 'Home', to: '/'},
    {label: 'Add Money', to: '/add-money'},
    {label: 'My Orders', to: '/orders'},
    {label: 'My Codes', to: '/codes'},
    {label: 'Track Order', to: '/track'},
  ];

  const bottomNavItems = [
    {label: 'Home', to: '/', icon: Home},
    {label: 'Add Money', to: '/add-money', icon: PlusCircle},
    {label: 'My Orders', to: '/orders', icon: Package},
    {label: 'My Codes', to: '/codes', icon: KeyRound},
    {label: 'Profile', to: '/account', icon: User},
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Slim dismissible notice bar controlled by Admin */}
      {siteSettings.noticeActive && siteSettings.noticeText && !noticeDismissed && (
        <div className="bg-slate-900 text-slate-100 text-xs px-3 sm:px-6 py-1.5 border-b border-slate-800">
          <div className="max-w-[1248px] mx-auto w-full flex items-center justify-between gap-3">
            <p className="truncate font-medium">{siteSettings.noticeText}</p>
            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              aria-label="Dismiss announcement"
              className="text-slate-400 hover:text-white shrink-0 p-0.5 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_12px_rgba(15,23,42,0.04)]">
        <div className="max-w-[1248px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          {/* Left: Website Logo + Brand Name */}
          <Link
            to="/"
            className="flex items-center gap-2 text-base sm:text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display">
            {siteSettings.logoUrl ? (
              <ImageWithFallback
                src={siteSettings.logoUrl}
                alt={siteSettings.brandName}
                className="w-8 h-8 rounded-lg object-cover border border-slate-200"
              />
            ) : (
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Gem className="w-4 h-4" />
              </span>
            )}
            <span className="truncate max-w-[140px] sm:max-w-none">{siteSettings.brandName}</span>
          </Link>

          {/* Center: Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {desktopLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                  isActive(item.to) ? 'text-cyan-600 font-semibold' : ''
                }`}>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right: Orders Bag Icon + Cyan Wallet Balance Pill + Profile Avatar */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <Link
              to="/orders"
              aria-label="My Orders"
              className="w-9 h-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center transition-colors shadow-2xs">
              <ShoppingBag className="w-4 h-4" />
            </Link>

            <Link
              to="/add-money"
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-sm shadow-cyan-500/20 transition-all tabular-nums">
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>{formatCurrency(walletBalance)}</span>
            </Link>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open account menu"
              className="w-9 h-9 rounded-full overflow-hidden border-2 border-slate-200 hover:border-cyan-500 bg-slate-900 text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors">
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
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px] cursor-pointer"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div className="p-5 space-y-5">
              {/* Drawer User Header */}
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center shrink-0 border border-slate-200">
                    {firebaseUser && avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold">{firebaseUser ? userInitial : <User className="w-5 h-5" />}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {firebaseUser ? displayName : 'Welcome Guest'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {firebaseUser?.email || 'Sign in to sync orders & wallet'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close drawer"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Wallet Pill */}
              <Link
                to="/add-money"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-900">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Wallet className="w-4 h-4 text-cyan-600" />
                  <span>Wallet Balance</span>
                </div>
                <span className="text-sm font-extrabold tabular-nums">
                  {formatCurrency(walletBalance)}
                </span>
              </Link>

              {/* Drawer Navigation Links */}
              <nav className="space-y-1">
                <Link
                  to="/account"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <User className="w-4 h-4 text-slate-500" /> My Account
                </Link>
                <Link
                  to="/orders"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <Package className="w-4 h-4 text-slate-500" /> My Orders
                </Link>
                <Link
                  to="/codes"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <KeyRound className="w-4 h-4 text-slate-500" /> My Codes
                </Link>
                <Link
                  to="/add-money"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <PlusCircle className="w-4 h-4 text-slate-500" /> Add Money
                </Link>
                <Link
                  to="/track"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <Search className="w-4 h-4 text-slate-500" /> Track Order
                </Link>
                <Link
                  to="/account?tab=support"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <HelpCircle className="w-4 h-4 text-slate-500" /> Support Desk
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
              <div className="pt-3 border-t border-slate-100">
                {firebaseUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      void signOutCustomer();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer">
                    <LogOut className="w-4 h-4" /> Logout
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      void signInCustomerWithGoogle();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer">
                    <LogIn className="w-4 h-4" /> Sign in with Google
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 text-xs text-slate-400 flex items-center justify-between">
              <Link to="/terms" onClick={() => setDrawerOpen(false)} className="hover:text-slate-600">
                Terms
              </Link>
              <Link to="/privacy" onClick={() => setDrawerOpen(false)} className="hover:text-slate-600">
                Privacy
              </Link>
              <Link to="/admin/login" onClick={() => setDrawerOpen(false)} className="hover:text-slate-600">
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
        className="fixed right-3 sm:right-5 bottom-[74px] md:bottom-6 z-30 flex flex-col items-end gap-2.5">
        {telegramHref ? (
          <a
            href={telegramHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram Customer Support"
            title="Telegram Support"
            className="group inline-flex items-center gap-2 h-11 px-3 sm:px-3.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white shadow-lg shadow-sky-600/25 hover:-translate-y-0.5 transition-all">
            <TelegramIcon className="w-5 h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">Telegram</span>
          </a>
        ) : (
          <Link
            to="/account?tab=support"
            aria-label="Telegram Customer Support"
            title="Telegram Support"
            className="group inline-flex items-center gap-2 h-11 px-3 sm:px-3.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white shadow-lg shadow-sky-600/25 hover:-translate-y-0.5 transition-all">
            <TelegramIcon className="w-5 h-5 shrink-0" />
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
            className="group inline-flex items-center gap-2 h-11 px-3 sm:px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-700/25 hover:-translate-y-0.5 transition-all">
            <WhatsAppIcon className="w-5 h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">WhatsApp</span>
          </a>
        ) : (
          <Link
            to="/account?tab=support"
            aria-label="WhatsApp Customer Support"
            title="WhatsApp Support"
            className="group inline-flex items-center gap-2 h-11 px-3 sm:px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-700/25 hover:-translate-y-0.5 transition-all">
            <WhatsAppIcon className="w-5 h-5 shrink-0" />
            <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">WhatsApp</span>
          </Link>
        )}
      </div>

      {/* Dynamic Footer */}
      <footer className="bg-slate-950 text-slate-300 border-t border-slate-900 pb-20 md:pb-0">
        <div className="max-w-[1248px] mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-2.5 md:col-span-2">
            <div className="flex items-center gap-2.5 text-white font-bold text-base font-display">
              {siteSettings.logoUrl ? (
                <ImageWithFallback
                  src={siteSettings.logoUrl}
                  alt={siteSettings.brandName}
                  className="w-7 h-7 rounded-md object-cover"
                />
              ) : (
                <span className="w-7 h-7 rounded-md bg-cyan-500 text-white flex items-center justify-center">
                  <Gem className="w-4 h-4" />
                </span>
              )}
              <span>{siteSettings.brandName}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md leading-relaxed">
              {siteSettings.brandTagline}
            </p>
            {siteSettings.contact.supportHours && (
              <p className="text-xs text-slate-400">
                Support Hours: {siteSettings.contact.supportHours}
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
                  <span>WhatsApp Support</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                  <WhatsAppIcon className="w-4 h-4" />
                  <span>WhatsApp Support</span>
                </Link>
              )}
              {telegramHref ? (
                <a
                  href={telegramHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
                  <TelegramIcon className="w-4 h-4" />
                  <span>Telegram Support</span>
                </a>
              ) : (
                <Link
                  to="/account?tab=support"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors">
                  <TelegramIcon className="w-4 h-4" />
                  <span>Telegram Support</span>
                </Link>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white">Quick Links</h4>
            <ul className="space-y-1.5 text-xs sm:text-sm text-slate-400">
              <li>
                <Link to="/add-money" className="hover:text-white transition-colors">
                  Add Money
                </Link>
              </li>
              <li>
                <Link to="/orders" className="hover:text-white transition-colors">
                  My Orders
                </Link>
              </li>
              <li>
                <Link to="/codes" className="hover:text-white transition-colors">
                  My Codes
                </Link>
              </li>
              <li>
                <Link to="/track" className="hover:text-white transition-colors">
                  Track Order
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white">Contact</h4>
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
              Staff Console
            </Link>
          </div>
        </div>
      </footer>

      {/* Fixed Mobile Bottom Navigation (5 items matching specification) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-1 py-1.5 flex items-center justify-around shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          const isProfile = item.to === '/account';
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg min-w-[58px] transition-colors ${
                active ? 'text-cyan-600' : 'text-slate-500 hover:text-slate-900'
              }`}>
              {isProfile && firebaseUser && avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className={`w-5 h-5 rounded-full object-cover border ${
                    active ? 'border-cyan-500' : 'border-slate-300'
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
