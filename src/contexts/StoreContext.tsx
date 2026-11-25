import React, {createContext, useContext, useEffect, useState} from 'react';
import {collection, doc, onSnapshot, orderBy, query} from 'firebase/firestore';
import {OperationType, db, handleFirestoreError, testConnection} from '../lib/firebase';
import {DEFAULT_SITE_SHELL} from '../lib/seedData';
import type {Category, PaymentMethod, Product, SiteSettings} from '../types';

interface StoreContextValue {
  siteSettings: SiteSettings;
  categories: Category[];
  products: Product[];
  paymentMethods: PaymentMethod[];
  loading: boolean;
  catalogInitialized: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({children}: {children: React.ReactNode}) {
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SHELL);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogInitialized, setCatalogInitialized] = useState(false);

  useEffect(() => {
    void testConnection();

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'site'),
      (snap) => {
        if (snap.exists()) {
          setSiteSettings(snap.data() as SiteSettings);
          setCatalogInitialized(true);
        } else {
          setSiteSettings(DEFAULT_SITE_SHELL);
          setCatalogInitialized(false);
        }
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'settings/site');
      },
    );

    const unsubCategories = onSnapshot(
      query(collection(db, 'categories'), orderBy('displayOrder', 'asc')),
      (snap) => {
        setCategories(snap.docs.map((d) => d.data() as Category));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'categories');
      },
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), orderBy('displayOrder', 'asc')),
      (snap) => {
        setProducts(snap.docs.map((d) => d.data() as Product));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'products');
      },
    );

    const unsubPayments = onSnapshot(
      query(collection(db, 'paymentMethods'), orderBy('displayOrder', 'asc')),
      (snap) => {
        setPaymentMethods(snap.docs.map((d) => d.data() as PaymentMethod));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'paymentMethods');
      },
    );

    return () => {
      unsubSettings();
      unsubCategories();
      unsubProducts();
      unsubPayments();
    };
  }, []);

  // Dynamically sync page title and favicon from Admin settings
  useEffect(() => {
    if (siteSettings.brandName) {
      document.title = `${siteSettings.brandName} — ${siteSettings.brandTagline || 'Instant Game Top-Up'}`;
    }
    if (siteSettings.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = siteSettings.faviconUrl;
    }
  }, [siteSettings.brandName, siteSettings.brandTagline, siteSettings.faviconUrl]);

  return (
    <StoreContext.Provider
      value={{
        siteSettings,
        categories,
        products,
        paymentMethods,
        loading,
        catalogInitialized,
      }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
