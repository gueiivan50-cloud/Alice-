import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ORIGINALS_DIR, ensureDirectories } from './paths.ts';
import { getFileSizeSafe } from './media.ts';

ensureDirectories();

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export const DOWNLOAD_SIGNING_SECRET =
  process.env.DOWNLOAD_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      brand_name TEXT NOT NULL DEFAULT 'CINEVEO',
      tagline TEXT NOT NULL DEFAULT 'Cinéma & Vidéos Numériques Premium en FCFA',
      accent_color TEXT NOT NULL DEFAULT '#E50914',
      hero_video_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      duration_label TEXT NOT NULL DEFAULT '00:00',
      price_fcfa INTEGER NOT NULL,
      promo_price_fcfa INTEGER,
      poster_url TEXT NOT NULL,
      preview_filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      is_published INTEGER NOT NULL DEFAULT 1,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 1,
      is_bestseller INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      sales_count INTEGER NOT NULL DEFAULT 0,
      commercial_rights_multi_sale INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_videos_pub_created ON videos (is_published, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_category ON videos (category_id);

    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      uploaded_chunks_json TEXT NOT NULL DEFAULT '[]',
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UPLOADING',
      final_filename TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
      discount_value INTEGER NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 100,
      uses_count INTEGER NOT NULL DEFAULT 0,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL CHECK (payment_method IN ('wave', 'orange_money', 'mobile_money', 'card')),
      expected_amount_fcfa INTEGER NOT NULL,
      received_amount_fcfa INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'XOF',
      promo_code TEXT,
      discount_fcfa INTEGER NOT NULL DEFAULT 0,
      transaction_ref TEXT NOT NULL UNIQUE,
      provider_name TEXT NOT NULL DEFAULT 'CINETPAY',
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'UNDERPAID', 'OVERPAID_REVIEW', 'FAILED')),
      status_message TEXT NOT NULL DEFAULT '',
      receipt_number TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orders_number ON orders (order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

    CREATE TABLE IF NOT EXISTS download_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      raw_token_preview TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
      max_downloads INTEGER NOT NULL DEFAULT 5,
      downloads_used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (video_id, order_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      related_order_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      backup_name TEXT NOT NULL,
      backup_dir TEXT NOT NULL,
      originals_count INTEGER NOT NULL,
      total_size_bytes INTEGER NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      restore_tested INTEGER NOT NULL DEFAULT 0,
      last_restore_test_at TEXT,
      restore_test_result TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
}

export function seedInitialData(): void {
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE;');
  try {
    const settingsCount = (db.prepare('SELECT COUNT(*) AS c FROM site_settings').get() as { c: number }).c;
    if (settingsCount === 0) {
      db.prepare(
        `INSERT OR IGNORE INTO site_settings (id, brand_name, tagline, accent_color, hero_video_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)`
      ).run(
        'CINEVEO',
        'Cinéma indépendant, documentaires et masterclasses en téléchargement direct FCFA',
        '#E50914',
        'vid-lagune-nuit',
        now
      );
    }

    const catCount = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
    if (catCount === 0) {
      const categories = [
        { id: 'cat-cinema', name: 'Cinéma & Thrillers', slug: 'cinema-thrillers', description: 'Longs et courts métrages originaux haute définition', sort_order: 1 },
        { id: 'cat-doc', name: 'Documentaires', slug: 'documentaires', description: 'Récits immersifs d’Afrique de l’Ouest et d’ailleurs', sort_order: 2 },
        { id: 'cat-formation', name: 'Masterclasses & Formations', slug: 'masterclasses-formations', description: 'Formations vidéo professionnelles créatives et techniques', sort_order: 3 },
        { id: 'cat-musique', name: 'Concerts & Musique', slug: 'concerts-musique', description: 'Sessions live acoustiques et spectacles filmés', sort_order: 4 },
        { id: 'cat-gastro', name: 'Gastronomie & Culture', slug: 'gastronomie-culture', description: 'Savoir-faire culinaire et patrimoine vivant', sort_order: 5 },
      ];
      const insertCat = db.prepare(
        `INSERT OR IGNORE INTO categories (id, name, slug, description, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const c of categories) {
        insertCat.run(c.id, c.name, c.slug, c.description, c.sort_order, now);
      }
    }

    const videoCount = (db.prepare('SELECT COUNT(*) AS c FROM videos').get() as { c: number }).c;
    if (videoCount === 0) {
      const seedVideos = [
      {
        id: 'vid-lagune-nuit',
        title: 'Les Lumières de la Lagune',
        slug: 'les-lumieres-de-la-lagune',
        description:
          'Une plongée cinématographique nocturne au cœur de la métropole lagunaire. Tourné en 4K anamorphique avec bande sonore originale immersive, ce film suit trois créateurs entre tradition maritime et architecture contemporaine.',
        category_id: 'cat-cinema',
        duration_seconds: 3420,
        duration_label: '57 min',
        price_fcfa: 5000,
        promo_price_fcfa: 3500,
        poster_url: '/src/assets/images/hero_abidjan_cinema_1795722338492.jpg',
        preview_filename: 'preview_lagune_nuit.mp4',
        original_filename: 'orig_lagune_nuit.mp4',
        is_featured: 1,
        is_new: 1,
        is_bestseller: 1,
        views_count: 1420,
        sales_count: 84,
      },
      {
        id: 'vid-foret-cacao',
        title: 'Les Gardiens de la Canopée',
        slug: 'les-gardiens-de-la-canopee',
        description:
          'Documentaire d’auteur au lever du jour dans les plantations forestières ivoiriennes. Découvrez le savoir-faire ancestral des producteurs engagés dans l’agroforesterie durable.',
        category_id: 'cat-doc',
        duration_seconds: 2880,
        duration_label: '48 min',
        price_fcfa: 3500,
        promo_price_fcfa: null,
        poster_url: '/src/assets/images/poster_afro_documentary_1795722339106.jpg',
        preview_filename: 'preview_foret_cacao.mp4',
        original_filename: 'orig_foret_cacao.mp4',
        is_featured: 0,
        is_new: 1,
        is_bestseller: 1,
        views_count: 980,
        sales_count: 62,
      },
      {
        id: 'vid-etalonnage-cinema',
        title: 'Masterclass Étalonnage & Couleur Cinéma',
        slug: 'masterclass-etalonnage-couleur-cinema',
        description:
          'Formation complète de post-production et d’étalonnage professionnel. Apprenez à construire un rendu filmique contrasté, gérer la colorimétrie des peaux et livrer vos masters HD/4K.',
        category_id: 'cat-formation',
        duration_seconds: 5100,
        duration_label: '1h 25m',
        price_fcfa: 15000,
        promo_price_fcfa: 10000,
        poster_url: '/src/assets/images/poster_tech_masterclass_1795722338907.jpg',
        preview_filename: 'preview_etalonnage_cinema.mp4',
        original_filename: 'orig_etalonnage_cinema.mp4',
        is_featured: 0,
        is_new: 0,
        is_bestseller: 1,
        views_count: 1850,
        sales_count: 115,
      },
      {
        id: 'vid-pluie-plateau',
        title: 'Minuit sur l’Avenue',
        slug: 'minuit-sur-l-avenue',
        description:
          'Thriller néo-noir haletant sous la pluie tropicale. Un enquêteur solitaire dispose d’une nuit pour retrouver une mallette cryptée avant l’aube.',
        category_id: 'cat-cinema',
        duration_seconds: 4080,
        duration_label: '1h 08m',
        price_fcfa: 4500,
        promo_price_fcfa: null,
        poster_url: '/src/assets/images/poster_urban_thriller_1795722340994.jpg',
        preview_filename: 'preview_pluie_plateau.mp4',
        original_filename: 'orig_pluie_plateau.mp4',
        is_featured: 0,
        is_new: 1,
        is_bestseller: 0,
        views_count: 740,
        sales_count: 39,
      },
      {
        id: 'vid-kora-acoustique',
        title: 'Session Intime : Cordes & Voix',
        slug: 'session-intime-cordes-voix',
        description:
          'Concert capté en prise directe avec son stéréo masterisé. Soixante minutes de guitare acoustique et de compositions mandingues enregistrées devant un public restreint.',
        category_id: 'cat-musique',
        duration_seconds: 3600,
        duration_label: '1h 00m',
        price_fcfa: 3000,
        promo_price_fcfa: 2000,
        poster_url: '/src/assets/images/poster_music_live_1795722340259.jpg',
        preview_filename: 'preview_kora_acoustique.mp4',
        original_filename: 'orig_kora_acoustique.mp4',
        is_featured: 0,
        is_new: 0,
        is_bestseller: 1,
        views_count: 1120,
        sales_count: 71,
      },
      {
        id: 'vid-braises-abidjan',
        title: 'L’Art du Feu & des Épices',
        slug: 'l-art-du-feu-et-des-epices',
        description:
          'Voyage gastronomique au cœur des maquis et des braises traditionnelles. Techniques de fumage, marinades secrètes et portraits de maîtres grilleurs.',
        category_id: 'cat-gastro',
        duration_seconds: 2520,
        duration_label: '42 min',
        price_fcfa: 2500,
        promo_price_fcfa: null,
        poster_url: '/src/assets/images/poster_culinary_film_1795722339821.jpg',
        preview_filename: 'preview_braises_abidjan.mp4',
        original_filename: 'orig_braises_abidjan.mp4',
        is_featured: 0,
        is_new: 1,
        is_bestseller: 0,
        views_count: 615,
        sales_count: 28,
      },
    ];

    const insertVid = db.prepare(`
      INSERT OR IGNORE INTO videos (
        id, title, slug, description, category_id, duration_seconds, duration_label,
        price_fcfa, promo_price_fcfa, poster_url, preview_filename, original_filename,
        file_size_bytes, is_published, is_featured, is_new, is_bestseller,
        views_count, sales_count, commercial_rights_multi_sale, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    for (const v of seedVideos) {
      const sizeBytes = getFileSizeSafe(ORIGINALS_DIR, v.original_filename);
      insertVid.run(
        v.id,
        v.title,
        v.slug,
        v.description,
        v.category_id,
        v.duration_seconds,
        v.duration_label,
        v.price_fcfa,
        v.promo_price_fcfa,
        v.poster_url,
        v.preview_filename,
        v.original_filename,
        sizeBytes,
        v.is_featured,
        v.is_new,
        v.is_bestseller,
        v.views_count,
        v.sales_count,
        now,
        now
      );
    }
  }

  const promoCount = (db.prepare('SELECT COUNT(*) AS c FROM promo_codes').get() as { c: number }).c;
  if (promoCount === 0) {
    const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO promo_codes (id, code, discount_type, discount_value, max_uses, uses_count, valid_from, valid_until, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
    `).run('promo-bienvenue', 'BIENVENUE20', 'percent', 20, 500, now, nextYear, now);
  }

  const annCount = (db.prepare('SELECT COUNT(*) AS c FROM announcements').get() as { c: number }).c;
  if (annCount === 0) {
    db.prepare(`
      INSERT OR IGNORE INTO announcements (id, title, content, is_active, created_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(
      'ann-launch',
      'Offre de lancement',
      'Paiement instantané par Wave, Orange Money, Mobile Money et Carte bancaire. Code BIENVENUE20 : -20% sur votre commande.',
      now
    );
  }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// --- Password & Session Security ---

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function getAdminAuthState(): { needsFirstRunSetup: boolean; envPasscodeActive: boolean } {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    return { needsFirstRunSetup: false, envPasscodeActive: true };
  }
  const existing = db.prepare('SELECT id FROM admin_auth WHERE id = 1').get();
  return { needsFirstRunSetup: !existing, envPasscodeActive: false };
}

export function verifyAdminPasscode(passcode: string): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPass);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const row = db.prepare('SELECT password_hash FROM admin_auth WHERE id = 1').get() as
    | { password_hash: string }
    | undefined;
  if (!row) return false;
  return verifyPasswordHash(passcode, row.password_hash);
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(rawToken).digest('hex');
}

export function createAdminSession(): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 3600 * 1000);
  db.prepare(
    `INSERT INTO admin_sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, tokenHash, expires.toISOString(), now.toISOString());
  return rawToken;
}

export function validateAdminSession(rawToken: string | undefined): boolean {
  if (!rawToken) return false;
  const tokenHash = hashSessionToken(rawToken);
  const row = db.prepare(
    `SELECT expires_at FROM admin_sessions WHERE token_hash = ?`
  ).get(tokenHash) as { expires_at: string } | undefined;
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).run(tokenHash);
    return false;
  }
  return true;
}

export function logAdminAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  details: string
): void {
  db.prepare(
    `INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), action, entityType, entityId, details, new Date().toISOString());
}

export function createNotification(
  type: string,
  title: string,
  message: string,
  relatedOrderId: string | null = null
): void {
  db.prepare(
    `INSERT INTO notifications (id, type, title, message, is_read, related_order_id, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(crypto.randomUUID(), type, title, message, relatedOrderId, new Date().toISOString());
}
