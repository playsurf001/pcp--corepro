// Importador de OPs antigas - recebe JSON já parseado no front (SheetJS via CDN)
// Estratégia: front-end extrai linhas do xlsx, envia para cá, servidor valida + cria.
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser } from '../lib/db';
import { requirePerfil } from '../lib/auth';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

/* ============ Mapeamentos dinâmicos ============ */
async function mapaClientes(db: D1Database): Promise<Map<string, number>> {
  const rs = await db.prepare(`SELECT id_cliente, cod_cliente, nome_cliente FROM clientes`).all();
  const m = new Map<string, number>();
  (rs.results as any[]).forEach((r) => {
    m.set(String(r.cod_cliente).toLowerCase(), r.id_cliente);
    m.set(String(r.nome_cliente).toLowerCase(), r.id_cliente);
  });
  return m;
}

async function mapaReferencias(db: D1Database): Promise<Map<string, number>> {
  const rs = await db.prepare(`SELECT id_ref, cod_ref FROM referencias`).all();
  const m = new Map<string, number>();
  (rs.results as any[]).forEach((r) => m.set(String(r.cod_ref).toLowerCase(), r.id_ref));
  return m;
}

async function mapaCores(db: D1Database): Promise<Map<string, number>> {
  const rs = await db.prepare(`SELECT id_cor, cod_cor, nome_cor FROM cores`).all();
  const m = new Map<string, number>();
  (rs.results as any[]).forEach((r) => {
    m.set(String(r.cod_cor).toLowerCase(), r.id_cor);
    m.set(String(r.nome_cor).toLowerCase(), r.id_cor);
  });
  return m;
}

async function mapaTamanhos(db: D1Database): Promise<Map<string, number>> {
  const rs = await db.prepare(`SELECT id_tam, cod_tam FROM tamanhos`).all();
  const m = new Map<string, number>();
  (rs.results as any[]).forEach((r) => m.set(String(r.cod_tam).toLowerCase(), r.id_tam));
  return m;
}

/* ============ Normaliza data (aceita 'dd/mm/yyyy', 'yyyy-mm-dd', número-serial Excel) ============ */
function normalizaData(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/* ============ ENDPOINT PRINCIPAL ============
 * POST /api/importar/ops
 * body: {
 *   dry_run?: boolean,         // se true, só valida, não grava
 *   criar_faltantes?: boolean, // cria referências/clientes automaticamente se não existirem
 *   linhas: [{
 *     num_op, dt_emissao, dt_entrega, cod_ref, desc_ref?,
 *     cliente (cod ou nome), qtde_pecas,
 *     observacao?,
 *     cores:    { [cor]: qtde } | [{cor, qtde}],
 *     tamanhos: { [tam]: qtde } | [{tam, qtde}]
 *   }]
 * }
 */
app.post('/importar/ops', requirePerfil('pcp'), async (c) => {
  const b = await c.req.json<any>();
  const linhas = Array.isArray(b.linhas) ? b.linhas : [];
  if (linhas.length === 0) return fail('Nenhuma linha recebida.');
  const dry = !!b.dry_run;
  const criarFaltantes = !!b.criar_faltantes;
  const user = getUser(c);

  // Carrega mapas em memória (uma vez)
  const clientes = await mapaClientes(c.env.DB);
  const refs = await mapaReferencias(c.env.DB);
  const cores = await mapaCores(c.env.DB);
  const tams = await mapaTamanhos(c.env.DB);

  // Lê OPs já existentes (chave num_op)
  const existentes = await c.env.DB.prepare(`SELECT num_op FROM op_cab`).all();
  const setOP = new Set<string>((existentes.results as any[]).map((r) => String(r.num_op)));

  const relatorio: Array<{ linha: number; num_op: string; status: string; detalhe?: string }> = [];
  let okCount = 0, skipCount = 0, errCount = 0;

  for (let i = 0; i < linhas.length; i++) {
    const L = linhas[i];
    const nLinha = i + 1;
    try {
      const numOp = String(L.num_op || '').trim();
      if (!numOp) {
        relatorio.push({ linha: nLinha, num_op: '', status: 'erro', detalhe: 'num_op vazio' });
        errCount++; continue;
      }
      if (setOP.has(numOp)) {
        relatorio.push({ linha: nLinha, num_op: numOp, status: 'duplicada', detalhe: 'num_op já existe' });
        skipCount++; continue;
      }

      const dtEm = normalizaData(L.dt_emissao);
      const dtEn = normalizaData(L.dt_entrega);
      if (!dtEm) { relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: 'dt_emissao inválida' }); errCount++; continue; }
      if (!dtEn) { relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: 'dt_entrega inválida' }); errCount++; continue; }

      const qt = toInt(L.qtde_pecas);
      if (qt <= 0) { relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: 'qtde_pecas <= 0' }); errCount++; continue; }

      // Resolve cliente
      const cliKey = String(L.cliente || '').trim().toLowerCase();
      let idCli = clientes.get(cliKey);
      if (!idCli) {
        if (criarFaltantes && cliKey) {
          if (dry) { idCli = -1 as any; }
          else {
            const cod = ('IMP' + String(clientes.size + 1).padStart(3, '0')).toUpperCase();
            const r = await c.env.DB.prepare(
              `INSERT INTO clientes (cod_cliente, nome_cliente) VALUES (?, ?)`
            ).bind(cod, String(L.cliente)).run();
            idCli = toInt(r.meta.last_row_id);
            clientes.set(cliKey, idCli);
            clientes.set(cod.toLowerCase(), idCli);
          }
        } else {
          relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: `cliente não cadastrado: ${L.cliente}` });
          errCount++; continue;
        }
      }

      // Resolve referência
      const refKey = String(L.cod_ref || '').trim().toLowerCase();
      let idRef = refs.get(refKey);
      if (!idRef) {
        if (criarFaltantes && refKey) {
          if (dry) { idRef = -1 as any; }
          else {
            const r = await c.env.DB.prepare(
              `INSERT INTO referencias (cod_ref, desc_ref) VALUES (?, ?)`
            ).bind(String(L.cod_ref), String(L.desc_ref || L.cod_ref)).run();
            idRef = toInt(r.meta.last_row_id);
            refs.set(refKey, idRef);
          }
        } else {
          relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: `referência não cadastrada: ${L.cod_ref}` });
          errCount++; continue;
        }
      }

      // Sequência ativa da referência
      let idSeqCab = 0;
      if (!dry) {
        const sa = await c.env.DB.prepare(
          `SELECT id_seq_cab FROM seq_cab WHERE id_ref=? AND ativa=1 LIMIT 1`
        ).bind(idRef).first<{ id_seq_cab: number }>();
        if (!sa) {
          relatorio.push({
            linha: nLinha, num_op: numOp, status: 'erro',
            detalhe: `Ref ${L.cod_ref} sem sequência ativa (cadastre sequência antes de importar OP).`
          });
          errCount++; continue;
        }
        idSeqCab = sa.id_seq_cab;
      }

      // Normaliza cores e tamanhos (aceita mapa {cor:qtd} ou lista [{cor,qtde}])
      const coresArr = normaliza(L.cores);
      const tamsArr = normaliza(L.tamanhos);

      // Valida soma == qtde_pecas quando informado (regra da v2.0)
      const sumC = coresArr.reduce((s: number, x) => s + toInt(x.qtde), 0);
      const sumT = tamsArr.reduce((s: number, x) => s + toInt(x.qtde), 0);
      if (coresArr.length > 0 && sumC !== qt) {
        relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: `soma cores ${sumC} ≠ qtde ${qt}` });
        errCount++; continue;
      }
      if (tamsArr.length > 0 && sumT !== qt) {
        relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: `soma tamanhos ${sumT} ≠ qtde ${qt}` });
        errCount++; continue;
      }

      // Resolve IDs de cores e tamanhos
      const coresIds: Array<{ id_cor: number; qtde: number }> = [];
      for (const cx of coresArr) {
        const id = cores.get(String(cx.nome).toLowerCase());
        if (!id) {
          relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: `cor não cadastrada: ${cx.nome}` });
          errCount++; continue;
        }
        coresIds.push({ id_cor: id, qtde: toInt(cx.qtde) });
      }
      const tamsIds: Array<{ id_tam: number; qtde: number }> = [];
      for (const tx of tamsArr) {
        const id = tams.get(String(tx.nome).toLowerCase());
        if (!id) {
          relatorio.push({ linha: nLinha, num_op: numOp, status: 'erro', detalhe: `tamanho não cadastrado: ${tx.nome}` });
          errCount++; continue;
        }
        tamsIds.push({ id_tam: id, qtde: toInt(tx.qtde) });
      }

      if (dry) {
        relatorio.push({ linha: nLinha, num_op: numOp, status: 'ok', detalhe: 'validou (dry-run)' });
        okCount++; continue;
      }

      // Grava OP + grades em batch
      const ins = await c.env.DB.prepare(
        `INSERT INTO op_cab (num_op, dt_emissao, id_ref, id_cliente, qtde_pecas, dt_entrega, id_seq_cab, status, observacao, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Concluida', ?, ?)`
      ).bind(numOp, dtEm, idRef, idCli, qt, dtEn, idSeqCab, String(L.observacao || 'Importada do legado'), user).run();
      const idOP = toInt(ins.meta.last_row_id);

      const stmts: D1PreparedStatement[] = [];
      for (const cc of coresIds) {
        stmts.push(c.env.DB.prepare(
          `INSERT INTO op_cores (id_op, id_cor, qtde_pecas) VALUES (?, ?, ?)`
        ).bind(idOP, cc.id_cor, cc.qtde));
      }
      for (const tt of tamsIds) {
        stmts.push(c.env.DB.prepare(
          `INSERT INTO op_tamanhos (id_op, id_tam, qtde_pecas) VALUES (?, ?, ?)`
        ).bind(idOP, tt.id_tam, tt.qtde));
      }
      if (stmts.length) await c.env.DB.batch(stmts);

      setOP.add(numOp);
      okCount++;
      relatorio.push({ linha: nLinha, num_op: numOp, status: 'ok', detalhe: `id_op=${idOP}` });
    } catch (e: any) {
      errCount++;
      relatorio.push({
        linha: nLinha, num_op: String(L?.num_op || ''), status: 'erro',
        detalhe: e.message || 'erro desconhecido'
      });
    }
  }

  await audit(c, 'IMPORT', dry ? 'VAL_OP' : 'INS_OP', `linhas=${linhas.length}`, '', '', `ok=${okCount},skip=${skipCount},err=${errCount}`);

  return c.json(
    ok({
      dry_run: dry,
      total: linhas.length,
      importadas: okCount,
      ignoradas: skipCount,
      erros: errCount,
      relatorio,
    })
  );
});

function normaliza(obj: any): Array<{ nome: string; qtde: number }> {
  if (!obj) return [];
  if (Array.isArray(obj)) {
    return obj
      .filter((x) => x && (x.cor || x.tamanho || x.nome) && x.qtde != null)
      .map((x: any) => ({ nome: String(x.cor || x.tamanho || x.nome), qtde: toInt(x.qtde) }));
  }
  if (typeof obj === 'object') {
    return Object.entries(obj)
      .filter(([, v]) => v != null && toInt(v) > 0)
      .map(([k, v]) => ({ nome: k, qtde: toInt(v) }));
  }
  return [];
}

/* ============ Importação de cadastros mestres em massa ============ */
app.post('/importar/cadastros', requirePerfil('admin'), async (c) => {
  const b = await c.req.json<any>();
  const user = getUser(c);
  const out = { clientes: 0, referencias: 0, cores: 0, tamanhos: 0, operacoes: 0, maquinas: 0, aparelhos: 0, erros: [] as string[] };

  const inserir = async (sql: string, campos: any[], tipo: keyof typeof out) => {
    try {
      await c.env.DB.prepare(sql).bind(...campos).run();
      (out[tipo] as number)++;
    } catch (e: any) {
      (out.erros as string[]).push(`${tipo}: ${campos[0]} - ${e.message}`);
    }
  };

  for (const cli of b.clientes || []) {
    if (cli.cod_cliente && cli.nome_cliente)
      await inserir(
        `INSERT OR IGNORE INTO clientes (cod_cliente, nome_cliente, observacao) VALUES (?, ?, ?)`,
        [cli.cod_cliente, cli.nome_cliente, cli.observacao || null],
        'clientes'
      );
  }
  for (const r of b.referencias || []) {
    if (r.cod_ref)
      await inserir(
        `INSERT OR IGNORE INTO referencias (cod_ref, desc_ref, familia) VALUES (?, ?, ?)`,
        [r.cod_ref, r.desc_ref || r.cod_ref, r.familia || null],
        'referencias'
      );
  }
  for (const x of b.cores || []) {
    if (x.cod_cor && x.nome_cor)
      await inserir(
        `INSERT OR IGNORE INTO cores (cod_cor, nome_cor) VALUES (?, ?)`,
        [x.cod_cor, x.nome_cor],
        'cores'
      );
  }
  for (const x of b.tamanhos || []) {
    if (x.cod_tam)
      await inserir(
        `INSERT OR IGNORE INTO tamanhos (cod_tam, ordem) VALUES (?, ?)`,
        [x.cod_tam, toInt(x.ordem, 0)],
        'tamanhos'
      );
  }
  for (const x of b.maquinas || []) {
    if (x.cod_maquina && x.desc_maquina)
      await inserir(
        `INSERT OR IGNORE INTO maquinas (cod_maquina, desc_maquina, tipo, eficiencia, oper_por_maquina) VALUES (?, ?, ?, ?, ?)`,
        [x.cod_maquina, x.desc_maquina, x.tipo || null, toNum(x.eficiencia, 0.85), toNum(x.oper_por_maquina, 1)],
        'maquinas'
      );
  }
  for (const x of b.aparelhos || []) {
    if (x.cod_aparelho && x.desc_aparelho)
      await inserir(
        `INSERT OR IGNORE INTO aparelhos (cod_aparelho, desc_aparelho) VALUES (?, ?)`,
        [x.cod_aparelho, x.desc_aparelho],
        'aparelhos'
      );
  }
  for (const x of b.operacoes || []) {
    if (x.cod_op && x.desc_op)
      await inserir(
        `INSERT OR IGNORE INTO operacoes (cod_op, desc_op, tempo_padrao) VALUES (?, ?, ?)`,
        [x.cod_op, x.desc_op, toNum(x.tempo_padrao, 0)],
        'operacoes'
      );
  }
  await audit(c, 'IMPORT', 'CAD_MASSA', `total=${Object.values(out).filter(v => typeof v === 'number').reduce((a: any, v: any) => a + v, 0)}`, '', '', '', user);
  return c.json(ok(out));
});

export default app;
