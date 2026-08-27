/**
 * routes/nfse.js — Rotas de emissao e cancelamento de NFS-e
 * ===============================================================
 * POST /api/v1/nfse/emitir          — Emitir NFS-e por move_id
 * POST /api/v1/nfse/cancelar        — Cancelar NFS-e
 * POST /api/v1/nfse/process-pending — Processar pendentes (polling/cron)
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { processPendingEmissions } = require('../services/nfse-odoo-emit');
const { cancelarNfse } = require('../services/nfse-cancelamento');
const xmlrpc = require('xmlrpc');

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ erro: 'API key invalida' });
  }
  next();
}

// === Emitir NFS-e por move_id ===
router.post('/emitir', apiKeyAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { move_id } = req.body;
    if (!move_id) return res.status(400).json({ erro: 'move_id obrigatorio' });

    console.log('[NFSE] Emitir solicitado para move_id=' + move_id);

    // Delega para o polling processar esta fatura
    // Marca como pendente e deixa o polling pegar
    // (reaproveita toda a logica de emitirNfseOdoo)
    // Futuro: implementar emissao direta sem depender do polling

    // Por enquanto, aciona o processamento
    const resultado = await processPendingEmissions();

    res.json({
      sucesso: true,
      processadas: resultado.processed,
      duracao_ms: Date.now() - t0,
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

    console.log('[NFSE-CANCEL] Solicitacao move_id=' + move_id);

    // 1. Le dados da fatura no Odoo
    const result = await odooRead(move_id);
    if (!result) {
      return res.status(404).json({ sucesso: false, erro: 'Fatura nao encontrada' });
    }

    const { move, company } = result;

    // 2. Verifica status
    if (move.x_nytro_nfse_status !== 'autorizada') {
      return res.json({
        sucesso: false,
        xMotivo: 'NFS-e precisa estar autorizada. Status atual: ' + (move.x_nytro_nfse_status || 'vazio'),
      });
    }

    // 3. Cancela no SPED
    const cnpjPrest = (company.cnpj_cpf || '').replace(/[^0-9]/g, '');
    const just = justificativa || 'Cancelamento solicitado pelo emitente via Odoo';

    const resultado = await cancelarNfse({
      nNFSe: move.x_nytro_nfse_numero || '',
      nDFSe: move.x_nytro_nfse_codigo_verificacao || '',
      cnpjPrest,
      justificativa: just,
      infNfseId: '', // nao precisamos para cancelamento simples
    });

    if (resultado.sucesso) {
      // 4. Atualiza Odoo
      await odooWrite(move_id, {
        x_nytro_nfse_status: 'cancelada',
        x_nytro_nfse_erro: false,
        x_nytro_nfse_mensagem: 'Cancelada: ' + (resultado.xMotivo || ''),
      });
    }

    res.json(resultado);
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

// === Helpers Odoo ===
function odooClient() {
  const url = config.odoo.url.replace(/\/+$/, '');
  const host = url.replace('https://', '').replace('http://', '');
  const port = url.startsWith('https') ? 443 : 80;
  const fn = url.startsWith('https') ? xmlrpc.createSecureClient : xmlrpc.createClient;
  return fn({ host, path: '/xmlrpc/2/object', port });
}

function odooAuthClient() {
  const url = config.odoo.url.replace(/\/+$/, '');
  const host = url.replace('https://', '').replace('http://', '');
  const port = url.startsWith('https') ? 443 : 80;
  const fn = url.startsWith('https') ? xmlrpc.createSecureClient : xmlrpc.createClient;
  return fn({ host, path: '/xmlrpc/2/common', port });
}

async function odooAuthenticate() {
  const client = odooAuthClient();
  return new Promise((resolve, reject) => {
    client.methodCall('authenticate', [config.odoo.db, config.odoo.user, config.odoo.api_key, {}], (err, uid) => {
      if (err || !uid) reject(new Error('Auth falhou'));
      else resolve(uid);
    });
  });
}

async function odooRead(moveId) {
  const uid = await odooAuthenticate();
  const client = odooClient();
  return new Promise((resolve, reject) => {
    client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'account.move', 'read', [[moveId]], {
      fields: ['name', 'partner_id', 'company_id', 'x_nytro_nfse_status', 'x_nytro_nfse_numero',
               'x_nytro_nfse_codigo_verificacao', 'x_nytro_nfse_protocolo'],
    }], (err, moves) => {
      if (err) reject(err);
      else if (!moves || !moves.length) resolve(null);
      else {
        const move = moves[0];
        // Le empresa
        const c = odooClient();
        c.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'res.company', 'read',
          [[move.company_id[0]]], { fields: ['name', 'cnpj_cpf'] }], (e, companies) => {
          if (e) resolve({ move });
          else resolve({ move, company: companies[0] });
        });
      }
    });
  });
}

async function odooWrite(moveId, data) {
  const uid = await odooAuthenticate();
  const client = odooClient();
  return new Promise((resolve, reject) => {
    client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'account.move', 'write', [[moveId], data]], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

module.exports = router;