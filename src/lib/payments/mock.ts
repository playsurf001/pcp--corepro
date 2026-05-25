/**
 * SPRINT D — MockGateway
 * Implementação fake do PixGateway para desenvolvimento local.
 * Gera QR code falso (mas válido como string), e o status pode ser
 * promovido a "aprovado" via endpoint master `/payments/:id/simulate-approved`.
 *
 * Estado em memória é OK para dev (não persiste entre restarts do worker),
 * mas o estado REAL fica no D1 (tabela payments) — esta classe é stateless.
 */

import type { CreatePixInput, CreatePixResult, GetPixStatusResult, PixGateway } from './types';

export class MockGateway implements PixGateway {
  readonly name = 'mock';

  async createPix(input: CreatePixInput): Promise<CreatePixResult> {
    // Gera um ID pseudo-único (timestamp + random)
    const gateway_payment_id = `mock_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    // QR fake: payload PIX BR-Code com EMV padrão (não é válido pra pagar de verdade)
    const qr_code = `00020126360014BR.GOV.BCB.PIX0114+551199999999952040000530398654${input.valor.toFixed(2).padStart(10, '0')}5802BR5913MOCK GATEWAY6009SAO PAULO62070503***6304ABCD`;
    // QR base64 fake (1x1 pixel PNG transparente)
    const qr_code_base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const minutos = input.expira_em_minutos ?? 1440;
    const dt_expiracao = new Date(Date.now() + minutos * 60_000).toISOString();
    return {
      gateway_payment_id,
      gateway_status: 'pending',
      status: 'pendente',
      qr_code,
      qr_code_base64,
      ticket_url: `https://mock.local/pay/${gateway_payment_id}`,
      dt_expiracao,
      raw: { mock: true, input },
    };
  }

  /**
   * Mock retorna sempre 'pendente'. O endpoint master
   * `POST /master/empresas/:id/payments/:id_payment/simulate-approved`
   * é quem promove diretamente no DB (não passa por aqui).
   */
  async getPixStatus(gateway_payment_id: string): Promise<GetPixStatusResult> {
    return {
      status: 'pendente',
      gateway_status: 'pending',
      dt_pagamento: null,
      raw: { mock: true, gateway_payment_id },
    };
  }
}
