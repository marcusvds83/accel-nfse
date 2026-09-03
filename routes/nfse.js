/**
 * routes/nfse.js — Rotas de emissao, cancelamento e re-anexo de NFS-e
 * ===============================================================
 * POST /api/v1/nfse/emitir          — Emitir NFS-e por move_id
 * POST /api/v1/nfse/cancelar        — Cancelar NFS-e
 * POST /api/v1/nfse/process-pending — Processar pendentes (polling/cron)
 * POST /api/v1/nfse/re-attach       — Re-anexar XML/PDF a NF ja emitida
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { processPendingEmissions } = require('../services/nfse-odoo-emit');
const { cancelarNfse } = require('../services/nfse-cancelamento');
const { gerarPdfDanfse } = require('../services/nfse-pdf');
const { carregarCertificado } = require('../services/firebase-cert');
const { consultarNfse, baixarPdfDanfse } = require('../services/nfse-client');
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
  const t0 = Date.now();
  try {
    const { move_id, justificativa } = req.body;
    if (!move_id) {
      console.log('[NFSE-CANCEL] Rejeitado: move_id nao informado no body');
      return res.status(400).json({ erro: 'move_id obrigatorio' });
    }

    console.log('=============================================================');
    console.log('[NFSE-CANCEL] INICIO - move_id=' + move_id + ' | justificativa: ' + (justificativa || '(padrao)'));

    // 1. Le dados da fatura no Odoo
    console.log('[NFSE-CANCEL] Etapa 1/5: Lendo fatura no Odoo...');
    const result = await odooRead(move_id);
    if (!result) {
      console.log('[NFSE-CANCEL] Fatura move_id=' + move_id + ' NAO encontrada no Odoo');
      return res.status(404).json({ sucesso: false, erro: 'Fatura nao encontrada' });
    }

    const { move, company } = result;
    console.log('[NFSE-CANCEL] Fatura encontrada: ' + move.name + ' | Status NFSe: ' + (move.x_nytro_nfse_status || 'vazio') + ' | NFSe numero: ' + (move.x_nytro_nfse_numero || 'n/a'));

    // 2. Verifica status
    console.log('[NFSE-CANCEL] Etapa 2/5: Verificando status da NFS-e...');
    if (move.x_nytro_nfse_status !== 'autorizada') {
      const statusAtual = move.x_nytro_nfse_status || 'vazio';
      console.log('[NFSE-CANCEL] BLOQUEADO: Status atual e "' + statusAtual + '", precisa ser "autorizada"');
      return res.json({
        sucesso: false,
        xMotivo: 'NFS-e precisa estar autorizada. Status atual: ' + statusAtual,
      });
    }
    console.log('[NFSE-CANCEL] Status OK: autorizada');

    // 3. Cancela no SPED
    console.log('[NFSE-CANCEL] Etapa 3/5: Enviando cancelamento para SEFIN...');
    const cnpjPrest = (company ? company.cnpj_cpf || '' : '').replace(/[^0-9]/g, '');
    const just = justificativa || 'Cancelamento solicitado pelo emitente via Odoo';

    const chaveAcesso = move.x_nytro_nfse_codigo_verificacao || '';
    console.log('[NFSE-CANCEL] Chave de acesso: ' + chaveAcesso);
    console.log('[NFSE-CANCEL] CNPJ prestador: ' + cnpjPrest);
    console.log('[NFSE-CANCEL] nNFSe: ' + (move.x_nytro_nfse_numero || 'n/a'));

    if (!chaveAcesso) {
      console.log('[NFSE-CANCEL] BLOQUEADO: Chave de acesso vazia no campo x_nytro_nfse_codigo_verificacao');
      return res.json({
        sucesso: false,
        xMotivo: 'Chave de acesso nao encontrada no Odoo (x_nytro_nfse_codigo_verificacao vazio). Reemita a nota.',
      });
    }

    const resultado = await cancelarNfse({
      nNFSe: move.x_nytro_nfse_numero || '',
      chaveAcesso: chaveAcesso,
      cnpjPrest,
      justificativa: just,
    });

    console.log('[NFSE-CANCEL] Retorno SEFIN: sucesso=' + resultado.sucesso + ' | cStat=' + (resultado.cStat || 'n/a') + ' | xMotivo=' + (resultado.xMotivo || ''));

    if (resultado.sucesso) {
      // 4. Atualiza Odoo
      console.log('[NFSE-CANCEL] Etapa 4/5: Atualizando status no Odoo para "cancelada"...');
      await odooWrite(move_id, {
        x_nytro_nfse_status: 'cancelada',
        x_nytro_nfse_erro: false,
        x_nytro_nfse_mensagem: 'Cancelada: ' + (resultado.xMotivo || ''),
      });
      console.log('[NFSE-CANCEL] Status atualizado no Odoo com sucesso');

      // 5. Posta mensagem no chatter
      console.log('[NFSE-CANCEL] Etapa 5/5: Postando mensagem no chatter...');
      try {
        const uid = await odooAuthenticate();
        const client = odooClient();
        const msgId = await new Promise((resolve, reject) => {
          client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'mail.message', 'create', [{
            model: 'account.move',
            res_id: move_id,
            body: '<b>NFS-e Cancelada</b><br/>Justificativa: ' + just,
            message_type: 'comment',
          }]], (err, result) => err ? reject(err) : resolve(result));
        });
        console.log('[NFSE-CANCEL] Mensagem postada no chatter: mail.message id=' + msgId);
      } catch (e) {
        console.error('[NFSE-CANCEL] Falha ao postar mensagem no chatter:', e.message);
      }
    } else {
      console.log('[NFSE-CANCEL] Cancelamento NEGADO pela SEFIN. Nao foi atualizado o status no Odoo.');
    }

    const duracao = Date.now() - t0;
    console.log('[NFSE-CANCEL] FIM - duracao: ' + duracao + 'ms | resultado: ' + (resultado.sucesso ? 'SUCESSO' : 'FALHA'));
    console.log('=============================================================');

    res.json(resultado);
  } catch (err) {
    console.error('[NFSE-CANCEL] ERRO FATAL:', err.stack || err.message);
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

// === Re-anexar XML/PDF a NF ja emitida ===
// Aceita move_id (Odoo internal ID) OU nfse_numero (numero da NFS-e como 91)
router.post('/re-attach', apiKeyAuth, async (req, res) => {
  try {
    let { move_id, nfse_numero, chave_acesso } = req.body;

    const uid = await odooAuthenticate();
    const client = odooClient();

    // Se nao tem move_id, busca pelo numero da NFS-e
    if (!move_id && nfse_numero) {
      console.log('[NFSE-RE-ATTACH] Buscando por nfse_numero=' + nfse_numero);
      const ids = await new Promise((resolve, reject) => {
        client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'account.move', 'search', [
          [['x_nytro_nfse_numero', '=', String(nfse_numero)]]
        ]], (err, ids) => err ? reject(err) : resolve(ids));
      });
      if (!ids || !ids.length) {
        return res.status(404).json({ erro: 'Nenhuma fatura encontrada com x_nytro_nfse_numero=' + nfse_numero });
      }
      move_id = ids[0];
      console.log('[NFSE-RE-ATTACH] Encontrado move_id=' + move_id);
    }

    if (!move_id) return res.status(400).json({ erro: 'move_id ou nfse_numero obrigatorio' });
    console.log('[NFSE-RE-ATTACH] move_id=' + move_id);

    // 1. Le a fatura
    const moves = await new Promise((resolve, reject) => {
      client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'account.move', 'read', [[move_id]], {
        fields: ['name', 'x_nytro_nfse_status', 'x_nytro_nfse_numero', 'x_nytro_nfse_codigo_verificacao', 'x_nytro_nfse_xml'],
      }], (err, result) => err ? reject(err) : resolve(result));
    });

    if (!moves || !moves.length) return res.status(404).json({ erro: 'Fatura nao encontrada com move_id=' + move_id });
    const move = moves[0];
    console.log('[NFSE-RE-ATTACH] Fatura: ' + move.name + ' Status: ' + move.x_nytro_nfse_status);

    const chave = chave_acesso || move.x_nytro_nfse_codigo_verificacao || '';
    const numNF = move.x_nytro_nfse_numero || '?';
    let nfseXml = move.x_nytro_nfse_xml || '';

    // 2. Se tem a chave, consulta a SEFIN para pegar o XML completo
    if (chave && !nfseXml) {
      console.log('[NFSE-RE-ATTACH] Consultando SEFIN pela chave: ' + chave);
      const cert = await carregarCertificado();
      if (cert) {
        const consulta = await consultarNfse(chave, cert);
        if (consulta.sucesso && consulta.dados && consulta.dados.nfseXml) {
          nfseXml = consulta.dados.nfseXml;
          console.log('[NFSE-RE-ATTACH] XML obtido da SEFIN: ' + nfseXml.length + ' bytes');
        }
      }
    }

    if (!nfseXml) {
      return res.json({ sucesso: false, erro: 'XML da NFS-e nao disponivel (nem no Odoo, nem na SEFIN)' });
    }

    // 3. Upload XML
    try {
      const xmlNome = 'NFS-e-' + String(numNF).padStart(6, '0') + '.xml';
      const xmlB64 = Buffer.from(nfseXml, 'utf-8').toString('base64');
      const attachId = await new Promise((resolve, reject) => {
        client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'ir.attachment', 'create', [{
          name: xmlNome, datas: xmlB64,
          res_model: 'account.move', res_id: move_id, mimetype: 'application/xml',
        }]], (err, id) => err ? reject(err) : resolve(id));
      });
      // Vincula a mensagem no chatter
      await new Promise((resolve, reject) => {
        client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'mail.message', 'create', [{
          model: 'account.move', res_id: move_id,
          body: '<b>XML NFS-e ' + numNF + '</b> (re-anexado)',
          message_type: 'comment',
          attachment_ids: [[6, 0, [attachId]]],
        }]], (err, id) => err ? reject(err) : resolve(id));
      });
      console.log('[NFSE-RE-ATTACH] XML anexado: ' + xmlNome + ' (attach_id=' + attachId + ')');
    } catch (e) {
      console.error('[NFSE-RE-ATTACH] Falha XML:', e.message);
    }

    // 4. Gera e upload PDF (PDFKit Nytro com logo)
    try {
      const pdfNome = 'DANFSe-' + String(numNF).padStart(6, '0') + '.pdf';
      let pdfBuf = null;

      // 4a. Gera DANFSe localmente (PDFKit Nytro)
      console.log('[NFSE-RE-ATTACH] 4a. Gerando DANFSe (PDFKit Nytro com logo)...');
      try {
        pdfBuf = await gerarPdfDanfse(nfseXml);
      } catch (eLocal) {
        console.error('[NFSE-RE-ATTACH] FALHA ao gerar DANFSe: ' + eLocal.message);
      }

      // 4b. Anexa o PDF
      if (pdfBuf && pdfBuf.length > 0) {
        const pdfB64 = pdfBuf.toString('base64');
        const attachId = await new Promise((resolve, reject) => {
          client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'ir.attachment', 'create', [{
            name: pdfNome, datas: pdfB64,
            res_model: 'account.move', res_id: move_id, mimetype: 'application/pdf',
          }]], (err, id) => err ? reject(err) : resolve(id));
        });
        await new Promise((resolve, reject) => {
          client.methodCall('execute_kw', [config.odoo.db, uid, config.odoo.api_key, 'mail.message', 'create', [{
            model: 'account.move', res_id: move_id,
            body: '<b>DANFSe ' + numNF + '</b> - re-anexado',
            message_type: 'comment',
            attachment_ids: [[6, 0, [attachId]]],
          }]], (err, id) => err ? reject(err) : resolve(id));
        });
        console.log('[NFSE-RE-ATTACH] PDF anexado: ' + pdfNome + ' (attach_id=' + attachId + ')');
      } else {
        console.error('[NFSE-RE-ATTACH] NENHUM PDF disponivel para anexar.');
      }
    } catch (e) {
      console.error('[NFSE-RE-ATTACH] Falha geral PDF:', e.message);
    }

    res.json({ sucesso: true, mensagem: 'Re-anexo concluido para ' + move.name });
  } catch (err) {
    console.error('[NFSE-RE-ATTACH] Erro:', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

module.exports = router;