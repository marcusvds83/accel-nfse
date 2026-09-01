/**
 * config.js — Configuracoes do middleware NFS-e/NF-e Accel (SPED NFS-e + NF-e SEFAZ)
 * =================================================================
 * Todas as configuracoes sao lidas de variaveis de ambiente.
 * No Render, defina-as no painel Environment Variables.
 */

module.exports = {
  // === Servidor ===
  port: parseInt(process.env.PORT || '3000', 10),
  apiKey: process.env.API_KEY || '',

  // === Firebase (cofre do certificado A1) ===
  firebase: {
    project_id: process.env.FIREBASE_PROJECT_ID || '',
    private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL || '',
    collection: process.env.FIREBASE_CERT_COLLECTION || 'certificados',
    doc_id: process.env.FIREBASE_CERT_DOC_ID || 'nytro-a1',
  },

  // === NFS-e SPED ===
  nfse: {
    uf: process.env.NFSE_UF || 'PR',
    cidade: process.env.NFSE_CIDADE || 'Curitiba',
    codigo_ibge: process.env.NFSE_CODIGO_IBGE || '4106902',
    tp_amb: parseInt(process.env.NFSE_TP_AMB || '2', 10), // 1=producao, 2=homologacao
    // Serie: emissao propria (own-app) exige 1-49999. Ignora env var se fora da faixa.
    serie: (() => { const s = process.env.NFSE_SERIE || '1'; const n = parseInt(s, 10); return (n >= 1 && n <= 49999) ? s : '1'; })(),
    versao: process.env.NFSE_VERSAO || '1.01',
    ver_aplic: process.env.NFSE_VER_APLIC || 'accel-nfse_1.0.0',
    inscricao_municipal: process.env.NFSE_IM || '170110079908',
    // Regime tributario (Simples Nacional)
    op_simp_nac: parseInt(process.env.NFSE_OP_SIMP_NAC || '3', 10), // 3=Simples Nacional
    reg_ap_trib_sn: parseInt(process.env.NFSE_REG_AP_TRIB_SN || '1', 10),
    reg_esp_trib: parseInt(process.env.NFSE_REG_ESP_TRIB || '0', 10),
    // Codigo de servico padrao (LC 116 / NBS)
    c_trib_nac_padrao: process.env.NFSE_C_TRIB_NAC || '080201',
    c_nbs_padrao: process.env.NFSE_C_NBS || '122051900',
    // Aliquota ISS
    aliquota_iss: parseFloat(process.env.NFSE_ALIQUOTA_ISS || '5.00'),
    // Carga tributaria total SN
    p_tot_trib_sn: parseFloat(process.env.NFSE_P_TOT_TRIB_SN || '6.00'),
  },

  // === Odoo (autenticacao via email + API Key) ===
  odoo: {
    enabled: process.env.ODOO_ENABLED === '1',
    url: process.env.ODOO_URL || '',
    db: process.env.ODOO_DB || '',
    user: process.env.ODOO_USER || '', // email de login
    api_key: process.env.ODOO_API_KEY || '',
    polling_interval_ms: parseInt(process.env.ODOO_POLLING_MS || '15000', 10),
  },

  // === API REST SEFIN NFS-e (desde 01/10/2025 — substituiu SOAP) ===
  // Homologacao (Producao Restrita): https://sefin.producaorestrita.nfse.gov.br/SefinNacional/
  // Producao: https://sefin.nfse.gov.br/SefinNacional/
  // Formato: JSON com XML DPS compactado em GZip+Base64, mTLS
  sefin: {
    homologacao: process.env.SEFIN_HOM_URL || 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
    producao: process.env.SEFIN_PROD_URL || 'https://sefin.nfse.gov.br/SefinNacional',
  },

  // === Seguranca ===
  tls_insecure: process.env.NFSE_TLS_INSECURE === '1',
  status_on_error: process.env.NFSE_STATUS_ON_ERROR || 'erro',
};
