import React, {useState} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  FolderPlus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {deleteDoc, doc, serverTimestamp, setDoc} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {OperationType, db, formatCurrency, handleFirestoreError} from '../../lib/firebase';
import {syncRecommendedCatalog} from '../../lib/seedData';
import type {Category, DiamondPackage, Product} from '../../types';
import {ImageUploadField} from '../../components/ImageUploadField';
import {ImageWithFallback} from '../../components/ImageWithFallback';
import {PackageVisual} from '../../components/PackageTypeIcon';
import {AdminLayout} from '../../components/admin/AdminLayout';

function slugify(val: string): string {
  return val
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `item-${Date.now()}`;
}

export function ProductsManager() {
  const {adminUser, firebaseUser, adminLinkGoogleForSync} = useAuth();
  const {products, categories} = useStore();
  const canEdit = adminUser?.role === 'super_admin' || adminUser?.permissions.products;

  const [tab, setTab] = useState<'products' | 'categories'>('products');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);

  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSyncCatalog = async () => {
    if (!adminUser || !canEdit) return;
    setSyncing(true);
    setMessage('');
    setErrorMessage('');
    try {
      const needsGoogleLink =
        !firebaseUser ||
        firebaseUser.email?.toLowerCase() !== adminUser.email.toLowerCase();
      if (needsGoogleLink) {
        await adminLinkGoogleForSync();
      }
      await syncRecommendedCatalog(adminUser.email, adminUser.role);
      setMessage('All default products and packages have been synced to Firestore.');
    } catch (err) {
      let detail = 'Failed to sync default packages.';
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message) as {error?: string};
          detail = parsed.error || err.message;
        } catch {
          detail = err.message;
        }
      }
      setErrorMessage(
        detail.includes('Missing or insufficient permissions')
          ? 'Permission denied: please click "Link Google Sync" at the top with nahidulislamnahid9880@gmail.com and try again.'
          : `Failed to sync default packages: ${detail}`,
      );
    } finally {
      setSyncing(false);
    }
  };

  const logAction = async (action: string, targetType: string, targetId: string, details: string) => {
    if (!adminUser) return;
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, 'auditLogs', logId), {
      id: logId,
      actorEmail: adminUser.email,
      actorRole: adminUser.role,
      action,
      targetType,
      targetId,
      details,
      createdAt: serverTimestamp(),
    }).catch(() => null);
  };

  const openNewProduct = () => {
    const firstCat = categories[0];
    setIsNewProduct(true);
    setEditingProduct({
      id: `prod_${Date.now()}`,
      name: '',
      slug: '',
      categoryId: firstCat?.id || '',
      categoryName: firstCat?.name || '',
      shortDescription: '',
      description: '',
      instructions: '',
      images: ['/src/assets/images/product_ff_diamonds_1795604333340.jpg'],
      requiresUid: true,
      uidLabel: 'Player UID',
      requiresServerId: false,
      serverLabel: 'Server ID',
      serverOptions: [],
      packages: [
        {
          id: `pkg_${Date.now()}`,
          name: '100 Diamonds',
          quantityLabel: '100 Diamonds',
          price: 85,
          originalPrice: 95,
          promoLabel: '',
          imageUrl: '',
          active: true,
          displayOrder: 1,
        },
      ],
      active: true,
      featured: true,
      displayOrder: products.length + 1,
    });
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !canEdit) return;
    if (!editingProduct.categoryId) {
      setMessage('Please create or select a category first.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const cat = categories.find((c) => c.id === editingProduct.categoryId);
      const cleanImages = editingProduct.images.map((i) => i.trim()).filter(Boolean);
      if (cleanImages.length === 0) {
        cleanImages.push('/src/assets/images/product_ff_diamonds_1795604333340.jpg');
      }
      const cleanPackages = editingProduct.packages.map((pkg, idx) => ({
        ...pkg,
        price: Number(pkg.price) || 0,
        originalPrice: Number(pkg.originalPrice) || Number(pkg.price) || 0,
        costPrice: Math.max(0, Number(pkg.costPrice) || 0),
        displayOrder: Number(pkg.displayOrder) || idx + 1,
      }));
      if (cleanPackages.length === 0) {
        setMessage('A product must have at least one package.');
        setSaving(false);
        return;
      }

      const now = serverTimestamp();
      const payload: Product = {
        ...editingProduct,
        slug: slugify(editingProduct.slug || editingProduct.name),
        categoryName: cat?.name || editingProduct.categoryName || 'Top-Up',
        images: cleanImages.slice(0, 10),
        packages: cleanPackages.slice(0, 60),
        displayOrder: Number(editingProduct.displayOrder) || 1,
        createdAt: isNewProduct ? now : editingProduct.createdAt || now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'products', payload.id), payload);
      await logAction(
        isNewProduct ? 'PRODUCT_CREATED' : 'PRODUCT_UPDATED',
        'product',
        payload.id,
        `${payload.name} (${payload.packages.length} packages)`,
      );
      setEditingProduct(null);
      setMessage('Product saved and synced to storefront.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `products/${editingProduct.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (p: Product) => {
    if (!canEdit) return;
    try {
      await deleteDoc(doc(db, 'products', p.id));
      await logAction('PRODUCT_DELETED', 'product', p.id, `Deleted product ${p.name}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `products/${p.id}`);
    }
  };

  const handleToggleProductActive = async (p: Product) => {
    if (!canEdit) return;
    try {
      await setDoc(doc(db, 'products', p.id), {
        ...p,
        active: !p.active,
        updatedAt: serverTimestamp(),
      });
      await logAction('PRODUCT_TOGGLED', 'product', p.id, `${p.name} active=${!p.active}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `products/${p.id}`);
    }
  };

  const handleMoveOrder = async (p: Product, delta: number) => {
    if (!canEdit) return;
    try {
      await setDoc(doc(db, 'products', p.id), {
        ...p,
        displayOrder: Math.max(0, Number(p.displayOrder || 1) + delta),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `products/${p.id}`);
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !canEdit) return;
    setSaving(true);
    try {
      const payload: Category = {
        ...editingCategory,
        slug: slugify(editingCategory.slug || editingCategory.name),
        displayOrder: Number(editingCategory.displayOrder) || 1,
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'categories', payload.id), payload);
      await logAction(
        isNewCategory ? 'CATEGORY_CREATED' : 'CATEGORY_UPDATED',
        'category',
        payload.id,
        payload.name,
      );
      setEditingCategory(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `categories/${editingCategory.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (c: Category) => {
    if (!canEdit) return;
    try {
      await deleteDoc(doc(db, 'categories', c.id));
      await logAction('CATEGORY_DELETED', 'category', c.id, c.name);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `categories/${c.id}`);
    }
  };

  const updatePackage = (idx: number, patch: Partial<DiamondPackage>) => {
    if (!editingProduct) return;
    const next = [...editingProduct.packages];
    next[idx] = {...next[idx], ...patch};
    setEditingProduct({...editingProduct, packages: next});
  };

  const addPackage = () => {
    if (!editingProduct) return;
    setEditingProduct({
      ...editingProduct,
      packages: [
        ...editingProduct.packages,
        {
          id: `pkg_${Date.now()}`,
          name: 'New Package',
          quantityLabel: 'Diamonds',
          price: 100,
          originalPrice: 110,
          promoLabel: '',
          imageUrl: '',
          active: true,
          displayOrder: editingProduct.packages.length + 1,
        },
      ],
    });
  };

  const removePackage = (idx: number) => {
    if (!editingProduct || editingProduct.packages.length <= 1) return;
    setEditingProduct({
      ...editingProduct,
      packages: editingProduct.packages.filter((_, i) => i !== idx),
    });
  };

  if (!canEdit) {
    return (
      <AdminLayout title="Products & Packages">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to manage products.
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Products & Diamond Packages">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('products')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'products'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Products ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('categories')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'categories'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}>
              Categories ({categories.length})
            </button>
          </div>

          {tab === 'products' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSyncCatalog()}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync Default Packages'}
              </button>
              <button
                type="button"
                onClick={openNewProduct}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsNewCategory(true);
                setEditingCategory({
                  id: `cat_${Date.now()}`,
                  name: '',
                  slug: '',
                  description: '',
                  imageUrl: '',
                  displayOrder: categories.length + 1,
                  active: true,
                });
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
              <FolderPlus className="w-4 h-4" /> Add Category
            </button>
          )}
        </div>

        {message && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {/* Products List */}
        {tab === 'products' && !editingProduct && (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Packages</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 tabular-nums">
                          <button
                            type="button"
                            onClick={() => void handleMoveOrder(p, -1)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-mono w-5 text-center">{p.displayOrder}</span>
                          <button
                            type="button"
                            onClick={() => void handleMoveOrder(p, 1)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-9 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                            <ImageWithFallback
                              src={p.images?.[0]}
                              alt={p.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div>
                            <p className="font-semibold">{p.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">/{p.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{p.categoryName}</td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {p.packages.length} packs · from{' '}
                        {formatCurrency(Math.min(...p.packages.map((k) => k.price)))}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void handleToggleProductActive(p)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                            p.active
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                          {p.active ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setIsNewProduct(false);
                            setEditingProduct(p);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer">
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteProduct(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Product Editor Form */}
        {tab === 'products' && editingProduct && (
          <form
            onSubmit={handleSaveProduct}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <h2 className="text-lg font-bold font-display">
                {isNewProduct ? 'Add New Product' : `Edit Product: ${editingProduct.name}`}
              </h2>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({...editingProduct, name: e.target.value})}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">URL Slug</label>
                <input
                  type="text"
                  value={editingProduct.slug}
                  onChange={(e) => setEditingProduct({...editingProduct, slug: e.target.value})}
                  placeholder="auto-generated-from-name"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Category *</label>
                <select
                  value={editingProduct.categoryId}
                  onChange={(e) => setEditingProduct({...editingProduct, categoryId: e.target.value})}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Display Order</label>
                <input
                  type="number"
                  min={0}
                  value={editingProduct.displayOrder}
                  onChange={(e) =>
                    setEditingProduct({...editingProduct, displayOrder: Number(e.target.value)})
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">Short Description</label>
                <input
                  type="text"
                  value={editingProduct.shortDescription}
                  onChange={(e) =>
                    setEditingProduct({...editingProduct, shortDescription: e.target.value})
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">Full Description</label>
                <textarea
                  rows={3}
                  value={editingProduct.description}
                  onChange={(e) => setEditingProduct({...editingProduct, description: e.target.value})}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">Order Instructions</label>
                <textarea
                  rows={3}
                  value={editingProduct.instructions}
                  onChange={(e) => setEditingProduct({...editingProduct, instructions: e.target.value})}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            {/* UID & Server Settings */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProduct.requiresUid}
                    onChange={(e) =>
                      setEditingProduct({...editingProduct, requiresUid: e.target.checked})
                    }
                  />
                  Require Player UID at Checkout
                </label>
                <input
                  type="text"
                  value={editingProduct.uidLabel}
                  onChange={(e) => setEditingProduct({...editingProduct, uidLabel: e.target.value})}
                  placeholder="Player UID Label"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProduct.requiresServerId}
                    onChange={(e) =>
                      setEditingProduct({...editingProduct, requiresServerId: e.target.checked})
                    }
                  />
                  Require Server / Zone ID
                </label>
                <input
                  type="text"
                  value={editingProduct.serverLabel}
                  onChange={(e) => setEditingProduct({...editingProduct, serverLabel: e.target.value})}
                  placeholder="Server Label (e.g. Server Region)"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <input
                  type="text"
                  value={(editingProduct.serverOptions || []).join(', ')}
                  onChange={(e) =>
                    setEditingProduct({
                      ...editingProduct,
                      serverOptions: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Comma-separated server options (optional)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            {/* Multiple Product Images */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Product Images (Multi-Image Gallery)</h3>
                <button
                  type="button"
                  onClick={() =>
                    setEditingProduct({
                      ...editingProduct,
                      images: [...editingProduct.images, ''],
                    })
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add Image Slot
                </button>
              </div>
              <div className="space-y-3">
                {editingProduct.images.map((imgUrl, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="flex-1">
                      <ImageUploadField
                        label={`Image #${idx + 1}`}
                        value={imgUrl}
                        onChange={(url) => {
                          const next = [...editingProduct.images];
                          next[idx] = url;
                          setEditingProduct({...editingProduct, images: next});
                        }}
                      />
                    </div>
                    {editingProduct.images.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingProduct({
                            ...editingProduct,
                            images: editingProduct.images.filter((_, i) => i !== idx),
                          })
                        }
                        className="mb-1 p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Diamond Packages Builder */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Diamond / Top-Up Packages</h3>
                <button
                  type="button"
                  onClick={addPackage}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add Package
                </button>
              </div>

              <div className="space-y-4">
                {editingProduct.packages.map((pkg, idx) => (
                  <div
                    key={pkg.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/50">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <PackageVisual pkg={pkg} size="md" />
                        <div>
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                            Package #{idx + 1} · {pkg.name || 'Untitled'}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {pkg.imageUrl ? 'Using custom uploaded logo' : 'Using default package icon'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pkg.active}
                            onChange={(e) => updatePackage(idx, {active: e.target.checked})}
                          />
                          Active
                        </label>
                        {editingProduct.packages.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePackage(idx)}
                            className="text-red-600 text-xs font-medium hover:underline cursor-pointer">
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Package Name</label>
                        <input
                          type="text"
                          required
                          value={pkg.name}
                          onChange={(e) => updatePackage(idx, {name: e.target.value})}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Quantity Label</label>
                        <input
                          type="text"
                          value={pkg.quantityLabel}
                          onChange={(e) => updatePackage(idx, {quantityLabel: e.target.value})}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Sale Price (৳)</label>
                        <input
                          type="number"
                          min={0}
                          required
                          value={pkg.price}
                          onChange={(e) => updatePackage(idx, {price: Number(e.target.value)})}
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Regular Price (৳)</label>
                        <input
                          type="number"
                          min={0}
                          value={pkg.originalPrice}
                          onChange={(e) => updatePackage(idx, {originalPrice: Number(e.target.value)})}
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Cost Price (৳, Optional)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={pkg.costPrice ?? ''}
                          placeholder="For profit analytics"
                          onChange={(e) =>
                            updatePackage(idx, {
                              costPrice: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Bonus Label</label>
                        <input
                          type="text"
                          value={pkg.bonusLabel || ''}
                          onChange={(e) => updatePackage(idx, {bonusLabel: e.target.value})}
                          placeholder="e.g. +25 Bonus"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Promo Label</label>
                        <input
                          type="text"
                          value={pkg.promoLabel}
                          onChange={(e) => updatePackage(idx, {promoLabel: e.target.value})}
                          placeholder="e.g. Save 10%"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Highlight Tag</label>
                        <select
                          value={pkg.badgeType || ''}
                          onChange={(e) =>
                            updatePackage(idx, {
                              badgeType: e.target.value as '' | 'popular' | 'best_selling',
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
                          <option value="">None</option>
                          <option value="popular">Popular</option>
                          <option value="best_selling">Best Selling</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium mb-1">Default Icon Style</label>
                        <select
                          value={pkg.iconType || 'auto'}
                          onChange={(e) =>
                            updatePackage(idx, {
                              iconType: e.target.value as
                                | 'auto'
                                | 'diamond'
                                | 'weekly'
                                | 'monthly'
                                | 'levelup'
                                | 'evo'
                                | 'special',
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
                          <option value="auto">Auto Detect</option>
                          <option value="diamond">Diamond Package</option>
                          <option value="weekly">Weekly Membership</option>
                          <option value="monthly">Monthly Membership</option>
                          <option value="levelup">Level Up Pass</option>
                          <option value="evo">Evo Access / Voucher</option>
                          <option value="special">Special Package</option>
                        </select>
                      </div>
                    </div>

                    <ImageUploadField
                      label="Custom Package Logo / Icon (Upload, Change or Remove · JPG/PNG/WEBP/GIF/ICO max 5MB)"
                      value={pkg.imageUrl}
                      onChange={(url) => updatePackage(idx, {imageUrl: url})}
                      compact
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProduct.active}
                    onChange={(e) => setEditingProduct({...editingProduct, active: e.target.checked})}
                  />
                  Product Enabled
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProduct.featured}
                    onChange={(e) =>
                      setEditingProduct({...editingProduct, featured: e.target.checked})
                    }
                  />
                  Featured on Homepage
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Categories Manager */}
        {tab === 'categories' && (
          <div className="space-y-6">
            {editingCategory && (
              <form
                onSubmit={handleSaveCategory}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <h2 className="text-base font-bold font-display">
                  {isNewCategory ? 'New Category' : `Edit Category: ${editingCategory.name}`}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">Category Name *</label>
                    <input
                      type="text"
                      required
                      value={editingCategory.name}
                      onChange={(e) =>
                        setEditingCategory({...editingCategory, name: e.target.value})
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Slug</label>
                    <input
                      type="text"
                      value={editingCategory.slug}
                      onChange={(e) =>
                        setEditingCategory({...editingCategory, slug: e.target.value})
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Display Order</label>
                    <input
                      type="number"
                      min={0}
                      value={editingCategory.displayOrder}
                      onChange={(e) =>
                        setEditingCategory({
                          ...editingCategory,
                          displayOrder: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>
                <ImageUploadField
                  label="Category Image"
                  value={editingCategory.imageUrl}
                  onChange={(url) => setEditingCategory({...editingCategory, imageUrl: url})}
                />
                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingCategory.active}
                      onChange={(e) =>
                        setEditingCategory({...editingCategory, active: e.target.checked})
                      }
                    />
                    Active
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingCategory(null)}
                      className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer">
                      Save Category
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                      <ImageWithFallback src={c.imageUrl} alt={c.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{c.name}</p>
                      <p className="text-xs text-slate-500">
                        Order {c.displayOrder} · {c.active ? 'Active' : 'Hidden'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setIsNewCategory(false);
                        setEditingCategory(c);
                      }}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCategory(c)}
                      className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
