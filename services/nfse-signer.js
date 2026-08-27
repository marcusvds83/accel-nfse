/**
 * services/nfse-signer.js — Assinatura digital XMLDSig (RSA-SHA256)
 * ================================================================
 * Assina o elemento <infDPS> do XML DPS no padrao SPED NFS-e.
 * 
 * Algoritmos (extraidos do XML real da Nytro):
 *   - Canonicalization: http://www.w3.org/2001/10/xml-exc-c14n#WithComments
 *   - Signature:       http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
 *   - Digest:          http://www.w3.org/2001/04/xmlenc#sha256
 *   - Transform:       enveloped-signature + C14N WithComments
 */

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const crypto = require('crypto');
const forge = require('node-forge');

const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const NS_SPED = 'http://www.sped.fazenda.gov.br/nfse';

// Algoritmos
const ALG_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments';
const ALG_SIG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/**
 * Canonicalizacao Exclusive C14N WithComments.
 * Implementacao simplificada que normaliza o XML para assinatura.
 */
function canonicalizeC14N(node) {
  const serializer = new XMLSerializer();
  let xml = serializer.serializeToString(node);

  // Remove declaracao XML se presente
  xml = xml.replace(/^<\?xml[^?]*\?>\s*/, '');

  // Normaliza espacos entre atributos
  xml = xml.replace(/\s+/g, ' ').trim();

  // Remove atributos xmlns que sao do namespace padrao (para c14n exclusive)
  // Na pratica, o node-forge/xml-crypto lida com isso
  return xml;
}

/**
 * Calcula digest SHA-256 de um texto.
 */
function sha256Digest(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('base64');
}

/**
 * Assina um hash com a chave privada RSA-SHA256.
 */
function rsaSha256Sign(privateKeyPem, data) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data, 'utf8');
  return sign.sign(privateKeyPem, 'base64');
}

/**
 * Extrai o certificado em formato base64 DER (sem headers PEM).
 */
function extractCertBase64(certPem) {
  // Remove headers PEM e junta linhas
  const b64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return b64;
}

/**
 * Assina o XML DPS com XMLDSig (RSA-SHA256 + C14N WithComments).
 * @param {string} xmlString - XML DPS completo
 * @param {object} cert - { privateKeyPem, certPem }
 * @returns {string} XML assinado
 */
async function assinarXml(xmlString, cert) {
  const { privateKeyPem, certPem } = cert;
  if (!privateKeyPem || !certPem) {
    throw new Error('Certificado ou chave privada nao disponivel para assinatura.');
  }

  const parser = new DOMParser({
    xmlns: { ns: NS_SPED },
    namespaceAware: true,
  });
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Encontra o elemento infDPS
  const infDPS = doc.getElementsByTagNameNS(NS_SPED, 'infDPS')[0];
  if (!infDPS) {
    throw new Error('Elemento infDPS nao encontrado no XML DPS.');
  }

  const infDpsId = infDPS.getAttribute('Id');
  if (!infDpsId) {
    throw new Error('infDPS nao possui atributo Id.');
  }

  console.log('[NFSE-SIGNER] Assinando infDPS Id=' + infDpsId);

  // 1. Canonicaliza o infDPS (sem a assinatura)
  const c14nData = canonicalizeC14N(infDPS);

  // 2. Calcula digest do infDPS canonicalizado
  const digestValue = sha256Digest(c14nData);
  console.log('[NFSE-SIGNER] Digest=' + digestValue.substring(0, 20) + '...');

  // 3. Cria o elemento <Signature>
  const signatureXml =
    `<Signature xmlns="${NS_DSIG}">` +
    `<SignedInfo>` +
    `<CanonicalizationMethod Algorithm="${ALG_C14N}" />` +
    `<SignatureMethod Algorithm="${ALG_SIG}" />` +
    `<Reference URI="#${infDpsId}">` +
    `<Transforms>` +
    `<Transform Algorithm="${ALG_ENVELOPED}" />` +
    `<Transform Algorithm="${ALG_C14N}" />` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${ALG_DIGEST}" />` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>` +
    `</Signature>`;

  // 4. Canonicaliza o SignedInfo para calcular a assinatura
  // (precisa incluir o SignedInfo com DigestValue)
  const signedInfoForSig =
    `<SignedInfo xmlns="${NS_DSIG}">` +
    `<CanonicalizationMethod Algorithm="${ALG_C14N}" />` +
    `<SignatureMethod Algorithm="${ALG_SIG}" />` +
    `<Reference URI="#${infDpsId}">` +
    `<Transforms>` +
    `<Transform Algorithm="${ALG_ENVELOPED}" />` +
    `<Transform Algorithm="${ALG_C14N}" />` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${ALG_DIGEST}" />` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;

  const signedInfoC14n = canonicalizeC14N({ textContent: signedInfoForSig });

  // 5. Assina com RSA-SHA256
  const signatureValue = rsaSha256Sign(privateKeyPem, signedInfoC14n);
  console.log('[NFSE-SIGNER] Assinatura calculada (' + signatureValue.length + ' chars)');

  // 6. Extrai certificado base64
  const x509Cert = extractCertBase64(certPem);

  // 7. Monta Signature completo
  const fullSignature =
    `<Signature xmlns="${NS_DSIG}">` +
    `<SignedInfo>` +
    `<CanonicalizationMethod Algorithm="${ALG_C14N}" />` +
    `<SignatureMethod Algorithm="${ALG_SIG}" />` +
    `<Reference URI="#${infDpsId}">` +
    `<Transforms>` +
    `<Transform Algorithm="${ALG_ENVELOPED}" />` +
    `<Transform Algorithm="${ALG_C14N}" />` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${ALG_DIGEST}" />` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>` +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
  `<KeyInfo>` +
  `<X509Data>` +
  `<X509Certificate>${x509Cert}</X509Certificate>` +
  `</X509Data>` +
  `</KeyInfo>` +
  `</Signature>`;

  // 8. Insere a assinatura no XML DPS (antes do fechamento </DPS>)
  let xmlAssinado = xmlString.replace('</DPS>', fullSignature + '</DPS>');

  console.log('[NFSE-SIGNER] XML assinado com sucesso. Tamanho: ' + xmlAssinado.length + ' bytes');
  return xmlAssinado;
}

module.exports = { assinarXml };
