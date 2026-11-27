import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { OrderRecord, PaymentMethod, ReceiptData, SavedLocalOrder, VideoItem } from '../types.ts';
import { formatDateFr, formatFcfa, formatPaymentMethod, getOrderStatusLabel } from '../utils/format.ts';

interface CheckoutModalProps {
  video: VideoItem | null;
  accentColor: string;
  onClose: () => void;
  onOrderSaved: (saved: SavedLocalOrder) => void;
}

const PAYMENT_OPTIONS: Array<{ id: PaymentMethod; label: string; sub: string }> = [
  { id: 'wave', label: 'Wave', sub: 'Paiement mobile instantané Côte d’Ivoire' },
  { id: 'orange_money', label: 'Orange Money', sub: 'Validation USSD / Max it' },
  { id: 'mobile_money', label: 'Mobile Money', sub: 'MTN MoMo & Moov Money' },
  { id: 'card', label: 'Carte bancaire', sub: 'Visa / Mastercard sécurisée (XOF)' },
];

export function CheckoutModal({
  video,
  accentColor,
  onClose,
  onOrderSaved,
}: CheckoutModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wave');
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountFcfa: number;
    finalAmount: number;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [cinetPayConfigured, setCinetPayConfigured] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (!video) return null;

  const basePrice = video.promo_price_fcfa ?? video.price_fcfa;
  const finalAmount = appliedPromo ? appliedPromo.finalAmount : basePrice;

  async function handleApplyPromo() {
    if (!video || !promoInput.trim()) return;
    setPromoError(null);
    try {
      const resp = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.id, code: promoInput.trim() }),
      });
      const data = (await resp.json()) as {
        valid?: boolean;
        code?: string;
        discountFcfa?: number;
        finalAmount?: number;
        error?: string;
      };
      if (!resp.ok || !data.valid) {
        setPromoError(data.error || 'Code promo invalide.');
        setAppliedPromo(null);
      } else {
        setAppliedPromo({
          code: data.code!,
          discountFcfa: data.discountFcfa!,
          finalAmount: data.finalAmount!,
        });
      }
    } catch {
      setPromoError('Impossible de vérifier le code promo.');
    }
  }

  async function handleCreateOrder(e: FormEvent) {
    e.preventDefault();
    if (!video) return;
    setError(null);
    setSubmitting(true);

    try {
      const resp = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          customerName,
          customerPhone,
          customerEmail,
          paymentMethod,
          promoCode: appliedPromo?.code || undefined,
        }),
      });
      const data = (await resp.json()) as {
        order?: OrderRecord;
        paymentUrl?: string | null;
        cinetPayConfigured?: boolean;
        providerError?: string | null;
        error?: string;
      };

      if (!resp.ok || !data.order) {
        setError(data.error || 'Erreur lors de la création de commande.');
        return;
      }

      setOrder(data.order);
      setPaymentUrl(data.paymentUrl || null);
      setCinetPayConfigured(Boolean(data.cinetPayConfigured));
      if (data.providerError) {
        setError(`Prestataire CinetPay : ${data.providerError}`);
      }

      onOrderSaved({
        orderNumber: data.order.order_number,
        identity: customerPhone.trim(),
        videoTitle: video.title,
        amountFcfa: data.order.expected_amount_fcfa,
        createdAt: data.order.created_at,
      });
    } catch {
      setError('Erreur réseau lors de l’initialisation du paiement.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckServerStatus() {
    if (!order) return;
    setVerifying(true);
    try {
      const resp = await fetch(`/api/orders/${encodeURIComponent(order.order_number)}/verify`, {
        method: 'POST',
      });
      const data = (await resp.json()) as {
        order?: OrderRecord;
        downloadToken?: string | null;
      };
      if (data.order) {
        setOrder(data.order);
        if (data.order.status === 'CONFIRMED') {
          const recResp = await fetch(
            `/api/orders/${encodeURIComponent(data.order.order_number)}/receipt`
          );
          const recData = (await recResp.json()) as { receipt?: ReceiptData };
          if (recData.receipt) setReceipt(recData.receipt);
        }
      }
    } finally {
      setVerifying(false);
    }
  }

  const statusMeta = order ? getOrderStatusLabel(order.status) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Paiement sécurisé en FCFA"
    >
      <div className="relative w-full max-w-2xl bg-[#111116] border border-white/10 sm:rounded-2xl overflow-hidden my-auto max-h-screen sm:max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10 bg-[#0D0D11]">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              {order ? `Commande ${order.order_number}` : 'Achat sans création de compte'}
            </h2>
            <p className="text-xs text-zinc-400">
              Devise officielle XOF (FCFA) · Vérification serveur obligatoire
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 space-y-5">
          {!order ? (
            <form onSubmit={handleCreateOrder} className="space-y-5">
              {/* Product Recap */}
              <div className="p-4 rounded-xl bg-[#16161D] border border-white/10 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-400">
                    {video.category_name} · {video.duration_label}
                  </p>
                  <p className="text-base font-semibold text-white truncate">{video.title}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono tabular-nums text-lg font-bold text-white">
                    {formatFcfa(finalAmount)}
                  </p>
                  {appliedPromo && (
                    <p className="text-xs text-emerald-400 font-mono tabular-nums">
                      -{formatFcfa(appliedPromo.discountFcfa)} ({appliedPromo.code})
                    </p>
                  )}
                </div>
              </div>

              {/* Customer Info without account creation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">Nom complet *</span>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Ex. Kouadio Serge"
                    className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white placeholder:text-zinc-500"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">
                    Téléphone Wave / Mobile Money *
                  </span>
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+225 07 00 00 00 00"
                    className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white placeholder:text-zinc-500"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-300">
                  Adresse e-mail (optionnelle, pour retrouver votre reçu)
                </span>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="nom@exemple.ci"
                  className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white placeholder:text-zinc-500"
                />
              </label>

              {/* Promo Code */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-zinc-300">Code promotionnel</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="Ex. BIENVENUE20"
                    className="flex-1 min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white uppercase placeholder:normal-case placeholder:text-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    className="min-h-[44px] px-4 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
                  >
                    Appliquer
                  </button>
                </div>
                {promoError && <p className="text-xs text-rose-400">{promoError}</p>}
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <span className="text-xs font-medium text-zinc-300">
                  Moyen de paiement Côte d’Ivoire (XOF)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {PAYMENT_OPTIONS.map((opt) => {
                    const selected = paymentMethod === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPaymentMethod(opt.id)}
                        className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex items-start gap-3 ${
                          selected
                            ? 'bg-white/10 border-white/50'
                            : 'bg-[#16161D] border-white/10 hover:border-white/25'
                        }`}
                      >
                        {opt.id === 'card' ? (
                          <CreditCard className="w-5 h-5 text-zinc-200 shrink-0 mt-0.5" />
                        ) : (
                          <Smartphone className="w-5 h-5 text-zinc-200 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="text-sm font-semibold text-white">{opt.label}</div>
                          <div className="text-xs text-zinc-400">{opt.sub}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {error}
                </div>
              )}

              <div className="pt-2 space-y-2.5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] px-5 py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 font-mono tabular-nums"
                  style={{ backgroundColor: accentColor }}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {submitting
                      ? 'Initialisation sécurisée...'
                      : `Confirmer et payer · ${formatFcfa(finalAmount)}`}
                  </span>
                </button>
                <p className="text-[11px] text-zinc-400 text-center">
                  Le téléchargement de la vidéo originale est débloqué uniquement après validation du montant exact en XOF par le prestataire.
                </p>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              {/* Live Server Verification Status Banner */}
              <div className="p-4 rounded-xl bg-[#16161D] border border-white/15 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {order.status === 'CONFIRMED' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    )}
                    {order.status === 'PENDING' && (
                      <Clock className="w-5 h-5 text-amber-300 shrink-0" />
                    )}
                    {order.status === 'OVERPAID_REVIEW' && (
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    )}
                    {(order.status === 'UNDERPAID' || order.status === 'FAILED') && (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                    <span className={`text-sm font-semibold ${statusMeta?.toneClass}`}>
                      {statusMeta?.label}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-zinc-400">{order.transaction_ref}</span>
                </div>

                <p className="text-sm text-white font-medium">{order.status_message}</p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs text-zinc-400 border-t border-white/10">
                  <div>
                    <span>Demandé : </span>
                    <strong className="text-zinc-200 font-mono tabular-nums">
                      {formatFcfa(order.expected_amount_fcfa)}
                    </strong>
                  </div>
                  <div>
                    <span>Reçu : </span>
                    <strong className="text-zinc-200 font-mono tabular-nums">
                      {formatFcfa(order.received_amount_fcfa)}
                    </strong>
                  </div>
                  <div>
                    <span>Mode : </span>
                    <strong className="text-zinc-200">{formatPaymentMethod(order.payment_method)}</strong>
                  </div>
                </div>
              </div>

              {/* Payment Action if not yet confirmed */}
              {order.status !== 'CONFIRMED' && (
                <div className="space-y-3">
                  {cinetPayConfigured && paymentUrl ? (
                    <a
                      href={paymentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full min-h-[46px] px-5 py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2"
                      style={{ backgroundColor: accentColor }}
                    >
                      <span>Ouvrir le guichet de paiement sécurisé (CinetPay XOF)</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  ) : (
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 space-y-1.5">
                      <p className="font-semibold">
                        Passerelle CinetPay prête pour configuration production
                      </p>
                      <p className="text-amber-200/80">
                        Votre commande <span className="font-mono">{order.order_number}</span> est enregistrée en attente. Configurez{' '}
                        <span className="font-mono">CINETPAY_API_KEY</span> et{' '}
                        <span className="font-mono">CINETPAY_SITE_ID</span> côté serveur pour activer le guichet Wave / Orange Money / Carte en direct, ou testez les 5 scénarios de vérification depuis l’onglet Administration.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCheckServerStatus}
                    disabled={verifying}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium text-white flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${verifying ? 'animate-spin' : ''}`} />
                    <span>Vérifier le statut du paiement auprès du serveur</span>
                  </button>
                </div>
              )}

              {/* Confirmed Receipt & Unlocked Secure Download */}
              {order.status === 'CONFIRMED' && receipt && (
                <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-emerald-300 font-medium">Reçu officiel de paiement</p>
                      <p className="font-mono text-base font-bold text-white">
                        {receipt.receiptNumber || order.order_number}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-300">{formatDateFr(receipt.confirmedAt)}</p>
                  </div>

                  <div className="text-xs text-zinc-300 space-y-1 border-t border-white/10 pt-3">
                    <p>
                      Client : <strong className="text-white">{receipt.customerName}</strong> ({receipt.customerPhone})
                    </p>
                    <p>
                      Vidéo : <strong className="text-white">{receipt.videoTitle}</strong> ({receipt.durationLabel})
                    </p>
                    <p>
                      Montant payé :{' '}
                      <strong className="text-white font-mono tabular-nums">
                        {formatFcfa(receipt.receivedAmountFcfa)} ({receipt.currency})
                      </strong>
                    </p>
                  </div>

                  {receipt.downloadToken && (
                    <a
                      href={`/api/downloads/${encodeURIComponent(receipt.downloadToken)}`}
                      className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        Télécharger la vidéo originale ({receipt.downloadsUsed}/{receipt.maxDownloads} téléchargements utilisés)
                      </span>
                    </a>
                  )}

                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {receipt.licenseNotice} Conservez votre numéro de commande{' '}
                    <span className="font-mono text-zinc-200">{receipt.orderNumber}</span> pour re-télécharger le fichier depuis « Mes achats ».
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
