import type { OrderStatus, PaymentMethod } from '../types.ts';

export function formatFcfa(amount: number | null | undefined): string {
  const safe = Math.round(Number(amount) || 0);
  return `${safe.toLocaleString('fr-FR')} FCFA`;
}

export function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPaymentMethod(method: PaymentMethod): string {
  switch (method) {
    case 'wave':
      return 'Wave Côte d’Ivoire';
    case 'orange_money':
      return 'Orange Money';
    case 'mobile_money':
      return 'Mobile Money (MTN / Moov)';
    case 'card':
      return 'Carte bancaire (Visa / Mastercard)';
  }
}

export function getOrderStatusLabel(status: OrderStatus): {
  label: string;
  toneClass: string;
} {
  switch (status) {
    case 'CONFIRMED':
      return { label: 'Confirmé', toneClass: 'text-emerald-400' };
    case 'UNDERPAID':
      return { label: 'Montant insuffisant', toneClass: 'text-rose-400' };
    case 'OVERPAID_REVIEW':
      return { label: 'En vérification (surplus)', toneClass: 'text-amber-400' };
    case 'FAILED':
      return { label: 'Échoué / Refusé', toneClass: 'text-rose-400' };
    case 'PENDING':
    default:
      return { label: 'En attente', toneClass: 'text-amber-300' };
  }
}
