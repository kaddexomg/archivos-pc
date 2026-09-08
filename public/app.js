/*
  ========================================================================
  JJ PAPER -- CLIENTE WEB & CONTROLADOR MULTIAGENTE IA
  ========================================================================
*/
'use strict';

var currentTab = 'tab-dashboard';
var currentAgent = 'orchestrator';
var currentAgentTitle = 'Orquestador y Supervisor General';

var allProducts = [];
var allClients = [];
var allSales = [];
var agentsList = [];

// ─── INICIALIZACION ───
document.addEventListener('DOMContentLoaded', function() {
  initTabs();
  initChat();
  initFilters();
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
  // Mini tabla de productos
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

  // Mini tabla de clientes
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

// ─── TABLA DE PRODUCTOS ───
function loadProducts() {
  var q = document.getElementById('prod-search').value;
  var filterBtn = document.querySelector('.btn-filter.active');
  var filter = filterBtn ? filterBtn.getAttribute('data-filter') : 'all';

  fetch('/api/products?q=' + encodeURIComponent(q) + '&filter=' + filter + '&limit=150')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allProducts = data.products;
      var tbody = document.getElementById('tbody-products');
      if (allProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">No se encontraron productos con ese criterio.</td></tr>';
        return;
      }

      var html = '';
      allProducts.forEach(function(p) {
        var badgeClass = p.estado_stock === 'EN_STOCK' ? 'badge-stock' : 'badge-agotado';
        var badgeText = p.estado_stock === 'EN_STOCK' ? 'EN STOCK' : 'AGOTADO';

        html += '<tr>' +
          '<td><code>' + p.codigo + '</code></td>' +
          '<td><strong>' + p.descripcion + '</strong></td>' +
          '<td><strong>$' + p.precio_cliente_usd.toFixed(2) + '</strong></td>' +
          '<td>$' + p.precio_mayor_usd.toFixed(2) + '</td>' +
          '<td>' + p.precio_bs.toFixed(2) + ' Bs</td>' +
          '<td>' + p.stock_actual + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td>' +
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
      document.getElementById('current-key-badge').innerText = 'Llave ' + keyNum + ' (Gemini 3.6 Flash)';
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

  // Agregar mensaje del usuario
  var userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = '<div class="msg-avatar">👤</div><div class="msg-body"><p>' + escapeHtml(text) + '</p></div>';
  chatMessages.appendChild(userMsg);

  // Agregar mensaje de carga del agente
  var aiMsg = document.createElement('div');
  aiMsg.className = 'msg assistant';
  aiMsg.innerHTML = '<div class="msg-avatar">🤖</div><div class="msg-body"><strong>' + escapeHtml(currentAgentTitle) + ':</strong><p>⏳ Analizando datos de MixNet...</p></div>';
  chatMessages.appendChild(aiMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Llamada a la API
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
        aiMsg.querySelector('.msg-body').innerHTML = '<strong>Error:</strong><p>' + escapeHtml(data.error) + '</p>';
      } else {
        var formattedReply = renderMarkdown(data.reply);
        aiMsg.querySelector('.msg-body').innerHTML =
          '<strong>' + escapeHtml(data.agentTitle) + ' <span class="key-badge">Llave ' + data.keyUsed + '</span>:</strong>' +
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

// Renderizador Markdown básico para respuestas de IA
function renderMarkdown(md) {
  if (!md) return '';
  var lines = md.split('\n');
  var html = [];
  var inList = false;

  lines.forEach(function(line) {
    var trimmed = line.trim();

    // Negritas e Itálicas
    var l = trimmed
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    // Listas
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
