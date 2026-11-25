import React, {useEffect, useState} from 'react';
import {CreditCard, Landmark, Smartphone} from 'lucide-react';

interface Props {
  name: string;
  logoUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-11 h-11 rounded-xl',
  lg: 'w-14 h-14 rounded-2xl',
};

function detectBrand(name: string): 'bkash' | 'nagad' | 'upay' | 'rocket' | 'cellfin' | 'bank' | 'other' {
  const n = name.trim().toLowerCase();
  if (n.includes('bkash') || n.includes('বিকাশ')) return 'bkash';
  if (n.includes('nagad') || n.includes('নগদ')) return 'nagad';
  if (n.includes('upay') || n.includes('উপায়') || n.includes('উপায়')) return 'upay';
  if (n.includes('rocket') || n.includes('রকেট')) return 'rocket';
  if (n.includes('cellfin') || n.includes('সেলফিন')) return 'cellfin';
  if (n.includes('bank') || n.includes('ব্যাংক')) return 'bank';
  return 'other';
}

export function PaymentMethodLogo({name, logoUrl, size = 'md', className = ''}: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  const sizeCls = SIZE_MAP[size];

  if (logoUrl && !imgFailed) {
    return (
      <div
        className={`${sizeCls} overflow-hidden bg-white border border-slate-200/90 p-1 flex items-center justify-center shrink-0 shadow-2xs ${className}`}>
        <img
          src={logoUrl}
          alt={name || 'Payment gateway logo'}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain rounded-md"
        />
      </div>
    );
  }

  const brand = detectBrand(name || '');

  if (brand === 'bkash') {
    return (
      <div
        aria-label="bKash logo"
        className={`${sizeCls} bg-gradient-to-br from-[#E2136E] to-[#B50B56] text-white flex flex-col items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
        <svg viewBox="0 0 32 32" className="w-[62%] h-[62%]" fill="none" aria-hidden="true">
          <path d="M16 4L25 14L17 20L16 4Z" fill="white" fillOpacity="0.95" />
          <path d="M16 4L8 15L17 20L16 4Z" fill="white" fillOpacity="0.72" />
          <path d="M8 15L17 20L11 27L8 15Z" fill="white" fillOpacity="0.9" />
          <path d="M25 14L27 19L17 20L25 14Z" fill="white" fillOpacity="0.6" />
        </svg>
        <span className="text-[7px] font-extrabold leading-none tracking-tight -mt-0.5">bKash</span>
      </div>
    );
  }

  if (brand === 'nagad') {
    return (
      <div
        aria-label="Nagad logo"
        className={`${sizeCls} bg-gradient-to-br from-[#F7941D] via-[#F15A24] to-[#ED1C24] text-white flex flex-col items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
        <svg viewBox="0 0 32 32" className="w-[58%] h-[58%]" fill="none" aria-hidden="true">
          <circle cx="16" cy="14" r="8" stroke="white" strokeWidth="2.6" />
          <path d="M12 19L16 10L20 19" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[7px] font-extrabold leading-none tracking-tight -mt-0.5">Nagad</span>
      </div>
    );
  }

  if (brand === 'upay') {
    return (
      <div
        aria-label="Upay logo"
        className={`${sizeCls} bg-gradient-to-br from-[#FFD100] to-[#F5B800] text-[#003B73] border border-amber-300 flex flex-col items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
        <svg viewBox="0 0 32 32" className="w-[58%] h-[58%]" fill="none" aria-hidden="true">
          <path
            d="M9 10V17C9 20.866 12.134 24 16 24C19.866 24 23 20.866 23 17V10"
            stroke="#003B73"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <circle cx="16" cy="10" r="2.2" fill="#E11D48" />
        </svg>
        <span className="text-[7px] font-extrabold leading-none tracking-tight -mt-0.5">upay</span>
      </div>
    );
  }

  if (brand === 'rocket') {
    return (
      <div
        aria-label="Rocket logo"
        className={`${sizeCls} bg-gradient-to-br from-[#8C3494] to-[#5E1F64] text-white flex flex-col items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
        <svg viewBox="0 0 32 32" className="w-[56%] h-[56%]" fill="none" aria-hidden="true">
          <path
            d="M16 5C20 8 22 13 22 18L16 22L10 18C10 13 12 8 16 5Z"
            fill="white"
            fillOpacity="0.95"
          />
          <circle cx="16" cy="14" r="2.2" fill="#8C3494" />
          <path d="M13 24L16 27L19 24" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="text-[6.5px] font-extrabold leading-none tracking-tight -mt-0.5">Rocket</span>
      </div>
    );
  }

  if (brand === 'cellfin') {
    return (
      <div
        aria-label="CellFin logo"
        className={`${sizeCls} bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex flex-col items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
        <Smartphone className="w-[48%] h-[48%]" />
        <span className="text-[6.5px] font-bold leading-none mt-0.5">CellFin</span>
      </div>
    );
  }

  if (brand === 'bank') {
    return (
      <div
        aria-label="Bank logo"
        className={`${sizeCls} bg-gradient-to-br from-slate-700 to-slate-900 text-white flex flex-col items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
        <Landmark className="w-[48%] h-[48%]" />
        <span className="text-[6.5px] font-bold leading-none mt-0.5">Bank</span>
      </div>
    );
  }

  return (
    <div
      aria-label={`${name || 'Payment'} logo`}
      className={`${sizeCls} bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs select-none ${className}`}>
      <CreditCard className="w-1/2 h-1/2" />
    </div>
  );
}
