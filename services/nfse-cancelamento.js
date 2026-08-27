/**
 * services/nfse-cancelamento.js — Cancelamento de NFS-e (SPED)
 * ==========================================================
 * Gera pedido de cancelamento e envia ao SPED NFS-e.
 */

const config = require('../config');
const { carregarCertificado } = require('./firebase-cert');
const axios = require('axios');
const { assinarXml } = require('./nfse-signer');

const NS = 'http://www.sped.fazenda.gov.br/nfse';

/**
 * Cancela uma NFS-e ja autorizada.
 * @param {object} params
 * @param {string} params.nNFSe  - Numero da NFS-e
 * @param {string} params.nDFSe  - Numero do DFSe
 * @param {string} params.cnpjPrest - CNPJ do prestador
 * @param {string} params.justificativa - Motivo do cancelamento
 * @param {string} params.infNfseId - Id do infNFSe (para assinatura)
 * @param {string} params.xmlNfse - XML completo da NFS-e autorizada
 * @returns {object} { sucesso, cStat, xMotivo }
 */
async function cancelarNfse(params) {
  const { nNFSe, nDFSe, cnpjPrest, justificativa, infNfseId } = params;

  const cert = await carregarCertificado();
  if (!cert || !cert.privateKeyPem) {
    return { sucesso: false, cStat: 0, xMotivo: 'Certificado A1 nao disponivel' };
  }

  const ibge = config.nfse.codigo_ibge;
  const dhCancel = new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00');

  // Gera XML de cancelamento
  const cancelXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<PedidoCancelamento xmlns="${NS}" versao="${config.nfse.versao}">` +
    `<infPedidoCancel Id="Can${ibge}${cnpjPrest}${nNFSe}">` +
    `<tpAmb>${config.nfse.tp_amb}</tpAmb>` +
    `<nNFSe>${nNFSe}</nNFSe>` +
    `<xJust>${justificativa}</xJust>` +
    `<dhCancel>${dhCancel}</dhCancel>` +
    `</infPedidoCancel>` +
    `</PedidoCancelamento>`;

  // Assina
  const assinado = await assinarXml(cancelXml, {
    privateKeyPem: cert.privateKeyPem,
    certPem: cert.certPem,
  });

  // Envia via SOAP
  const endpoint = config.nfse.tp_amb === 1
    ? config.prefeitura.producao
    : config.prefeitura.homologacao;

  const soapEnvelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="${NS}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<nfse:CancelarNfse>` +
    `<nfse:nfseCabecMsg><![CDATA[<?xml version="1.0" encoding="UTF-8"?><cabecMsg xmlns="${NS}" versao="${config.nfse.versao}"><versaoDados>${config.nfse.versao}</versaoDados></cabecMsg>]]></nfse:nfseCabecMsg>` +
    `<nfse:nfseDadosMsg><![CDATA[${assinado}]]></nfse:nfseDadosMsg>` +
    `</nfse:CancelarNfse>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`;

  try {
    const response = await axios.post(endpoint, soapEnvelope, {
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
      },
      timeout: 30000,
      rejectUnauthorized: !config.tls_insecure,
    });

    const xml = response.data || '';
    const cStatMatch = xml.match(/<cStat>(\d+)<\/cStat>/);
    const xMotivoMatch = xml.match(/<xMotivo>([^<]+)<\/xMotivo>/);

    const cStat = cStatMatch ? parseInt(cStatMatch[1], 10) : 0;
    const xMotivo = xMotivoMatch ? xMotivoMatch[1] : 'Sem resposta';

    return { sucesso: cStat === 101 || cStat === 100, cStat, xMotivo, xmlRetorno: xml };
  } catch (err) {
    return { sucesso: false, cStat: 0, xMotivo: err.message };
  }
}

module.exports = { cancelarNfse };
