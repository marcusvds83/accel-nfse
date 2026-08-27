/**
 * services/nfse-client.js — Cliente SOAP da Prefeitura de Curitiba
 * ==============================================================
 * Comunica com o webservice NFS-e da prefeitura usando SOAP 1.2
 * com certificado digital A1 (mTLS) quando necessario.
 *
 * NOTA: Este arquivo sera implementado quando tivermos as URLs
 *       exatas dos webservices de Curitiba.
 *       Por enquanto exporta funcoes stubs.
 */

const config = require('../config');

/**
 * Envia lote de RPS para a prefeitura.
 * @param {string} xml - XML do lote assinado
 * @param {object} cert - { pfx, certPem, chainPem }
 * @returns {object} { sucesso, cStat, xMotivo, numero, codigoVerificacao, xmlRetorno }
 */
async function enviarLote(xml, cert) {
  console.log('[NFSE-CLIENT] enviarLote() — stub (Curitiba ABRASF v2)');
  return { sucesso: false, cStat: 0, xMotivo: 'Nao implementado ainda' };
}

/**
 * Consulta o protocolo de envio do lote.
 * @param {string} protocolo - Numero do protocolo retornado no envio
 * @param {object} cert - { pfx, certPem, chainPem }
 * @returns {object} { sucesso, cStat, xMotivo, nfse: [...] }
 */
async function consultarLote(protocolo, cert) {
  console.log('[NFSE-CLIENT] consultarLote() — stub');
  return { sucesso: false, cStat: 0, xMotivo: 'Nao implementado ainda' };
}

/**
 * Consulta uma NFS-e pelo numero.
 */
async function consultarNfse(numero, cert) {
  console.log('[NFSE-CLIENT] consultarNfse() — stub');
  return { sucesso: false, cStat: 0, xMotivo: 'Nao implementado ainda' };
}

/**
 * Testa a conexao com o webservice da prefeitura.
 */
async function testarConexao(cert) {
  console.log('[NFSE-CLIENT] testarConexao() — stub');
  return { online: false, mensagem: 'Webservice nao configurado ainda' };
}

/** Retorna o endpoint correto conforme o ambiente */
function endpoint(tipo) {
  const amb = config.nfse.tp_amb === 1 ? 'producao' : 'homologacao';
  return config.prefeitura[amb][tipo] || '';
}

module.exports = { enviarLote, consultarLote, consultarNfse, testarConexao, endpoint };
