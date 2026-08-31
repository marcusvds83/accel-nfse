/**
 * NFS-e Nytro Dashboard — Frontend App
 * ======================================
 */

(function() {
  'use strict';

  // --- State ---
  let API_KEY = localStorage.getItem('nfse_api_key') || '';
  let allNfses = [];
  let currentNfse = null;
  let refreshTimer = null;
  let sefinTimer = null;

  // --- DOM ---
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // --- Init ---
  function init() {
    if (API_KEY) {
      showDashboard();
    } else {
      showAuth();
    }
    bindEvents();
  }

  // --- Auth ---
  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#dashboard').classList.add('hidden');
    clearInterval(refreshTimer);
    clearInterval(sefinTimer);
  }

  function showDashboard() {
    $('#auth-screen').classList.add('hidden');
    $('#dashboard').classList.remove('hidden');
    loadDashboard();
    loadSefinStatus();
    loadCertStatus();
    refreshTimer = setInterval(loadDashboard, 10000);
    sefinTimer = setInterval(loadSefinStatus, 30000);
  }

  function bindEvents() {
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = $('#api-key-input').value.trim();
      if (!key) return;
      $('#auth-error').textContent = 'Verificando...';
      try {
        const r = await apiFetch('/api/v1/nfse/dashboard', key);
        if (!r.ok) {
          const data = await r.json();
          $('#auth-error').textContent = data.erro || 'API Key invalida';
          return;
        }
        API_KEY = key;
        localStorage.setItem('nfse_api_key', key);
        showDashboard();
      } catch (err) {
        $('#auth-error').textContent = 'Erro de conexao com o servidor';
      }
    });

    $('#btn-logout').addEventListener('click', () => {
      API_KEY = '';
      localStorage.removeItem('nfse_api_key');
      showAuth();
      $('#api-key-input').value = '';
      $('#auth-error').textContent = '';
    });

    $('#btn-refresh').addEventListener('click', () => {
      const btn = $('#btn-refresh');
      btn.classList.add('spinning');
      loadDashboard().finally(() => setTimeout(() => btn.classList.remove('spinning'), 300));
    });

    $('#search-input').addEventListener('input', renderTable);
    $('#filter-status').addEventListener('change', renderTable);

    // Modal events
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-overlay').addEventListener('click', (e) => {
      if (e.target === $('#modal-overlay')) closeModal();
    });
    $('#modal-copy').addEventListener('click', copyXml);
    $('#modal-download-xml').addEventListener('click', () => downloadFile('xml'));
    $('#modal-download-pdf').addEventListener('click', () => downloadFile('pdf'));
    $('#modal-consultar-sefin').addEventListener('click', consultarSefinFromModal);
    $('#modal-reattach').addEventListener('click', () => {
      if (!currentNfse) return;
      const id = currentNfse.id;
      closeModal();
      setTimeout(() => window._reattach(id), 200);
    });

    $('#sefin-result-close').addEventListener('click', () => {
      $('#sefin-result-overlay').classList.add('hidden');
    });
    $('#sefin-result-overlay').addEventListener('click', (e) => {
      if (e.target === $('#sefin-result-overlay')) $('#sefin-result-overlay').classList.add('hidden');
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        $('#sefin-result-overlay').classList.add('hidden');
      }
    });
  }

  // --- API ---
  async function apiFetch(path, key) {
    return fetch(path, {
      headers: { 'X-Api-Key': key || API_KEY },
    });
  }

  // --- Load Dashboard ---
  async function loadDashboard() {
    try {
      const r = await apiFetch('/api/v1/nfse/dashboard');
      if (r.status === 401) {
        showAuth();
        return;
      }
      const data = await r.json();

      // Environment badge
      const badge = $('#env-badge');
      if (data.ambiente === 'PRODUCAO') {
        badge.textContent = 'PRODUCAO';
        badge.className = 'topbar-env prod';
      } else {
        badge.textContent = 'HOMOLOGACAO';
        badge.className = 'topbar-env hom';
      }

      // Odoo status
      const odooInd = $('#odoo-indicator');
      if (data.conectado_odoo) {
        odooInd.className = 'status-indicator online';
      } else {
        odooInd.className = 'status-indicator offline';
      }

      allNfses = data.nfses || [];

      // KPIs
      const resumo = data.resumo || {};
      $('#kpi-total').textContent = resumo.total || 0;
      $('#kpi-autorizadas').textContent = resumo.autorizadas || 0;
      $('#kpi-pendentes').textContent = resumo.pendentes || 0;
      $('#kpi-erros').textContent = resumo.erros || 0;
      $('#kpi-canceladas').textContent = resumo.canceladas || 0;
      $('#kpi-valor').textContent = formatCurrency(resumo.valor_total_autorizado || 0);

      // Last update
      $('#last-update').textContent = 'Atualizado: ' + formatDateTime(new Date());

      renderTable();
    } catch (err) {
      console.error('[Dashboard] Load error:', err);
    }
  }

  // --- Load SEFIN Status ---
  async function loadSefinStatus() {
    const ind = $('#sefin-indicator');
    const msg = $('#sefin-msg');
    const url = $('#sefin-url');
    const lat = $('#sefin-latency');

    ind.className = 'status-indicator checking';
    msg.textContent = 'Verificando...';
    msg.className = 'sefin-msg checking';

    try {
      const r = await apiFetch('/api/v1/nfse/dashboard/sefin-status');
      const data = await r.json();

      url.textContent = data.url || '--';

      if (data.status === 'online') {
        ind.className = 'status-indicator online';
        msg.textContent = data.mensagem;
        msg.className = 'sefin-msg online';
        lat.textContent = data.latency_ms ? data.latency_ms + 'ms' : '';
        $('#sefin-bar').style.borderLeftColor = 'var(--accent)';
      } else if (data.status === 'sem_certificado') {
        ind.className = 'status-indicator warning';
        msg.textContent = data.mensagem;
        msg.className = 'sefin-msg offline';
        lat.textContent = '';
        $('#sefin-bar').style.borderLeftColor = 'var(--warning)';
      } else {
        ind.className = 'status-indicator offline';
        msg.textContent = data.mensagem;
        msg.className = 'sefin-msg offline';
        lat.textContent = '';
        $('#sefin-bar').style.borderLeftColor = 'var(--danger)';
      }
    } catch (err) {
      ind.className = 'status-indicator offline';
      msg.textContent = 'Erro ao verificar';
      msg.className = 'sefin-msg offline';
    }
  }

  // --- Load Cert Status ---
  async function loadCertStatus() {
    try {
      const r = await apiFetch('/api/v1/nfse/dashboard/cert-status');
      const data = await r.json();
      const ind = $('#cert-indicator');
      if (data.carregado) {
        ind.className = 'status-indicator online';
        ind.title = 'Cert: ' + (data.info?.subject?.CN || 'OK') + ' | Exp: ' + (data.info?.validade || '?');
      } else {
        ind.className = 'status-indicator offline';
        ind.title = 'Certificado nao carregado';
      }
    } catch (err) {
      $('#cert-indicator').className = 'status-indicator offline';
    }
  }

  // --- Render Table ---
  function renderTable() {
    const search = ($('#search-input').value || '').toLowerCase();
    const statusFilter = $('#filter-status').value;

    let filtered = allNfses.filter(n => {
      if (statusFilter && n.status_nfse !== statusFilter) return false;
      if (search) {
        const haystack = [
          n.fatura, n.parceiro, n.chave_acesso, n.cnpj_tomador, n.numero_nfse
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    $('#result-count').textContent = filtered.length + ' registro' + (filtered.length !== 1 ? 's' : '');

    const tbody = $('#table-body');

    if (!filtered.length) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="9"><div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><p>Nenhuma NFS-e encontrada</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(n => {
      const statusClass = n.status_nfse || '';
      const statusLabel = STATUS_LABELS[statusClass] || statusClass;
      const dateStr = n.data_emissao || n.data_fatura || '';
      const dateFormatted = formatDate(dateStr);
      const timeFormatted = formatTime(dateStr);
      const cnpjMasked = maskCnpj(n.cnpj_tomador);

      return '<tr data-id="' + n.id + '">' +
        '<td><span class="td-status-dot ' + statusClass + '" data-tooltip="' + statusLabel + '"></span></td>' +
        '<td class="td-fatura">' + esc(n.fatura) + '</td>' +
        '<td class="td-nfse">' + (n.numero_nfse ? esc(String(n.numero_nfse)) : '--') + '</td>' +
        '<td class="td-cliente">' + esc(n.parceiro) + '</td>' +
        '<td class="td-cnpj">' + (cnpjMasked || '--') + '</td>' +
        '<td class="td-valor">' + formatCurrency(n.valor_total) + '</td>' +
        '<td class="td-data">' + dateFormatted + (timeFormatted ? '<div class="td-data-time">' + timeFormatted + '</div>' : '') + '</td>' +
        '<td class="td-chave">' + (n.chave_acesso ? '<a href="#" onclick="window._openXml(' + n.id + ');return false" title="Clique para ver XML">' + esc(n.chave_acesso.substring(0, 28)) + '...</a>' : '--') + '</td>' +
        '<td class="td-actions"><div class="action-group">' +
          '<button class="btn-action" data-tooltip="Ver XML" onclick="window._openXml(' + n.id + ')" ' + (!n.tem_xml && !n.chave_acesso ? 'disabled' : '') + '>&lt;/&gt;</button>' +
          '<button class="btn-action btn-action-pdf" data-tooltip="PDF" onclick="window._downloadPdf(' + n.id + ')" ' + (!n.tem_xml && !n.chave_acesso ? 'disabled' : '') + '>PDF</button>' +
          '<button class="btn-action" data-tooltip="Consultar gov.br" onclick="window._consultarSefin(' + n.id + ')" ' + (!n.chave_acesso ? 'disabled' : '') + '>&#x1F310;</button>' +
          (n.status_nfse === 'autorizada' ? '<button class="btn-action" data-tooltip="Re-anexar PDF+XML ao Odoo" onclick="window._reattach(' + n.id + ')" style="color:var(--warning)">&#x21BB;</button>' : '') +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  // --- Global action handlers ---
  window._openXml = function(id) {
    const nf = allNfses.find(n => n.id === id);
    if (!nf) return;
    currentNfse = nf;
    $('#modal-title').textContent = 'XML — NFS-e ' + (nf.numero_nfse || nf.fatura);
    $('#modal-info').textContent = nf.fatura + ' | ' + nf.parceiro + ' | ' + formatCurrency(nf.valor_total);
    $('#modal-xml-content').textContent = 'Carregando XML...';

    // Try loading from Odoo field, then from SEFIN
    openModal();

    // Fetch XML content for viewing
    apiFetch('/api/v1/nfse/dashboard/' + id + '/xml')
      .then(r => {
        if (!r.ok) throw new Error('Nao disponivel');
        return r.text();
      })
      .then(xml => {
        $('#modal-xml-content').textContent = xml;
      })
      .catch(() => {
        $('#modal-xml-content').textContent = 'XML nao disponivel. Tente consultar no gov.br.';
      });
  };

  window._downloadPdf = function(id) {
    window.open('/api/v1/nfse/dashboard/' + id + '/pdf?api_key=' + encodeURIComponent(API_KEY), '_blank');
  };

  window._consultarSefin = async function(id) {
    const nf = allNfses.find(n => n.id === id);
    if (!nf) return;

    $('#sefin-result-body').innerHTML =
      '<div class="sefin-result-card loading"><div class="sefin-result-title" style="color:var(--info)">Consultando gov.br / SEFIN...</div>' +
      '<div class="sefin-result-detail">Chave: <code>' + esc(nf.chave_acesso) + '</code></div></div>';
    $('#sefin-result-overlay').classList.remove('hidden');

    try {
      const r = await apiFetch('/api/v1/nfse/dashboard/' + id + '/consultar');
      const data = await r.json();

      if (data.existe_sefin) {
        $('#sefin-result-body').innerHTML =
          '<div class="sefin-result-card found">' +
          '<div class="sefin-result-title found">NFS-e Encontrada no Portal gov.br</div>' +
          '<div class="sefin-result-detail">' +
          'Fatura: <code>' + esc(nf.fatura) + '</code><br>' +
          'NFS-e: <code>' + esc(data.numero_nfse || '?') + '</code><br>' +
          'Chave: <code>' + esc(data.chave_acesso) + '</code>' +
          (data.dados ? '<br>DFSe: <code>' + esc(data.dados.nDFSe || '') + '</code>' : '') +
          '</div></div>';
      } else {
        $('#sefin-result-body').innerHTML =
          '<div class="sefin-result-card not-found">' +
          '<div class="sefin-result-title not-found">NFS-e NAO Encontrada no Portal</div>' +
          '<div class="sefin-result-detail">' +
          'Fatura: <code>' + esc(nf.fatura) + '</code><br>' +
          'Chave: <code>' + esc(data.chave_acesso || nf.chave_acesso) + '</code><br>' +
          (data.erro ? 'Motivo: ' + esc(data.erro) : 'A nota pode nao ter sido registrada pela SEFIN.') +
          '</div></div>';
      }
    } catch (err) {
      $('#sefin-result-body').innerHTML =
        '<div class="sefin-result-card not-found">' +
        '<div class="sefin-result-title not-found">Erro na Consulta</div>' +
        '<div class="sefin-result-detail">' + esc(err.message) + '</div></div>';
    }
  };

  function consultarSefinFromModal() {
    if (!currentNfse) return;
    const id = currentNfse.id;
    closeModal();
    setTimeout(() => window._consultarSefin(id), 200);
  }

  // --- Modal ---
  function openModal() {
    $('#modal-overlay').classList.remove('hidden');
  }
  function closeModal() {
    $('#modal-overlay').classList.add('hidden');
    currentNfse = null;
  }

  function copyXml() {
    const text = $('#modal-xml-content').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = $('#modal-copy');
      btn.textContent = 'Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
    });
  }

  // --- Re-attach PDF+XML to Odoo ---
  window._reattach = async function(id) {
    const nf = allNfses.find(n => n.id === id);
    if (!nf) return;
    if (!confirm('Re-anexar PDF + XML da NFS-e ' + (nf.numero_nfse || nf.fatura) + ' ao chatter do Odoo?')) return;
    try {
      const r = await fetch('/api/v1/nfse/re-attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
        body: JSON.stringify({ move_id: id }),
      });
      const data = await r.json();
      if (data.sucesso) {
        alert('PDF + XML re-anexados com sucesso!\nVerifique o chatter da fatura ' + nf.fatura + ' no Odoo.');
      } else {
        alert('Falha: ' + (data.erro || 'Erro desconhecido'));
      }
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  };

  function downloadFile(type) {
    if (!currentNfse) return;
    window.open('/api/v1/nfse/dashboard/' + currentNfse.id + '/' + type + '?api_key=' + encodeURIComponent(API_KEY), '_blank');
  }

  // --- Formatters ---
  function formatCurrency(v) {
    return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(s) {
    if (!s) return '--';
    const d = parseDate(s);
    if (!d) return s;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatTime(s) {
    if (!s) return '';
    const d = parseDate(s);
    if (!d) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDateTime(d) {
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function parseDate(s) {
    if (!s) return null;
    // Handle ISO and Odoo format: 2025-08-29 18:30:00 or 2025-08-29T18:30:00
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }

  function maskCnpj(cnpj) {
    if (!cnpj) return '';
    const d = cnpj.replace(/\D/g, '');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return d;
  }

  function esc(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // --- Status Labels ---
  const STATUS_LABELS = {
    'autorizada': 'Autorizada',
    'pendente': 'Pendente',
    'processando': 'Processando',
    'erro': 'Erro',
    'cancelada': 'Cancelada',
    'cancelar_solicitado': 'Cancel. Solicitado',
  };

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
