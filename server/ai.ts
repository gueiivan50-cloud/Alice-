import { db } from './db.ts';

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

interface CatalogSnapshotVideo {
  id: string;
  title: string;
  category: string;
  duration_label: string;
  price_fcfa: number;
  promo_price_fcfa: number | null;
  views_count: number;
  sales_count: number;
  is_new: number;
  is_bestseller: number;
}

function getRealCatalogContext(): {
  brandName: string;
  videos: CatalogSnapshotVideo[];
  activePromos: Array<{ code: string; discount_type: string; discount_value: number }>;
} {
  const settings = db
    .prepare(`SELECT brand_name FROM site_settings WHERE id = 1`)
    .get() as { brand_name: string } | undefined;

  const videos = db
    .prepare(`
      SELECT v.id, v.title, COALESCE(c.name, 'Général') AS category,
             v.duration_label, v.price_fcfa, v.promo_price_fcfa,
             v.views_count, v.sales_count, v.is_new, v.is_bestseller
      FROM videos v
      LEFT JOIN categories c ON c.id = v.category_id
      WHERE v.is_published = 1
      ORDER BY v.sales_count DESC, v.views_count DESC
      LIMIT 40
    `)
    .all() as unknown as CatalogSnapshotVideo[];

  const now = new Date().toISOString();
  const activePromos = db
    .prepare(`
      SELECT code, discount_type, discount_value
      FROM promo_codes
      WHERE is_active = 1 AND valid_until >= ? AND uses_count < max_uses
    `)
    .all(now) as Array<{ code: string; discount_type: string; discount_value: number }>;

  return {
    brandName: settings?.brand_name || 'CINEVEO',
    videos,
    activePromos,
  };
}

function getRealAdminAnalyticsContext() {
  const stats = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM videos) AS total_videos,
        (SELECT COUNT(*) FROM videos WHERE is_published = 1) AS published_videos,
        (SELECT COUNT(*) FROM orders) AS total_orders,
        (SELECT COUNT(*) FROM orders WHERE status = 'CONFIRMED') AS confirmed_orders,
        (SELECT COALESCE(SUM(received_amount_fcfa), 0) FROM orders WHERE status = 'CONFIRMED') AS confirmed_revenue_fcfa,
        (SELECT COUNT(*) FROM orders WHERE status IN ('PENDING', 'OVERPAID_REVIEW')) AS pending_orders,
        (SELECT COUNT(*) FROM orders WHERE status IN ('FAILED', 'UNDERPAID')) AS failed_orders
    `)
    .get() as Record<string, number>;

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const weeklyRevenue = (
    db
      .prepare(
        `SELECT COALESCE(SUM(received_amount_fcfa), 0) AS total FROM orders WHERE status = 'CONFIRMED' AND confirmed_at >= ?`
      )
      .get(weekAgo) as { total: number }
  ).total;

  const bestSellers = db
    .prepare(`
      SELECT title, price_fcfa, promo_price_fcfa, sales_count, views_count
      FROM videos
      ORDER BY sales_count DESC, views_count DESC
      LIMIT 5
    `)
    .all() as Array<{
    title: string;
    price_fcfa: number;
    promo_price_fcfa: number | null;
    sales_count: number;
    views_count: number;
  }>;

  const mostViewed = db
    .prepare(`
      SELECT title, views_count, sales_count, price_fcfa
      FROM videos
      ORDER BY views_count DESC
      LIMIT 5
    `)
    .all() as Array<{
    title: string;
    views_count: number;
    sales_count: number;
    price_fcfa: number;
  }>;

  return { stats, weeklyRevenue, bestSellers, mostViewed };
}

async function callOpenAiChat(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY non configurée');
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erreur OpenAI (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return (
    json.choices?.[0]?.message?.content?.trim() ||
    'Je n’ai pas pu formuler de réponse pour le moment.'
  );
}

function buildGroundedFallbackCustomerReply(
  question: string,
  context: ReturnType<typeof getRealCatalogContext>
): string {
  const q = question.toLowerCase();

  if (q.includes('prix') || q.includes('combien') || q.includes('catalogue') || q.includes('vidéo') || q.includes('video')) {
    const lines = context.videos.slice(0, 5).map((v) => {
      const effective = v.promo_price_fcfa ?? v.price_fcfa;
      return `• ${v.title} (${v.category}, ${v.duration_label}) : ${effective.toLocaleString('fr-FR')} FCFA`;
    });
    return `Voici nos vidéos disponibles en ce moment sur ${context.brandName} :\n${lines.join('\n')}\n\nVous pouvez regarder gratuitement l'aperçu de chaque titre avant d'acheter sans créer de compte.`;
  }

  if (q.includes('paiement') || q.includes('wave') || q.includes('orange') || q.includes('mobile') || q.includes('payer') || q.includes('carte')) {
    return `Nous acceptons Wave, Orange Money, Mobile Money (MTN/Moov) et les cartes bancaires en FCFA (XOF). Le déblocage du téléchargement se fait automatiquement après confirmation officielle du prestataire de paiement pour le montant exact.`;
  }

  if (q.includes('promo') || q.includes('code') || q.includes('réduction') || q.includes('reduction')) {
    if (context.activePromos.length > 0) {
      const p = context.activePromos[0];
      const val = p.discount_type === 'percent' ? `-${p.discount_value}%` : `-${p.discount_value} FCFA`;
      return `Un code promotionnel est actif : ${p.code} (${val}). Saisissez-le dans le formulaire de commande avant le paiement.`;
    }
    return `Certaines vidéos bénéficient actuellement de tarifs promotionnels affichés directement sur leurs fiches.`;
  }

  if (q.includes('télécharg') || q.includes('telecharg') || q.includes('commande') || q.includes('perdu')) {
    return `Après confirmation du paiement, vous recevez un reçu, un numéro de commande et un lien sécurisé pour enregistrer la vidéo originale sur votre téléphone Android ou ordinateur. Si vous avez perdu votre lien, utilisez l'onglet « Mes achats » avec votre numéro de commande et votre téléphone pour vérifier votre identité. Pour des raisons de sécurité, aucun paiement ne peut être confirmé manuellement sans vérification serveur.`;
  }

  const top = context.videos[0];
  return `Bienvenue sur ${context.brandName} ! Je peux vous présenter nos vidéos (${context.videos.length} titres publiés), vous indiquer les prix en FCFA ou vous expliquer le paiement par Wave, Orange Money, Mobile Money et carte bancaire.${top ? ` Par exemple, notre titre populaire « ${top.title} » est proposé à ${(top.promo_price_fcfa ?? top.price_fcfa).toLocaleString('fr-FR')} FCFA.` : ''}`;
}

function buildGroundedFallbackAdminReply(
  question: string,
  analytics: ReturnType<typeof getRealAdminAnalyticsContext>
): string {
  const q = question.toLowerCase();
  const { stats, weeklyRevenue, bestSellers, mostViewed } = analytics;

  if (q.includes('meilleur') || q.includes('vente')) {
    const lines = bestSellers.map(
      (v, idx) =>
        `${idx + 1}. ${v.title} — ${v.sales_count} ventes (${(v.promo_price_fcfa ?? v.price_fcfa).toLocaleString('fr-FR')} FCFA)`
    );
    return `Meilleures ventes basées sur la base de données actuelle :\n${lines.join('\n')}`;
  }

  if (q.includes('semaine') || q.includes('gagné') || q.includes('gagne') || q.includes('revenu')) {
    return `Revenus confirmés cette semaine (7 derniers jours) : ${weeklyRevenue.toLocaleString('fr-FR')} FCFA.\nTotal cumulé des commandes confirmées : ${stats.confirmed_revenue_fcfa.toLocaleString('fr-FR')} FCFA sur ${stats.confirmed_orders} vente(s) validée(s).`;
  }

  if (q.includes('populaire') || q.includes('vu') || q.includes('consult')) {
    const lines = mostViewed.map(
      (v, idx) => `${idx + 1}. ${v.title} — ${v.views_count} vues (${v.sales_count} ventes)`
    );
    return `Vidéos les plus populaires (par nombre de vues enregistrées) :\n${lines.join('\n')}`;
  }

  if (q.includes('attente') || q.includes('pending')) {
    return `Commandes actuellement en attente ou en vérification : ${stats.pending_orders} (sur ${stats.total_orders} commandes totales, dont ${stats.failed_orders} échouées ou insuffisantes).`;
  }

  if (q.includes('mettre en avant') || q.includes('recommand') || q.includes('avant')) {
    const highViewLowSale = [...mostViewed].sort(
      (a, b) => b.views_count / Math.max(1, b.sales_count) - a.views_count / Math.max(1, a.sales_count)
    )[0];
    return `Analyse catalogue : « ${bestSellers[0]?.title || 'N/A'} » génère le plus fort volume (${bestSellers[0]?.sales_count || 0} ventes).${highViewLowSale ? ` « ${highViewLowSale.title} » attire ${highViewLowSale.views_count} vues pour ${highViewLowSale.sales_count} ventes : une mise en avant ou un tarif promo ciblé pourrait augmenter sa conversion.` : ''}`;
  }

  return `Synthèse en temps réel : ${stats.published_videos} vidéos publiées, ${stats.confirmed_orders} commandes confirmées (${stats.confirmed_revenue_fcfa.toLocaleString('fr-FR')} FCFA), ${stats.pending_orders} en attente et ${stats.failed_orders} échouées/insuffisantes.`;
}

export async function runCustomerAiAssistant(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ reply: string; openAiActive: boolean }> {
  const context = getRealCatalogContext();
  const catalogJson = JSON.stringify(context, null, 2);

  const systemPrompt = `Tu es l'assistant commercial intelligent de la plateforme vidéo ${context.brandName}.
RÈGLES STRICTES :
1. Réponds exclusivement en français, avec un ton professionnel, chaleureux et concis.
2. Utilise UNIQUEMENT les données réelles du catalogue ci-dessous (titres, catégories, durées, prix en FCFA, codes promo actifs). N'invente jamais de vidéo, de prix ni de remise.
3. Moyens de paiement pris en charge : Wave, Orange Money, Mobile Money (MTN/Moov) et Cartes bancaires en FCFA (XOF). L'achat fonctionne sans création de compte.
4. SÉCURITÉ PAIEMENT : Tu ne dois JAMAIS inventer un paiement, ni prétendre qu'une commande est payée ou confirmée. Explique toujours que seul le contrôle serveur auprès du prestataire débloque le téléchargement.
5. Si le client cherche une commande perdue, oriente-le vers « Mes achats » où il devra fournir son numéro de commande et son téléphone/e-mail pour vérification.

DONNÉES RÉELLES DU CATALOGUE :
${catalogJson}`;

  if (isOpenAiConfigured()) {
    try {
      const reply = await callOpenAiChat(systemPrompt, messages.slice(-8));
      return { reply, openAiActive: true };
    } catch {
      const lastUser = messages[messages.length - 1]?.content || '';
      return {
        reply: buildGroundedFallbackCustomerReply(lastUser, context),
        openAiActive: false,
      };
    }
  }

  const lastUser = messages[messages.length - 1]?.content || '';
  return {
    reply: buildGroundedFallbackCustomerReply(lastUser, context),
    openAiActive: false,
  };
}

export async function runAdminAiInsights(
  question: string
): Promise<{ report: string; openAiActive: boolean; snapshot: ReturnType<typeof getRealAdminAnalyticsContext> }> {
  const snapshot = getRealAdminAnalyticsContext();

  const systemPrompt = `Tu es l'analyste IA du Centre de Contrôle Administrateur de la plateforme vidéo.
RÈGLES STRICTES :
1. Réponds en français clair, structuré et actionnable.
2. Appuie-toi EXCLUSIVEMENT sur les chiffres réels ci-dessous (ne fabrique aucune statistique).
3. Tous les montants sont en FCFA (XOF).

DONNÉES RÉELLES DE LA BASE :
${JSON.stringify(snapshot, null, 2)}`;

  if (isOpenAiConfigured()) {
    try {
      const report = await callOpenAiChat(systemPrompt, [{ role: 'user', content: question }]);
      return { report, openAiActive: true, snapshot };
    } catch {
      return {
        report: buildGroundedFallbackAdminReply(question, snapshot),
        openAiActive: false,
        snapshot,
      };
    }
  }

  return {
    report: buildGroundedFallbackAdminReply(question, snapshot),
    openAiActive: false,
    snapshot,
  };
}
