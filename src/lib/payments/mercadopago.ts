/**
 * SPRINT D — MercadoPagoGateway
 * Integração real com Mercado Pago via REST API v1.
 *
 * Docs:
 *   - https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
 *   - https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-configuration/notification-handling
 *
 * Endpoints usados:
 *   POST https://api.mercadopago.com/v1/payments      → cria pagamento PIX
 *   GET  https://api.mercadopago.com/v1/payments/{id} → consulta status
 */

import type { CreatePixInput, CreatePixResult, GetPixStatusResult, PixGateway } from './types';
import { normalizeStatus } from './types';

const MP_BASE = 'https://api.mercadopago.com/v1';

interface MPCreatePaymentResponse {
  id: number;
  status: string;
  status_detail?: string;
  date_of_expiration?: string;
  date_approved?: string | null;
  transaction_amount: number;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
  [k: string]: unknown;
}

interface MPGetPaymentResponse {
  id: number;
  status: string;
  status_detail?: string;
  date_approved?: string | null;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  [k: string]: unknown;
}

export class MercadoPagoGateway implements PixGateway {
  readonly name = 'mercadopago';
  private readonly accessToken: string;

  constructor(accessToken: string) {
    if (!accessToken || !accessToken.startsWith('APP_USR-') && !accessToken.startsWith('TEST-')) {
      throw new Error('MP_ACCESS_TOKEN inválido (esperado começar com APP_USR- ou TEST-)');
    }
    this.accessToken = accessToken;
  }

  /**
   * Gera UUID v4 (necessário para X-Idempotency-Key)
   * Usa Web Crypto API disponível no Cloudflare Workers.
   */
  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback: gera UUID v4 manual
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async createPix(input: CreatePixInput): Promise<CreatePixResult> {
    const minutos = input.expira_em_minutos ?? 1440;
    // MP exige ISO 8601 com offset, ex: 2024-01-15T15:00:00.000-03:00
    // Vamos usar UTC + offset zero (MP aceita)
    const dt = new Date(Date.now() + minutos * 60_000);
    const date_of_expiration = dt.toISOString().replace('Z', '+00:00');

    // Monta payload do MP
    const body: Record<string, unknown> = {
      transaction_amount: Number(input.valor.toFixed(2)),
      description: input.descricao,
      payment_method_id: 'pix',
      external_reference: input.external_reference,
      notification_url: input.webhook_url,
      date_of_expiration,
      payer: {
        email: input.email_pagador,
        first_name: input.nome_pagador || 'Cliente',
        ...(input.documento_pagador
          ? {
              identification: {
                type: input.documento_pagador.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF',
                number: input.documento_pagador.replace(/\D/g, ''),
              },
            }
          : {}),
      },
    };

    const resp = await fetch(`${MP_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        // X-Idempotency-Key OBRIGATÓRIO no MP para POST /payments
        'X-Idempotency-Key': this.uuid(),
      },
      body: JSON.stringify(body),
    });

    const raw = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const errMsg = (raw as any)?.message || (raw as any)?.error || `HTTP ${resp.status}`;
      throw new Error(`MP createPix falhou: ${errMsg}`);
    }

    const data = raw as MPCreatePaymentResponse;
    const tx = data.point_of_interaction?.transaction_data || {};

    if (!tx.qr_code) {
      throw new Error('MP retornou payment sem qr_code (PIX não emitido)');
    }

    return {
      gateway_payment_id: String(data.id),
      gateway_status: data.status,
      status: normalizeStatus(data.status),
      qr_code: tx.qr_code,
      qr_code_base64: tx.qr_code_base64 || '',
      ticket_url: tx.ticket_url,
      dt_expiracao: data.date_of_expiration || date_of_expiration,
      raw: data,
    };
  }

  async getPixStatus(gateway_payment_id: string): Promise<GetPixStatusResult> {
    if (!gateway_payment_id) {
      throw new Error('gateway_payment_id vazio');
    }

    const resp = await fetch(`${MP_BASE}/payments/${encodeURIComponent(gateway_payment_id)}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    const raw = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const errMsg = (raw as any)?.message || `HTTP ${resp.status}`;
      throw new Error(`MP getPixStatus falhou: ${errMsg}`);
    }

    const data = raw as MPGetPaymentResponse;
    return {
      status: normalizeStatus(data.status),
      gateway_status: data.status,
      dt_pagamento: data.date_approved || null,
      valor_pago: typeof data.transaction_amount === 'number' ? data.transaction_amount : undefined,
      raw: data,
    };
  }

  /**
   * Valida assinatura HMAC-SHA256 do webhook do Mercado Pago.
   *
   * O MP envia no header `x-signature` algo como:
   *   ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eba45b8bf6f10112099f5a4 ...
   *
   * E no header `x-request-id` um UUID único do evento.
   *
   * Manifest a ser assinado (segundo docs MP):
   *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
   *
   * Onde <data.id> é o `id` do recurso (vem na query string ?data.id=...)
   *
   * @param signatureHeader Valor cru do header `x-signature`
   * @param xRequestId      Valor do header `x-request-id`
   * @param dataId          O `data.id` (query string da URL do webhook)
   * @param secret          O webhook secret (assinatura secreta do painel MP)
   */
  static async verifyWebhookSignature(
    signatureHeader: string,
    xRequestId: string,
    dataId: string,
    secret: string,
  ): Promise<boolean> {
    if (!signatureHeader || !xRequestId || !dataId || !secret) return false;
    // Parse "ts=...,v1=..."
    const parts = signatureHeader.split(',').map((p) => p.trim());
    const map: Record<string, string> = {};
    for (const part of parts) {
      const [k, v] = part.split('=', 2);
      if (k && v) map[k.trim()] = v.trim();
    }
    const ts = map['ts'];
    const v1 = map['v1'];
    if (!ts || !v1) return false;

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const enc = new TextEncoder();
    const keyData = enc.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(manifest));
    const sigHex = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    // Comparação timing-safe (manual, pois Workers não tem timingSafeEqual)
    if (sigHex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < sigHex.length; i++) {
      diff |= sigHex.charCodeAt(i) ^ v1.charCodeAt(i);
    }
    return diff === 0;
  }
}
