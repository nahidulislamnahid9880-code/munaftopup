import {useCallback, useEffect, useRef, useState} from 'react';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {db} from '../lib/firebase';
import type {CustomerNotification} from '../types';

const PUSH_PREF_KEY = 'sv_browser_push_alerts';

export function useBrowserPushAlerts(customerUid?: string | null) {
  const [supported] = useState<boolean>(
    () => typeof window !== 'undefined' && 'Notification' in window,
  );
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied',
  );
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PUSH_PREF_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const initializedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const requestAndEnable = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
    setPermission(perm);
    if (perm === 'granted') {
      setEnabled(true);
      try {
        window.localStorage.setItem(PUSH_PREF_KEY, 'true');
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  }, [supported]);

  const disableAlerts = useCallback(() => {
    setEnabled(false);
    try {
      window.localStorage.setItem(PUSH_PREF_KEY, 'false');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!customerUid || !supported || !enabled || permission !== 'granted') return;
    initializedRef.current = false;
    seenIdsRef.current.clear();

    const q = query(
      collection(db, 'notifications'),
      where('customerUid', '==', customerUid),
      orderBy('createdAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!initializedRef.current) {
          snap.docs.forEach((d) => seenIdsRef.current.add(d.id));
          initializedRef.current = true;
          return;
        }
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          if (seenIdsRef.current.has(change.doc.id)) return;
          seenIdsRef.current.add(change.doc.id);
          const n = change.doc.data() as CustomerNotification;
          if (n.read) return;
          try {
            new Notification(n.title || 'Order Update', {
              body: n.message || '',
              icon: '/pwa-192x192.png',
              tag: n.id,
            });
          } catch {
            // ignore notification display constraint in sandboxed iframes
          }
        });
      },
      () => {
        // fail silently if offline
      },
    );

    return () => unsub();
  }, [customerUid, supported, enabled, permission]);

  return {
    supported,
    permission,
    enabled: enabled && permission === 'granted',
    requestAndEnable,
    disableAlerts,
  };
}
