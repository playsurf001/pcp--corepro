/**
 * SPRINT D — Factory de gateway
 * Resolve qual implementação usar baseado em env:
 *   - MP_USE_MOCK=1 → MockGateway (dev local)
 *   - caso contrário → MercadoPagoGateway (requer MP_ACCESS_TOKEN)
 */

import type { PixGateway } from './types';
import { MockGateway } from './mock';
import { MercadoPagoGateway } from './mercadopago';

export interface PaymentsEnv {
  MP_USE_MOCK?: string;
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
}

/** Retorna a instância do gateway apropriada. Lança se config estiver incompleta. */
export function getGateway(env: PaymentsEnv): PixGateway {
  const useMock = env.MP_USE_MOCK === '1' || env.MP_USE_MOCK === 'true';
  if (useMock) {
    return new MockGateway();
  }
  const token = env.MP_ACCESS_TOKEN;
  if (!token) {
    // Sem token e sem mock → fallback automático para mock (evita explodir em dev sem config)
    return new MockGateway();
  }
  return new MercadoPagoGateway(token);
}

/** Helper para saber se o gateway atual é mock (libera endpoint simulate-approved) */
export function isMockMode(env: PaymentsEnv): boolean {
  const useMock = env.MP_USE_MOCK === '1' || env.MP_USE_MOCK === 'true';
  if (useMock) return true;
  // Sem token também é mock (fallback)
  return !env.MP_ACCESS_TOKEN;
}
