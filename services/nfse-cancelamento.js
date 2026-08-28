/**
 * services/nfse-cancelamento.js — Cancelamento de NFS-e (SEFIN REST)
 * =================================================================
 * Desde 01/10/2025, cancelamento via API REST (evento 101101).
 * Envia pedido de cancelamento como evento na API SEFIN.
 */

const config = require('../config');
const { carregarCertificado } = require('./firebase-cert');
const axios = require('axios');
const https = require('https');
const zlib = require('zlib');
const { assinarXml } = require('./nfse-signer');

const NS = 'http://www.sped.fazenda.gov.br/nfse';

function createHttpsAgent(cert) {
  if (!cert) return null;
  const tlsOpts = { rejectUnauthorized: !config.tls_insecure };
  if (cert.pfx) {
    return new https.Agent({ ...tlsOpts, pfx: cert.pfx, passphrase: cert.senha || '' });
  }
  if (cert.privateKeyPem && cert.certPem) {
    return new https.Agent({ ...tlsOpts, key: cert.privateKeyPem, cert: cert.certPem });
  }
  return null;
}

function gzipBase64(str) {
  return new Promise((resolve, reject) => {
    zlib.gzip(Buffer.from(str, 'utf-8'), (err, compressed) => {
      if (err) return reject(err);
      resolve(compressed.toString('base64'));
    });
  });
}

/**
 * Cancela uma NFS-e ja autorizada.
 * Usa a API de eventos: POST /SefinNacional/nfse/{chaveAcesso}/eventos
 * @param {object} params
 * @returns {object} { sucesso, cStat, xMotivo }
 */
async function cancelarNfse(params) {
  const { nNFSe, nDFSe, cnpjPrest, justificativa, infNfseId } = params;
  console.log('[NFSE-CANCEL-SVC] cancelarNfse chamado | chaveAcesso=' + (params.chaveAcesso || '(vazio)') + ' | nNFSe=' + (nNFSe || 'n/a') + ' | cnpjPrest=' + (cnpjPrest || 'n/a'));

  const cert = await carregarCertificado();
  if (!cert || (!cert.pfx && !cert.privateKeyPem)) {
    console.log('[NFSE-CANCEL-SVC] ERRO: Certificado A1 nao disponivel');
    return { sucesso: false, cStat: 0, xMotivo: 'Certificado A1 nao disponivel' };
  }
  console.log('[NFSE-CANCEL-SVC] Certificado carregado com sucesso');

  // Se temos a chave de acesso, usamos a API de eventos
  if (params.chaveAcesso) {
    console.log('[NFSE-CANCEL-SVC] Chave de acesso presente, usando API de eventos...');
    return cancelarViaEvento(params, cert);
  }

  // Fallback: sem chave de acesso, nao e possivel cancelar via nova API
  console.log('[NFSE-CANCEL-SVC] BLOQUEADO: Sem chave de acesso, nao e possivel cancelar');
  return {
    sucesso: false,
    cStat: 0,
    xMotivo: 'Cancelamento requer chave de acesso da NFS-e (campo x_nytro_nfse_codigo_verificacao). Reemita a nota e tente novamente.',
  };
}

async function cancelarViaEvento(params, cert) {
  const { chaveAcesso, justificativa } = params;
  const baseUrl = config.nfse.tp_amb === 1 ? config.sefin.producao : config.sefin.homologacao;
  const url = baseUrl + '/nfse/' + chaveAcesso + '/eventos';
  console.log('[NFSE-CANCEL-SVC] URL do evento: ' + url);
  console.log('[NFSE-CANCEL-SVC] Ambiente: ' + (config.nfse.tp_amb === 1 ? 'PRODUCAO' : 'HOMOLOGACAO'));

  const dhEvento = new Date().toISOString().replace(/\./, ',').replace(/Z$/, '-03:00');
  const nSeqEvento = 1;

  // Gera XML do pedido de cancelamento (Evento 101101)
  const eventoXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<EventoNfse xmlns="' + NS + '" versao="1.01">' +
    '<infEvento Id="' + chaveAcesso + '101101' + nSeqEvento + '">' +
    '<chaveAcesso>' + chaveAcesso + '</chaveAcesso>' +
    '<tpEvento>101101</tpEvento>' +
    '<nSeqEvento>' + nSeqEvento + '</nSeqEvento>' +
    '<dhEvento>' + dhEvento + '</dhEvento>' +
    '<detEvento>' +
    '<evCancNfse>' +
    '<xJust>' + justificativa + '</xJust>' +
    '</evCancNfse>' +
    '</detEvento>' +
    '</infEvento>' +
    '</EventoNfse>';
  console.log('[NFSE-CANCEL-SVC] XML do evento gerado (' + eventoXml.length + ' bytes)');

  try {
    console.log('[NFSE-CANCEL-SVC] Assinando XML do evento...');
    const assinado = await assinarXml(eventoXml, {
      privateKeyPem: cert.privateKeyPem,
      certPem: cert.certPem,
    });
    console.log('[NFSE-CANCEL-SVC] XML assinado (' + assinado.length + ' bytes)');

    console.log('[NFSE-CANCEL-SVC] Comprimindo (gzip+base64)...');
    const eventoGzipB64 = await gzipBase64(assinado);
    console.log('[NFSE-CANCEL-SVC] Enviando POST para SEFIN... (gzipB64 length=' + eventoGzipB64.length + ')');

    const body = { pedidoRegistroEventoXmlGZipB64: eventoGzipB64 };

    const httpsAgent = createHttpsAgent(cert);
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      httpsAgent: httpsAgent || undefined,
      timeout: 30000,
      rejectUnauthorized: !config.tls_insecure,
      transformResponse: [data => data],
    });

    console.log('[NFSE-CANCEL-SVC] Resposta HTTP: ' + response.status + ' ' + response.statusText);

    let respJson = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    console.log('[NFSE-CANCEL-SVC] Resposta SEFIN: ' + JSON.stringify(respJson).substring(0, 500));

    if (respJson.erros && respJson.erros.length > 0) {
      const msg = respJson.erros.map(e => (e.codigo || '') + ' ' + (e.descricao || e.mensagem || '')).join('; ');
      console.log('[NFSE-CANCEL-SVC] ERRO retornado pela SEFIN: ' + msg);
      return { sucesso: false, cStat: 0, xMotivo: msg };
    }

    console.log('[NFSE-CANCEL-SVC] SUCESSO: Cancelamento registrado com sucesso na SEFIN');
    return {
      sucesso: true,
      cStat: 101,
      xMotivo: 'Cancelamento registrado com sucesso',
      dados: respJson,
    };
  } catch (err) {
    const msg = err.response
      ? 'HTTP ' + err.response.status + ': ' + JSON.stringify(err.response.data || '').substring(0, 300)
      : err.message;
    console.error('[NFSE-CANCEL-SVC] ERRO na comunicacao com SEFIN:', msg);
    if (err.stack) console.error('[NFSE-CANCEL-SVC] Stack:', err.stack);
    return { sucesso: false, cStat: 0, xMotivo: msg };
  }
}

module.exports = { cancelarNfse };
