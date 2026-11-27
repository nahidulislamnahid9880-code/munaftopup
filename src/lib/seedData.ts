import {doc, getDoc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {OperationType, db, handleFirestoreError} from './firebase';
import type {Category, PaymentMethod, Product, SiteSettings} from '../types';

export const DEFAULT_SITE_SHELL: SiteSettings = {
  brandName: 'MUNAFTOPUP.bd',
  brandTagline: 'Instant Free Fire Diamond Top-Up & Digital Game Vouchers',
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
    featuredTitle: 'Top-Up Services',
    categoriesTitle: 'Browse by Category',
  },
  contact: {
    email: 'support@munaftopup.bd',
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
  footerText: '© 2026 MUNAFTOPUP.bd. Trusted Free Fire Diamond & Digital Top-Up Platform.',
  termsContent:
    'All digital top-up orders are delivered to the Player UID provided at checkout. Please verify your UID and Server ID carefully before confirming payment. Duplicate or invalid Transaction IDs are automatically rejected. Refunds are issued only when an order cannot be fulfilled.',
  privacyContent:
    'We collect only the account details, Player UID, and payment verification information required to fulfill your digital top-up orders and provide customer support. We never sell customer data to third parties.',
};

const INITIAL_CATEGORIES: Array<Omit<Category, 'updatedAt'>> = [
  {
    id: 'cat_free_fire',
    name: 'Free Fire',
    slug: 'free-fire',
    description: 'Free Fire BD Server & Indonesia UID diamonds, memberships, level-up passes, and vouchers.',
    imageUrl: '/src/assets/images/product_ff_diamonds_1795604333340.jpg',
    displayOrder: 1,
    active: true,
  },
  {
    id: 'cat_battle_royale',
    name: 'PUBG UC Buy',
    slug: 'pubg-uc-buy',
    description: 'PUBG Mobile UC and battle royale digital top-ups.',
    imageUrl: '/src/assets/images/product_pubg_uc_1795604334056.jpg',
    displayOrder: 2,
    active: true,
  },
];

const INITIAL_PRODUCTS: Array<Omit<Product, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'prod_ff_diamonds_bd',
    name: 'Free Fire [BD SERVER]',
    slug: 'free-fire-bd-server',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Instant UID diamond & membership delivery for Bangladesh server accounts.',
    description:
      'Top up Free Fire Diamonds directly using your Player UID without sharing any login credentials. Verified orders are fulfilled promptly into your in-game mailbox.',
    instructions:
      '1. Open Free Fire and copy your numeric Player UID from your profile header.\n2. Select your desired Diamond or Membership package below.\n3. Pay with Wallet Balance or complete bKash/Nagad Send Money with your TrxID.',
    images: [
      '/src/assets/images/product_ff_diamonds_1795604333340.jpg',
      '/src/assets/images/hero_battle_royale_1795604332736.jpg',
    ],
    requiresUid: true,
    uidLabel: 'Player UID',
    requiresServerId: false,
    serverLabel: 'Server Region',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_bd_25', name: '25 Diamond', quantityLabel: '25 Diamond', price: 22, originalPrice: 22, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_bd_50', name: '50 Diamond', quantityLabel: '50 Diamond', price: 37, originalPrice: 37, promoLabel: '', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_bd_100', name: '100 Diamond', quantityLabel: '100 Diamond', price: 75, originalPrice: 75, promoLabel: '', imageUrl: '', active: true, displayOrder: 3},
      {id: 'pkg_bd_115', name: '115 Diamond', quantityLabel: '115 Diamond', price: 80, originalPrice: 80, promoLabel: '', imageUrl: '', active: true, displayOrder: 4},
      {id: 'pkg_bd_240', name: '240 Diamond', quantityLabel: '240 Diamond', price: 158, originalPrice: 158, promoLabel: '', imageUrl: '', active: true, displayOrder: 5},
      {id: 'pkg_bd_355', name: '355 Diamond', quantityLabel: '355 Diamond', price: 240, originalPrice: 240, promoLabel: '', imageUrl: '', active: true, displayOrder: 6},
      {id: 'pkg_bd_480', name: '480 Diamond', quantityLabel: '480 Diamond', price: 316, originalPrice: 316, promoLabel: '', imageUrl: '', active: true, displayOrder: 7},
      {id: 'pkg_bd_505', name: '505 Diamond', quantityLabel: '505 Diamond', price: 335, originalPrice: 335, promoLabel: '', imageUrl: '', active: true, displayOrder: 8},
      {id: 'pkg_bd_610', name: '610 Diamond', quantityLabel: '610 Diamond', price: 400, originalPrice: 400, promoLabel: '', imageUrl: '', active: true, displayOrder: 9},
      {id: 'pkg_bd_725', name: '725 Diamond', quantityLabel: '725 Diamond', price: 480, originalPrice: 480, promoLabel: '', imageUrl: '', active: true, displayOrder: 10},
      {id: 'pkg_bd_850', name: '850 Diamond', quantityLabel: '850 Diamond', price: 560, originalPrice: 560, promoLabel: '', imageUrl: '', active: true, displayOrder: 11},
      {id: 'pkg_bd_1090', name: '1090 Diamond', quantityLabel: '1090 Diamond', price: 715, originalPrice: 715, promoLabel: '', imageUrl: '', active: true, displayOrder: 12},
      {id: 'pkg_bd_1240', name: '1240 Diamond', quantityLabel: '1240 Diamond', price: 800, originalPrice: 800, promoLabel: '', imageUrl: '', active: true, displayOrder: 13},
      {id: 'pkg_bd_1595', name: '1595 Diamond', quantityLabel: '1595 Diamond', price: 1040, originalPrice: 1040, promoLabel: '', imageUrl: '', active: true, displayOrder: 14},
      {id: 'pkg_bd_1850', name: '1850 Diamond', quantityLabel: '1850 Diamond', price: 1200, originalPrice: 1200, promoLabel: '', imageUrl: '', active: true, displayOrder: 15},
      {id: 'pkg_bd_2090', name: '2090 Diamond', quantityLabel: '2090 Diamond', price: 1360, originalPrice: 1360, promoLabel: '', imageUrl: '', active: true, displayOrder: 16},
      {id: 'pkg_bd_2530', name: '2530 Diamond', quantityLabel: '2530 Diamond', price: 1610, originalPrice: 1610, promoLabel: '', imageUrl: '', active: true, displayOrder: 17},
      {id: 'pkg_bd_3140', name: '3140 Diamond', quantityLabel: '3140 Diamond', price: 2050, originalPrice: 2050, promoLabel: '', imageUrl: '', active: true, displayOrder: 18},
      {id: 'pkg_bd_5060', name: '5060 Diamond', quantityLabel: '5060 Diamond', price: 3220, originalPrice: 3220, promoLabel: '', imageUrl: '', active: true, displayOrder: 19},
      {id: 'pkg_bd_weekly', name: 'Weekly', quantityLabel: 'Weekly Membership', price: 156, originalPrice: 156, promoLabel: '', imageUrl: '', active: true, displayOrder: 20},
      {id: 'pkg_bd_monthly', name: 'Monthly', quantityLabel: 'Monthly Membership', price: 780, originalPrice: 780, promoLabel: '', imageUrl: '', active: true, displayOrder: 21},
      {id: 'pkg_bd_weekly_lite', name: 'Weekly LITE', quantityLabel: 'Weekly LITE', price: 45, originalPrice: 45, promoLabel: '', imageUrl: '', active: true, displayOrder: 22},
      {id: 'pkg_bd_1w_1m', name: '1 Weekly & 1 Monthly', quantityLabel: '1 Weekly + 1 Monthly', price: 940, originalPrice: 940, promoLabel: '', imageUrl: '', active: true, displayOrder: 23},
      {id: 'pkg_bd_2w_1m', name: '2 Weekly & 1 Monthly', quantityLabel: '2 Weekly + 1 Monthly', price: 1100, originalPrice: 1100, promoLabel: '', imageUrl: '', active: true, displayOrder: 24},
    ],
    active: true,
    featured: true,
    displayOrder: 1,
  },
  {
    id: 'prod_ff_membership',
    name: 'Weekly & Monthly',
    slug: 'free-fire-membership',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Official Weekly LITE, Weekly & Monthly Membership bundles via Player UID.',
    description:
      'Activate Weekly LITE, Weekly, Monthly, or multi-week Diamond Membership combos directly on your Free Fire UID.',
    instructions:
      '1. Ensure your account does not exceed the maximum stacked membership limit.\n2. Enter your exact Free Fire UID.\n3. Pay with Wallet Balance or submit bKash/Nagad TrxID.',
    images: [
      '/src/assets/images/product_ff_membership_1795604332989.jpg',
      '/src/assets/images/promo_membership_banner_1795604332754.jpg',
    ],
    requiresUid: true,
    uidLabel: 'Player UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_wm_weekly_lite', name: 'Weekly LITE', quantityLabel: 'Weekly LITE', price: 45, originalPrice: 45, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_wm_weekly', name: 'Weekly', quantityLabel: 'Weekly', price: 156, originalPrice: 156, promoLabel: '', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_wm_monthly', name: 'Monthly', quantityLabel: 'Monthly', price: 780, originalPrice: 780, promoLabel: '', imageUrl: '', active: true, displayOrder: 3},
      {id: 'pkg_wm_1w1m', name: '1 Weekly & 1 Monthly', quantityLabel: '1 Weekly + 1 Monthly', price: 938, originalPrice: 938, promoLabel: '', imageUrl: '', active: true, displayOrder: 4},
      {id: 'pkg_wm_2w1m', name: '2 Weekly & 1 Monthly', quantityLabel: '2 Weekly + 1 Monthly', price: 1100, originalPrice: 1100, promoLabel: '', imageUrl: '', active: true, displayOrder: 5},
      {id: 'pkg_wm_3w1m', name: '3 Weekly & 1 Monthly', quantityLabel: '3 Weekly + 1 Monthly', price: 1250, originalPrice: 1250, promoLabel: '', imageUrl: '', active: true, displayOrder: 6},
      {id: 'pkg_wm_4w1m', name: '4 Weekly & 1 Monthly', quantityLabel: '4 Weekly + 1 Monthly', price: 1400, originalPrice: 1400, promoLabel: '', imageUrl: '', active: true, displayOrder: 7},
    ],
    active: true,
    featured: true,
    displayOrder: 2,
  },
  {
    id: 'prod_ff_level_up_bd',
    name: 'Level Up Pass BD',
    slug: 'level-up-pass-bd',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Level 6 to Level 30 & Full Level Up Pass packages for Bangladesh server UIDs.',
    description:
      'Unlock milestone diamond rewards by level on your Free Fire Bangladesh Server account. Choose individual level tiers or the Full 800 Diamond Level Up Pass.',
    instructions:
      '1. Check your current account level in Free Fire before choosing a milestone tier.\n2. Only works on Bangladesh server Player UIDs.\n3. Enter your exact Player UID and complete payment.',
    images: ['/src/assets/images/product_level_up_pass_1795611246612.jpg'],
    requiresUid: true,
    uidLabel: 'Free Fire UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_lvl_6', name: 'Level Up Pass - Level 6 - 120 Diamond', quantityLabel: 'Level 6', price: 43, originalPrice: 43, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_lvl_10', name: 'Level Up Pass - Level 10 - 200 Diamond', quantityLabel: 'Level 10', price: 77, originalPrice: 77, promoLabel: '', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_lvl_15', name: 'Level Up Pass - Level 15 - 200 Diamond', quantityLabel: 'Level 15', price: 77, originalPrice: 77, promoLabel: '', imageUrl: '', active: true, displayOrder: 3},
      {id: 'pkg_lvl_20', name: 'Level Up Pass - Level 20 - 200 Diamond', quantityLabel: 'Level 20', price: 77, originalPrice: 77, promoLabel: '', imageUrl: '', active: true, displayOrder: 4},
      {id: 'pkg_lvl_25', name: 'Level Up Pass - Level 25 - 200 Diamond', quantityLabel: 'Level 25', price: 77, originalPrice: 77, promoLabel: '', imageUrl: '', active: true, displayOrder: 5},
      {id: 'pkg_lvl_30', name: 'Level Up Pass - Level 30 - 200 Diamond', quantityLabel: 'Level 30', price: 105, originalPrice: 105, promoLabel: '', imageUrl: '', active: true, displayOrder: 6},
      {id: 'pkg_lvl_full', name: 'Level Up Pass - FULL - 800 Diamond', quantityLabel: 'Level 0', price: 430, originalPrice: 430, promoLabel: 'Full Pass', imageUrl: '', active: true, displayOrder: 7},
    ],
    active: true,
    featured: true,
    displayOrder: 3,
  },
  {
    id: 'prod_ff_indonesia',
    name: 'Indonesia UID TopUp 🇮🇩',
    slug: 'indonesia-uid-topup',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Fast Free Fire Indonesia server Diamond & Membership UID top-up.',
    description:
      'Top up Free Fire Indonesia server diamonds, Weekly, and Monthly memberships directly by Player UID.',
    instructions:
      '1. Make sure your Free Fire UID is on the Indonesia server.\n2. Select your desired Diamond or Membership pack.\n3. Enter your Player UID and complete payment.',
    images: ['/src/assets/images/product_ff_diamonds_1795604333340.jpg'],
    requiresUid: true,
    uidLabel: 'Player UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Indonesia'],
    packages: [
      {id: 'pkg_id_5', name: '5 Diamond', quantityLabel: '5 Diamond', price: 15, originalPrice: 15, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_id_50', name: '50 Diamond', quantityLabel: '50 Diamond', price: 70, originalPrice: 70, promoLabel: '', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_id_70', name: '70 Diamond', quantityLabel: '70 Diamond', price: 90, originalPrice: 90, promoLabel: '', imageUrl: '', active: true, displayOrder: 3},
      {id: 'pkg_id_140', name: '140 Diamond', quantityLabel: '140 Diamond', price: 180, originalPrice: 180, promoLabel: '', imageUrl: '', active: true, displayOrder: 4},
      {id: 'pkg_id_355', name: '355 Diamond', quantityLabel: '355 Diamond', price: 445, originalPrice: 445, promoLabel: '', imageUrl: '', active: true, displayOrder: 5},
      {id: 'pkg_id_720', name: '720 Diamond', quantityLabel: '720 Diamond', price: 890, originalPrice: 890, promoLabel: '', imageUrl: '', active: true, displayOrder: 6},
      {id: 'pkg_id_monthly', name: 'MONTHLY', quantityLabel: 'Monthly Membership', price: 800, originalPrice: 800, promoLabel: '', imageUrl: '', active: true, displayOrder: 7},
      {id: 'pkg_id_weekly', name: 'WEEKLY', quantityLabel: 'Weekly Membership', price: 260, originalPrice: 260, promoLabel: '', imageUrl: '', active: true, displayOrder: 8},
    ],
    active: true,
    featured: true,
    displayOrder: 4,
  },
  {
    id: 'prod_ff_level_up_id',
    name: 'Level Up Indonesia 🇮🇩',
    slug: 'level-up-indonesia',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Indonesia server Level Up Pass milestone packages by Player UID.',
    description:
      'Activate Level 6, Level 10, and Level 15 Level Up Pass milestone packages on Indonesia server Free Fire UIDs.',
    instructions:
      '1. Confirm your Free Fire UID belongs to the Indonesia server.\n2. Select your eligible Level Up tier.\n3. Enter your Free Fire UID and proceed to checkout.',
    images: ['/src/assets/images/product_level_up_pass_1795611246612.jpg'],
    requiresUid: true,
    uidLabel: 'Free Fire UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Indonesia'],
    packages: [
      {id: 'pkg_id_lvl_6', name: '6 Level = 120 Diamond', quantityLabel: 'Level 6', price: 50, originalPrice: 50, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_id_lvl_10', name: '10 Level = 200 Diamond', quantityLabel: 'Level 10', price: 85, originalPrice: 85, promoLabel: '', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_id_lvl_15', name: '15 Level = 200 Diamond', quantityLabel: 'Level 15', price: 85, originalPrice: 85, promoLabel: '', imageUrl: '', active: true, displayOrder: 3},
    ],
    active: true,
    featured: true,
    displayOrder: 5,
  },
  {
    id: 'prod_ff_free_diamond',
    name: 'ফ্রি ডায়মন্ড',
    slug: 'free-diamond',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'ফ্রি ফায়ার ডায়মন্ড ও মেম্বারশিপ প্যাকেজসমূহ (কয়েন রেফারেন্সসহ)।',
    description:
      'জনপ্রিয় ফ্রি ফায়ার ডায়মন্ড এবং মেম্বারশিপ প্যাকেজসমূহ সরাসরি আপনার Player UID তে ডেলিভারি।',
    instructions:
      '1. আপনার সঠিক Free Fire Player UID লিখুন।\n2. পছন্দের ডায়মন্ড বা মেম্বারশিপ প্যাকেজ সিলেক্ট করুন।\n3. চেকআউটে পেমেন্ট সম্পন্ন করুন।',
    images: ['/src/assets/images/product_ff_diamonds_1795604333340.jpg'],
    requiresUid: true,
    uidLabel: 'Player UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_fd_25', name: '25 Diamond', quantityLabel: '25 Diamond', price: 22, originalPrice: 22, promoLabel: '9000 Coins', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_fd_50', name: '50 Diamond', quantityLabel: '50 Diamond', price: 37, originalPrice: 37, promoLabel: '17000 Coins', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_fd_115', name: '115 Diamond', quantityLabel: '115 Diamond', price: 80, originalPrice: 80, promoLabel: '36000 Coins', imageUrl: '', active: true, displayOrder: 3},
      {id: 'pkg_fd_240', name: '240 Diamond', quantityLabel: '240 Diamond', price: 158, originalPrice: 158, promoLabel: '71000 Coins', imageUrl: '', active: true, displayOrder: 4},
      {id: 'pkg_fd_610', name: '610 Diamond', quantityLabel: '610 Diamond', price: 400, originalPrice: 400, promoLabel: '180000 Coins', imageUrl: '', active: true, displayOrder: 5},
      {id: 'pkg_fd_1240', name: '1240 Diamond', quantityLabel: '1240 Diamond', price: 800, originalPrice: 800, promoLabel: '360000 Coins', imageUrl: '', active: true, displayOrder: 6},
      {id: 'pkg_fd_weekly', name: 'Weekly Membership', quantityLabel: 'Weekly Membership', price: 156, originalPrice: 156, promoLabel: '71000 Coins', imageUrl: '', active: true, displayOrder: 7},
      {id: 'pkg_fd_monthly', name: 'Monthly', quantityLabel: 'Monthly Membership', price: 780, originalPrice: 780, promoLabel: '362000 Coins', imageUrl: '', active: true, displayOrder: 8},
      {id: 'pkg_fd_level_up', name: 'Level Up Pass', quantityLabel: 'Level Up Pass', price: 430, originalPrice: 430, promoLabel: '71000 Coins', imageUrl: '', active: true, displayOrder: 9},
      {id: 'pkg_fd_weekly_lite', name: 'Weekly lite', quantityLabel: 'Weekly lite', price: 45, originalPrice: 45, promoLabel: '16000 Coins', imageUrl: '', active: true, displayOrder: 10},
    ],
    active: true,
    featured: true,
    displayOrder: 6,
  },
  {
    id: 'prod_ff_weekly_lite',
    name: 'Weekly Lite Membership',
    slug: 'weekly-lite-membership',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Budget 7-day Free Fire diamond pass via Player UID.',
    description:
      'Affordable 7-day Weekly Lite pass delivered directly to your Free Fire UID. Ideal for daily claimers.',
    instructions:
      '1. Enter your Free Fire Player UID accurately.\n2. Select Weekly Lite duration.\n3. Complete payment to activate.',
    images: ['/src/assets/images/product_weekly_lite_1795611269551.jpg'],
    requiresUid: true,
    uidLabel: 'Free Fire Player UID',
    requiresServerId: false,
    serverLabel: 'Server',
    serverOptions: ['Bangladesh'],
    packages: [
      {id: 'pkg_wl_1x', name: 'Weekly LITE (1x)', quantityLabel: '7 Days Lite Pass', price: 45, originalPrice: 45, promoLabel: 'Popular', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_wl_2x', name: 'Weekly LITE (2x Stack)', quantityLabel: '14 Days Lite Pass', price: 90, originalPrice: 90, promoLabel: '', imageUrl: '', active: true, displayOrder: 2},
    ],
    active: true,
    featured: true,
    displayOrder: 7,
  },
  {
    id: 'prod_evo_voucher',
    name: 'Free Fire Voucher',
    slug: 'free-fire-voucher',
    categoryId: 'cat_free_fire',
    categoryName: 'Free Fire',
    shortDescription: 'Redeemable Free Fire / UniPin voucher pins & Evo Gun Access passes.',
    description:
      'Purchase official redeemable digital voucher pins and Evo Access passes. Delivered codes appear directly in your My Codes vault.',
    instructions:
      '1. Enter your Player UID or contact account ID.\n2. Choose your voucher denomination.\n3. Once completed, copy your pin from My Codes.',
    images: ['/src/assets/images/product_evo_voucher_1795604334150.jpg'],
    requiresUid: true,
    uidLabel: 'Player UID / Account ID',
    requiresServerId: true,
    serverLabel: 'Region / Server',
    serverOptions: ['Bangladesh', 'Singapore', 'Indonesia', 'Global'],
    packages: [
      {id: 'pkg_evo_3d', name: 'Evo Access 3 Days', quantityLabel: '3 Days Pass', price: 68, originalPrice: 80, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_evo_7d', name: 'Evo Access 7 Days', quantityLabel: '7 Days Pass', price: 115, originalPrice: 135, promoLabel: 'Popular', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_unipin_161', name: '161 UC / Voucher Pin', quantityLabel: 'Redeemable Code', price: 154, originalPrice: 175, promoLabel: 'Instant Pin', imageUrl: '', active: true, displayOrder: 3},
      {id: 'pkg_unipin_500', name: '500 Voucher Pin', quantityLabel: 'Redeemable Code', price: 475, originalPrice: 510, promoLabel: '', imageUrl: '', active: true, displayOrder: 4},
    ],
    active: true,
    featured: true,
    displayOrder: 8,
  },
  {
    id: 'prod_pubg_uc',
    name: 'PUBG UC TopUp',
    slug: 'pubg-uc-topup',
    categoryId: 'cat_battle_royale',
    categoryName: 'PUBG UC Buy',
    shortDescription: 'Fast PUBG Mobile Unknown Cash top-up by Character ID.',
    description:
      'Instant PUBG Mobile Global UC delivery via numeric Character ID. Supports Royal Pass upgrades, crates, and seasonal outfits.',
    instructions:
      '1. Copy your numeric PUBG Mobile Character ID.\n2. Select your UC pack and server region.\n3. Pay with Wallet Balance or submit bKash/Nagad TrxID.',
    images: ['/src/assets/images/product_pubg_uc_1795604334056.jpg'],
    requiresUid: true,
    uidLabel: 'PUBG Character ID',
    requiresServerId: true,
    serverLabel: 'Server Region',
    serverOptions: ['Global', 'Asia', 'Middle East', 'Europe'],
    packages: [
      {id: 'pkg_uc_60', name: '60 UC', quantityLabel: '60 UC', price: 120, originalPrice: 135, promoLabel: '', imageUrl: '', active: true, displayOrder: 1},
      {id: 'pkg_uc_325', name: '325 UC', quantityLabel: '300 + 25 Bonus UC', price: 590, originalPrice: 640, promoLabel: 'Popular', imageUrl: '', active: true, displayOrder: 2},
      {id: 'pkg_uc_660', name: '660 UC', quantityLabel: '600 + 60 Bonus UC', price: 1170, originalPrice: 1250, promoLabel: 'Royal Pass', imageUrl: '', active: true, displayOrder: 3},
    ],
    active: true,
    featured: true,
    displayOrder: 9,
  },
];

const INITIAL_PAYMENT_METHODS: Array<Omit<PaymentMethod, 'updatedAt'>> = [
  {
    id: 'pm_bkash',
    name: 'bKash',
    accountNumber: '01700-112233',
    accountType: 'Personal',
    instructions:
      '1. Open the bKash App and select "Send Money".\n2. Enter our bKash Personal number above and send the exact amount.\n3. Copy the Transaction ID (TrxID) and enter your sender number below.',
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
      '1. Open the Nagad App or dial *167# and choose "Send Money".\n2. Send the exact amount to the Nagad number above.\n3. Paste your Nagad Transaction ID (TrxID) and upload a screenshot if available.',
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
          subtitle: 'Verified bKash, Nagad & Wallet Balance top-ups delivered directly to your Free Fire ID.',
          imageUrl: '/src/assets/images/hero_battle_royale_1795604332736.jpg',
          linkUrl: '/product/free-fire-bd-server',
          active: true,
        },
        {
          id: 'banner_2',
          title: 'Weekly & Monthly VIP Memberships',
          subtitle: 'Save up to 18% on Free Fire Memberships, Level Up Pass BD, and Weekly Lite passes.',
          imageUrl: '/src/assets/images/promo_membership_banner_1795604332754.jpg',
          linkUrl: '/product/free-fire-membership',
          active: true,
        },
      ],
      promos: [
        {
          id: 'promo_1',
          title: 'Weekly Membership Bundle',
          description: 'Unlock daily diamonds with instant UID activation.',
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
      const prodRef = doc(db, 'products', prod.id);
      const existingSnap = await getDoc(prodRef);
      const createdAt = existingSnap.exists() ? existingSnap.data().createdAt || now : now;
      batch.set(prodRef, {
        ...prod,
        createdAt,
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

export async function syncRecommendedCatalog(
  actorEmail: string,
  actorRole: string = 'super_admin',
): Promise<void> {
  try {
    const now = serverTimestamp();

    // Commit categories (and default settings/payment methods if missing) first
    const baseBatch = writeBatch(db);
    const settingsRef = doc(db, 'settings', 'site');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      baseBatch.set(settingsRef, {
        ...DEFAULT_SITE_SHELL,
        noticeText: 'Fast UID Delivery Active · Verify your Player UID carefully before placing an order.',
        noticeActive: true,
        updatedAt: now,
      });
      for (const pm of INITIAL_PAYMENT_METHODS) {
        baseBatch.set(doc(db, 'paymentMethods', pm.id), {
          ...pm,
          updatedAt: now,
        });
      }
    }

    for (const cat of INITIAL_CATEGORIES) {
      baseBatch.set(doc(db, 'categories', cat.id), {
        ...cat,
        updatedAt: now,
      });
    }
    await baseBatch.commit();

    // Commit products + audit log in second batch
    const prodBatch = writeBatch(db);
    const prodNow = serverTimestamp();

    for (const prod of INITIAL_PRODUCTS) {
      const prodRef = doc(db, 'products', prod.id);
      const existingSnap = await getDoc(prodRef);
      const existingCreatedAt = existingSnap.exists() ? existingSnap.data()?.createdAt : null;
      prodBatch.set(prodRef, {
        ...prod,
        createdAt: existingCreatedAt || prodNow,
        updatedAt: prodNow,
      });
    }

    const logId = `sync_${Date.now()}`;
    prodBatch.set(doc(db, 'auditLogs', logId), {
      id: logId,
      actorEmail,
      actorRole,
      action: 'CATALOG_SYNCED',
      targetType: 'products',
      targetId: 'recommended',
      details: 'Synced default products and all diamond/membership packages.',
      createdAt: prodNow,
    });

    await prodBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'products');
  }
}
