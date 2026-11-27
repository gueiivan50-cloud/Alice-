export interface SiteConfig {
  brandName: string;
  tagline: string;
  accentColor: string;
  heroVideoId: string | null;
  announcement: {
    id: string;
    title: string;
    content: string;
  } | null;
  currency: 'XOF';
  currencyLabel: 'FCFA';
  cinetPayConfigured: boolean;
  openAiConfigured: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  video_count?: number;
}

export interface VideoItem {
  id: string;
  title: string;
  slug: string;
  description: string;
  category_id: string | null;
  category_name: string;
  category_slug?: string;
  duration_seconds: number;
  duration_label: string;
  price_fcfa: number;
  promo_price_fcfa: number | null;
  poster_url: string;
  file_size_bytes: number;
  is_published?: number;
  is_featured: number;
  is_new: number;
  is_bestseller: number;
  views_count: number;
  sales_count: number;
  commercial_rights_multi_sale: number;
  created_at: string;
  avg_rating?: number;
  reviews_count?: number;
  preview_filename?: string;
  original_filename?: string;
}

export interface ReviewItem {
  id: string;
  author_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

export type PaymentMethod = 'wave' | 'orange_money' | 'mobile_money' | 'card';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'UNDERPAID' | 'OVERPAID_REVIEW' | 'FAILED';

export interface OrderRecord {
  id: string;
  order_number: string;
  video_id: string;
  video_title?: string;
  video_poster?: string;
  duration_label?: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  payment_method: PaymentMethod;
  expected_amount_fcfa: number;
  received_amount_fcfa: number;
  currency: string;
  promo_code: string | null;
  discount_fcfa: number;
  transaction_ref: string;
  provider_name: string;
  status: OrderStatus;
  status_message: string;
  receipt_number: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface SavedLocalOrder {
  orderNumber: string;
  identity: string;
  videoTitle: string;
  amountFcfa: number;
  createdAt: string;
}

export interface ReceiptData {
  orderNumber: string;
  receiptNumber: string | null;
  transactionRef: string;
  status: OrderStatus;
  statusMessage: string;
  customerName: string;
  customerPhone: string;
  videoTitle: string;
  durationLabel: string;
  paymentMethod: PaymentMethod;
  currency: string;
  expectedAmountFcfa: number;
  receivedAmountFcfa: number;
  discountFcfa: number;
  promoCode: string | null;
  confirmedAt: string | null;
  createdAt: string;
  licenseNotice: string;
  downloadToken: string | null;
  downloadsUsed: number;
  maxDownloads: number;
  expiresAt: string | null;
}

export interface PromoCodeItem {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses: number;
  uses_count: number;
  valid_from: string;
  valid_until: string;
  is_active: number;
  created_at: string;
}

export interface BackupItem {
  id: string;
  backup_name: string;
  backup_dir: string;
  originals_count: number;
  total_size_bytes: number;
  manifest_sha256: string;
  restore_tested: number;
  last_restore_test_at: string | null;
  restore_test_result: string | null;
  created_at: string;
}
