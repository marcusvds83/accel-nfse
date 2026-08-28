/**
 * services/nfse-signer.js — Assinatura digital XMLDSig (RSA-SHA256)
 * ================================================================
 * Assina o elemento <infDPS> do XML DPS no padrao SPED NFS-e v1.01.
 * 
 * Algoritmos (conforme nfse-js, implementacao de referencia do SPED NFS-e Nacional):
 *   - Canonicalization: http://www.w3.org/TR/2001/REC-xml-c14n-20010315 (C14N 1.0)
 *   - Signature:       http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
 *   - Digest:          http://www.w3.org/2001/04/xmlenc#sha256
 *   - Transform:       enveloped-signature + C14N 1.0
 * 
 * Usa xml-crypto (node-saml fork) para C14N e assinatura corretas.
 */

const { SignedXml } = require('xml-crypto');
const crypto = require('crypto');

const NS_SPED = 'http://www.sped.fazenda.gov.br/nfse';

// Algoritmos do perfil National NFS-e XMLDSig (conforme dmnelson/nfse-js)
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALG_SIG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/**
 * Assina o XML DPS com XMLDSig (RSA-SHA256 + C14N 1.0).
 * @param {string} xmlString - XML DPS completo (sem assinatura)
 * @param {object} cert - { privateKeyPem, certPem }
 * @returns {string} XML assinado
 */
async function assinarXml(xmlString, cert) {
  const { privateKeyPem, certPem } = cert;
  if (!privateKeyPem || !certPem) {
    throw new Error('Certificado ou chave privada nao disponivel para assinatura.');
  }

  // Extrai o Id do infDPS para referenciar na assinatura
  const idMatch = xmlString.match(/<infDPS Id="([^"]+)"/);
  if (!idMatch) {
    throw new Error('Elemento infDPS nao encontrado no XML DPS.');
  }
  const infDpsId = idMatch[1];
  console.log('[NFSE-SIGNER] Assinando infDPS Id=' + infDpsId);

  // Cria o signador xml-crypto com perfil National NFS-e
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: ALG_SIG,
    canonicalizationAlgorithm: ALG_C14N,
  });

  // Adiciona referencia ao infDPS com transforms
  sig.addReference({
    xpath: "/*[local-name()='DPS' and namespace-uri()='" + NS_SPED + "']/*[local-name()='infDPS' and namespace-uri()='" + NS_SPED + "']",
    transforms: [ALG_ENVELOPED, ALG_C14N],
    digestAlgorithm: ALG_DIGEST,
  });

  // Adiciona informacao do certificado (X509Data)
  sig.keyInfoProvider = {
    getKeyInfo: () => {
      const certB64 = certPem
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s+/g, '');
      return '<X509Data><X509Certificate>' + certB64 + '</X509Certificate></X509Data>';
    },
  };

  // Calcula a assinatura
  sig.computeSignature(xmlString);
  const xmlAssinado = sig.getSignedXml();

  console.log('[NFSE-SIGNER] XML assinado com sucesso. Tamanho: ' + xmlAssinado.length + ' bytes');
  return xmlAssinado;
}

module.exports = { assinarXml };
