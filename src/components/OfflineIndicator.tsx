import {useEffect, useState} from 'react';
import {WifiOff} from 'lucide-react';
import {useLanguage} from '../contexts/LanguageContext';

export function OfflineIndicator() {
  const [offline, setOffline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  );
  const {lang} = useLanguage();

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="bg-amber-600 text-white text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        {lang === 'bn'
          ? 'আপনি অফলাইনে আছেন — সংযোগ ফিরে এলে অর্ডার সিঙ্ক হবে।'
          : 'You are offline — reconnect to place orders or sync live updates.'}
      </span>
    </div>
  );
}
