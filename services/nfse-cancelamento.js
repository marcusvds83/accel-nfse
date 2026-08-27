/**
 * services/nfse-cancelamento.js — Cancelamento de NFS-e
 * ==========================================================
 * Gera o XML de pedido de cancelamento e envia a prefeitura.
 *
 * NOTA: Será implementado junto com nfse-client.js quando
 *       tivermos as URLs exatas dos webservices.
 */

/**
 * Cancela uma NFS-e ja autorizada.
 * @param {object} params - { chave, numero, codigoVerificacao, justificativa, cert }
 * @returns {object} { sucesso, cStat, xMotivo, nProt }
 */
async function cancelarNfse(params) {
  console.log('[NFSE-CANCEL] cancelarNfse() — stub');
  return { sucesso: false, cStat: 0, xMotivo: 'Nao implementado ainda' };
}

module.exports = { cancelarNfse };
