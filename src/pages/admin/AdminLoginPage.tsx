import React, {useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Lock,
  Moon,
  Shield,
  Sun,
} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useTheme} from '../../contexts/ThemeContext';

interface AuthStatus {
  claimed: boolean;
  hasEnvPasscode: boolean;
  superAdminEmail: string;
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const {
    adminUser,
    adminAuthLoading,
    adminLoginWithGoogle,
    adminLoginWithPassword,
    adminClaimPassword,
  } = useAuth();
  const {dark, toggleDark} = useTheme();

  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [mode, setMode] = useState<'login' | 'claim'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('Primary Administrator');
  const [error, setError] = useState('');

  useEffect(() => {
    if (adminUser) {
      navigate('/admin', {replace: true});
    }
  }, [adminUser, navigate]);

  useEffect(() => {
    fetch('/api/admin/auth/status')
      .then((r) => r.json())
      .then((data: AuthStatus) => {
        setStatus(data);
        if (!data.claimed && !data.hasEnvPasscode) {
          setEmail(data.superAdminEmail || '');
        }
      })
      .catch(() => null);
  }, []);

  const handleGoogleLogin = async () => {
    setError('');
    try {
      await adminLoginWithGoogle();
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Admin sign-in failed');
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'claim') {
        await adminClaimPassword(email, password, name);
      } else {
        await adminLoginWithPassword(email, password);
      }
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const canClaimFirstRun = status && !status.claimed && !status.hasEnvPasscode;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Storefront
        </Link>
        <button
          type="button"
          onClick={toggleDark}
          aria-label="Toggle theme"
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer">
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <div className="max-w-md w-full mx-auto my-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-7 space-y-6">
        <div className="space-y-2 text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center mx-auto">
            <Shield className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold font-display">Admin Console Access</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Authorized administrators and sub-admins only. Customer accounts cannot access this portal.
          </p>
        </div>

        {/* Primary Google Admin Auth */}
        <button
          type="button"
          disabled={adminAuthLoading}
          onClick={() => void handleGoogleLogin()}
          className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50">
          <KeyRound className="w-4 h-4" />
          {adminAuthLoading ? 'Verifying...' : 'Sign in with Authorized Google Account'}
        </button>

        <div className="relative flex items-center">
          <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
          <span className="px-3 text-[11px] font-medium text-slate-400">or use admin credentials</span>
          <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
        </div>

        {canClaimFirstRun && (
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}>
              Staff Login
            </button>
            <button
              type="button"
              onClick={() => setMode('claim')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                mode === 'claim'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}>
              First-Run Password Setup
            </button>
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {mode === 'claim' && canClaimFirstRun && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Administrator Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Admin Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={status?.superAdminEmail || 'admin@example.com'}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {mode === 'claim' ? 'Create Admin Password (min 8 chars)' : 'Password / Passcode'}
            </label>
            <input
              type="password"
              required
              minLength={mode === 'claim' ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 p-3 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={adminAuthLoading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50">
            <Lock className="w-4 h-4" />
            {mode === 'claim' ? 'Claim & Set Admin Password' : 'Sign In with Password'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-slate-500 dark:text-slate-500">
        Role-based server &amp; database enforcement active
      </p>
    </div>
  );
}
