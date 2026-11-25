import type {ContactInfo} from '../types';

export function resolveWhatsAppHref(contact?: Partial<ContactInfo>): string {
  const raw = (contact?.whatsapp || '').trim();
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    const digits = raw.replace(/\D/g, '');
    if (digits) {
      const normalized = digits.startsWith('01') && digits.length === 11 ? `88${digits}` : digits;
      return `https://wa.me/${normalized}`;
    }
  }
  const phone = (contact?.phone || '').trim();
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits && phoneDigits !== '8801700000000' && phoneDigits !== '01700000000') {
    const normalized =
      phoneDigits.startsWith('01') && phoneDigits.length === 11 ? `88${phoneDigits}` : phoneDigits;
    return `https://wa.me/${normalized}`;
  }
  return '';
}

export function resolveTelegramHref(contact?: Partial<ContactInfo>): string {
  const raw = (contact?.telegram || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@+/, '').replace(/^t\.me\//i, '').trim();
  return handle ? `https://t.me/${handle}` : '';
}
