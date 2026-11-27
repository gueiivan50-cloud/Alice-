import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isOpenAiConfigured, runAdminAiInsights, runCustomerAiAssistant } from './server/ai.ts';
import { createFullBackup, restoreOriginalFilesFromBackup, testBackupRestore } from './server/backup.ts';
import { buildSourceCodeZip } from './server/zip.ts';
import {
  createAdminSession,
  createNotification,
  db,
  getAdminAuthState,
  hashPassword,
  hashSessionToken,
  initSchema,
  logAdminAudit,
  seedInitialData,
  validateAdminSession,
  verifyAdminPasscode,
} from './server/db.ts';
import {
  ensureSeedFileReady,
  ensureSeedMediaFiles,
  formatDurationLabel,
  generatePreviewFromOriginal,
  getFileSizeSafe,
} from './server/media.ts';
import {
  ORIGINALS_DIR,
  POSTERS_DIR,
  PREVIEWS_DIR,
  UPLOADS_TMP_DIR,
  ensureDirectories,
  safeResolveInside,
} from './server/paths.ts';
import {
  type OrderRecord,
  type PaymentMethod,
  checkCinetPayStatus,
  initializeCinetPayCheckout,
  isCinetPayConfigured,
  issueDownloadTokenForOrder,
  verifyPaymentTransaction,
  verifySignedDownloadToken,
} from './server/payments.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

function getBaseUrl(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function streamVideoWithRange(req: Request, res: Response, filePath: string, downloadFilename?: string): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Fichier média introuvable' });
    return;
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === '.webm'
      ? 'video/webm'
      : ext === '.mov'
        ? 'video/quicktime'
        : 'video/mp4';

  if (downloadFilename) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
    );
  } else {
    res.setHeader('Content-Disposition', 'inline');
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', end - start + 1);
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.status(200);
    res.setHeader('Content-Length', total);
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
  if (!validateAdminSession(token)) {
    res.status(401).json({ error: 'Authentification administrateur requise.' });
    return;
  }
  next();
}

function computeOrderAmounts(
  video: { price_fcfa: number; promo_price_fcfa: number | null },
  promoCodeRaw?: string
): { basePrice: number; discountFcfa: number; finalAmount: number; appliedPromoCode: string | null; promoError?: string } {
  const basePrice = video.promo_price_fcfa ?? video.price_fcfa;
  const code = (promoCodeRaw || '').trim().toUpperCase();
  if (!code) {
    return { basePrice, discountFcfa: 0, finalAmount: basePrice, appliedPromoCode: null };
  }

  const promo = db
    .prepare(`SELECT * FROM promo_codes WHERE UPPER(code) = ?`)
    .get(code) as
    | {
        code: string;
        discount_type: 'percent' | 'fixed';
        discount_value: number;
        max_uses: number;
        uses_count: number;
        valid_from: string;
        valid_until: string;
        is_active: number;
      }
    | undefined;

  if (!promo || !promo.is_active) {
    return { basePrice, discountFcfa: 0, finalAmount: basePrice, appliedPromoCode: null, promoError: 'Code promotionnel invalide ou inactif.' };
  }

  const now = Date.now();
  if (now < new Date(promo.valid_from).getTime() || now > new Date(promo.valid_until).getTime()) {
    return { basePrice, discountFcfa: 0, finalAmount: basePrice, appliedPromoCode: null, promoError: 'Ce code promotionnel a expiré.' };
  }

  if (promo.uses_count >= promo.max_uses) {
    return { basePrice, discountFcfa: 0, finalAmount: basePrice, appliedPromoCode: null, promoError: 'Limite d’utilisation de ce code atteinte.' };
  }

  const discountFcfa =
    promo.discount_type === 'percent'
      ? Math.round((basePrice * promo.discount_value) / 100)
      : Math.min(basePrice, promo.discount_value);

  const finalAmount = Math.max(100, basePrice - discountFcfa);
  return { basePrice, discountFcfa, finalAmount, appliedPromoCode: promo.code };
}

async function startServer(): Promise<void> {
  ensureDirectories();
  initSchema();
  seedInitialData();

  const app = express();
  app.set('trust proxy', 1);

  // Raw binary parser specifically for chunked resumable uploads
  app.use('/api/admin/uploads', express.raw({ type: 'application/octet-stream', limit: '15mb' }));
  app.use(express.json({ limit: '2mb' }));

  // Serve ONLY uploaded poster images (NEVER originals or backups)
  app.use('/media/posters', express.static(POSTERS_DIR, { fallthrough: true }));

  // --- PUBLIC CONFIG & STOREFRONT ROUTES ---

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    const settings = db
      .prepare(`SELECT brand_name, tagline, accent_color, hero_video_id FROM site_settings WHERE id = 1`)
      .get() as Record<string, string | null>;
    const announcement = db
      .prepare(`SELECT id, title, content FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`)
      .get() as { id: string; title: string; content: string } | undefined;

    res.json({
      brandName: settings?.brand_name || 'CINEVEO',
      tagline: settings?.tagline || '',
      accentColor: settings?.accent_color || '#E50914',
      heroVideoId: settings?.hero_video_id || null,
      announcement: announcement || null,
      currency: 'XOF',
      currencyLabel: 'FCFA',
      cinetPayConfigured: isCinetPayConfigured(),
      openAiConfigured: isOpenAiConfigured(),
    });
  });

  app.get('/api/categories', (_req, res) => {
    const rows = db
      .prepare(`
        SELECT c.id, c.name, c.slug, c.description, c.sort_order,
               COUNT(CASE WHEN v.is_published = 1 THEN 1 END) AS video_count
        FROM categories c
        LEFT JOIN videos v ON v.category_id = c.id
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.name ASC
      `)
      .all();
    res.json({ categories: rows });
  });

  app.get('/api/catalog', (req, res) => {
    const search = String(req.query.search || '').trim();
    const categorySlug = String(req.query.category || '').trim();
    const section = String(req.query.section || 'all').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
    const offset = (page - 1) * limit;

    const where: string[] = ['v.is_published = 1'];
    const params: Array<string | number> = [];

    if (search) {
      where.push('(v.title LIKE ? OR v.description LIKE ? OR c.name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (categorySlug && categorySlug !== 'all') {
      where.push('c.slug = ?');
      params.push(categorySlug);
    }

    if (section === 'new') {
      where.push('v.is_new = 1');
    } else if (section === 'bestseller') {
      where.push('v.is_bestseller = 1');
    } else if (section === 'promo') {
      where.push('v.promo_price_fcfa IS NOT NULL AND v.promo_price_fcfa < v.price_fcfa');
    }

    let orderBy = 'v.created_at DESC';
    if (section === 'popular') {
      orderBy = 'v.views_count DESC, v.sales_count DESC';
    } else if (section === 'bestseller') {
      orderBy = 'v.sales_count DESC, v.views_count DESC';
    } else if (section === 'recommended') {
      orderBy = '(v.sales_count * 3 + v.views_count) DESC';
    }

    const whereClause = where.join(' AND ');

    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM videos v LEFT JOIN categories c ON c.id = v.category_id WHERE ${whereClause}`)
      .get(...params) as { total: number };

    const items = db
      .prepare(`
        SELECT v.id, v.title, v.slug, v.description, v.category_id,
               COALESCE(c.name, 'Général') AS category_name,
               COALESCE(c.slug, 'general') AS category_slug,
               v.duration_seconds, v.duration_label, v.price_fcfa, v.promo_price_fcfa,
               v.poster_url, v.file_size_bytes, v.is_featured, v.is_new, v.is_bestseller,
               v.views_count, v.sales_count, v.commercial_rights_multi_sale, v.created_at,
               COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.video_id = v.id), 0) AS avg_rating,
               (SELECT COUNT(*) FROM reviews r WHERE r.video_id = v.id) AS reviews_count
        FROM videos v
        LEFT JOIN categories c ON c.id = v.category_id
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset);

    res.json({
      videos: items,
      total: countRow.total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(countRow.total / limit)),
    });
  });

  app.get('/api/videos/:id', (req, res) => {
    const video = db
      .prepare(`
        SELECT v.id, v.title, v.slug, v.description, v.category_id,
               COALESCE(c.name, 'Général') AS category_name,
               v.duration_seconds, v.duration_label, v.price_fcfa, v.promo_price_fcfa,
               v.poster_url, v.file_size_bytes, v.is_published, v.is_featured, v.is_new, v.is_bestseller,
               v.views_count, v.sales_count, v.commercial_rights_multi_sale, v.created_at,
               COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.video_id = v.id), 0) AS avg_rating,
               (SELECT COUNT(*) FROM reviews r WHERE r.video_id = v.id) AS reviews_count
        FROM videos v
        LEFT JOIN categories c ON c.id = v.category_id
        WHERE v.id = ? AND v.is_published = 1
      `)
      .get(req.params.id);

    if (!video) {
      res.status(404).json({ error: 'Vidéo introuvable.' });
      return;
    }

    const reviews = db
      .prepare(`
        SELECT id, author_name, rating, comment, created_at
        FROM reviews
        WHERE video_id = ?
        ORDER BY created_at DESC
      `)
      .all(req.params.id);

    res.json({ video, reviews });
  });

  app.post('/api/videos/:id/view', (req, res) => {
    db.prepare(`UPDATE videos SET views_count = views_count + 1 WHERE id = ? AND is_published = 1`).run(
      req.params.id
    );
    res.json({ ok: true });
  });

  // Protected preview streaming (NEVER serves originals/)
  app.get('/api/videos/:id/preview', async (req, res) => {
    const video = db
      .prepare(`SELECT preview_filename, is_published FROM videos WHERE id = ?`)
      .get(req.params.id) as { preview_filename: string; is_published: number } | undefined;

    if (!video || !video.is_published) {
      res.status(404).json({ error: 'Aperçu introuvable.' });
      return;
    }

    try {
      const previewPath = safeResolveInside(PREVIEWS_DIR, video.preview_filename);
      if (!fs.existsSync(previewPath)) {
        await ensureSeedFileReady(video.preview_filename).catch(() => false);
      }
      streamVideoWithRange(req, res, previewPath);
    } catch {
      res.status(403).json({ error: 'Accès refusé.' });
    }
  });

  // Validate promo code
  app.post('/api/promo/validate', (req, res) => {
    const { videoId, code } = req.body as { videoId?: string; code?: string };
    if (!videoId || !code) {
      res.status(400).json({ error: 'Vidéo et code requis.' });
      return;
    }

    const video = db
      .prepare(`SELECT price_fcfa, promo_price_fcfa FROM videos WHERE id = ? AND is_published = 1`)
      .get(videoId) as { price_fcfa: number; promo_price_fcfa: number | null } | undefined;

    if (!video) {
      res.status(404).json({ error: 'Vidéo introuvable.' });
      return;
    }

    const result = computeOrderAmounts(video, code);
    if (result.promoError) {
      res.status(400).json({ error: result.promoError });
      return;
    }

    res.json({
      valid: true,
      code: result.appliedPromoCode,
      basePrice: result.basePrice,
      discountFcfa: result.discountFcfa,
      finalAmount: result.finalAmount,
    });
  });

  // --- CHECKOUT & PAYMENT VERIFICATION ROUTES ---

  app.post('/api/orders', async (req, res) => {
    const { videoId, customerName, customerPhone, customerEmail, paymentMethod, promoCode } = req.body as {
      videoId?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      paymentMethod?: PaymentMethod;
      promoCode?: string;
    };

    if (!videoId || !customerName?.trim() || !customerPhone?.trim() || !paymentMethod) {
      res.status(400).json({ error: 'Veuillez renseigner votre nom, téléphone et moyen de paiement.' });
      return;
    }

    if (!['wave', 'orange_money', 'mobile_money', 'card'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Moyen de paiement non supporté.' });
      return;
    }

    const video = db
      .prepare(`SELECT id, title, price_fcfa, promo_price_fcfa, is_published FROM videos WHERE id = ? AND is_published = 1`)
      .get(videoId) as { id: string; title: string; price_fcfa: number; promo_price_fcfa: number | null; is_published: number } | undefined;

    if (!video) {
      res.status(404).json({ error: 'Vidéo introuvable ou non publiée.' });
      return;
    }

    const pricing = computeOrderAmounts(video, promoCode);
    if (promoCode && pricing.promoError) {
      res.status(400).json({ error: pricing.promoError });
      return;
    }

    const id = crypto.randomUUID();
    const orderNumber = `CMD-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const transactionRef = `TX-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO orders (
        id, order_number, video_id, customer_name, customer_phone, customer_email,
        payment_method, expected_amount_fcfa, received_amount_fcfa, currency,
        promo_code, discount_fcfa, transaction_ref, provider_name, status, status_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'XOF', ?, ?, ?, 'CINETPAY', 'PENDING', ?, ?)
    `).run(
      id,
      orderNumber,
      video.id,
      customerName.trim(),
      customerPhone.trim(),
      (customerEmail || '').trim(),
      paymentMethod,
      pricing.finalAmount,
      pricing.appliedPromoCode,
      pricing.discountFcfa,
      transactionRef,
      'Votre paiement est en cours de vérification.',
      now
    );

    createNotification(
      'new_order',
      'Nouvelle commande initiée',
      `${orderNumber} — ${video.title} (${pricing.finalAmount.toLocaleString('fr-FR')} FCFA via ${paymentMethod})`,
      id
    );

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as unknown as OrderRecord;
    const cinetpay = await initializeCinetPayCheckout(order, video.title, getBaseUrl(req));

    res.status(201).json({
      order,
      videoTitle: video.title,
      cinetPayConfigured: cinetpay.configured,
      paymentUrl: cinetpay.paymentUrl,
      providerError: cinetpay.error || null,
    });
  });

  // Webhook officiel CinetPay (serveur-a-serveur)
  app.post('/api/payments/cinetpay/notify', async (req, res) => {
    const transactionId = String(req.body?.cpm_trans_id || req.body?.transaction_id || '').trim();
    if (!transactionId) {
      res.status(400).json({ error: 'Transaction manquante' });
      return;
    }

    // Verification signature HMAC x-token si CINETPAY_SECRET_KEY configuree
    const secretKey = process.env.CINETPAY_SECRET_KEY?.trim();
    const xToken = req.headers['x-token'];
    if (secretKey && typeof xToken === 'string' && req.body?.cpm_site_id) {
      const dataStr = `${req.body.cpm_site_id}${req.body.cpm_trans_id}${req.body.cpm_trans_date || ''}${req.body.cpm_amount || ''}${req.body.cpm_currency || ''}${req.body.signature || ''}${req.body.payment_method || ''}${req.body.cel_phone_num || ''}${req.body.cpm_phone_prefixe || ''}${req.body.cpm_language || ''}${req.body.cpm_version || ''}${req.body.cpm_payment_config || ''}${req.body.cpm_page_action || ''}${req.body.cpm_custom || ''}${req.body.cpm_designation || ''}${req.body.cpm_error_message || ''}`;
      const computed = crypto.createHmac('sha256', secretKey).update(dataStr).digest('hex');
      if (computed !== xToken) {
        res.status(403).json({ error: 'Signature webhook invalide' });
        return;
      }
    }

    const order = db
      .prepare(`SELECT * FROM orders WHERE transaction_ref = ?`)
      .get(transactionId) as unknown as OrderRecord | undefined;

    if (!order) {
      res.status(404).json({ error: 'Commande introuvable' });
      return;
    }

    const check = await checkCinetPayStatus(transactionId);
    if (!check) {
      res.status(503).json({ error: 'Prestataire non configuré pour vérification' });
      return;
    }

    const result = verifyPaymentTransaction(order.id, check);
    res.json({ status: result.order.status, message: result.order.status_message });
  });

  // Verification serveur d'une commande (interroge CinetPay si configure)
  app.post('/api/orders/:orderNumber/verify', async (req, res) => {
    const order = db
      .prepare(`SELECT * FROM orders WHERE order_number = ?`)
      .get(req.params.orderNumber) as unknown as OrderRecord | undefined;

    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    if (order.status === 'CONFIRMED') {
      const token = issueDownloadTokenForOrder(order.id, order.video_id);
      res.json({ order, downloadToken: token, cinetPayConfigured: isCinetPayConfigured() });
      return;
    }

    if (isCinetPayConfigured()) {
      const check = await checkCinetPayStatus(order.transaction_ref);
      if (check) {
        const result = verifyPaymentTransaction(order.id, check);
        res.json({ ...result, cinetPayConfigured: true });
        return;
      }
    }

    res.json({
      order,
      downloadToken: null,
      cinetPayConfigured: isCinetPayConfigured(),
    });
  });

  // Retrouver une commande perdue SANS compte client (avec verification d'identite stricte)
  app.get('/api/orders/lookup', (req, res) => {
    const orderNumber = String(req.query.orderNumber || '').trim().toUpperCase();
    const identity = String(req.query.identity || '').trim().toLowerCase();

    if (!orderNumber || !identity) {
      res.status(400).json({ error: 'Numéro de commande et téléphone/e-mail requis pour vérification.' });
      return;
    }

    const order = db
      .prepare(`
        SELECT o.*, v.title AS video_title, v.poster_url AS video_poster, v.duration_label
        FROM orders o
        JOIN videos v ON v.id = o.video_id
        WHERE UPPER(o.order_number) = ? OR UPPER(o.transaction_ref) = ?
      `)
      .get(orderNumber, orderNumber) as (OrderRecord & { video_title: string; video_poster: string; duration_label: string }) | undefined;

    if (!order) {
      res.status(404).json({ error: 'Aucune commande ne correspond à ces informations.' });
      return;
    }

    const cleanPhone = order.customer_phone.replace(/\s+/g, '').toLowerCase();
    const cleanInput = identity.replace(/\s+/g, '').toLowerCase();
    const cleanEmail = (order.customer_email || '').trim().toLowerCase();

    const phoneMatches = cleanPhone && (cleanPhone === cleanInput || cleanPhone.endsWith(cleanInput));
    const emailMatches = cleanEmail && cleanEmail === cleanInput;

    if (!phoneMatches && !emailMatches) {
      res.status(403).json({
        error: 'Vérification d’identité refusée : le téléphone ou l’e-mail ne correspond pas à cette commande.',
      });
      return;
    }

    let downloadInfo: { token: string; downloadsUsed: number; maxDownloads: number; expiresAt: string } | null = null;
    if (order.status === 'CONFIRMED') {
      const tokenRow = db
        .prepare(`SELECT raw_token_preview, downloads_used, max_downloads, expires_at FROM download_tokens WHERE order_id = ?`)
        .get(order.id) as
        | { raw_token_preview: string; downloads_used: number; max_downloads: number; expires_at: string }
        | undefined;
      if (tokenRow) {
        downloadInfo = {
          token: tokenRow.raw_token_preview,
          downloadsUsed: tokenRow.downloads_used,
          maxDownloads: tokenRow.max_downloads,
          expiresAt: tokenRow.expires_at,
        };
      }
    }

    res.json({ order, downloadInfo });
  });

  app.get('/api/orders/:orderNumber/receipt', (req, res) => {
    const order = db
      .prepare(`
        SELECT o.*, v.title AS video_title, v.duration_label, v.file_size_bytes
        FROM orders o
        JOIN videos v ON v.id = o.video_id
        WHERE o.order_number = ?
      `)
      .get(req.params.orderNumber) as (OrderRecord & { video_title: string; duration_label: string; file_size_bytes: number }) | undefined;

    if (!order) {
      res.status(404).json({ error: 'Reçu introuvable.' });
      return;
    }

    const tokenRow =
      order.status === 'CONFIRMED'
        ? (db
            .prepare(`SELECT raw_token_preview, downloads_used, max_downloads, expires_at FROM download_tokens WHERE order_id = ?`)
            .get(order.id) as
            | { raw_token_preview: string; downloads_used: number; max_downloads: number; expires_at: string }
            | undefined)
        : undefined;

    res.json({
      receipt: {
        orderNumber: order.order_number,
        receiptNumber: order.receipt_number,
        transactionRef: order.transaction_ref,
        status: order.status,
        statusMessage: order.status_message,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        videoTitle: order.video_title,
        durationLabel: order.duration_label,
        paymentMethod: order.payment_method,
        currency: order.currency,
        expectedAmountFcfa: order.expected_amount_fcfa,
        receivedAmountFcfa: order.received_amount_fcfa,
        discountFcfa: order.discount_fcfa,
        promoCode: order.promo_code,
        confirmedAt: order.confirmed_at,
        createdAt: order.created_at,
        licenseNotice:
          'Licence personnelle uniquement. Cet achat ne confère pas le droit de revendre, partager publiquement ou redistribuer la vidéo.',
        downloadToken: tokenRow?.raw_token_preview || null,
        downloadsUsed: tokenRow?.downloads_used || 0,
        maxDownloads: tokenRow?.max_downloads || 5,
        expiresAt: tokenRow?.expires_at || null,
      },
    });
  });

  // Telechargement securise du fichier original APRES PAIEMENT CONFIRME UNIQUEMENT
  app.get('/api/downloads/:token', async (req, res) => {
    const parsed = verifySignedDownloadToken(req.params.token);
    if (!parsed) {
      res.status(403).json({ error: 'Lien de téléchargement invalide ou altéré.' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const tokenRow = db
      .prepare(`
        SELECT dt.*, o.status AS order_status, v.original_filename, v.slug
        FROM download_tokens dt
        JOIN orders o ON o.id = dt.order_id
        JOIN videos v ON v.id = dt.video_id
        WHERE dt.id = ? AND dt.token_hash = ?
      `)
      .get(parsed.tokenId, tokenHash) as
      | {
          id: string;
          order_status: string;
          downloads_used: number;
          max_downloads: number;
          expires_at: string;
          original_filename: string;
          slug: string;
        }
      | undefined;

    if (!tokenRow) {
      res.status(404).json({ error: 'Autorisation de téléchargement introuvable.' });
      return;
    }

    if (tokenRow.order_status !== 'CONFIRMED') {
      res.status(403).json({ error: 'Téléchargement bloqué : le paiement de cette commande n’est pas confirmé.' });
      return;
    }

    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: 'Ce lien sécurisé a expiré.' });
      return;
    }

    if (tokenRow.downloads_used >= tokenRow.max_downloads) {
      res.status(429).json({
        error: `Limite de ${tokenRow.max_downloads} téléchargements personnels atteinte pour cette commande.`,
      });
      return;
    }

    try {
      const originalPath = safeResolveInside(ORIGINALS_DIR, tokenRow.original_filename);
      if (!fs.existsSync(originalPath)) {
        await ensureSeedFileReady(tokenRow.original_filename).catch(() => false);
      }
      if (!fs.existsSync(originalPath)) {
        res.status(404).json({ error: 'Fichier média introuvable' });
        return;
      }

      // Increment only when not a partial range continuation beyond byte 0
      const rangeHeader = req.headers.range;
      if (!rangeHeader || rangeHeader.startsWith('bytes=0-')) {
        db.prepare(`UPDATE download_tokens SET downloads_used = downloads_used + 1 WHERE id = ?`).run(
          tokenRow.id
        );
      }

      const ext = path.extname(tokenRow.original_filename) || '.mp4';
      streamVideoWithRange(req, res, originalPath, `${tokenRow.slug}${ext}`);
    } catch {
      res.status(403).json({ error: 'Chemin de fichier non autorisé.' });
    }
  });

  // Avis & notes reserves aux acheteurs verifies
  app.post('/api/videos/:id/reviews', (req, res) => {
    const { orderNumber, identity, rating, comment } = req.body as {
      orderNumber?: string;
      identity?: string;
      rating?: number;
      comment?: string;
    };

    if (!orderNumber?.trim() || !identity?.trim() || !rating || !comment?.trim()) {
      res.status(400).json({ error: 'Numéro de commande, identité, note et commentaire requis.' });
      return;
    }

    const numRating = Math.min(5, Math.max(1, Math.round(Number(rating))));
    const order = db
      .prepare(`SELECT * FROM orders WHERE UPPER(order_number) = ? AND video_id = ?`)
      .get(orderNumber.trim().toUpperCase(), req.params.id) as unknown as OrderRecord | undefined;

    if (!order || order.status !== 'CONFIRMED') {
      res.status(403).json({
        error: 'Seuls les clients ayant un achat confirmé pour cette vidéo peuvent publier un avis.',
      });
      return;
    }

    const cleanPhone = order.customer_phone.replace(/\s+/g, '').toLowerCase();
    const cleanEmail = (order.customer_email || '').trim().toLowerCase();
    const cleanInput = identity.trim().replace(/\s+/g, '').toLowerCase();

    if (cleanPhone !== cleanInput && !cleanPhone.endsWith(cleanInput) && cleanEmail !== cleanInput) {
      res.status(403).json({ error: 'Téléphone ou e-mail ne correspond pas à la commande.' });
      return;
    }

    const existing = db
      .prepare(`SELECT id FROM reviews WHERE video_id = ? AND order_id = ?`)
      .get(req.params.id, order.id);

    if (existing) {
      res.status(409).json({ error: 'Vous avez déjà publié un avis pour cette commande.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO reviews (id, video_id, order_id, author_name, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, order.id, order.customer_name, numRating, comment.trim(), now);

    const summary = db
      .prepare(`SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS reviews_count FROM reviews WHERE video_id = ?`)
      .get(req.params.id) as { avg_rating: number; reviews_count: number };

    res.status(201).json({
      review: { id, author_name: order.customer_name, rating: numRating, comment: comment.trim(), created_at: now },
      avg_rating: summary.avg_rating,
      reviews_count: summary.reviews_count,
    });
  });

  // --- AGENT COMMERCIAL IA CLIENT ---

  app.post('/api/ai/assistant', async (req, res) => {
    const { messages } = req.body as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages requis.' });
      return;
    }

    const sanitized = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));

    const result = await runCustomerAiAssistant(sanitized);
    res.json(result);
  });

  // --- ADMIN AUTHENTICATION ROUTES ---

  app.get('/api/admin/auth/status', (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const state = getAdminAuthState();
    res.json({
      authenticated: validateAdminSession(token),
      needsFirstRunSetup: state.needsFirstRunSetup,
      envPasscodeActive: state.envPasscodeActive,
    });
  });

  app.post('/api/admin/auth/claim', (req, res) => {
    const state = getAdminAuthState();
    if (!state.needsFirstRunSetup) {
      res.status(403).json({ error: 'Le mot de passe administrateur est déjà configuré.' });
      return;
    }
    const { password } = req.body as { password?: string };
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
      return;
    }

    const hash = hashPassword(password);
    db.prepare(`INSERT INTO admin_auth (id, password_hash, created_at) VALUES (1, ?, ?)`).run(
      hash,
      new Date().toISOString()
    );
    const token = createAdminSession();
    logAdminAudit('ADMIN_PASSWORD_CLAIMED', 'auth', '1', 'Mot de passe administrateur initial configuré');
    res.status(201).json({ token });
  });

  app.post('/api/admin/auth/login', (req, res) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: 'Mot de passe requis.' });
      return;
    }
    if (!verifyAdminPasscode(password)) {
      res.status(401).json({ error: 'Code d’accès administrateur invalide.' });
      return;
    }
    const token = createAdminSession();
    logAdminAudit('ADMIN_LOGIN', 'auth', '1', 'Connexion administrateur réussie');
    res.json({ token });
  });

  app.post('/api/admin/auth/logout', requireAdmin, (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) {
      db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).run(hashSessionToken(token));
    }
    res.json({ ok: true });
  });

  // --- ADMIN RESUMABLE CHUNKED UPLOAD ROUTES (ANDROID & DESKTOP) ---

  app.post('/api/admin/uploads/init', requireAdmin, (req, res) => {
    const { uploadId, filename, fileSize, chunkSize, totalChunks, kind } = req.body as {
      uploadId?: string;
      filename?: string;
      fileSize?: number;
      chunkSize?: number;
      totalChunks?: number;
      kind?: 'original' | 'preview' | 'poster';
    };

    if (!filename || !fileSize || !chunkSize || !totalChunks || !kind) {
      res.status(400).json({ error: 'Paramètres d’importation incomplets.' });
      return;
    }

    if (!['original', 'preview', 'poster'].includes(kind)) {
      res.status(400).json({ error: 'Type de fichier invalide.' });
      return;
    }

    if (uploadId) {
      const existing = db
        .prepare(`SELECT * FROM upload_sessions WHERE id = ?`)
        .get(uploadId) as
        | { id: string; uploaded_chunks_json: string; total_chunks: number; status: string }
        | undefined;
      if (existing && existing.status !== 'COMPLETED') {
        res.json({
          uploadId: existing.id,
          uploadedChunks: JSON.parse(existing.uploaded_chunks_json) as number[],
          resumed: true,
        });
        return;
      }
    }

    const id = crypto.randomUUID();
    const sessionDir = path.resolve(UPLOADS_TMP_DIR, id);
    fs.mkdirSync(sessionDir, { recursive: true });
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO upload_sessions (id, filename, file_size, chunk_size, total_chunks, uploaded_chunks_json, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '[]', ?, 'UPLOADING', ?, ?)
    `).run(id, path.basename(filename), fileSize, chunkSize, totalChunks, kind, now, now);

    res.status(201).json({ uploadId: id, uploadedChunks: [], resumed: false });
  });

  app.get('/api/admin/uploads/:uploadId', requireAdmin, (req, res) => {
    const row = db
      .prepare(`SELECT id, filename, file_size, total_chunks, uploaded_chunks_json, kind, status, final_filename FROM upload_sessions WHERE id = ?`)
      .get(req.params.uploadId) as
      | {
          id: string;
          filename: string;
          file_size: number;
          total_chunks: number;
          uploaded_chunks_json: string;
          kind: string;
          status: string;
          final_filename: string | null;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Session d’importation introuvable.' });
      return;
    }

    const uploadedChunks = JSON.parse(row.uploaded_chunks_json) as number[];
    res.json({
      uploadId: row.id,
      filename: row.filename,
      totalChunks: row.total_chunks,
      uploadedChunks,
      progressPercent: Math.round((uploadedChunks.length / Math.max(1, row.total_chunks)) * 100),
      status: row.status,
      finalFilename: row.final_filename,
    });
  });

  app.put('/api/admin/uploads/:uploadId/chunk/:index', requireAdmin, (req, res) => {
    const uploadId = path.basename(req.params.uploadId);
    const index = Number(req.params.index);
    const session = db
      .prepare(`SELECT * FROM upload_sessions WHERE id = ?`)
      .get(uploadId) as { id: string; total_chunks: number; uploaded_chunks_json: string } | undefined;

    if (!session) {
      res.status(404).json({ error: 'Session d’importation introuvable.' });
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= session.total_chunks) {
      res.status(400).json({ error: 'Index de fragment invalide.' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Fragment binaire vide.' });
      return;
    }

    const sessionDir = path.resolve(UPLOADS_TMP_DIR, uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const chunkPath = safeResolveInside(sessionDir, `chunk_${index}`);
    fs.writeFileSync(chunkPath, req.body);

    const existing = new Set<number>(JSON.parse(session.uploaded_chunks_json) as number[]);
    existing.add(index);
    const sorted = Array.from(existing).sort((a, b) => a - b);

    db.prepare(`UPDATE upload_sessions SET uploaded_chunks_json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(sorted),
      new Date().toISOString(),
      uploadId
    );

    res.json({
      index,
      uploadedCount: sorted.length,
      totalChunks: session.total_chunks,
      progressPercent: Math.round((sorted.length / session.total_chunks) * 100),
    });
  });

  app.post('/api/admin/uploads/:uploadId/complete', requireAdmin, async (req, res) => {
    const uploadId = path.basename(req.params.uploadId);
    const session = db
      .prepare(`SELECT * FROM upload_sessions WHERE id = ?`)
      .get(uploadId) as
      | {
          id: string;
          filename: string;
          total_chunks: number;
          kind: 'original' | 'preview' | 'poster';
        }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Session d’importation introuvable.' });
      return;
    }

    const sessionDir = path.resolve(UPLOADS_TMP_DIR, uploadId);
    for (let i = 0; i < session.total_chunks; i++) {
      const chunkPath = safeResolveInside(sessionDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        res.status(400).json({ error: `Fragment manquant (${i + 1}/${session.total_chunks}). Reprenez l’importation.` });
        return;
      }
    }

    const ext = path.extname(session.filename).toLowerCase() || (session.kind === 'poster' ? '.jpg' : '.mp4');
    const safeFinalName = `${session.kind}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
    const targetDir =
      session.kind === 'original'
        ? ORIGINALS_DIR
        : session.kind === 'preview'
          ? PREVIEWS_DIR
          : POSTERS_DIR;
    const finalPath = safeResolveInside(targetDir, safeFinalName);

    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < session.total_chunks; i++) {
      const chunkPath = safeResolveInside(sessionDir, `chunk_${i}`);
      const buf = fs.readFileSync(chunkPath);
      writeStream.write(buf);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    fs.rmSync(sessionDir, { recursive: true, force: true });

    let autoPreviewFilename: string | null = null;
    let durationSeconds = 0;
    if (session.kind === 'original') {
      const previewName = `preview_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.mp4`;
      const resClip = await generatePreviewFromOriginal(safeFinalName, previewName);
      durationSeconds = resClip.durationSeconds;
      if (resClip.generated) {
        autoPreviewFilename = previewName;
      }
    }

    const fileSize = fs.statSync(finalPath).size;
    db.prepare(`UPDATE upload_sessions SET status = 'COMPLETED', final_filename = ?, updated_at = ? WHERE id = ?`).run(
      safeFinalName,
      new Date().toISOString(),
      uploadId
    );

    res.json({
      filename: safeFinalName,
      publicUrl: session.kind === 'poster' ? `/media/posters/${safeFinalName}` : null,
      autoPreviewFilename,
      durationSeconds,
      durationLabel: durationSeconds > 0 ? formatDurationLabel(durationSeconds) : '00:15',
      fileSizeBytes: fileSize,
    });
  });

  // --- ADMIN DASHBOARD, VIDEOS, CATEGORIES, PROMOS, SETTINGS, TEST SUITE, AI, BACKUPS ---

  app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
    const kpis = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM videos) AS totalVideos,
          (SELECT COUNT(*) FROM videos WHERE is_published = 1) AS publishedVideos,
          (SELECT COUNT(*) FROM orders) AS totalOrders,
          (SELECT COUNT(*) FROM orders WHERE status = 'CONFIRMED') AS confirmedSales,
          (SELECT COALESCE(SUM(received_amount_fcfa), 0) FROM orders WHERE status = 'CONFIRMED') AS confirmedRevenueFcfa,
          (SELECT COUNT(*) FROM orders WHERE status IN ('PENDING', 'OVERPAID_REVIEW')) AS pendingPayments,
          (SELECT COUNT(*) FROM orders WHERE status IN ('FAILED', 'UNDERPAID')) AS failedPayments,
          (SELECT COALESCE(SUM(views_count), 0) FROM videos) AS totalViews
      `)
      .get();

    const orders = db
      .prepare(`
        SELECT o.*, v.title AS video_title
        FROM orders o
        JOIN videos v ON v.id = o.video_id
        ORDER BY o.created_at DESC
        LIMIT 80
      `)
      .all();

    const bestSellers = db
      .prepare(`
        SELECT id, title, price_fcfa, promo_price_fcfa, sales_count, views_count, poster_url
        FROM videos
        ORDER BY sales_count DESC, views_count DESC
        LIMIT 8
      `)
      .all();

    const mostViewed = db
      .prepare(`
        SELECT id, title, views_count, sales_count, price_fcfa
        FROM videos
        ORDER BY views_count DESC
        LIMIT 8
      `)
      .all();

    const revenueByDay = db
      .prepare(`
        SELECT substr(confirmed_at, 1, 10) AS day,
               COUNT(*) AS sales,
               COALESCE(SUM(received_amount_fcfa), 0) AS revenue_fcfa
        FROM orders
        WHERE status = 'CONFIRMED' AND confirmed_at IS NOT NULL
        GROUP BY substr(confirmed_at, 1, 10)
        ORDER BY day DESC
        LIMIT 14
      `)
      .all();

    const notifications = db
      .prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 30`)
      .all();

    const auditLogs = db
      .prepare(`SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 40`)
      .all();

    res.json({
      kpis,
      orders,
      bestSellers,
      mostViewed,
      revenueByDay,
      notifications,
      auditLogs,
      cinetPayConfigured: isCinetPayConfigured(),
      openAiConfigured: isOpenAiConfigured(),
    });
  });

  app.post('/api/admin/notifications/read', requireAdmin, (_req, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE is_read = 0`).run();
    res.json({ ok: true });
  });

  app.get('/api/admin/videos', requireAdmin, (_req, res) => {
    const videos = db
      .prepare(`
        SELECT v.*, COALESCE(c.name, 'Général') AS category_name
        FROM videos v
        LEFT JOIN categories c ON c.id = v.category_id
        ORDER BY v.created_at DESC
      `)
      .all();
    res.json({ videos });
  });

  app.post('/api/admin/videos', requireAdmin, (req, res) => {
    const {
      title,
      description,
      categoryId,
      durationSeconds,
      durationLabel,
      priceFcfa,
      promoPriceFcfa,
      posterUrl,
      previewFilename,
      originalFilename,
      isPublished,
      isFeatured,
      isNew,
      isBestseller,
    } = req.body as Record<string, unknown>;

    if (!title || !description || !priceFcfa || !originalFilename) {
      res.status(400).json({ error: 'Titre, description, prix et vidéo originale requis.' });
      return;
    }

    const id = `vid-${crypto.randomBytes(5).toString('hex')}`;
    const baseSlug = slugify(String(title)) || id;
    const slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
    const now = new Date().toISOString();
    const origFile = path.basename(String(originalFilename));
    const prevFile = path.basename(String(previewFilename || origFile));
    const fileSize = getFileSizeSafe(ORIGINALS_DIR, origFile);

    const parsedPrice = Math.round(Number(priceFcfa));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1) {
      res.status(400).json({ error: 'Veuillez fixer un prix valide en FCFA (au moins 1 FCFA).' });
      return;
    }
    const parsedPromo =
      promoPriceFcfa !== null && promoPriceFcfa !== undefined && promoPriceFcfa !== ''
        ? Math.round(Number(promoPriceFcfa))
        : null;
    if (parsedPromo !== null && (!Number.isFinite(parsedPromo) || parsedPromo < 1)) {
      res.status(400).json({ error: 'Le prix promotionnel doit être supérieur ou égal à 1 FCFA.' });
      return;
    }

    db.prepare(`
      INSERT INTO videos (
        id, title, slug, description, category_id, duration_seconds, duration_label,
        price_fcfa, promo_price_fcfa, poster_url, preview_filename, original_filename,
        file_size_bytes, is_published, is_featured, is_new, is_bestseller,
        views_count, sales_count, commercial_rights_multi_sale, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)
    `).run(
      id,
      String(title).trim(),
      slug,
      String(description).trim(),
      categoryId ? String(categoryId) : null,
      Number(durationSeconds) || 60,
      String(durationLabel || '01:00'),
      parsedPrice,
      parsedPromo,
      String(posterUrl || '/src/assets/images/poster_tech_masterclass_1795722338907.jpg'),
      prevFile,
      origFile,
      fileSize,
      isPublished ? 1 : 0,
      isFeatured ? 1 : 0,
      isNew ? 1 : 0,
      isBestseller ? 1 : 0,
      now,
      now
    );

    logAdminAudit('VIDEO_CREATED', 'video', id, `Vidéo créée : ${String(title)}`);
    res.status(201).json({ video: db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id) });
  });

  app.put('/api/admin/videos/:id', requireAdmin, (req, res) => {
    const existing = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Vidéo introuvable.' });
      return;
    }

    const {
      title,
      description,
      categoryId,
      durationLabel,
      priceFcfa,
      promoPriceFcfa,
      posterUrl,
      isFeatured,
      isNew,
      isBestseller,
    } = req.body as Record<string, unknown>;

    const parsedPrice = Math.round(Number(priceFcfa));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1) {
      res.status(400).json({ error: 'Veuillez fixer un prix valide en FCFA (au moins 1 FCFA).' });
      return;
    }
    const parsedPromo =
      promoPriceFcfa !== null && promoPriceFcfa !== undefined && promoPriceFcfa !== ''
        ? Math.round(Number(promoPriceFcfa))
        : null;
    if (parsedPromo !== null && (!Number.isFinite(parsedPromo) || parsedPromo < 1)) {
      res.status(400).json({ error: 'Le prix promotionnel doit être supérieur ou égal à 1 FCFA.' });
      return;
    }

    db.prepare(`
      UPDATE videos
      SET title = ?, description = ?, category_id = ?, duration_label = ?,
          price_fcfa = ?, promo_price_fcfa = ?, poster_url = ?,
          is_featured = ?, is_new = ?, is_bestseller = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(title).trim(),
      String(description).trim(),
      categoryId ? String(categoryId) : null,
      String(durationLabel || '01:00'),
      parsedPrice,
      parsedPromo,
      String(posterUrl),
      isFeatured ? 1 : 0,
      isNew ? 1 : 0,
      isBestseller ? 1 : 0,
      new Date().toISOString(),
      req.params.id
    );

    logAdminAudit('VIDEO_UPDATED', 'video', req.params.id, `Vidéo modifiée : ${String(title)}`);
    res.json({ video: db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id) });
  });

  app.patch('/api/admin/videos/:id/price', requireAdmin, (req, res) => {
    const existing = db.prepare(`SELECT id, title FROM videos WHERE id = ?`).get(req.params.id) as
      | { id: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Vidéo introuvable.' });
      return;
    }

    const { priceFcfa, promoPriceFcfa } = req.body as {
      priceFcfa?: number | string;
      promoPriceFcfa?: number | string | null;
    };

    const parsedPrice = Math.round(Number(priceFcfa));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1) {
      res.status(400).json({ error: 'Veuillez saisir un prix valide en FCFA (minimum 1 FCFA).' });
      return;
    }

    const parsedPromo =
      promoPriceFcfa !== null && promoPriceFcfa !== undefined && promoPriceFcfa !== ''
        ? Math.round(Number(promoPriceFcfa))
        : null;

    if (parsedPromo !== null && (!Number.isFinite(parsedPromo) || parsedPromo < 1 || parsedPromo >= parsedPrice)) {
      res.status(400).json({
        error: 'Le prix promotionnel doit être positif et inférieur au prix standard.',
      });
      return;
    }

    db.prepare(`UPDATE videos SET price_fcfa = ?, promo_price_fcfa = ?, updated_at = ? WHERE id = ?`).run(
      parsedPrice,
      parsedPromo,
      new Date().toISOString(),
      req.params.id
    );

    logAdminAudit(
      'VIDEO_PRICE_UPDATED',
      'video',
      req.params.id,
      `Tarif fixé par l’administrateur sur "${existing.title}" : ${parsedPrice} FCFA${parsedPromo ? ` (promo ${parsedPromo} FCFA)` : ''}`
    );

    res.json({ video: db.prepare(`SELECT * FROM videos WHERE id = ?`).get(req.params.id) });
  });

  app.patch('/api/admin/videos/:id/publish', requireAdmin, (req, res) => {
    const { isPublished } = req.body as { isPublished?: boolean };
    db.prepare(`UPDATE videos SET is_published = ?, updated_at = ? WHERE id = ?`).run(
      isPublished ? 1 : 0,
      new Date().toISOString(),
      req.params.id
    );
    logAdminAudit(
      isPublished ? 'VIDEO_PUBLISHED' : 'VIDEO_UNPUBLISHED',
      'video',
      req.params.id,
      `Statut publication : ${isPublished ? 'Publiée' : 'Dépubliée'}`
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/videos/:id', requireAdmin, (req, res) => {
    const { confirmDelete } = req.body as { confirmDelete?: boolean };
    if (!confirmDelete) {
      res.status(400).json({ error: 'Confirmation explicite requise avant suppression.' });
      return;
    }

    const ordersCount = (
      db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE video_id = ?`).get(req.params.id) as { c: number }
    ).c;

    if (ordersCount > 0) {
      // Protection absolue des donnees & commandes : depublier au lieu de casser l'historique ou supprimer les originaux
      db.prepare(`UPDATE videos SET is_published = 0, updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        req.params.id
      );
      logAdminAudit(
        'VIDEO_ARCHIVED_INSTEAD_OF_DELETE',
        'video',
        req.params.id,
        `Vidéo dépubliée (conservée car ${ordersCount} commande(s) liée(s) et fichier original protégé)`
      );
      res.json({
        archived: true,
        message: 'Vidéo dépubliée et archivée : les commandes existantes et le fichier original sont préservés.',
      });
      return;
    }

    // Ne jamais supprimer automatiquement les fichiers originaux du disque
    db.prepare(`DELETE FROM videos WHERE id = ?`).run(req.params.id);
    logAdminAudit(
      'VIDEO_DELETED_METADATA',
      'video',
      req.params.id,
      'Fiche vidéo supprimée (fichier original conservé dans storage/originals par sécurité)'
    );
    res.json({ ok: true, originalPreserved: true });
  });

  // Categories
  app.post('/api/admin/categories', requireAdmin, (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Nom de catégorie requis.' });
      return;
    }
    const id = `cat-${crypto.randomBytes(4).toString('hex')}`;
    const slug = slugify(name);
    db.prepare(
      `INSERT INTO categories (id, name, slug, description, sort_order, created_at) VALUES (?, ?, ?, ?, 10, ?)`
    ).run(id, name.trim(), slug, (description || '').trim(), new Date().toISOString());
    logAdminAudit('CATEGORY_CREATED', 'category', id, name.trim());
    res.status(201).json({ id, name: name.trim(), slug });
  });

  app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(req.params.id);
    logAdminAudit('CATEGORY_DELETED', 'category', req.params.id, 'Catégorie supprimée');
    res.json({ ok: true });
  });

  // Promo codes
  app.get('/api/admin/promos', requireAdmin, (_req, res) => {
    res.json({ promos: db.prepare(`SELECT * FROM promo_codes ORDER BY created_at DESC`).all() });
  });

  app.post('/api/admin/promos', requireAdmin, (req, res) => {
    const { code, discountType, discountValue, maxUses, validDays } = req.body as {
      code?: string;
      discountType?: 'percent' | 'fixed';
      discountValue?: number;
      maxUses?: number;
      validDays?: number;
    };
    if (!code?.trim() || !discountValue) {
      res.status(400).json({ error: 'Code et valeur de réduction requis.' });
      return;
    }
    const id = `promo-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date();
    const until = new Date(now.getTime() + (Number(validDays) || 30) * 24 * 3600 * 1000);
    db.prepare(`
      INSERT INTO promo_codes (id, code, discount_type, discount_value, max_uses, uses_count, valid_from, valid_until, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
    `).run(
      id,
      code.trim().toUpperCase(),
      discountType === 'fixed' ? 'fixed' : 'percent',
      Math.max(1, Math.round(Number(discountValue))),
      Math.max(1, Math.round(Number(maxUses) || 100)),
      now.toISOString(),
      until.toISOString(),
      now.toISOString()
    );
    logAdminAudit('PROMO_CREATED', 'promo_code', id, code.trim().toUpperCase());
    res.status(201).json({ ok: true });
  });

  app.patch('/api/admin/promos/:id', requireAdmin, (req, res) => {
    const { isActive } = req.body as { isActive?: boolean };
    db.prepare(`UPDATE promo_codes SET is_active = ? WHERE id = ?`).run(isActive ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/api/admin/promos/:id', requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM promo_codes WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Announcements & Visual Identity
  app.get('/api/admin/announcements', requireAdmin, (_req, res) => {
    res.json({ announcements: db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all() });
  });

  app.post('/api/admin/announcements', requireAdmin, (req, res) => {
    const { title, content } = req.body as { title?: string; content?: string };
    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'Titre et contenu requis.' });
      return;
    }
    const id = `ann-${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`INSERT INTO announcements (id, title, content, is_active, created_at) VALUES (?, ?, ?, 1, ?)`).run(
      id,
      title.trim(),
      content.trim(),
      new Date().toISOString()
    );
    logAdminAudit('ANNOUNCEMENT_CREATED', 'announcement', id, title.trim());
    res.status(201).json({ ok: true });
  });

  app.patch('/api/admin/announcements/:id', requireAdmin, (req, res) => {
    const { isActive } = req.body as { isActive?: boolean };
    db.prepare(`UPDATE announcements SET is_active = ? WHERE id = ?`).run(isActive ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const { brandName, tagline, accentColor, heroVideoId } = req.body as {
      brandName?: string;
      tagline?: string;
      accentColor?: string;
      heroVideoId?: string;
    };
    db.prepare(`
      UPDATE site_settings
      SET brand_name = ?, tagline = ?, accent_color = ?, hero_video_id = ?, updated_at = ?
      WHERE id = 1
    `).run(
      (brandName || 'CINEVEO').trim(),
      (tagline || '').trim(),
      /^#[0-9A-Fa-f]{6}$/.test(accentColor || '') ? (accentColor as string) : '#E50914',
      heroVideoId || null,
      new Date().toISOString()
    );
    logAdminAudit('IDENTITY_UPDATED', 'site_settings', '1', `Marque: ${brandName}`);
    res.json({ ok: true });
  });

  // --- ADMIN PAYMENT VERIFICATION TEST RUNNER & OVERPAID APPROVAL ---

  app.post('/api/admin/orders/:id/verify-scenario', requireAdmin, (req, res) => {
    const { scenario } = req.body as {
      scenario?: 'EXACT' | 'UNDERPAID' | 'OVERPAID' | 'FAILED' | 'PENDING';
    };

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id) as unknown as OrderRecord | undefined;
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    let payload;
    if (scenario === 'EXACT') {
      payload = {
        providerStatus: 'ACCEPTED' as const,
        receivedAmount: order.expected_amount_fcfa,
        currency: 'XOF',
        transactionRef: order.transaction_ref,
      };
    } else if (scenario === 'UNDERPAID') {
      payload = {
        providerStatus: 'ACCEPTED' as const,
        receivedAmount: Math.max(100, order.expected_amount_fcfa - 500),
        currency: 'XOF',
        transactionRef: order.transaction_ref,
      };
    } else if (scenario === 'OVERPAID') {
      payload = {
        providerStatus: 'ACCEPTED' as const,
        receivedAmount: order.expected_amount_fcfa + 1000,
        currency: 'XOF',
        transactionRef: order.transaction_ref,
      };
    } else if (scenario === 'FAILED') {
      payload = {
        providerStatus: 'REFUSED' as const,
        receivedAmount: 0,
        currency: 'XOF',
        transactionRef: order.transaction_ref,
      };
    } else {
      payload = {
        providerStatus: 'PENDING' as const,
        receivedAmount: 0,
        currency: 'XOF',
        transactionRef: order.transaction_ref,
      };
    }

    const result = verifyPaymentTransaction(order.id, payload);
    logAdminAudit('ADMIN_PAYMENT_SCENARIO_TEST', 'order', order.id, `Scénario ${scenario} -> ${result.order.status}`);
    res.json(result);
  });

  app.post('/api/admin/orders/:id/approve-overpaid', requireAdmin, (req, res) => {
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id) as OrderRecord | undefined;
    if (!order || order.status !== 'OVERPAID_REVIEW') {
      res.status(400).json({ error: 'Seule une commande en attente de vérification pour surplus peut être approuvée.' });
      return;
    }

    const now = new Date().toISOString();
    const receiptNumber = `REC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    db.prepare(`
      UPDATE orders
      SET status = 'CONFIRMED',
          status_message = 'Paiement vérifié et approuvé manuellement par l’administrateur.',
          receipt_number = ?,
          confirmed_at = ?
      WHERE id = ?
    `).run(receiptNumber, now, order.id);

    db.prepare(`UPDATE videos SET sales_count = sales_count + 1 WHERE id = ?`).run(order.video_id);
    const token = issueDownloadTokenForOrder(order.id, order.video_id);
    logAdminAudit('OVERPAID_APPROVED', 'order', order.id, `Commande ${order.order_number} approuvée après vérification`);
    res.json({ ok: true, downloadToken: token });
  });

  // --- ADMIN AI CONTROL CENTER ---

  app.post('/api/admin/ai-insights', requireAdmin, async (req, res) => {
    const { question } = req.body as { question?: string };
    if (!question?.trim()) {
      res.status(400).json({ error: 'Question requise.' });
      return;
    }
    const result = await runAdminAiInsights(question.trim());
    res.json(result);
  });

  // --- ADMIN BACKUPS & RESTORE VERIFICATION ---

  app.get('/api/admin/backups', requireAdmin, (_req, res) => {
    const backups = db.prepare(`SELECT * FROM backups ORDER BY created_at DESC`).all();
    res.json({ backups });
  });

  app.post('/api/admin/backups', requireAdmin, (_req, res) => {
    const created = createFullBackup();
    res.status(201).json({ backup: created });
  });

  app.post('/api/admin/backups/:id/test-restore', requireAdmin, (req, res) => {
    try {
      const result = testBackupRestore(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, details: err instanceof Error ? err.message : 'Erreur' });
    }
  });

  app.post('/api/admin/backups/:id/restore', requireAdmin, (req, res) => {
    const { confirmRestore } = req.body as { confirmRestore?: boolean };
    if (!confirmRestore) {
      res.status(400).json({ error: 'Confirmation requise pour restaurer les fichiers.' });
      return;
    }
    try {
      const result = restoreOriginalFilesFromBackup(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Erreur restauration' });
    }
  });

  app.get('/api/admin/export-source-zip', requireAdmin, (_req, res) => {
    const zipBuffer = buildSourceCodeZip(process.cwd());
    logAdminAudit('SOURCE_ZIP_EXPORTED', 'system', 'zip', `Export archive ZIP (${zipBuffer.length} octets)`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="cineveo-application.zip"');
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  });

  // Blocage strict de tout acces direct aux dossiers prives (originaux, sauvegardes, base SQLite, code serveur)
  app.use(['/storage', '/data', '/server', '/supabase', '/netlify', '/.env'], (_req, res) => {
    res.status(403).json({ error: 'Accès direct interdit aux ressources privées.' });
  });

  // Vite middleware in development or static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CINEVEO server running on http://0.0.0.0:${PORT}`);
    // Generate sample MP4 media asynchronously after opening port 3000 so dev server starts instantaneously
    void ensureSeedMediaFiles((originalFilename, sizeBytes) => {
      try {
        db.prepare(`UPDATE videos SET file_size_bytes = ? WHERE original_filename = ? AND file_size_bytes = 0`).run(
          sizeBytes,
          originalFilename
        );
      } catch {
        // ignore if DB busy/closed
      }
    }).catch((err) => {
      console.error('Background seed media generation error:', err);
    });
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
