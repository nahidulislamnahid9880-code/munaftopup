import React, {useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {Gem, Menu, X} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {ImageWithFallback} from '../ImageWithFallback';

export function StoreLayout({children}: {children: React.ReactNode}) {
  const {siteSettings} = useStore();
  const {firebaseUser, signInCustomerWithGoogle} = useAuth();
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    {label: 'Top-Ups', to: '/'},
    {label: 'Categories', to: '/#categories'},
    {label: 'Track Order', to: '/track'},
    {label: 'Support', to: '/account?tab=support'},
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path.split('?')[0].split('#')[0]);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Slim dismissible notice bar controlled by Admin */}
      {siteSettings.noticeActive && siteSettings.noticeText && !noticeDismissed && (
        <div className="bg-slate-900 text-slate-100 text-xs px-4 py-2 flex items-center justify-between gap-4 border-b border-slate-800">
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4">
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

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            to="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display">
            {siteSettings.logoUrl ? (
              <ImageWithFallback
                src={siteSettings.logoUrl}
                alt={siteSettings.brandName}
                className="w-7 h-7 rounded-md object-cover"
              />
            ) : (
              <span className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Gem className="w-4 h-4" />
              </span>
            )}
            <span className="whitespace-nowrap shrink-0">{siteSettings.brandName}</span>
          </Link>

          {/* Zone 2: 4 single-line Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            {navLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                  isActive(item.to) ? 'text-blue-600 font-semibold' : ''
                }`}>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Zone 3: 1 Primary Action + Mobile Menu Trigger */}
          <div className="flex items-center gap-3 shrink-0">
            {firebaseUser ? (
              <Link
                to="/account"
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium whitespace-nowrap shrink-0 transition-colors">
                My Account
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void signInCustomerWithGoogle()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer">
                Sign In
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              className="md:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer">
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
            {navLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100">
                {item.label}
              </Link>
            ))}
            <Link
              to="/account"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100">
              Account &amp; Orders
            </Link>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      {/* Dynamic Footer */}
      <footer className="bg-slate-950 text-slate-300 border-t border-slate-900 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center gap-2.5 text-white font-bold text-lg font-display">
              {siteSettings.logoUrl ? (
                <ImageWithFallback
                  src={siteSettings.logoUrl}
                  alt={siteSettings.brandName}
                  className="w-7 h-7 rounded-md object-cover"
                />
              ) : (
                <span className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center">
                  <Gem className="w-4 h-4" />
                </span>
              )}
              <span>{siteSettings.brandName}</span>
            </div>
            <p className="text-sm text-slate-400 max-w-md leading-relaxed">
              {siteSettings.brandTagline}
            </p>
            {siteSettings.contact.supportHours && (
              <p className="text-xs text-slate-400">
                Support Hours: {siteSettings.contact.supportHours}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-white">Customer Links</h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/track" className="hover:text-white transition-colors">
                  Track Order
                </Link>
              </li>
              <li>
                <Link to="/account" className="hover:text-white transition-colors">
                  My Account
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

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-white">Contact &amp; Channels</h4>
            <ul className="space-y-2 text-sm text-slate-400">
              {siteSettings.contact.email && <li>{siteSettings.contact.email}</li>}
              {siteSettings.contact.phone && <li>{siteSettings.contact.phone}</li>}
              {siteSettings.contact.address && <li>{siteSettings.contact.address}</li>}
              <li className="flex flex-wrap gap-3 pt-1">
                {siteSettings.socials.facebook && (
                  <a href={siteSettings.socials.facebook} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                    Facebook
                  </a>
                )}
                {siteSettings.socials.instagram && (
                  <a href={siteSettings.socials.instagram} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                    Instagram
                  </a>
                )}
                {siteSettings.socials.youtube && (
                  <a href={siteSettings.socials.youtube} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                    YouTube
                  </a>
                )}
                {siteSettings.socials.discord && (
                  <a href={siteSettings.socials.discord} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                    Discord
                  </a>
                )}
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <p>{siteSettings.footerText}</p>
            <Link to="/admin/login" className="hover:text-slate-300 transition-colors">
              Staff Console
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
