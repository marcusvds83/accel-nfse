/**
 * services/nfse-odoo-emit.js — Integracao Odoo + Emissao NFS-e (SPED)
 * =================================================================
 * Polling: busca faturas com x_nytro_nfse_status = 'pendente',
 * extrai dados via XML-RPC, gera XML DPS, assina com A1,
 * envia ao SPED NFS-e, e atualiza o Odoo com o resultado.
 */

const xmlrpc = require('xmlrpc');
const config = require('../config');
const { gerarXmlDPS } = require('./nfse-xml');
const { assinarXml } = require('./nfse-signer');
const { enviarDPS } = require('./nfse-client');
const { carregarCertificado } = require('./firebase-cert');

// === XML-RPC Helpers ===

function createClient(url) {
  const base = url.replace(/\/+$/, '');
  const host = base.replace('https://', '').replace('http://', '');
  const port = base.startsWith('https') ? 443 : 80;
  const isSecure = base.startsWith('https');
  const createFn = isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient;
  return {
    common: createFn({ host, path: '/xmlrpc/2/common', port }),
    models: createFn({ host, path: '/xmlrpc/2/object', port }),
  };
}

function authenticate(client) {
  const db = config.odoo.db;
  const user = config.odoo.user; // email de login
  const key = config.odoo.api_key;
  return new Promise((resolve, reject) => {
    client.common.methodCall('authenticate', [db, user, key, {}], (err, uid) => {
      if (err) reject(new Error('Auth Odoo falhou: ' + (err.message || JSON.stringify(err))));
      else if (uid === false || uid === null) reject(new Error('API Key Odoo invalida. Verifique ODOO_USER e ODOO_API_KEY.'));
      else resolve(uid);
    });
  });
}

function executeKw(client, db, uid, model, method, args, kwargs) {
  return new Promise((resolve, reject) => {
    client.models.methodCall('execute_kw', [db, uid, config.odoo.api_key, model, method, args || [], kwargs || {}], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function readFields(client, db, uid, model, ids, fields) {
  return executeKw(client, db, uid, model, 'read', [ids], { fields });
}

// === Processar emissões pendentes ===
async function processPendingEmissions() {
  if (!config.odoo.enabled || !config.odoo.url) {
    return { processed: 0, reason: 'odoo_not_configured' };
  }
  if (!config.odoo.api_key || !config.odoo.user) {
    console.error('[NFSE-EMIT] ODOO_USER ou ODOO_API_KEY nao configurados.');
    return { processed: 0, reason: 'no_api_key' };
  }

  const client = createClient(config.odoo.url);
  let uid;
  try {
    uid = await authenticate(client);
  } catch (e) {
    console.error('[NFSE-EMIT] Autenticacao Odoo falhou:', e.message);
    return { processed: 0, reason: 'auth_failed' };
  }
  const db = config.odoo.db;

  try {
    const moveIds = await executeKw(client, db, uid, 'account.move', 'search', [[
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['x_nytro_nfse_status', '=', 'pendente'],
    ]]);

    if (!moveIds || !moveIds.length) return { processed: 0 };

    console.log('[NFSE-EMIT] ' + moveIds.length + ' fatura(s) pendente(s).');
    const detalhes = [];

    for (const moveId of moveIds) {
      try {
        const resultado = await emitirNfseOdoo(client, db, uid, moveId);
        detalhes.push({ move_id: moveId, ...resultado });
      } catch (e) {
        console.error('[NFSE-EMIT] Erro move_id=' + moveId + ':', e.message);
        await safeUpdateError(client, db, uid, moveId, e.message);
        detalhes.push({ move_id: moveId, sucesso: false, erro: e.message });
      }
    }

    return { processed: moveIds.length, detalhes };
  } catch (e) {
    console.error('[NFSE-EMIT] Erro no polling:', e.message);
    return { processed: 0, reason: e.message };
  }
}

// === Emissao completa ===
async function emitirNfseOdoo(client, db, uid, moveId) {
  // 1. Marca como processando
  await executeKw(client, db, uid, 'account.move', 'write', [[moveId], {
    x_nytro_nfse_status: 'processando',
  }]);

  // 2. Carrega certificado A1 do Firebase
  const cert = await carregarCertificado();
  if (!cert || !cert.privateKeyPem) {
    throw new Error('Certificado A1 nao encontrado no Firebase. Faca upload via POST /api/v1/nfse/certificado');
  }

  // 3. Leitura dos dados da fatura
  const moves = await readFields(client, db, uid, 'account.move', [moveId], [
    'name', 'partner_id', 'company_id', 'invoice_date', 'amount_total', 'amount_untaxed',
    'amount_tax', 'narration', 'payment_reference', 'invoice_line_ids',
  ]);
  const move = moves[0];

  // 4. Leitura da empresa
  const companies = await readFields(client, db, uid, 'res.company', [move.company_id[0]], [
    'name', 'cnpj_cpf', 'street', 'street2', 'number', 'city_id', 'state_id', 'zip',
    'phone', 'email', 'district',
  ]);
  const company = companies[0];

  // 5. Leitura do parceiro (tomador)
  const partners = await readFields(client, db, uid, 'res.partner', [move.partner_id[0]], [
    'name', 'cnpj_cpf', 'street', 'street2', 'number', 'city_id', 'state_id', 'zip',
    'phone', 'email', 'inscr_est', 'legal_name', 'district',
  ]);
  const partner = partners[0];

  // 6. Leitura das linhas de servico (apenas display_type=false)
  const allLines = await readFields(client, db, uid, 'account.move.line', move.invoice_line_ids, [
    'name', 'quantity', 'price_unit', 'price_subtotal', 'product_id', 'tax_ids', 'display_type',
  ]);
  const lines = allLines.filter(l => l.display_type !== false || (l.display_type === false && l.product_id));
  const serviceLines = allLines.filter(l => !l.display_type && l.price_subtotal > 0);

  // 7. Leitura dos produtos
  const productIds = serviceLines.filter(l => l.product_id).map(l => l.product_id[0]).filter(Boolean);
  const products = productIds.length
    ? await readFields(client, db, uid, 'product.product', productIds, [
        'name', 'default_code',
        'x_nytro_codigo_tributacao', 'x_nytro_c_nbs',
        'x_nytro_aliquota_iss', 'x_nytro_iss_retido', 'x_nytro_descricao_nfse',
      ])
    : [];
  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });

  // 8. Incrementa numeracao na empresa
  const companyRead = await readFields(client, db, uid, 'res.company', [company.id], [
    'x_nytro_nfse_numero',
  ]);
  const ultimoNumero = (companyRead[0].x_nytro_nfse_numero) || 0;
  const proximoNumero = ultimoNumero + 1;
  await executeKw(client, db, uid, 'res.company', 'write', [[company.id], {
    x_nytro_nfse_numero: proximoNumero,
  }]);

  console.log('[NFSE-EMIT] Fatura ' + move.name + ' (move_id=' + moveId + ') nDPS=' + proximoNumero);

  // 9. Gera XML DPS
  const { xml: dpsXml, infDpsId } = gerarXmlDPS({
    move, company, partner,
    lines: serviceLines,
    products: productMap,
    nDPS: proximoNumero,
  });

  // 10. Assina o XML
  const dpsAssinado = await assinarXml(dpsXml, {
    privateKeyPem: cert.privateKeyPem,
    certPem: cert.certPem,
  });

  // 11. Envia para o SPED
  const resultado = await enviarDPS(dpsAssinado, cert);

  // 12. Atualiza o Odoo com o resultado
  if (resultado.sucesso) {
    const updateData = {
      x_nytro_nfse_status: 'autorizada',
      x_nytro_nfse_numero: resultado.nNFSe || String(proximoNumero),
      x_nytro_nfse_codigo_verificacao: resultado.nDFSe || '',
      x_nytro_nfse_protocolo: resultado.nProt || '',
      x_nytro_nfse_data_emissao: new Date().toISOString(),
      x_nytro_nfse_erro: false,
      x_nytro_nfse_mensagem: false,
    };
    // Salva XML de retorno (limitado a 50K chars por causa do campo text)
    if (resultado.xmlRetorno && resultado.xmlRetorno.length < 50000) {
      updateData.x_nytro_nfse_xml = resultado.xmlRetorno;
    }

    await executeKw(client, db, uid, 'account.move', 'write', [[moveId], updateData]);

    // Mensagem no chatter
    await executeKw(client, db, uid, 'mail.message', 'create', [{
      model: 'account.move',
      res_id: moveId,
      body: '<b>NFS-e Emitida com Sucesso!</b><br/>' +
            'Numero: <b>' + (resultado.nNFSe || proximoNumero) + '</b><br/>' +
            'DFSe: ' + (resultado.nDFSe || '-') + '<br/>' +
            'Protocolo: ' + (resultado.nProt || '-'),
      message_type: 'comment',
    }]);

    console.log('[NFSE-EMIT] NFS-e ' + (resultado.nNFSe || proximoNumero) + ' autorizada para ' + move.name);
    return { sucesso: true, nNFSe: resultado.nNFSe, nDFSe: resultado.nDFSe };

  } else {
    // Rejeitada
    const motivo = resultado.xMotivo || 'Erro desconhecido';
    await safeUpdateError(client, db, uid, moveId,
      'NFS-e rejeitada: ' + motivo + ' (cStat=' + (resultado.cStat || 0) + ')');
    return { sucesso: false, erro: motivo, cStat: resultado.cStat };
  }
}

// === Atualiza erro no Odoo ===
async function safeUpdateError(client, db, uid, moveId, errMsg) {
  try {
    await executeKw(client, db, uid, 'account.move', 'write', [[moveId], {
      x_nytro_nfse_status: config.nfse.status_on_error || 'erro',
      x_nytro_nfse_erro: true,
      x_nytro_nfse_mensagem: errMsg.substring(0, 1000),
    }]);
    await executeKw(client, db, uid, 'mail.message', 'create', [{
      model: 'account.move',
      res_id: moveId,
      body: '<b>Erro na Emissao de NFS-e</b><br/>' + errMsg.substring(0, 500),
      message_type: 'comment',
    }]);
  } catch (e) {
    console.error('[NFSE-EMIT] Falha ao registrar erro:', e.message);
  }
}

module.exports = { processPendingEmissions };
