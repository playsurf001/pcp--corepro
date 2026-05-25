/**
 * SPRINT D — Payments
 * Interface comum para gateways PIX. MercadoPagoGateway e MockGateway
 * implementam essa interface, e o resto do código depende SÓ desse contrato.
 */

export type PixStatus = 'pendente' | 'aprovado' | 'rejeitado' | 'cancelado' | 'expirado';

export interface CreatePixInput {
  /** Valor em reais (ex: 49.90) */
  valor: number;
  /** Descrição da cobrança (aparece no extrato/notificação MP) */
  descricao: string;
  /** Email do pagador (obrigatório no MP) */
  email_pagador: string;
  /** Nome do pagador (opcional mas recomendado) */
  nome_pagador?: string;
  /** CPF/CNPJ do pagador (opcional, sem máscara) */
  documento_pagador?: string;
  /** Identificador externo do nosso lado (id_payment) — vira `external_reference` no MP */
  external_reference: string;
  /** URL absoluta do webhook (será setada como notification_url) */
  webhook_url: string;
  /** Minutos até expirar (padrão MP: 24h = 1440) */
  expira_em_minutos?: number;
}

export interface CreatePixResult {
  /** ID do payment no gateway (string) */
  gateway_payment_id: string;
  /** Status reportado pelo gateway na criação */
  gateway_status: string;
  /** Status normalizado para o nosso domínio */
  status: PixStatus;
  /** Payload PIX copia-e-cola (texto longo `00020126...`) */
  qr_code: string;
  /** QR code em base64 PNG (sem prefixo data:image) */
  qr_code_base64: string;
  /** URL do ticket (caso o gateway forneça uma página de pagamento) */
  ticket_url?: string;
  /** Data ISO de expiração (UTC) */
  dt_expiracao: string;
  /** Resposta bruta do gateway (auditoria/debug) */
  raw?: unknown;
}

export interface GetPixStatusResult {
  /** Status normalizado */
  status: PixStatus;
  /** Status bruto do gateway */
  gateway_status: string;
  /** Data ISO em que o pagamento foi aprovado (null se ainda não) */
  dt_pagamento?: string | null;
  /** Valor efetivamente pago (caso parcial) */
  valor_pago?: number;
  /** Resposta bruta do gateway */
  raw?: unknown;
}

export interface PixGateway {
  /** Nome para logs/debug (mercadopago | mock) */
  readonly name: string;
  /** Cria uma cobrança PIX */
  createPix(input: CreatePixInput): Promise<CreatePixResult>;
  /** Consulta o status de uma cobrança pelo ID retornado pelo gateway */
  getPixStatus(gateway_payment_id: string): Promise<GetPixStatusResult>;
}

/**
 * Normaliza qualquer status reportado pelo gateway para o nosso enum.
 * Mercado Pago retorna: pending, approved, authorized, in_process, in_mediation,
 *                       rejected, cancelled, refunded, charged_back.
 */
export function normalizeStatus(raw: string): PixStatus {
  const s = (raw || '').toLowerCase();
  if (s === 'approved' || s === 'authorized' || s === 'aprovado') return 'aprovado';
  if (s === 'rejected' || s === 'charged_back' || s === 'rejeitado') return 'rejeitado';
  if (s === 'cancelled' || s === 'canceled' || s === 'cancelado') return 'cancelado';
  if (s === 'refunded' || s === 'reembolsado') return 'cancelado';
  if (s === 'expired' || s === 'expirado') return 'expirado';
  // pending, in_process, in_mediation, pendente → pendente
  return 'pendente';
}
