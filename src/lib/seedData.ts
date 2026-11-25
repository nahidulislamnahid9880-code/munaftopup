import {doc, getDoc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {OperationType, db, handleFirestoreError} from './firebase';
import type {Category, PaymentMethod, Product, SiteSettings} from '../types';

export const DEFAULT_SITE_SHELL: SiteSettings = {
  brandName: 'StrikeVault',
  brandTagline: 'Instant UID Top-Up & Digital Game Vouchers',
  logoUrl: '',
  faviconUrl: '',
  noticeText: '',
  noticeActive: false,
  heroTitle: 'Instant Game Top-Up via Player UID',
  heroSubtitle: 'Fast automated verification for Free Fire Diamonds, Weekly Memberships, and digital game vouchers.',
  heroCtaText: 'Browse Top-Ups',
  heroCtaLink: '#products',
  banners: [],
  promos: [],
  homepageSections: {
    showFeatured: true,
    showCategories: true,
    showPromos: true,
    showHowItWorks: true,
    featuredTitle: 'Top-Up Products',
    categoriesTitle: 'Browse by Category',
  },
  contact: {
    email: 'support@strikevault.store',
    phone: '+880 1700-000000',
    whatsapp: '',
    telegram: '',
    supportHours: 'Daily 9:00 AM – 11:59 PM (GMT+6)',
    address: 'Dhaka, Bangladesh',
  },
  socials: {
    facebook: '',
    instagram: '',
    youtube: '',
    discord: '',
    tiktok: '',
  },
  footerText: '© 2026 StrikeVault Digital Services. Independent digital top-up storefront.',
  termsContent:
    'All digital top-up orders are delivered to the Player UID provided at checkout. Please verify your UID and Server ID carefully before confirming payment. Duplicate or invalid Transaction IDs are automatically rejected. Refunds are issued only when an order cannot be fulfilled.',
  privacyContent:
    'We collect only the account details, Player UID, and payment verification information required to fulfill your digital top-up orders and provide customer support. We never sell customer data to third parties.',
};

const INITIAL_CATEGORIES: Array<Omit<Category, 'updatedAt'>> = [
  {
    id: 'cat_free_fire',
    name: 'Free Fire Top-Up',
    slug: 'free-fire-top-up',
    description: 'Direct Player UID diamonds and level-up passes.',
    imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg',
    displayOrder: 1,
    active: true,
  },
  {
    id: 'cat_memberships',
    name: 'Memberships & Passes',
    slug: 'memberships-passes',
    description: 'Weekly, Monthly, and Evo Gun access memberships.',
    imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg',
    displayOrder: 2,
    active: true,
  },
  {
    id: 'cat_vouchers',
    name: 'Game Vouchers',
    slug: 'game-vouchers',
    description: 'Instant redeemable pins and multi-game gift vouchers.',
    imageUrl: '/src/assets/images/product_evo_voucher_1795604334150.jpg',
    displayOrder: 3,
    active: true,
  },
  {
    id: 'cat_battle_royale',
    name: 'Battle Royale Coins',
    slug: 'battle-royale-coins',
    description: 'PUBG Mobile UC and competitive arena currencies.',
    imageUrl: '/src/assets/images/product_pubg_uc_1795604334056.jpg',
    displayOrder: 4,
    active: true,
  },
];

const INITIAL_PRODUCTS: Array<Omit<Product, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'prod_ff_diamonds_bd',
    name: 'Free Fire Diamonds (BD Server)',
    slug: 'free-fire-diamonds-bd',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire Top-Up',
    shortDescription: 'Instant UID diamond delivery for Bangladesh server accounts.',
    description:
      'Top up Free Fire Diamonds directly using your Player UID without sharing any login credentials. Verified orders are fulfilled promptly into your in-game mailbox.',
    instructions:
      '1. Open Free Fire and copy your numeric Player UID from your profile header.\n2. Select your desired Diamond package below.\n3. Complete bKash or Nagad payment and submit the exact Transaction ID (TrxID).',
    images: [
      '/src/assets/images/product_ff_diamonds_1795604333340.jpg',
      '/src/assets/images/hero_battle_royale_1795604332736.jpg',
    ],
    requiresUid: true,
    uidLabel: 'Free Fire Player UID',
    requiresServerId: false,
    serverLabel: 'Server Region',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_25', name: '25 Diamonds', quantityLabel: '25 Diamonds', price: 24, originalPrice: 28, promoLabel: '', imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg', active: true, displayOrder: 1},
      {id: 'pkg_50', name: '50 Diamonds', quantityLabel: '50 Diamonds', price: 45, originalPrice: 52, promoLabel: 'Popular', imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg', active: true, displayOrder: 2},
      {id: 'pkg_115', name: '115 Diamonds', quantityLabel: '115 Diamonds', price: 82, originalPrice: 95, promoLabel: 'Save 14%', imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg', active: true, displayOrder: 3},
      {id: 'pkg_240', name: '240 Diamonds', quantityLabel: '240 Diamonds', price: 165, originalPrice: 185, promoLabel: '', imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg', active: true, displayOrder: 4},
      {id: 'pkg_610', name: '610 Diamonds', quantityLabel: '610 Diamonds', price: 410, originalPrice: 460, promoLabel: 'Best Value', imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg', active: true, displayOrder: 5},
      {id: 'pkg_1240', name: '1240 Diamonds', quantityLabel: '1240 Diamonds', price: 810, originalPrice: 900, promoLabel: 'Save 10%', imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg', active: true, displayOrder: 6},
    ],
    active: true,
    featured: true,
    displayOrder: 1,
  },
  {
    id: 'prod_ff_membership',
    name: 'Free Fire Weekly & Monthly Membership',
    slug: 'free-fire-membership',
    categoryId: 'cat_memberships',
    categoryName: 'Memberships & Passes',
    shortDescription: 'Official Weekly, Monthly, and Level-Up Pass activation via UID.',
    description:
      'Activate Weekly or Monthly Diamond Memberships directly on your Free Fire UID. Includes daily diamond claim privileges and VIP badge rewards.',
    instructions:
      '1. Ensure your account does not exceed the maximum stacked membership limit.\n2. Enter your exact Free Fire UID.\n3. Submit payment details and TrxID for fast activation.',
    images: [
      '/src/assets/images/product_ff_membership_1795604332989.jpg',
      '/src/assets/images/promo_membership_banner_1795604332754.jpg',
    ],
    requiresUid: true,
    uidLabel: 'Free Fire Player UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_weekly_lite', name: 'Weekly Lite Membership', quantityLabel: '7 Days Lite', price: 55, originalPrice: 65, promoLabel: '', imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg', active: true, displayOrder: 1},
      {id: 'pkg_weekly', name: 'Weekly Membership', quantityLabel: '450 Diamonds Total', price: 158, originalPrice: 180, promoLabel: 'Hot', imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg', active: true, displayOrder: 2},
      {id: 'pkg_monthly', name: 'Monthly Membership', quantityLabel: '2600 Diamonds Total', price: 785, originalPrice: 860, promoLabel: 'Save ৳75', imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg', active: true, displayOrder: 3},
      {id: 'pkg_levelup', name: 'Level Up Pass', quantityLabel: '1270 Diamonds', price: 195, originalPrice: 220, promoLabel: '', imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg', active: true, displayOrder: 4},
    ],
    active: true,
    featured: true,
    displayOrder: 2,
  },
  {
    id: 'prod_evo_voucher',
    name: 'Evo Access & Garena Shell Vouchers',
    slug: 'evo-access-garena-vouchers',
    categoryId: 'cat_vouchers',
    categoryName: 'Game Vouchers',
    shortDescription: 'Evo Gun Access passes and redeemable UniPin / Garena Shell codes.',
    description:
      'Unlock Evo Gun Access passes or purchase official redeemable digital voucher pins for immediate redemption across supported servers.',
    instructions:
      '1. Enter your Player UID (or recipient contact ID for voucher pins).\n2. Choose your pass duration or voucher denomination.\n3. Verify payment with TrxID.',
    images: ['/src/assets/images/product_evo_voucher_1795604334150.jpg'],
    requiresUid: true,
    uidLabel: 'Player UID / Account ID',
    requiresServerId: true,
    serverLabel: 'Region / Server',
    serverOptions: ['Bangladesh', 'Singapore', 'Indonesia', 'Global'],
    packages: [
      {id: 'pkg_evo_3d', name: 'Evo Access 3 Days', quantityLabel: '3 Days Pass', price: 68, originalPrice: 80, promoLabel: '', imageUrl: '/src/assets/images/product_evo_voucher_1795604334150.jpg', active: true, displayOrder: 1},
      {id: 'pkg_evo_7d', name: 'Evo Access 7 Days', quantityLabel: '7 Days Pass', price: 115, originalPrice: 135, promoLabel: 'Popular', imageUrl: '/src/assets/images/product_evo_voucher_1795604334150.jpg', active: true, displayOrder: 2},
      {id: 'pkg_evo_30d', name: 'Evo Access 30 Days', quantityLabel: '30 Days Pass', price: 320, originalPrice: 360, promoLabel: 'Save 11%', imageUrl: '/src/assets/images/product_evo_voucher_1795604334150.jpg', active: true, displayOrder: 3},
      {id: 'pkg_unipin_500', name: '500 UC / Voucher Pin', quantityLabel: '500 Code', price: 475, originalPrice: 510, promoLabel: '', imageUrl: '/src/assets/images/product_evo_voucher_1795604334150.jpg', active: true, displayOrder: 4},
    ],
    active: true,
    featured: true,
    displayOrder: 3,
  },
  {
    id: 'prod_pubg_uc',
    name: 'PUBG Mobile UC (Global)',
    slug: 'pubg-mobile-uc-global',
    categoryId: 'cat_battle_royale',
    categoryName: 'Battle Royale Coins',
    shortDescription: 'Fast PUBG Mobile Unknown Cash top-up by Player ID.',
    description:
      'Instant PUBG Mobile Global UC delivery via numeric Character ID. Supports Royal Pass upgrades, crates, and seasonal outfits.',
    instructions:
      '1. Copy your numeric PUBG Mobile Character ID.\n2. Select your UC pack and server region.\n3. Pay via bKash or Nagad and submit the TrxID.',
    images: ['/src/assets/images/product_pubg_uc_1795604334056.jpg'],
    requiresUid: true,
    uidLabel: 'PUBG Character ID',
    requiresServerId: true,
    serverLabel: 'Server Region',
    serverOptions: ['Global', 'Asia', 'Middle East', 'Europe'],
    packages: [
      {id: 'pkg_uc_60', name: '60 UC', quantityLabel: '60 UC', price: 120, originalPrice: 135, promoLabel: '', imageUrl: '/src/assets/images/product_pubg_uc_1795604334056.jpg', active: true, displayOrder: 1},
      {id: 'pkg_uc_325', name: '325 UC', quantityLabel: '300 + 25 Bonus UC', price: 590, originalPrice: 640, promoLabel: 'Popular', imageUrl: '/src/assets/images/product_pubg_uc_1795604334056.jpg', active: true, displayOrder: 2},
      {id: 'pkg_uc_660', name: '660 UC', quantityLabel: '600 + 60 Bonus UC', price: 1170, originalPrice: 1250, promoLabel: 'Royal Pass', imageUrl: '/src/assets/images/product_pubg_uc_1795604334056.jpg', active: true, displayOrder: 3},
    ],
    active: true,
    featured: true,
    displayOrder: 4,
  },
];

const INITIAL_PAYMENT_METHODS: Array<Omit<PaymentMethod, 'updatedAt'>> = [
  {
    id: 'pm_bkash',
    name: 'bKash',
    accountNumber: '01700-112233',
    accountType: 'Personal',
    instructions:
      '1. Open the bKash App and select "Send Money".\n2. Enter our bKash Personal number above and send the exact order total.\n3. Copy the Transaction ID (TrxID) and enter your sender number below.',
    logoUrl: '',
    active: true,
    displayOrder: 1,
  },
  {
    id: 'pm_nagad',
    name: 'Nagad',
    accountNumber: '01800-445566',
    accountType: 'Personal',
    instructions:
      '1. Open the Nagad App or dial *167# and choose "Send Money".\n2. Send the exact order total to the Nagad number above.\n3. Paste your Nagad Transaction ID (TrxID) and upload a screenshot if available.',
    logoUrl: '',
    active: true,
    displayOrder: 2,
  },
];

export async function initializeDefaultCatalogIfMissing(actorEmail: string): Promise<boolean> {
  const settingsRef = doc(db, 'settings', 'site');
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      return false;
    }

    const batch = writeBatch(db);
    const now = serverTimestamp();

    const initialSettings: SiteSettings = {
      ...DEFAULT_SITE_SHELL,
      noticeText: 'Fast UID Delivery Active · Verify your Player UID carefully before placing an order.',
      noticeActive: true,
      banners: [
        {
          id: 'banner_1',
          title: 'Free Fire Diamonds — Instant UID Delivery',
          subtitle: 'Verified bKash & Nagad orders fulfilled directly to your Free Fire ID in minutes.',
          imageUrl: '/src/assets/images/hero_battle_royale_1795604332736.jpg',
          linkUrl: '/product/free-fire-diamonds-bd',
          active: true,
        },
        {
          id: 'banner_2',
          title: 'Weekly & Monthly VIP Memberships',
          subtitle: 'Save up to 14% on stacked Free Fire Memberships and Evo Gun Access passes.',
          imageUrl: '/src/assets/images/promo_membership_banner_1795604332754.jpg',
          linkUrl: '/product/free-fire-membership',
          active: true,
        },
      ],
      promos: [
        {
          id: 'promo_1',
          title: 'Weekly Membership Bundle',
          description: 'Unlock 450 Diamonds across 7 days with instant UID activation.',
          imageUrl: '/src/assets/images/product_ff_membership_1795604332989.jpg',
          code: 'WEEKLYVIP',
          discountText: 'Save ৳22',
          active: true,
        },
        {
          id: 'promo_2',
          title: '610 Diamonds Pro Pack',
          description: 'Most popular pack for Evo gun spins and Elite Pass upgrades.',
          imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg',
          code: 'PRO610',
          discountText: 'Best Value',
          active: true,
        },
      ],
      updatedAt: now,
    };

    batch.set(settingsRef, initialSettings);

    for (const cat of INITIAL_CATEGORIES) {
      batch.set(doc(db, 'categories', cat.id), {
        ...cat,
        updatedAt: now,
      });
    }

    for (const prod of INITIAL_PRODUCTS) {
      batch.set(doc(db, 'products', prod.id), {
        ...prod,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const pm of INITIAL_PAYMENT_METHODS) {
      batch.set(doc(db, 'paymentMethods', pm.id), {
        ...pm,
        updatedAt: now,
      });
    }

    const logId = `init_${Date.now()}`;
    batch.set(doc(db, 'auditLogs', logId), {
      id: logId,
      actorEmail,
      actorRole: 'super_admin',
      action: 'CATALOG_INITIALIZED',
      targetType: 'settings',
      targetId: 'site',
      details: 'Seeded initial storefront settings, categories, products, and payment methods.',
      createdAt: now,
    });

    await batch.commit();
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/site');
  }
}
