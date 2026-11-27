import { Heart, Play, ShoppingBag } from 'lucide-react';
import type { VideoItem } from '../types.ts';
import { formatFcfa } from '../utils/format.ts';
import { ResilientPoster } from './ResilientPoster.tsx';

interface VideoCardProps {
  video: VideoItem;
  accentColor: string;
  isFavorite: boolean;
  onToggleFavorite: (videoId: string) => void;
  onSelect: (video: VideoItem) => void;
  onBuy: (video: VideoItem) => void;
}

export function VideoCard({
  video,
  accentColor,
  isFavorite,
  onToggleFavorite,
  onSelect,
  onBuy,
}: VideoCardProps) {
  const hasPromo =
    video.promo_price_fcfa !== null && video.promo_price_fcfa < video.price_fcfa;
  const effectivePrice = hasPromo ? video.promo_price_fcfa! : video.price_fcfa;

  return (
    <article className="group flex flex-col bg-[#141419] border border-white/10 rounded-xl overflow-hidden transition-transform duration-200 hover:-translate-y-0.5">
      {/* Poster container */}
      <div className="relative aspect-[3/4] w-full bg-[#0E0E12] overflow-hidden">
        <button
          type="button"
          onClick={() => onSelect(video)}
          className="block w-full h-full text-left cursor-pointer"
          aria-label={`Voir ${video.title}`}
        >
          <ResilientPoster
            src={video.poster_url}
            alt={video.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141419] via-transparent to-black/25" />
        </button>

        {/* Favorite button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(video.id);
          }}
          aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          className="absolute top-2.5 right-2.5 min-h-[40px] min-w-[40px] rounded-lg bg-black/60 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
        >
          <Heart
            className="w-4 h-4"
            style={isFavorite ? { fill: accentColor, color: accentColor } : undefined}
          />
        </button>

        {/* Bottom quick preview button */}
        <button
          type="button"
          onClick={() => onSelect(video)}
          className="absolute bottom-2.5 left-2.5 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm border border-white/15 text-xs font-medium text-white flex items-center gap-1.5 hover:bg-black/90 transition-colors cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Aperçu</span>
        </button>
      </div>

      {/* Metadata & CTA */}
      <div className="p-4 flex flex-col flex-1 justify-between gap-3">
        <div className="space-y-1.5">
          <p className="text-xs text-zinc-400 truncate">
            {video.category_name} · {video.duration_label}
            {video.reviews_count && video.reviews_count > 0
              ? ` · ★ ${Number(video.avg_rating || 0).toFixed(1)}`
              : ''}
          </p>
          <h3
            onClick={() => onSelect(video)}
            className="text-base font-semibold text-white leading-snug line-clamp-2 cursor-pointer hover:text-zinc-200"
          >
            {video.title}
          </h3>
        </div>

        <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-mono tabular-nums text-sm font-semibold text-white">
              {formatFcfa(effectivePrice)}
            </span>
            {hasPromo && (
              <span className="font-mono tabular-nums text-xs text-zinc-500 line-through">
                {formatFcfa(video.price_fcfa)}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => onBuy(video)}
            className="min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-opacity hover:opacity-90 cursor-pointer whitespace-nowrap shrink-0"
            style={{ backgroundColor: accentColor }}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Acheter</span>
          </button>
        </div>
      </div>
    </article>
  );
}
