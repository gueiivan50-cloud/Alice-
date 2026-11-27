# Schema PostgreSQL / Supabase avec politiques RLS (Row Level Security)
# Compatible avec l'architecture CINEVEO (streaming & vente video en FCFA / XOF)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  brand_name TEXT NOT NULL DEFAULT 'CINEVEO',
  tagline TEXT NOT NULL DEFAULT 'Cinéma & Vidéos Numériques Premium en FCFA',
  accent_color TEXT NOT NULL DEFAULT '#E50914',
  hero_video_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  duration_label TEXT NOT NULL DEFAULT '00:00',
  price_fcfa INTEGER NOT NULL CHECK (price_fcfa >= 0),
  promo_price_fcfa INTEGER CHECK (promo_price_fcfa IS NULL OR promo_price_fcfa >= 0),
  poster_url TEXT NOT NULL,
  preview_storage_path TEXT NOT NULL,
  original_storage_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_new BOOLEAN NOT NULL DEFAULT true,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  views_count INTEGER NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  commercial_rights_multi_sale BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_videos_published_created ON videos (is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos (category_id);

CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  max_uses INTEGER NOT NULL DEFAULT 100,
  uses_count INTEGER NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('wave', 'orange_money', 'mobile_money', 'card')),
  expected_amount_fcfa INTEGER NOT NULL,
  received_amount_fcfa INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  promo_code TEXT,
  discount_fcfa INTEGER NOT NULL DEFAULT 0,
  transaction_ref TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL DEFAULT 'CINETPAY',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'UNDERPAID', 'OVERPAID_REVIEW', 'FAILED')),
  status_message TEXT NOT NULL DEFAULT '',
  receipt_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS download_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  max_downloads INTEGER NOT NULL DEFAULT 5,
  downloads_used INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, order_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_name TEXT NOT NULL,
  originals_count INTEGER NOT NULL,
  total_size_bytes BIGINT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  restore_tested BOOLEAN NOT NULL DEFAULT false,
  last_restore_test_at TIMESTAMPTZ,
  restore_test_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activation RLS stricte
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;

-- Lecture publique uniquement sur les donnees storefront autorisees
CREATE POLICY "Public read site_settings" ON site_settings FOR SELECT USING (true);
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Public read published videos" ON videos FOR SELECT USING (is_published = true);
CREATE POLICY "Public read reviews" ON reviews FOR SELECT USING (true);

-- Aucune lecture/ecriture directe client sur orders, download_tokens, promo_codes, notifications, backups
-- Tout passe par le role service_role cote serveur / fonctions securisees.
