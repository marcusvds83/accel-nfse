/**
 * services/nfse-client.js — Cliente SOAP do SPED NFS-e
 * ======================================================
 * Comunica com o webservice nacional SPED NFS-e (nfse.gov.br)
 * usando SOAP 1.2 com XML assinado.
 */

const axios = require('axios');
const https = require('https');
const config = require('../config');
const { carregarCertificado } = require('./firebase-cert');

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SPED_NS = 'http://www.sped.fazenda.gov.br/nfse';

/** Retorna o endpoint conforme ambiente */
function getEndpoint() {
  return config.nfse.tp_amb === 1
    ? config.prefeitura.producao
    : config.prefeitura.homologacao;
}

/** Cria agente HTTPS com certificado A1 (mTLS) */
function createHttpsAgent(cert) {
  if (!cert) return null;
  const tlsOpts = { rejectUnauthorized: !config.tls_insecure };

  // 1. Tenta PFX com senha correta (mais confiavel)
  if (cert.pfx) {
    console.log('[NFSE-CLIENT] Usando PFX para mTLS (pfx=' + cert.pfx.length + ' bytes, senha=' + (cert.senha ? 'sim' : 'nao') + ')');
    return new https.Agent({ ...tlsOpts, pfx: cert.pfx, passphrase: cert.senha || '' });
  }

  // 2. Fallback PEM
  if (cert.privateKeyPem && cert.certPem) {
    console.log('[NFSE-CLIENT] Usando PEM para mTLS (key=' + cert.privateKeyPem.length + ' bytes, cert=' + cert.certPem.length + ' bytes)');
    return new https.Agent({ ...tlsOpts, key: cert.privateKeyPem, cert: cert.certPem });
  }

  console.warn('[NFSE-CLIENT] Nenhum certificado disponivel para mTLS!');
  return null;
}

/**
 * Envia DPS assinado para o SPED NFS-e.
 * @param {string} dpsXmlAssinado - XML DPS completo com assinatura
 * @param {object} cert - { pfx, certPem, chainPem, privateKeyPem }
 * @returns {object} { sucesso, cStat, xMotivo, nNFSe, nDFSe, xmlRetorno }
 */
async function enviarDPS(dpsXmlAssinado, cert) {
  const endpoint = getEndpoint();
  if (!endpoint) {
    return { sucesso: false, cStat: 0, xMotivo: 'Endpoint SPED NFS-e nao configurado' };
  }

  console.log('[NFSE-CLIENT] Enviando DPS para ' + endpoint);

  // Monta SOAP envelope
  const soapEnvelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:nfse="${SPED_NS}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<nfse:ReceberDPS>` +
    `<nfse:nfseCabecMsg><![CDATA[<?xml version="1.0" encoding="UTF-8"?><cabecMsg xmlns="${SPED_NS}" versao="${config.nfse.versao}"><versaoDados>${config.nfse.versao}</versaoDados></cabecMsg>]]></nfse:nfseCabecMsg>` +
    `<nfse:nfseDadosMsg><![CDATA[${dpsXmlAssinado}]]></nfse:nfseDadosMsg>` +
    `</nfse:ReceberDPS>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`;

  try {
    const httpsAgent = createHttpsAgent(cert);
    const response = await axios.post(endpoint, soapEnvelope, {
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': '"' + SPED_NS + '/NfseServico/ReceberDPS"',
      },
      httpsAgent: httpsAgent || undefined,
      timeout: 30000,
      // Aceita auto-signed certs em homologacao
      rejectUnauthorized: !config.tls_insecure,
    });

    const xmlRetorno = response.data;
    console.log('[NFSE-CLIENT] Resposta recebida (' + (xmlRetorno || '').length + ' bytes)');

    // Parseia resposta - procura por cStat e xMotivo
    const cStatMatch = (xmlRetorno || '').match(/<cStat>(\d+)<\/cStat>/);
    const xMotivoMatch = (xmlRetorno || '').match(/<xMotivo>([^<]+)<\/xMotivo>/);
    const nNFSeMatch = (xmlRetorno || '').match(/<nNFSe>(\d+)<\/nNFSe>/);
    const nDFSeMatch = (xmlRetorno || '').match(/<nDFSe>(\d+)<\/nDFSe>/);
    const nProtMatch = (xmlRetorno || '').match(/<nProt>([^<]*)<\/nProt>/);

    const cStat = cStatMatch ? parseInt(cStatMatch[1], 10) : 0;
    const xMotivo = xMotivoMatch ? xMotivoMatch[1] : 'Sem motivo';
    const nNFSe = nNFSeMatch ? nNFSeMatch[1] : null;
    const nDFSe = nDFSeMatch ? nDFSeMatch[1] : null;

    // cStat 100 = autorizado (SPED)
    const sucesso = cStat === 100;

    console.log('[NFSE-CLIENT] cStat=' + cStat + ' xMotivo=' + xMotivo + ' nNFSe=' + nNFSe);

    return {
      sucesso,
      cStat,
      xMotivo,
      nNFSe,
      nDFSe,
      nProt: nProtMatch ? nProtMatch[1] : null,
      xmlRetorno,
    };
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status}: ${(err.response.data || '').substring(0, 300)}`
      : err.message;
    console.error('[NFSE-CLIENT] Erro ao enviar DPS:', msg);
    return { sucesso: false, cStat: 0, xMotivo: msg };
  }
}

/**
 * Consulta uma NFS-e pelo numero.
 */
async function consultarNfse(numero, cert) {
  const endpoint = getEndpoint();
  if (!endpoint) {
    return { sucesso: false, cStat: 0, xMotivo: 'Endpoint nao configurado' };
  }

  const cnpjPrest = config.odoo.cnpj_prestador || '';
  const ibge = config.nfse.codigo_ibge;

  const soapEnvelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:nfse="${SPED_NS}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<nfse:ConsultarNfse>` +
    `<nfse:nfseCabecMsg><![CDATA[<?xml version="1.0" encoding="UTF-8"?><cabecMsg xmlns="${SPED_NS}" versao="${config.nfse.versao}"><versaoDados>${config.nfse.versao}</versaoDados></cabecMsg>]]></nfse:nfseCabecMsg>` +
    `<nfse:nfseDadosMsg><![CDATA[<?xml version="1.0" encoding="UTF-8"?><consNfse xmlns="${SPED_NS}" versao="${config.nfse.versao}"><cnpjPrestador>${cnpjPrest}</cnpjPrestador><nNFSe>${numero}</nNFSe></consNfse>]]></nfse:nfseDadosMsg>` +
    `</nfse:ConsultarNfse>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`;

  try {
    const httpsAgent = createHttpsAgent(cert);
    const response = await axios.post(endpoint, soapEnvelope, {
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
      },
      httpsAgent: httpsAgent || undefined,
      timeout: 15000,
      rejectUnauthorized: !config.tls_insecure,
    });

    return {
      sucesso: true,
      xmlRetorno: response.data,
    };
  } catch (err) {
    return { sucesso: false, cStat: 0, xMotivo: err.message };
  }
}

/**
 * Testa conexao com o webservice SPED.
 */
async function testarConexao(cert) {
  const endpoint = getEndpoint();
  if (!endpoint) {
    return { online: false, mensagem: 'Endpoint nao configurado' };
  }

  try {
    await axios.get(endpoint.replace(/NfseServico\.svc.*/, '') + '?wsdl', {
      timeout: 10000,
      rejectUnauthorized: !config.tls_insecure,
    });
    return { online: true, mensagem: 'Conexao OK com ' + endpoint };
  } catch (err) {
    return { online: false, mensagem: 'Falha: ' + err.message.substring(0, 100) };
  }
}

module.exports = { enviarDPS, consultarNfse, testarConexao, getEndpoint };
