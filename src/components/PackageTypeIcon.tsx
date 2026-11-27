import React, {useEffect, useState} from 'react';
import type {DiamondPackage, PackageIconType} from '../types';

export type ResolvedPackageIconType = Exclude<PackageIconType, 'auto'>;

export function resolvePackageIconType(
  pkg: Pick<DiamondPackage, 'name' | 'quantityLabel' | 'iconType'>,
): ResolvedPackageIconType {
  if (pkg.iconType && pkg.iconType !== 'auto') {
    return pkg.iconType;
  }
  const text = `${pkg.name || ''} ${pkg.quantityLabel || ''}`.toLowerCase();
  if (text.includes('level') || text.includes('lvl')) return 'levelup';
  if (text.includes('evo') || text.includes('voucher') || text.includes('unipin') || text.includes('pin')) {
    return 'evo';
  }
  if (text.includes('monthly') && !text.includes('weekly')) return 'monthly';
  if (text.includes('weekly')) return 'weekly';
  if (text.includes('diamond') || text.includes('uc') || text.includes('ডায়মন্ড')) return 'diamond';
  return 'special';
}

const ICON_WRAPPER_STYLES: Record<ResolvedPackageIconType, string> = {
  diamond:
    'bg-gradient-to-br from-cyan-50 to-sky-100 dark:from-cyan-950/70 dark:to-sky-900/60 border-cyan-200/90 dark:border-cyan-700/60 text-cyan-600 dark:text-cyan-300',
  weekly:
    'bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-950/70 dark:to-orange-900/50 border-amber-200/90 dark:border-amber-700/60 text-amber-600 dark:text-amber-300',
  monthly:
    'bg-gradient-to-br from-violet-50 to-purple-100 dark:from-violet-950/70 dark:to-purple-900/50 border-violet-200/90 dark:border-violet-700/60 text-violet-600 dark:text-violet-300',
  levelup:
    'bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950/70 dark:to-teal-900/50 border-emerald-200/90 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-300',
  evo:
    'bg-gradient-to-br from-rose-50 to-orange-100 dark:from-rose-950/70 dark:to-orange-900/50 border-rose-200/90 dark:border-rose-700/60 text-rose-600 dark:text-rose-300',
  special:
    'bg-gradient-to-br from-indigo-50 to-blue-100 dark:from-indigo-950/70 dark:to-blue-900/50 border-indigo-200/90 dark:border-indigo-700/60 text-indigo-600 dark:text-indigo-300',
};

export function PackageTypeSvg({
  type,
  className = 'w-5 h-5',
}: {
  type: ResolvedPackageIconType;
  className?: string;
}) {
  if (type === 'diamond') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path
          d="M6.5 3.5H17.5L21.5 9L12 20.5L2.5 9L6.5 3.5Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          d="M2.5 9H21.5M7.5 9L12 20.5L16.5 9M6.5 3.5L9.5 9L12 3.5L14.5 9L17.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === 'weekly') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect
          x="3.5"
          y="5"
          width="17"
          height="15.5"
          rx="3"
          fill="currentColor"
          fillOpacity="0.16"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path d="M8 3.2V6.5M16 3.2V6.5M3.5 9.5H20.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path
          d="M12 12L13.2 14.3L15.7 14.7L13.9 16.5L14.3 19L12 17.8L9.7 19L10.1 16.5L8.3 14.7L10.8 14.3L12 12Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (type === 'monthly') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path
          d="M4 17.5L5.5 7.5L9.5 11L12 5.5L14.5 11L18.5 7.5L20 17.5H4Z"
          fill="currentColor"
          fillOpacity="0.2"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path d="M5.5 20H18.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === 'levelup') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="4"
          fill="currentColor"
          fillOpacity="0.16"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          d="M8.2 14.8L12 11L15.8 14.8M8.2 10.6L12 6.8L15.8 10.6"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === 'evo') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path
          d="M12.5 2.8C12.5 2.8 17.5 6.8 17.5 12.2C17.5 16.5 14.8 19.8 11.8 20.5C8.5 19.9 6.5 16.8 6.5 13.3C6.5 10.4 8.2 7.8 9.8 6.3C9.8 8.3 11 9.5 12 9.5C11.6 7.3 12.1 4.6 12.5 2.8Z"
          fill="currentColor"
          fillOpacity="0.2"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="14" r="2.1" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3L14.6 8.4L20.5 9.2L16.2 13.4L17.2 19.2L12 16.4L6.8 19.2L7.8 13.4L3.5 9.2L9.4 8.4L12 3Z"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PackageVisual({
  pkg,
  size = 'sm',
}: {
  pkg: Pick<DiamondPackage, 'name' | 'quantityLabel' | 'iconType' | 'imageUrl'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolvedType = resolvePackageIconType(pkg);
  const hasImage = Boolean(pkg.imageUrl && pkg.imageUrl.trim()) && !imgFailed;

  useEffect(() => {
    setImgFailed(false);
  }, [pkg.imageUrl]);

  const sizeClass =
    size === 'lg'
      ? 'w-12 h-12 rounded-xl'
      : size === 'md'
        ? 'w-10 h-10 rounded-xl'
        : 'w-8 h-8 rounded-lg';

  const svgClass = size === 'lg' ? 'w-6 h-6' : size === 'md' ? 'w-5 h-5' : 'w-4 h-4';

  if (hasImage) {
    return (
      <div
        className={`${sizeClass} overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0`}>
        <img
          src={pkg.imageUrl}
          alt={pkg.name}
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} border flex items-center justify-center shrink-0 ${ICON_WRAPPER_STYLES[resolvedType]}`}>
      <PackageTypeSvg type={resolvedType} className={svgClass} />
    </div>
  );
}
