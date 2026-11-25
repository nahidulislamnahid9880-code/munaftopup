import React, {useEffect, useState} from 'react';
import {Plus, Save, Trash2} from 'lucide-react';
import {doc, serverTimestamp, setDoc} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {useStore} from '../../contexts/StoreContext';
import {OperationType, db, handleFirestoreError} from '../../lib/firebase';
import type {SiteSettings} from '../../types';
import {ImageUploadField} from '../../components/ImageUploadField';
import {AdminLayout} from '../../components/admin/AdminLayout';

export function CustomizationManager() {
  const {adminUser} = useAuth();
  const {siteSettings} = useStore();
  const canEdit = adminUser?.role === 'super_admin' || adminUser?.permissions.customization;

  const [form, setForm] = useState<SiteSettings>(siteSettings);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    setForm(siteSettings);
  }, [siteSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !adminUser) return;
    setSaving(true);
    setSavedMsg('');
    try {
      const now = serverTimestamp();
      const payload: SiteSettings = {
        ...form,
        banners: (form.banners || []).slice(0, 10),
        promos: (form.promos || []).slice(0, 10),
        updatedAt: now,
      };
      await setDoc(doc(db, 'settings', 'site'), payload);
      const logId = `log_${Date.now()}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        id: logId,
        actorEmail: adminUser.email,
        actorRole: adminUser.role,
        action: 'SITE_CUSTOMIZATION_UPDATED',
        targetType: 'settings',
        targetId: 'site',
        details: `Updated brand, banners, promos, contact, and policies`,
        createdAt: now,
      });
      setSavedMsg('Website customization published live.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/site');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <AdminLayout title="Website Customization">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to customize website content.
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Website Customization">
      <form onSubmit={handleSave} className="space-y-6">
        {/* Branding & Notice */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <h2 className="text-base font-bold font-display">Branding, Logo, Favicon &amp; Notice</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Website Brand Name *</label>
              <input
                type="text"
                required
                value={form.brandName}
                onChange={(e) => setForm({...form, brandName: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Tagline</label>
              <input
                type="text"
                value={form.brandTagline}
                onChange={(e) => setForm({...form, brandTagline: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <ImageUploadField
              label="Website Logo"
              value={form.logoUrl}
              onChange={(url) => setForm({...form, logoUrl: url})}
            />
            <ImageUploadField
              label="Website Favicon"
              value={form.faviconUrl}
              onChange={(url) => setForm({...form, faviconUrl: url})}
            />
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={form.noticeActive}
                onChange={(e) => setForm({...form, noticeActive: e.target.checked})}
              />
              Show Top Notice &amp; Announcement Bar
            </label>
            <input
              type="text"
              value={form.noticeText}
              onChange={(e) => setForm({...form, noticeText: e.target.value})}
              placeholder="Announcement text shown across storefront..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
        </div>

        {/* Hero & Homepage Sections */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <h2 className="text-base font-bold font-display">Hero Content &amp; Homepage Sections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1">Hero Headline *</label>
              <input
                type="text"
                required
                value={form.heroTitle}
                onChange={(e) => setForm({...form, heroTitle: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1">Hero Subtitle</label>
              <input
                type="text"
                value={form.heroSubtitle}
                onChange={(e) => setForm({...form, heroSubtitle: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Hero Button Text</label>
              <input
                type="text"
                value={form.heroCtaText}
                onChange={(e) => setForm({...form, heroCtaText: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Hero Button Link</label>
              <input
                type="text"
                value={form.heroCtaLink}
                onChange={(e) => setForm({...form, heroCtaLink: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Categories Section Title</label>
              <input
                type="text"
                value={form.homepageSections?.categoriesTitle || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    homepageSections: {...form.homepageSections, categoriesTitle: e.target.value},
                  })
                }
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Products Section Title</label>
              <input
                type="text"
                value={form.homepageSections?.featuredTitle || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    homepageSections: {...form.homepageSections, featuredTitle: e.target.value},
                  })
                }
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            {(
              [
                ['showCategories', 'Show Categories'],
                ['showFeatured', 'Show Products Grid'],
                ['showPromos', 'Show Promotional Offers'],
                ['showHowItWorks', 'Show How It Works'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(form.homepageSections?.[key])}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      homepageSections: {...form.homepageSections, [key]: e.target.checked},
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Homepage Slider Banners */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold font-display">Homepage Slider Banners</h2>
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  banners: [
                    ...(form.banners || []),
                    {
                      id: `banner_${Date.now()}`,
                      title: 'New Campaign Banner',
                      subtitle: '',
                      imageUrl: '/src/assets/images/hero_battle_royale_1795604332736.jpg',
                      linkUrl: '/',
                      active: true,
                    },
                  ],
                })
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add Banner
            </button>
          </div>
          <div className="space-y-4">
            {(form.banners || []).map((banner, idx) => (
              <div
                key={banner.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={banner.active}
                      onChange={(e) => {
                        const next = [...form.banners];
                        next[idx] = {...banner, active: e.target.checked};
                        setForm({...form, banners: next});
                      }}
                    />
                    Banner #{idx + 1} Active
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        banners: form.banners.filter((_, i) => i !== idx),
                      })
                    }
                    className="text-red-600 text-xs inline-flex items-center gap-1 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={banner.title}
                    onChange={(e) => {
                      const next = [...form.banners];
                      next[idx] = {...banner, title: e.target.value};
                      setForm({...form, banners: next});
                    }}
                    placeholder="Banner Title"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={banner.subtitle}
                    onChange={(e) => {
                      const next = [...form.banners];
                      next[idx] = {...banner, subtitle: e.target.value};
                      setForm({...form, banners: next});
                    }}
                    placeholder="Banner Subtitle"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={banner.linkUrl}
                    onChange={(e) => {
                      const next = [...form.banners];
                      next[idx] = {...banner, linkUrl: e.target.value};
                      setForm({...form, banners: next});
                    }}
                    placeholder="Target Route (e.g. /product/free-fire-diamonds-bd)"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <ImageUploadField
                  label="Banner Image"
                  value={banner.imageUrl}
                  onChange={(url) => {
                    const next = [...form.banners];
                    next[idx] = {...banner, imageUrl: url};
                    setForm({...form, banners: next});
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Promotional Offers */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold font-display">Promotional Offers</h2>
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  promos: [
                    ...(form.promos || []),
                    {
                      id: `promo_${Date.now()}`,
                      title: 'New Promo Offer',
                      description: '',
                      imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg',
                      code: '',
                      discountText: 'Special Offer',
                      active: true,
                    },
                  ],
                })
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add Promo
            </button>
          </div>
          <div className="space-y-4">
            {(form.promos || []).map((promo, idx) => (
              <div
                key={promo.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={promo.active}
                      onChange={(e) => {
                        const next = [...form.promos];
                        next[idx] = {...promo, active: e.target.checked};
                        setForm({...form, promos: next});
                      }}
                    />
                    Offer #{idx + 1} Active
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        promos: form.promos.filter((_, i) => i !== idx),
                      })
                    }
                    className="text-red-600 text-xs inline-flex items-center gap-1 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    value={promo.title}
                    onChange={(e) => {
                      const next = [...form.promos];
                      next[idx] = {...promo, title: e.target.value};
                      setForm({...form, promos: next});
                    }}
                    placeholder="Title"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={promo.discountText}
                    onChange={(e) => {
                      const next = [...form.promos];
                      next[idx] = {...promo, discountText: e.target.value};
                      setForm({...form, promos: next});
                    }}
                    placeholder="Discount Label"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={promo.code}
                    onChange={(e) => {
                      const next = [...form.promos];
                      next[idx] = {...promo, code: e.target.value};
                      setForm({...form, promos: next});
                    }}
                    placeholder="Promo Code"
                    className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    value={promo.description}
                    onChange={(e) => {
                      const next = [...form.promos];
                      next[idx] = {...promo, description: e.target.value};
                      setForm({...form, promos: next});
                    }}
                    placeholder="Description"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <ImageUploadField
                  label="Offer Image"
                  value={promo.imageUrl}
                  onChange={(url) => {
                    const next = [...form.promos];
                    next[idx] = {...promo, imageUrl: url};
                    setForm({...form, promos: next});
                  }}
                  compact
                />
              </div>
            ))}
          </div>
        </div>

        {/* Contact, Socials, Footer & Legal */}
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <h2 className="text-base font-bold font-display">
            Contact, Social Media, Footer &amp; Legal Pages
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="email"
              value={form.contact.email}
              onChange={(e) => setForm({...form, contact: {...form.contact, email: e.target.value}})}
              placeholder="Support Email"
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="text"
              value={form.contact.phone}
              onChange={(e) => setForm({...form, contact: {...form.contact, phone: e.target.value}})}
              placeholder="Support Phone"
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="text"
              value={form.contact.supportHours}
              onChange={(e) =>
                setForm({...form, contact: {...form.contact, supportHours: e.target.value}})
              }
              placeholder="Support Hours"
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="text"
              value={form.socials.facebook}
              onChange={(e) =>
                setForm({...form, socials: {...form.socials, facebook: e.target.value}})
              }
              placeholder="Facebook URL"
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="text"
              value={form.socials.instagram}
              onChange={(e) =>
                setForm({...form, socials: {...form.socials, instagram: e.target.value}})
              }
              placeholder="Instagram URL"
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <input
              type="text"
              value={form.socials.discord}
              onChange={(e) =>
                setForm({...form, socials: {...form.socials, discord: e.target.value}})
              }
              placeholder="Discord URL"
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Footer Copyright Text</label>
            <input
              type="text"
              value={form.footerText}
              onChange={(e) => setForm({...form, footerText: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Terms of Service</label>
              <textarea
                rows={5}
                value={form.termsContent}
                onChange={(e) => setForm({...form, termsContent: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Privacy Policy</label>
              <textarea
                rows={5}
                value={form.privacyContent}
                onChange={(e) => setForm({...form, privacyContent: e.target.value})}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {savedMsg}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Publishing...' : 'Publish Changes Live'}
          </button>
        </div>
      </form>
    </AdminLayout>
  );
}
