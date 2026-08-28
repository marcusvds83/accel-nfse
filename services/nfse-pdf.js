/**
 * services/nfse-pdf.js — Gerador de PDF DANFSE simplificado
 * ==========================================================
 * Gera um PDF do Documento Auxiliar da NFS-e (DANFSE) a partir do XML
 * retornado pela SEFIN, usando pdfkit.
 */

const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

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

function fmtDataHora(iso) {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yy + ' ' + hh + ':' + mi;
  } catch (_) {
    return iso;
  }
}

function fmtData(iso) {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    return dd + '/' + mm + '/' + yy;
  } catch (_) {
    return iso;
  }
}

/** Extrai texto de tag XML (simples, sem namespaces) */
function xmlTag(xml, tag) {
  // Remove namespace se presente: <ns:tag> ou <tag>
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

/** Extrai primeiro match de qualquer tag */
function xmlFirst(xml, ...tags) {
  for (const t of tags) {
    const v = xmlTag(xml, t);
    if (v) return v;
  }
  return '';
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
    } catch (e) {
      reject(e);
    }
   });
}

// === Gerador principal ===

/**
 * Gera PDF DANFSE a partir do XML da NFS-e retornado pela SEFIN.
 * @param {string} nfseXml - XML completo da NFS-e
 * @returns {Promise<Buffer>} PDF gerado
 */
async function gerarPdfDanfse(nfseXml) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    // --- Parseia dados do XML ---
  const Id = xmlAttr(nfseXml, 'infNFSe', 'Id') || '';
  const chaveAcesso = Id.replace('NFS', '');
  const nNFSe = xmlTag(nfseXml, 'nNFSe') || '-';
  const nDFSe = xmlTag(nfseXml, 'nDFSe') || '-';
  const cStat = xmlTag(nfseXml, 'cStat') || '';
  const dhProc = xmlTag(nfseXml, 'dhProc');
  const xLocEmi = xmlTag(nfseXml, 'xLocEmi') || '';
  const xLocPrestacao = xmlTag(nfseXml, 'xLocPrestacao') || '';
  const xTribNac = xmlTag(nfseXml, 'xTribNac') || '';
  const xNBS = xmlTag(nfseXml, 'xNBS') || '';
  const verAplic = xmlTag(nfseXml, 'verAplic') || '';
  const ambGer = xmlTag(nfseXml, 'ambGer') || '';
  const vLiq = xmlTag(nfseXml, 'vLiq') || '0';

  // Dados do emitente (SEFIN preenche)
  const emitCnpj = xmlTag(nfseXml, 'CNPJ'); // Primeiro CNPJ (emitente)
  const emitNome = xmlTag(nfseXml, 'xNome');
  const emitLgr = xmlTag(nfseXml, 'xLgr');
  const emitNro = xmlTag(nfseXml, 'nro');
  const emitBairro = xmlTag(nfseXml, 'xBairro');
  const emitCep = xmlTag(nfseXml, 'CEP');
  const emitUF = xmlTag(nfseXml, 'UF');
  const emitEmail = xmlTag(nfseXml, 'email');

  // Dados do DPS (prestador/tomador/servico/valores estao dentro de <DPS><infDPS>)
  // Prestador
  const dpsCnpj = xmlTag(nfseXml, 'CNPJ'); // mesmo do emit
  const prestEmail = xmlTag(nfseXml, 'email');

  // Tomador - busca dentro de <toma>
  const tomaMatch = nfseXml.match(/<toma>[\s\S]*?<\/toma>/i);
  const tomaXml = tomaMatch ? tomaMatch[0] : '';
  const tomaCnpj = xmlTag(tomaXml, 'CNPJ') || xmlTag(tomaXml, 'CPF');
  const tomaNome = xmlTag(tomaXml, 'xNome');
  const tomaLgr = xmlTag(tomaXml, 'xLgr');
  const tomaNro = xmlTag(tomaXml, 'nro');
  const tomaBairro = xmlTag(tomaXml, 'xBairro');
  const tomaCep = xmlTag(tomaXml, 'CEP');
  const tomaFone = xmlTag(tomaXml, 'fone');

  // Servico
  const cTribNac = xmlTag(nfseXml, 'cTribNac');
  const xDescServ = xmlTag(nfseXml, 'xDescServ');
  const cNBS = xmlTag(nfseXml, 'cNBS');

  // Valores DPS
  const vServ = xmlTag(nfseXml, 'vServ') || '0';
  const tribISSQN = xmlTag(nfseXml, 'tribISSQN');
  const tpRetISSQN = xmlTag(nfseXml, 'tpRetISSQN');
  const pTotTribSN = xmlTag(nfseXml, 'pTotTribSN') || '0';

  // Data emissao DPS
  const dhEmi = xmlTag(nfseXml, 'dhEmi');
  const dCompet = xmlTag(nfseXml, 'dCompet');
  const serie = xmlTag(nfseXml, 'serie');
  const nDPS = xmlTag(nfseXml, 'nDPS');

  const W = doc.page.width - 60; // largura util
  const LEFT = 30;
  let y = 30;

  // Cores
  const C_PRIMARY = '#1a237e';  // azul escuro
  const C_ACCENT = '#283593';
  const C_MUTED = '#666666';
  const C_LIGHT = '#f5f5f5';
  const C_BORDER = '#cccccc';
  const C_SUCCESS = '#2e7d32';

  // --- CABECALHO ---
  doc.rect(LEFT, y, W, 52).fill(C_PRIMARY);
  doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold')
    .text('DOCUMENTO AUXILIAR DA NOTA FISCAL DE SERVIÇOS ELETRÔNICA', LEFT + 10, y + 6, { width: W - 20, align: 'center' });
  doc.fontSize(9).font('Helvetica')
    .text('DANFSE - NFS-e Nacional (SPED)', LEFT + 10, y + 26, { width: W - 20, align: 'center' });
  doc.fontSize(7)
    .text('Emitido por emissão própria - ' + (ambGer === '1' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO (Produção Restrita)'), LEFT + 10, y + 40, { width: W - 20, align: 'center' });
  y += 60;

  // --- NUMERO / CHAVE ---
  doc.rect(LEFT, y, W, 36).lineWidth(0.5).stroke(C_BORDER);
  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Número da NFS-e', LEFT + 8, y + 4);
  doc.fillColor(C_PRIMARY).fontSize(16).font('Helvetica-Bold')
    .text(nNFSe, LEFT + 8, y + 14);

  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Código Verificação', LEFT + 110, y + 4);
  doc.fillColor(C_ACCENT).fontSize(8).font('Helvetica-Bold')
    .text(nDFSe, LEFT + 110, y + 14, { width: 130 });

  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Data de Emissão', LEFT + 280, y + 4);
  doc.fillColor(C_ACCENT).fontSize(9).font('Helvetica-Bold')
    .text(fmtDataHora(dhProc), LEFT + 280, y + 14);

  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Competência', LEFT + 410, y + 4);
  doc.fillColor(C_ACCENT).fontSize(9).font('Helvetica-Bold')
    .text(fmtData(dCompet), LEFT + 410, y + 14);
  y += 44;

  // --- CHAVE DE ACESSO ---
  doc.rect(LEFT, y, W, 18).fill(C_LIGHT);
  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Chave de Acesso:', LEFT + 8, y + 5);
  doc.fillColor(C_PRIMARY).fontSize(10).font('Helvetica-Bold')
    .text(chaveAcesso, LEFT + 100, y + 4);
  y += 22;

  // === PRESTADOR ===
  doc.rect(LEFT, y, W, 75).lineWidth(0.5).stroke(C_BORDER);
  doc.rect(LEFT, y, W, 14).fill(C_ACCENT);
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
    .text('PRESTADOR DE SERVIÇOS', LEFT + 8, y + 3);
  y += 18;

  doc.fillColor('#333333').fontSize(9).font('Helvetica-Bold')
    .text(emitNome, LEFT + 8, y);
  doc.fillColor(C_MUTED).fontSize(8).font('Helvetica')
    .text('CNPJ: ' + fmtCnpj(emitCnpj), LEFT + 8, y + 13);
  doc.text((emitLgr || '') + ', ' + (emitNro || 'S/N') + ' - ' + (emitBairro || ''), LEFT + 8, y + 25);
  doc.text('CEP: ' + fmtCep(emitCep) + '   UF: ' + (emitUF || ''), LEFT + 8, y + 37);
  if (emitEmail) doc.text('E-mail: ' + emitEmail, LEFT + 8, y + 49);
  y += 80;

  // === TOMADOR ===
  doc.rect(LEFT, y, W, 68).lineWidth(0.5).stroke(C_BORDER);
  doc.rect(LEFT, y, W, 14).fill(C_ACCENT);
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
    .text('TOMADOR DE SERVIÇOS', LEFT + 8, y + 3);
  y += 18;

  doc.fillColor('#333333').fontSize(9).font('Helvetica-Bold')
    .text(tomaNome, LEFT + 8, y);
  doc.fillColor(C_MUTED).fontSize(8).font('Helvetica')
    .text('CNPJ/CPF: ' + fmtCnpj(tomaCnpj), LEFT + 8, y + 13);
  doc.text((tomaLgr || '') + ', ' + (tomaNro || 'S/N') + ' - ' + (tomaBairro || ''), LEFT + 8, y + 25);
  doc.text('CEP: ' + fmtCep(tomaCep) + (tomaFone ? '   Tel: ' + tomaFone : ''), LEFT + 8, y + 37);
  y += 73;

  // === DESCRICAO DO SERVICO ===
  doc.rect(LEFT, y, W, 68).lineWidth(0.5).stroke(C_BORDER);
  doc.rect(LEFT, y, W, 14).fill(C_ACCENT);
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
    .text('DESCRIÇÃO DO SERVIÇO', LEFT + 8, y + 3);
  y += 18;

  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Item | Código Tributário | NBS', LEFT + 8, y);
  doc.fillColor('#333333').fontSize(8).font('Helvetica-Bold')
    .text('1 | ' + (cTribNac || '-') + ' | ' + (cNBS || '-'), LEFT + 8, y + 12);
  doc.fillColor('#333333').fontSize(8).font('Helvetica')
    .text(xDescServ || '-', LEFT + 8, y + 26, { width: W - 16 });
  if (xTribNac) {
    doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
      .text('Tributação Nacional: ' + xTribNac, LEFT + 8, y + 42);
  }
  y += 73;

  // === VALORES ===
  const colValor = LEFT + 300;
  doc.rect(LEFT, y, W, 70).lineWidth(0.5).stroke(C_BORDER);
  doc.rect(LEFT, y, W, 14).fill(C_ACCENT);
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
    .text('VALORES', LEFT + 8, y + 3);
  y += 18;

  // Linhas de valores
  const valorLines = [
    ['Valor do Serviço:', fmtMoeda(vServ)],
    ['ISSQN:', (tribISSQN === '1' ? 'Exigível' : tribISSQN === '2' ? 'Não exigível' : '-') +
      (tpRetISSQN === '1' ? ' (Não Retido)' : tpRetISSQN === '2' ? ' (Retido)' : '')],
    ['Total Tributos SN:', pTotTribSN + '%'],
  ];

  valorLines.forEach((line, i) => {
    const ly = y + i * 13;
    doc.fillColor(C_MUTED).fontSize(8).font('Helvetica')
      .text(line[0], LEFT + 8, ly);
    doc.fillColor('#333333').fontSize(8).font('Helvetica-Bold')
      .text(line[1], colValor, ly, { align: 'right', width: W - (colValor - LEFT) - 8 });
  });

  // Valor Liquido em destaque
  doc.rect(colValor - 8, y + 40, W - (colValor - LEFT) + 8, 20).fill(C_PRIMARY);
  doc.fillColor('#ffffff').fontSize(7).font('Helvetica')
    .text('VALOR LÍQUIDO:', colValor, y + 43);
  doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
    .text(fmtMoeda(vLiq), colValor + 80, y + 40);
  y += 75;

  // === CANHOTO / QR CODE ===
  doc.rect(LEFT, y, W, 90).lineWidth(0.5).stroke(C_BORDER);
  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Consulta de autenticidade da NFS-e:', LEFT + 8, y + 6);
  doc.fillColor(C_ACCENT).fontSize(7).font('Helvetica')
    .text('https://nfse.gov.br/consultar-nfse', LEFT + 8, y + 18);

  // QR Code
  try {
    const qrBuf = await generateQR(chaveAcesso);
    doc.image(qrBuf, LEFT + 8, y + 32, { width: 50, height: 50 });
  } catch (_) {
    doc.rect(LEFT + 8, y + 32, 50, 50).fill(C_LIGHT);
    doc.fillColor(C_MUTED).fontSize(6).text('QR Code', LEFT + 18, y + 52);
  }

  // Info do lado do QR
  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Chave de Acesso:', LEFT + 70, y + 36);
  doc.fillColor('#333333').fontSize(8).font('Helvetica-Bold')
    .text(chaveAcesso, LEFT + 70, y + 48, { width: W - 100 });
  doc.fillColor(C_MUTED).fontSize(7).font('Helvetica')
    .text('Série: ' + (serie || '-') + '    DPS: ' + (nDPS || '-'), LEFT + 70, y + 64);
  doc.text('VerApp: ' + verAplic, LEFT + 70, y + 76);
  y += 96;

  // === RODAPE ===
  doc.fillColor(C_MUTED).fontSize(6).font('Helvetica')
    .text('Documento gerado pelo middleware Nytro NFSe (nfse-nytro) em ' + new Date().toISOString().substring(0, 19).replace('T', ' '), LEFT, y, { align: 'center', width: W });

  doc.end();
});
}

module.exports = { gerarPdfDanfse };
