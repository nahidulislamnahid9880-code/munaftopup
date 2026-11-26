import React from 'react';
import {useStore} from '../../contexts/StoreContext';
import {StoreLayout} from '../../components/store/StoreLayout';

export function LegalPage({type}: {type: 'terms' | 'privacy'}) {
  const {siteSettings} = useStore();
  const title = type === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  const body = type === 'terms' ? siteSettings.termsContent : siteSettings.privacyContent;

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl bg-white border-[1.5px] border-slate-200/95 ring-1 ring-slate-900/[0.04] p-6 sm:p-8 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display border-b border-slate-200/80 pb-4">{title}</h1>
          <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{body}</p>
        </div>
      </div>
    </StoreLayout>
  );
}
