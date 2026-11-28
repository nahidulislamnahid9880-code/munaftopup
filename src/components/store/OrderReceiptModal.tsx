import {useState} from 'react';
import {CheckCircle2, Download, FileText, Image as ImageIcon, Printer, X} from 'lucide-react';
import {formatCurrency, timestampToMillis} from '../../lib/firebase';
import type {Order} from '../../types';

function formatReceiptDateTime(ts: unknown): string {
  const ms = timestampToMillis(ts);
  if (!ms) return new Date().toLocaleString('en-GB');
  return new Date(ms).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildOrderInvoiceHtml(order: Order, brandName: string): string {
  const safeBrand = escapeHtml(brandName || 'MUNAFTOPUP.bd');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Receipt ${escapeHtml(order.orderNumber)} — ${safeBrand}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px; }
    .card { max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 24px 28px; display: flex; justify-content: space-between; align-items: center; }
    .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    .badge { font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px; background: rgba(34,211,238,0.16); color: #22d3ee; text-transform: uppercase; }
    .body { padding: 24px 28px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
    td.label { color: #64748b; }
    td.val { text-align: right; font-weight: 600; color: #0f172a; }
    .pin { margin-top: 18px; padding: 14px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; }
    .pin-label { font-size: 11px; font-weight: 700; color: #047857; text-transform: uppercase; }
    .pin-val { font-family: ui-monospace, monospace; font-size: 18px; font-weight: 800; color: #064e3b; margin-top: 4px; }
    .total { margin-top: 20px; padding: 16px; background: #f1f5f9; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 18px; }
    .footer { padding: 16px 28px 24px; font-size: 12px; color: #64748b; text-align: center; }
    @media print { body { background: #ffffff; padding: 0; } .card { border: none; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <div style="font-size:11px;color:#22d3ee;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Official Digital Receipt</div>
        <div class="brand">${safeBrand}</div>
      </div>
      <div class="badge">${escapeHtml(order.orderStatus)}</div>
    </div>
    <div class="body">
      <table>
        <tr><td class="label">Order Number</td><td class="val">${escapeHtml(order.orderNumber)}</td></tr>
        <tr><td class="label">Date &amp; Time</td><td class="val">${escapeHtml(formatReceiptDateTime(order.createdAt))}</td></tr>
        <tr><td class="label">Product</td><td class="val">${escapeHtml(order.productName)}</td></tr>
        <tr><td class="label">Package</td><td class="val">${escapeHtml(order.packageName)}</td></tr>
        <tr><td class="label">Player UID / Target</td><td class="val">${escapeHtml(order.playerUid)}${order.serverId && order.serverId !== 'N/A' ? ` (${escapeHtml(order.serverId)})` : ''}</td></tr>
        ${order.playerIgn ? `<tr><td class="label">Player Nickname (IGN)</td><td class="val">${escapeHtml(order.playerIgn)}</td></tr>` : ''}
        <tr><td class="label">Customer</td><td class="val">${escapeHtml(order.customerName || order.customerEmail || 'Valued Gamer')}</td></tr>
        <tr><td class="label">Payment Method</td><td class="val">${escapeHtml(order.paymentMethodName)} (${escapeHtml(order.paymentStatus)})</td></tr>
        <tr><td class="label">Transaction ID</td><td class="val">${escapeHtml(order.trxId || 'N/A')}</td></tr>
      </table>
      ${
        order.voucherCode
          ? `<div class="pin"><div class="pin-label">Delivered Voucher / PIN</div><div class="pin-val">${escapeHtml(order.voucherCode)}</div></div>`
          : ''
      }
      <div class="total"><span>Total Paid</span><span>৳${Number(order.totalAmount || 0).toFixed(2)} BDT</span></div>
    </div>
    <div class="footer">Verified receipt issued by ${safeBrand}. Thank you for your order!</div>
  </div>
</body>
</html>`;
}

function downloadOrderInvoiceHtml(order: Order, brandName: string) {
  const html = buildOrderInvoiceHtml(order, brandName);
  const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receipt-${order.orderNumber}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printOrderInvoice(order: Order, brandName: string) {
  const html = buildOrderInvoiceHtml(order, brandName);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1200);
    }, 150);
  } else {
    iframe.remove();
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

interface Props {
  order: Order;
  brandName: string;
  onClose: () => void;
}

export function OrderReceiptModal({order, brandName, onClose}: Props) {
  const [downloadingPng, setDownloadingPng] = useState(false);

  const handleDownloadPng = async () => {
    setDownloadingPng(true);
    try {
      const canvas = document.createElement('canvas');
      const W = 1080;
      const H = 1380;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Dark clean background
      ctx.fillStyle = '#090f1d';
      ctx.fillRect(0, 0, W, H);

      // Top brand accent strip
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#06b6d4');
      grad.addColorStop(1, '#10b981');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, 14);

      // Main card container
      drawRoundedRect(ctx, 56, 56, W - 112, H - 112, 28);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      // Header
      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('OFFICIAL DIGITAL RECEIPT', 104, 130);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 46px sans-serif';
      ctx.fillText(brandName || 'MUNAFTOPUP.bd', 104, 190);

      // Status pill in canvas (single clear status marker)
      const isDone = order.orderStatus === 'completed';
      drawRoundedRect(ctx, W - 330, 118, 224, 54, 14);
      ctx.fillStyle = isDone ? 'rgba(16, 185, 129, 0.16)' : 'rgba(6, 182, 212, 0.16)';
      ctx.fill();
      ctx.strokeStyle = isDone ? '#10b981' : '#06b6d4';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = isDone ? '#34d399' : '#22d3ee';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(order.orderStatus.toUpperCase(), W - 218, 153);
      ctx.textAlign = 'left';

      // Divider
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(104, 232);
      ctx.lineTo(W - 104, 232);
      ctx.stroke();

      // Rows
      const rows: Array<[string, string]> = [
        ['Order Reference', order.orderNumber],
        ['Date & Time', formatReceiptDateTime(order.createdAt)],
        ['Product', order.productName],
        ['Package', order.packageName],
        ['Player UID / Target', `${order.playerUid}${order.serverId && order.serverId !== 'N/A' ? ` (${order.serverId})` : ''}`],
        ...(order.playerIgn ? [['Player Nickname (IGN)', order.playerIgn] as [string, string]] : []),
        ['Customer', order.customerName || order.customerEmail || 'Valued Gamer'],
        ['Payment Method', `${order.paymentMethodName} (${order.paymentStatus.toUpperCase()})`],
        ['Transaction ID', order.trxId || 'N/A'],
        ...(order.couponCode ? [['Coupon Discount', `${order.couponCode} (-৳${order.couponDiscount || 0})`] as [string, string]] : []),
        ...(order.tierDiscount ? [['VIP / Reseller Discount', `-৳${order.tierDiscount}`] as [string, string]] : []),
        ...(order.flashSaleDiscount ? [['Flash Sale Savings', `-৳${order.flashSaleDiscount}`] as [string, string]] : []),
      ];

      let y = 292;
      for (const [label, value] of rows) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '24px sans-serif';
        ctx.fillText(label, 104, y);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 25px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(value).slice(0, 42), W - 104, y);
        ctx.textAlign = 'left';

        ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(104, y + 22);
        ctx.lineTo(W - 104, y + 22);
        ctx.stroke();
        y += 66;
      }

      // Voucher PIN box if delivered
      if (order.voucherCode) {
        drawRoundedRect(ctx, 104, y + 6, W - 208, 92, 16);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
        ctx.fill();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#6ee7b7';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('DELIVERED VOUCHER / PIN CODE', 132, y + 40);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px monospace';
        ctx.fillText(order.voucherCode.slice(0, 38), 132, y + 78);
        y += 120;
      }

      // Total Paid Hero Box
      const totalBoxY = Math.max(y + 18, 1070);
      drawRoundedRect(ctx, 104, totalBoxY, W - 208, 120, 20);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('TOTAL AMOUNT PAID', 136, totalBoxY + 52);
      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 52px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`৳${Number(order.totalAmount || 0).toFixed(0)} BDT`, W - 136, totalBoxY + 76);
      ctx.textAlign = 'left';

      // Footer
      ctx.fillStyle = '#64748b';
      ctx.font = '20px sans-serif';
      ctx.fillText('Verified digital receipt — Share safely on WhatsApp or Telegram.', 104, H - 88);

      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `Receipt-${order.orderNumber}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloadingPng(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden my-auto">
        <div className="bg-slate-950 text-white px-5 py-4 flex items-center justify-between border-b border-cyan-500/30">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">
              WhatsApp / Telegram Receipt
            </p>
            <h3 className="text-base font-extrabold font-display">
              {brandName} · <span className="font-mono text-cyan-300">{order.orderNumber}</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <CheckCircle2
                className={`w-5 h-5 ${
                  order.orderStatus === 'completed' ? 'text-emerald-500' : 'text-cyan-500'
                }`}
              />
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Order Status</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white uppercase">
                  {order.orderStatus} · {order.paymentStatus}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 dark:text-slate-400">Total Paid</p>
              <p className="text-lg font-extrabold text-cyan-600 dark:text-cyan-400 tabular-nums">
                {formatCurrency(order.totalAmount)}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs sm:text-sm">
            <div className="py-2 flex justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">Date & Time</span>
              <span className="font-semibold text-slate-900 dark:text-white text-right">
                {formatReceiptDateTime(order.createdAt)}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">Service / Package</span>
              <span className="font-semibold text-slate-900 dark:text-white text-right">
                {order.productName} · {order.packageName}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">Player UID</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white text-right">
                {order.playerUid}
                {order.serverId && order.serverId !== 'N/A' ? ` (${order.serverId})` : ''}
              </span>
            </div>
            {order.playerIgn && (
              <div className="py-2 flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Verified Nickname</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 text-right">
                  {order.playerIgn}
                </span>
              </div>
            )}
            <div className="py-2 flex justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">Payment & TrxID</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white text-right">
                {order.paymentMethodName} · {order.trxId}
              </span>
            </div>
            {order.voucherCode && (
              <div className="py-2 flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Delivered PIN</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-right">
                  {order.voucherCode}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            <button
              type="button"
              disabled={downloadingPng}
              onClick={handleDownloadPng}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors">
              <ImageIcon className="w-4 h-4 shrink-0" />
              <span>{downloadingPng ? 'Rendering...' : 'PNG Image'}</span>
            </button>
            <button
              type="button"
              onClick={() => printOrderInvoice(order, brandName)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-600 hover:bg-slate-800 dark:hover:bg-cyan-500 text-white text-xs font-bold cursor-pointer transition-colors">
              <Printer className="w-4 h-4 shrink-0" />
              <span>Save PDF / Print</span>
            </button>
            <button
              type="button"
              onClick={() => downloadOrderInvoiceHtml(order, brandName)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer transition-colors">
              <FileText className="w-4 h-4 shrink-0" />
              <span>HTML Receipt</span>
            </button>
          </div>
          <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
            <Download className="w-3.5 h-3.5" /> PNG Receipt is formatted for instant sharing on WhatsApp & Telegram.
          </p>
        </div>
      </div>
    </div>
  );
}
