import React, {useState} from 'react';
import {Link, Navigate, useLocation} from 'react-router-dom';
import {
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Moon,
  Package,
  Palette,
  Settings,
  Shield,
  ShoppingBag,
  Sun,
  Users,
  X,
} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useTheme} from '../../contexts/ThemeContext';
import type {StaffPermissions} from '../../types';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{className?: string}>;
  perm?: keyof StaffPermissions;
}

const NAV_ITEMS: NavItem[] = [
  {label: 'Overview', to: '/admin', icon: LayoutDashboard},
  {label: 'Orders', to: '/admin/orders', icon: ShoppingBag, perm: 'orders'},
  {label: 'Products & Packs', to: '/admin/products', icon: Package, perm: 'products'},
  {label: 'Payments & TrxID', to: '/admin/payments', icon: CreditCard, perm: 'payments'},
  {label: 'Customization', to: '/admin/customization', icon: Palette, perm: 'customization'},
  {label: 'Customers & Tickets', to: '/admin/customers', icon: Users, perm: 'customers'},
  {label: 'Admin Settings', to: '/admin/settings', icon: Settings, perm: 'settings'},
];

export function AdminLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const {adminUser, firebaseUser, adminLinkGoogleForSync, adminLogout} = useAuth();
  const {dark, toggleDark} = useTheme();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!adminUser) {
    return <Navigate to="/admin/login" replace />;
  }

  const visibleNav = NAV_ITEMS.filter((item) => {
    if (!item.perm) return true;
    return adminUser.role === 'super_admin' || adminUser.permissions[item.perm];
  });

  const needsGoogleLink =
    !firebaseUser ||
    firebaseUser.email?.toLowerCase() !== adminUser.email.toLowerCase();

  const isActive = (to: string) => {
    if (to === '/admin') return location.pathname === '/admin';
    return location.pathname.startsWith(to);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800">
          <span className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4" />
          </span>
          <span className="font-bold text-base font-display tracking-tight truncate">
            Admin Console
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}>
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {adminUser.name}
            </p>
            <p className="text-slate-500 dark:text-slate-400 truncate">{adminUser.email}</p>
            <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium capitalize mt-0.5">
              {adminUser.role.replace('_', ' ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void adminLogout()}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-64 max-w-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-base font-display">Admin Console</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}>
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => void adminLogout()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer">
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-base sm:text-lg font-bold font-display truncate">{title}</h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              to="/"
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap">
              <ExternalLink className="w-3.5 h-3.5" /> Storefront
            </Link>
            <button
              type="button"
              onClick={toggleDark}
              aria-label="Toggle dark mode"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {needsGoogleLink && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <p className="text-amber-900 dark:text-amber-200 font-medium">
              Link your authorized Google account ({adminUser.email}) to enable live Firestore catalog and order writes.
            </p>
            <button
              type="button"
              onClick={() => void adminLinkGoogleForSync()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer">
              <Link2 className="w-3.5 h-3.5" /> Link Google Sync
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
