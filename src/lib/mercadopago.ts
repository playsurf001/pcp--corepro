// =====================================================================
// SPRINT 3 — Wrapper Mercado Pago PIX
// =====================================================================
// Camada fina sobre a API REST do Mercado Pago. NÃO usa SDK Node — usa
// apenas Fetch API (compatível com Cloudflare Workers).
//
// Documentação oficial:
//   https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
//   https://www.mercadopago.com.br/developers/pt/docs/checkout-api/payment-methods/integrate-pix
//
// IMPORTANTE: Este módulo funciona em 2 modos:
//   1) PROD:   se MP_ACCESS_TOKEN estiver definido → chama a API real
//   2) MOCK:   se MP_ACCESS_TOKEN ausente → gera respostas simuladas
//              (QR code dummy, status='pendente') para permitir
//              desenvolvimento sem credenciais reais.
//
// O token é configurado via:
//   wrangler pages secret put MP_ACCESS_TOKEN --project-name corepro-confeccao
//
// Quando o usuário pagar, o webhook MP chama
// POST /api/public/mp/webhook (definido em routes/master.ts) que atualiza
// o payment.status para 'aprovado' e reativa a subscription.
// =====================================================================

export interface MPPixRequest {
  amount: number;
  description: string;
  external_reference: string;   // id_payment local (string)
  payer_email?: string;
  payer_name?: string;
  payer_doc?: string;           // CPF/CNPJ (digits-only)
  expires_at?: string;          // ISO 8601 com tz (ex: 2026-05-22T23:59:59.000-03:00)
  webhook_url?: string;         // notification_url do MP
}

export interface MPPixResponse {
  ok: boolean;
  mock: boolean;                // true se foi simulação
  mp_payment_id: string | null; // id do MP (string ou null)
  status: string;               // 'pendente'|'aprovado'|'rejeitado'|'expirado'|'cancelado'
  qr_code: string;              // payload PIX copia-e-cola
  qr_base64: string;            // QR base64 (sem prefixo data:)
  ticket_url: string;           // link MP para o pagador
  expires_at: string;
  raw?: any;
  error?: string;
}

const MP_API = 'https://api.mercadopago.com';

// =====================================================================
// Validação de CPF/CNPJ (algoritmo de Dígito Verificador brasileiro)
// =====================================================================
// O Mercado Pago valida o checksum do documento. Enviar um CPF/CNPJ
// inválido faz o POST /v1/payments retornar HTTP 400. Para evitar isso,
// só enviamos `identification` quando o DV bate.
// =====================================================================

/**
 * Valida CPF (11 dígitos numéricos) usando o algoritmo de DV.
 * Rejeita CPFs com todos os dígitos iguais (00000000000, 11111111111, etc).
 */
export function validarCPF(cpf: string): boolean {
  if (!cpf || cpf.length !== 11) return false;
  if (!/^\d{11}$/.test(cpf)) return false;
  // Rejeita sequências de dígitos repetidos
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  // Primeiro DV
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i), 10) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf.charAt(9), 10)) return false;

  // Segundo DV
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i), 10) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf.charAt(10), 10)) return false;

  return true;
}

/**
 * Valida CNPJ (14 dígitos numéricos) usando o algoritmo de DV.
 * Rejeita CNPJs com todos os dígitos iguais.
 */
export function validarCNPJ(cnpj: string): boolean {
  if (!cnpj || cnpj.length !== 14) return false;
  if (!/^\d{14}$/.test(cnpj)) return false;
  // Rejeita sequências de dígitos repetidos
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  // Pesos para o primeiro DV
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  // Pesos para o segundo DV
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  // Primeiro DV
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += parseInt(cnpj.charAt(i), 10) * pesos1[i];
  }
  let resto = soma % 11;
  const dv1 = resto < 2 ? 0 : 11 - resto;
  if (dv1 !== parseInt(cnpj.charAt(12), 10)) return false;

  // Segundo DV
  soma = 0;
  for (let i = 0; i < 13; i++) {
    soma += parseInt(cnpj.charAt(i), 10) * pesos2[i];
  }
  resto = soma % 11;
  const dv2 = resto < 2 ? 0 : 11 - resto;
  if (dv2 !== parseInt(cnpj.charAt(13), 10)) return false;

  return true;
}

/**
 * Mapeia status MP → status local payments.status
 */
export function mpStatusToLocal(mpStatus: string): string {
  const m: Record<string, string> = {
    'approved':   'aprovado',
    'pending':    'pendente',
    'in_process': 'pendente',
    'authorized': 'pendente',
    'rejected':   'rejeitado',
    'cancelled':  'cancelado',
    'refunded':   'reembolsado',
    'charged_back': 'reembolsado',
  };
  return m[mpStatus] || 'pendente';
}

/**
 * Cria um pagamento PIX no Mercado Pago.
 * Retorna sempre uma estrutura uniforme — mesmo em erro, devolve um
 * objeto MPPixResponse com ok=false e detalhes.
 */
export async function criarPixMP(
  accessToken: string | undefined,
  req: MPPixRequest
): Promise<MPPixResponse> {
  // -------- MOCK MODE --------
  if (!accessToken) {
    const expires = req.expires_at || isoExpire(30); // 30 min default
    const fakeId = 'MOCK-' + req.external_reference + '-' + Math.floor(Date.now() / 1000);
    return {
      ok: true,
      mock: true,
      mp_payment_id: fakeId,
      status: 'pendente',
      qr_code:
        '00020126360014BR.GOV.BCB.PIX0114+551199999999952040000530398654' +
        Math.floor(req.amount * 100).toString().padStart(10, '0') +
        '5802BR5913CorePro Mock6009SAO PAULO62070503***6304ABCD',
      qr_base64: MOCK_QR_PNG_BASE64,
      ticket_url: `https://www.mercadopago.com.br/payments/${fakeId}/ticket`,
      expires_at: expires,
    };
  }

  // -------- REAL API --------
  try {
    const body: any = {
      transaction_amount: Number(req.amount),
      description: req.description,
      payment_method_id: 'pix',
      external_reference: req.external_reference,
      date_of_expiration: req.expires_at || isoExpire(30),
      payer: {
        email: req.payer_email || 'comprador@corepro.com.br',
      },
    };
    if (req.payer_name) {
      const parts = req.payer_name.trim().split(/\s+/);
      body.payer.first_name = parts[0];
      body.payer.last_name = parts.slice(1).join(' ') || parts[0];
    }
    if (req.payer_doc) {
      const digits = req.payer_doc.replace(/\D/g, '');
      // Valida CPF/CNPJ com algoritmo de checksum DV.
      // Se não passar, NÃO envia identification (MP aceita criar PIX sem).
      const isValid =
        (digits.length === 11 && validarCPF(digits)) ||
        (digits.length === 14 && validarCNPJ(digits));
      if (isValid) {
        body.payer.identification = {
          type: digits.length === 11 ? 'CPF' : 'CNPJ',
          number: digits,
        };
      }
    }
    if (req.webhook_url) {
      body.notification_url = req.webhook_url;
    }

    const r = await fetch(`${MP_API}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': req.external_reference + '-' + Date.now(),
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const txt = await r.text();
      return {
        ok: false,
        mock: false,
        mp_payment_id: null,
        status: 'pendente',
        qr_code: '',
        qr_base64: '',
        ticket_url: '',
        expires_at: req.expires_at || isoExpire(30),
        error: `MP HTTP ${r.status}: ${txt}`,
      };
    }

    const data: any = await r.json();
    const tx = data?.point_of_interaction?.transaction_data || {};

    return {
      ok: true,
      mock: false,
      mp_payment_id: String(data?.id || ''),
      status: mpStatusToLocal(String(data?.status || 'pending')),
      qr_code: tx.qr_code || '',
      qr_base64: tx.qr_code_base64 || '',
      ticket_url: tx.ticket_url || '',
      expires_at: data?.date_of_expiration || req.expires_at || isoExpire(30),
      raw: data,
    };
  } catch (e: any) {
    return {
      ok: false,
      mock: false,
      mp_payment_id: null,
      status: 'pendente',
      qr_code: '',
      qr_base64: '',
      ticket_url: '',
      expires_at: isoExpire(30),
      error: 'Erro de rede ao chamar MP: ' + (e?.message || String(e)),
    };
  }
}

/**
 * Consulta status de um pagamento MP (usado pelo webhook ou polling).
 */
export async function consultarPagamentoMP(
  accessToken: string | undefined,
  mpPaymentId: string
): Promise<{ ok: boolean; status: string; raw?: any; error?: string }> {
  // MOCK
  if (!accessToken || mpPaymentId.startsWith('MOCK-')) {
    return {
      ok: true,
      // Em mock, exigimos confirmação manual via /master/payments/:id/aprovar
      status: 'pendente',
      raw: { id: mpPaymentId, mock: true },
    };
  }

  try {
    const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(mpPaymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, status: 'pendente', error: `MP HTTP ${r.status}: ${t}` };
    }
    const data: any = await r.json();
    return { ok: true, status: mpStatusToLocal(String(data?.status || 'pending')), raw: data };
  } catch (e: any) {
    return { ok: false, status: 'pendente', error: e?.message || String(e) };
  }
}

function isoExpire(minutes: number): string {
  // MP exige ISO 8601 com timezone. Usamos -03:00 (Brasil).
  const d = new Date(Date.now() + minutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  // d.toISOString() é em UTC; convertemos para -03:00 manualmente
  const offsetMin = -3 * 60;
  const local = new Date(d.getTime() + offsetMin * 60 * 1000);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.000-03:00`
  );
}

// PNG 1x1 transparente codificado em base64 — placeholder de QR para o modo MOCK
const MOCK_QR_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
