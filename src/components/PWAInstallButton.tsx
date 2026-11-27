import {useState} from 'react';
import {Download, Share, Smartphone, X} from 'lucide-react';
import {useLanguage} from '../contexts/LanguageContext';
import {usePWAInstall} from '../hooks/usePWAInstall';

export function PWAInstallButton({variant = 'compact'}: {variant?: 'compact' | 'drawer'}) {
  const {canInstallNative, canShowIOSHint, isInstalled, promptInstall} = usePWAInstall();
  const [iosModalOpen, setIosModalOpen] = useState(false);
  const {lang} = useLanguage();

  if (isInstalled || (!canInstallNative && !canShowIOSHint)) {
    return null;
  }

  const label = lang === 'bn' ? 'অ্যাপ ইনস্টল' : 'Install App';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canInstallNative) {
            void promptInstall();
          } else if (canShowIOSHint) {
            setIosModalOpen(true);
          }
        }}
        title={label}
        className={
          variant === 'drawer'
            ? 'w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 dark:from-cyan-600 dark:to-blue-600 text-white text-xs font-bold shadow-xs cursor-pointer transition-all hover:opacity-95'
            : 'hidden lg:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border-[1.5px] border-cyan-500/40 bg-cyan-50/70 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-200 hover:bg-cyan-100 dark:hover:bg-cyan-900/60 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors'
        }>
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>

      {iosModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {lang === 'bn' ? 'হোম স্ক্রিনে অ্যাপ ইনস্টল করুন' : 'Install MUNAFTOPUP.bd App'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">iOS Safari</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIosModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-2 list-decimal pl-4 leading-relaxed">
              <li className="flex items-center gap-1.5">
                <span>{lang === 'bn' ? 'নিচের Share আইকনে ট্যাপ করুন' : 'Tap the Share button in Safari'}</span>
                <Share className="w-3.5 h-3.5 text-cyan-600 inline shrink-0" />
              </li>
              <li>
                {lang === 'bn'
                  ? '"Add to Home Screen" সিলেক্ট করে Add দিন'
                  : 'Scroll down and tap "Add to Home Screen"'}
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
