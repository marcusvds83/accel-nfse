/**
 * routes/nfse.js — Rotas de emissao e cancelamento de NFS-e
 * ===============================================================
 * POST /api/v1/nfse/emitir          — Emitir NFS-e por move_id
 * POST /api/v1/nfse/cancelar        — Cancelar NFS-e
 * POST /api/v1/nfse/process-pending — Processar pendentes (polling/cron)
 */

const express = require('express');
const router = express.Router();
const { processPendingEmissions } = require('../services/nfse-odoo-emit');
const config = require('../config');

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ erro: 'API key invalida' });
  }
  next();
}

// === Emitir NFS-e ===
router.post('/emitir', apiKeyAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { move_id } = req.body;
    if (!move_id) return res.status(400).json({ erro: 'move_id obrigatorio' });
    if (!config.odoo.enabled) return res.status(400).json({ erro: 'Integracao Odoo nao habilitada (ODOO_ENABLED=1)' });

    console.log('[NFSE] Emitir NFS-e solicitada para move_id=' + move_id);

    // TODO: Implementar emissao direta por move_id
    // 1. Ler dados do Odoo via XML-RPC
    // 2. Gerar XML ABRASF v2
    // 3. Assinar com certificado A1
    // 4. Enviar para prefeitura
    // 5. Consultar resultado
    // 6. Atualizar Odoo
    // 7. Anexar XML + DANFSE no chatter

    const duracao = Date.now() - t0;
    res.json({
      sucesso: false,
      mensagem: 'Emissao direta sera implementada no proximo passo. Use polling (x_nytro_nfse_status=pendente).',
      duracao_ms: duracao,
    });
  } catch (err) {
    console.error('[NFSE] Erro ao emitir:', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// === Cancelar NFS-e ===
router.post('/cancelar', apiKeyAuth, async (req, res) => {
  try {
    const { move_id, justificativa } = req.body;
    if (!move_id) return res.status(400).json({ erro: 'move_id obrigatorio' });

    console.log('[NFSE-CANCEL] Solicitacao move_id=' + move_id + ' just=' + (justificativa || '').slice(0, 50));

    // TODO: Implementar cancelamento
    // 1. Ler chave/protocolo do Odoo
    // 2. Gerar XML de cancelamento
    // 3. Assinar e enviar para prefeitura
    // 4. Atualizar Odoo

    res.json({
      sucesso: false,
      mensagem: 'Cancelamento sera implementado no proximo passo.',
    });
  } catch (err) {
    console.error('[NFSE-CANCEL] Erro:', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// === Processar pendentes (polling / cron) ===
router.post('/process-pending', apiKeyAuth, async (req, res) => {
  console.log('[NFSE] process-pending chamado');
  try {
    const resultado = await processPendingEmissions();
    res.json({
      sucesso: true,
      processadas: resultado.processed,
      detalhes: resultado.detalhes || [],
    });
  } catch (err) {
    console.error('[NFSE] Erro process-pending:', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

module.exports = router;
