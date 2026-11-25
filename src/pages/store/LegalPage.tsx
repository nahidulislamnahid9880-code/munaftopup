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
        <div className="rounded-xl bg-white border border-slate-200 p-8 space-y-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display">{title}</h1>
          <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{body}</p>
        </div>
      </div>
    </StoreLayout>
  );
}
