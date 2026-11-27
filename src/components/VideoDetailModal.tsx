import { CheckCircle2, Heart, Lock, MessageSquareText, ShoppingBag, Star, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { ReviewItem, SavedLocalOrder, VideoItem } from '../types.ts';
import { formatBytes, formatDateFr, formatFcfa } from '../utils/format.ts';

interface VideoDetailModalProps {
  video: VideoItem | null;
  accentColor: string;
  isFavorite: boolean;
  onToggleFavorite: (videoId: string) => void;
  onClose: () => void;
  onBuy: (video: VideoItem) => void;
  onReviewSubmitted?: () => void;
}

const RATING_LABELS: Record<number, string> = {
  1: '1/5 — Insuffisant',
  2: '2/5 — Moyen',
  3: '3/5 — Correct',
  4: '4/5 — Très bien',
  5: '5/5 — Excellent',
};

export function VideoDetailModal({
  video,
  accentColor,
  isFavorite,
  onToggleFavorite,
  onClose,
  onBuy,
  onReviewSubmitted,
}: VideoDetailModalProps) {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  // Interactive Review Form States
  const [orderNumber, setOrderNumber] = useState('');
  const [identity, setIdentity] = useState('');
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filter & Sort States for Comments
  const [starFilter, setStarFilter] = useState<'all' | '5' | '4' | '3low'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest'>('recent');

  // Saved orders on device for quick-fill convenience
  const [localOrders, setLocalOrders] = useState<SavedLocalOrder[]>([]);

  useEffect(() => {
    if (!video) return;
    setLoadingReviews(true);
    setReviewError(null);
    setReviewSuccess(null);
    setStarFilter('all');
    setSortBy('recent');

    try {
      const raw = localStorage.getItem('cineveo_orders');
      if (raw) {
        setLocalOrders(JSON.parse(raw) as SavedLocalOrder[]);
      }
    } catch {
      setLocalOrders([]);
    }

    fetch(`/api/videos/${encodeURIComponent(video.id)}/view`, { method: 'POST' }).catch(() => {});
    fetch(`/api/videos/${encodeURIComponent(video.id)}`)
      .then((r) => r.json())
      .then((data: { reviews?: ReviewItem[] }) => {
        setReviews(data.reviews || []);
      })
      .catch(() => {})
      .finally(() => setLoadingReviews(false));
  }, [video]);

  const ratingStats = useMemo(() => {
    const count = reviews.length;
    if (count === 0) {
      return {
        average: 0,
        count: 0,
        breakdown: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0, percent: 0 })),
      };
    }
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    const breakdown = [5, 4, 3, 2, 1].map((stars) => {
      const c = reviews.filter((r) => r.rating === stars).length;
      return { stars, count: c, percent: Math.round((c / count) * 100) };
    });
    return {
      average: sum / count,
      count,
      breakdown,
    };
  }, [reviews]);

  const displayedReviews = useMemo(() => {
    let list = [...reviews];
    if (starFilter === '5') {
      list = list.filter((r) => r.rating === 5);
    } else if (starFilter === '4') {
      list = list.filter((r) => r.rating === 4);
    } else if (starFilter === '3low') {
      list = list.filter((r) => r.rating <= 3);
    }

    if (sortBy === 'highest') {
      list.sort((a, b) => b.rating - a.rating);
    } else if (sortBy === 'lowest') {
      list.sort((a, b) => a.rating - b.rating);
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [reviews, starFilter, sortBy]);

  if (!video) return null;

  const hasPromo =
    video.promo_price_fcfa !== null && video.promo_price_fcfa < video.price_fcfa;
  const effectivePrice = hasPromo ? video.promo_price_fcfa! : video.price_fcfa;
  const matchingLocalOrders = localOrders.filter(
    (o) => o.videoTitle.toLowerCase() === video.title.toLowerCase()
  );

  async function handleReviewSubmit(e: FormEvent) {
    e.preventDefault();
    if (!video) return;
    setReviewError(null);
    setReviewSuccess(null);

    if (comment.trim().length < 5) {
      setReviewError('Veuillez écrire un commentaire d’au moins 5 caractères.');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch(`/api/videos/${encodeURIComponent(video.id)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, identity, rating, comment: comment.trim() }),
      });
      const data = (await resp.json()) as { review?: ReviewItem; error?: string };
      if (!resp.ok || !data.review) {
        setReviewError(data.error || 'Impossible de publier cet avis.');
      } else {
        setReviews((prev) => [data.review!, ...prev]);
        setOrderNumber('');
        setIdentity('');
        setComment('');
        setRating(5);
        setReviewSuccess('Votre note et votre commentaire vérifié ont bien été publiés.');
        onReviewSubmitted?.();
      }
    } catch {
      setReviewError('Erreur réseau lors de l’envoi.');
    } finally {
      setSubmitting(false);
    }
  }

  const activeStarValue = hoverRating ?? rating;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
    >
      <div className="relative w-full max-w-4xl bg-[#111116] border border-white/10 sm:rounded-2xl overflow-hidden my-auto max-h-screen sm:max-h-[92vh] flex flex-col">
        {/* Top Close Bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/10 bg-[#0D0D11]">
          <span className="text-xs sm:text-sm text-zinc-400 truncate">
            {video.category_name} · {video.duration_label} · {formatBytes(video.file_size_bytes)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          {/* Protected Preview Player */}
          <div className="relative bg-black aspect-video w-full">
            <video
              key={video.id}
              src={`/api/videos/${encodeURIComponent(video.id)}/preview`}
              poster={video.poster_url}
              controls
              playsInline
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              className="w-full h-full object-contain"
            />
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-black/75 border border-white/15 text-[11px] text-zinc-200 flex items-center gap-1.5 pointer-events-none">
              <Lock className="w-3 h-3 text-zinc-400" />
              <span>Aperçu gratuit protégé — Fichier original HD débloqué après achat</span>
            </div>
          </div>

          {/* Info & Purchase Bar */}
          <div className="p-4 sm:p-6 space-y-8">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
              <div className="space-y-2.5 flex-1">
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
                  {video.title}
                </h2>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-300">
                  {ratingStats.count > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-400 font-mono tabular-nums font-semibold">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{ratingStats.average.toFixed(1)}/5</span>
                      <span className="text-zinc-400 font-sans font-normal">
                        ({ratingStats.count} avis)
                      </span>
                    </span>
                  )}
                  {ratingStats.count > 0 && <span className="text-zinc-500">·</span>}
                  <span className="text-zinc-400">
                    {video.views_count.toLocaleString('fr-FR')} vues ·{' '}
                    {video.sales_count.toLocaleString('fr-FR')} achats confirmés
                  </span>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed">{video.description}</p>
                <p className="text-xs text-zinc-500">
                  Usage personnel uniquement (revente et redistribution interdites).
                </p>
              </div>

              <div className="bg-[#17171E] border border-white/10 rounded-xl p-4 md:w-72 shrink-0 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-zinc-400">Prix de la vidéo</span>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-xl font-bold text-white">
                      {formatFcfa(effectivePrice)}
                    </div>
                    {hasPromo && (
                      <div className="font-mono tabular-nums text-xs text-zinc-500 line-through">
                        {formatFcfa(video.price_fcfa)}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onBuy(video)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-lg text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
                  style={{ backgroundColor: accentColor }}
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>Acheter maintenant</span>
                </button>

                <button
                  type="button"
                  onClick={() => onToggleFavorite(video.id)}
                  className="w-full min-h-[40px] px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Heart
                    className="w-4 h-4"
                    style={isFavorite ? { fill: accentColor, color: accentColor } : undefined}
                  />
                  <span>{isFavorite ? 'Retirer des favoris' : 'Enregistrer dans mes favoris'}</span>
                </button>
              </div>
            </div>

            {/* Star Rating Summary & Verified Buyer Comments Section */}
            <div className="border-t border-white/10 pt-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg font-bold text-white">
                    Notes et commentaires des acheteurs
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Retours authentiques publiés uniquement par les clients ayant confirmé l’achat de cette vidéo.
                  </p>
                </div>
              </div>

              {/* Rating Summary + Breakdown + Review Submission Form */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Score Overview & Star Distribution */}
                <div className="lg:col-span-5 p-4 sm:p-5 rounded-xl bg-[#16161C] border border-white/10 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center pr-4 border-r border-white/10">
                      <div className="font-mono tabular-nums text-3xl font-bold text-white">
                        {ratingStats.count > 0 ? ratingStats.average.toFixed(1) : '—'}
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono">sur 5</div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1" aria-label="Note moyenne">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={`w-4 h-4 ${
                              ratingStats.average >= n - 0.3
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-zinc-600'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-zinc-400 font-mono tabular-nums">
                        {ratingStats.count}{' '}
                        {ratingStats.count > 1 ? 'avis vérifiés' : 'avis vérifié'}
                      </p>
                    </div>
                  </div>

                  {/* 5 -> 1 Star Bars */}
                  <div className="space-y-2 pt-1">
                    {ratingStats.breakdown.map((row) => (
                      <div key={row.stars} className="flex items-center gap-2.5 text-xs">
                        <span className="font-mono tabular-nums text-zinc-300 w-7 shrink-0">
                          {row.stars} ★
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-black/50 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-400 transition-all duration-300"
                            style={{ width: `${row.percent}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-zinc-500 w-7 text-right shrink-0">
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Column: Interactive Star & Comment Form */}
                <form
                  onSubmit={handleReviewSubmit}
                  className="lg:col-span-7 p-4 sm:p-5 rounded-xl bg-[#16161C] border border-white/10 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-white">
                      Partager votre retour sur cette vidéo
                    </h4>
                    {matchingLocalOrders.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setOrderNumber(matchingLocalOrders[0].orderNumber);
                          setIdentity(matchingLocalOrders[0].identity);
                        }}
                        className="text-xs text-amber-300 hover:text-amber-200 underline cursor-pointer"
                      >
                        Pré-remplir ma commande ({matchingLocalOrders[0].orderNumber})
                      </button>
                    )}
                  </div>

                  {/* Interactive 5-Star Picker */}
                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-400 block">Votre note *</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className="inline-flex items-center gap-1"
                        onMouseLeave={() => setHoverRating(null)}
                        role="radiogroup"
                        aria-label="Note en étoiles"
                      >
                        {[1, 2, 3, 4, 5].map((n) => {
                          const filled = activeStarValue >= n;
                          return (
                            <button
                              key={n}
                              type="button"
                              role="radio"
                              aria-checked={rating === n}
                              aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
                              onMouseEnter={() => setHoverRating(n)}
                              onClick={() => setRating(n)}
                              className="min-h-[40px] min-w-[40px] rounded-lg bg-[#0B0B0E] border border-white/10 hover:border-amber-400/50 flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
                            >
                              <Star
                                className={`w-5 h-5 transition-colors ${
                                  filled ? 'text-amber-400 fill-amber-400' : 'text-zinc-600'
                                }`}
                              />
                            </button>
                          );
                        })}
                      </div>
                      <span className="text-xs font-medium text-amber-300 font-mono">
                        {RATING_LABELS[activeStarValue]}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-400">N° de commande *</span>
                      <input
                        type="text"
                        required
                        value={orderNumber}
                        onChange={(e) => setOrderNumber(e.target.value)}
                        placeholder="CMD-2026-..."
                        className="w-full min-h-[42px] px-3 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-white font-mono placeholder:font-sans placeholder:text-zinc-500"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-400">
                        Téléphone ou e-mail d’achat *
                      </span>
                      <input
                        type="text"
                        required
                        value={identity}
                        onChange={(e) => setIdentity(e.target.value)}
                        placeholder="+225 07 ... ou e-mail"
                        className="w-full min-h-[42px] px-3 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-white placeholder:text-zinc-500"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-zinc-400">Votre commentaire *</span>
                    <textarea
                      required
                      rows={3}
                      maxLength={800}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Qualité de l'image, son, intérêt du contenu, conseils aux futurs acheteurs..."
                      className="w-full p-3 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs sm:text-sm text-white placeholder:text-zinc-500"
                    />
                  </label>

                  {reviewError && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                      {reviewError}
                    </div>
                  )}
                  {reviewSuccess && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{reviewSuccess}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
                      {comment.length}/800
                    </span>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-[42px] px-5 py-2 rounded-lg text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: accentColor }}
                    >
                      {submitting ? 'Vérification...' : 'Publier mon avis'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Filterable & Sortable Comments List */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/10">
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    {(
                      [
                        { id: 'all', label: `Tous (${reviews.length})` },
                        { id: '5', label: '5 étoiles' },
                        { id: '4', label: '4 étoiles' },
                        { id: '3low', label: '3 étoiles et -' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setStarFilter(f.id)}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                          starFilter === f.id
                            ? 'bg-white text-zinc-950'
                            : 'bg-white/5 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'recent' | 'highest' | 'lowest')}
                    aria-label="Trier les commentaires"
                    className="min-h-[36px] px-3 rounded-lg bg-[#16161C] border border-white/10 text-xs text-zinc-200 self-start sm:self-auto"
                  >
                    <option value="recent">Plus récents</option>
                    <option value="highest">Meilleures notes</option>
                    <option value="lowest">Notes les plus basses</option>
                  </select>
                </div>

                {loadingReviews ? (
                  <p className="text-sm text-zinc-400">Chargement des avis...</p>
                ) : displayedReviews.length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#16161C] border border-white/10 text-center space-y-1.5">
                    <MessageSquareText className="w-6 h-6 text-zinc-500 mx-auto" />
                    <p className="text-sm font-medium text-zinc-300">
                      {reviews.length === 0
                        ? 'Aucun commentaire pour le moment'
                        : 'Aucun avis ne correspond à ce filtre'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {reviews.length === 0
                        ? 'Soyez le premier acheteur vérifié à partager votre avis sur cette vidéo.'
                        : 'Sélectionnez « Tous » pour afficher l’ensemble des commentaires.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {displayedReviews.map((r) => (
                      <article
                        key={r.id}
                        className="p-4 rounded-xl bg-[#16161C] border border-white/10 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{r.author_name}</p>
                            <p className="text-[11px] text-emerald-400">
                              Achat vérifié · {formatDateFr(r.created_at)}
                            </p>
                          </div>
                          <div
                            className="flex items-center gap-0.5 shrink-0"
                            aria-label={`Note ${r.rating} sur 5`}
                          >
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                className={`w-3.5 h-3.5 ${
                                  r.rating >= n
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-zinc-600'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-line">
                          {r.comment}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
