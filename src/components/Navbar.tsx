import { Film, Heart, Home, Receipt, Search, ShieldCheck } from 'lucide-react';

export type AppView = 'home' | 'catalog' | 'favorites' | 'orders' | 'admin';

interface NavbarProps {
  brandName: string;
  accentColor: string;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenSearch: () => void;
  favoritesCount: number;
}

export function Navbar({
  brandName,
  accentColor,
  activeView,
  onNavigate,
  onOpenSearch,
  favoritesCount,
}: NavbarProps) {
  const navItems: Array<{ id: AppView; label: string }> = [
    { id: 'home', label: 'Accueil' },
    { id: 'catalog', label: 'Catalogue' },
    { id: 'favorites', label: favoritesCount > 0 ? `Favoris (${favoritesCount})` : 'Favoris' },
    { id: 'orders', label: 'Mes achats' },
    { id: 'admin', label: 'Administration' },
  ];

  return (
    <>
      {/* Top Bar Contract: strictly 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 h-14 md:h-16 bg-[#09090B]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="font-display text-xl md:text-2xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
            style={{ color: '#FFFFFF' }}
          >
            <span style={{ color: accentColor }}>{brandName.slice(0, 1)}</span>
            {brandName.slice(1)}
          </button>

          {/* Zone 2: 5 concise single-line text nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium" aria-label="Navigation principale">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                    isActive
                      ? 'text-white border-current'
                      : 'text-zinc-400 border-transparent hover:text-white'
                  }`}
                  style={isActive ? { borderColor: accentColor } : undefined}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onOpenSearch}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs sm:text-sm font-medium text-white flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>Rechercher</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Android Bottom Thumb Navigation (<= 15% mobile viewport cap) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#09090B]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 items-center px-1"
        aria-label="Navigation mobile"
      >
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'home' ? 'text-white' : 'text-zinc-400'
          }`}
          style={activeView === 'home' ? { color: accentColor } : undefined}
        >
          <Home className="w-5 h-5" />
          <span>Accueil</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'catalog' ? 'text-white' : 'text-zinc-400'
          }`}
          style={activeView === 'catalog' ? { color: accentColor } : undefined}
        >
          <Film className="w-5 h-5" />
          <span>Catalogue</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('favorites')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'favorites' ? 'text-white' : 'text-zinc-400'
          }`}
          style={activeView === 'favorites' ? { color: accentColor } : undefined}
        >
          <Heart className="w-5 h-5" />
          <span>Favoris</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('orders')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'orders' ? 'text-white' : 'text-zinc-400'
          }`}
          style={activeView === 'orders' ? { color: accentColor } : undefined}
        >
          <Receipt className="w-5 h-5" />
          <span>Achats</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'admin' ? 'text-white' : 'text-zinc-400'
          }`}
          style={activeView === 'admin' ? { color: accentColor } : undefined}
        >
          <ShieldCheck className="w-5 h-5" />
          <span>Admin</span>
        </button>
      </nav>
    </>
  );
}
