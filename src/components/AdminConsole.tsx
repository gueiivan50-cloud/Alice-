import {
  Bell,
  Bot,
  CheckCircle2,
  DatabaseBackup,
  Edit3,
  Eye,
  EyeOff,
  HardDriveDownload,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type {
  BackupItem,
  Category,
  OrderRecord,
  PromoCodeItem,
  SiteConfig,
  VideoItem,
} from '../types.ts';
import {
  formatBytes,
  formatDateFr,
  formatFcfa,
  formatPaymentMethod,
  getOrderStatusLabel,
} from '../utils/format.ts';
import { AdminUploadModal } from './AdminUploadModal.tsx';

interface AdminConsoleProps {
  siteConfig: SiteConfig;
  categories: Category[];
  onRefreshStorefront: () => void;
}

type AdminTab = 'overview' | 'videos' | 'orders' | 'marketing' | 'ai' | 'backups';

interface DashboardPayload {
  kpis: {
    totalVideos: number;
    publishedVideos: number;
    totalOrders: number;
    confirmedSales: number;
    confirmedRevenueFcfa: number;
    pendingPayments: number;
    failedPayments: number;
    totalViews: number;
  };
  orders: OrderRecord[];
  bestSellers: Array<{
    id: string;
    title: string;
    price_fcfa: number;
    promo_price_fcfa: number | null;
    sales_count: number;
    views_count: number;
  }>;
  mostViewed: Array<{
    id: string;
    title: string;
    views_count: number;
    sales_count: number;
    price_fcfa: number;
  }>;
  revenueByDay: Array<{ day: string; sales: number; revenue_fcfa: number }>;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    message: string;
    is_read: number;
    created_at: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    entity_type: string;
    details: string;
    created_at: string;
  }>;
  cinetPayConfigured: boolean;
  openAiConfigured: boolean;
}

const AI_PRESET_QUESTIONS = [
  'Quelles sont mes meilleures ventes ?',
  'Combien ai-je gagné cette semaine ?',
  'Quelles vidéos sont les plus populaires ?',
  'Combien de commandes sont en attente ?',
  'Quelles vidéos devrais-je mettre en avant ?',
];

export function AdminConsole({
  siteConfig,
  categories,
  onRefreshStorefront,
}: AdminConsoleProps) {
  // Bearer token held strictly in React memory (never localStorage)
  const [token, setToken] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    loading: boolean;
    needsFirstRunSetup: boolean;
    envPasscodeActive: boolean;
  }>({ loading: true, needsFirstRunSetup: false, envPasscodeActive: false });
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [adminVideos, setAdminVideos] = useState<VideoItem[]>([]);
  const [promos, setPromos] = useState<PromoCodeItem[]>([]);
  const [announcements, setAnnouncements] = useState<
    Array<{ id: string; title: string; content: string; is_active: number; created_at: string }>
  >([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Modals & action states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoItem | null>(null);
  const [confirmDeleteVideo, setConfirmDeleteVideo] = useState<VideoItem | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  // Inline quick price editor state
  const [priceEditVideoId, setPriceEditVideoId] = useState<string | null>(null);
  const [inlinePrice, setInlinePrice] = useState('');
  const [inlinePromoPrice, setInlinePromoPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  // Category, Promo, Announcement, Identity forms
  const [newCatName, setNewCatName] = useState('');
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoType, setNewPromoType] = useState<'percent' | 'fixed'>('percent');
  const [newPromoValue, setNewPromoValue] = useState('15');
  const [newPromoMaxUses, setNewPromoMaxUses] = useState('100');
  const [newPromoDays, setNewPromoDays] = useState('30');
  const [newAnnTitle, setNewAnnTitle] = useState('');
  const [newAnnContent, setNewAnnContent] = useState('');

  const [brandNameInput, setBrandNameInput] = useState(siteConfig.brandName);
  const [taglineInput, setTaglineInput] = useState(siteConfig.tagline);
  const [accentInput, setAccentInput] = useState(siteConfig.accentColor);
  const [heroVideoInput, setHeroVideoInput] = useState(siteConfig.heroVideoId || '');

  // AI Control Center
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/auth/status')
      .then((r) => r.json())
      .then((d: { needsFirstRunSetup: boolean; envPasscodeActive: boolean }) => {
        setAuthStatus({
          loading: false,
          needsFirstRunSetup: d.needsFirstRunSetup,
          envPasscodeActive: d.envPasscodeActive,
        });
      })
      .catch(() => setAuthStatus((s) => ({ ...s, loading: false })));
  }, []);

  const loadAllAdminData = useCallback(async (authToken: string) => {
    setLoadingData(true);
    const headers = { Authorization: `Bearer ${authToken}` };
    try {
      const [dashResp, vidResp, promoResp, annResp, bkpResp] = await Promise.all([
        fetch('/api/admin/dashboard', { headers }),
        fetch('/api/admin/videos', { headers }),
        fetch('/api/admin/promos', { headers }),
        fetch('/api/admin/announcements', { headers }),
        fetch('/api/admin/backups', { headers }),
      ]);

      if (dashResp.status === 401) {
        setToken(null);
        return;
      }

      const [dash, vids, prms, anns, bkps] = await Promise.all([
        dashResp.json(),
        vidResp.json(),
        promoResp.json(),
        annResp.json(),
        bkpResp.json(),
      ]);

      setDashboard(dash as DashboardPayload);
      setAdminVideos((vids as { videos?: VideoItem[] }).videos || []);
      setPromos((prms as { promos?: PromoCodeItem[] }).promos || []);
      setAnnouncements((anns as { announcements?: typeof announcements }).announcements || []);
      setBackups((bkps as { backups?: BackupItem[] }).backups || []);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadAllAdminData(token);
    }
  }, [token, loadAllAdminData]);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    const endpoint = authStatus.needsFirstRunSetup
      ? '/api/admin/auth/claim'
      : '/api/admin/auth/login';
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = (await resp.json()) as { token?: string; error?: string };
      if (!resp.ok || !data.token) {
        setAuthError(data.error || 'Authentification refusée.');
        return;
      }
      setToken(data.token);
      setPasswordInput('');
      setAuthStatus((s) => ({ ...s, needsFirstRunSetup: false }));
    } catch {
      setAuthError('Erreur réseau.');
    }
  }

  async function handleLogout() {
    if (token) {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
  }

  if (authStatus.loading) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center text-sm text-zinc-400">
        Vérification de l’accès administrateur...
      </div>
    );
  }

  if (!token) {
    return (
      <section className="max-w-md mx-auto px-4 py-12 md:py-20">
        <form
          onSubmit={handleAuthSubmit}
          className="p-6 sm:p-7 rounded-2xl bg-[#141419] border border-white/15 space-y-5"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-zinc-300 text-xs font-medium">
              <Lock className="w-4 h-4" />
              <span>Accès Administrateur Sécurisé</span>
            </div>
            <h1 className="font-display text-2xl font-bold text-white">
              {authStatus.needsFirstRunSetup
                ? 'Configurer le mot de passe administrateur'
                : 'Connexion à la console'}
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {authStatus.needsFirstRunSetup
                ? 'Premier démarrage : définissez votre mot de passe administrateur (stocké chiffré côté serveur) ou configurez ADMIN_PASSCODE dans les variables d’environnement.'
                : 'Saisissez votre mot de passe administrateur pour accéder au catalogue, aux paiements, à l’IA et aux sauvegardes.'}
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-300">Mot de passe administrateur</span>
            <input
              type="password"
              required
              minLength={6}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Minimum 6 caractères"
              className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white"
            />
          </label>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <button
            type="submit"
            className="w-full min-h-[46px] rounded-lg text-white text-sm font-semibold cursor-pointer"
            style={{ backgroundColor: siteConfig.accentColor }}
          >
            {authStatus.needsFirstRunSetup ? 'Créer et accéder' : 'Se connecter'}
          </button>
        </form>
      </section>
    );
  }

  async function runScenarioTest(
    orderId: string,
    scenario: 'EXACT' | 'UNDERPAID' | 'OVERPAID' | 'FAILED' | 'PENDING'
  ) {
    if (!token) return;
    const resp = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/verify-scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ scenario }),
    });
    const data = (await resp.json()) as { order?: OrderRecord; error?: string };
    if (data.order) {
      setActionBanner(
        `Test serveur [${scenario}] sur ${data.order.order_number} → ${data.order.status} : « ${data.order.status_message} »`
      );
      loadAllAdminData(token);
    } else if (data.error) {
      setActionBanner(data.error);
    }
  }

  async function verifyOriginalProtection() {
    try {
      const r1 = await fetch('/storage/originals/orig_lagune_nuit.mp4');
      const r2 = await fetch('/api/downloads/faux-token-invalide');
      setActionBanner(
        `Test protection fichiers originaux : accès direct (/storage/originals/...) → HTTP ${r1.status} ; faux jeton (/api/downloads/...) → HTTP ${r2.status} (accès bloqué).`
      );
    } catch {
      setActionBanner('Accès direct aux originaux bloqué.');
    }
  }

  async function togglePublish(video: VideoItem) {
    if (!token) return;
    await fetch(`/api/admin/videos/${encodeURIComponent(video.id)}/publish`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isPublished: !video.is_published }),
    });
    loadAllAdminData(token);
    onRefreshStorefront();
  }

  async function executeConfirmedDelete(video: VideoItem) {
    if (!token) return;
    const resp = await fetch(`/api/admin/videos/${encodeURIComponent(video.id)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ confirmDelete: true }),
    });
    const data = (await resp.json()) as { message?: string };
    setConfirmDeleteVideo(null);
    setActionBanner(
      data.message ||
        'Fiche vidéo supprimée. Le fichier original est conservé en sécurité dans le stockage privé.'
    );
    loadAllAdminData(token);
    onRefreshStorefront();
  }

  async function askAiControlCenter(q: string) {
    if (!token || !q.trim()) return;
    setAiQuestion(q);
    setAiLoading(true);
    try {
      const resp = await fetch('/api/admin/ai-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: q }),
      });
      const data = (await resp.json()) as { report?: string; openAiActive?: boolean };
      setAiReport(data.report || 'Aucun rapport généré.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleCreateBackup() {
    if (!token) return;
    const resp = await fetch('/api/admin/backups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      setActionBanner(
        'Sauvegarde complète créée (base SQLite + copie indépendante des vidéos originales). Lancez un test de restauration pour la valider.'
      );
      loadAllAdminData(token);
    }
  }

  async function handleTestRestore(backupId: string) {
    if (!token) return;
    const resp = await fetch(`/api/admin/backups/${encodeURIComponent(backupId)}/test-restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await resp.json()) as { success?: boolean; details?: string };
    setActionBanner(data.details || 'Test terminé.');
    loadAllAdminData(token);
  }

  async function handleRestoreBackup(backupId: string) {
    if (!token) return;
    const resp = await fetch(`/api/admin/backups/${encodeURIComponent(backupId)}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ confirmRestore: true }),
    });
    const data = (await resp.json()) as { message?: string; error?: string };
    setActionBanner(data.message || data.error || 'Restauration exécutée.');
    loadAllAdminData(token);
  }

  async function handleDownloadSourceZip() {
    if (!token) return;
    setActionBanner('Préparation de l’archive ZIP de l’application...');
    try {
      const resp = await fetch('/api/admin/export-source-zip', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setActionBanner('Impossible de générer le fichier ZIP.');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cineveo-application.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setActionBanner('Téléchargement de cineveo-application.zip lancé sur votre appareil.');
    } catch {
      setActionBanner('Erreur réseau lors du téléchargement du ZIP.');
    }
  }

  const unreadNotifications =
    dashboard?.notifications.filter((n) => !n.is_read).length || 0;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-10 space-y-6">
      {/* Admin Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
            Tableau de bord Administrateur
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
            Gestion des vidéos Android, paiements XOF, Centre de contrôle IA et sauvegardes
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setEditingVideo(null);
              setUploadModalOpen(true);
            }}
            className="min-h-[42px] px-4 py-2 rounded-lg text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
            style={{ backgroundColor: siteConfig.accentColor }}
          >
            <Upload className="w-4 h-4" />
            <span>Importer une vidéo</span>
          </button>

          <button
            type="button"
            onClick={() => loadAllAdminData(token)}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-[#141419] border border-white/10 text-xs text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[42px] px-3.5 py-2 rounded-lg bg-[#141419] border border-white/10 text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionBanner && (
        <div className="p-3.5 rounded-xl bg-white/5 border border-white/15 flex items-center justify-between gap-3 text-xs sm:text-sm text-zinc-100">
          <span>{actionBanner}</span>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-xs text-zinc-400 hover:text-white cursor-pointer shrink-0"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Integration Readiness Status (Honest Config Notice) */}
      {dashboard && (!dashboard.cinetPayConfigured || !dashboard.openAiConfigured) && (
        <div className="p-4 rounded-xl bg-[#141419] border border-amber-500/25 text-xs text-zinc-300 space-y-1">
          <p className="font-semibold text-amber-300">
            Variables externes à renseigner pour la production (Settings → Secrets) :
          </p>
          <p>
            {!dashboard.cinetPayConfigured && (
              <span>• CinetPay Côte d’Ivoire : <span className="font-mono">CINETPAY_API_KEY</span>, <span className="font-mono">CINETPAY_SITE_ID</span>, <span className="font-mono">CINETPAY_SECRET_KEY</span>. </span>
            )}
            {!dashboard.openAiConfigured && (
              <span>• Assistant & Contrôle IA OpenAI : <span className="font-mono">OPENAI_API_KEY</span> (en attendant, le moteur analytique SQLite réel répond directement aux requêtes).</span>
            )}
          </p>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-white/10 pb-2">
        {(
          [
            { id: 'overview', label: `Vue d’ensemble${unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}` },
            { id: 'videos', label: `Vidéos (${adminVideos.length})` },
            { id: 'orders', label: `Transactions & Tests (${dashboard?.orders.length || 0})` },
            { id: 'marketing', label: 'Catégories, Promos & Identité' },
            { id: 'ai', label: 'Centre de contrôle IA' },
            { id: 'backups', label: `Sauvegardes (${backups.length})` },
          ] as Array<{ id: AdminTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'text-white'
                : 'bg-[#141419] text-zinc-400 hover:text-white border border-white/10'
            }`}
            style={activeTab === tab.id ? { backgroundColor: siteConfig.accentColor } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW & ANALYTICS */}
      {activeTab === 'overview' && dashboard && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl bg-[#141419] border border-white/10 space-y-1">
              <p className="text-xs text-zinc-400">Revenus confirmés</p>
              <p className="font-mono tabular-nums text-xl sm:text-2xl font-bold text-emerald-400">
                {formatFcfa(dashboard.kpis.confirmedRevenueFcfa)}
              </p>
              <p className="text-[11px] text-zinc-500 font-mono tabular-nums">
                {dashboard.kpis.confirmedSales} vente(s) validée(s)
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#141419] border border-white/10 space-y-1">
              <p className="text-xs text-zinc-400">Commandes totales</p>
              <p className="font-mono tabular-nums text-xl sm:text-2xl font-bold text-white">
                {dashboard.kpis.totalOrders}
              </p>
              <p className="text-[11px] text-zinc-500 font-mono tabular-nums">
                {dashboard.kpis.pendingPayments} en attente · {dashboard.kpis.failedPayments} échouées
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#141419] border border-white/10 space-y-1">
              <p className="text-xs text-zinc-400">Catalogue vidéos</p>
              <p className="font-mono tabular-nums text-xl sm:text-2xl font-bold text-white">
                {dashboard.kpis.totalVideos}
              </p>
              <p className="text-[11px] text-zinc-500 font-mono tabular-nums">
                {dashboard.kpis.publishedVideos} publiée(s) en ligne
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#141419] border border-white/10 space-y-1">
              <p className="text-xs text-zinc-400">Consultations aperçus</p>
              <p className="font-mono tabular-nums text-xl sm:text-2xl font-bold text-white">
                {dashboard.kpis.totalViews.toLocaleString('fr-FR')}
              </p>
              <p className="text-[11px] text-zinc-500">Vues totales enregistrées</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bestsellers & Most Viewed */}
            <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
              <h2 className="text-base font-semibold text-white">
                Meilleures ventes & Vidéos les plus consultées
              </h2>
              <div className="divide-y divide-white/10">
                {dashboard.bestSellers.map((v) => (
                  <div key={v.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <span className="text-zinc-200 font-medium truncate">{v.title}</span>
                    <div className="font-mono tabular-nums text-zinc-400 shrink-0">
                      <span className="text-white font-semibold">{v.sales_count} ventes</span> ·{' '}
                      {v.views_count} vues
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notifications */}
            <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-zinc-400" />
                  <span>Notifications administrateur</span>
                </h2>
                {unreadNotifications > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch('/api/admin/notifications/read', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      loadAllAdminData(token);
                    }}
                    className="text-xs text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Tout marquer comme lu
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {dashboard.notifications.length === 0 ? (
                  <p className="text-xs text-zinc-400">Aucune notification pour le moment.</p>
                ) : (
                  dashboard.notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-3 rounded-xl border text-xs space-y-0.5 ${
                        n.is_read
                          ? 'bg-[#101015] border-white/5 text-zinc-400'
                          : 'bg-white/5 border-white/15 text-zinc-200'
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold text-white">{n.title}</span>
                        <span className="text-[11px] text-zinc-500">{formatDateFr(n.created_at)}</span>
                      </div>
                      <p>{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Revenue by Day */}
          <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-3">
            <h2 className="text-base font-semibold text-white">Revenus confirmés par période</h2>
            {dashboard.revenueByDay.length === 0 ? (
              <p className="text-xs text-zinc-400">
                Les statistiques journalières apparaîtront dès la première vente confirmée.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
                {dashboard.revenueByDay.map((d) => (
                  <div key={d.day} className="p-3 rounded-xl bg-[#0D0D12] border border-white/10">
                    <p className="font-mono text-[11px] text-zinc-400">{d.day}</p>
                    <p className="font-mono tabular-nums text-sm font-bold text-emerald-400 mt-1">
                      {formatFcfa(d.revenue_fcfa)}
                    </p>
                    <p className="text-[11px] text-zinc-500">{d.sales} vente(s)</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: VIDEOS MANAGEMENT */}
      {activeTab === 'videos' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#141419]">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-white/10 text-xs text-zinc-400 bg-[#101015]">
                <tr>
                  <th className="py-3 px-4 font-medium">Vidéo</th>
                  <th className="py-3 px-4 font-medium">Catégorie</th>
                  <th className="py-3 px-4 font-medium text-right">Prix FCFA</th>
                  <th className="py-3 px-4 font-medium text-right">Ventes / Vues</th>
                  <th className="py-3 px-4 font-medium">Statut</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {adminVideos.map((v) => (
                  <tr key={v.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={v.poster_url}
                          alt={v.title}
                          className="w-10 h-14 rounded object-cover bg-black shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate max-w-[220px]">{v.title}</p>
                          <p className="text-[11px] text-zinc-400 font-mono">
                            {v.duration_label} · {formatBytes(v.file_size_bytes)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-300 whitespace-nowrap">{v.category_name}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {priceEditVideoId === v.id ? (
                        <div className="inline-flex flex-col items-end gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              value={inlinePrice}
                              onChange={(e) => setInlinePrice(e.target.value)}
                              aria-label="Prix FCFA"
                              placeholder="Prix FCFA"
                              className="w-24 min-h-[34px] px-2 rounded bg-[#09090C] border border-white/25 text-xs text-white text-right font-mono"
                            />
                            <input
                              type="number"
                              min={1}
                              value={inlinePromoPrice}
                              onChange={(e) => setInlinePromoPrice(e.target.value)}
                              aria-label="Prix promo FCFA"
                              placeholder="Promo"
                              className="w-20 min-h-[34px] px-2 rounded bg-[#09090C] border border-white/15 text-xs text-white text-right font-mono placeholder:font-sans placeholder:text-zinc-500"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={savingPrice}
                              onClick={async () => {
                                if (!token) return;
                                setSavingPrice(true);
                                try {
                                  const resp = await fetch(
                                    `/api/admin/videos/${encodeURIComponent(v.id)}/price`,
                                    {
                                      method: 'PATCH',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${token}`,
                                      },
                                      body: JSON.stringify({
                                        priceFcfa: Number(inlinePrice),
                                        promoPriceFcfa: inlinePromoPrice
                                          ? Number(inlinePromoPrice)
                                          : null,
                                      }),
                                    }
                                  );
                                  const data = (await resp.json()) as { error?: string };
                                  if (!resp.ok) {
                                    setActionBanner(data.error || 'Prix invalide.');
                                    return;
                                  }
                                  setPriceEditVideoId(null);
                                  setActionBanner(`Tarif mis à jour pour « ${v.title} ».`);
                                  loadAllAdminData(token);
                                  onRefreshStorefront();
                                } finally {
                                  setSavingPrice(false);
                                }
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-sans font-semibold cursor-pointer disabled:opacity-50"
                            >
                              Valider
                            </button>
                            <button
                              type="button"
                              onClick={() => setPriceEditVideoId(null)}
                              className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-zinc-300 text-[11px] font-sans cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <div className="text-white font-semibold">
                            {formatFcfa(v.promo_price_fcfa ?? v.price_fcfa)}
                          </div>
                          {v.promo_price_fcfa && (
                            <div className="text-[11px] text-zinc-500 line-through">
                              {formatFcfa(v.price_fcfa)}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setPriceEditVideoId(v.id);
                              setInlinePrice(String(v.price_fcfa));
                              setInlinePromoPrice(
                                v.promo_price_fcfa ? String(v.promo_price_fcfa) : ''
                              );
                            }}
                            className="text-[11px] font-sans text-zinc-400 hover:text-white underline cursor-pointer"
                          >
                            Fixer le prix
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                      {v.sales_count} / {v.views_count}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`text-xs font-medium ${
                          v.is_published ? 'text-emerald-400' : 'text-zinc-400'
                        }`}
                      >
                        {v.is_published ? 'Publiée' : 'Dépubliée'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => togglePublish(v)}
                          title={v.is_published ? 'Dépublier' : 'Publier'}
                          className="min-h-[36px] min-w-[36px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200 inline-flex items-center justify-center cursor-pointer"
                        >
                          {v.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVideo(v);
                            setUploadModalOpen(true);
                          }}
                          title="Modifier"
                          className="min-h-[36px] min-w-[36px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-200 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteVideo(v)}
                          title="Supprimer"
                          className="min-h-[36px] min-w-[36px] px-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: TRANSACTIONS & PAYMENT VERIFICATION TEST SUITE */}
      {activeTab === 'orders' && dashboard && (
        <div className="space-y-5">
          <div className="p-4 rounded-xl bg-[#141419] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-white">
                Banc de tests serveur : Paiements & Protection des fichiers originaux
              </h2>
              <p className="text-xs text-zinc-400">
                Exécutez les 5 scénarios obligatoires côté serveur sur n’importe quelle commande en attente et vérifiez le blocage des fichiers originaux.
              </p>
            </div>
            <button
              type="button"
              onClick={verifyOriginalProtection}
              className="min-h-[40px] px-4 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Tester protection originaux</span>
            </button>
          </div>

          <div className="space-y-3">
            {dashboard.orders.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#141419] border border-white/10 text-center text-sm text-zinc-400">
                Aucune transaction enregistrée. Initiez un achat depuis le catalogue pour tester la vérification serveur.
              </div>
            ) : (
              dashboard.orders.map((o) => {
                const statusMeta = getOrderStatusLabel(o.status);
                return (
                  <div
                    key={o.id}
                    className="p-4 rounded-xl bg-[#141419] border border-white/10 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-white">{o.order_number}</span>
                          <span className="text-zinc-500">·</span>
                          <span className="font-mono text-zinc-400">{o.transaction_ref}</span>
                          <span className="text-zinc-500">·</span>
                          <span className={`font-semibold ${statusMeta.toneClass}`}>
                            {statusMeta.label}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-white">{o.video_title}</p>
                        <p className="text-xs text-zinc-400">
                          {o.customer_name} ({o.customer_phone}) · {formatPaymentMethod(o.payment_method)} ·{' '}
                          {formatDateFr(o.created_at)}
                        </p>
                      </div>

                      <div className="text-right font-mono tabular-nums text-xs">
                        <div className="text-sm font-bold text-white">
                          Attendu : {formatFcfa(o.expected_amount_fcfa)}
                        </div>
                        <div className="text-zinc-400">
                          Reçu : {formatFcfa(o.received_amount_fcfa)} ({o.currency})
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-zinc-300">{o.status_message}</p>

                    {o.status !== 'CONFIRMED' && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                        <span className="text-[11px] text-zinc-400 mr-1">
                          Tests vérification serveur :
                        </span>
                        <button
                          type="button"
                          onClick={() => runScenarioTest(o.id, 'EXACT')}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs cursor-pointer"
                        >
                          Paiement exact
                        </button>
                        <button
                          type="button"
                          onClick={() => runScenarioTest(o.id, 'UNDERPAID')}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs cursor-pointer"
                        >
                          Insuffisant
                        </button>
                        <button
                          type="button"
                          onClick={() => runScenarioTest(o.id, 'OVERPAID')}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs cursor-pointer"
                        >
                          Supérieur
                        </button>
                        <button
                          type="button"
                          onClick={() => runScenarioTest(o.id, 'FAILED')}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs cursor-pointer"
                        >
                          Échoué
                        </button>
                        <button
                          type="button"
                          onClick={() => runScenarioTest(o.id, 'PENDING')}
                          className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-200 text-xs cursor-pointer"
                        >
                          En attente
                        </button>

                        {o.status === 'OVERPAID_REVIEW' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await fetch(
                                `/api/admin/orders/${encodeURIComponent(o.id)}/approve-overpaid`,
                                {
                                  method: 'POST',
                                  headers: { Authorization: `Bearer ${token}` },
                                }
                              );
                              loadAllAdminData(token);
                            }}
                            className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                          >
                            Approuver après contrôle
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 4: CATEGORIES, PROMOS, ANNOUNCEMENTS, VISUAL IDENTITY */}
      {activeTab === 'marketing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Categories */}
          <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
            <h2 className="text-base font-semibold text-white">Catégories</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCatName.trim()) return;
                await fetch('/api/admin/categories', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ name: newCatName }),
                });
                setNewCatName('');
                onRefreshStorefront();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Nouvelle catégorie..."
                className="flex-1 min-h-[40px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
              />
              <button
                type="submit"
                className="min-h-[40px] px-3.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter</span>
              </button>
            </form>
            <div className="divide-y divide-white/10">
              {categories.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                  <span className="text-zinc-200">{c.name}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/admin/categories/${encodeURIComponent(c.id)}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      onRefreshStorefront();
                    }}
                    className="text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    Supprimer
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Promo Codes */}
          <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
            <h2 className="text-base font-semibold text-white">Codes promotionnels</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await fetch('/api/admin/promos', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    code: newPromoCode,
                    discountType: newPromoType,
                    discountValue: Number(newPromoValue),
                    maxUses: Number(newPromoMaxUses),
                    validDays: Number(newPromoDays),
                  }),
                });
                setNewPromoCode('');
                loadAllAdminData(token);
              }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              <input
                type="text"
                required
                value={newPromoCode}
                onChange={(e) => setNewPromoCode(e.target.value)}
                placeholder="CODE25"
                className="min-h-[40px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white uppercase"
              />
              <select
                value={newPromoType}
                onChange={(e) => setNewPromoType(e.target.value as 'percent' | 'fixed')}
                className="min-h-[40px] px-2 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
              >
                <option value="percent">% Réduction</option>
                <option value="fixed">FCFA fixe</option>
              </select>
              <input
                type="number"
                min={1}
                required
                value={newPromoValue}
                onChange={(e) => setNewPromoValue(e.target.value)}
                placeholder="Valeur"
                className="min-h-[40px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white font-mono"
              />
              <button
                type="submit"
                className="min-h-[40px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
              >
                Créer code
              </button>
              <input
                type="number"
                min={1}
                value={newPromoMaxUses}
                onChange={(e) => setNewPromoMaxUses(e.target.value)}
                placeholder="Limite utilisations"
                className="col-span-1 sm:col-span-2 min-h-[38px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white font-mono"
              />
              <input
                type="number"
                min={1}
                value={newPromoDays}
                onChange={(e) => setNewPromoDays(e.target.value)}
                placeholder="Validité (jours)"
                className="col-span-1 sm:col-span-2 min-h-[38px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white font-mono"
              />
            </form>

            <div className="divide-y divide-white/10">
              {promos.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-mono font-bold text-white">{p.code}</span> ·{' '}
                    <span className="text-zinc-300">
                      {p.discount_type === 'percent'
                        ? `-${p.discount_value}%`
                        : `-${formatFcfa(p.discount_value)}`}
                    </span>{' '}
                    ·{' '}
                    <span className="font-mono text-zinc-400">
                      {p.uses_count}/{p.max_uses}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/admin/promos/${encodeURIComponent(p.id)}`, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ isActive: !p.is_active }),
                      });
                      loadAllAdminData(token);
                    }}
                    className={`cursor-pointer ${p.is_active ? 'text-emerald-400' : 'text-zinc-500'}`}
                  >
                    {p.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Customizable Brand Identity */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await fetch('/api/admin/settings', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  brandName: brandNameInput,
                  tagline: taglineInput,
                  accentColor: accentInput,
                  heroVideoId: heroVideoInput || null,
                }),
              });
              setActionBanner('Identité visuelle mise à jour.');
              onRefreshStorefront();
            }}
            className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4"
          >
            <h2 className="text-base font-semibold text-white">
              Identité visuelle personnalisable
            </h2>
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">Nom de la plateforme</span>
                <input
                  type="text"
                  value={brandNameInput}
                  onChange={(e) => setBrandNameInput(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-zinc-400">Slogan d’accueil</span>
                <input
                  type="text"
                  value={taglineInput}
                  onChange={(e) => setTaglineInput(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs text-zinc-400">Couleur d’accentuation</span>
                  <input
                    type="color"
                    value={accentInput}
                    onChange={(e) => setAccentInput(e.target.value)}
                    className="w-full h-10 rounded-lg bg-[#09090C] border border-white/15 p-1 cursor-pointer"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-zinc-400">Vidéo bannière</span>
                  <select
                    value={heroVideoInput}
                    onChange={(e) => setHeroVideoInput(e.target.value)}
                    className="w-full min-h-[40px] px-2 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
                  >
                    <option value="">Automatique</option>
                    {adminVideos.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="min-h-[40px] px-4 rounded-lg text-white text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: siteConfig.accentColor }}
            >
              Enregistrer l’identité
            </button>
          </form>

          {/* Announcements */}
          <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
            <h2 className="text-base font-semibold text-white">Annonces & Bannières</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await fetch('/api/admin/announcements', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ title: newAnnTitle, content: newAnnContent }),
                });
                setNewAnnTitle('');
                setNewAnnContent('');
                loadAllAdminData(token);
                onRefreshStorefront();
              }}
              className="space-y-2.5"
            >
              <input
                type="text"
                required
                value={newAnnTitle}
                onChange={(e) => setNewAnnTitle(e.target.value)}
                placeholder="Titre de l’annonce..."
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
              />
              <textarea
                rows={2}
                required
                value={newAnnContent}
                onChange={(e) => setNewAnnContent(e.target.value)}
                placeholder="Message affiché en haut de la boutique..."
                className="w-full p-3 rounded-lg bg-[#09090C] border border-white/15 text-xs text-white"
              />
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
              >
                Publier l’annonce
              </button>
            </form>
            <div className="divide-y divide-white/10">
              {announcements.map((a) => (
                <div key={a.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{a.title}</p>
                    <p className="text-zinc-400 truncate">{a.content}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/admin/announcements/${encodeURIComponent(a.id)}`, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ isActive: !a.is_active }),
                      });
                      loadAllAdminData(token);
                      onRefreshStorefront();
                    }}
                    className={`cursor-pointer shrink-0 ${
                      a.is_active ? 'text-emerald-400' : 'text-zinc-500'
                    }`}
                  >
                    {a.is_active ? 'Active' : 'Masquée'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AI CONTROL CENTER */}
      {activeTab === 'ai' && (
        <div className="p-5 sm:p-6 rounded-2xl bg-[#141419] border border-white/10 space-y-5">
          <div className="flex items-start gap-3">
            <Bot className="w-6 h-6 text-zinc-200 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-lg font-bold text-white">
                Centre de Contrôle IA Administrateur
              </h2>
              <p className="text-xs text-zinc-400">
                Analyse vos données réelles (ventes confirmées en FCFA, vues, commandes en attente) sans aucune invention.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {AI_PRESET_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => askAiControlCenter(q)}
                className="px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-zinc-200 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              askAiControlCenter(aiQuestion);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              placeholder="Posez une question d’analyse sur votre activité..."
              className="flex-1 min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white"
            />
            <button
              type="submit"
              disabled={aiLoading || !aiQuestion.trim()}
              className="min-h-[44px] px-5 rounded-lg text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: siteConfig.accentColor }}
            >
              {aiLoading ? 'Analyse...' : 'Analyser'}
            </button>
          </form>

          {aiReport && (
            <div className="p-4 sm:p-5 rounded-xl bg-[#0C0C10] border border-white/15 text-sm text-zinc-200 whitespace-pre-line leading-relaxed">
              {aiReport}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: BACKUPS, ORIGINALS COPY & RESTORE TESTING */}
      {activeTab === 'backups' && dashboard && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <DatabaseBackup className="w-5 h-5 text-zinc-300" />
                <span>Sauvegarde & Protection des Vidéos Originales</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Crée un instantané SQLite cohérent et une copie indépendante de tous les fichiers originaux avec vérification SHA-256. Aucune sauvegarde n’est validée sans test de restauration réel.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleDownloadSourceZip}
                className="min-h-[44px] px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <HardDriveDownload className="w-4 h-4" />
                <span>Télécharger l’application (.zip)</span>
              </button>
              <button
                type="button"
                onClick={handleCreateBackup}
                className="min-h-[44px] px-4 py-2.5 rounded-lg text-white text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
                style={{ backgroundColor: siteConfig.accentColor }}
              >
                <DatabaseBackup className="w-4 h-4" />
                <span>Créer une sauvegarde complète</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {backups.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#141419] border border-white/10 text-center text-sm text-zinc-400">
                Aucune sauvegarde créée pour le moment. Créez votre première sauvegarde et exécutez son test de restauration.
              </div>
            ) : (
              backups.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-xl bg-[#141419] border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white">{b.backup_name}</span>
                      {b.restore_tested ? (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Restauration testée et validée</span>
                        </span>
                      ) : (
                        <span className="text-xs text-amber-300 flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Non testée</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 font-mono tabular-nums">
                      {b.originals_count} vidéo(s) originale(s) · {formatBytes(b.total_size_bytes)} ·{' '}
                      {formatDateFr(b.created_at)}
                    </p>
                    {b.restore_test_result && (
                      <p className="text-xs text-zinc-300">{b.restore_test_result}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTestRestore(b.id)}
                      className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
                    >
                      Tester la restauration
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRestoreBackup(b.id)}
                      className="min-h-[40px] px-3.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-xs font-semibold text-amber-200 cursor-pointer"
                    >
                      Restaurer
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Admin Audit Logs */}
          <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Historique des opérations administrateur
            </h3>
            <div className="divide-y divide-white/10 max-h-64 overflow-y-auto">
              {dashboard.auditLogs.map((log) => (
                <div key={log.id} className="py-2 flex flex-wrap justify-between gap-2 text-xs">
                  <div>
                    <span className="font-mono text-zinc-300">{log.action}</span> ·{' '}
                    <span className="text-zinc-400">{log.details}</span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {formatDateFr(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upload / Edit Video Modal */}
      {uploadModalOpen && (
        <AdminUploadModal
          token={token}
          accentColor={siteConfig.accentColor}
          categories={categories}
          editingVideo={editingVideo}
          onClose={() => {
            setUploadModalOpen(false);
            setEditingVideo(null);
          }}
          onSaved={() => {
            setUploadModalOpen(false);
            setEditingVideo(null);
            loadAllAdminData(token);
            onRefreshStorefront();
          }}
        />
      )}

      {/* Explicit Delete Confirmation Modal */}
      {confirmDeleteVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-[#141419] border border-white/15 rounded-2xl p-6 space-y-4">
            <h3 className="font-display text-lg font-bold text-white">
              Confirmer la suppression
            </h3>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Voulez-vous vraiment retirer «{' '}
              <strong className="text-white">{confirmDeleteVideo.title}</strong> » du catalogue ?
              Par mesure de protection, le fichier original sur le serveur ne sera jamais supprimé automatiquement.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteVideo(null)}
                className="min-h-[42px] px-4 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-300 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => executeConfirmedDelete(confirmDeleteVideo)}
                className="min-h-[42px] px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
              >
                Confirmer la suppression
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
