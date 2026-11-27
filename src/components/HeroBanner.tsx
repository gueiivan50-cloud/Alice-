import { Play, ShoppingBag } from 'lucide-react';
import type { VideoItem } from '../types.ts';
import { formatFcfa } from '../utils/format.ts';
import { ResilientPoster } from './ResilientPoster.tsx';

interface HeroBannerProps {
  video: VideoItem;
  tagline: string;
  accentColor: string;
  onWatchPreview: (video: VideoItem) => void;
  onBuy: (video: VideoItem) => void;
}

export function HeroBanner({
  video,
  tagline,
  accentColor,
  onWatchPreview,
  onBuy,
}: HeroBannerProps) {
  const effectivePrice = video.promo_price_fcfa ?? video.price_fcfa;

  return (
    <section className="relative w-full min-h-[460px] md:min-h-[540px] lg:min-h-[580px] flex items-end overflow-hidden border-b border-white/10">
      <ResilientPoster
        src={video.poster_url}
        alt={video.title}
        className="absolute inset-0 w-full h-full object-cover object-center"
      />

      {/* Measured scrim for WCAG AA contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/70 to-[#09090B]/25" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#09090B]/95 via-[#09090B]/55 to-transparent" />

      <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 py-10 md:py-16">
        <div className="max-w-2xl space-y-4">
          <p className="text-xs sm:text-sm font-medium text-zinc-300">
            {video.category_name} · {video.duration_label} · À la une
          </p>

          <h1
            className="font-display text-3xl sm:text-5xl lg:text-[56px] font-bold tracking-tight text-white leading-[1.08]"
            style={{ textWrap: 'balance' }}
          >
            {video.title}
          </h1>

          <p className="text-sm sm:text-base text-zinc-300 leading-relaxed line-clamp-3">
            {video.description}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onWatchPreview(video)}
              className="min-h-[44px] px-5 py-2.5 rounded-lg bg-white text-zinc-950 font-semibold text-sm flex items-center gap-2 hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Regarder l’aperçu gratuit</span>
            </button>

            <button
              type="button"
              onClick={() => onBuy(video)}
              className="min-h-[44px] px-5 py-2.5 rounded-lg text-white font-semibold text-sm flex items-center gap-2 transition-opacity hover:opacity-90 cursor-pointer whitespace-nowrap font-mono tabular-nums"
              style={{ backgroundColor: accentColor }}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Acheter · {formatFcfa(effectivePrice)}</span>
            </button>
          </div>

          {tagline && (
            <p className="text-xs text-zinc-400 pt-1">{tagline}</p>
          )}
        </div>
      </div>
    </section>
  );
}
