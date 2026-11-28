import React, {useEffect, useMemo, useState} from 'react';
import {collection, onSnapshot, query, where} from 'firebase/firestore';
import {CheckCircle2, MessageSquarePlus, ShieldCheck, Star, X} from 'lucide-react';
import {useAuth} from '../../contexts/AuthContext';
import {useLanguage} from '../../contexts/LanguageContext';
import {useToast} from '../../contexts/ToastContext';
import {auth, db} from '../../lib/firebase';
import type {CustomerReview} from '../../types';

function parseReviewDate(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val instanceof Date) return val.getTime();
  if (typeof (val as {toMillis?: () => number}).toMillis === 'function') {
    return (val as {toMillis: () => number}).toMillis();
  }
  return 0;
}

export function WriteReviewModal({
  productId,
  productName,
  packageName,
  orderNumber,
  onClose,
}: {
  productId?: string;
  productName?: string;
  packageName?: string;
  orderNumber?: string;
  onClose: () => void;
}) {
  const {firebaseUser, customerProfile, signInCustomerWithGoogle} = useAuth();
  const {lang} = useLanguage();
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      await signInCustomerWithGoogle();
      return;
    }
    if (comment.trim().length < 4) {
      toast.error(lang === 'bn' ? 'অন্তত ৪ অক্ষরের একটি রিভিউ লিখুন' : 'Please write at least 4 characters');
      return;
    }
    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        toast.error('Please sign in first.');
        return;
      }
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          rating,
          comment: comment.trim(),
          productId: productId || '',
          productName: productName || 'MUNAFTOPUP.bd Service',
          packageName: packageName || '',
          orderNumber: orderNumber || '',
          customerName: customerProfile?.displayName || firebaseUser.displayName || 'Verified Gamer',
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {ok?: boolean; message?: string; error?: string};
      if (!res.ok) {
        toast.error(json.error || 'Could not submit review');
        return;
      }
      toast.success(json.message || 'Review submitted!');
      onClose();
    } catch {
      toast.error('Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white font-display">
              {lang === 'bn' ? 'সার্ভিস রিভিউ ও রেটিং দিন' : 'Rate & Review Our Service'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {productName || 'MUNAFTOPUP.bd'}
              {packageName ? ` · ${packageName}` : ''}
              {orderNumber ? ` (#${orderNumber})` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {lang === 'bn' ? 'স্টার রেটিং সিলেক্ট করুন' : 'Select Rating'}
            </p>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="p-1 cursor-pointer transition-transform hover:scale-110">
                  <Star
                    className={`w-7 h-7 ${
                      star <= rating
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-slate-300 dark:text-slate-700'
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm font-bold text-slate-700 dark:text-slate-200">{rating}/5</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {lang === 'bn' ? 'আপনার অভিজ্ঞতা লিখুন' : 'Your Feedback'}
            </label>
            <textarea
              rows={3}
              required
              minLength={4}
              maxLength={800}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                lang === 'bn'
                  ? 'টপ-আপ কত দ্রুত পেলেন এবং সার্ভিস কেমন লাগল লিখুন...'
                  : 'Tell other gamers about delivery speed & payment experience...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
              {lang === 'bn' ? 'বাতিল' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
              {!firebaseUser
                ? lang === 'bn'
                  ? 'সাইন ইন করে রিভিউ দিন'
                  : 'Sign In & Submit'
                : submitting
                  ? lang === 'bn'
                    ? 'পাঠানো হচ্ছে...'
                    : 'Submitting...'
                  : lang === 'bn'
                    ? 'রিভিউ সাবমিট করুন'
                    : 'Submit Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ReviewsSection({
  productId,
  productName,
  initialLimit = 9,
}: {
  productId?: string;
  productName?: string;
  initialLimit?: number;
}) {
  const {lang} = useLanguage();
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [starFilter, setStarFilter] = useState<number>(0);
  const [visibleCount, setVisibleCount] = useState(initialLimit);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'reviews'), where('approved', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const data = d.data() as CustomerReview;
            return {
              ...data,
              createdAtMs: parseReviewDate(data.createdAt),
            };
          })
          .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        setReviews(list);
        setLoading(false);
      },
      () => {
        // Fallback to REST API if client snapshot fails
        fetch('/api/reviews')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.reviews) setReviews(d.reviews);
          })
          .finally(() => setLoading(false));
      },
    );
    return () => unsub();
  }, []);

  const scopedReviews = useMemo(() => {
    if (!productId) return reviews;
    const match = reviews.filter((r) => r.productId === productId);
    return match.length >= 3 ? match : reviews;
  }, [reviews, productId]);

  const filtered = useMemo(() => {
    if (!starFilter) return scopedReviews;
    return scopedReviews.filter((r) => Math.round(r.rating) === starFilter);
  }, [scopedReviews, starFilter]);

  const stats = useMemo(() => {
    const count = scopedReviews.length;
    if (count === 0) {
      return {avg: 4.9, count: 0, breakdown: {5: 0, 4: 0, 3: 0, 2: 0, 1: 0}};
    }
    const breakdown: Record<number, number> = {5: 0, 4: 0, 3: 0, 2: 0, 1: 0};
    let sum = 0;
    for (const r of scopedReviews) {
      const s = Math.min(5, Math.max(1, Math.round(Number(r.rating || 5))));
      breakdown[s] = (breakdown[s] || 0) + 1;
      sum += s;
    }
    return {avg: Number((sum / count).toFixed(1)), count, breakdown};
  }, [scopedReviews]);

  const displayed = filtered.slice(0, visibleCount);

  return (
    <section className="max-w-[1248px] mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border-[1.5px] border-slate-200 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              {lang === 'bn' ? 'ভেরিফায়েড কাস্টমার রিভিউ' : 'Verified Gamer Reviews'}
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-display mt-0.5">
              {lang === 'bn' ? 'কাস্টমারদের মতামত ও রেটিং' : 'Customer Reviews & Ratings'}
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors shrink-0">
            <MessageSquarePlus className="w-4 h-4" />
            <span>{lang === 'bn' ? 'রিভিউ লিখুন' : 'Write a Review'}</span>
          </button>
        </div>

        {/* Summary + Star Bars */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center bg-slate-50 dark:bg-slate-950/50 rounded-xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800">
          <div className="md:col-span-4 flex items-center gap-4">
            <div className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-white tabular-nums font-display">
              {stats.avg.toFixed(1)}
            </div>
            <div>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`w-4 h-4 ${
                      s <= Math.round(stats.avg)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-slate-300 dark:text-slate-700'
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 tabular-nums">
                {lang === 'bn'
                  ? `মোট ${stats.count} টি অনুমোদিত রিভিউ`
                  : `Based on ${stats.count} approved reviews`}
              </p>
            </div>
          </div>

          <div className="md:col-span-5 space-y-1.5">
            {[5, 4, 3].map((star) => {
              const cnt = stats.breakdown[star] || 0;
              const pct = stats.count > 0 ? Math.round((cnt / stats.count) * 100) : 0;
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => setStarFilter(starFilter === star ? 0 : star)}
                  className="w-full flex items-center gap-2.5 text-xs cursor-pointer group">
                  <span className="w-8 text-left font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                    {star}★
                  </span>
                  <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all"
                      style={{width: `${pct}%`}}
                    />
                  </div>
                  <span className="w-10 text-right text-slate-500 dark:text-slate-400 tabular-nums">
                    {cnt}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="md:col-span-3 flex flex-wrap gap-1.5 md:justify-end">
            {[0, 5, 4, 3].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStarFilter(s);
                  setVisibleCount(initialLimit);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                  starFilter === s
                    ? 'bg-cyan-600 border-cyan-600 text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}>
                {s === 0 ? (lang === 'bn' ? 'সবগুলো' : 'All') : `${s}★`}
              </button>
            ))}
          </div>
        </div>

        {/* Review Cards Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse"
              />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
            {lang === 'bn' ? 'এই ফিল্টারে কোনো রিভিউ পাওয়া যায়নি।' : 'No reviews match this filter yet.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((r) => (
              <article
                key={r.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-4 flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-3.5 h-3.5 ${
                            s <= r.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-300 dark:text-slate-700'
                          }`}
                        />
                      ))}
                    </div>
                    {r.verifiedPurchase && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {lang === 'bn' ? 'ভেরিফায়েড' : 'Verified'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    "{r.comment}"
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-900 dark:text-white truncate">
                    {r.customerName}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 truncate max-w-[145px]">
                    {r.productName}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {filtered.length > visibleCount && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + 12)}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-cyan-500 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors">
              {lang === 'bn'
                ? `আরও রিভিউ দেখুন (${filtered.length - visibleCount} বাকি)`
                : `Show More Reviews (${filtered.length - visibleCount} more)`}
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <WriteReviewModal
          productId={productId}
          productName={productName}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}
