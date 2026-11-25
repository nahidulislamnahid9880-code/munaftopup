export interface BannerItem {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  linkUrl: string;
  active: boolean;
}

export interface PromoOffer {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  code: string;
  discountText: string;
  active: boolean;
}

export interface HomepageSectionsConfig {
  showFeatured: boolean;
  showCategories: boolean;
  showPromos: boolean;
  showHowItWorks: boolean;
  featuredTitle: string;
  categoriesTitle: string;
}

export interface ContactInfo {
  email: string;
  phone: string;
  whatsapp: string;
  telegram: string;
  supportHours: string;
  address: string;
}

export interface SocialLinks {
  facebook: string;
  instagram: string;
  youtube: string;
  discord: string;
  tiktok: string;
}

export interface SiteSettings {
  brandName: string;
  brandTagline: string;
  logoUrl: string;
  faviconUrl: string;
  noticeText: string;
  noticeActive: boolean;
  heroTitle: string;
  heroSubtitle: string;
  heroCtaText: string;
  heroCtaLink: string;
  banners: BannerItem[];
  promos: PromoOffer[];
  homepageSections: HomepageSectionsConfig;
  contact: ContactInfo;
  socials: SocialLinks;
  footerText: string;
  termsContent: string;
  privacyContent: string;
  updatedAt?: unknown;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  displayOrder: number;
  active: boolean;
  updatedAt?: unknown;
}

export interface DiamondPackage {
  id: string;
  name: string;
  quantityLabel: string;
  price: number;
  originalPrice: number;
  promoLabel: string;
  imageUrl: string;
  active: boolean;
  displayOrder: number;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  shortDescription: string;
  description: string;
  instructions: string;
  images: string[];
  requiresUid: boolean;
  uidLabel: string;
  requiresServerId: boolean;
  serverLabel: string;
  serverOptions: string[];
  packages: DiamondPackage[];
  active: boolean;
  featured: boolean;
  displayOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentMethod {
  id: string;
  name: string;
  accountNumber: string;
  accountType: 'Personal' | 'Merchant' | 'Agent';
  instructions: string;
  logoUrl: string;
  active: boolean;
  displayOrder: number;
  updatedAt?: unknown;
}

export type PaymentStatus = 'pending' | 'verified' | 'rejected';
export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';

export interface Order {
  id: string;
  orderNumber: string;
  customerUid: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productId: string;
  productName: string;
  productImage?: string;
  packageId: string;
  packageName: string;
  quantityLabel: string;
  unitPrice: number;
  totalAmount: number;
  playerUid: string;
  serverId: string;
  paymentType?: 'manual' | 'wallet';
  paymentMethodId: string;
  paymentMethodName: string;
  senderNumber: string;
  trxId: string;
  trxKey: string;
  screenshotUrl: string;
  voucherCode?: string;
  walletRefunded?: boolean;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  adminNote: string;
  notificationMessage: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
}

export interface WalletTopup {
  id: string;
  customerUid: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  paymentMethodId: string;
  paymentMethodName: string;
  senderNumber: string;
  trxId: string;
  trxKey: string;
  screenshotUrl: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OrderTracking {
  orderNumber: string;
  productName: string;
  packageName: string;
  playerUidMasked: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  notificationMessage: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CustomerProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  phone: string;
  walletBalance: number;
  suspended: boolean;
  suspendedReason: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SupportTicket {
  id: string;
  customerUid: string;
  customerName: string;
  customerEmail: string;
  orderNumber: string;
  subject: string;
  message: string;
  status: 'open' | 'replied' | 'closed';
  adminReply: string;
  repliedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentHistoryEntry {
  id: string;
  orderId: string;
  orderNumber: string;
  trxId: string;
  paymentMethodName: string;
  senderNumber: string;
  amount: number;
  action: 'approved' | 'rejected';
  note: string;
  adminEmail: string;
  createdAt?: unknown;
}

export interface StaffPermissions {
  products: boolean;
  orders: boolean;
  payments: boolean;
  customers: boolean;
  customization: boolean;
  settings: boolean;
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'sub_admin';
  active: boolean;
  permissions: StaffPermissions;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLogEntry {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt?: unknown;
}

export interface CustomerNotification {
  id: string;
  customerUid: string;
  orderId: string;
  orderNumber: string;
  title: string;
  message: string;
  read: boolean;
  createdAt?: unknown;
}

export interface AdminSessionUser {
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'sub_admin';
  permissions: StaffPermissions;
}
