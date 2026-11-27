import { Download, FileCheck2, Receipt, RefreshCw, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { OrderRecord, SavedLocalOrder } from '../types.ts';
import { formatDateFr, formatFcfa, formatPaymentMethod, getOrderStatusLabel } from '../utils/format.ts';

interface CustomerOrdersViewProps {
  accentColor: string;
  savedOrders: SavedLocalOrder[];
}

interface LookupResult {
  order: OrderRecord;
  downloadInfo: {
    token: string;
    downloadsUsed: number;
    maxDownloads: number;
    expiresAt: string;
  } | null;
}

export function CustomerOrdersView({ accentColor, savedOrders }: CustomerOrdersViewProps) {
  const [orderNumber, setOrderNumber] = useState('');
  const [identity, setIdentity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function lookupOrder(num: string, idVal: string) {
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/orders/lookup?orderNumber=${encodeURIComponent(num)}&identity=${encodeURIComponent(idVal)}`
      );
      const data = (await resp.json()) as LookupResult & { error?: string };
      if (!resp.ok || !data.order) {
        setError(data.error || 'Commande introuvable.');
        setResult(null);
      } else {
        setResult(data);
      }
    } catch {
      setError('Erreur réseau lors de la vérification.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    lookupOrder(orderNumber.trim(), identity.trim());
  }

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
          Mes achats & Récupération de commande
        </h1>
        <p className="text-sm text-zinc-400 max-w-2xl">
          Aucun compte n’est requis. Retrouvez votre reçu et vos liens de téléchargement personnels après vérification de votre identité.
        </p>
      </div>

      {/* Recovery Form */}
      <form
        onSubmit={handleSubmit}
        className="p-5 sm:p-6 rounded-2xl bg-[#141419] border border-white/10 space-y-4"
      >
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Search className="w-4 h-4 text-zinc-400" />
          <span>Retrouver une commande perdue</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-300">Numéro de commande ou référence</span>
            <input
              type="text"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="Ex. CMD-2026-A1B2C3"
              className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white font-mono placeholder:font-sans placeholder:text-zinc-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-300">Téléphone ou e-mail utilisé lors de l’achat</span>
            <input
              type="text"
              required
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="Ex. +225 07 00 00 00 00"
              className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white placeholder:text-zinc-500"
            />
          </label>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] px-5 py-2.5 rounded-lg text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: accentColor }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Vérifier et afficher ma commande</span>
        </button>
      </form>

      {/* Found Order Result */}
      {result && (
        <div className="p-5 sm:p-6 rounded-2xl bg-[#141419] border border-white/15 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Receipt className="w-4 h-4" />
                <span className="font-mono">{result.order.order_number}</span>
                {result.order.receipt_number && (
                  <>
                    <span>·</span>
                    <span className="font-mono text-zinc-300">Reçu {result.order.receipt_number}</span>
                  </>
                )}
              </div>
              <h3 className="text-lg font-bold text-white">{result.order.video_title}</h3>
              <p className="text-xs text-zinc-400">
                {formatPaymentMethod(result.order.payment_method)} · {formatDateFr(result.order.created_at)}
              </p>
            </div>
            <div className="text-right">
              <div className={`text-sm font-semibold ${getOrderStatusLabel(result.order.status).toneClass}`}>
                {getOrderStatusLabel(result.order.status).label}
              </div>
              <div className="font-mono tabular-nums text-base font-bold text-white">
                {formatFcfa(result.order.expected_amount_fcfa)}
              </div>
            </div>
          </div>

          <p className="text-sm text-zinc-300">{result.order.status_message}</p>

          {result.order.status === 'CONFIRMED' && result.downloadInfo ? (
            <div className="space-y-3 pt-1">
              <a
                href={`/api/downloads/${encodeURIComponent(result.downloadInfo.token)}`}
                className="w-full sm:w-auto inline-flex min-h-[46px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>
                  Télécharger la vidéo originale ({result.downloadInfo.downloadsUsed}/
                  {result.downloadInfo.maxDownloads} utilisés)
                </span>
              </a>
              <p className="text-xs text-zinc-400">
                Usage strictement personnel. Lien valide jusqu’au {formatDateFr(result.downloadInfo.expiresAt)}.
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">
              Le téléchargement reste verrouillé tant que le paiement n’est pas confirmé pour le montant exact en XOF.
            </p>
          )}
        </div>
      )}

      {/* Saved Orders on this device */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-zinc-400" />
          <span>Commandes enregistrées sur cet appareil ({savedOrders.length})</span>
        </h2>

        {savedOrders.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Vos récentes commandes effectuées depuis ce navigateur apparaîtront ici automatiquement.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {savedOrders.map((item) => (
              <div
                key={item.orderNumber}
                className="p-4 rounded-xl bg-[#141419] border border-white/10 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs text-zinc-400">{item.orderNumber}</p>
                  <p className="text-sm font-semibold text-white truncate">{item.videoTitle}</p>
                  <p className="text-xs text-zinc-500 font-mono tabular-nums">
                    {formatFcfa(item.amountFcfa)} · {formatDateFr(item.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOrderNumber(item.orderNumber);
                    setIdentity(item.identity);
                    lookupOrder(item.orderNumber, item.identity);
                  }}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white cursor-pointer whitespace-nowrap"
                >
                  Ouvrir
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
