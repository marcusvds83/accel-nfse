/**
 * routes/nfse-cert.js — Rotas de gerenciamento do certificado A1
 * =================================================================
 * Upload, status e remocao do certificado via Firebase.
 * Todas as rotas exigem o header x-api-key.
 */

const express = require('express');
const router = express.Router();
const { salvarCertificado, carregarCertificado, statusCertificado, removerCertificado } = require('../services/firebase-cert');

// === Autenticacao ===
function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ erro: 'API key invalida' });
  }
  next();
}

// === Upload do certificado ===
router.post('/', apiKeyAuth, async (req, res) => {
  try {
    const { pfxBase64, senha } = req.body;
    if (!pfxBase64) return res.status(400).json({ erro: 'pfxBase64 obrigatorio' });
    if (!senha) return res.status(400).json({ erro: 'senha obrigatoria' });

    const pfx = Buffer.from(pfxBase64, 'base64');
    const info = await salvarCertificado(pfx, senha);
    res.json({ sucesso: true, info });
  } catch (err) {
    console.error('[CERT] Erro ao salvar:', err.message);
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// === Status do certificado ===
router.get('/', apiKeyAuth, async (req, res) => {
  try {
    const status = await statusCertificado();
    res.json(status);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// === Remover certificado ===
router.delete('/', apiKeyAuth, async (req, res) => {
  try {
    await removerCertificado();
    res.json({ sucesso: true, mensagem: 'Certificado removido do Firebase.' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// === Testar conexao com prefeitura (usa o certificado) ===
router.get('/prefeitura/status', apiKeyAuth, async (req, res) => {
  try {
    const cert = await carregarCertificado();
    if (!cert) return res.status(400).json({ erro: 'Nenhum certificado carregado.' });
    const { testarConexao } = require('../services/nfse-client');
    const resultado = await testarConexao(cert);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
