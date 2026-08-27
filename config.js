/**
 * config.js — Configuracoes do middleware NFS-e Nytro
 * =======================================================
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

  // === NFS-e ===
  nfse: {
    uf: process.env.NFSE_UF || 'PR',
    cidade: process.env.NFSE_CIDADE || 'Curitiba',
    codigo_ibge: process.env.NFSE_CODIGO_IBGE || '4106902', // Curitiba
    tp_amb: parseInt(process.env.NFSE_TP_AMB || '2', 10), // 1=producao, 2=homologacao
    emissao_modo: process.env.NFSE_EMISSAO_MODO || 'proprio', // proprio | sieg
    serie: process.env.NFSE_SERIE || '1',
  },

  // === Odoo (autenticacao via API Key) ===
  odoo: {
    enabled: process.env.ODOO_ENABLED === '1',
    url: process.env.ODOO_URL || '',
    db: process.env.ODOO_DB || '',
    api_key: process.env.ODOO_API_KEY || '',
    polling_interval_ms: parseInt(process.env.ODOO_POLLING_MS || '15000', 10),
  },

  // === Webservice da Prefeitura (Curitiba - ABRASF v2) ===
  // URLs serao definidas quando confirmarmos o provedor municipal
  prefeitura: {
    homologacao: {
      receber_lote: process.env.PREF_HOM_RECEBER_LOTE || '',
      consultar_lote: process.env.PREF_HOM_CONSULTAR_LOTE || '',
      consultar_nfse: process.env.PREF_HOM_CONSULTAR_NFSE || '',
      cancelar_nfse: process.env.PREF_HOM_CANCELAR_NFSE || '',
    },
    producao: {
      receber_lote: process.env.PREF_PROD_RECEBER_LOTE || '',
      consultar_lote: process.env.PREF_PROD_CONSULTAR_LOTE || '',
      consultar_nfse: process.env.PREF_PROD_CONSULTAR_NFSE || '',
      cancelar_nfse: process.env.PREF_PROD_CANCELAR_NFSE || '',
    },
  },

  // === Seguranca ===
  tls_insecure: process.env.NFSE_TLS_INSECURE === '1',
  status_on_error: process.env.NFSE_STATUS_ON_ERROR || 'erro', // erro | pendente
};
