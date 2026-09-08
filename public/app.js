/*
  ========================================================================
  JJ PAPER -- CLIENTE WEB & CONTROLADOR MULTIAGENTE IA v6.1
  ========================================================================
*/
'use strict';

var currentTab = 'tab-dashboard';
var currentAgent = 'orchestrator';
var currentAgentTitle = 'Orquestador y Supervisor General';
var currentSelectedFilePath = null;

var allProducts = [];
var allClients = [];
var allSales = [];
var agentsList = [];

// ─── INICIALIZACION ───
document.addEventListener('DOMContentLoaded', function() {
  initTabs();
  initChat();
  initFilters();
  initExplorer();
  loadStatusAndData();

  document.getElementById('btn-refresh').addEventListener('click', function() {
    this.disabled = true;
    this.innerText = '⏳ Escaneando...';
    fetch('/api/refresh')
      .then(function(r) { return r.json(); })
      .then(function() {
        loadStatusAndData();
      })
      .finally(function() {
        document.getElementById('btn-refresh').disabled = false;
        document.getElementById('btn-refresh').innerText = '🔄 Refrescar';
      });
  });
});

// ─── CONTROL DE TABS ───
function initTabs() {
  var tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var targetId = this.getAttribute('data-tab');
      switchTab(targetId);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });

  var tabBtn = document.querySelector('[data-tab="' + tabId + '"]');
  var tabPane = document.getElementById(tabId);

  if (tabBtn) tabBtn.classList.add('active');
  if (tabPane) tabPane.classList.add('active');
  currentTab = tabId;

  if (tabId === 'tab-products' && allProducts.length === 0) loadProducts();
  if (tabId === 'tab-clients' && allClients.length === 0) loadClients();
  if (tabId === 'tab-sales' && allSales.length === 0) loadSales();
  if (tabId === 'tab-code') scanExplorerDirectory();
}

// ─── CARGA DE DATOS DESDE LA API ───
function loadStatusAndData() {
  fetch('/api/status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var badge = document.getElementById('status-badge');
      var text = document.getElementById('status-text');

      if (data.online) {
        badge.className = 'status-badge';
        text.innerText = 'Servidor M: Conectado';
      }

      if (data.summary) {
        var s = data.summary;
        document.getElementById('kpi-products').innerText = s.total_productos || 0;
        document.getElementById('kpi-products-sub').innerText = (s.productos_en_stock || 0) + ' en stock físico';

        document.getElementById('kpi-clients').innerText = s.total_clientes || 0;
        document.getElementById('kpi-clients-sub').innerText = (s.clientes_con_whatsapp || 0) + ' con WhatsApp directo';

        document.getElementById('kpi-sales').innerText = s.ventas_recientes_registradas || 0;
        if (s.fecha_maxima_sistema) {
          document.getElementById('kpi-max-date').innerText = 'Última fecha de operación: ' + s.fecha_maxima_sistema;
        }
      }

      if (data.agents && data.agents.length > 0) {
        agentsList = data.agents;
        renderAgentsList(agentsList);
      }

      loadDashboardMinis();
    })
    .catch(function(err) {
      var badge = document.getElementById('status-badge');
      var text = document.getElementById('status-text');
      badge.className = 'status-badge connecting';
      text.innerText = 'Desconectado';
    });
}

function loadDashboardMinis() {
  fetch('/api/products?filter=stock&limit=6')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var html = '<table class="data-table"><thead><tr><th>Producto</th><th>Precio USD</th><th>Stock</th></tr></thead><tbody>';
      data.products.forEach(function(p) {
        html += '<tr>' +
          '<td><strong>' + p.codigo + '</strong> ' + p.descripcion.substring(0, 35) + '</td>' +
          '<td>$' + p.precio_cliente_usd.toFixed(2) + '</td>' +
          '<td><span class="badge badge-stock">' + p.stock_actual + ' un.</span></td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      document.getElementById('dash-products-list').innerHTML = html;
    });

  fetch('/api/clients?filter=whatsapp&limit=6')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var html = '<table class="data-table"><thead><tr><th>Cliente</th><th>RIF</th><th>WhatsApp</th></tr></thead><tbody>';
      data.clients.forEach(function(c) {
        html += '<tr>' +
          '<td>' + c.razon_social.substring(0, 32) + '</td>' +
          '<td>' + c.rif + '</td>' +
          '<td><a href="https://wa.me/58' + c.telefono_movil_whatsapp.replace(/^0/, '') + '" target="_blank" class="badge badge-whatsapp">📱 ' + c.telefono_movil_whatsapp + '</a></td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      document.getElementById('dash-clients-list').innerHTML = html;
    });
}

// ─── TABLA DE PRODUCTOS (CON ROTACION Y NOVEDADES) ───
function loadProducts() {
  var q = document.getElementById('prod-search').value;
  var filterBtn = document.querySelector('.btn-filter.active');
  var filter = filterBtn ? filterBtn.getAttribute('data-filter') || 'all' : 'all';
  var rotacion = filterBtn ? filterBtn.getAttribute('data-rotacion') || '' : '';

  var url = '/api/products?q=' + encodeURIComponent(q) + '&filter=' + filter + '&limit=150';
  if (rotacion) url += '&rotacion=' + encodeURIComponent(rotacion);

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allProducts = data.products;
      var tbody = document.getElementById('tbody-products');
      if (allProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center">No se encontraron productos con ese criterio.</td></tr>';
        return;
      }

      var html = '';
      allProducts.forEach(function(p) {
        var badgeStockClass = p.estado_stock === 'EN_STOCK' ? 'badge-stock' : 'badge-agotado';
        var badgeStockText = p.estado_stock === 'EN_STOCK' ? 'EN STOCK' : 'AGOTADO';

        var badgeRotClass = 'badge-rotacion-media';
        var badgeRotText = 'MEDIA';
        if (p.estado_rotacion === 'ALTA_ROTACION') {
          badgeRotClass = 'badge-rotacion-alta';
          badgeRotText = 'ALTA ROTACION';
        } else if (p.estado_rotacion === 'BAJA_ROTACION_FRIO') {
          badgeRotClass = 'badge-rotacion-fria';
          badgeRotText = 'FRIO (LENTO)';
        } else if (p.estado_rotacion === 'STOCK_INMOVILIZADO') {
          badgeRotClass = 'badge-rotacion-muerta';
          badgeRotText = 'INMOVILIZADO';
        } else if (p.estado_rotacion === 'AGOTADO_VIGENTE') {
          badgeRotClass = 'badge-agotado';
          badgeRotText = 'AGOTADO';
        }

        var novedadIcon = p.es_reciente_o_modificado ? ' <span title="Modificado recientemente" style="color:#fbbf24;">✨</span>' : '';

        html += '<tr>' +
          '<td><code>' + p.codigo + '</code></td>' +
          '<td><strong>' + p.descripcion + '</strong>' + novedadIcon + '</td>' +
          '<td><strong>$' + p.precio_cliente_usd.toFixed(2) + '</strong></td>' +
          '<td>$' + p.precio_mayor_usd.toFixed(2) + '</td>' +
          '<td>' + p.precio_bs.toFixed(2) + ' Bs</td>' +
          '<td>' + p.stock_actual + '</td>' +
          '<td><span class="badge ' + badgeStockClass + '">' + badgeStockText + '</span></td>' +
          '<td><span class="badge ' + badgeRotClass + '">' + badgeRotText + '</span></td>' +
          '<td>' + (p.dias_sin_movimiento < 9000 ? p.dias_sin_movimiento + ' d' : '--') + '</td>' +
          '<td>$' + p.costo_usd.toFixed(2) + '</td>' +
          '<td>' + (p.margen_porcentaje > 0 ? p.margen_porcentaje + '%' : '--') + '</td>' +
          '<td>' + (p.ultimo_movimiento_fmt || 'N/D') + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    });
}

// ─── TABLA DE CLIENTES ───
function loadClients() {
  var q = document.getElementById('cli-search').value;
  var filterBtn = document.querySelector('.btn-filter-cli.active');
  var filter = filterBtn ? filterBtn.getAttribute('data-filter') : 'all';

  fetch('/api/clients?q=' + encodeURIComponent(q) + '&filter=' + filter + '&limit=150')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allClients = data.clients;
      var tbody = document.getElementById('tbody-clients');
      if (allClients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No se encontraron clientes.</td></tr>';
        return;
      }

      var html = '';
      allClients.forEach(function(c) {
        var waLink = c.telefono_movil_whatsapp
          ? '<a href="https://wa.me/58' + c.telefono_movil_whatsapp.replace(/^0/, '') + '" target="_blank" class="badge badge-whatsapp">📱 Escribir</a>'
          : '--';

        html += '<tr>' +
          '<td><code>' + c.codigo + '</code></td>' +
          '<td><strong>' + c.razon_social + '</strong></td>' +
          '<td>' + c.rif + '</td>' +
          '<td>' + (c.telefono_movil_whatsapp || '--') + '</td>' +
          '<td>' + (c.telefono_fijo || '--') + '</td>' +
          '<td>' + (c.email || '--') + '</td>' +
          '<td>' + (c.vendedor || '000') + '</td>' +
          '<td>$' + c.saldo.toFixed(2) + '</td>' +
          '<td>' + waLink + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    });
}

// ─── TABLA DE VENTAS RECIENTES ───
function loadSales() {
  fetch('/api/sales')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allSales = data.sales;
      document.getElementById('sales-count').innerText = data.total + ' ventas registradas';
      var tbody = document.getElementById('tbody-sales');
      if (allSales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay registros de ventas recientes.</td></tr>';
        return;
      }

      var html = '';
      allSales.forEach(function(s) {
        html += '<tr>' +
          '<td><strong>' + s.documento + '</strong></td>' +
          '<td>' + (s.fecha_fmt || s.fecha) + '</td>' +
          '<td>' + s.cliente + '</td>' +
          '<td>' + s.rif + '</td>' +
          '<td><strong>$' + s.total_usd.toFixed(2) + '</strong></td>' +
          '<td>' + (s.vendedor || '--') + '</td>' +
          '<td><span class="badge">' + s.ejercicio + '</span></td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    });
}

// ─── EXPLORADOR DE ARCHIVOS Y CODIGO MIXNET ───
function initExplorer() {
  document.getElementById('btn-scan-dir').addEventListener('click', function() {
    scanExplorerDirectory();
  });
}

function setExplorerDir(dir) {
  document.getElementById('explorer-path').value = dir;
  scanExplorerDirectory();
}

function scanExplorerDirectory() {
  var dir = document.getElementById('explorer-path').value.trim();
  if (!dir) return;

  var fileList = document.getElementById('file-list');
  fileList.innerHTML = '<p class="text-muted small">Escaneando archivos en ' + escapeHtml(dir) + '...</p>';

  fetch('/api/explorer/scan?path=' + encodeURIComponent(dir))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('file-count').innerText = (data.items ? data.items.length : 0) + ' archivos';
      if (!data.items || data.items.length === 0) {
        fileList.innerHTML = '<p class="text-muted small">No se encontraron archivos en este directorio.</p>';
        return;
      }

      var html = '';
      data.items.forEach(function(item) {
        var icon = '📄';
        if (item.type === 'dir') icon = '📁';
        else if (item.ext === 'prg') icon = '💻';
        else if (item.ext === 'dbf') icon = '📊';
        else if (item.ext === 'ini') icon = '⚙️';
        else if (item.ext === 'bat') icon = '⚡';

        var sizeKb = item.sizeBytes ? Math.round(item.sizeBytes / 1024) + ' KB' : (item.type === 'dir' ? 'Carpeta' : '');

        html += '<div class="file-item" onclick="openFile(\'' + escapeHtml(item.path).replace(/\\/g, '\\\\') + '\')">' +
          '<span class="file-icon">' + icon + '</span>' +
          '<div class="file-info">' +
            '<div class="file-name">' + escapeHtml(item.name) + '</div>' +
            '<div class="file-meta">' + sizeKb + '</div>' +
          '</div>' +
        '</div>';
      });

      fileList.innerHTML = html;
    })
    .catch(function(err) {
      fileList.innerHTML = '<p class="text-muted small" style="color:#ef4444;">Error: ' + escapeHtml(err.message) + '</p>';
    });
}

function openFile(filePath) {
  currentSelectedFilePath = filePath;
  document.querySelectorAll('.file-item').forEach(function(el) { el.classList.remove('active'); });

  document.getElementById('current-file-name').innerText = filePath.split('\\').pop() || filePath;
  document.getElementById('btn-analyze-code').style.display = 'inline-flex';

  var viewer = document.getElementById('file-viewer-content');
  viewer.innerHTML = '<p class="text-muted">Cargando archivo...</p>';

  fetch('/api/explorer/read?path=' + encodeURIComponent(filePath))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success) {
        viewer.innerHTML = '<p style="color:#ef4444;">Error: ' + escapeHtml(data.error) + '</p>';
        return;
      }

      if (data.type === 'dbf') {
        var fieldsList = data.fields.map(function(f) { return f.name + ' (' + f.type + ',' + f.len + ')'; }).join(', ');
        var html = '<div style="margin-bottom:12px;">' +
          '<strong>Tabla FoxPro DBF:</strong> ' + escapeHtml(data.fileName) + ' | ' + data.numRecords + ' registros<br>' +
          '<small style="color:#94a3b8;">Campos: ' + escapeHtml(fieldsList) + '</small>' +
        '</div>';

        html += '<table class="data-table" style="font-size:11px;"><thead><tr>';
        data.fields.slice(0, 8).forEach(function(f) { html += '<th>' + f.name + '</th>'; });
        html += '</tr></thead><tbody>';

        (data.sampleRows || []).slice(0, 30).forEach(function(row) {
          html += '<tr>';
          data.fields.slice(0, 8).forEach(function(f) { html += '<td>' + escapeHtml(row[f.name] || '') + '</td>'; });
          html += '</tr>';
        });
        html += '</tbody></table>';
        viewer.innerHTML = html;
      } else {
        // Texto / PRG / INI
        var html = '<div class="code-container">';
        (data.lines || []).forEach(function(line, idx) {
          html += '<div class="code-line">' +
            '<span class="line-num">' + (idx + 1) + '</span>' +
            '<span class="line-content">' + escapeHtml(line) + '</span>' +
          '</div>';
        });
        html += '</div>';
        viewer.innerHTML = html;
      }
    });
}

function analyzeCurrentFile() {
  if (!currentSelectedFilePath) return;

  var viewer = document.getElementById('file-viewer-content');
  var existingContent = viewer.innerHTML;

  var analysisBox = document.createElement('div');
  analysisBox.className = 'code-analysis-box';
  analysisBox.innerHTML = '<strong>🤖 Agente 7 (Auditor de Código MixNet):</strong><p>⏳ Leyendo e interpretando lógica de ' + escapeHtml(currentSelectedFilePath) + '...</p>';
  viewer.prepend(analysisBox);

  fetch('/api/explorer/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: currentSelectedFilePath
    })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        analysisBox.innerHTML = '<strong>Error de Análisis:</strong><p>' + escapeHtml(data.error) + '</p>';
      } else {
        analysisBox.innerHTML = '<strong>🤖 ' + escapeHtml(data.agente) + ' <span class="key-badge">Llave ' + data.llave + '</span>:</strong>' +
          '<div>' + renderMarkdown(data.analisis) + '</div>';
      }
    })
    .catch(function(err) {
      analysisBox.innerHTML = '<strong>Error:</strong><p>' + escapeHtml(err.message) + '</p>';
    });
}

// ─── FILTROS Y BUSQUEDA EN TABLAS ───
function initFilters() {
  var prodSearch = document.getElementById('prod-search');
  var prodTimeout = null;
  prodSearch.addEventListener('input', function() {
    clearTimeout(prodTimeout);
    prodTimeout = setTimeout(loadProducts, 250);
  });

  document.querySelectorAll('.btn-filter').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.btn-filter').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      loadProducts();
    });
  });

  var cliSearch = document.getElementById('cli-search');
  var cliTimeout = null;
  cliSearch.addEventListener('input', function() {
    clearTimeout(cliTimeout);
    cliTimeout = setTimeout(loadClients, 250);
  });

  document.querySelectorAll('.btn-filter-cli').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.btn-filter-cli').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      loadClients();
    });
  });
}

// ─── MULTIAGENTE IA (GEMINI) ───
function renderAgentsList(list) {
  var container = document.getElementById('agents-list');
  var html = '';

  list.forEach(function(ag) {
    var isActive = ag.role === currentAgent ? 'active' : '';
    html += '<div class="agent-item ' + isActive + '" data-role="' + ag.role + '" data-title="' + ag.title + '" data-key="' + ag.id + '">' +
      '<span class="agent-item-title">' + ag.title + '</span>' +
      '<span class="agent-item-sub">Llave ' + ag.id + ' · Especialista</span>' +
    '</div>';
  });

  container.innerHTML = html;

  container.querySelectorAll('.agent-item').forEach(function(item) {
    item.addEventListener('click', function() {
      container.querySelectorAll('.agent-item').forEach(function(i) { i.classList.remove('active'); });
      this.classList.add('active');
      currentAgent = this.getAttribute('data-role');
      currentAgentTitle = this.getAttribute('data-title');
      var keyNum = this.getAttribute('data-key');

      document.getElementById('current-agent-title').innerText = currentAgentTitle;
      document.getElementById('current-key-badge').innerText = 'Llave ' + keyNum + ' (Cascada Activa)';
    });
  });
}

function initChat() {
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    sendChatMessage(text);
  });
}

function askQuick(prompt) {
  switchTab('tab-ai');
  sendChatMessage(prompt);
}

function sendChatMessage(text) {
  var chatMessages = document.getElementById('chat-messages');

  var userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = '<div class="msg-avatar">👤</div><div class="msg-body"><p>' + escapeHtml(text) + '</p></div>';
  chatMessages.appendChild(userMsg);

  var aiMsg = document.createElement('div');
  aiMsg.className = 'msg assistant';
  aiMsg.innerHTML = '<div class="msg-avatar">🤖</div><div class="msg-body"><strong>' + escapeHtml(currentAgentTitle) + ':</strong><p>⏳ Analizando datos de MixNet...</p></div>';
  chatMessages.appendChild(aiMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: currentAgent,
      prompt: text
    })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        aiMsg.querySelector('.msg-body').innerHTML = '<strong>Aviso de Consulta:</strong><p>' + escapeHtml(data.error) + '</p>';
      } else {
        var formattedReply = renderMarkdown(data.reply);
        var modelNote = data.modelUsed ? ' · <small>' + data.modelUsed.replace('models/', '') + '</small>' : '';
        aiMsg.querySelector('.msg-body').innerHTML =
          '<strong>' + escapeHtml(data.agentTitle) + ' <span class="key-badge">Llave ' + data.keyUsed + modelNote + '</span>:</strong>' +
          '<div>' + formattedReply + '</div>';
      }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    })
    .catch(function(err) {
      aiMsg.querySelector('.msg-body').innerHTML = '<strong>Error de conexión:</strong><p>' + escapeHtml(err.message) + '</p>';
    });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(md) {
  if (!md) return '';
  var lines = md.split('\n');
  var html = [];
  var inList = false;

  lines.forEach(function(line) {
    var trimmed = line.trim();

    var l = trimmed
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    if (/^[*-]\s+/.test(trimmed)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push('<li>' + l.replace(/^[*-]\s+/, '') + '</li>');
    } else {
      if (inList) { html.push('</ul>'); inList = false; }
      if (l.indexOf('### ') === 0) {
        html.push('<h4>' + l.substring(4) + '</h4>');
      } else if (l.indexOf('## ') === 0) {
        html.push('<h3>' + l.substring(3) + '</h3>');
      } else if (l.indexOf('# ') === 0) {
        html.push('<h2>' + l.substring(2) + '</h2>');
      } else if (l.length > 0) {
        html.push('<p>' + l + '</p>');
      }
    }
  });

  if (inList) html.push('</ul>');
  return html.join('');
}
