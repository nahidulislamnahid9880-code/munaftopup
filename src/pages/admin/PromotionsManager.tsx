import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Flame,
  KeyRound,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {useToast} from '../../contexts/ToastContext';
import {OperationType, db, formatCurrency, handleFirestoreError} from '../../lib/firebase';
import type {Coupon, FlashSale} from '../../types';
import {AdminLayout} from '../../components/admin/AdminLayout';

interface VoucherVaultItem {
  id: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  maskedCode: string;
  status: 'unused' | 'claimed';
  claimedOrderNumber?: string;
  createdAtIso: string;
}

export function PromotionsManager() {
  const {adminUser, firebaseUser, adminFetch} = useAuth();
  const {products} = useStore();
  const {showToast} = useToast();
  const canEdit =
    adminUser?.role === 'super_admin' ||
    adminUser?.permissions.products ||
    adminUser?.permissions.customization;
  const canVault =
    adminUser?.role === 'super_admin' ||
    adminUser?.permissions.products ||
    adminUser?.permissions.orders;

  const [tab, setTab] = useState<'coupons' | 'flash' | 'vault'>('coupons');

  // Coupons state
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponTitle, setCouponTitle] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('10');
  const [minOrderAmount, setMinOrderAmount] = useState('100');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState('150');
  const [usageLimit, setUsageLimit] = useState('100');
  const [perUserLimit, setPerUserLimit] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [savingCoupon, setSavingCoupon] = useState(false);

  // Flash Sales state
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [flashProductId, setFlashProductId] = useState('');
  const [flashTitle, setFlashTitle] = useState('');
  const [flashDiscountPercent, setFlashDiscountPercent] = useState('15');
  const [flashBadgeText, setFlashBadgeText] = useState('FLASH DEAL');
  const [flashStartsAt, setFlashStartsAt] = useState('');
  const [flashEndsAt, setFlashEndsAt] = useState('');
  const [savingFlash, setSavingFlash] = useState(false);

  // Voucher Vault state
  const [vaultItems, setVaultItems] = useState<VoucherVaultItem[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultProductId, setVaultProductId] = useState('');
  const [vaultPackageId, setVaultPackageId] = useState('');
  const [vaultCodesText, setVaultCodesText] = useState('');
  const [vaultUploading, setVaultUploading] = useState(false);

  useEffect(() => {
    if (!products.length) return;
    setFlashProductId((prev) => prev || products[0].id);
    setVaultProductId((prev) => prev || products[0].id);
  }, [products]);

  const selectedVaultProduct = useMemo(
    () => products.find((p) => p.id === vaultProductId) || products[0],
    [products, vaultProductId],
  );

  useEffect(() => {
    if (!selectedVaultProduct?.packages.length) return;
    setVaultPackageId((prev) =>
      selectedVaultProduct.packages.some((k) => k.id === prev)
        ? prev
        : selectedVaultProduct.packages[0].id,
    );
  }, [selectedVaultProduct]);

  useEffect(() => {
    if (!firebaseUser || !canEdit) return;
    const unsubCoupons = onSnapshot(
      query(collection(db, 'coupons'), orderBy('createdAt', 'desc')),
      (snap) => setCoupons(snap.docs.map((d) => d.data() as Coupon)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'coupons'),
    );
    const unsubFlash = onSnapshot(
      query(collection(db, 'flashSales'), orderBy('createdAt', 'desc')),
      (snap) => setFlashSales(snap.docs.map((d) => d.data() as FlashSale)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'flashSales'),
    );
    return () => {
      unsubCoupons();
      unsubFlash();
    };
  }, [firebaseUser, canEdit]);

  const loadVault = useCallback(async () => {
    if (!canVault) return;
    setVaultLoading(true);
    try {
      const res = await adminFetch('/api/admin/voucher-stock');
      if (res.ok) {
        const data = (await res.json()) as {items?: VoucherVaultItem[]};
        setVaultItems(data.items || []);
      }
    } catch {
      // ignore initial error
    } finally {
      setVaultLoading(false);
    }
  }, [adminFetch, canVault]);

  useEffect(() => {
    if (tab === 'vault') {
      void loadVault();
    }
  }, [tab, loadVault]);

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !adminUser) return;
    const normalized = couponCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (normalized.length < 2) {
      showToast('Coupon code must be at least 2 alphanumeric characters.', 'error');
      return;
    }
    setSavingCoupon(true);
    try {
      const id = `cpn_${normalized}`;
      const now = serverTimestamp();
      await setDoc(doc(db, 'coupons', id), {
        id,
        code: normalized,
        title: (couponTitle.trim() || `${normalized} Promo`).slice(0, 120),
        discountType,
        discountValue: Math.max(1, Number(discountValue) || 10),
        minOrderAmount: Math.max(0, Number(minOrderAmount) || 0),
        maxDiscountAmount: Math.max(0, Number(maxDiscountAmount) || 0),
        usageLimit: Math.max(0, Math.round(Number(usageLimit) || 0)),
        perUserLimit: Math.max(0, Math.round(Number(perUserLimit) || 0)),
        usedCount: 0,
        active: true,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : '',
        createdAt: now,
        updatedAt: now,
      });
      setCouponCode('');
      setCouponTitle('');
      showToast(`Coupon ${normalized} created.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'coupons');
      showToast('Failed to save coupon.', 'error');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleToggleCoupon = async (c: Coupon) => {
    if (!canEdit) return;
    try {
      await setDoc(doc(db, 'coupons', c.id), {
        ...c,
        active: !c.active,
        createdAt: c.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `coupons/${c.id}`);
    }
  };

  const handleDeleteCoupon = async (c: Coupon) => {
    if (!canEdit) return;
    try {
      await deleteDoc(doc(db, 'coupons', c.id));
      showToast(`Deleted coupon ${c.code}.`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `coupons/${c.id}`);
    }
  };

  const handleCreateFlashSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    const prod = products.find((p) => p.id === flashProductId);
    if (!prod) {
      showToast('Please select a product.', 'error');
      return;
    }
    const pct = Number(flashDiscountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
      showToast('Discount percent must be between 1 and 90.', 'error');
      return;
    }
    setSavingFlash(true);
    try {
      const id = `fs_${Date.now()}`;
      const now = serverTimestamp();
      await setDoc(doc(db, 'flashSales', id), {
        id,
        title: (flashTitle.trim() || `${prod.name} Flash Deal`).slice(0, 120),
        productId: prod.id,
        productName: prod.name.slice(0, 120),
        discountPercent: pct,
        badgeText: (flashBadgeText.trim() || 'FLASH DEAL').slice(0, 40),
        startsAt: flashStartsAt ? new Date(flashStartsAt).toISOString() : '',
        endsAt: flashEndsAt ? new Date(flashEndsAt).toISOString() : '',
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      setFlashTitle('');
      showToast(`Flash sale launched for ${prod.name}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'flashSales');
      showToast('Failed to save flash sale.', 'error');
    } finally {
      setSavingFlash(false);
    }
  };

  const handleToggleFlash = async (fs: FlashSale) => {
    if (!canEdit) return;
    try {
      await setDoc(doc(db, 'flashSales', fs.id), {
        ...fs,
        active: !fs.active,
        createdAt: fs.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `flashSales/${fs.id}`);
    }
  };

  const handleDeleteFlash = async (fs: FlashSale) => {
    if (!canEdit) return;
    try {
      await deleteDoc(doc(db, 'flashSales', fs.id));
      showToast('Flash sale deleted.', 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `flashSales/${fs.id}`);
    }
  };

  const handleUploadVaultCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canVault || !selectedVaultProduct) return;
    const pkg = selectedVaultProduct.packages.find((k) => k.id === vaultPackageId);
    if (!pkg) {
      showToast('Please select a package.', 'error');
      return;
    }
    if (!vaultCodesText.trim()) {
      showToast('Paste at least one voucher PIN (one per line).', 'error');
      return;
    }
    setVaultUploading(true);
    try {
      const res = await adminFetch('/api/admin/voucher-stock/bulk', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          productId: selectedVaultProduct.id,
          productName: selectedVaultProduct.name,
          packageId: pkg.id,
          packageName: pkg.name,
          codesText: vaultCodesText,
        }),
      });
      const data = (await res.json()) as {ok?: boolean; addedCount?: number; error?: string};
      if (!res.ok || !data.ok) {
        showToast(data.error || 'Failed to upload voucher PINs.', 'error');
        return;
      }
      setVaultCodesText('');
      showToast(`Added ${data.addedCount || 0} encrypted voucher PIN(s) to vault.`, 'success');
      void loadVault();
    } catch {
      showToast('Network error uploading PINs.', 'error');
    } finally {
      setVaultUploading(false);
    }
  };

  const handleDeleteVaultItem = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/voucher-stock/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setVaultItems((prev) => prev.filter((item) => item.id !== id));
        showToast('Removed unused PIN from vault.', 'info');
      } else {
        const d = (await res.json().catch(() => ({}))) as {error?: string};
        showToast(d.error || 'Could not remove PIN.', 'error');
      }
    } catch {
      showToast('Network error removing PIN.', 'error');
    }
  };

  const unusedVaultByPackage = useMemo(() => {
    const counts = new Map<string, {productName: string; packageName: string; count: number}>();
    for (const item of vaultItems) {
      if (item.status !== 'unused') continue;
      const key = `${item.productId}::${item.packageId}`;
      const prev = counts.get(key) || {
        productName: item.productName,
        packageName: item.packageName,
        count: 0,
      };
      prev.count += 1;
      counts.set(key, prev);
    }
    return Array.from(counts.values());
  }, [vaultItems]);

  if (!canEdit && !canVault) {
    return (
      <AdminLayout title="Promos, Flash Sales & PIN Vault">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to manage promotions or voucher vault stock.
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Promos, Flash Sales & PIN Vault">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl w-fit">
          {canEdit && (
            <button
              type="button"
              onClick={() => setTab('coupons')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'coupons'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              <Tag className="w-3.5 h-3.5" /> Promo Coupons ({coupons.length})
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setTab('flash')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'flash'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              <Flame className="w-3.5 h-3.5" /> Flash Sales ({flashSales.length})
            </button>
          )}
          {canVault && (
            <button
              type="button"
              onClick={() => setTab('vault')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'vault'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              <KeyRound className="w-3.5 h-3.5" /> Voucher PIN Vault
            </button>
          )}
        </div>

        {/* Coupons Tab */}
        {tab === 'coupons' && canEdit && (
          <div className="space-y-6">
            <form
              onSubmit={handleCreateCoupon}
              className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <h2 className="text-base font-bold font-display flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-600" /> Create Promo Coupon
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Coupon Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="EID2026"
                    className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Promo Title
                  </label>
                  <input
                    type="text"
                    value={couponTitle}
                    onChange={(e) => setCouponTitle(e.target.value)}
                    placeholder="Eid Special 10% Off"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Discount Type
                  </label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed Amount (৳)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Discount Value *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Min Order (৳)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minOrderAmount}
                    onChange={(e) => setMinOrderAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Max Discount Cap (৳, 0=none)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={maxDiscountAmount}
                    onChange={(e) => setMaxDiscountAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Total Uses Limit (0=∞)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={usageLimit}
                    onChange={(e) => setUsageLimit(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Per Customer Limit (0=∞)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={perUserLimit}
                    onChange={(e) => setPerUserLimit(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Expires At (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingCoupon}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                <Plus className="w-4 h-4" /> {savingCoupon ? 'Saving...' : 'Create Coupon'}
              </button>
            </form>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Code</th>
                      <th className="px-4 py-3 font-medium">Discount</th>
                      <th className="px-4 py-3 font-medium">Conditions</th>
                      <th className="px-4 py-3 font-medium">Usage</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {coupons.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            {c.code}
                          </span>
                          <p className="text-xs text-slate-500">{c.title}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums">
                          {c.discountType === 'percent'
                            ? `${c.discountValue}%${c.maxDiscountAmount ? ` (max ৳${c.maxDiscountAmount})` : ''}`
                            : formatCurrency(c.discountValue)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          Min ৳{c.minOrderAmount} · Per user: {c.perUserLimit || '∞'}
                          {c.expiresAt && (
                            <span className="block">
                              Ends: {new Date(c.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono tabular-nums">
                          {c.usedCount} / {c.usageLimit || '∞'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void handleToggleCoupon(c)}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                              c.active
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                            }`}>
                            {c.active ? 'Active' : 'Paused'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteCoupon(c)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {coupons.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                          No promo coupons created yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Flash Sales Tab */}
        {tab === 'flash' && canEdit && (
          <div className="space-y-6">
            <form
              onSubmit={handleCreateFlashSale}
              className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <h2 className="text-base font-bold font-display flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" /> Schedule Flash Sale Deal
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Target Product *
                  </label>
                  <select
                    value={flashProductId}
                    onChange={(e) => setFlashProductId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Flash Sale Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={flashTitle}
                    onChange={(e) => setFlashTitle(e.target.value)}
                    placeholder="Midnight Diamond Blast"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Discount Percent (1-90%) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={90}
                    value={flashDiscountPercent}
                    onChange={(e) => setFlashDiscountPercent(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Badge Text
                  </label>
                  <input
                    type="text"
                    value={flashBadgeText}
                    onChange={(e) => setFlashBadgeText(e.target.value)}
                    placeholder="FLASH DEAL"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Starts At (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={flashStartsAt}
                    onChange={(e) => setFlashStartsAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Ends At (Countdown Target)
                  </label>
                  <input
                    type="datetime-local"
                    value={flashEndsAt}
                    onChange={(e) => setFlashEndsAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingFlash}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                <Flame className="w-4 h-4" /> {savingFlash ? 'Launching...' : 'Launch Flash Sale'}
              </button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {flashSales.map((fs) => (
                <div
                  key={fs.id}
                  className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 text-[10px] font-bold">
                        -{fs.discountPercent}% OFF · {fs.badgeText}
                      </span>
                      <span className="text-xs font-semibold truncate">{fs.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Product: {fs.productName}</p>
                    <p className="text-[11px] text-slate-400">
                      {fs.endsAt ? `Ends ${new Date(fs.endsAt).toLocaleString()}` : 'No end countdown'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleFlash(fs)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        fs.active
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                      }`}>
                      {fs.active ? 'Live' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteFlash(fs)}
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {flashSales.length === 0 && (
                <div className="md:col-span-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
                  No flash sales configured yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Voucher PIN Vault Tab */}
        {tab === 'vault' && canVault && (
          <div className="space-y-6">
            <form
              onSubmit={handleUploadVaultCodes}
              className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold font-display flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-emerald-600" /> Bulk Upload Voucher / Redeem PINs
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    PINs stored here are automatically claimed and delivered to customers when an order for that package is verified by SMS, Wallet, or Gateway.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadVault()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                  <RefreshCw className={`w-3.5 h-3.5 ${vaultLoading ? 'animate-spin' : ''}`} /> Refresh
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Product
                  </label>
                  <select
                    value={vaultProductId}
                    onChange={(e) => setVaultProductId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Package
                  </label>
                  <select
                    value={vaultPackageId}
                    onChange={(e) => setVaultPackageId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                    {(selectedVaultProduct?.packages || []).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} (৳{k.price})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Voucher Codes / PINs (one per line)
                </label>
                <textarea
                  rows={4}
                  value={vaultCodesText}
                  onChange={(e) => setVaultCodesText(e.target.value)}
                  placeholder={'BDMB-Q-S-03861208-XXXX\nBDMB-Q-S-03861209-YYYY'}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <button
                type="submit"
                disabled={vaultUploading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                <Upload className="w-4 h-4" /> {vaultUploading ? 'Uploading...' : 'Add PINs to Vault'}
              </button>
            </form>

            {unusedVaultByPackage.length > 0 && (
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap gap-2">
                {unusedVaultByPackage.map((entry) => (
                  <span
                    key={`${entry.productName}_${entry.packageName}`}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border ${
                      entry.count <= 3
                        ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300'
                    }`}>
                    {entry.productName} · {entry.packageName}: {entry.count} PIN(s) left
                  </span>
                ))}
              </div>
            )}

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Masked PIN</th>
                      <th className="px-4 py-3 font-medium">Product / Package</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Claimed Order</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {vaultItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 font-mono font-semibold text-xs">
                          {item.maskedCode}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-semibold block">{item.productName}</span>
                          <span className="text-slate-500">{item.packageName}</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          {item.status === 'unused' ? (
                            <span className="text-emerald-600">Unused</span>
                          ) : (
                            <span className="text-slate-500">Claimed</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {item.claimedOrderNumber || '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {item.status === 'unused' && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteVaultItem(item.id)}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {vaultItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                          {vaultLoading ? 'Loading PIN vault...' : 'No voucher PINs uploaded yet.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
