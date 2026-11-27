import type {CustomerTier, FlashSale, StoreProgramConfig} from '../types';

export const DEFAULT_PROGRAM_CONFIG: StoreProgramConfig = {
  vipSpendThreshold: 5000,
  vipDiscountPercent: 2,
  resellerSpendThreshold: 20000,
  resellerDiscountPercent: 5,
  referralBonusAmount: 20,
  loyaltyPercent: 1,
  loyaltyPointValueBdt: 1,
  fraudMaxFailedTrxPerHour: 5,
  fraudMaxOrdersPer10Min: 4,
  gatewayEnabled: false,
  gatewayProvider: 'none',
};

export function isFlashSaleActive(sale: FlashSale | undefined | null, nowMs = Date.now()): boolean {
  if (!sale || !sale.active) return false;
  if (!(Number(sale.discountPercent || 0) > 0 && Number(sale.discountPercent || 0) <= 90)) return false;
  const startsMs = sale.startsAt ? Date.parse(sale.startsAt) : 0;
  const endsMs = sale.endsAt ? Date.parse(sale.endsAt) : 0;
  if (Number.isFinite(startsMs) && startsMs > 0 && nowMs < startsMs) return false;
  if (Number.isFinite(endsMs) && endsMs > 0 && nowMs > endsMs) return false;
  return true;
}

export function getActiveFlashSaleForProduct(
  flashSales: FlashSale[],
  productId: string,
  nowMs = Date.now(),
): FlashSale | null {
  if (!productId) return null;
  const matches = flashSales.filter(
    (sale) => sale.productId === productId && isFlashSaleActive(sale, nowMs),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => Number(b.discountPercent || 0) - Number(a.discountPercent || 0))[0];
}

export interface PackagePricingBreakdown {
  basePrice: number;
  flashSaleDiscount: number;
  flashSalePercent: number;
  afterFlashPrice: number;
  tierDiscount: number;
  tierPercent: number;
  appliedTier: CustomerTier;
  finalPriceBeforeCoupon: number;
  hasDiscount: boolean;
  estimatedLoyaltyPoints: number;
}

export function calculatePackagePricing(
  basePrice: number,
  activeFlashSale: FlashSale | null,
  tier: CustomerTier | undefined,
  programConfig: StoreProgramConfig,
): PackagePricingBreakdown {
  const safeBase = Math.max(0, Number(basePrice || 0));
  const flashSalePercent = activeFlashSale ? Number(activeFlashSale.discountPercent || 0) : 0;
  const flashSaleDiscount =
    flashSalePercent > 0 ? Number(((safeBase * flashSalePercent) / 100).toFixed(2)) : 0;
  const afterFlashPrice = Math.max(1, Number((safeBase - flashSaleDiscount).toFixed(2)));

  const appliedTier: CustomerTier =
    tier === 'reseller' ? 'reseller' : tier === 'vip' ? 'vip' : 'regular';
  const tierPercent =
    appliedTier === 'reseller'
      ? Number(programConfig.resellerDiscountPercent || 0)
      : appliedTier === 'vip'
        ? Number(programConfig.vipDiscountPercent || 0)
        : 0;
  const tierDiscount =
    tierPercent > 0 ? Number(((afterFlashPrice * tierPercent) / 100).toFixed(2)) : 0;
  const finalPriceBeforeCoupon = Math.max(1, Number((afterFlashPrice - tierDiscount).toFixed(2)));
  const hasDiscount = finalPriceBeforeCoupon < safeBase;

  const loyaltyPct = Math.max(0, Number(programConfig.loyaltyPercent || 0));
  const estimatedLoyaltyPoints =
    loyaltyPct > 0 ? Math.floor((finalPriceBeforeCoupon * loyaltyPct) / 100) : 0;

  return {
    basePrice: safeBase,
    flashSaleDiscount,
    flashSalePercent,
    afterFlashPrice,
    tierDiscount,
    tierPercent,
    appliedTier,
    finalPriceBeforeCoupon,
    hasDiscount,
    estimatedLoyaltyPoints,
  };
}

export function calculateCountdownParts(endsAt: string | undefined, nowMs = Date.now()) {
  if (!endsAt) return null;
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(endMs) || endMs <= nowMs) return null;
  const totalSec = Math.floor((endMs - nowMs) / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return {days, hours, minutes, seconds, totalSec};
}

export function validatePlayerUidForProduct(productName: string, playerUid: string): string | null {
  const cleaned = playerUid.trim();
  if (!cleaned) return 'Please enter your Player UID.';
  const looksNumericGame = /free\s*fire|pubg|mobile\s*legends|mlbb|\bff\b/i.test(productName || '');
  if (looksNumericGame && !/^\d{5,15}$/.test(cleaned)) {
    return 'Player UID must be 5 to 15 digits (numbers only) for this game.';
  }
  if (cleaned.length < 4) {
    return 'Player UID must be at least 4 characters.';
  }
  return null;
}
