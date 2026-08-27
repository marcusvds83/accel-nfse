/**
 * services/nfse-signer.js — Assinatura digital XMLDSig RSA-SHA1
 * ==============================================================*
 * Assina o grupo <InfDeclaracaoPrestacaoServico> (ou <Rps>) do XML NFS-e
 * usando o certificado A1 carregado do Firebase.
 *
 * NOTA: Este arquivo sera implementado no proximo passo.
 *       Por enquanto exporta funcoes stubs.
 */

const { XMLSerializer } = require('xmldom') || {};

/**
 * Assina o XML da NFS-e com XMLDSig (RSA-SHA1 + C14N).
 * @param {string} xml - XML da NFS-e completo
 * @param {object} cert - { privateKeyPem, certPem }
 * @returns {string} XML assinado
 */
async function assinarXml(xml, cert) {
  // TODO: Implementar no proximo passo
  console.log('[NFSE-SIGNER] assinarXml() — stub, sera implementado com C14N + RSA-SHA1');
  return xml;
}

module.exports = { assinarXml };
