import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Category, VideoItem } from '../types.ts';
import { VideoCard } from './VideoCard.tsx';

interface CatalogViewProps {
  categories: Category[];
  accentColor: string;
  favorites: string[];
  initialSearch?: string;
  initialSection?: string;
  onToggleFavorite: (videoId: string) => void;
  onSelectVideo: (video: VideoItem) => void;
  onBuyVideo: (video: VideoItem) => void;
}

const SECTION_TABS = [
  { id: 'all', label: 'Tout le catalogue' },
  { id: 'new', label: 'Nouveautés' },
  { id: 'bestseller', label: 'Meilleures ventes' },
  { id: 'popular', label: 'Populaires' },
  { id: 'recommended', label: 'Recommandées' },
  { id: 'promo', label: 'Promotions' },
];

export function CatalogView({
  categories,
  accentColor,
  favorites,
  initialSearch = '',
  initialSection = 'all',
  onToggleFavorite,
  onSelectVideo,
  onBuyVideo,
}: CatalogViewProps) {
  const [search, setSearch] = useState(initialSearch);
  const [categorySlug, setCategorySlug] = useState('all');
  const [section, setSection] = useState(initialSection);
  const [page, setPage] = useState(1);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      search,
      category: categorySlug,
      section,
      page: String(page),
      limit: '24',
    });

    fetch(`/api/catalog?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { videos?: VideoItem[]; total?: number; totalPages?: number }) => {
        setVideos(data.videos || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search, categorySlug, section, page]);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
            Catalogue des vidéos numériques
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 font-mono tabular-nums">
            {total.toLocaleString('fr-FR')} titre(s) disponible(s) en FCFA
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Rechercher un titre, thème..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-[#141419] border border-white/15 text-sm text-white placeholder:text-zinc-500"
          />
        </div>
      </div>

      {/* Section Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {SECTION_TABS.map((tab) => {
          const active = section === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSection(tab.id);
                setPage(1);
              }}
              className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'text-white'
                  : 'bg-[#141419] text-zinc-400 hover:text-white border border-white/10'
              }`}
              style={active ? { backgroundColor: accentColor } : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 border-b border-white/10">
        <button
          type="button"
          onClick={() => {
            setCategorySlug('all');
            setPage(1);
          }}
          className={`pb-2.5 px-2 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            categorySlug === 'all'
              ? 'text-white border-white'
              : 'text-zinc-400 border-transparent hover:text-white'
          }`}
        >
          Toutes les catégories
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => {
              setCategorySlug(cat.slug);
              setPage(1);
            }}
            className={`pb-2.5 px-2 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              categorySlug === cat.slug
                ? 'text-white border-white'
                : 'text-zinc-400 border-transparent hover:text-white'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] rounded-xl bg-[#141419] border border-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="p-10 rounded-2xl bg-[#141419] border border-white/10 text-center space-y-2">
          <p className="text-base font-semibold text-white">Aucune vidéo trouvée</p>
          <p className="text-sm text-zinc-400">
            Modifiez vos critères de recherche ou réinitialisez les filtres.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              accentColor={accentColor}
              isFavorite={favorites.includes(v.id)}
              onToggleFavorite={onToggleFavorite}
              onSelect={onSelectVideo}
              onBuy={onBuyVideo}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-h-[40px] px-3 rounded-lg bg-[#141419] border border-white/10 text-xs text-white flex items-center gap-1 disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Précédent</span>
          </button>
          <span className="font-mono text-xs text-zinc-400 tabular-nums">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="min-h-[40px] px-3 rounded-lg bg-[#141419] border border-white/10 text-xs text-white flex items-center gap-1 disabled:opacity-40 cursor-pointer"
          >
            <span>Suivant</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </section>
  );
}
