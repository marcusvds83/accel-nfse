/**
 * services/nfse-xml.js — Gerador de XML DPS (SPED NFS-e v1.01)
 * =============================================================
 * Gera o XML do Documento de Prestacao de Servicos (DPS) no formato
 * do SPED NFS-e, baseado no XML real emitido pela Nytro em Curitiba.
 *
 * Namespace: http://www.sped.fazenda.gov.br/nfse
 * Versao: 1.01
 *
 * Mapeamento Odoo -> XML DPS:
 *   res.company    -> prest
 *   res.partner    -> toma
 *   account.move.line -> serv + valores
 */

const config = require('../config');

const NS = 'http://www.sped.fazenda.gov.br/nfse';

// === Helpers de formatacao ===

/** Remove pontuacao de CNPJ/CPF */
function limpaDoc(doc) {
  if (!doc) return '';
  return String(doc).replace(/[^0-9]/g, '');
}

/** Formata valor monetario com 2 casas */
function fmtValor(v) {
  return Number(v || 0).toFixed(2);
}

/** Formata data ISO 8601 com timezone BRT */
function fmtDataHora(d) {
  const dt = d ? new Date(d) : new Date();
  // Garante formato YYYY-MM-DDTHH:MM:SS-03:00
  const iso = dt.toISOString();
  // toISOString retorna UTC, precisa converter para BRT (-03:00)
  const utcDate = new Date(iso);
  const brtDate = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = brtDate.getUTCFullYear();
  const MM = String(brtDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(brtDate.getUTCDate()).padStart(2, '0');
  const hh = String(brtDate.getUTCHours()).padStart(2, '0');
  const mm = String(brtDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(brtDate.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}-03:00`;
}

/** Formata data competencia YYYY-MM-DD */
function fmtDataCompet(d) {
  const dt = d ? new Date(d) : new Date();
  const brt = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = brt.getUTCFullYear();
  const MM = String(brt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(brt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}`;
}

/** Extrai codigo IBGE do city_id do Odoo (tuple [id, name]) */
function ibgeFromCity(cityId) {
  if (!cityId) return config.nfse.codigo_ibge;
  // cityId no Odoo vem como [id, 'Curitiba - PR'] ou similar
  // O codigo IBGE precisa ser lido do res.city.ibge_code
  // Por enquanto, retorna o IBGE configurado (Curitiba)
  return config.nfse.codigo_ibge;
}

/** Extrai numero do endereco */
function extraiNumero(street, street2, number) {
  if (number && String(number).trim()) return String(number).trim();
  if (street2 && String(street2).trim() && /^\d+$/.test(street2.trim())) return street2.trim();
  // Tenta extrair do proprio street (ex: "RUA BOM JESUS, 212" ou "R BOM JESUS 212")
  const match = String(street || '').match(/[,\s]+(\d+)[\s,]*$/);
  return match ? match[1] : 'S/N';
}

/** Limpa logradouro removendo numero final */
function limpaLogradouro(street) {
  if (!street) return '';
  return String(street).replace(/[,\s]+\d+[\s,]*$/, '').trim();
}

/** Escapa caracteres especiais XML */
function escXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// === Gerador do DPS ===

/**
 * Gera o XML DPS (Documento de Prestacao de Servicos).
 * @param {object} dados
 * @param {object} dados.move   - account.move
 * @param {object} dados.company - res.company (Nytro)
 * @param {object} dados.partner - res.partner (tomador)
 * @param {array}  dados.lines  - account.move.line[]
 * @param {object} dados.products - product.product[] (mapa id->product)
 * @param {number} dados.nDPS   - Numero do DPS
 * @returns {string} XML DPS
 */
function gerarXmlDPS(dados) {
  const { move, company, partner, lines, products, nDPS } = dados;
  const c = config.nfse;

  const cnpjPrest = limpaDoc(company.cnpj_cpf);
  const ibge = c.codigo_ibge;
  const serie = c.serie;
  const dhEmi = fmtDataHora(move.invoice_date);
  const dCompet = fmtDataCompet(move.invoice_date);

  // ID do infDPS (formato do SPED)
  const infDpsId = `DPS${ibge}22${cnpjPrest}${String(serie).padStart(5, '0')}${String(nDPS).padStart(14, '0')}`;

  // --- Prestador ---
  const fonePrest = limpaDoc(company.phone || '');
  const emailPrest = company.email || '';

  // --- Tomador ---
  const docTomador = limpaDoc(partner.cnpj_cpf || '');
  const isCpfTomador = docTomador.length === 11;
  const docTomadorTag = isCpfTomador ? 'CPF' : 'CNPJ';
  const nomeTomador = partner.legal_name || partner.name || '';
  const emailTomador = partner.email || '';
  const nroTomador = extraiNumero(partner.street, partner.street2, partner.number);
  const logrTomador = limpaLogradouro(partner.street);
  const bairroTomador = partner.district || partner.street2 || '';
  const cepTomador = limpaDoc(partner.zip || '');
  const ibgeTomador = ibgeFromCity(partner.city_id);

  // --- Servico ---
  // Usa dados do primeiro produto, ou padrao da config
  const firstProduct = lines[0] && lines[0].product_id ? (products[lines[0].product_id[0]] || {}) : {};
  const cTribNac = firstProduct.x_nytro_codigo_tributacao || c.c_trib_nac_padrao;
  const cNBS = firstProduct.x_nytro_c_nbs || c.c_nbs_padrao;

  // Descricao: concatena nomes das linhas, ou usa x_nytro_descricao_nfse do produto
  let xDescServ = firstProduct.x_nytro_descricao_nfse || '';
  if (!xDescServ) {
    xDescServ = lines.map(l => l.name || '').filter(Boolean).join('; ');
  }
  // Limita a 2000 caracteres
  if (xDescServ.length > 2000) xDescServ = xDescServ.substring(0, 2000);

  // --- Valores ---
  const vServ = fmtValor(move.amount_untaxed || move.amount_total);
  const pTotTribSN = fmtValor(c.p_tot_trib_sn);

  // ISS retido? Por default sim (tpRetISSQN=1), pode ser configurado por produto
  const issRetido = firstProduct.x_nytro_iss_retido !== false ? '1' : '2';

  // --- Monta o XML ---
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DPS versao="${c.versao}" xmlns="${NS}">
  <infDPS Id="${infDpsId}">
    <tpAmb>${c.tp_amb}</tpAmb>
    <dhEmi>${dhEmi}</dhEmi>
    <verAplic>${escXml(c.ver_aplic)}</verAplic>
    <serie>${escXml(serie)}</serie>
    <nDPS>${nDPS}</nDPS>
    <dCompet>${dCompet}</dCompet>
    <tpEmit>1</tpEmit>
    <cLocEmi>${ibge}</cLocEmi>
    <prest>
      <CNPJ>${cnpjPrest}</CNPJ>
      <fone>${fonePrest}</fone>
      <email>${escXml(emailPrest)}</email>
      <regTrib>
        <opSimpNac>${c.op_simp_nac}</opSimpNac>
        <regApTribSN>${c.reg_ap_trib_sn}</regApTribSN>
        <regEspTrib>${c.reg_esp_trib}</regEspTrib>
      </regTrib>
    </prest>
    <toma>
      <${docTomadorTag}>${docTomador}</${docTomadorTag}>
      <xNome>${escXml(nomeTomador)}</xNome>
      <end>
        <endNac>
          <cMun>${ibgeTomador}</cMun>
          <CEP>${cepTomador}</CEP>
        </endNac>
        <xLgr>${escXml(logrTomador)}</xLgr>
        <nro>${escXml(nroTomador)}</nro>
        <xBairro>${escXml(bairroTomador)}</xBairro>
      </end>
      <email>${escXml(emailTomador)}</email>
    </toma>
    <serv>
      <locPrest>
        <cLocPrestacao>${ibge}</cLocPrestacao>
      </locPrest>
      <cServ>
        <cTribNac>${escXml(cTribNac)}</cTribNac>
        <xDescServ>${escXml(xDescServ)}</xDescServ>
        <cNBS>${escXml(cNBS)}</cNBS>
      </cServ>
    </serv>
    <valores>
      <vServPrest>
        <vServ>${vServ}</vServ>
      </vServPrest>
      <trib>
        <tribMun>
          <tribISSQN>1</tribISSQN>
          <tpRetISSQN>${issRetido}</tpRetISSQN>
        </tribMun>
        <tribFed>
          <piscofins>
            <CST>00</CST>
            <tpRetPisCofins>0</tpRetPisCofins>
          </piscofins>
        </tribFed>
        <totTrib>
          <pTotTribSN>${pTotTribSN}</pTotTribSN>
        </totTrib>
      </trib>
    </valores>
  </infDPS>
</DPS>`;

  console.log('[NFSE-XML] DPS gerado. infDpsId=' + infDpsId + ' nDPS=' + nDPS + ' vServ=' + vServ);
  return { xml, infDpsId };
}

module.exports = { gerarXmlDPS, NS };
