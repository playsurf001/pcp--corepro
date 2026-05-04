// Controle de Terceirização — Remessas, Retornos, Consertos, Cadastros, Resumo
// Baseado na planilha "Controle de Terceirização Versão.xlsx"
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

const MOD = 'TERC';
const TAMS = ['P','M','G','GG','EG','SG','T7','T8','T9','T10'];

/* =================================================================
 * CADASTROS AUXILIARES
 * ================================================================= */

// -------- Setores
app.get('/terc/setores', async (c) => {
  const rs = await c.env.DB.prepare('SELECT * FROM terc_setores ORDER BY nome_setor').all();
  return c.json(ok(rs.results));
});
app.post('/terc/setores', async (c) => {
  const b = await c.req.json();
  if (!b.nome_setor) return fail('nome_setor é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_setores (nome_setor, ativo) VALUES (?, 1)').bind(b.nome_setor).run();
  await audit(c, MOD, 'INS', `setor:${r.meta.last_row_id}`, 'nome_setor', '', b.nome_setor);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/setores/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_setores SET nome_setor=?, ativo=? WHERE id_setor=?').bind(b.nome_setor, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `setor:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/setores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const uso = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_terceirizados WHERE id_setor=?').bind(id).first<any>();
  if (uso && uso.c > 0) return fail(`Setor possui ${uso.c} terceirizado(s) vinculado(s).`, 409);
  await c.env.DB.prepare('DELETE FROM terc_setores WHERE id_setor=?').bind(id).run();
  await audit(c, MOD, 'DEL', `setor:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// -------- Serviços
app.get('/terc/servicos', async (c) => {
  const rs = await c.env.DB.prepare('SELECT * FROM terc_servicos ORDER BY desc_servico').all();
  return c.json(ok(rs.results));
});
app.post('/terc/servicos', async (c) => {
  const b = await c.req.json();
  if (!b.desc_servico) return fail('desc_servico é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_servicos (desc_servico, ativo) VALUES (?, 1)').bind(b.desc_servico).run();
  await audit(c, MOD, 'INS', `servico:${r.meta.last_row_id}`, 'desc_servico', '', b.desc_servico);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/servicos/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_servicos SET desc_servico=?, ativo=? WHERE id_servico=?').bind(b.desc_servico, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `servico:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/servicos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_servicos WHERE id_servico=?').bind(id).run();
  await audit(c, MOD, 'DEL', `servico:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// -------- Coleções
app.get('/terc/colecoes', async (c) => {
  const rs = await c.env.DB.prepare('SELECT * FROM terc_colecoes ORDER BY nome_colecao').all();
  return c.json(ok(rs.results));
});
app.post('/terc/colecoes', async (c) => {
  const b = await c.req.json();
  if (!b.nome_colecao) return fail('nome_colecao é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo) VALUES (?, 1)').bind(b.nome_colecao).run();
  await audit(c, MOD, 'INS', `colecao:${r.meta.last_row_id}`, 'nome_colecao', '', b.nome_colecao);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/colecoes/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_colecoes SET nome_colecao=?, ativo=? WHERE id_colecao=?').bind(b.nome_colecao, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `colecao:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/colecoes/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  // Validações de uso (impede excluir coleção em uso)
  const usoP = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_produtos WHERE id_colecao=?').bind(id).first<any>();
  if (usoP && usoP.c > 0) return fail(`Coleção possui ${usoP.c} produto(s) vinculado(s).`, 409);
  const usoR = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_remessas WHERE id_colecao=?').bind(id).first<any>();
  if (usoR && usoR.c > 0) return fail(`Coleção possui ${usoR.c} remessa(s) vinculada(s).`, 409);
  const usoPr = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_precos WHERE id_colecao=?').bind(id).first<any>();
  if (usoPr && usoPr.c > 0) return fail(`Coleção possui ${usoPr.c} preço(s) vinculado(s).`, 409);
  await c.env.DB.prepare('DELETE FROM terc_colecoes WHERE id_colecao=?').bind(id).run();
  await audit(c, MOD, 'DEL', `colecao:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * PRODUTOS — Cadastro central de referências (auto-fill em remessa/preço)
 * ================================================================= */

app.get('/terc/produtos', async (c) => {
  const q = c.req.query();
  const where: string[] = []; const binds: any[] = [];
  if (q.ativo !== '0') where.push('p.ativo=1');
  if (q.id_colecao) { where.push('p.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.search) {
    where.push('(p.cod_ref LIKE ? OR p.desc_ref LIKE ? OR p.nome_produto LIKE ?)');
    binds.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }
  const sql = `
    SELECT p.*, co.nome_colecao, s.desc_servico AS desc_servico_padrao
    FROM terc_produtos p
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico_padrao
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.cod_ref
    LIMIT 2000`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

// Excluir TODOS os produtos (com proteção: exige confirm=SIM no body)
// Bloqueia automaticamente se houver produtos referenciados em remessas (FK lógica via cod_ref).
app.delete('/terc/produtos', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (b.confirm !== 'SIM') return fail('Confirmação obrigatória: envie {"confirm":"SIM"} no body.', 400);
  const tot = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_produtos').first<any>();
  await c.env.DB.prepare('DELETE FROM terc_produtos').run();
  await audit(c, MOD, 'DEL_ALL', 'produto:*', 'qtd', String(tot?.c || 0), '0');
  return c.json(ok({ deleted: tot?.c || 0 }));
});

// Lookup rápido por referência (auto-fill na remessa/preço)
// IMPORTANTE: deve vir ANTES de /terc/produtos/:id para evitar match com :id="lookup"
app.get('/terc/produtos/lookup', async (c) => {
  const q = c.req.query();
  const cod_ref = String(q.cod_ref || '').trim();
  if (!cod_ref) return c.json(ok(null));
  const r = await c.env.DB.prepare(`
    SELECT p.*, co.nome_colecao FROM terc_produtos p
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao
    WHERE p.cod_ref=? AND p.ativo=1
      AND (? = 0 OR p.id_colecao=? OR p.id_colecao IS NULL)
    ORDER BY CASE WHEN p.id_colecao=? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(cod_ref, toInt(q.id_colecao) || 0, toInt(q.id_colecao) || 0, toInt(q.id_colecao) || 0)
    .first<any>();
  return c.json(ok(r || null));
});

app.get('/terc/produtos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const r = await c.env.DB.prepare(`
    SELECT p.*, co.nome_colecao, s.desc_servico AS desc_servico_padrao
    FROM terc_produtos p
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico_padrao
    WHERE id_produto=?`).bind(id).first<any>();
  if (!r) return fail('Produto não encontrado', 404);
  return c.json(ok(r));
});

app.post('/terc/produtos', async (c) => {
  const b = await c.req.json();
  const cod_ref = String(b.cod_ref || '').trim();
  const desc_ref = String(b.desc_ref || b.nome_produto || '').trim();
  if (!cod_ref) return fail('Referência é obrigatória');
  if (!desc_ref) return fail('Descrição é obrigatória');
  // Pré-checagem para mensagem clara (mesmo com índice UNIQUE em (cod_ref,colecao))
  const dup = await c.env.DB.prepare(
    'SELECT id_produto FROM terc_produtos WHERE cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0)'
  ).bind(cod_ref, toInt(b.id_colecao) || null).first<any>();
  if (dup) return fail(`Já existe produto com a referência "${cod_ref}" (id ${dup.id_produto}).`, 409);
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_produtos
        (cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao, observacao,
         id_servico_padrao, tempo_padrao, ativo, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(cod_ref, desc_ref, b.nome_produto || null, toInt(b.id_colecao) || null,
        toInt(b.grade_padrao, 1), b.observacao || null,
        toInt(b.id_servico_padrao) || null, b.tempo_padrao != null ? toNum(b.tempo_padrao) : null,
        getUser(c)).run();
    await audit(c, MOD, 'INS', `produto:${r.meta.last_row_id}`, 'cod_ref', '', cod_ref);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe produto com essa referência nesta coleção', 409);
    return fail(String(e));
  }
});

app.put('/terc/produtos/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const cod_ref = String(b.cod_ref || '').trim();
  const desc_ref = String(b.desc_ref || b.nome_produto || '').trim();
  if (!cod_ref || !desc_ref) return fail('Referência e descrição são obrigatórias');
  // Pré-checagem de duplicidade (excluindo o próprio id)
  const dup = await c.env.DB.prepare(
    'SELECT id_produto FROM terc_produtos WHERE cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0) AND id_produto<>?'
  ).bind(cod_ref, toInt(b.id_colecao) || null, id).first<any>();
  if (dup) return fail(`Já existe outro produto com a referência "${cod_ref}" (id ${dup.id_produto}).`, 409);
  try {
    await c.env.DB.prepare(`
      UPDATE terc_produtos
      SET cod_ref=?, desc_ref=?, nome_produto=?, id_colecao=?, grade_padrao=?, observacao=?,
          id_servico_padrao=?, tempo_padrao=?, ativo=?, dt_alteracao=datetime('now')
      WHERE id_produto=?`)
      .bind(cod_ref, desc_ref, b.nome_produto || null, toInt(b.id_colecao) || null,
        toInt(b.grade_padrao, 1), b.observacao || null,
        toInt(b.id_servico_padrao) || null, b.tempo_padrao != null && b.tempo_padrao !== '' ? toNum(b.tempo_padrao) : null,
        b.ativo === 0 ? 0 : 1, id).run();
    await audit(c, MOD, 'UPD', `produto:${id}`);
    return c.json(ok({ id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe produto com essa referência nesta coleção', 409);
    return fail(String(e));
  }
});

app.delete('/terc/produtos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_produtos WHERE id_produto=?').bind(id).run();
  await audit(c, MOD, 'DEL', `produto:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/*  Importação em lote de produtos (Excel/CSV)
 *  Aliases aceitos por coluna (case/acento-insensitive — normalizados no front):
 *    cod_ref       ← "NOME REFERÊNCIA" | referencia | ref | codigo | cod_ref
 *    desc_ref      ← "PRODUTO" | descricao | desc | nome
 *    nome_produto  ← nome_produto | nome
 *    colecao       ← colecao | nome_colecao
 *    id_servico    ← id_servico_padrao | servico_padrao | servico
 *    tempo_padrao  ← tempo_padrao | tempo
 *    grade_padrao  ← grade_padrao | grade
 *    observacao    ← observacao | obs
 *  Opções no body:
 *    dry_run        : boolean (default false) — simula sem gravar
 *    criar_novos    : boolean (default true)  — se false, ignora referências novas
 *    atualizar      : boolean (default true)  — se false, ignora referências existentes
 */
app.post('/terc/produtos/importar', async (c) => {
  const b = await c.req.json();
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  const dryRun = !!b.dry_run;
  const criarNovos = b.criar_novos !== false;
  const atualizarExist = b.atualizar !== false;
  if (rows.length === 0) return fail('Nenhuma linha enviada');

  // Cache de coleções e serviços p/ resolução por nome
  const colMap: Record<string, number> = {};
  (await c.env.DB.prepare('SELECT id_colecao, nome_colecao FROM terc_colecoes').all()).results.forEach((r: any) =>
    colMap[String(r.nome_colecao).toLowerCase().trim()] = r.id_colecao);
  const servMap: Record<string, number> = {};
  (await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos').all()).results.forEach((r: any) =>
    servMap[String(r.desc_servico).toLowerCase().trim()] = r.id_servico);

  const erros: any[] = [];
  const refsNoLote = new Map<string, number>(); // chave "cod_ref|id_colecao" → linha
  let inseridos = 0, atualizados = 0, ignorados = 0, colCriadas = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const n = i + 1;
    try {
      const cod_ref = String(row.cod_ref || row.referencia || row.ref || row.codigo || '').trim();
      const desc_ref = String(row.desc_ref || row.descricao || row.desc || row.produto || row.nome_produto || row.nome || '').trim();
      const nome_produto = String(row.nome_produto || row.nome || '').trim() || null;
      const grade_padrao = toInt(row.grade_padrao || row.grade || 1, 1);
      const observacao = String(row.observacao || row.obs || '').trim() || null;
      const colecao = String(row.colecao || row.nome_colecao || '').trim();
      const tempo_padrao = (row.tempo_padrao != null && row.tempo_padrao !== '') ? toNum(row.tempo_padrao)
                          : (row.tempo != null && row.tempo !== '' ? toNum(row.tempo) : null);

      if (!cod_ref || !desc_ref) {
        erros.push({ linha: n, ref: cod_ref, erro: 'Referência e descrição são obrigatórias' });
        ignorados++; continue;
      }

      // Resolve coleção (cria se faltar e dry_run=false)
      let id_colecao: number | null = null;
      if (colecao) {
        id_colecao = colMap[colecao.toLowerCase()] || null;
        if (!id_colecao && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo) VALUES (?, 1)').bind(colecao).run();
          id_colecao = r.meta.last_row_id as number;
          colMap[colecao.toLowerCase()] = id_colecao; colCriadas++;
        }
      }

      // Resolve serviço por nome OU id
      let id_servico_padrao: number | null = null;
      const servRaw = row.id_servico_padrao || row.servico_padrao || row.servico || row.id_servico;
      if (servRaw != null && String(servRaw).trim() !== '') {
        const asNum = toInt(servRaw);
        if (asNum > 0) id_servico_padrao = asNum;
        else id_servico_padrao = servMap[String(servRaw).toLowerCase().trim()] || null;
      }

      // Detecta duplicidade dentro do PRÓPRIO arquivo (mesma ref+coleção em 2 linhas)
      const dupKey = `${cod_ref}|${id_colecao || 0}`;
      if (refsNoLote.has(dupKey)) {
        erros.push({ linha: n, ref: cod_ref, erro: `Referência duplicada na planilha (linha ${refsNoLote.get(dupKey)})` });
        ignorados++; continue;
      }
      refsNoLote.set(dupKey, n);

      // Verifica se já existe na base (cod_ref + colecao)
      const exists = await c.env.DB.prepare(
        'SELECT id_produto FROM terc_produtos WHERE cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0)'
      ).bind(cod_ref, id_colecao).first<any>();

      if (exists && !atualizarExist) {
        erros.push({ linha: n, ref: cod_ref, erro: 'Já existe e "atualizar" desativado' });
        ignorados++; continue;
      }
      if (!exists && !criarNovos) {
        erros.push({ linha: n, ref: cod_ref, erro: 'Não existe e "criar novos" desativado' });
        ignorados++; continue;
      }

      if (!dryRun) {
        if (exists) {
          await c.env.DB.prepare(`
            UPDATE terc_produtos
            SET desc_ref=?, nome_produto=?, grade_padrao=?, observacao=?,
                id_servico_padrao=COALESCE(?, id_servico_padrao),
                tempo_padrao=COALESCE(?, tempo_padrao),
                dt_alteracao=datetime('now')
            WHERE id_produto=?`)
            .bind(desc_ref, nome_produto, grade_padrao, observacao,
              id_servico_padrao, tempo_padrao, exists.id_produto).run();
          atualizados++;
        } else {
          await c.env.DB.prepare(`
            INSERT INTO terc_produtos
              (cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao, observacao,
               id_servico_padrao, tempo_padrao, ativo, criado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
            .bind(cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao, observacao,
              id_servico_padrao, tempo_padrao, getUser(c)).run();
          inseridos++;
        }
      } else {
        if (exists) atualizados++; else inseridos++;
      }
    } catch (e: any) {
      erros.push({ linha: n, erro: String(e.message || e) }); ignorados++;
    }
  }

  if (!dryRun && (inseridos + atualizados) > 0)
    await audit(c, MOD, 'IMP_PROD', `import:${Date.now()}`, 'qtd', '', String(inseridos + atualizados));
  return c.json(ok({
    dry_run: dryRun, total: rows.length,
    inseridos, atualizados, ignorados,
    colecoes_criadas: colCriadas,
    erros: erros.slice(0, 200),
  }));
});

/* =================================================================
 * TERCEIRIZADOS (CRUD)
 * ================================================================= */

app.get('/terc/terceirizados', async (c) => {
  const q = c.req.query();
  const where: string[] = []; const binds: any[] = [];
  if (q.situacao) { where.push('t.situacao=?'); binds.push(q.situacao); }
  if (q.id_setor) { where.push('t.id_setor=?'); binds.push(toInt(q.id_setor)); }
  if (q.search) { where.push('(t.nome_terc LIKE ? OR t.cpf_cnpj LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }
  const sql = `
    SELECT t.*, s.nome_setor
    FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.nome_terc`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.get('/terc/terceirizados/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const t = await c.env.DB.prepare(`
    SELECT t.*, s.nome_setor FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor WHERE id_terc=?`).bind(id).first<any>();
  if (!t) return fail('Terceirizado não encontrado', 404);

  // Estatísticas operacionais e financeiras (novos status v2)
  const stats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total_remessas,
      COALESCE(SUM(qtd_total),0) AS pecas_enviadas,
      COALESCE(SUM(valor_total),0) AS valor_total,
      SUM(CASE WHEN status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial') THEN 1 ELSE 0 END) AS em_aberto,
      SUM(CASE WHEN status='Atrasado' THEN 1 ELSE 0 END) AS atrasadas,
      SUM(CASE WHEN status IN ('Concluido','Retornado','Pago') THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status_fin='PendentePagamento' THEN (valor_total - COALESCE(valor_pago,0)) ELSE 0 END) AS a_pagar,
      SUM(CASE WHEN status_fin='Pago' THEN COALESCE(valor_pago,0) ELSE 0 END) AS pago_total,
      SUM(CASE WHEN status='EmProducao' THEN qtd_total ELSE 0 END) AS pecas_em_producao
    FROM terc_remessas WHERE id_terc=?`).bind(id).first<any>();

  const producaoAtual = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
           r.dt_saida, r.dt_envio, r.dt_previsao, r.status, r.valor_total,
           sv.desc_servico,
           CASE WHEN date(r.dt_previsao) < date('now') AND r.status NOT IN ('Concluido','Retornado','Pago','Cancelado') THEN 1 ELSE 0 END AS atrasada,
           COALESCE((SELECT SUM(qtd_boa+qtd_refugo+qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa),0) AS qtd_retornada
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.id_terc=? AND r.status NOT IN ('Concluido','Retornado','Pago','Cancelado')
    ORDER BY r.dt_previsao ASC LIMIT 50`).bind(id).all()).results;

  const historico = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.qtd_total,
           r.dt_saida, r.dt_recebimento, r.status, r.status_fin, r.valor_total, r.valor_pago,
           sv.desc_servico
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.id_terc=? AND r.status IN ('Concluido','Retornado','Pago','Cancelado')
    ORDER BY COALESCE(r.dt_recebimento, r.dt_saida) DESC LIMIT 30`).bind(id).all()).results;

  const eficRow = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(rt.qtd_boa),0) AS boa,
      COALESCE(SUM(rt.qtd_refugo+rt.qtd_conserto),0) AS perda,
      COALESCE(SUM(rt.qtd_boa+rt.qtd_refugo+rt.qtd_conserto),0) AS total_ret
    FROM terc_retornos rt
    JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa
    WHERE rm.id_terc=?`).bind(id).first<any>();
  const total_ret = Number(eficRow?.total_ret) || 0;
  const efic_real = total_ret > 0 ? (Number(eficRow?.boa) / total_ret) : 0;

  return c.json(ok({
    ...t, stats,
    eficiencia_real: efic_real,
    pecas_boas: Number(eficRow?.boa) || 0,
    pecas_perda: Number(eficRow?.perda) || 0,
    producao_atual: producaoAtual,
    historico,
  }));
});

app.post('/terc/terceirizados', async (c) => {
  const b = await c.req.json();
  if (!b.nome_terc) return fail('nome_terc é obrigatório');
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_terceirizados (nome_terc, id_setor, cpf_cnpj, telefone, email, endereco, qtd_pessoas, min_trab_dia, efic_padrao, prazo_padrao, situacao, observacao, ativo, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(b.nome_terc, toInt(b.id_setor) || null, b.cpf_cnpj || null, b.telefone || null, b.email || null, b.endereco || null,
        toInt(b.qtd_pessoas, 1), toInt(b.min_trab_dia, 480), toNum(b.efic_padrao, 0.8), toInt(b.prazo_padrao, 3),
        b.situacao || 'Ativa', b.observacao || null, getUser(c)).run();
    await audit(c, MOD, 'INS', `terc:${r.meta.last_row_id}`, 'nome_terc', '', b.nome_terc);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe terceirizado com esse nome', 409);
    return fail(String(e));
  }
});

app.put('/terc/terceirizados/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare(`
    UPDATE terc_terceirizados
    SET nome_terc=?, id_setor=?, cpf_cnpj=?, telefone=?, email=?, endereco=?,
        qtd_pessoas=?, min_trab_dia=?, efic_padrao=?, prazo_padrao=?, situacao=?, observacao=?, ativo=?
    WHERE id_terc=?`)
    .bind(b.nome_terc, toInt(b.id_setor) || null, b.cpf_cnpj || null, b.telefone || null, b.email || null, b.endereco || null,
      toInt(b.qtd_pessoas, 1), toInt(b.min_trab_dia, 480), toNum(b.efic_padrao, 0.8), toInt(b.prazo_padrao, 3),
      b.situacao || 'Ativa', b.observacao || null, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `terc:${id}`);
  return c.json(ok({ id }));
});

app.delete('/terc/terceirizados/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const uso = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_remessas WHERE id_terc=?').bind(id).first<any>();
  if (uso && uso.c > 0) {
    const t = await c.env.DB.prepare('SELECT nome_terc FROM terc_terceirizados WHERE id_terc=?').bind(id).first<any>();
    return fail(`Não é possível excluir: ${t?.nome_terc || 'Terceirizado'} possui ${uso.c} remessa(s). Use "Inativar" para desativar.`, 409);
  }
  await c.env.DB.prepare('DELETE FROM terc_terceirizados WHERE id_terc=?').bind(id).run();
  await audit(c, MOD, 'DEL', `terc:${id}`);
  return c.json(ok({ id, deleted: true }));
});

app.patch('/terc/terceirizados/:id/situacao', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const s = b.situacao || 'Ativa';
  await c.env.DB.prepare('UPDATE terc_terceirizados SET situacao=?, ativo=? WHERE id_terc=?')
    .bind(s, s === 'Ativa' ? 1 : 0, id).run();
  await audit(c, MOD, 'ATIV', `terc:${id}`, 'situacao', '', s);
  return c.json(ok({ id, situacao: s }));
});

/* =================================================================
 * PREÇOS
 * ================================================================= */

app.get('/terc/precos', async (c) => {
  const q = c.req.query();
  const where: string[] = ['p.ativo=1']; const binds: any[] = [];
  if (q.cod_ref)    { where.push('p.cod_ref=?');    binds.push(q.cod_ref); }
  if (q.id_servico) { where.push('p.id_servico=?'); binds.push(toInt(q.id_servico)); }
  if (q.id_colecao) { where.push('p.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.cor != null && q.cor !== '')         { where.push('p.cor=?');     binds.push(q.cor); }
  if (q.tamanho != null && q.tamanho !== '') { where.push('p.tamanho=?'); binds.push(q.tamanho); }
  if (q.search) {
    where.push('(p.cod_ref LIKE ? OR p.desc_ref LIKE ? OR p.cor LIKE ? OR p.tamanho LIKE ?)');
    const s = `%${q.search}%`; binds.push(s, s, s, s);
  }
  const rs = await c.env.DB.prepare(`
    SELECT p.*, s.desc_servico, co.nome_colecao
    FROM terc_precos p
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao
    WHERE ${where.join(' AND ')}
    ORDER BY p.cod_ref, p.cor, p.tamanho, p.id_servico
    LIMIT 1000`).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.post('/terc/precos', async (c) => {
  const b = await c.req.json();
  // Aceita id_produto -> deriva cod_ref + desc_ref + id_colecao
  if (b.id_produto) {
    const p = await c.env.DB.prepare('SELECT cod_ref, desc_ref, id_colecao FROM terc_produtos WHERE id_produto=?').bind(toInt(b.id_produto)).first<any>();
    if (p) {
      b.cod_ref = b.cod_ref || p.cod_ref;
      b.desc_ref = b.desc_ref || p.desc_ref;
      if (!b.id_colecao) b.id_colecao = p.id_colecao;
    }
  }
  if (!b.id_servico) return fail('Serviço é obrigatório');
  if (!b.cod_ref && !b.desc_ref) return fail('Informe a referência ou descrição do produto');
  if (!b.cod_ref) {
    b.cod_ref = String(b.desc_ref).toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
  }
  const cor     = String(b.cor ?? '').trim();
  const tamanho = String(b.tamanho ?? '').trim();
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_precos (cod_ref, desc_ref, id_servico, grade, cor, tamanho, preco, tempo_min, id_colecao, dt_vigencia, observacao, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(b.cod_ref, b.desc_ref || null, toInt(b.id_servico), toInt(b.grade, 1),
        cor, tamanho,
        toNum(b.preco), toNum(b.tempo_min), toInt(b.id_colecao) || null,
        b.dt_vigencia || null, b.observacao || null).run();
    await audit(c, MOD, 'INS', `preco:${r.meta.last_row_id}`, 'preco', '', String(b.preco));
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return fail(`Já existe preço cadastrado para esta combinação (Produto + Cor + Grade + Serviço${b.id_colecao ? ' + Coleção' : ''}).`, 409);
    }
    return fail(String(e));
  }
});

app.put('/terc/precos/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const cor     = String(b.cor ?? '').trim();
  const tamanho = String(b.tamanho ?? '').trim();
  try {
    await c.env.DB.prepare(`
      UPDATE terc_precos
         SET cod_ref=?, desc_ref=?, id_servico=?, grade=?, cor=?, tamanho=?,
             preco=?, tempo_min=?, id_colecao=?, dt_vigencia=?, observacao=?, ativo=?,
             dt_alteracao=datetime('now'), alterado_por=?
       WHERE id_preco=?`)
      .bind(b.cod_ref, b.desc_ref || null, toInt(b.id_servico), toInt(b.grade, 1),
        cor, tamanho,
        toNum(b.preco), toNum(b.tempo_min), toInt(b.id_colecao) || null,
        b.dt_vigencia || null, b.observacao || null, b.ativo ? 1 : 0,
        getUser(c), id).run();
    await audit(c, MOD, 'UPD', `preco:${id}`);
    return c.json(ok({ id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return fail('Já existe outro preço com a mesma combinação (Produto + Cor + Grade + Serviço).', 409);
    }
    return fail(String(e));
  }
});

app.delete('/terc/precos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_precos WHERE id_preco=?').bind(id).run();
  await audit(c, MOD, 'DEL', `preco:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// 🚨 Excluir TODOS os preços com confirmação dupla
app.delete('/terc/precos', async (c) => {
  const q = c.req.query();
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const c1 = String(q.confirm1 || body.confirm1 || '');
  const c2 = String(q.confirm2 || body.confirm2 || '');
  if (c1 !== 'SIM' || c2 !== 'EXCLUIR-TODOS') {
    return fail('Confirmação dupla obrigatória: confirm1=SIM e confirm2=EXCLUIR-TODOS', 400);
  }
  const cnt = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM terc_precos').first<any>();
  await c.env.DB.prepare('DELETE FROM terc_precos').run();
  await audit(c, MOD, 'DEL_ALL', 'precos', 'total', String(cnt?.n || 0), '0');
  return c.json(ok({ deleted: Number(cnt?.n) || 0 }));
});

// Busca de preço tabelado (autofill nas remessas) — agora considera COR + TAMANHO
// Prioridade:
//   1) Produto + Cor + Tamanho + Serviço (mais específico)
//   2) Produto + Cor + Serviço
//   3) Produto + Serviço
//   4) Serviço padrão (qualquer produto cod_ref='*')
app.get('/terc/precos/lookup', async (c) => {
  const q = c.req.query();
  const cod = String(q.cod_ref || '').trim();
  const idsv = toInt(q.id_servico);
  const cor = String(q.cor || '').trim();
  const tam = String(q.tamanho || '').trim();
  const grd = toInt(q.grade, 1);
  const idcol = toInt(q.id_colecao) || null;
  if (!cod || !idsv) return fail('cod_ref e id_servico são obrigatórios');

  // Helper de busca pré-ordenada
  const tryQ = async (sql: string, ...binds: any[]) =>
    c.env.DB.prepare(sql).bind(...binds).first<any>();

  // Nível 1: Produto+Cor+Tamanho+Serviço (com ou sem coleção)
  let r = null as any;
  if (cor && tam) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'produto+cor+grade+servico' AS match_level
      FROM terc_precos
      WHERE cod_ref=? AND id_servico=? AND cor=? AND tamanho=? AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END
      LIMIT 1`, cod, idsv, cor, tam, idcol, idcol);
  }
  // Nível 2: Produto+Cor+Serviço
  if (!r && cor) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'produto+cor+servico' AS match_level
      FROM terc_precos
      WHERE cod_ref=? AND id_servico=? AND cor=? AND (tamanho='' OR tamanho IS NULL) AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END
      LIMIT 1`, cod, idsv, cor, idcol, idcol);
  }
  // Nível 3: Produto+Serviço (sem cor, sem tamanho)
  if (!r) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'produto+servico' AS match_level
      FROM terc_precos
      WHERE cod_ref=? AND id_servico=? AND (cor='' OR cor IS NULL) AND (tamanho='' OR tamanho IS NULL) AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END
      LIMIT 1`, cod, idsv, idcol, idcol);
  }
  // Nível 4: Serviço padrão (qualquer produto), grade=grd
  if (!r) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'servico_padrao' AS match_level
      FROM terc_precos
      WHERE cod_ref='*' AND id_servico=? AND ativo=1
      LIMIT 1`, idsv);
  }
  // Compatibilidade: ainda inclui campo grade legado se existir match
  return c.json(ok(r || null));
});

/* =================================================================
 * VARIAÇÕES DE PRODUTO (cor + grade) — CRUD por produto
 * ================================================================= */

// Lista variações de um produto
app.get('/terc/produtos/:id/variacoes', async (c) => {
  const idProd = toInt(c.req.param('id'));
  const rs = await c.env.DB.prepare(
    'SELECT * FROM terc_produto_variacoes WHERE id_produto=? AND ativo=1 ORDER BY cor, tamanho'
  ).bind(idProd).all();
  return c.json(ok(rs.results));
});

// Cria variação (id_produto, cor, tamanho)
app.post('/terc/produtos/:id/variacoes', async (c) => {
  const idProd = toInt(c.req.param('id'));
  const b = await c.req.json();
  const cor = String(b.cor ?? '').trim();
  const tam = String(b.tamanho ?? '').trim();
  if (!cor && !tam) return fail('Informe ao menos cor ou tamanho');
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO terc_produto_variacoes (id_produto, cor, tamanho) VALUES (?, ?, ?)'
    ).bind(idProd, cor, tam).run();
    await audit(c, MOD, 'INS', `variacao:${r.meta.last_row_id}`, 'cor+tam', '', `${cor}|${tam}`);
    return c.json(ok({ id: r.meta.last_row_id, cor, tamanho: tam }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Esta variação (cor + tamanho) já existe para este produto.', 409);
    return fail(String(e));
  }
});

// Inserção em LOTE: cores[] × tamanhos[] (gera todas as combinações)
app.post('/terc/produtos/:id/variacoes/lote', async (c) => {
  const idProd = toInt(c.req.param('id'));
  const b = await c.req.json();
  const cores: string[] = Array.isArray(b.cores) ? b.cores.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const tams:  string[] = Array.isArray(b.tamanhos) ? b.tamanhos.map((x: any) => String(x).trim()).filter(Boolean) : [];
  if (cores.length === 0 && tams.length === 0) return fail('Informe ao menos uma cor ou um tamanho');

  const combos: { cor: string; tam: string }[] = [];
  if (cores.length && tams.length) {
    for (const c1 of cores) for (const t1 of tams) combos.push({ cor: c1, tam: t1 });
  } else if (cores.length) {
    for (const c1 of cores) combos.push({ cor: c1, tam: '' });
  } else {
    for (const t1 of tams) combos.push({ cor: '', tam: t1 });
  }

  let criados = 0, ignorados = 0;
  for (const x of combos) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO terc_produto_variacoes (id_produto, cor, tamanho) VALUES (?, ?, ?)'
      ).bind(idProd, x.cor, x.tam).run();
      criados++;
    } catch { ignorados++; }
  }
  await audit(c, MOD, 'INS_LOTE', `produto:${idProd}`, 'variacoes', '', `+${criados} (${ignorados} já existiam)`);
  return c.json(ok({ criados, ignorados, total: combos.length }));
});

app.delete('/terc/produtos/:id/variacoes/:idv', async (c) => {
  const idv = toInt(c.req.param('idv'));
  await c.env.DB.prepare('DELETE FROM terc_produto_variacoes WHERE id_var=?').bind(idv).run();
  await audit(c, MOD, 'DEL', `variacao:${idv}`);
  return c.json(ok({ id: idv, deleted: true }));
});

/* =================================================================
 * CATÁLOGO DE CORES (reutilizável)
 * ================================================================= */

app.get('/terc/cores', async (c) => {
  const rs = await c.env.DB.prepare(
    'SELECT id_cor, nome_cor, hex, ativo FROM terc_cores WHERE ativo=1 ORDER BY nome_cor'
  ).all();
  return c.json(ok(rs.results));
});

app.post('/terc/cores', async (c) => {
  const b = await c.req.json();
  const nome = String(b.nome_cor ?? '').trim();
  if (!nome) return fail('Nome da cor obrigatório');
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO terc_cores (nome_cor, hex) VALUES (?, ?)'
    ).bind(nome, b.hex || null).run();
    await audit(c, MOD, 'INS', `cor:${r.meta.last_row_id}`, 'nome', '', nome);
    return c.json(ok({ id: r.meta.last_row_id, nome_cor: nome }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Esta cor já existe', 409);
    return fail(String(e));
  }
});

app.delete('/terc/cores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('UPDATE terc_cores SET ativo=0 WHERE id_cor=?').bind(id).run();
  await audit(c, MOD, 'DEL', `cor:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * IMPORTAÇÃO DE PLANILHA (Cor + Preço + Grade)
 *   Recebe: { rows: [{cod_ref, desc_ref, cor, tamanho, servico, preco, tempo}, ...],
 *             modo: 'criar' | 'atualizar' | 'simular',
 *             id_colecao: number | null }
 *   Retorna: { criados, atualizados, ignorados, erros: [], simulado: bool }
 * ================================================================= */
app.post('/terc/precos/importar', async (c) => {
  const b = await c.req.json();
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  const modo = String(b.modo || 'atualizar').toLowerCase(); // criar|atualizar|simular
  const idColecao = toInt(b.id_colecao) || null;
  if (rows.length === 0) return fail('Nenhuma linha para importar');

  // Pré-carrega serviços para mapear nome → id
  const svRows = await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos').all();
  const svMap = new Map<string, number>();
  for (const sv of (svRows.results as any[])) {
    svMap.set(String(sv.desc_servico || '').toLowerCase().trim(), Number(sv.id_servico));
  }

  let criados = 0, atualizados = 0, ignorados = 0;
  const erros: { linha: number; motivo: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const lineNo = i + 1;
    try {
      const cod_ref  = String(row.cod_ref ?? row.referencia ?? row.ref ?? '').trim();
      const desc_ref = String(row.desc_ref ?? row.descricao ?? '').trim();
      const cor      = String(row.cor ?? '').trim();
      const tamanho  = String(row.tamanho ?? row.grade ?? '').trim();
      const svRaw    = String(row.servico ?? row.desc_servico ?? '').trim();
      const preco    = toNum(row.preco);
      const tempo    = toNum(row.tempo ?? row.tempo_min);

      if (!cod_ref) { erros.push({ linha: lineNo, motivo: 'Referência vazia' }); ignorados++; continue; }
      if (!svRaw)   { erros.push({ linha: lineNo, motivo: 'Serviço vazio' });   ignorados++; continue; }
      const idSv = svMap.get(svRaw.toLowerCase());
      if (!idSv)    { erros.push({ linha: lineNo, motivo: `Serviço "${svRaw}" não cadastrado` }); ignorados++; continue; }

      // Procura preço existente pela chave de negócio
      const existing = await c.env.DB.prepare(`
        SELECT id_preco FROM terc_precos
        WHERE cod_ref=? AND id_servico=? AND COALESCE(cor,'')=? AND COALESCE(tamanho,'')=?
          AND COALESCE(id_colecao,0)=COALESCE(?,0)
        LIMIT 1`)
        .bind(cod_ref, idSv, cor, tamanho, idColecao).first<any>();

      if (modo === 'simular') {
        if (existing) atualizados++; else criados++;
        continue;
      }

      if (existing && (modo === 'atualizar' || modo === 'criar')) {
        if (modo === 'criar') { ignorados++; continue; } // modo criar: pula existentes
        await c.env.DB.prepare(`
          UPDATE terc_precos SET desc_ref=COALESCE(NULLIF(?, ''), desc_ref),
                                  preco=?, tempo_min=?, ativo=1,
                                  dt_alteracao=datetime('now'), alterado_por=?
           WHERE id_preco=?`)
          .bind(desc_ref, preco, tempo, getUser(c), existing.id_preco).run();
        atualizados++;
      } else {
        // Não existe → cria (mesmo no modo 'atualizar' criamos os faltantes)
        await c.env.DB.prepare(`
          INSERT INTO terc_precos (cod_ref, desc_ref, id_servico, grade, cor, tamanho,
                                   preco, tempo_min, id_colecao, ativo)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 1)`)
          .bind(cod_ref, desc_ref || null, idSv, cor, tamanho, preco, tempo, idColecao).run();
        criados++;

        // Garantir produto e variação correspondente
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO terc_produtos (cod_ref, desc_ref, id_colecao, ativo)
          VALUES (?, ?, ?, 1)`)
          .bind(cod_ref, desc_ref || cod_ref, idColecao).run();
        const prod = await c.env.DB.prepare(
          'SELECT id_produto FROM terc_produtos WHERE cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0) LIMIT 1'
        ).bind(cod_ref, idColecao).first<any>();
        if (prod && (cor || tamanho)) {
          await c.env.DB.prepare(
            'INSERT OR IGNORE INTO terc_produto_variacoes (id_produto, cor, tamanho) VALUES (?, ?, ?)'
          ).bind(prod.id_produto, cor, tamanho).run().catch(() => {});
        }
      }
    } catch (e: any) {
      erros.push({ linha: lineNo, motivo: String(e?.message || e) });
      ignorados++;
    }
  }

  await audit(c, MOD, 'IMPORT_PRECOS', 'precos', 'totais', '',
    `criados:${criados} atualizados:${atualizados} ignorados:${ignorados} modo:${modo}`);
  return c.json(ok({
    criados, atualizados, ignorados,
    erros: erros.slice(0, 50),
    total_erros: erros.length,
    simulado: modo === 'simular',
    modo,
  }));
});

/* =================================================================
 * REMESSAS
 * ================================================================= */

// Calcula previsão de retorno = dt_saida + ceil(qtd × tempo_peca / (qtd_pessoas × min_trab × efic)) dias úteis
function calcPrevisao(dt_saida: string, qtd: number, tempo: number, pess: number, min_dia: number, efic: number): { dias: number, dt_prev: string } {
  if (!dt_saida || qtd <= 0 || tempo <= 0) return { dias: 0, dt_prev: dt_saida || '' };
  const capacidadeMin = Math.max(1, pess) * Math.max(1, min_dia) * Math.max(0.1, efic);
  const totalMin = qtd * tempo;
  const dias = Math.max(1, Math.ceil(totalMin / capacidadeMin));
  const d = new Date(dt_saida + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  const iso = d.toISOString().slice(0, 10);
  return { dias, dt_prev: iso };
}

// Próximo número de controle
app.get('/terc/remessas/next-num', async (c) => {
  const r = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas').first<any>();
  return c.json(ok({ num_controle: r?.n || 1 }));
});

// Lista (atualiza status Atrasado automaticamente conforme dt_previsao)
app.get('/terc/remessas', async (c) => {
  const q = c.req.query();

  // 🔁 Atualização automática de status atrasado (idempotente)
  await c.env.DB.prepare(`
    UPDATE terc_remessas
    SET status='Atrasado'
    WHERE status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial')
      AND dt_previsao IS NOT NULL
      AND date(dt_previsao) < date('now')`).run();

  const where: string[] = []; const binds: any[] = [];
  if (q.status) { where.push('r.status=?'); binds.push(q.status); }
  if (q.status_fin) { where.push('r.status_fin=?'); binds.push(q.status_fin); }
  if (q.id_terc) { where.push('r.id_terc=?'); binds.push(toInt(q.id_terc)); }
  if (q.id_servico) { where.push('r.id_servico=?'); binds.push(toInt(q.id_servico)); }
  if (q.id_colecao) { where.push('r.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.de) { where.push('r.dt_saida>=?'); binds.push(q.de); }
  if (q.ate) { where.push('r.dt_saida<=?'); binds.push(q.ate); }
  if (q.cod_ref) { where.push('r.cod_ref=?'); binds.push(q.cod_ref); }
  if (q.num_op) { where.push('r.num_op=?'); binds.push(q.num_op); }
  if (q.atrasadas) { where.push("r.status='Atrasado'"); }
  if (q.em_producao) { where.push("r.status IN ('Enviado','EmProducao')"); }
  if (q.search) { where.push('(r.cod_ref LIKE ? OR r.desc_ref LIKE ? OR r.num_op LIKE ? OR r.cor LIKE ? OR t.nome_terc LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }

  const sql = `
    SELECT r.*,
      t.nome_terc, st.nome_setor, sv.desc_servico, co.nome_colecao,
      COALESCE((SELECT SUM(qtd_boa)+SUM(qtd_refugo)+SUM(qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa),0) AS qtd_retornada_calc,
      CASE WHEN r.status='Atrasado' THEN 1 ELSE 0 END AS atrasada,
      CAST(julianday(date('now')) - julianday(date(r.dt_previsao)) AS INTEGER) AS dias_atraso,
      CAST(julianday(date(r.dt_previsao)) - julianday(date('now')) AS INTEGER) AS dias_para_vencer
    FROM terc_remessas r
    LEFT JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    LEFT JOIN terc_colecoes co ON co.id_colecao=r.id_colecao
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.dt_saida DESC, r.num_controle DESC
    LIMIT 500`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

// Detalhe de uma remessa (com grade + retornos)
app.get('/terc/remessas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const rem = await c.env.DB.prepare(`
    SELECT r.*, t.nome_terc, st.nome_setor, sv.desc_servico, co.nome_colecao
    FROM terc_remessas r
    LEFT JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    LEFT JOIN terc_colecoes co ON co.id_colecao=r.id_colecao
    WHERE r.id_remessa=?`).bind(id).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const grade = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=?').bind(id).all()).results as any[];
  const retornos = (await c.env.DB.prepare(`
    SELECT r.*,
      (SELECT json_group_array(json_object('tamanho', tamanho, 'qtd', qtd)) FROM terc_retorno_grade WHERE id_retorno=r.id_retorno) AS grade_json
    FROM terc_retornos r WHERE id_remessa=? ORDER BY dt_retorno`).bind(id).all()).results as any[];
  const retornosParsed = retornos.map((r: any) => {
    let g = [];
    try { g = JSON.parse(r.grade_json || '[]'); } catch {}
    return { ...r, grade: g };
  });

  // Totais retornados
  const totRet = retornosParsed.reduce((a: any, x: any) => ({
    boa: a.boa + (Number(x.qtd_boa) || 0),
    refugo: a.refugo + (Number(x.qtd_refugo) || 0),
    conserto: a.conserto + (Number(x.qtd_conserto) || 0),
    total: a.total + (Number(x.qtd_total) || 0),
    valor: a.valor + (Number(x.valor_pago) || 0),
  }), { boa: 0, refugo: 0, conserto: 0, total: 0, valor: 0 });

  return c.json(ok({ ...rem, grade, retornos: retornosParsed, totais_retorno: totRet, saldo: (Number(rem.qtd_total) || 0) - totRet.total }));
});

// Criar remessa — MODO BÁSICO automação total (preço, prazo, valor, eficiência)
// Usuário precisa apenas: id_terc + id_servico + qtd (ou grade)
// Modo avançado: aceita override manual de preco_unit, tempo_peca, prazo_dias, efic_pct
app.post('/terc/remessas', async (c) => {
  const b = await c.req.json();
  if (!b.id_terc || !b.id_servico) return fail('Terceirizado e serviço são obrigatórios');

  // Quantidade pode vir da grade ou de qtd_total direto
  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0) || toInt(b.qtd_total);
  if (qtd_total <= 0) return fail('Quantidade total deve ser maior que zero');

  // 🤖 Busca terceirizado (parâmetros automáticos)
  const t = await c.env.DB.prepare('SELECT id_setor, qtd_pessoas, min_trab_dia, efic_padrao, prazo_padrao FROM terc_terceirizados WHERE id_terc=?').bind(toInt(b.id_terc)).first<any>();
  if (!t) return fail('Terceirizado não encontrado', 404);

  const pess = toInt(b.qtd_pessoas, t.qtd_pessoas || 1);
  const min_dia = toInt(b.min_trab_dia, t.min_trab_dia || 480);
  const efic = toNum(b.efic_pct, t.efic_padrao || 0.8);

  // 🤖 Preço automático: busca tabela terc_precos por (cod_ref + id_servico + grade + colecao)
  let preco = toNum(b.preco_unit);
  let tempo = toNum(b.tempo_peca);
  let descRef = b.desc_ref || null;
  let codRef = b.cod_ref;
  const gradeNum = toInt(b.grade, 1);

  if (codRef) {
    const lookupSql = `
      SELECT preco, tempo_min, desc_ref FROM terc_precos
      WHERE cod_ref=? AND id_servico=? AND grade=? AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END LIMIT 1`;
    const found = await c.env.DB.prepare(lookupSql)
      .bind(codRef, toInt(b.id_servico), gradeNum, toInt(b.id_colecao) || null, toInt(b.id_colecao) || null)
      .first<any>();
    if (found) {
      if (!preco) preco = Number(found.preco) || 0;
      if (!tempo) tempo = Number(found.tempo_min) || 0;
      if (!descRef) descRef = found.desc_ref;
    }
  }

  // 🤖 Valor total automático
  const valor = qtd_total * preco;

  // 🤖 Prazo automático: prazo_padrao do terceirizado, ou cálculo por capacidade
  const prazo = toInt(b.prazo_dias, t.prazo_padrao || 0);
  const dt_saida = b.dt_saida || new Date().toISOString().slice(0, 10);

  let dt_prev: string;
  let diasFinal = prazo;
  if (prazo > 0) {
    const d = new Date(dt_saida + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + prazo);
    dt_prev = d.toISOString().slice(0, 10);
  } else {
    const r = calcPrevisao(dt_saida, qtd_total, tempo, pess, min_dia, efic);
    diasFinal = r.dias; dt_prev = r.dt_prev;
  }

  // Próximo número de controle (sequencial)
  const nextN = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas').first<any>();
  const num_controle = toInt(b.num_controle) || nextN?.n || 1;

  // Status inicial: AguardandoEnvio (se sem dt_envio) ou Enviado
  const status_inicial = b.dt_envio ? 'Enviado' : (b.status || 'AguardandoEnvio');

  const r = await c.env.DB.prepare(`
    INSERT INTO terc_remessas
      (num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref, id_servico, cor, grade,
       qtd_total, preco_unit, valor_total, id_colecao, dt_saida, dt_envio, dt_inicio, dt_previsao,
       prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia,
       status, status_fin, modo, observacao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(num_controle, b.num_op || null, toInt(b.id_terc), toInt(b.id_setor) || t.id_setor || null,
      codRef || '', descRef, toInt(b.id_servico), b.cor || null, gradeNum,
      qtd_total, preco, valor, toInt(b.id_colecao) || null,
      dt_saida, b.dt_envio || null, b.dt_inicio || null, dt_prev,
      diasFinal, tempo, efic, pess, min_dia,
      status_inicial, 'NaoFaturado', b.modo || 'basico', b.observacao || null, getUser(c)).run();

  const idR = r.meta.last_row_id;

  // Grade detalhada
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(idR, g.tamanho, toInt(g.qtd)).run();
    }
  }

  // Evento de criação
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'CRIADA', ?, ?)`)
    .bind(idR, `Remessa ${num_controle} criada — ${qtd_total} pç @ R$ ${preco.toFixed(2)}`, getUser(c)).run();

  await audit(c, MOD, 'INS_REM', `remessa:${idR}`, 'num_controle', '', String(num_controle));
  return c.json(ok({
    id: idR, num_controle, dt_previsao: dt_prev, prazo_dias: diasFinal,
    valor_total: valor, preco_unit: preco, tempo_peca: tempo, status: status_inicial,
    auto: { preco_buscado: preco > 0 && !toNum(b.preco_unit), tempo_buscado: tempo > 0 && !toNum(b.tempo_peca) }
  }));
});

// Atualizar remessa
app.put('/terc/remessas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0) || toInt(b.qtd_total);
  const preco = toNum(b.preco_unit);
  const valor = qtd_total * preco;

  const pess = toInt(b.qtd_pessoas, 1);
  const min_dia = toInt(b.min_trab_dia, 480);
  const efic = toNum(b.efic_pct, 0.8);
  const tempo = toNum(b.tempo_peca);
  const prazo = toInt(b.prazo_dias);
  let { dias, dt_prev } = calcPrevisao(b.dt_saida, qtd_total, tempo, pess, min_dia, efic);
  if (prazo > 0) {
    const d = new Date(b.dt_saida + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + prazo);
    dt_prev = d.toISOString().slice(0, 10);
  }

  await c.env.DB.prepare(`
    UPDATE terc_remessas SET num_op=?, id_terc=?, id_setor=?, cod_ref=?, desc_ref=?, id_servico=?, cor=?, grade=?,
      qtd_total=?, preco_unit=?, valor_total=?, id_colecao=?, dt_saida=?, dt_inicio=?, dt_previsao=?, prazo_dias=?,
      tempo_peca=?, efic_pct=?, qtd_pessoas=?, min_trab_dia=?, status=?, observacao=?, alterado_por=?, dt_alteracao=datetime('now')
    WHERE id_remessa=?`)
    .bind(b.num_op || null, toInt(b.id_terc), toInt(b.id_setor) || null, b.cod_ref, b.desc_ref || null,
      toInt(b.id_servico), b.cor || null, toInt(b.grade, 1), qtd_total, preco, valor,
      toInt(b.id_colecao) || null, b.dt_saida, b.dt_inicio || b.dt_saida, dt_prev, prazo > 0 ? prazo : dias,
      tempo, efic, pess, min_dia, b.status || 'AguardandoEnvio', b.observacao || null, getUser(c), id).run();

  // Regrava grade
  await c.env.DB.prepare('DELETE FROM terc_remessa_grade WHERE id_remessa=?').bind(id).run();
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(id, g.tamanho, toInt(g.qtd)).run();
    }
  }
  await audit(c, MOD, 'UPD_REM', `remessa:${id}`);
  return c.json(ok({ id, dt_previsao: dt_prev, valor_total: valor }));
});

// Excluir remessa
// Comportamento (refator 2026‑05‑04):
//   - Por padrão (sem retornos), exclui completamente (HARD DELETE).
//   - Se a remessa possui retornos, exige confirmação explícita pelo cliente:
//        ?confirm=SIM ou body { confirm: 'SIM' }
//        E permite escolher modo: ?modo=cascata (apaga retornos+remessa) ou ?modo=soft
//        (mantém retornos, marca a remessa como Cancelada — preserva histórico).
//   - Sem confirmação retorna 409 com contagem de retornos para o front mostrar modal.
app.delete('/terc/remessas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const q = c.req.query();
  let body: any = {};
  try { body = await c.req.json(); } catch { /* sem body é OK */ }
  const confirm = String(q.confirm || body.confirm || '').toUpperCase();
  const modo = String(q.modo || body.modo || 'cascata').toLowerCase(); // cascata | soft

  const rem = await c.env.DB.prepare('SELECT id_remessa, num_controle, status FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const nRet = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_retornos WHERE id_remessa=?').bind(id).first<any>();
  const totalRet = Number(nRet?.c) || 0;

  // Se possui retornos e não houve confirmação explícita, devolve 409 com contexto
  if (totalRet > 0 && confirm !== 'SIM') {
    return c.json({
      ok: false,
      code: 'NEEDS_CONFIRMATION',
      error: `Esta remessa possui ${totalRet} retorno(s) vinculado(s). Escolha uma opção.`,
      retornos: totalRet,
      num_controle: rem.num_controle,
    }, 409);
  }

  if (modo === 'soft' && totalRet > 0) {
    // Soft delete: mantém retornos e remessa, mas cancela
    await c.env.DB.prepare("UPDATE terc_remessas SET status='Cancelada', status_fin='NaoFaturado' WHERE id_remessa=?").bind(id).run();
    await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'CANCELADA', ?, ?)`)
      .bind(id, `Remessa cancelada (soft delete) — preserva ${totalRet} retorno(s).`, getUser(c)).run();
    await audit(c, MOD, 'CANCEL_REM', `remessa:${id}`, 'status', rem.status || '', 'Cancelada');
    return c.json(ok({ id, deleted: false, soft: true, status_remessa: 'Cancelada', retornos_preservados: totalRet }));
  }

  // Hard delete em cascata: apaga retornos, grade de retornos, eventos e a remessa
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_retorno IN (SELECT id_retorno FROM terc_retornos WHERE id_remessa=?)').bind(id).run();
  await c.env.DB.prepare('DELETE FROM terc_retornos WHERE id_remessa=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM terc_eventos WHERE id_remessa=?').bind(id).run().catch(() => {});
  await c.env.DB.prepare('DELETE FROM terc_remessa_grade WHERE id_remessa=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM terc_remessas WHERE id_remessa=?').bind(id).run();
  await audit(c, MOD, 'DEL_REM', `remessa:${id}`, 'retornos_apagados', '', String(totalRet));
  return c.json(ok({ id, deleted: true, retornos_apagados: totalRet }));
});

/* =================================================================
 * RETORNOS (podem existir múltiplos retornos parciais por remessa)
 * ================================================================= */

app.post('/terc/retornos', async (c) => {
  const b = await c.req.json();
  if (!b.id_remessa || !b.dt_retorno) return fail('id_remessa e dt_retorno são obrigatórios');

  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(toInt(b.id_remessa)).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total_grade = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
  const qtd_boa = toInt(b.qtd_boa, qtd_total_grade);
  const qtd_refugo = toInt(b.qtd_refugo);
  const qtd_conserto = toInt(b.qtd_conserto);
  const qtd_total = qtd_boa + qtd_refugo + qtd_conserto;
  if (qtd_total <= 0) return fail('Quantidade retornada deve ser maior que zero');

  // Valida se não excede remessa
  const jaRet = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=?').bind(toInt(b.id_remessa)).first<any>();
  const totalAposRetorno = (Number(jaRet?.s) || 0) + qtd_total;
  if (totalAposRetorno > Number(rem.qtd_total)) {
    return fail(`Quantidade excede a remessa. Remessa: ${rem.qtd_total}, já retornado: ${jaRet?.s || 0}, tentativa: ${qtd_total}`, 400);
  }

  const valor_pago = toNum(b.valor_pago, qtd_boa * Number(rem.preco_unit || 0));

  const r = await c.env.DB.prepare(`
    INSERT INTO terc_retornos (id_remessa, dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto, valor_pago, dt_pagamento, observacao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(toInt(b.id_remessa), b.dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto,
      valor_pago, b.dt_pagamento || null, b.observacao || null, getUser(c)).run();
  const idRet = r.meta.last_row_id;
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_retorno, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(idRet, g.tamanho, toInt(g.qtd)).run();
    }
  }

  // 🤖 Atualiza status da remessa + financeiro automático
  const completo = totalAposRetorno >= Number(rem.qtd_total);
  const novoStatus = completo ? 'Retornado' : 'Parcial';
  // Soma valor pago acumulado neste retorno
  const valorAcumulado = (Number(rem.valor_pago) || 0) + valor_pago;
  // Se completo: gera pendência financeira automática
  const novoStatusFin = completo ? 'PendentePagamento' : (rem.status_fin || 'NaoFaturado');

  await c.env.DB.prepare(`UPDATE terc_remessas SET status=?, status_fin=?, dt_recebimento=COALESCE(dt_recebimento, ?) WHERE id_remessa=?`)
    .bind(novoStatus, novoStatusFin, completo ? b.dt_retorno : null, toInt(b.id_remessa)).run();

  // Evento timeline
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, ?, ?, ?)`)
    .bind(toInt(b.id_remessa),
      completo ? 'RETORNO_TOTAL' : 'RETORNO_PARCIAL',
      `Retorno ${qtd_total} pç (boa: ${qtd_boa}, refugo: ${qtd_refugo}, conserto: ${qtd_conserto}) — R$ ${valor_pago.toFixed(2)}`,
      getUser(c)).run();

  await audit(c, MOD, 'INS_RET', `retorno:${idRet}`, 'qtd_total', '', String(qtd_total));
  return c.json(ok({
    id: idRet, status_remessa: novoStatus, status_fin: novoStatusFin,
    total_retornado: totalAposRetorno, saldo: Number(rem.qtd_total) - totalAposRetorno,
    valor_pago, valor_acumulado: valorAcumulado
  }));
});

// Editar retorno (PUT) — recalcula status da remessa e total pago
app.put('/terc/retornos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const ret = await c.env.DB.prepare('SELECT * FROM terc_retornos WHERE id_retorno=?').bind(id).first<any>();
  if (!ret) return fail('Retorno não encontrado', 404);
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(ret.id_remessa).first<any>();
  if (!rem) return fail('Remessa associada não encontrada', 404);

  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total_grade = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
  const qtd_boa = toInt(b.qtd_boa, qtd_total_grade);
  const qtd_refugo = toInt(b.qtd_refugo);
  const qtd_conserto = toInt(b.qtd_conserto);
  const qtd_total = qtd_boa + qtd_refugo + qtd_conserto;
  if (qtd_total <= 0) return fail('Quantidade retornada deve ser maior que zero');

  // Valida — soma dos demais retornos + este novo total não pode passar da remessa
  const outros = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=? AND id_retorno<>?'
  ).bind(ret.id_remessa, id).first<any>();
  const totalAposEdit = (Number(outros?.s) || 0) + qtd_total;
  if (totalAposEdit > Number(rem.qtd_total)) {
    return fail(
      `Quantidade excede a remessa. Remessa: ${rem.qtd_total}, outros retornos: ${outros?.s || 0}, tentativa: ${qtd_total}`,
      400,
    );
  }

  const dt_retorno = b.dt_retorno || ret.dt_retorno;
  const valor_pago = b.valor_pago != null && b.valor_pago !== ''
    ? toNum(b.valor_pago)
    : qtd_boa * Number(rem.preco_unit || 0);
  const dt_pagamento = b.dt_pagamento || null;
  const observacao = b.observacao != null ? b.observacao : ret.observacao;

  const valoresAntes = `boa:${ret.qtd_boa},ref:${ret.qtd_refugo},cons:${ret.qtd_conserto},val:${ret.valor_pago}`;
  const valoresDepois = `boa:${qtd_boa},ref:${qtd_refugo},cons:${qtd_conserto},val:${valor_pago}`;

  await c.env.DB.prepare(`
    UPDATE terc_retornos
       SET dt_retorno=?, qtd_total=?, qtd_boa=?, qtd_refugo=?, qtd_conserto=?,
           valor_pago=?, dt_pagamento=?, observacao=?
     WHERE id_retorno=?`)
    .bind(dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto,
      valor_pago, dt_pagamento, observacao, id).run();

  // Regrava grade do retorno
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_retorno=?').bind(id).run();
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_retorno, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(id, g.tamanho, toInt(g.qtd)).run();
    }
  }

  // 🤖 Reavalia status da remessa
  let novoStatus = (rem.dt_envio ? 'Enviado' : 'AguardandoEnvio');
  if (totalAposEdit > 0 && totalAposEdit < Number(rem.qtd_total)) novoStatus = 'Parcial';
  else if (totalAposEdit >= Number(rem.qtd_total)) novoStatus = 'Retornado';
  const novoStatusFin = totalAposEdit >= Number(rem.qtd_total) ? 'PendentePagamento' : 'NaoFaturado';
  const dt_recebimento = totalAposEdit >= Number(rem.qtd_total) ? dt_retorno : null;
  await c.env.DB.prepare(
    'UPDATE terc_remessas SET status=?, status_fin=?, dt_recebimento=COALESCE(?, dt_recebimento) WHERE id_remessa=?'
  ).bind(novoStatus, novoStatusFin, dt_recebimento, ret.id_remessa).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'RETORNO_EDITADO', ?, ?)`)
    .bind(ret.id_remessa, `Retorno #${id} editado (${valoresAntes} → ${valoresDepois})`, getUser(c)).run().catch(() => {});

  await audit(c, MOD, 'UPD_RET', `retorno:${id}`, 'totais', valoresAntes, valoresDepois);
  return c.json(ok({
    id, status_remessa: novoStatus, status_fin: novoStatusFin,
    total_retornado: totalAposEdit, saldo: Number(rem.qtd_total) - totalAposEdit,
    qtd_boa, qtd_refugo, qtd_conserto, qtd_total, valor_pago,
  }));
});

app.delete('/terc/retornos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const ret = await c.env.DB.prepare('SELECT * FROM terc_retornos WHERE id_retorno=?').bind(id).first<any>();
  if (!ret) return fail('Retorno não encontrado', 404);
  const valoresAntes = `boa:${ret.qtd_boa},ref:${ret.qtd_refugo},cons:${ret.qtd_conserto},val:${ret.valor_pago}`;
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_retorno=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM terc_retornos WHERE id_retorno=?').bind(id).run();

  // Reavaliar status da remessa
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(ret.id_remessa).first<any>();
  const sum = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=?').bind(ret.id_remessa).first<any>();
  const total = Number(sum?.s) || 0;
  let novoStatus = (rem.dt_envio ? 'Enviado' : 'AguardandoEnvio');
  if (total > 0 && total < Number(rem.qtd_total)) novoStatus = 'Parcial';
  else if (total >= Number(rem.qtd_total)) novoStatus = 'Retornado';
  // Reabre status financeiro se ficou abaixo do total
  const novoStatusFin = total >= Number(rem.qtd_total) ? 'PendentePagamento' : 'NaoFaturado';
  // Se ficou < total, limpa dt_recebimento (volta ao fluxo aberto)
  const limpaRecebimento = total < Number(rem.qtd_total);
  if (limpaRecebimento) {
    await c.env.DB.prepare('UPDATE terc_remessas SET status=?, status_fin=?, dt_recebimento=NULL WHERE id_remessa=?')
      .bind(novoStatus, novoStatusFin, ret.id_remessa).run();
  } else {
    await c.env.DB.prepare('UPDATE terc_remessas SET status=?, status_fin=? WHERE id_remessa=?')
      .bind(novoStatus, novoStatusFin, ret.id_remessa).run();
  }

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'RETORNO_EXCLUIDO', ?, ?)`)
    .bind(ret.id_remessa, `Retorno #${id} excluído (${valoresAntes})`, getUser(c)).run().catch(() => {});

  await audit(c, MOD, 'DEL_RET', `retorno:${id}`, 'totais', valoresAntes, '');
  return c.json(ok({
    id, deleted: true, status_remessa: novoStatus, status_fin: novoStatusFin,
    total_retornado: total, saldo: Number(rem.qtd_total) - total,
  }));
});

/* =================================================================
 * RESUMO DE TERCEIRIZAÇÕES (tela principal)
 * ================================================================= */

app.get('/terc/resumo', async (c) => {
  const q = c.req.query();
  const colFilter = q.id_colecao ? `AND r.id_colecao=${toInt(q.id_colecao)}` : '';

  const rs = await c.env.DB.prepare(`
    SELECT
      t.id_terc, t.nome_terc, t.situacao, t.prazo_padrao,
      s.nome_setor,
      COALESCE(SUM(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN (r.qtd_total - IFNULL((SELECT SUM(qtd_boa+qtd_refugo+qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa),0)) ELSE 0 END), 0) AS pecas_coletar,
      MAX(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN r.dt_previsao END) AS dt_termino,
      COALESCE(SUM(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN r.qtd_total ELSE 0 END), 0) AS pecas_producao,
      COALESCE((SELECT SUM(qtd_boa) FROM terc_retornos rt JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa WHERE rm.id_terc=t.id_terc ${colFilter}), 0) AS pecas_produzidas,
      COALESCE((SELECT SUM(qtd_conserto) FROM terc_retornos rt JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa WHERE rm.id_terc=t.id_terc ${colFilter}), 0) AS pecas_conserto,
      COALESCE((SELECT SUM(CASE WHEN c.status='Concluido' THEN c.qtd_retornada ELSE 0 END) FROM terc_consertos c WHERE c.id_terc=t.id_terc), 0) AS pecas_consertadas,
      COUNT(DISTINCT r.id_remessa) AS total_remessas,
      COALESCE(SUM(r.valor_total),0) AS valor_movimentado
    FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor
    LEFT JOIN terc_remessas r ON r.id_terc=t.id_terc ${colFilter}
    GROUP BY t.id_terc
    ORDER BY t.nome_terc`).all();

  const resumo = (rs.results as any[]).map((r: any) => ({
    ...r,
    indice_consertos: (Number(r.pecas_produzidas) || 0) > 0
      ? (Number(r.pecas_conserto) || 0) / (Number(r.pecas_produzidas) || 0)
      : 0,
  }));
  return c.json(ok(resumo));
});

/* =================================================================
 * DASHBOARD DE TERCEIRIZAÇÃO
 * ================================================================= */

app.get('/terc/dashboard', async (c) => {
  const q = c.req.query();
  const ini = q.de || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fim = q.ate || new Date().toISOString().slice(0, 10);

  // KPIs
  const kpiRem = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(qtd_total),0) AS pecas_enviadas,
      COALESCE(SUM(valor_total),0) AS valor_total,
      SUM(CASE WHEN status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial') THEN 1 ELSE 0 END) AS em_aberto,
      SUM(CASE WHEN status IN ('Concluido','Retornado','Pago') THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status='Atrasado' THEN 1 ELSE 0 END) AS atrasadas,
      SUM(CASE WHEN status='EmProducao' THEN 1 ELSE 0 END) AS em_producao,
      SUM(CASE WHEN status_fin='PendentePagamento' THEN (valor_total - COALESCE(valor_pago,0)) ELSE 0 END) AS valor_a_pagar,
      SUM(CASE WHEN status_fin='Pago' THEN COALESCE(valor_pago,0) ELSE 0 END) AS valor_pago_total
    FROM terc_remessas
    WHERE dt_saida BETWEEN ? AND ?`).bind(ini, fim).first<any>();

  const kpiRet = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(qtd_boa),0) AS pecas_boas,
      COALESCE(SUM(qtd_refugo),0) AS pecas_refugo,
      COALESCE(SUM(qtd_conserto),0) AS pecas_conserto,
      COALESCE(SUM(valor_pago),0) AS valor_pago
    FROM terc_retornos
    WHERE dt_retorno BETWEEN ? AND ?`).bind(ini, fim).first<any>();

  const topTerc = (await c.env.DB.prepare(`
    SELECT t.nome_terc, s.nome_setor,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor
    WHERE r.dt_saida BETWEEN ? AND ?
    GROUP BY t.id_terc
    ORDER BY pecas DESC
    LIMIT 10`).bind(ini, fim).all()).results;

  const porServico = (await c.env.DB.prepare(`
    SELECT sv.desc_servico,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.dt_saida BETWEEN ? AND ?
    GROUP BY sv.id_servico
    ORDER BY pecas DESC`).bind(ini, fim).all()).results;

  const producaoDiaria = (await c.env.DB.prepare(`
    SELECT date(rt.dt_retorno) AS dia,
      COALESCE(SUM(rt.qtd_boa),0) AS boa,
      COALESCE(SUM(rt.qtd_refugo),0) AS refugo,
      COALESCE(SUM(rt.qtd_conserto),0) AS conserto
    FROM terc_retornos rt
    WHERE rt.dt_retorno BETWEEN ? AND ?
    GROUP BY date(rt.dt_retorno)
    ORDER BY dia`).bind(ini, fim).all()).results;

  const atrasadas = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.num_op, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
      r.dt_saida, r.dt_previsao, r.status, r.valor_total,
      t.nome_terc, t.id_terc, sv.desc_servico,
      CAST(julianday('now') - julianday(r.dt_previsao) AS INTEGER) AS dias_atraso
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.status='Atrasado'
    ORDER BY dias_atraso DESC LIMIT 30`).all()).results;

  // 🆕 Em produção agora (Enviado + EmProducao)
  const emProducaoAgora = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
      r.dt_saida, r.dt_envio, r.dt_previsao, r.status, r.valor_total,
      t.nome_terc, t.id_terc, sv.desc_servico,
      CAST(julianday(r.dt_previsao) - julianday('now') AS INTEGER) AS dias_para_vencer
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.status IN ('Enviado','EmProducao')
    ORDER BY r.dt_previsao ASC LIMIT 30`).all()).results;

  // 🆕 Próximos vencimentos (7 dias)
  const proximosVencimentos = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.qtd_total,
      r.dt_previsao, r.status, r.valor_total,
      t.nome_terc, sv.desc_servico,
      CAST(julianday(r.dt_previsao) - julianday('now') AS INTEGER) AS dias_para_vencer
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial')
      AND date(r.dt_previsao) BETWEEN date('now') AND date('now', '+7 days')
    ORDER BY r.dt_previsao ASC LIMIT 20`).all()).results;

  // 🆕 Valores a pagar (status financeiro pendente)
  const valoresAPagar = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.qtd_total,
      r.dt_recebimento, r.valor_total, r.valor_pago, r.status_fin,
      (r.valor_total - COALESCE(r.valor_pago,0)) AS valor_aberto,
      t.nome_terc, t.id_terc
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    WHERE r.status_fin='PendentePagamento'
    ORDER BY r.dt_recebimento ASC, r.dt_saida ASC LIMIT 30`).all()).results;

  return c.json(ok({
    periodo: { de: ini, ate: fim },
    kpis: { remessas: kpiRem, retornos: kpiRet },
    top_terceirizados: topTerc,
    por_servico: porServico,
    producao_diaria: producaoDiaria,
    atrasadas,
    em_producao_agora: emProducaoAgora,
    proximos_vencimentos: proximosVencimentos,
    valores_a_pagar: valoresAPagar,
  }));
});

/* =================================================================
 * 🆕 FLUXO OPERACIONAL — transições de status (one-click)
 * ================================================================= */

// Marcar como ENVIADO (sai da fábrica para o terceirizado)
app.post('/terc/remessas/:id/enviar', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const dt = b.dt_envio || new Date().toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('SELECT id_remessa, status FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!r) return fail('Remessa não encontrada', 404);
  if (!['AguardandoEnvio'].includes(String(r.status))) return fail(`Status atual (${r.status}) não permite envio.`, 409);
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='Enviado', dt_envio=?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=?`)
    .bind(dt, getUser(c), id).run();
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'ENVIADA', ?, ?)`)
    .bind(id, `Remessa enviada em ${dt}`, getUser(c)).run();
  await audit(c, MOD, 'ENVIO', `remessa:${id}`, 'status', 'AguardandoEnvio', 'Enviado');
  return c.json(ok({ id, status: 'Enviado', dt_envio: dt }));
});

// Marcar EM PRODUÇÃO (terceirizado começou a produzir)
app.post('/terc/remessas/:id/iniciar-producao', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const dt = b.dt_inicio || new Date().toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('SELECT status FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!r) return fail('Remessa não encontrada', 404);
  if (!['Enviado','AguardandoEnvio'].includes(String(r.status))) return fail(`Status atual (${r.status}) não permite iniciar produção.`, 409);
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='EmProducao', dt_inicio=?, dt_envio=COALESCE(dt_envio, ?), alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=?`)
    .bind(dt, dt, getUser(c), id).run();
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'INICIO_PROD', ?, ?)`)
    .bind(id, `Produção iniciada em ${dt}`, getUser(c)).run();
  await audit(c, MOD, 'INICIO_PROD', `remessa:${id}`, 'status', String(r.status), 'EmProducao');
  return c.json(ok({ id, status: 'EmProducao', dt_inicio: dt }));
});

// Cancelar remessa
app.post('/terc/remessas/:id/cancelar', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare('SELECT status FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!r) return fail('Remessa não encontrada', 404);
  if (['Pago','Retornado','Concluido'].includes(String(r.status))) return fail(`Status atual (${r.status}) não permite cancelamento.`, 409);
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='Cancelado', status_fin='Cancelado', observacao=COALESCE(observacao,'') || ' | Cancelado: ' || ?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=?`)
    .bind(b.motivo || 'sem motivo', getUser(c), id).run();
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'CANCELADA', ?, ?)`)
    .bind(id, `Cancelada — ${b.motivo || ''}`, getUser(c)).run();
  await audit(c, MOD, 'CANCELAR', `remessa:${id}`);
  return c.json(ok({ id, status: 'Cancelado' }));
});

/* =================================================================
 * 🆕 RETORNO SIMPLIFICADO — Retornar tudo em 1 clique
 * ================================================================= */

// Retorna 100% como peças boas (tudo aprovado), preenchendo automaticamente
app.post('/terc/remessas/:id/retornar-tudo', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);
  if (['Cancelado','Pago'].includes(String(rem.status))) return fail(`Remessa em status ${rem.status} não permite retorno.`, 409);

  const jaRet = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=?').bind(id).first<any>();
  const saldo = Number(rem.qtd_total) - (Number(jaRet?.s) || 0);
  if (saldo <= 0) return fail('Não há saldo a retornar nesta remessa', 400);

  const dt = b.dt_retorno || new Date().toISOString().slice(0, 10);
  const valor = saldo * Number(rem.preco_unit || 0);

  // Insere o retorno completo
  const ins = await c.env.DB.prepare(`
    INSERT INTO terc_retornos (id_remessa, dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto, valor_pago, observacao, criado_por)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`)
    .bind(id, dt, saldo, saldo, valor, b.observacao || 'Retorno total automático', getUser(c)).run();
  const idRet = ins.meta.last_row_id;

  // Replica grade da remessa proporcional ao saldo
  const gradeRem = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=?').bind(id).all()).results as any[];
  const totalGrade = gradeRem.reduce((a, g) => a + (Number(g.qtd) || 0), 0);
  for (const g of gradeRem) {
    if (Number(g.qtd) > 0 && totalGrade > 0) {
      const qtd = Math.round((Number(g.qtd) / totalGrade) * saldo);
      if (qtd > 0) {
        await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_retorno, tamanho, qtd) VALUES (?, ?, ?)')
          .bind(idRet, g.tamanho, qtd).run();
      }
    }
  }

  // 🤖 Atualiza remessa: status Retornado + financeiro pendente
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='Retornado', status_fin='PendentePagamento', dt_recebimento=COALESCE(dt_recebimento, ?) WHERE id_remessa=?`)
    .bind(dt, id).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'RETORNO_TOTAL', ?, ?)`)
    .bind(id, `Retorno total automático: ${saldo} pç — R$ ${valor.toFixed(2)}`, getUser(c)).run();

  await audit(c, MOD, 'RET_TUDO', `remessa:${id}`, 'qtd_total', '', String(saldo));
  return c.json(ok({
    id_retorno: idRet, id_remessa: id,
    qtd_retornada: saldo, valor_pago: valor,
    status: 'Retornado', status_fin: 'PendentePagamento'
  }));
});

// Preview de retorno parcial pré-preenchido com saldo restante
app.get('/terc/remessas/:id/preview-retorno', async (c) => {
  const id = toInt(c.req.param('id'));
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);
  const jaRet = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=?').bind(id).first<any>();
  const saldo = Number(rem.qtd_total) - (Number(jaRet?.s) || 0);
  const grade = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=?').bind(id).all()).results as any[];
  const totalGrade = grade.reduce((a, g) => a + (Number(g.qtd) || 0), 0);
  const gradePreenchida = grade.map((g: any) => ({
    tamanho: g.tamanho,
    qtd_remessa: g.qtd,
    qtd_sugerida: totalGrade > 0 ? Math.round((Number(g.qtd) / totalGrade) * saldo) : 0,
  }));
  return c.json(ok({
    id_remessa: id, num_controle: rem.num_controle, cod_ref: rem.cod_ref,
    qtd_total_remessa: rem.qtd_total, qtd_ja_retornada: Number(jaRet?.s) || 0, saldo,
    preco_unit: rem.preco_unit, valor_estimado: saldo * Number(rem.preco_unit || 0),
    grade_sugerida: gradePreenchida,
  }));
});

/* =================================================================
 * 🆕 FINANCEIRO AUTOMÁTICO — pendente / pago
 * ================================================================= */

// Lista valores a pagar (pendentes)
app.get('/terc/financeiro/pendentes', async (c) => {
  const q = c.req.query();
  const where: string[] = ["r.status_fin='PendentePagamento'"];
  const binds: any[] = [];
  if (q.id_terc) { where.push('r.id_terc=?'); binds.push(toInt(q.id_terc)); }

  const rs = await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.qtd_total,
      r.dt_saida, r.dt_recebimento, r.valor_total, r.valor_pago, r.status, r.status_fin,
      (r.valor_total - COALESCE(r.valor_pago,0)) AS valor_aberto,
      t.id_terc, t.nome_terc, sv.desc_servico,
      CAST(julianday('now') - julianday(r.dt_recebimento) AS INTEGER) AS dias_pendente
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE ${where.join(' AND ')}
    ORDER BY r.dt_recebimento ASC, r.dt_saida ASC LIMIT 200`).bind(...binds).all();

  const tot = await c.env.DB.prepare(`
    SELECT COUNT(*) AS qtde, COALESCE(SUM(valor_total - COALESCE(valor_pago,0)),0) AS total
    FROM terc_remessas WHERE status_fin='PendentePagamento'`).first<any>();

  const porTerc = (await c.env.DB.prepare(`
    SELECT t.id_terc, t.nome_terc,
      COUNT(*) AS qtde,
      COALESCE(SUM(r.valor_total - COALESCE(r.valor_pago,0)),0) AS valor_aberto
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    WHERE r.status_fin='PendentePagamento'
    GROUP BY t.id_terc ORDER BY valor_aberto DESC`).all()).results;

  return c.json(ok({ pendentes: rs.results, totais: tot, por_terceirizado: porTerc }));
});

// Marcar como PAGO (uma remessa)
app.post('/terc/remessas/:id/pagar', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const dt = b.dt_pagamento || new Date().toISOString().slice(0, 10);

  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);
  if (rem.status_fin === 'Pago') return fail('Remessa já está paga', 409);

  const valor = toNum(b.valor_pago, Number(rem.valor_total) || 0);

  await c.env.DB.prepare(`
    UPDATE terc_remessas
    SET status='Pago', status_fin='Pago', valor_pago=?, dt_pagamento=?, alterado_por=?, dt_alteracao=datetime('now')
    WHERE id_remessa=?`)
    .bind(valor, dt, getUser(c), id).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'PAGAMENTO', ?, ?)`)
    .bind(id, `Pagamento R$ ${valor.toFixed(2)} em ${dt}`, getUser(c)).run();

  await audit(c, MOD, 'PAGAR', `remessa:${id}`, 'valor_pago', '', String(valor));
  return c.json(ok({ id, status: 'Pago', valor_pago: valor, dt_pagamento: dt }));
});

// Marcar várias remessas como pagas em lote
app.post('/terc/financeiro/pagar-lote', async (c) => {
  const b = await c.req.json();
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map((x: any) => toInt(x)).filter((x: number) => x > 0) : [];
  if (ids.length === 0) return fail('Nenhuma remessa selecionada');
  const dt = b.dt_pagamento || new Date().toISOString().slice(0, 10);
  let pagas = 0; let valor_total = 0;
  for (const id of ids) {
    const rem = await c.env.DB.prepare('SELECT valor_total, status_fin FROM terc_remessas WHERE id_remessa=?').bind(id).first<any>();
    if (!rem || rem.status_fin === 'Pago') continue;
    const v = Number(rem.valor_total) || 0;
    await c.env.DB.prepare(`UPDATE terc_remessas SET status='Pago', status_fin='Pago', valor_pago=?, dt_pagamento=?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=?`)
      .bind(v, dt, getUser(c), id).run();
    await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario) VALUES (?, 'PAGAMENTO', ?, ?)`)
      .bind(id, `Pagamento em lote R$ ${v.toFixed(2)}`, getUser(c)).run();
    pagas++; valor_total += v;
  }
  await audit(c, MOD, 'PAGAR_LOTE', `remessas:${ids.length}`, 'valor_total', '', String(valor_total));
  return c.json(ok({ pagas, valor_total, dt_pagamento: dt }));
});

/* =================================================================
 * 🆕 ALERTAS AUTOMÁTICOS DA TERCEIRIZAÇÃO
 * ================================================================= */

app.get('/terc/alertas', async (c) => {
  // Atualiza status atrasado antes (idempotente)
  await c.env.DB.prepare(`
    UPDATE terc_remessas SET status='Atrasado'
    WHERE status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial')
      AND date(dt_previsao) < date('now')`).run();

  const atrasos = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.qtd_total, r.dt_previsao,
      t.id_terc, t.nome_terc,
      CAST(julianday('now') - julianday(r.dt_previsao) AS INTEGER) AS dias_atraso
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    WHERE r.status='Atrasado'
    ORDER BY dias_atraso DESC LIMIT 50`).all()).results;

  const semRetorno = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.dt_envio,
      t.id_terc, t.nome_terc,
      CAST(julianday('now') - julianday(r.dt_envio) AS INTEGER) AS dias_sem_retorno
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    WHERE r.status IN ('Enviado','EmProducao')
      AND r.dt_envio IS NOT NULL
      AND date(r.dt_envio) < date('now', '-5 days')
      AND NOT EXISTS (SELECT 1 FROM terc_retornos WHERE id_remessa=r.id_remessa)
    ORDER BY dias_sem_retorno DESC LIMIT 30`).all()).results;

  const baixaProd = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref,
      t.id_terc, t.nome_terc,
      SUM(rt.qtd_boa) AS boa, SUM(rt.qtd_refugo+rt.qtd_conserto) AS perda,
      SUM(rt.qtd_boa+rt.qtd_refugo+rt.qtd_conserto) AS total_ret
    FROM terc_retornos rt
    JOIN terc_remessas r ON r.id_remessa=rt.id_remessa
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    WHERE rt.dt_retorno >= date('now','-30 days')
    GROUP BY r.id_remessa
    HAVING total_ret > 0 AND (perda * 1.0 / total_ret) > 0.10
    ORDER BY (perda * 1.0 / total_ret) DESC LIMIT 20`).all()).results;

  const pagAtrasado = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.dt_recebimento, r.valor_total,
      t.id_terc, t.nome_terc,
      CAST(julianday('now') - julianday(r.dt_recebimento) AS INTEGER) AS dias_pendente
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    WHERE r.status_fin='PendentePagamento'
      AND r.dt_recebimento IS NOT NULL
      AND date(r.dt_recebimento) < date('now','-7 days')
    ORDER BY dias_pendente DESC LIMIT 30`).all()).results;

  const alertas: any[] = [];
  if (atrasos.length) alertas.push({ tipo: 'ATRASO', severidade: 'critica', titulo: `${atrasos.length} remessa(s) atrasada(s)`, descricao: 'Datas de previsão já vencidas', itens: atrasos });
  if (semRetorno.length) alertas.push({ tipo: 'SEM_RETORNO', severidade: 'alta', titulo: `${semRetorno.length} remessa(s) sem retorno há +5 dias`, descricao: 'Possível atraso na produção', itens: semRetorno });
  if (baixaProd.length) alertas.push({ tipo: 'BAIXA_PRODUCAO', severidade: 'media', titulo: `${baixaProd.length} remessa(s) com refugo > 10%`, descricao: 'Qualidade abaixo do esperado', itens: baixaProd });
  if (pagAtrasado.length) alertas.push({ tipo: 'PAGAMENTO_PENDENTE', severidade: 'media', titulo: `${pagAtrasado.length} pagamento(s) pendentes há +7 dias`, descricao: 'Valores a pagar em atraso', itens: pagAtrasado });
  if (alertas.length === 0) alertas.push({ tipo: 'OK', severidade: 'baixa', titulo: 'Tudo certo!', descricao: 'Sem alertas críticos no momento', itens: [] });

  return c.json(ok({
    total: alertas.filter((a: any) => a.tipo !== 'OK').reduce((acc: number, a: any) => acc + a.itens.length, 0),
    alertas,
  }));
});

/* =================================================================
 * 🆕 TIMELINE DE EVENTOS DA REMESSA
 * ================================================================= */
app.get('/terc/remessas/:id/timeline', async (c) => {
  const id = toInt(c.req.param('id'));
  const rs = await c.env.DB.prepare(`
    SELECT id_evento, tipo, descricao, usuario, dt_evento
    FROM terc_eventos WHERE id_remessa=?
    ORDER BY dt_evento DESC LIMIT 100`).bind(id).all();
  return c.json(ok(rs.results));
});

/* =================================================================
 * IMPORTADOR — recebe linhas parseadas do Excel/CSV no frontend
 * ================================================================= */

app.post('/terc/importar/remessas', async (c) => {
  const b = await c.req.json();
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  const dryRun = !!b.dry_run;
  const criarCadastros = !!b.criar_cadastros;

  if (rows.length === 0) return fail('Nenhuma linha enviada');

  // Cache de cadastros
  const tercs: Record<string, number> = {};
  const servicos: Record<string, number> = {};
  const setores: Record<string, number> = {};
  const colecoes: Record<string, number> = {};
  const produtos: Record<string, { id: number; desc: string; grade: number }> = {}; // chave = "cod_ref|id_colecao"
  const precos: Record<string, number> = {}; // chave = "cod_ref|id_servico|grade|id_colecao"

  (await c.env.DB.prepare('SELECT id_terc, nome_terc FROM terc_terceirizados').all()).results.forEach((r: any) => tercs[String(r.nome_terc).toLowerCase().trim()] = r.id_terc);
  (await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos').all()).results.forEach((r: any) => servicos[String(r.desc_servico).toLowerCase().trim()] = r.id_servico);
  (await c.env.DB.prepare('SELECT id_setor, nome_setor FROM terc_setores').all()).results.forEach((r: any) => setores[String(r.nome_setor).toLowerCase().trim()] = r.id_setor);
  (await c.env.DB.prepare('SELECT id_colecao, nome_colecao FROM terc_colecoes').all()).results.forEach((r: any) => colecoes[String(r.nome_colecao).toLowerCase().trim()] = r.id_colecao);
  (await c.env.DB.prepare('SELECT id_produto, cod_ref, desc_ref, id_colecao, grade_padrao FROM terc_produtos WHERE ativo=1').all()).results.forEach((r: any) => {
    produtos[`${r.cod_ref}|${r.id_colecao || 0}`] = { id: r.id_produto, desc: r.desc_ref, grade: r.grade_padrao || 1 };
  });
  (await c.env.DB.prepare('SELECT id_preco, cod_ref, id_servico, grade, id_colecao FROM terc_precos WHERE ativo=1').all()).results.forEach((r: any) => {
    precos[`${r.cod_ref}|${r.id_servico}|${r.grade || 1}|${r.id_colecao || 0}`] = r.id_preco;
  });

  const erros: any[] = [];
  let inseridas = 0, ignoradas = 0, cadCriados = 0;
  let prodsCriados = 0, precosCriados = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = i + 1;
    try {
      const nome_terc = String(row.nome_terc || row.terceirizado || '').trim();
      const desc_servico = String(row.desc_servico || row.servico || '').trim();
      const cod_ref = String(row.cod_ref || row.ref || '').trim();
      const dt_saida = String(row.dt_saida || row.data_saida || '').slice(0, 10);

      if (!nome_terc || !desc_servico || !cod_ref || !dt_saida) {
        erros.push({ linha: n, erro: 'Campos obrigatórios ausentes (nome_terc, desc_servico, cod_ref, dt_saida)' });
        ignoradas++; continue;
      }

      // Resolver cadastros
      let id_terc = tercs[nome_terc.toLowerCase()];
      if (!id_terc && criarCadastros && !dryRun) {
        const r = await c.env.DB.prepare('INSERT INTO terc_terceirizados (nome_terc, situacao, ativo) VALUES (?, ?, 1)').bind(nome_terc, 'Ativa').run();
        id_terc = r.meta.last_row_id as number;
        tercs[nome_terc.toLowerCase()] = id_terc; cadCriados++;
      }
      if (!id_terc) { erros.push({ linha: n, erro: `Terceirizado "${nome_terc}" não cadastrado` }); ignoradas++; continue; }

      let id_servico = servicos[desc_servico.toLowerCase()];
      if (!id_servico && criarCadastros && !dryRun) {
        const r = await c.env.DB.prepare('INSERT INTO terc_servicos (desc_servico, ativo) VALUES (?, 1)').bind(desc_servico).run();
        id_servico = r.meta.last_row_id as number;
        servicos[desc_servico.toLowerCase()] = id_servico; cadCriados++;
      }
      if (!id_servico) { erros.push({ linha: n, erro: `Serviço "${desc_servico}" não cadastrado` }); ignoradas++; continue; }

      let id_setor = null;
      if (row.setor) {
        id_setor = setores[String(row.setor).toLowerCase()] || null;
        if (!id_setor && criarCadastros && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_setores (nome_setor, ativo) VALUES (?, 1)').bind(row.setor).run();
          id_setor = r.meta.last_row_id as number;
          setores[String(row.setor).toLowerCase()] = id_setor; cadCriados++;
        }
      }

      let id_colecao: number | null = null;
      if (row.colecao) {
        id_colecao = colecoes[String(row.colecao).toLowerCase()] || null;
        if (!id_colecao && criarCadastros && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo) VALUES (?, 1)').bind(row.colecao).run();
          id_colecao = r.meta.last_row_id as number;
          colecoes[String(row.colecao).toLowerCase()] = id_colecao; cadCriados++;
        }
      }

      // Grade
      const grade: any[] = [];
      for (const t of TAMS) {
        const v = toInt(row[`tam_${t}`] || row[t] || 0);
        if (v > 0) grade.push({ tamanho: t, qtd: v });
      }
      const qtd_total = grade.reduce((a, g) => a + g.qtd, 0) || toInt(row.qtd_total);
      if (qtd_total <= 0) { erros.push({ linha: n, erro: 'Quantidade total = 0' }); ignoradas++; continue; }

      const preco = toNum(row.preco_unit || row.preco);
      const valor = qtd_total * preco;
      const desc_ref = String(row.desc_ref || row.descricao || '').trim() || cod_ref;
      const grade_padrao = toInt(row.grade, 1);

      // 🤖 Auto-criar PRODUTO se não existir (importação inteligente)
      const prodKey = `${cod_ref}|${id_colecao || 0}`;
      if (!produtos[prodKey] && criarCadastros && !dryRun) {
        const rp = await c.env.DB.prepare(`
          INSERT OR IGNORE INTO terc_produtos (cod_ref, desc_ref, id_colecao, grade_padrao, ativo, criado_por)
          VALUES (?, ?, ?, ?, 1, ?)`)
          .bind(cod_ref, desc_ref, id_colecao, grade_padrao, getUser(c)).run();
        if (rp.meta.last_row_id) {
          produtos[prodKey] = { id: rp.meta.last_row_id as number, desc: desc_ref, grade: grade_padrao };
          prodsCriados++;
        }
      }

      // 🤖 Auto-criar PREÇO se não existir e a planilha trouxe valor (importação inteligente)
      if (preco > 0) {
        const precoKey = `${cod_ref}|${id_servico}|${grade_padrao}|${id_colecao || 0}`;
        if (!precos[precoKey] && criarCadastros && !dryRun) {
          try {
            const rp = await c.env.DB.prepare(`
              INSERT OR IGNORE INTO terc_precos (cod_ref, desc_ref, id_servico, grade, preco, tempo_min, id_colecao, ativo)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
              .bind(cod_ref, desc_ref, id_servico, grade_padrao, preco, toNum(row.tempo_peca), id_colecao).run();
            if (rp.meta.last_row_id) {
              precos[precoKey] = rp.meta.last_row_id as number;
              precosCriados++;
            }
          } catch {}
        }
      }

      if (!dryRun) {
        const nextN = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas').first<any>();
        const r = await c.env.DB.prepare(`
          INSERT INTO terc_remessas (num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref, id_servico, cor, grade, qtd_total, preco_unit, valor_total, id_colecao, dt_saida, dt_inicio, dt_previsao, prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, status, observacao, criado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(toInt(row.num_controle) || nextN?.n, row.num_op || null, id_terc, id_setor, cod_ref, row.desc_ref || null,
            id_servico, row.cor || null, toInt(row.grade, 1), qtd_total, preco, valor, id_colecao,
            dt_saida, row.dt_inicio || dt_saida, row.dt_previsao || dt_saida,
            toInt(row.prazo_dias), toNum(row.tempo_peca), toNum(row.efic_pct, 0.8),
            toInt(row.qtd_pessoas, 1), toInt(row.min_trab_dia, 480),
            row.status || 'Aberta', row.observacao || null, getUser(c)).run();
        const idR = r.meta.last_row_id;
        for (const g of grade) {
          await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd) VALUES (?, ?, ?)').bind(idR, g.tamanho, g.qtd).run();
        }
      }
      inseridas++;
    } catch (e: any) {
      erros.push({ linha: n, erro: String(e.message || e) });
      ignoradas++;
    }
  }

  if (!dryRun) {
    await audit(c, MOD, 'IMP', `import:${Date.now()}`, 'inseridas', '', String(inseridas));
  }
  return c.json(ok({
    dry_run: dryRun,
    total: rows.length,
    inseridas,
    ignoradas,
    cadastros_criados: cadCriados,
    produtos_criados: prodsCriados,
    precos_criados: precosCriados,
    erros: erros.slice(0, 100),
  }));
});

export default app;
