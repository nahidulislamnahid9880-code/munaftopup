import {useCallback, useEffect, useRef, useState} from 'react';
import {collection, onSnapshot, orderBy, query, where} from 'firebase/firestore';
import {auth, db} from '../lib/firebase';
import type {CustomerNotification} from '../types';

const PUSH_PREF_KEY = 'sv_browser_push_alerts';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useBrowserPushAlerts(customerUid?: string | null) {
  const [supported] = useState<boolean>(
    () => typeof window !== 'undefined' && 'Notification' in window,
  );
  const [pushSupported] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window,
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
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);

  const initializedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const syncServiceWorkerPush = useCallback(async (): Promise<boolean> => {
    if (!pushSupported) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg?.pushManager) return false;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyRes = await fetch('/api/push/vapid-public-key');
        const keyJson = (await keyRes.json().catch(() => ({}))) as {publicKey?: string};
        if (!keyJson.publicKey) return false;
        const appServerKey = urlBase64ToUint8Array(keyJson.publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey.buffer as ArrayBuffer,
        });
      }
      const headers: Record<string, string> = {'Content-Type': 'application/json'};
      const idToken = await auth.currentUser?.getIdToken().catch(() => '');
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({subscription: sub.toJSON()}),
      });
      if (res.ok) {
        setIsSubscribed(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [pushSupported]);

  // Check existing subscription status & re-associate UID when signed in
  useEffect(() => {
    if (!pushSupported || permission !== 'granted') return;
    navigator.serviceWorker.ready
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        setIsSubscribed(Boolean(sub));
        if (sub && enabled) {
          void syncServiceWorkerPush();
        }
      })
      .catch(() => null);
  }, [pushSupported, permission, enabled, customerUid, syncServiceWorkerPush]);

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
      await syncServiceWorkerPush();
      return true;
    }
    return false;
  }, [supported, syncServiceWorkerPush]);

  const disableAlerts = useCallback(async () => {
    setEnabled(false);
    setIsSubscribed(false);
    try {
      window.localStorage.setItem(PUSH_PREF_KEY, 'false');
    } catch {
      // ignore
    }
    if (pushSupported) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({endpoint: sub.endpoint}),
          }).catch(() => null);
          await sub.unsubscribe().catch(() => null);
        }
      } catch {
        // ignore
      }
    }
  }, [pushSupported]);

  // Live foreground Firestore fallback alerts for signed-in customers
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
    pushSupported,
    permission,
    enabled: enabled && permission === 'granted',
    isSubscribed: (enabled && permission === 'granted') || isSubscribed,
    requestAndEnable,
    enablePushNotifications: requestAndEnable,
    disableAlerts,
    disablePushNotifications: disableAlerts,
  };
}
