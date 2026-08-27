/**
 * services/nfse-odoo-emit.js — Integracao Odoo + Emissao NFS-e
 * =============================================================
 * Polling: busca faturas no Odoo com x_nytro_nfse_status = "pendente",
 * extrai dados via XML-RPC, gera XML, assina, envia a prefeitura,
 * e atualiza o Odoo com o resultado.
 *
 * Campos customizados esperados no Odoo (account.move):
 *   x_nytro_nfse_status    Selection (vazio/pendente/processando/autorizada/cancelada/erro)
 *   x_nytro_nfse_numero    Char
 *   x_nytro_nfse_codigo_verificacao  Char
 *   x_nytro_nfse_chave     Char
 *   x_nytro_nfse_protocolo Char
 *   x_nytro_nfse_erro      Text
 *   x_nytro_nfse_dh_emissao  Datetime
 *
 * Campos customizados esperados no Odoo (res.company):
 *   x_nytro_nfse_serie             Char (default "1")
 *   x_nytro_nfse_ultimo_numero     Integer
 *   x_nytro_nfse_inscricao_municipal  Char
 *   x_nytro_nfse_aliquota_padrao   Float
 *   x_nytro_nfse_optante_simples   Boolean
 *   x_nytro_nfse_cnae              Char
 *   x_nytro_nfse_item_lista_servico Char
 *   x_nytro_nfse_regime_especial   Selection
 *   x_nytro_nfse_incentivador_cultural Boolean
 *
 * Campos customizados esperados no Odoo (product.product):
 *   x_nytro_item_lista    Char (LC 116, ex: "01.07")
 *   x_nytro_cnae          Char
 *   x_nytro_codigo_tributacao Char
 *   x_nytro_aliquota_iss  Float
 *   x_nytro_iss_retido    Boolean
 *   x_nytro_descricao_nfse Text
 */

const xmlrpc = require('xmlrpc');
const config = require('../config');

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
  return new Promise((resolve, reject) => {
    client.common.methodCall('authenticate', [config.odoo.db, config.odoo.login, config.odoo.password, {}], (err, uid) => {
      if (err) reject(new Error('Auth Odoo falhou: ' + (err.message || JSON.stringify(err))));
      else if (uid === false || uid === null) reject(new Error('Credenciais Odoo invalidas.'));
      else resolve(uid);
    });
  });
}

function executeKw(client, db, uid, pwd, model, method, args, kwargs) {
  return new Promise((resolve, reject) => {
    client.models.methodCall('execute_kw', [db, uid, pwd, model, method, args || [], kwargs || {}], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function readFields(client, db, uid, pwd, model, ids, fields) {
  return executeKw(client, db, uid, pwd, model, 'read', [ids], { fields });
}

// === Processar emissões pendentes ===
async function processPendingEmissions() {
  if (!config.odoo.enabled || !config.odoo.url) {
    return { processed: 0, reason: 'odoo_not_configured' };
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
  const pwd = config.odoo.password;

  try {
    // Busca faturas pendentes
    const moveIds = await executeKw(client, db, uid, pwd, 'account.move', 'search', [[
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['x_nytro_nfse_status', '=', 'pendente'],
    ]]);

    if (!moveIds || !moveIds.length) return { processed: 0 };

    console.log('[NFSE-EMIT] ' + moveIds.length + ' fatura(s) pendente(s) encontrada(s).');

    for (let i = 0; i < moveIds.length; i++) {
      const moveId = moveIds[i];
      try {
        await emitirNfseOdoo(client, db, uid, pwd, moveId);
      } catch (e) {
        console.error('[NFSE-EMIT] Erro ao emitir move_id=' + moveId + ':', e.message);
        await safeUpdateError(client, db, uid, pwd, moveId, e.message);
      }
    }

    return { processed: moveIds.length };
  } catch (e) {
    console.error('[NFSE-EMIT] Erro no polling:', e.message);
    return { processed: 0, reason: e.message };
  }
}

async function emitirNfseOdoo(client, db, uid, pwd, moveId) {
  // Marca como processando
  await executeKw(client, db, uid, pwd, 'account.move', 'write', [[moveId], {
    x_nytro_nfse_status: 'processando',
  }]);

  // Leitura dos dados da fatura
  const moves = await readFields(client, db, uid, pwd, 'account.move', [moveId], [
    'name', 'partner_id', 'company_id', 'invoice_date', 'amount_total', 'amount_untaxed',
    'amount_tax', 'narration', 'payment_reference', 'invoice_line_ids',
  ]);
  const move = moves[0];

  // Leitura da empresa
  const companies = await readFields(client, db, uid, pwd, 'res.company', [move.company_id[0]], [
    'name', 'cnpj_cpf', 'street', 'city_id', 'state_id', 'zip', 'phone', 'email',
    'x_nytro_nfse_serie', 'x_nytro_nfse_ultimo_numero', 'x_nytro_nfse_inscricao_municipal',
    'x_nytro_nfse_aliquota_padrao', 'x_nytro_nfse_optante_simples', 'x_nytro_nfse_cnae',
    'x_nytro_nfse_item_lista_servico', 'x_nytro_nfse_regime_especial', 'x_nytro_nfse_incentivador_cultural',
  ]);
  const company = companies[0];

  // Leitura do parceiro (tomador)
  const partners = await readFields(client, db, uid, pwd, 'res.partner', [move.partner_id[0]], [
    'name', 'cnpj_cpf', 'street', 'street2', 'number', 'city_id', 'state_id', 'zip',
    'phone', 'email', 'inscr_est', 'legal_name',
  ]);
  const partner = partners[0];

  // Leitura das linhas de servico
  const lines = await readFields(client, db, uid, pwd, 'account.move.line', move.invoice_line_ids, [
    'name', 'quantity', 'price_unit', 'price_subtotal', 'product_id', 'tax_ids',
  ]);

  // Leitura dos produtos para obter dados fiscais
  const productIds = lines.filter(l => l.product_id).map(l => l.product_id[0]).filter(Boolean);
  const products = productIds.length
    ? await readFields(client, db, uid, pwd, 'product.product', productIds, [
        'name', 'x_nytro_item_lista', 'x_nytro_cnae', 'x_nytro_codigo_tributacao',
        'x_nytro_aliquota_iss', 'x_nytro_iss_retido', 'x_nytro_descricao_nfse',
      ])
    : [];
  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });

  // Incrementa numeracao
  const proximoNumero = (company.x_nytro_nfse_ultimo_numero || 0) + 1;
  await executeKw(client, db, uid, pwd, 'res.company', 'write', [[company.id], {
    x_nytro_nfse_ultimo_numero: proximoNumero,
  }]);

  // TODO: Montar dados, gerar XML, assinar, enviar para prefeitura
  // TODO: Atualizar Odoo com resultado
  // TODO: Anexar XML + DANFSE no chatter

  console.log('[NFSE-EMIT] Fatura ' + move.name + ' (move_id=' + moveId + ') — logica de emissao sera implementada no proximo passo.');

  // Reverte para pendente (enquanto nao implementado)
  await executeKw(client, db, uid, pwd, 'account.move', 'write', [[moveId], {
    x_nytro_nfse_status: 'pendente',
    x_nytro_nfse_erro: 'Emissao NFS-e ainda nao implementada. Aguardando proximos passos.',
  }]);
}

async function safeUpdateError(client, db, uid, pwd, moveId, errMsg) {
  try {
    await executeKw(client, db, uid, pwd, 'account.move', 'write', [[moveId], {
      x_nytro_nfse_status: config.nfse.status_on_error || 'erro',
      x_nytro_nfse_erro: errMsg.substring(0, 1000),
    }]);
    // Mensagem no chatter
    await executeKw(client, db, uid, pwd, 'mail.message', 'create', [{
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
