import { Heart } from 'lucide-react';
import type { VideoItem } from '../types.ts';
import { VideoCard } from './VideoCard.tsx';

interface FavoritesViewProps {
  videos: VideoItem[];
  favorites: string[];
  accentColor: string;
  onToggleFavorite: (videoId: string) => void;
  onSelectVideo: (video: VideoItem) => void;
  onBuyVideo: (video: VideoItem) => void;
  onBrowseCatalog: () => void;
}

export function FavoritesView({
  videos,
  favorites,
  accentColor,
  onToggleFavorite,
  onSelectVideo,
  onBuyVideo,
  onBrowseCatalog,
}: FavoritesViewProps) {
  const favVideos = videos.filter((v) => favorites.includes(v.id));

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
          Mes favoris sur cet appareil
        </h1>
        <p className="text-sm text-zinc-400">
          Retrouvez les vidéos enregistrées localement sur votre téléphone ou ordinateur.
        </p>
      </div>

      {favVideos.length === 0 ? (
        <div className="p-10 rounded-2xl bg-[#141419] border border-white/10 text-center space-y-4">
          <Heart className="w-10 h-10 text-zinc-500 mx-auto" />
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">Aucun favori enregistré</p>
            <p className="text-sm text-zinc-400">
              Touchez le cœur sur n’importe quelle affiche pour la sauvegarder ici.
            </p>
          </div>
          <button
            type="button"
            onClick={onBrowseCatalog}
            className="min-h-[44px] px-5 py-2.5 rounded-lg text-white text-sm font-semibold cursor-pointer"
            style={{ backgroundColor: accentColor }}
          >
            Explorer le catalogue
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {favVideos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              accentColor={accentColor}
              isFavorite={true}
              onToggleFavorite={onToggleFavorite}
              onSelect={onSelectVideo}
              onBuy={onBuyVideo}
            />
          ))}
        </div>
      )}
    </section>
  );
}
