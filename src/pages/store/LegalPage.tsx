import React from 'react';
import {useLanguage} from '../../contexts/LanguageContext';
import {useStore} from '../../contexts/StoreContext';
import {StoreLayout} from '../../components/store/StoreLayout';

export function LegalPage({type}: {type: 'terms' | 'privacy'}) {
  const {siteSettings} = useStore();
  const {t} = useLanguage();
  const title = type === 'terms' ? t('nav.terms') : t('nav.privacy');
  const body = type === 'terms' ? siteSettings.termsContent : siteSettings.privacyContent;

  return (
    <StoreLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-[1.5px] border-slate-200/95 dark:border-slate-800 p-6 sm:p-8 space-y-5 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.06)] dark:shadow-none">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-display border-b border-slate-200/80 dark:border-slate-800 pb-4">
            {title}
          </h1>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
            {body}
          </p>
        </div>
      </div>
    </StoreLayout>
  );
}
