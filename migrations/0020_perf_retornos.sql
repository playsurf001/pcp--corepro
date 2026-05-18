-- ====================================================================
-- 0020 — Performance: índices para a tela "Retornos"
--
-- Justificativa: o endpoint /terc/retornos filtra por:
--   1. dt_retorno BETWEEN ? AND ?               (sempre)
--   2. r.id_terc = ?                            (opcional)
--   3. dt_pagamento IS NULL / IS NOT NULL       (opcional)
--   4. r.num_controle / r.cod_ref / r.cor LIKE ? (busca)
--
-- E ordena por dt_retorno DESC.
--
-- Já existem: idx_terc_ret_rem (id_remessa), idx_terc_ret_data (dt_retorno).
-- Aqui adicionamos:
--   - Índice em terc_retornos.dt_pagamento (filtra pago/pendente)
--   - Índice composto em terc_remessas (id_remessa, id_terc, num_controle, cod_ref)
--     para ajudar o JOIN+filtro+busca.
--   - Índice em terc_remessas.cor (busca textual).
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_terc_ret_pagto      ON terc_retornos(dt_pagamento);
CREATE INDEX IF NOT EXISTS idx_terc_ret_data_id    ON terc_retornos(dt_retorno DESC, id_retorno DESC);
CREATE INDEX IF NOT EXISTS idx_terc_rem_terc       ON terc_remessas(id_terc);
CREATE INDEX IF NOT EXISTS idx_terc_rem_numctrl    ON terc_remessas(num_controle);
CREATE INDEX IF NOT EXISTS idx_terc_rem_codref     ON terc_remessas(cod_ref);
CREATE INDEX IF NOT EXISTS idx_terc_rem_cor        ON terc_remessas(cor);
CREATE INDEX IF NOT EXISTS idx_terc_rem_numop      ON terc_remessas(num_op);

-- Estatísticas para o planejador escolher os índices corretamente
ANALYZE;
