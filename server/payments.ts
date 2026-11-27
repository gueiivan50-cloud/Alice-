import crypto from 'node:crypto';
import {
  DOWNLOAD_SIGNING_SECRET,
  createNotification,
  db,
} from './db.ts';

export type PaymentMethod = 'wave' | 'orange_money' | 'mobile_money' | 'card';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'UNDERPAID' | 'OVERPAID_REVIEW' | 'FAILED';

export interface ProviderCheckPayload {
  providerStatus: 'ACCEPTED' | 'REFUSED' | 'PENDING';
  receivedAmount: number;
  currency: string;
  transactionRef: string;
  providerName?: string;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  video_id: string;
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

export function isCinetPayConfigured(): boolean {
  return Boolean(process.env.CINETPAY_API_KEY?.trim() && process.env.CINETPAY_SITE_ID?.trim());
}

export function signDownloadToken(tokenId: string, orderId: string, videoId: string): string {
  const payload = `${tokenId}.${orderId}.${videoId}`;
  const sig = crypto
    .createHmac('sha256', DOWNLOAD_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

export function verifySignedDownloadToken(
  rawToken: string
): { tokenId: string; orderId: string; videoId: string } | null {
  const parts = rawToken.split('.');
  if (parts.length !== 4) return null;
  const [tokenId, orderId, videoId, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', DOWNLOAD_SIGNING_SECRET)
    .update(`${tokenId}.${orderId}.${videoId}`)
    .digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  return { tokenId, orderId, videoId };
}

export function issueDownloadTokenForOrder(orderId: string, videoId: string): string {
  const existing = db
    .prepare(`SELECT raw_token_preview FROM download_tokens WHERE order_id = ? LIMIT 1`)
    .get(orderId) as { raw_token_preview: string } | undefined;

  if (existing) {
    return existing.raw_token_preview;
  }

  const tokenId = crypto.randomUUID();
  const signedToken = signDownloadToken(tokenId, orderId, videoId);
  const tokenHash = crypto.createHash('sha256').update(signedToken).digest('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO download_tokens (id, token_hash, raw_token_preview, order_id, video_id, max_downloads, downloads_used, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 5, 0, ?, ?)
  `).run(tokenId, tokenHash, signedToken, orderId, videoId, expiresAt, now.toISOString());

  return signedToken;
}

/**
 * Moteur de verification serveur strict :
 * - Controle la devise XOF
 * - Controle la reference de transaction unique (anti double paiement)
 * - Controle le statut officiel du prestataire
 * - Compare le montant recu au montant attendu
 * - Retourne les messages exacts exiges
 */
export function verifyPaymentTransaction(
  orderId: string,
  payload: ProviderCheckPayload
): { order: OrderRecord; downloadToken: string | null } {
  const order = db
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .get(orderId) as OrderRecord | undefined;

  if (!order) {
    throw new Error('Commande introuvable');
  }

  // Empecher toute re-confirmation ou modification si deja CONFIRMED
  if (order.status === 'CONFIRMED') {
    const token = issueDownloadTokenForOrder(order.id, order.video_id);
    return { order, downloadToken: token };
  }

  // Verification stricte de la devise XOF
  if (payload.currency.toUpperCase() !== 'XOF') {
    const msg = 'PAIEMENT REFUSÉ OU ÉCHOUÉ. Devise invalide (XOF requis).';
    db.prepare(`UPDATE orders SET status = 'FAILED', status_message = ? WHERE id = ?`).run(
      msg,
      order.id
    );
    createNotification('payment_failed', 'Devise invalide détectée', `${order.order_number}: ${payload.currency}`, order.id);
    return {
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
      downloadToken: null,
    };
  }

  // Empecher les doubles paiements / reutilisation d'une reference de transaction
  const duplicateRef = db
    .prepare(`SELECT id FROM orders WHERE transaction_ref = ? AND id != ? AND status = 'CONFIRMED'`)
    .get(payload.transactionRef, order.id);

  if (duplicateRef) {
    const msg = 'PAIEMENT REFUSÉ OU ÉCHOUÉ. Référence de transaction déjà utilisée.';
    db.prepare(`UPDATE orders SET status = 'FAILED', status_message = ? WHERE id = ?`).run(
      msg,
      order.id
    );
    createNotification(
      'security_alert',
      'Tentative de réutilisation de référence',
      `Référence ${payload.transactionRef} bloquée sur ${order.order_number}`,
      order.id
    );
    return {
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
      downloadToken: null,
    };
  }

  // Cas 1 : Paiement echoue / refuse par le prestataire
  if (payload.providerStatus === 'REFUSED') {
    const msg = 'PAIEMENT REFUSÉ OU ÉCHOUÉ. Veuillez réessayer.';
    db.prepare(
      `UPDATE orders SET status = 'FAILED', received_amount_fcfa = ?, status_message = ? WHERE id = ?`
    ).run(Math.round(payload.receivedAmount), msg, order.id);
    createNotification(
      'payment_failed',
      'Paiement échoué',
      `Commande ${order.order_number} refusée (${order.payment_method}).`,
      order.id
    );
    return {
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
      downloadToken: null,
    };
  }

  // Cas 2 : Paiement en attente de validation operateur
  if (payload.providerStatus === 'PENDING') {
    const msg = 'Votre paiement est en cours de vérification.';
    db.prepare(
      `UPDATE orders SET status = 'PENDING', status_message = ? WHERE id = ?`
    ).run(msg, order.id);
    return {
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
      downloadToken: null,
    };
  }

  // Prestataire indique ACCEPTED : verifier le montant reellement recu
  const received = Math.round(payload.receivedAmount);
  const expected = order.expected_amount_fcfa;

  // Cas 3 : Paiement insuffisant
  if (received < expected) {
    const msg = 'ERREUR DE PAIEMENT : le montant reçu est inférieur au prix demandé.';
    db.prepare(
      `UPDATE orders SET status = 'UNDERPAID', received_amount_fcfa = ?, status_message = ? WHERE id = ?`
    ).run(received, msg, order.id);
    createNotification(
      'payment_underpaid',
      'Paiement insuffisant détecté',
      `${order.order_number} : reçu ${received} FCFA au lieu de ${expected} FCFA.`,
      order.id
    );
    return {
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
      downloadToken: null,
    };
  }

  // Cas 4 : Paiement superieur (en verification admin/prestataire avant deblocage)
  if (received > expected) {
    const msg = 'PAIEMENT EN VÉRIFICATION : veuillez patienter pendant la vérification de votre transaction.';
    db.prepare(
      `UPDATE orders SET status = 'OVERPAID_REVIEW', received_amount_fcfa = ?, status_message = ? WHERE id = ?`
    ).run(received, msg, order.id);
    createNotification(
      'payment_overpaid',
      'Paiement supérieur à vérifier',
      `${order.order_number} : reçu ${received} FCFA pour ${expected} FCFA demandés.`,
      order.id
    );
    return {
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
      downloadToken: null,
    };
  }

  // Cas 5 : PAIEMENT EXACT -> Confirmation et deblocage securise
  const now = new Date().toISOString();
  const receiptNumber = `REC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const msg = 'Paiement confirmé en XOF. Téléchargement débloqué.';

  db.prepare(`
    UPDATE orders
    SET status = 'CONFIRMED',
        received_amount_fcfa = ?,
        status_message = ?,
        receipt_number = ?,
        confirmed_at = ?
    WHERE id = ?
  `).run(received, msg, receiptNumber, now, order.id);

  db.prepare(`UPDATE videos SET sales_count = sales_count + 1 WHERE id = ?`).run(order.video_id);

  if (order.promo_code) {
    db.prepare(`UPDATE promo_codes SET uses_count = uses_count + 1 WHERE code = ?`).run(order.promo_code);
  }

  const downloadToken = issueDownloadTokenForOrder(order.id, order.video_id);
  createNotification(
    'payment_confirmed',
    'Paiement confirmé',
    `Commande ${order.order_number} confirmée (${received.toLocaleString('fr-FR')} FCFA via ${order.payment_method}).`,
    order.id
  );

  return {
    order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) as unknown as OrderRecord,
    downloadToken,
  };
}

export async function initializeCinetPayCheckout(order: OrderRecord, videoTitle: string, baseUrl: string): Promise<{ paymentUrl: string | null; configured: boolean; error?: string }> {
  if (!isCinetPayConfigured()) {
    return { paymentUrl: null, configured: false };
  }

  const channelsMap: Record<PaymentMethod, string> = {
    wave: 'MOBILE_MONEY',
    orange_money: 'MOBILE_MONEY',
    mobile_money: 'MOBILE_MONEY',
    card: 'CREDIT_CARD',
  };

  try {
    const response = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_API_KEY,
        site_id: process.env.CINETPAY_SITE_ID,
        transaction_id: order.transaction_ref,
        amount: order.expected_amount_fcfa,
        currency: 'XOF',
        description: `Achat vidéo numérique : ${videoTitle}`.slice(0, 120),
        customer_name: order.customer_name,
        customer_surname: order.customer_name,
        customer_phone_number: order.customer_phone,
        customer_email: order.customer_email || 'client@cineveo.ci',
        channels: channelsMap[order.payment_method] || 'ALL',
        notify_url: `${baseUrl}/api/payments/cinetpay/notify`,
        return_url: `${baseUrl}/?order=${encodeURIComponent(order.order_number)}`,
        lang: 'fr',
      }),
    });

    const data = (await response.json()) as {
      code?: string;
      message?: string;
      data?: { payment_url?: string };
    };

    if (data.code === '201' && data.data?.payment_url) {
      return { paymentUrl: data.data.payment_url, configured: true };
    }
    return { paymentUrl: null, configured: true, error: data.message || 'Erreur CinetPay' };
  } catch (err) {
    return {
      paymentUrl: null,
      configured: true,
      error: err instanceof Error ? err.message : 'Erreur réseau CinetPay',
    };
  }
}

export async function checkCinetPayStatus(transactionRef: string): Promise<ProviderCheckPayload | null> {
  if (!isCinetPayConfigured()) {
    return null;
  }

  const response = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: transactionRef,
    }),
  });

  const data = (await response.json()) as {
    code?: string;
    data?: {
      amount?: string | number;
      currency?: string;
      status?: string;
    };
  };

  if (!data.data) return null;

  const rawStatus = (data.data.status || '').toUpperCase();
  const providerStatus: 'ACCEPTED' | 'REFUSED' | 'PENDING' =
    rawStatus === 'ACCEPTED'
      ? 'ACCEPTED'
      : rawStatus === 'REFUSED' || rawStatus === 'CANCELLED'
        ? 'REFUSED'
        : 'PENDING';

  return {
    providerStatus,
    receivedAmount: Number(data.data.amount || 0),
    currency: (data.data.currency || 'XOF').toUpperCase(),
    transactionRef,
    providerName: 'CINETPAY',
  };
}
