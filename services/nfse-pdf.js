/**
 * services/nfse-pdf.js — Gerador de PDF DANFSE (modelo SEFIN/DANFSe v2.0)
 * ====================================================================
 * Replica fielmente o layout oficial do DANFSE Nacional, com:
 *   - Logo da empresa no cabecalho
 *   - QR Code da chave de acesso
 *   - Grid 4 colunas com linhas 0.5pt
 *   - Secoes: Identificacao, Prestador, Tomador, Servico, Tributacao, Valores
 *   - Rodape com tributos aproximados (Lei 12.741/2012)
 */

const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const path = require('path');
const fs = require('fs');

// === Carrega logo como Buffer (com fallback para texto) ===
let LOGO_BUF = null;
try {
  const logoPath = path.join(__dirname, '..', 'assets', 'logo-nytro.png');
  if (fs.existsSync(logoPath)) LOGO_BUF = fs.readFileSync(logoPath);
} catch (_) {}

// === Tenta baixar a logo do Odoo ao iniciar (fallback async) ===
async function ensureLogo() {
  if (LOGO_BUF) return LOGO_BUF;
  try {
    const logoUrl = process.env.ODOO_LOGO_URL || '';
    if (logoUrl) {
      const resp = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        LOGO_BUF = Buffer.from(arrayBuf);
        console.log('[NFSE-PDF] Logo baixada do Odoo: ' + LOGO_BUF.length + ' bytes');
      }
    }
  } catch (_) {}
  return LOGO_BUF;
}

// === Helpers de formatacao ===

function fmtCnpj(cnpj) {
  const d = (cnpj || '').replace(/[^0-9]/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return cnpj || '';
}

function fmtCep(cep) {
  const d = (cep || '').replace(/[^0-9]/g, '');
  if (d.length === 8) return d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return cep || '';
}

function fmtMoeda(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}

function fmtFone(f) {
  const d = (f || '').replace(/[^0-9]/g, '');
  if (d.length === 11) return '(' + d.substring(0, 2) + ') ' + d.substring(2, 7) + '-' + d.substring(7);
  if (d.length === 10) return '(' + d.substring(0, 2) + ') ' + d.substring(2, 6) + '-' + d.substring(6);
  return f || '';
}

function fmtDataHora(iso) {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    const ss = String(dt.getSeconds()).padStart(2, '0');
    return dd + '/' + mm + '/' + yy + ' ' + hh + ':' + mi + ':' + ss;
  } catch (_) { return iso; }
}

function fmtData(iso) {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    return dd + '/' + mm + '/' + yy;
  } catch (_) { return iso; }
}

function fmtCNAE(c) {
  const d = (c || '').replace(/[^0-9]/g, '');
  if (d.length === 6) return d.substring(0, 2) + '.' + d.substring(2, 4) + '.' + d.substring(4);
  return c || '';
}

function fmtNBS(c) {
  const d = (c || '').replace(/[^0-9]/g, '');
  if (d.length === 9) return d.substring(0, 1) + '.' + d.substring(1, 5) + '.' + d.substring(5, 7) + '.' + d.substring(7);
  return c || '';
}

function fmtIBGE(ibge) {
  const d = (ibge || '').replace(/[^0-9]/g, '');
  if (d.length === 7) return d.substring(0, 2) + '.' + d.substring(2);
  return ibge || '';
}

/** Extrai texto de tag XML */
function xmlTag(xml, tag) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '[^>]*>([\\s\\S]*?)<\/(?:\\w+:)?' + tag + '>', 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

/** Extrai valor de atributo */
function xmlAttr(xml, tag, attr) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '\\s[^>]*' + attr + '="([^"]*)"', 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

/** Gera QR Code como PNG buffer */
function generateQR(text) {
  return new Promise((resolve, reject) => {
    try {
      const buf = bwipjs.toBuffer({
        bcid: 'qrcode',
        text: text || ' ',
        scale: 3,
        height: 10,
        includetext: false,
      });
      resolve(buf);
    } catch (e) { reject(e); }
  });
}

// === Layout constants (A4, grid 4 colunas) ===
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 5;
const COLS = [9, 153, 298, 442, 587]; // x positions das 4 colunas
const COL_W = [144, 145, 144, 145]; // largura de cada coluna
const GRAY_BG = '#F2F2F2';
const LINE_COLOR = '#000000';
const LINE_W = 0.5;
const PAD = 4; // padding interno das celulas

// === Drawing helpers ===

function hline(doc, y, x0, x1) {
  doc.moveTo(x0, y).lineTo(x1, y).lineWidth(LINE_W).strokeColor(LINE_COLOR).stroke();
}

function vline(doc, x, y0, y1) {
  doc.moveTo(x, y0).lineTo(x, y1).lineWidth(LINE_W).strokeColor(LINE_COLOR).stroke();
}

/** Preenche fundo de uma celula */
function fillCell(doc, x, y, w, h, color) {
  if (color) doc.rect(x, y, w, h).fill(color);
}

/** Rotulo bold 6pt */
function label(doc, x, y, text, w) {
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#000000');
  doc.text(text, x + PAD, y + 3, { width: w - PAD * 2, lineBreak: false });
}

/** Valor normal 7pt */
function value(doc, x, y, text, w, opts) {
  doc.font('Helvetica').fontSize(7).fillColor('#000000');
  doc.text(text, x + PAD, y + 3, { width: w - PAD * 2, lineBreak: !!(opts && opts.multiline), ...opts });
}

/** Secao header (fundo cinza, texto bold 7pt) */
function sectionHeader(doc, y, text, colStart, colEnd) {
  const x0 = COLS[colStart || 0];
  const x1 = COLS[colEnd || 4];
  fillCell(doc, x0, y, x1 - x0, 19, GRAY_BG);
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000000');
  doc.text(text, x0 + PAD, y + 6, { width: x1 - x0 - PAD * 2, lineBreak: false });
}

/** Desenha grid horizontal completo */
function gridH(doc, y, numCols) {
  for (let i = 0; i <= numCols; i++) {
    vline(doc, COLS[i], y, y + 19);
  }
}

/** Desenha grid horizontal completo com altura custom */
function gridHFull(doc, y, h) {
  hline(doc, y, COLS[0], COLS[4]);
  hline(doc, y + h, COLS[0], COLS[4]);
  for (let i = 1; i < 4; i++) {
    vline(doc, COLS[i], y, y + h);
  }
}

// === Gerador principal ===

async function gerarPdfDanfse(nfseXml) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, bufferPages: true });
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    // --- Parseia dados do XML ---
    const Id = xmlAttr(nfseXml, 'infNFSe', 'Id') || '';
    const chaveAcesso = Id.replace('NFS', '');
    const nNFSe = xmlTag(nfseXml, 'nNFSe') || '-';
    const nDFSe = xmlTag(nfseXml, 'nDFSe') || '-';
    const dhProc = xmlTag(nfseXml, 'dhProc');
    const xLocEmi = xmlTag(nfseXml, 'xLocEmi') || '';
    const xLocPrestacao = xmlTag(nfseXml, 'xLocPrestacao') || '';
    const xTribNac = xmlTag(nfseXml, 'xTribNac') || '';
    const xNBSLabel = xmlTag(nfseXml, 'xNBS') || '';
    const verAplic = xmlTag(nfseXml, 'verAplic') || '';
    const ambGer = xmlTag(nfseXml, 'ambGer') || '2';
    const vLiq = xmlTag(nfseXml, 'vLiq') || '0';

    // Emitente (preenchido pela SEFIN no XML externo)
    const emitMatch = nfseXml.match(/<emit>[\s\S]*?<\/emit>/i);
    const emitXml = emitMatch ? emitMatch[0] : '';
    const emitCnpj = xmlTag(emitXml, 'CNPJ');
    const emitNome = xmlTag(emitXml, 'xNome');
    const emitLgr = xmlTag(emitXml, 'xLgr');
    const emitNro = xmlTag(emitXml, 'nro');
    const emitBairro = xmlTag(emitXml, 'xBairro');
    const emitCep = xmlTag(emitXml, 'CEP');
    const emitUF = xmlTag(emitXml, 'UF');
    const emitEmail = xmlTag(emitXml, 'email');
    const emitFone = xmlTag(emitXml, 'fone') || '';

    // cMun emitente
    const enderNacMatch = emitXml.match(/<enderNac>[\s\S]*?<\/enderNac>/i);
    const enderNacXml = enderNacMatch ? enderNacMatch[0] : '';
    const emitCMun = xmlTag(enderNacXml, 'cMun');

    // DPS info
    const dpsMatch = nfseXml.match(/<DPS[^>]*>[\s\S]*?<\/DPS>/i);
    const dpsXml = dpsMatch ? dpsMatch[0] : '';
    const dhEmi = xmlTag(dpsXml, 'dhEmi');
    const dCompet = xmlTag(dpsXml, 'dCompet');
    const serie = xmlTag(dpsXml, 'serie');
    const nDPS = xmlTag(dpsXml, 'nDPS');

    // Regime tributario
    const opSimpNac = xmlTag(dpsXml, 'opSimpNac');
    const regApTribSN = xmlTag(dpsXml, 'regApTribSN');

    // Tomador
    const tomaMatch = nfseXml.match(/<toma>[\s\S]*?<\/toma>/i);
    const tomaXml = tomaMatch ? tomaMatch[0] : '';
    const tomaCnpj = xmlTag(tomaXml, 'CNPJ') || xmlTag(tomaXml, 'CPF');
    const tomaNome = xmlTag(tomaXml, 'xNome');
    const tomaLgr = xmlTag(tomaXml, 'xLgr');
    const tomaNro = xmlTag(tomaXml, 'nro');
    const tomaBairro = xmlTag(tomaXml, 'xBairro');
    const tomaCep = xmlTag(tomaXml, 'CEP');
    const tomaFone = xmlTag(tomaXml, 'fone');
    const tomaEmail = xmlTag(tomaXml, 'email');
    const tomaCmun = xmlTag(tomaXml, 'cMun');

    // Servico
    const cTribNac = xmlTag(dpsXml, 'cTribNac');
    const xDescServ = xmlTag(dpsXml, 'xDescServ');
    const cNBS = xmlTag(dpsXml, 'cNBS');
    const cLocPrestacao = xmlTag(dpsXml, 'cLocPrestacao');

    // Valores
    const vServ = xmlTag(dpsXml, 'vServ') || '0';
    const tribISSQN = xmlTag(dpsXml, 'tribISSQN');
    const tpRetISSQN = xmlTag(dpsXml, 'tpRetISSQN');
    const pTotTribSN = xmlTag(dpsXml, 'pTotTribSN') || '0';

    // === Bordas da pagina ===
    doc.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2)
      .lineWidth(1).strokeColor('#000000').stroke();

    // ===== CABECALHO (y=6 a y=40) =====
    const y0 = 6;
    // Fundo cinza do cabecalho
    fillCell(doc, COLS[0], y0, COLS[4] - COLS[0], 34, GRAY_BG);
    hline(doc, y0 + 34, COLS[0], COLS[4]);
    vline(doc, COLS[1], y0, y0 + 34);
    vline(doc, COLS[2], y0, y0 + 34);
    vline(doc, COLS[3], y0, y0 + 34);

    // Logo (coluna 0)
    const logoBuf = await ensureLogo();
    if (logoBuf) {
      try { doc.image(logoBuf, COLS[0] + PAD, y0 + 5, { height: 22 }); } catch (_) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
        doc.text('NYTRO', COLS[0] + PAD, y0 + 10);
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
      doc.text('NYTRO', COLS[0] + PAD, y0 + 10);
    }

    // Titulo DANFSe (colunas 1-2)
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
    doc.text('DANFSe v2.0', COLS[1] + PAD, y0 + 6, { width: COLS[2] - COLS[1] - PAD * 2, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Documento Auxiliar da NFS-e', COLS[1] + PAD, y0 + 16, { width: COLS[2] - COLS[1] - PAD * 2, align: 'center' });

    // Info do municipio (coluna 3)
    doc.font('Helvetica').fontSize(8).fillColor('#000000');
    doc.text('Município: ' + xLocEmi + ' - ' + emitUF, COLS[3] + PAD, y0 + 6, { width: COL_W[3] - PAD * 2 });
    doc.font('Helvetica').fontSize(6);
    doc.text('Ambiente Gerador: ' + ambGer, COLS[3] + PAD, y0 + 16, { width: COL_W[3] - PAD * 2 });
    doc.text('Tipo de Ambiente: ' + ambGer, COLS[3] + PAD, y0 + 24, { width: COL_W[3] - PAD * 2 });

    let y = 44;

    // ===== DADOS CIENTIFICACAO / IDENTIFICACAO =====
    // Data Cientificacao (topo direito)
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#000000');
    doc.text('DATA CIENTIFICAÇÃO:', COLS[1], y - 4, { width: COL_W[1] });
    doc.text('IDENTIFICAÇÃO E ASSINATURA', COLS[2], y - 4, { width: COL_W[2] });
    doc.text('N° NFS-e / CHAVE NFS-e', COLS[3], y - 4, { width: COL_W[3] });
    doc.font('Helvetica').fontSize(7);
    doc.text(nNFSe + ' / ' + chaveAcesso, COLS[3] + PAD, y + 3, { width: COL_W[3] - PAD * 2 });

    // Chave de Acesso (full width)
    fillCell(doc, COLS[0], y, COLS[4] - COLS[0], 19, GRAY_BG);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'CHAVE DE ACESSO DA NFS-e', COL_W[0]);
    value(doc, COLS[0], y, chaveAcesso, COL_W[0]);

    // QR Code area (coluna 3, y+19)
    try {
      const qrBuf = await generateQR(chaveAcesso);
      doc.image(qrBuf, COLS[3] + 5, y + 23, { width: 45, height: 45 });
    } catch (_) {}

    // Texto do QR
    doc.font('Helvetica').fontSize(6).fillColor('#000000');
    doc.text('A autenticidade desta NFS-e pode ser verificada', COLS[3] + PAD, y + 72, { width: COL_W[3] - PAD * 2 });
    doc.text('pela leitura deste código QR ou pela consulta da', COLS[3] + PAD, y + 79, { width: COL_W[3] - PAD * 2 });
    doc.text('chave de acesso no portal nacional da NFS-e', COLS[3] + PAD, y + 86, { width: COL_W[3] - PAD * 2 });

    // Linha dados da NFS-e (colunas 0-2, y+19)
    y += 19;
    hline(doc, y, COLS[0], COLS[3]); // linha abaixo da chave
    fillCell(doc, COLS[0], y, COLS[1] - COLS[0], 19, GRAY_BG);
    fillCell(doc, COLS[1], y, COLS[2] - COLS[1], 19, GRAY_BG);
    fillCell(doc, COLS[2], y, COLS[3] - COLS[2], 19, GRAY_BG);
    gridH(doc, y, 3);
    label(doc, COLS[0], y, 'NÚMERO DA NFS-e', COL_W[0]);
    value(doc, COLS[0], y, nNFSe, COL_W[0]);
    label(doc, COLS[1], y, 'COMPETÊNCIA DA NFS-e', COL_W[1]);
    value(doc, COLS[1], y, fmtData(dCompet), COL_W[1]);
    label(doc, COLS[2], y, 'DATA E HORA DA EMISSÃO DA NFS-e', COL_W[2]);
    value(doc, COLS[2], y, fmtDataHora(dhProc), COL_W[2]);

    // Linha DPS
    y += 19;
    hline(doc, y, COLS[0], COLS[3]);
    fillCell(doc, COLS[0], y, COLS[1] - COLS[0], 19, GRAY_BG);
    fillCell(doc, COLS[1], y, COLS[2] - COLS[1], 19, GRAY_BG);
    fillCell(doc, COLS[2], y, COLS[3] - COLS[2], 19, GRAY_BG);
    gridH(doc, y, 3);
    label(doc, COLS[0], y, 'NÚMERO DA DPS', COL_W[0]);
    value(doc, COLS[0], y, nDPS, COL_W[0]);
    label(doc, COLS[1], y, 'SÉRIE DA DPS', COL_W[1]);
    value(doc, COLS[1], y, serie, COL_W[1]);
    label(doc, COLS[2], y, 'DATA E HORA DA EMISSÃO DA DPS', COL_W[2]);
    value(doc, COLS[2], y, fmtDataHora(dhEmi), COL_W[2]);

    // Linha Emitente / Situacao / Finalidade
    y += 19;
    hline(doc, y, COLS[0], COLS[3]);
    fillCell(doc, COLS[0], y, COLS[1] - COLS[0], 19, GRAY_BG);
    fillCell(doc, COLS[1], y, COLS[2] - COLS[1], 19, GRAY_BG);
    fillCell(doc, COLS[2], y, COLS[3] - COLS[2], 19, GRAY_BG);
    gridH(doc, y, 3);
    label(doc, COLS[0], y, 'EMITENTE DA NFS-e', COL_W[0]);
    value(doc, COLS[0], y, 'Prestador', COL_W[0]);
    label(doc, COLS[1], y, 'SITUAÇÃO DA NFS-e', COL_W[1]);
    value(doc, COLS[1], y, 'NFS-e Gerada', COL_W[1]);
    label(doc, COLS[2], y, 'FINALIDADE', COL_W[2]);
    value(doc, COLS[2], y, '-', COL_W[2]);

    // ===== PRESTADOR / FORNECEDOR =====
    y += 19;
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'PRESTADOR / FORNECEDOR', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    // Linha: CNPJ | IM | Telefone
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Nome / Nome Empresarial', COL_W[0]);
    label(doc, COLS[1], y, 'CNPJ / CPF / NIF', COL_W[1]);
    label(doc, COLS[2], y, 'Indicador Municipal (Inscrição)', COL_W[2]);
    label(doc, COLS[3], y, 'Telefone', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, emitNome || '', COL_W[0]);
    value(doc, COLS[1], y, fmtCnpj(emitCnpj), COL_W[1]);
    value(doc, COLS[2], y, '-', COL_W[2]);
    value(doc, COLS[3], y, fmtFone(emitFone), COL_W[3]);
    y += 13;

    // Linha: Endereco | Municipio | Codigo IBGE/CEP
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Endereço', COL_W[0]);
    label(doc, COLS[1], y, 'Município / Sigla UF', COL_W[1]);
    label(doc, COLS[2], y, 'E-mail', COL_W[2]);
    label(doc, COLS[3], y, 'Código IBGE / CEP', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, (emitLgr || '') + ', ' + (emitNro || '') + ', ' + (emitBairro || ''), COL_W[0]);
    value(doc, COLS[1], y, xLocEmi + ' / ' + (emitUF || ''), COL_W[1]);
    value(doc, COLS[2], y, emitEmail || '', COL_W[2]);
    value(doc, COLS[3], y, fmtIBGE(emitCMun) + ' / ' + fmtCep(emitCep), COL_W[3]);
    y += 13;

    // Linha: Simples Nacional | Regime Tributacao
    hline(doc, y, COLS[0], COLS[4]);
    fillCell(doc, COLS[0], y, COLS[2] - COLS[0], 19, GRAY_BG);
    gridH(doc, y, 2);
    label(doc, COLS[0], y, 'Simples Nacional na Data de Competência', COL_W[0]);
    const snLabel = opSimpNac === '1' ? 'Não Optante' : opSimpNac === '2' ? 'Optante - MEI' : opSimpNac === '3' ? 'Optante - ME ou EPP' : '-';
    value(doc, COLS[0], y, snLabel, COL_W[0]);
    label(doc, COLS[1], y, 'Regime de Apuração Tributária pelo SN', COL_W[1]);
    const regLabel = regApTribSN === '1' ? 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional' : regApTribSN === '2' ? 'Exclusivamente tributos municipais pelo Simples Nacional' : '-';
    value(doc, COLS[1], y, regLabel, COL_W[1]);
    hline(doc, y, COLS[2], COLS[4]); // linha direita
    y += 19;

    // ===== TOMADOR / ADQUIRENTE =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'TOMADOR / ADQUIRENTE', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    // Linha labels
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Nome / Nome Empresarial', COL_W[0]);
    label(doc, COLS[1], y, 'CNPJ / CPF / NIF', COL_W[1]);
    label(doc, COLS[2], y, 'Indicador Municipal (Inscrição)', COL_W[2]);
    label(doc, COLS[3], y, 'Telefone', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, tomaNome || '', COL_W[0]);
    value(doc, COLS[1], y, fmtCnpj(tomaCnpj), COL_W[1]);
    value(doc, COLS[2], y, '-', COL_W[2]);
    value(doc, COLS[3], y, fmtFone(tomaFone), COL_W[3]);
    y += 13;

    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Endereço', COL_W[0]);
    label(doc, COLS[1], y, 'Município / Sigla UF', COL_W[1]);
    label(doc, COLS[2], y, 'E-mail', COL_W[2]);
    label(doc, COLS[3], y, 'Código IBGE / CEP', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, (tomaLgr || '') + ', ' + (tomaNro || '') + ', ' + (tomaBairro || ''), COL_W[0]);
    // Cidade do tomador via IBGE lookup (usamos xLocEmi como fallback)
    value(doc, COLS[1], y, xLocPrestacao + ' / ' + (emitUF || ''), COL_W[1]);
    value(doc, COLS[2], y, tomaEmail || '', COL_W[2]);
    value(doc, COLS[3], y, fmtIBGE(tomaCmun) + ' / ' + fmtCep(tomaCep), COL_W[3]);
    y += 13;

    // ===== DESTINATARIO / INTERMEDIARIO =====
    hline(doc, y, COLS[0], COLS[4]);
    y += 6;
    doc.font('Helvetica').fontSize(7).fillColor('#000000');
    doc.text('DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', COLS[0] + PAD, y, { width: COLS[4] - COLS[0] - PAD * 2 });
    y += 8;
    doc.text('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', COLS[0] + PAD, y, { width: COLS[4] - COLS[0] - PAD * 2 });
    y += 12;

    // ===== SERVIÇO PRESTADO =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'SERVIÇO PRESTADO', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    // Codigo de tributacao | NBS | Local da prestacao
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Código de Tributação Nacional/Municipal', COL_W[0]);
    label(doc, COLS[1], y, 'Código da NBS', COL_W[1]);
    label(doc, COLS[2], y, 'Local da Prestação / Sigla UF / País', COL_W[2]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, fmtCNAE(cTribNac) + ' / -', COL_W[0]);
    value(doc, COLS[1], y, fmtNBS(cNBS), COL_W[1]);
    value(doc, COLS[2], y, xLocPrestacao + ' / ' + (emitUF || '') + ' / -', COL_W[2]);
    y += 13;

    // Descricao do servico (xTribNac como descricao curta, xDescServ como detalhe)
    hline(doc, y, COLS[0], COLS[4]);
    doc.font('Helvetica').fontSize(7).fillColor('#000000');
    doc.text(xTribNac || '', COLS[0] + PAD, y + 2, { width: COLS[4] - COLS[0] - PAD * 2 });
    y += 12;
    hline(doc, y, COLS[0], COLS[4]);
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#000000');
    doc.text('Descrição do Serviço', COLS[0] + PAD, y + 2, { width: COLS[4] - COLS[0] - PAD * 2 });
    y += 9;
    // Texto da descricao pode ser longo - wrap
    doc.font('Helvetica').fontSize(7).fillColor('#000000');
    const descLines = doc.heightOfString(xDescServ || '-', { width: COLS[4] - COLS[0] - PAD * 2 });
    doc.text(xDescServ || '-', COLS[0] + PAD, y + 2, { width: COLS[4] - COLS[0] - PAD * 2 });
    y += Math.max(descLines, 16) + 6;

    // ===== TRIBUTAÇÃO MUNICIPAL (ISSQN) =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'TRIBUTAÇÃO MUNICIPAL (ISSQN)', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Tipo de Tributação do ISSQN', COL_W[0]);
    label(doc, COLS[1], y, 'Município / Sigla UF / País de Incidência do ISSQN', COL_W[1]);
    label(doc, COLS[2], y, 'BC ISSQN', COL_W[2]);
    label(doc, COLS[3], y, 'Alíquota Aplicada', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    const tpIssLabel = tribISSQN === '1' ? 'Operação Tributável' : tribISSQN === '2' ? 'Operação Não Tributável' : '-';
    value(doc, COLS[0], y, tpIssLabel, COL_W[0]);
    value(doc, COLS[1], y, xLocEmi + ' / ' + (emitUF || '') + ' / -', COL_W[1]);
    value(doc, COLS[2], y, '-', COL_W[2]);
    value(doc, COLS[3], y, '-', COL_W[3]);
    y += 13;
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Retenção do ISSQN', COL_W[0]);
    label(doc, COLS[1], y, 'ISSQN Apurado', COL_W[1]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    const retISSLabel = tpRetISSQN === '1' ? 'Não Retido' : tpRetISSQN === '2' ? 'Retido pelo Tomador' : tpRetISSQN === '3' ? 'Retido pelo Intermediário' : '-';
    value(doc, COLS[0], y, retISSLabel, COL_W[0]);
    value(doc, COLS[1], y, '-', COL_W[1]);
    y += 13;

    // ===== TRIBUTAÇÃO FEDERAL =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'TRIBUTAÇÃO FEDERAL (EXCETO CBS)', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'IRRF', COL_W[0]);
    label(doc, COLS[1], y, 'Contribuição Previdenciária - Retida', COL_W[1]);
    label(doc, COLS[2], y, 'Contribuições Sociais - Retidas', COL_W[2]);
    label(doc, COLS[3], y, 'PIS - Débito Apuração Própria', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, '-', COL_W[0]);
    value(doc, COLS[1], y, '-', COL_W[1]);
    value(doc, COLS[2], y, '-', COL_W[2]);
    value(doc, COLS[3], y, '-', COL_W[3]);
    y += 13;
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'COFINS - Débito Apuração Própria', COL_W[0]);
    label(doc, COLS[1], y, 'Descrição Contrib. Sociais - Retidas', COL_W[1]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, '-', COL_W[0]);
    value(doc, COLS[1], y, '0 - PIS/COFINS/CSLL Não Retidos', COL_W[1]);
    y += 13;

    // ===== TRIBUTAÇÃO IBS/CBS =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'TRIBUTAÇÃO IBS/CBS', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    // Linha 1
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'CST / cClassTrib', COL_W[0]);
    label(doc, COLS[1], y, 'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', COL_W[1]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, '- / -', COL_W[0]);
    value(doc, COLS[1], y, '- / - / - / -', COL_W[1]);
    y += 13;

    // Linha 2
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Exclusões e Reduções da Base de Cálculo', COL_W[0]);
    label(doc, COLS[1], y, 'Base de Cálculo Após Exclusões e Reduções', COL_W[1]);
    label(doc, COLS[2], y, 'Red. Alíquota IBS / Red. Alíquota CBS', COL_W[2]);
    label(doc, COLS[3], y, 'Alíquota - IBS UF / IBS Mun', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, fmtMoeda('0'), COL_W[0]);
    value(doc, COLS[1], y, '-', COL_W[1]);
    value(doc, COLS[2], y, '- / - / -', COL_W[2]);
    value(doc, COLS[3], y, '- / -', COL_W[3]);
    y += 13;

    // Linhas 3-7 (todos traços)
    const ibsLabels = [
      ['Alíq. Efetiva Municipal - IBS', 'Valor Apurado Municipal - IBS', 'Alíq. Efetiva Estadual - IBS', 'Valor Apurado Estadual - IBS'],
      ['Valor Total Apurado - IBS', 'Alíquota - CBS', 'Alíquota Efetiva - CBS', 'Valor Total Apurado - CBS'],
    ];
    for (const row of ibsLabels) {
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    for (let i = 0; i < 4; i++) label(doc, COLS[i], y, row[i], COL_W[i]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    for (let i = 0; i < 4; i++) value(doc, COLS[i], y, '-', COL_W[i]);
    y += 13;
    }

    // ===== VALOR TOTAL DA NFS-e =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'VALOR TOTAL DA NFS-e', 0, 4);
    gridH(doc, y, 4);
    y += 19;

    // Linha 1: Valor operacao | Desconto Incond | Desconto Cond
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[1], y, 'VALOR DA OPERAÇÃO / SERVIÇO', COL_W[1]);
    label(doc, COLS[2], y, 'Desconto Incondicionado', COL_W[2]);
    label(doc, COLS[3], y, 'Desconto Condicionado', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[1], y, fmtMoeda(vServ), COL_W[1]);
    value(doc, COLS[2], y, '-', COL_W[2]);
    value(doc, COLS[3], y, '-', COL_W[3]);
    y += 13;

    // Linha 2: Retencoes | Valor Liquido | Total IBS/CBS | VL + IBS/CBS
    hline(doc, y, COLS[0], COLS[4]);
    gridH(doc, y, 4);
    label(doc, COLS[0], y, 'Total das Retenções (ISSQN / Federais)', COL_W[0]);
    label(doc, COLS[1], y, 'VALOR LÍQUIDO DA NFS-e', COL_W[1]);
    label(doc, COLS[2], y, 'Total do IBS/CBS', COL_W[2]);
    label(doc, COLS[3], y, 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', COL_W[3]);
    y += 11;
    hline(doc, y, COLS[0], COLS[4]);
    value(doc, COLS[0], y, '-', COL_W[0]);
    value(doc, COLS[1], y, fmtMoeda(vLiq), COL_W[1]);
    value(doc, COLS[2], y, fmtMoeda('0'), COL_W[2]);
    value(doc, COLS[3], y, fmtMoeda('0'), COL_W[3]);
    y += 13;

    // ===== INFORMAÇÕES COMPLEMENTARES =====
    hline(doc, y, COLS[0], COLS[4]);
    sectionHeader(doc, y, 'INFORMAÇÕES COMPLEMENTARES', 0, 4);
    gridH(doc, y, 4);
    y += 19;
    hline(doc, y, COLS[0], COLS[4]);
    doc.font('Helvetica').fontSize(7).fillColor('#000000');
    const tribText = 'Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: Federais: -; Estaduais: -; Municipais: -;';
    doc.text(tribText, COLS[0] + PAD, y + 3, { width: COLS[4] - COLS[0] - PAD * 2 });
    y += 15;

    // Preenche ate o rodape
    y = Math.max(y, 660);

    // ===== RODAPÉ - 3 caixas de assinatura =====
    const footY = 796;
    hline(doc, footY, COLS[0], COLS[4]);
    hline(doc, footY + 20, COLS[0], COLS[4]);
    vline(doc, COLS[1], footY, footY + 20);
    vline(doc, COLS[2], footY, footY + 20);
    vline(doc, COLS[3], footY, footY + 20);

    doc.end();
  });
}

module.exports = { gerarPdfDanfse };
