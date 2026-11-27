import { ArrowRight, Search, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminConsole } from './components/AdminConsole.tsx';
import { AiAssistantWidget } from './components/AiAssistantWidget.tsx';
import { CatalogView } from './components/CatalogView.tsx';
import { CheckoutModal } from './components/CheckoutModal.tsx';
import { CustomerOrdersView } from './components/CustomerOrdersView.tsx';
import { FavoritesView } from './components/FavoritesView.tsx';
import { HeroBanner } from './components/HeroBanner.tsx';
import { type AppView, Navbar } from './components/Navbar.tsx';
import { VideoCard } from './components/VideoCard.tsx';
import { VideoDetailModal } from './components/VideoDetailModal.tsx';
import type { Category, SavedLocalOrder, SiteConfig, VideoItem } from './types.ts';

const DEFAULT_CONFIG: SiteConfig = {
  brandName: 'CINEVEO',
  tagline: 'Cinéma indépendant, documentaires et masterclasses en téléchargement direct FCFA',
  accentColor: '#E50914',
  heroVideoId: null,
  announcement: null,
  currency: 'XOF',
  currencyLabel: 'FCFA',
  cinetPayConfigured: false,
  openAiConfigured: false,
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_CONFIG);
  const [categories, setCategories] = useState<Category[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('home');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogSection, setCatalogSection] = useState('all');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [quickSearchInput, setQuickSearchInput] = useState('');

  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [checkoutVideo, setCheckoutVideo] = useState<VideoItem | null>(null);

  const [favorites, setFavorites] = useState<string[]>(() =>
    readStorage<string[]>('cineveo_favorites', [])
  );
  const [savedOrders, setSavedOrders] = useState<SavedLocalOrder[]>(() =>
    readStorage<SavedLocalOrder[]>('cineveo_orders', [])
  );

  const loadStorefront = useCallback(async () => {
    try {
      const [cfgRes, catRes, vidRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/categories'),
        fetch('/api/catalog?limit=48'),
      ]);
      const cfg = (await cfgRes.json()) as SiteConfig;
      const cats = (await catRes.json()) as { categories?: Category[] };
      const vids = (await vidRes.json()) as { videos?: VideoItem[] };

      setSiteConfig(cfg);
      setCategories(cats.categories || []);
      setVideos(vids.videos || []);
      document.title = `${cfg.brandName} — Streaming et Vidéos Numériques en FCFA`;
    } catch {
      // keep fallback state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStorefront();
    const params = new URLSearchParams(window.location.search);
    if (params.get('order')) {
      setActiveView('orders');
    }
  }, [loadStorefront]);

  function toggleFavorite(videoId: string) {
    setFavorites((prev) => {
      const next = prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : [videoId, ...prev];
      try {
        localStorage.setItem('cineveo_favorites', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function saveLocalOrder(order: SavedLocalOrder) {
    setSavedOrders((prev) => {
      const next = [order, ...prev.filter((o) => o.orderNumber !== order.orderNumber)].slice(0, 20);
      try {
        localStorage.setItem('cineveo_orders', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const heroVideo = useMemo(() => {
    if (videos.length === 0) return null;
    if (siteConfig.heroVideoId) {
      const match = videos.find((v) => v.id === siteConfig.heroVideoId);
      if (match) return match;
    }
    return videos.find((v) => v.is_featured) || videos[0];
  }, [videos, siteConfig.heroVideoId]);

  const newReleases = useMemo(() => videos.filter((v) => v.is_new), [videos]);
  const bestSellers = useMemo(
    () => [...videos].sort((a, b) => b.sales_count - a.sales_count),
    [videos]
  );
  const popularVideos = useMemo(
    () => [...videos].sort((a, b) => b.views_count - a.views_count),
    [videos]
  );
  const recommendedVideos = useMemo(
    () => [...videos].sort((a, b) => b.sales_count * 3 + b.views_count - (a.sales_count * 3 + a.views_count)),
    [videos]
  );
  const promoVideos = useMemo(
    () => videos.filter((v) => v.promo_price_fcfa !== null && v.promo_price_fcfa < v.price_fcfa),
    [videos]
  );

  function openSectionInCatalog(sectionId: string) {
    setCatalogSection(sectionId);
    setCatalogSearch('');
    setActiveView('catalog');
  }

  function handleQuickSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setCatalogSearch(quickSearchInput);
    setCatalogSection('all');
    setSearchModalOpen(false);
    setActiveView('catalog');
  }

  const renderShelf = (title: string, items: VideoItem[], sectionId: string) => {
    if (items.length === 0) return null;
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={() => openSectionInCatalog(sectionId)}
            className="text-xs sm:text-sm font-medium text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>Tout voir</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {items.slice(0, 5).map((v) => (
            <VideoCard
              key={`${sectionId}-${v.id}`}
              video={v}
              accentColor={siteConfig.accentColor}
              isFavorite={favorites.includes(v.id)}
              onToggleFavorite={toggleFavorite}
              onSelect={setSelectedVideo}
              onBuy={setCheckoutVideo}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F4F4F5] flex flex-col pb-20 md:pb-0">
      {/* Slim Dismissible Announcement Bar */}
      {siteConfig.announcement && !bannerDismissed && (
        <div
          className="h-9 px-4 flex items-center justify-between text-xs text-white"
          style={{ backgroundColor: siteConfig.accentColor }}
        >
          <p className="truncate mx-auto font-medium">{siteConfig.announcement.content}</p>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Masquer l'annonce"
            className="ml-2 p-1 hover:bg-black/20 rounded cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3-Zone Top Bar + Android Bottom Tab Bar */}
      <Navbar
        brandName={siteConfig.brandName}
        accentColor={siteConfig.accentColor}
        activeView={activeView}
        onNavigate={(v) => {
          setActiveView(v);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenSearch={() => setSearchModalOpen(true)}
        favoritesCount={favorites.length}
      />

      {/* Main Content */}
      <main className="flex-1">
        {activeView === 'home' && (
          <div>
            {heroVideo && (
              <HeroBanner
                video={heroVideo}
                tagline={siteConfig.tagline}
                accentColor={siteConfig.accentColor}
                onWatchPreview={setSelectedVideo}
                onBuy={setCheckoutVideo}
              />
            )}

            {/* Quick Category Strip & Search Input */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 space-y-10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => openSectionInCatalog('all')}
                    className="min-h-[40px] px-4 rounded-lg bg-white text-zinc-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Tout explorer
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCatalogSection('all');
                        setCatalogSearch(c.name);
                        setActiveView('catalog');
                      }}
                      className="min-h-[40px] px-4 rounded-lg bg-[#141419] border border-white/10 hover:border-white/25 text-xs font-medium text-zinc-200 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleQuickSearchSubmit} className="relative w-full md:w-72 shrink-0">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={quickSearchInput}
                    onChange={(e) => setQuickSearchInput(e.target.value)}
                    placeholder="Rechercher une vidéo..."
                    className="w-full min-h-[42px] pl-10 pr-4 rounded-xl bg-[#141419] border border-white/15 text-xs sm:text-sm text-white placeholder:text-zinc-500"
                  />
                </form>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-[3/4] rounded-xl bg-[#141419] animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-12 pb-12">
                  {renderShelf('Nouveautés', newReleases, 'new')}
                  {renderShelf('Meilleures ventes', bestSellers, 'bestseller')}
                  {renderShelf('Vidéos populaires', popularVideos, 'popular')}
                  {renderShelf('Vidéos recommandées', recommendedVideos, 'recommended')}
                  {renderShelf('Promotions en FCFA', promoVideos, 'promo')}
                </div>
              )}
            </div>
          </div>
        )}

        {activeView === 'catalog' && (
          <CatalogView
            categories={categories}
            accentColor={siteConfig.accentColor}
            favorites={favorites}
            initialSearch={catalogSearch}
            initialSection={catalogSection}
            onToggleFavorite={toggleFavorite}
            onSelectVideo={setSelectedVideo}
            onBuyVideo={setCheckoutVideo}
          />
        )}

        {activeView === 'favorites' && (
          <FavoritesView
            videos={videos}
            favorites={favorites}
            accentColor={siteConfig.accentColor}
            onToggleFavorite={toggleFavorite}
            onSelectVideo={setSelectedVideo}
            onBuyVideo={setCheckoutVideo}
            onBrowseCatalog={() => setActiveView('catalog')}
          />
        )}

        {activeView === 'orders' && (
          <CustomerOrdersView
            accentColor={siteConfig.accentColor}
            savedOrders={savedOrders}
          />
        )}

        {activeView === 'admin' && (
          <AdminConsole
            siteConfig={siteConfig}
            categories={categories}
            onRefreshStorefront={loadStorefront}
          />
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-white/10 bg-[#070709] py-8 px-4 sm:px-6 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-400">
          <div className="space-y-1">
            <p className="font-semibold text-zinc-200">{siteConfig.brandName}</p>
            <p>
              Paiements acceptés en XOF (FCFA) : Wave, Orange Money, Mobile Money et Carte bancaire.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => setActiveView('orders')}
              className="hover:text-white cursor-pointer"
            >
              Retrouver une commande
            </button>
            <button
              type="button"
              onClick={() => setActiveView('catalog')}
              className="hover:text-white cursor-pointer"
            >
              Catalogue complet
            </button>
            <button
              type="button"
              onClick={() => setActiveView('admin')}
              className="hover:text-white cursor-pointer"
            >
              Espace Administrateur
            </button>
          </div>
        </div>
      </footer>

      {/* Quick Search Modal */}
      {searchModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-20"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleQuickSearchSubmit}
            className="w-full max-w-xl bg-[#141419] border border-white/15 rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-center gap-3">
              <Search className="w-5 h-5 text-zinc-400 shrink-0" />
              <input
                autoFocus
                type="search"
                value={quickSearchInput}
                onChange={(e) => setQuickSearchInput(e.target.value)}
                placeholder="Rechercher un film, documentaire, formation..."
                className="flex-1 bg-transparent text-base text-white placeholder:text-zinc-500 outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchModalOpen(false)}
                className="p-2 text-zinc-400 hover:text-white cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-lg text-white text-xs font-semibold cursor-pointer"
                style={{ backgroundColor: siteConfig.accentColor }}
              >
                Rechercher dans le catalogue
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Video Preview & Detail Modal */}
      <VideoDetailModal
        video={selectedVideo}
        accentColor={siteConfig.accentColor}
        isFavorite={selectedVideo ? favorites.includes(selectedVideo.id) : false}
        onToggleFavorite={toggleFavorite}
        onClose={() => setSelectedVideo(null)}
        onBuy={(v) => {
          setSelectedVideo(null);
          setCheckoutVideo(v);
        }}
        onReviewSubmitted={loadStorefront}
      />

      {/* Checkout & Download Unlock Modal */}
      <CheckoutModal
        video={checkoutVideo}
        accentColor={siteConfig.accentColor}
        onClose={() => setCheckoutVideo(null)}
        onOrderSaved={saveLocalOrder}
      />

      {/* Floating AI Commercial Assistant */}
      <AiAssistantWidget
        brandName={siteConfig.brandName}
        accentColor={siteConfig.accentColor}
      />
    </div>
  );
}
