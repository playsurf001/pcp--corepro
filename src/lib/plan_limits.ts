// =====================================================================
// SPRINT 2 — Enforcement de Limites de Plano
// =====================================================================
// Cada empresa tem um plano vigente (companies.id_plano → plans). Cada
// plano define limites como max_usuarios, max_remessas_mes,
// max_terceirizados. Limites com valor -1 significam ILIMITADO.
//
// Empresa id=1 (fundadora) é sempre cortesia enterprise (sem limites).
//
// API exposta:
//   • getPlanLimits(db, id_empresa) → resolve plano + limites + features
//   • countUsuariosAtivos / countTerceirizadosAtivos / countRemessasMes
//   • assertLimit(db, id_empresa, kind) → throw LimitExceededError se excedido
//   • LimitExceededError com status 402 + code 'PLAN_LIMIT_EXCEEDED'
// =====================================================================

export type LimitKind = 'usuarios' | 'terceirizados' | 'remessas_mes';

export interface PlanLimitsInfo {
  id_plano: number | null;
  codigo: string;
  nome: string;
  preco_mensal: number;
  max_usuarios: number;       // -1 = ilimitado
  max_remessas_mes: number;   // -1 = ilimitado
  max_terceirizados: number;  // -1 = ilimitado
  max_storage_mb: number;     // -1 = ilimitado
  features: {
    relatorios_avancados: boolean;
    api: boolean;
    export_excel: boolean;
    audit_log: boolean;
    multi_filial: boolean;
  };
}

export class LimitExceededError extends Error {
  status = 402;
  code = 'PLAN_LIMIT_EXCEEDED';
  kind: LimitKind;
  limite: number;
  atual: number;
  plano: string;
  constructor(kind: LimitKind, limite: number, atual: number, plano: string, msg: string) {
    super(msg);
    this.kind = kind;
    this.limite = limite;
    this.atual = atual;
    this.plano = plano;
  }
  toResponse(): Response {
    return new Response(
      JSON.stringify({
        ok: false,
        error: this.message,
        code: this.code,
        kind: this.kind,
        limite: this.limite,
        atual: this.atual,
        plano: this.plano,
      }),
      { status: this.status, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

const DEFAULT_LIMITS: PlanLimitsInfo = {
  id_plano: null,
  codigo: 'starter',
  nome: 'Starter (default)',
  preco_mensal: 49.9,
  max_usuarios: 2,
  max_remessas_mes: 100,
  max_terceirizados: 20,
  max_storage_mb: 200,
  features: {
    relatorios_avancados: false,
    api: false,
    export_excel: true,
    audit_log: false,
    multi_filial: false,
  },
};

/**
 * Retorna os limites do plano vigente da empresa.
 * Fallback robusto: se não houver id_plano, retorna defaults Starter.
 * Empresa id=1 (fundadora) recebe valores enterprise (-1 / ilimitado).
 */
export async function getPlanLimits(
  db: D1Database,
  id_empresa: number
): Promise<PlanLimitsInfo> {
  // Empresa fundadora — sempre ilimitada (mesmo se DB tiver outra config)
  if (id_empresa === 1) {
    // Tenta carregar do banco; se não houver, devolve enterprise hardcoded
    const r: any = await db
      .prepare(
        `SELECT p.id_plano, p.codigo, p.nome, p.preco_mensal,
                p.max_usuarios, p.max_remessas_mes, p.max_terceirizados, p.max_storage_mb,
                p.feat_relatorios_avancados, p.feat_api, p.feat_export_excel,
                p.feat_audit_log, p.feat_multi_filial
           FROM companies c
           LEFT JOIN plans p ON p.id_plano = c.id_plano
          WHERE c.id_empresa = ?`
      )
      .bind(id_empresa)
      .first();
    if (r && r.id_plano) return rowToLimits(r);
    return {
      id_plano: null,
      codigo: 'enterprise',
      nome: 'Enterprise (founder)',
      preco_mensal: 0,
      max_usuarios: -1,
      max_remessas_mes: -1,
      max_terceirizados: -1,
      max_storage_mb: -1,
      features: {
        relatorios_avancados: true,
        api: true,
        export_excel: true,
        audit_log: true,
        multi_filial: true,
      },
    };
  }

  const r: any = await db
    .prepare(
      `SELECT p.id_plano, p.codigo, p.nome, p.preco_mensal,
              p.max_usuarios, p.max_remessas_mes, p.max_terceirizados, p.max_storage_mb,
              p.feat_relatorios_avancados, p.feat_api, p.feat_export_excel,
              p.feat_audit_log, p.feat_multi_filial
         FROM companies c
         LEFT JOIN plans p ON p.id_plano = c.id_plano
        WHERE c.id_empresa = ?`
    )
    .bind(id_empresa)
    .first();
  if (!r || !r.id_plano) return { ...DEFAULT_LIMITS };
  return rowToLimits(r);
}

function rowToLimits(r: any): PlanLimitsInfo {
  return {
    id_plano: Number(r.id_plano) || null,
    codigo: String(r.codigo || 'starter'),
    nome: String(r.nome || 'Starter'),
    preco_mensal: Number(r.preco_mensal || 0),
    max_usuarios: Number(r.max_usuarios ?? -1),
    max_remessas_mes: Number(r.max_remessas_mes ?? -1),
    max_terceirizados: Number(r.max_terceirizados ?? -1),
    max_storage_mb: Number(r.max_storage_mb ?? -1),
    features: {
      relatorios_avancados: !!r.feat_relatorios_avancados,
      api: !!r.feat_api,
      export_excel: r.feat_export_excel === undefined ? true : !!r.feat_export_excel,
      audit_log: !!r.feat_audit_log,
      multi_filial: !!r.feat_multi_filial,
    },
  };
}

/* ============================================================
 * Contadores de uso (por empresa)
 * ============================================================ */
export async function countUsuariosAtivos(db: D1Database, id_empresa: number): Promise<number> {
  const r: any = await db
    .prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE id_empresa = ? AND ativo = 1`)
    .bind(id_empresa)
    .first();
  return Number(r?.n || 0);
}

export async function countTerceirizadosAtivos(db: D1Database, id_empresa: number): Promise<number> {
  const r: any = await db
    .prepare(`SELECT COUNT(*) AS n FROM terc_terceirizados WHERE id_empresa = ? AND ativo = 1`)
    .bind(id_empresa)
    .first();
  return Number(r?.n || 0);
}

/**
 * Conta remessas do MÊS corrente (YYYY-MM). Considera dt_criacao OU dt_saida
 * — usa dt_criacao quando disponível (mais robusto p/ migração legada).
 */
export async function countRemessasMes(db: D1Database, id_empresa: number): Promise<number> {
  const mes = new Date().toISOString().slice(0, 7);
  const r: any = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM terc_remessas
        WHERE id_empresa = ?
          AND substr(COALESCE(dt_criacao, dt_saida, datetime('now')), 1, 7) = ?`
    )
    .bind(id_empresa, mes)
    .first();
  return Number(r?.n || 0);
}

/**
 * Lança LimitExceededError se a empresa ULTRAPASSAR o limite ao incluir +1 unidade.
 * Use em handlers POST de criação:
 *
 *   try {
 *     await assertLimit(c.env.DB, id_empresa, 'usuarios');
 *   } catch (e) {
 *     if (e instanceof LimitExceededError) return e.toResponse();
 *     throw e;
 *   }
 */
export async function assertLimit(
  db: D1Database,
  id_empresa: number,
  kind: LimitKind
): Promise<PlanLimitsInfo> {
  const plan = await getPlanLimits(db, id_empresa);

  let limite = -1;
  let atual = 0;
  let labelSing = '';
  let labelPlur = '';

  if (kind === 'usuarios') {
    limite = plan.max_usuarios;
    atual = await countUsuariosAtivos(db, id_empresa);
    labelSing = 'usuário ativo';
    labelPlur = 'usuários ativos';
  } else if (kind === 'terceirizados') {
    limite = plan.max_terceirizados;
    atual = await countTerceirizadosAtivos(db, id_empresa);
    labelSing = 'terceirizado ativo';
    labelPlur = 'terceirizados ativos';
  } else if (kind === 'remessas_mes') {
    limite = plan.max_remessas_mes;
    atual = await countRemessasMes(db, id_empresa);
    labelSing = 'remessa no mês';
    labelPlur = 'remessas no mês';
  }

  // -1 = ilimitado
  if (limite < 0) return plan;

  if (atual >= limite) {
    const _ = labelSing; // (suprime lint não usado)
    throw new LimitExceededError(
      kind,
      limite,
      atual,
      plan.codigo,
      `Limite do plano "${plan.nome}" atingido: ${atual} de ${limite} ${labelPlur}. ` +
        `Faça upgrade do plano para continuar.`
    );
  }
  return plan;
}

/**
 * Resumo consolidado de uso vs limite — para exibir em /api/empresa/uso
 * e banner de trial no frontend.
 */
export async function getUsageSummary(db: D1Database, id_empresa: number) {
  const plan = await getPlanLimits(db, id_empresa);
  const [u, t, r] = await Promise.all([
    countUsuariosAtivos(db, id_empresa),
    countTerceirizadosAtivos(db, id_empresa),
    countRemessasMes(db, id_empresa),
  ]);
  return {
    plano: { codigo: plan.codigo, nome: plan.nome, preco_mensal: plan.preco_mensal },
    features: plan.features,
    uso: {
      usuarios:       { atual: u, limite: plan.max_usuarios,      ilimitado: plan.max_usuarios       < 0 },
      terceirizados:  { atual: t, limite: plan.max_terceirizados, ilimitado: plan.max_terceirizados  < 0 },
      remessas_mes:   { atual: r, limite: plan.max_remessas_mes,  ilimitado: plan.max_remessas_mes   < 0 },
    },
  };
}
