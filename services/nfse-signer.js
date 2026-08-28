/**
 * services/nfse-signer.js — Assinatura digital XMLDSig (RSA-SHA256)
 * ================================================================
 * Assina o elemento <infDPS> do XML DPS no padrao SPED NFS-e v1.01.
 * 
 * Algoritmos:
 *   - Canonicalization: http://www.w3.org/2001/10/xml-exc-c14n#WithComments
 *   - Signature:       http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
 *   - Digest:          http://www.w3.org/2001/04/xmlenc#sha256
 *   - Transform:       enveloped-signature + C14N WithComments
 * 
 * Implementacao string-based (sem XMLSerializer) para C14N deterministico.
 * O SEFIN re-canonizara o infDPS para verificar o digest, entao nosso C14N
 * deve produzir o mesmo resultado que o validador do SEFIN.
 */

const crypto = require('crypto');

const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const NS_SPED = 'http://www.sped.fazenda.gov.br/nfse';

// Algoritmos
const ALG_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments';
const ALG_SIG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/**
 * C14N simplificado via string: remove whitespace entre tags.
 * Preserva whitespace dentro de texto (conteudo de elementos folha).
 * Para o XML gerado por nfse-xml.js, isso produz saida identica ao
 * Exclusive C14N WithComments pois:
 * - Nao ha comentarios no XML
 * - Nao ha mixed content (texto + elementos misturados)
 * - Todos os elementos folha contem apenas texto
 * - O namespace padrao e o unico utilizado
 */
function c14nString(xml) {
  // Remove whitespace entre tags: >\s+<  → ><
  // Mas preserva whitespace dentro de texto (entre > e < ha texto)
  return xml.replace(/>\s+</g, '><');
}

/**
 * Extrai e canoniza o elemento infDPS do XML DPS gerado.
 * 
 * Em Exclusive C14N, ao canonizar um subarvore, o namespace utilizado
 * pelo elemento (e seus filhos) deve ser declarado no proprio elemento,
 * mesmo que tenha sido herdado do pai.
 * 
 * Nosso XML gerado tem: <DPS ... xmlns="http://...nfse"><infDPS Id="...">
 * O C14N do infDPS deve incluir xmlns na tag de abertura.
 */
function extractAndCanonicalizeInfDPS(xmlString, infDpsId) {
  // Localiza o infDPS no XML
  const openTag = '<infDPS Id="' + infDpsId + '">';
  const closeTag = '</infDPS>';
  const startIdx = xmlString.indexOf(openTag);
  
  if (startIdx === -1) {
    throw new Error('Nao foi possivel localizar <infDPS Id="' + infDpsId + '"> no XML');
  }
  
  const innerStart = startIdx + openTag.length;
  const endIdx = xmlString.indexOf(closeTag, innerStart);
  
  if (endIdx === -1) {
    throw new Error('Nao foi possivel localizar </infDPS> no XML');
  }
  
  const innerContent = xmlString.substring(innerStart, endIdx);
  
  // C14N do conteudo interno: remove whitespace entre tags
  const canonicalInner = c14nString(innerContent);
  
  // Monta infDPS canonico com namespace declarado (Exclusive C14N)
  // Atributos em ordem C14N: namespace declarations primeiro, depois os demais
  // xmlns (sem prefixo) vem antes de Id (alfabeticamente "x" > "I"? nao - 
  // na verdade C14N ordena por namespace URI, e xmlns sem prefixo tem URI vazia
  // que vem antes de atributos sem namespace. Ordem correta: xmlns, Id)
  const canonical = '<infDPS xmlns="' + NS_SPED + '" Id="' + infDpsId + '">' + canonicalInner + '</infDPS>';
  
  return canonical;
}

/**
 * Calcula digest SHA-256 de um texto (base64).
 */
function sha256Digest(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('base64');
}

/**
 * Assina um hash com a chave privada RSA-SHA256 (base64).
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
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

/**
 * Constroi o elemento SignedInfo para assinatura.
 * Os atributos em cada elemento ja estao em ordem alfabetica conforme C14N.
 */
function buildSignedInfo(infDpsId, digestValue) {
  // C14N do SignedInfo: sem whitespace entre tags
  // Em C14N, elementos vazios sao expandidos: <tag/> → <tag></tag>
  return '<SignedInfo xmlns="' + NS_DSIG + '">' +
    '<CanonicalizationMethod Algorithm="' + ALG_C14N + '"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="' + ALG_SIG + '"></SignatureMethod>' +
    '<Reference URI="#' + infDpsId + '">' +
    '<Transforms>' +
    '<Transform Algorithm="' + ALG_ENVELOPED + '"></Transform>' +
    '<Transform Algorithm="' + ALG_C14N + '"></Transform>' +
    '</Transforms>' +
    '<DigestMethod Algorithm="' + ALG_DIGEST + '"></DigestMethod>' +
    '<DigestValue>' + digestValue + '</DigestValue>' +
    '</Reference>' +
    '</SignedInfo>';
}

/**
 * Assina o XML DPS com XMLDSig (RSA-SHA256 + Exclusive C14N WithComments).
 * @param {string} xmlString - XML DPS completo (sem assinatura)
 * @param {object} cert - { privateKeyPem, certPem }
 * @returns {string} XML assinado
 */
async function assinarXml(xmlString, cert) {
  const { privateKeyPem, certPem } = cert;
  if (!privateKeyPem || !certPem) {
    throw new Error('Certificado ou chave privada nao disponivel para assinatura.');
  }

  // 1. Extrai o Id do infDPS do XML gerado
  const idMatch = xmlString.match(/<infDPS Id="([^"]+)"/);
  if (!idMatch) {
    throw new Error('Elemento infDPS nao encontrado no XML DPS.');
  }
  const infDpsId = idMatch[1];
  console.log('[NFSE-SIGNER] Assinando infDPS Id=' + infDpsId);

  // 2. Extrai e canoniza o infDPS (sem a assinatura)
  const c14nInfDPS = extractAndCanonicalizeInfDPS(xmlString, infDpsId);
  console.log('[NFSE-SIGNER] C14N infDPS length=' + c14nInfDPS.length);

  // 3. Calcula digest SHA-256 do infDPS canonico
  const digestValue = sha256Digest(c14nInfDPS);
  console.log('[NFSE-SIGNER] Digest=' + digestValue.substring(0, 20) + '...');

  // 4. Constroi SignedInfo canonico (com digest)
  const signedInfo = buildSignedInfo(infDpsId, digestValue);

  // 5. C14N do SignedInfo para assinar
  // SignedInfo ja e gerado sem whitespace, mas aplicamos c14nString por seguranca
  const signedInfoC14n = c14nString(signedInfo);

  // 6. Assina com RSA-SHA256
  const signatureValue = rsaSha256Sign(privateKeyPem, signedInfoC14n);
  console.log('[NFSE-SIGNER] Assinatura calculada (' + signatureValue.length + ' chars)');

  // 7. Extrai certificado base64
  const x509Cert = extractCertBase64(certPem);

  // 8. Monta Signature completo
  const fullSignature =
    '<Signature xmlns="' + NS_DSIG + '">' +
    '<SignedInfo>' +
    '<CanonicalizationMethod Algorithm="' + ALG_C14N + '"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="' + ALG_SIG + '"></SignatureMethod>' +
    '<Reference URI="#' + infDpsId + '">' +
    '<Transforms>' +
    '<Transform Algorithm="' + ALG_ENVELOPED + '"></Transform>' +
    '<Transform Algorithm="' + ALG_C14N + '"></Transform>' +
    '</Transforms>' +
    '<DigestMethod Algorithm="' + ALG_DIGEST + '"></DigestMethod>' +
    '<DigestValue>' + digestValue + '</DigestValue>' +
    '</Reference>' +
    '</SignedInfo>' +
    '<SignatureValue>' + signatureValue + '</SignatureValue>' +
    '<KeyInfo>' +
    '<X509Data>' +
    '<X509Certificate>' + x509Cert + '</X509Certificate>' +
    '</X509Data>' +
    '</KeyInfo>' +
    '</Signature>';

  // 9. Insere a assinatura no XML DPS (antes do fechamento </DPS>)
  let xmlAssinado = xmlString.replace('</DPS>', fullSignature + '</DPS>');

  console.log('[NFSE-SIGNER] XML assinado com sucesso. Tamanho: ' + xmlAssinado.length + ' bytes');
  return xmlAssinado;
}

module.exports = { assinarXml };
