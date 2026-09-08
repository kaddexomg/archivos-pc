/*
  ========================================================================
  JJ PAPER -- CLIENTE WEB & CONTROLADOR MULTIAGENTE IA v6.2
  ========================================================================
  - Compatible con Windows 7, Node 13 y navegadores estándar.
  - Navegación interactiva de discos (C:, D:, M:, P:), subcarpetas y archivos.
  - Localizador Profundo de MixNet y Código Fuente FoxPro (.PRG).
  - Buscador recursivo de archivos con wildcards.
  - Cambio en caliente de carpeta viva de base de datos.
  - Cero cuelgues: manejo total de errores y estados de carga.
*/
'use strict';

// ─── COMPATIBILIDAD CON NAVEGADORES ANTIGUOS (FETCH FALLBACK) ───
if (typeof window.fetch !== 'function') {
  window.fetch = function(url, options) {
    return new Promise(function(resolve, reject) {
      var opts = options || {};
      var xhr = new XMLHttpRequest();
      xhr.open(opts.method || 'GET', url, true);
      if (opts.headers) {
        for (var h in opts.headers) {
          if (Object.prototype.hasOwnProperty.call(opts.headers, h)) {
            xhr.setRequestHeader(h, opts.headers[h]);
          }
        }
      }
      xhr.onload = function() {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          statusText: xhr.statusText,
          json: function() {
            try { return Promise.resolve(JSON.parse(xhr.responseText)); }
            catch (e) { return Promise.reject(e); }
          },
          text: function() { return Promise.resolve(xhr.responseText); }
        });
      };
      xhr.onerror = function() { reject(new TypeError('Error de red al conectar con ' + url)); };
      xhr.send(opts.body || null);
    });
  };
}

// ─── ESTADO GLOBAL DE LA APLICACION ───
var currentTab = 'tab-dashboard';
var currentAgent = 'orchestrator';
var currentAgentTitle = 'Orquestador y Supervisor General';
var currentSelectedFilePath = null;
var currentExplorerParent = null;
var isSearchMode = false;

var allProducts = [];
var allClients = [];
var allSales = [];
var agentsList = [];
var detectedLocations = [];

// ─── INICIALIZACION PRINCIPAL ───
document.addEventListener('DOMContentLoaded', function() {
  try {
    initTabs();
    initChat();
    initFilters();
    initExplorer();
    loadStatusAndData();
  } catch (err) {
    console.error('Error inicializando panel:', err);
  }

  var btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', function() {
      btnRefresh.disabled = true;
      btnRefresh.innerText = '⏳ Escaneando...';
      fetch('/api/refresh')
        .then(function(r) { return r.json(); })
        .then(function() {
          loadStatusAndData();
          if (currentTab === 'tab-products') loadProducts();
          if (currentTab === 'tab-clients') loadClients();
          if (currentTab === 'tab-sales') loadSales();
        })
        .catch(function(e) {
          alert('Error refrescando: ' + e.message);
        })
        .finally(function() {
          btnRefresh.disabled = false;
          btnRefresh.innerText = '🔄 Refrescar';
        });
    });
  }

  var btnBannerDiscover = document.getElementById('btn-banner-discover');
  if (btnBannerDiscover) {
    btnBannerDiscover.addEventListener('click', function() {
      switchTab('tab-code');
      discoverMixnetLocations();
    });
  }
});

// ─── CONTROL DE PESTAÑAS ───
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

  if (tabId === 'tab-products') loadProducts();
  if (tabId === 'tab-clients') loadClients();
  if (tabId === 'tab-sales') loadSales();
  if (tabId === 'tab-code') {
    var pVal = document.getElementById('explorer-path').value.trim();
    if (pVal) scanExplorerDirectory(pVal);
  }
}

// ─── INICIALIZACION DE FILTROS Y BUSCADORES ───
function initFilters() {
  // 1. Filtros de productos
  var prodFilters = document.querySelectorAll('.btn-filter');
  prodFilters.forEach(function(btn) {
    btn.addEventListener('click', function() {
      prodFilters.forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      loadProducts();
    });
  });

  var prodSearch = document.getElementById('prod-search');
  if (prodSearch) {
    var prodTimer = null;
    prodSearch.addEventListener('input', function() {
      clearTimeout(prodTimer);
      prodTimer = setTimeout(function() { loadProducts(); }, 350);
    });
  }

  // 2. Filtros de clientes
  var cliFilters = document.querySelectorAll('.btn-filter-cli');
  cliFilters.forEach(function(btn) {
    btn.addEventListener('click', function() {
      cliFilters.forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      loadClients();
    });
  });

  var cliSearch = document.getElementById('cli-search');
  if (cliSearch) {
    var cliTimer = null;
    cliSearch.addEventListener('input', function() {
      clearTimeout(cliTimer);
      cliTimer = setTimeout(function() { loadClients(); }, 350);
    });
  }

  // 3. Buscador de ventas
  var salesSearch = document.getElementById('sales-search');
  if (salesSearch) {
    var salesTimer = null;
    salesSearch.addEventListener('input', function() {
      clearTimeout(salesTimer);
      salesTimer = setTimeout(function() { loadSales(); }, 350);
    });
  }
}

// ─── CARGA DE ESTADO Y RESUMEN GENERAL ───
function loadStatusAndData() {
  var badge = document.getElementById('status-badge');
  var text = document.getElementById('status-text');
  var banner = document.getElementById('connection-banner');

  fetch('/api/status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.online) {
        if (data.initialized && data.liveDir) {
          badge.className = 'status-badge';
          text.innerText = 'MixNet: ' + data.liveDir;
          if (banner) banner.style.display = 'none';
        } else {
          badge.className = 'status-badge connecting';
          text.innerText = 'Esperando conexión MixNet';
          if (banner) banner.style.display = 'flex';
        }
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

      if (data.availableDrives && data.availableDrives.length > 0) {
        renderDrivesBar(data.availableDrives);
      }

      if (data.detectedLocations && data.detectedLocations.length > 0) {
        detectedLocations = data.detectedLocations;
        renderQuickLocations(detectedLocations);
      }

      if (data.agents && data.agents.length > 0) {
        agentsList = data.agents;
        renderAgentsList(agentsList);
      }

      loadDashboardMinis();
      // Pre-cargar pestañas para que ninguna quede en estado "Cargando..."
      loadProducts();
      loadClients();
      loadSales();
    })
    .catch(function(err) {
      badge.className = 'status-badge connecting';
      text.innerText = 'Servidor desconectado';
      if (banner) banner.style.display = 'flex';
      console.error('Error cargando estado:', err);
    });
}

function loadDashboardMinis() {
  fetch('/api/products?filter=stock&limit=6')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('dash-products-list');
      if (!data.products || data.products.length === 0) {
        container.innerHTML = '<p class="text-muted small">No hay productos en memoria. Conecta una carpeta de MixNet.</p>';
        return;
      }
      var html = '<table class="data-table"><thead><tr><th>Producto</th><th>Precio USD</th><th>Stock</th></tr></thead><tbody>';
      data.products.forEach(function(p) {
        html += '<tr>' +
          '<td><strong>' + escapeHtml(p.codigo) + '</strong> ' + escapeHtml(p.descripcion.substring(0, 32)) + '</td>' +
          '<td>$' + p.precio_cliente_usd.toFixed(2) + '</td>' +
          '<td><span class="badge badge-stock">' + p.stock_actual + ' un.</span></td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    })
    .catch(function() {
      document.getElementById('dash-products-list').innerHTML = '<p class="text-muted small">Sin datos disponibles.</p>';
    });

  fetch('/api/clients?filter=whatsapp&limit=6')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('dash-clients-list');
      if (!data.clients || data.clients.length === 0) {
        container.innerHTML = '<p class="text-muted small">No hay clientes en memoria. Conecta una carpeta de MixNet.</p>';
        return;
      }
      var html = '<table class="data-table"><thead><tr><th>Cliente</th><th>RIF</th><th>WhatsApp</th></tr></thead><tbody>';
      data.clients.forEach(function(c) {
        var waNum = c.telefono_movil_whatsapp ? c.telefono_movil_whatsapp.replace(/^0/, '') : '';
        var waCell = waNum
          ? '<a href="https://wa.me/58' + waNum + '" target="_blank" class="badge badge-whatsapp">📱 ' + escapeHtml(c.telefono_movil_whatsapp) + '</a>'
          : '--';

        html += '<tr>' +
          '<td>' + escapeHtml(c.razon_social.substring(0, 28)) + '</td>' +
          '<td>' + escapeHtml(c.rif) + '</td>' +
          '<td>' + waCell + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    })
    .catch(function() {
      document.getElementById('dash-clients-list').innerHTML = '<p class="text-muted small">Sin datos disponibles.</p>';
    });
}

// ─── TABLA DE PRODUCTOS (CON ROTACION Y NOVEDADES) ───
function loadProducts() {
  var tbody = document.getElementById('tbody-products');
  tbody.innerHTML = '<tr class="table-loading-row"><td colspan="14">⏳ Cargando productos desde la base de datos...</td></tr>';

  var prodSearch = document.getElementById('prod-search');
  var q = prodSearch ? prodSearch.value.trim() : '';
  var filterBtn = document.querySelector('.btn-filter.active');
  var filter = filterBtn ? (filterBtn.getAttribute('data-filter') || 'all') : 'all';
  var rotacion = filterBtn ? (filterBtn.getAttribute('data-rotacion') || '') : '';

  var url = '/api/products?q=' + encodeURIComponent(q) + '&filter=' + filter + '&limit=150';
  if (rotacion) url += '&rotacion=' + encodeURIComponent(rotacion);

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allProducts = data.products || [];
      if (allProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="text-center" style="padding:30px;">' +
          'No se encontraron productos con ese criterio.<br>' +
          '<small class="text-muted">Si no has conectado la base de datos de MixNet, ve a la pestaña "💻 Código & Explorador" y selecciona la carpeta con tus archivos .DBF.</small>' +
        '</td></tr>';
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

        var salidasCell = p.unidades_vendidas_historico > 0
          ? '<span class="badge badge-stock" title="' + p.facturas_conteo + ' facturas/movimientos">🔥 ' + p.unidades_vendidas_historico + ' un</span>'
          : '<span class="text-muted small">0 un</span>';

        var volCell = p.volumen_usd_facturado > 0
          ? '<strong>$' + p.volumen_usd_facturado.toFixed(2) + '</strong>'
          : '<span class="text-muted small">$0.00</span>';

        html += '<tr>' +
          '<td><code>' + escapeHtml(p.codigo) + '</code></td>' +
          '<td><strong>' + escapeHtml(p.descripcion) + '</strong>' + novedadIcon + '</td>' +
          '<td><strong>$' + p.precio_cliente_usd.toFixed(2) + '</strong></td>' +
          '<td>$' + p.precio_mayor_usd.toFixed(2) + '</td>' +
          '<td>' + p.precio_bs.toFixed(2) + ' Bs</td>' +
          '<td>' + p.stock_actual + '</td>' +
          '<td><span class="badge ' + badgeStockClass + '">' + badgeStockText + '</span></td>' +
          '<td><span class="badge ' + badgeRotClass + '">' + badgeRotText + '</span></td>' +
          '<td>' + salidasCell + '</td>' +
          '<td>' + volCell + '</td>' +
          '<td>' + (p.dias_sin_movimiento < 9000 ? p.dias_sin_movimiento + ' d' : '--') + '</td>' +
          '<td>$' + p.costo_usd.toFixed(2) + '</td>' +
          '<td>' + (p.margen_porcentaje > 0 ? p.margen_porcentaje + '%' : '--') + '</td>' +
          '<td>' + (p.ultimo_movimiento_fmt || 'N/D') + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    })
    .catch(function(err) {
      tbody.innerHTML = '<tr><td colspan="14" class="text-center text-danger" style="padding:30px;">' +
        'Error cargando productos: ' + escapeHtml(err.message) + '<br>' +
        '<button class="btn btn-secondary btn-sm" onclick="loadProducts()" style="margin-top:10px;">Reintentar</button>' +
      '</td></tr>';
    });
}

// ─── TABLA DE CLIENTES ───
function loadClients() {
  var tbody = document.getElementById('tbody-clients');
  tbody.innerHTML = '<tr class="table-loading-row"><td colspan="9">⏳ Cargando cartera de clientes...</td></tr>';

  var cliSearch = document.getElementById('cli-search');
  var q = cliSearch ? cliSearch.value.trim() : '';
  var filterBtn = document.querySelector('.btn-filter-cli.active');
  var filter = filterBtn ? (filterBtn.getAttribute('data-filter') || 'all') : 'all';

  fetch('/api/clients?q=' + encodeURIComponent(q) + '&filter=' + filter + '&limit=150')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allClients = data.clients || [];
      if (allClients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:30px;">' +
          'No se encontraron clientes con ese criterio.<br>' +
          '<small class="text-muted">Verifica si la tabla MXCTACLI.DBF está en la carpeta conectada.</small>' +
        '</td></tr>';
        return;
      }

      var html = '';
      allClients.forEach(function(c) {
        var waNum = c.telefono_movil_whatsapp ? c.telefono_movil_whatsapp.replace(/^0/, '') : '';
        var waLink = waNum
          ? '<a href="https://wa.me/58' + waNum + '" target="_blank" class="badge badge-whatsapp">📱 Escribir</a>'
          : '--';

        html += '<tr>' +
          '<td><code>' + escapeHtml(c.codigo) + '</code></td>' +
          '<td><strong>' + escapeHtml(c.razon_social) + '</strong></td>' +
          '<td>' + escapeHtml(c.rif) + '</td>' +
          '<td>' + (c.telefono_movil_whatsapp || '--') + '</td>' +
          '<td>' + (c.telefono_fijo || '--') + '</td>' +
          '<td>' + (c.email || '--') + '</td>' +
          '<td>' + (c.vendedor || '000') + '</td>' +
          '<td>$' + c.saldo.toFixed(2) + '</td>' +
          '<td>' + waLink + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    })
    .catch(function(err) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger" style="padding:30px;">' +
        'Error cargando clientes: ' + escapeHtml(err.message) + '<br>' +
        '<button class="btn btn-secondary btn-sm" onclick="loadClients()" style="margin-top:10px;">Reintentar</button>' +
      '</td></tr>';
    });
}

// ─── TABLA DE VENTAS RECIENTES ───
function loadSales() {
  var tbody = document.getElementById('tbody-sales');
  tbody.innerHTML = '<tr class="table-loading-row"><td colspan="7">⏳ Cargando albaranes y facturas...</td></tr>';

  var salesSearch = document.getElementById('sales-search');
  var q = salesSearch ? salesSearch.value.trim() : '';

  fetch('/api/sales?q=' + encodeURIComponent(q))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allSales = data.sales || [];
      var countEl = document.getElementById('sales-count');
      if (countEl) countEl.innerText = (data.total || 0) + ' ventas';

      if (allSales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:30px;">' +
          'No se encontraron ventas registradas en esta carpeta.<br>' +
          '<small class="text-muted">MixNet almacena ventas en tablas ALB.DBF dentro de carpetas EJ2024, EJ2025, etc.</small>' +
        '</td></tr>';
        return;
      }

      var html = '';
      allSales.forEach(function(s) {
        html += '<tr>' +
          '<td><strong>' + escapeHtml(s.documento) + '</strong></td>' +
          '<td>' + escapeHtml(s.fecha_fmt || s.fecha || '--') + '</td>' +
          '<td>' + escapeHtml(s.cliente) + '</td>' +
          '<td>' + escapeHtml(s.rif) + '</td>' +
          '<td><strong>$' + s.total_usd.toFixed(2) + '</strong></td>' +
          '<td>' + escapeHtml(s.vendedor || '--') + '</td>' +
          '<td><span class="badge">' + escapeHtml(s.ejercicio || 'Venta') + '</span></td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    })
    .catch(function(err) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger" style="padding:30px;">' +
        'Error cargando ventas: ' + escapeHtml(err.message) + '<br>' +
        '<button class="btn btn-secondary btn-sm" onclick="loadSales()" style="margin-top:10px;">Reintentar</button>' +
      '</td></tr>';
    });
}

// ─── EXPLORADOR INTERACTIVO Y BUSCADOR UNIVERSAL ───
function initExplorer() {
  var btnScan = document.getElementById('btn-scan-dir');
  if (btnScan) {
    btnScan.addEventListener('click', function() {
      var dir = document.getElementById('explorer-path').value.trim();
      if (dir) scanExplorerDirectory(dir);
    });
  }

  var pathInput = document.getElementById('explorer-path');
  if (pathInput) {
    pathInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var dir = this.value.trim();
        if (dir) scanExplorerDirectory(dir);
      }
    });
  }

  var btnUp = document.getElementById('btn-nav-up');
  if (btnUp) {
    btnUp.addEventListener('click', function() {
      if (currentExplorerParent) {
        scanExplorerDirectory(currentExplorerParent);
      }
    });
  }

  var btnUseAsDb = document.getElementById('btn-use-as-db');
  if (btnUseAsDb) {
    btnUseAsDb.addEventListener('click', function() {
      var dir = document.getElementById('explorer-path').value.trim();
      if (dir) setAsDatabaseDirectory(dir);
    });
  }

  var btnDeepSearch = document.getElementById('btn-deep-search');
  if (btnDeepSearch) {
    btnDeepSearch.addEventListener('click', function() {
      executeDeepSearch();
    });
  }

  var searchInput = document.getElementById('explorer-search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') executeDeepSearch();
    });
  }

  var btnClearSearch = document.getElementById('btn-clear-search');
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', function() {
      isSearchMode = false;
      this.style.display = 'none';
      var dir = document.getElementById('explorer-path').value.trim();
      if (dir) scanExplorerDirectory(dir);
    });
  }

  var btnDiscover = document.getElementById('btn-discover-all');
  if (btnDiscover) {
    btnDiscover.addEventListener('click', function() {
      discoverMixnetLocations();
    });
  }
}

function renderDrivesBar(drives) {
  var container = document.getElementById('drives-bar');
  if (!container) return;
  var html = '';
  drives.forEach(function(d) {
    html += '<button class="btn-drive" onclick="setExplorerDir(\'' + escapeHtml(d).replace(/\\/g, '\\\\') + '\')">' + escapeHtml(d) + '</button>';
  });
  container.innerHTML = html;
}

function renderQuickLocations(locations) {
  var container = document.getElementById('quick-locations-bar');
  if (!container) return;
  var html = '<span class="text-muted small">Carpetas MixNet detectadas:</span> ';
  locations.slice(0, 6).forEach(function(loc) {
    var icon = loc.role === 'BASE_DATOS_VIVA' ? '📊' : (loc.role === 'CODIGO_FUENTE' ? '💻' : '📁');
    html += '<button class="location-chip" onclick="setExplorerDir(\'' + escapeHtml(loc.path).replace(/\\/g, '\\\\') + '\')">' +
      icon + ' ' + escapeHtml(pathBasename(loc.path)) +
    '</button> ';
  });
  container.innerHTML = html;
}

function setExplorerDir(dir) {
  var input = document.getElementById('explorer-path');
  if (input) input.value = dir;
  scanExplorerDirectory(dir);
}

function scanExplorerDirectory(dir) {
  isSearchMode = false;
  var clearBtn = document.getElementById('btn-clear-search');
  if (clearBtn) clearBtn.style.display = 'none';

  var fileList = document.getElementById('file-list');
  var titleEl = document.getElementById('explorer-list-title');
  var countBadge = document.getElementById('file-count');
  var btnUp = document.getElementById('btn-nav-up');

  fileList.innerHTML = '<p class="text-muted small">Explorando ' + escapeHtml(dir) + '...</p>';
  if (titleEl) titleEl.innerText = 'Carpeta: ' + pathBasename(dir);

  fetch('/api/explorer/scan?path=' + encodeURIComponent(dir))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success) {
        fileList.innerHTML = '<div class="text-danger small" style="padding:10px;">' +
          '⚠️ ' + escapeHtml(data.error) + '<br>' +
          '<small>Verifica si la unidad está montada o escribe otra ruta.</small>' +
        '</div>';
        return;
      }

      currentExplorerParent = data.parentPath;
      if (btnUp) btnUp.disabled = !data.parentPath;

      var totalItems = (data.folders ? data.folders.length : 0) + (data.files ? data.files.length : 0);
      if (countBadge) countBadge.innerText = totalItems + ' elementos (' + (data.folders ? data.folders.length : 0) + ' carp, ' + (data.files ? data.files.length : 0) + ' arch)';

      var html = '';

      // Enlace para subir de nivel
      if (data.parentPath) {
        html += '<div class="file-item folder" onclick="scanExplorerDirectory(\'' + escapeHtml(data.parentPath).replace(/\\/g, '\\\\') + '\')">' +
          '<span class="file-icon">⬆️</span>' +
          '<div class="file-info">' +
            '<div class="file-name">[.. Subir a nivel superior]</div>' +
            '<div class="file-meta">' + escapeHtml(data.parentPath) + '</div>' +
          '</div>' +
        '</div>';
      }

      // Carpetas primero
      if (data.folders) {
        data.folders.forEach(function(folder) {
          html += '<div class="file-item folder" onclick="scanExplorerDirectory(\'' + escapeHtml(folder.path).replace(/\\/g, '\\\\') + '\')">' +
            '<span class="file-icon">📁</span>' +
            '<div class="file-info">' +
              '<div class="file-name"><strong>' + escapeHtml(folder.name) + '</strong></div>' +
              '<div class="file-meta">Carpeta</div>' +
            '</div>' +
          '</div>';
        });
      }

      // Archivos
      if (data.files) {
        data.files.forEach(function(file) {
          var icon = '📄';
          var ext = file.ext.toLowerCase();
          if (ext === 'prg' || ext === 'spr' || ext === 'mpr') icon = '💻';
          else if (ext === 'dbf') icon = '📊';
          else if (ext === 'ini' || ext === 'cfg') icon = '⚙️';
          else if (ext === 'bat') icon = '⚡';
          else if (ext === 'exe') icon = '📦';

          var sizeKb = file.sizeBytes ? Math.round(file.sizeBytes / 1024) + ' KB' : '';

          html += '<div class="file-item" onclick="openFile(\'' + escapeHtml(file.path).replace(/\\/g, '\\\\') + '\')">' +
            '<span class="file-icon">' + icon + '</span>' +
            '<div class="file-info">' +
              '<div class="file-name">' + escapeHtml(file.name) + '</div>' +
              '<div class="file-meta">' + sizeKb + ' · .' + ext.toUpperCase() + '</div>' +
            '</div>' +
          '</div>';
        });
      }

      if (totalItems === 0 && !data.parentPath) {
        html = '<p class="text-muted small">Directorio vacío.</p>';
      }

      fileList.innerHTML = html;
      document.getElementById('explorer-path').value = data.currentPath;
    })
    .catch(function(err) {
      fileList.innerHTML = '<p class="text-danger small">Error: ' + escapeHtml(err.message) + '</p>';
    });
}

function executeDeepSearch() {
  var searchInput = document.getElementById('explorer-search-input');
  var q = searchInput ? searchInput.value.trim() : '';
  if (!q) {
    alert('Ingresa un término de búsqueda (ejemplo: *.prg, apartad, clsventa, *.dbf)');
    return;
  }

  var dir = document.getElementById('explorer-path').value.trim() || 'C:\\';
  var fileList = document.getElementById('file-list');
  var titleEl = document.getElementById('explorer-list-title');
  var countBadge = document.getElementById('file-count');
  var clearBtn = document.getElementById('btn-clear-search');

  isSearchMode = true;
  if (clearBtn) clearBtn.style.display = 'inline-block';
  if (titleEl) titleEl.innerText = 'Resultados de Búsqueda: "' + q + '"';
  fileList.innerHTML = '<p class="text-muted small">Buscando recursivamente en ' + escapeHtml(dir) + '...</p>';

  fetch('/api/explorer/search?path=' + encodeURIComponent(dir) + '&q=' + encodeURIComponent(q))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (countBadge) countBadge.innerText = (data.totalFound || 0) + ' coincidencias';
      if (!data.results || data.results.length === 0) {
        fileList.innerHTML = '<div class="text-muted small" style="padding:14px;">' +
          'No se encontraron archivos con ese nombre en ' + escapeHtml(dir) + '.<br>' +
          '<button class="btn btn-secondary btn-sm" onclick="scanExplorerDirectory(\'' + escapeHtml(dir).replace(/\\/g, '\\\\') + '\')" style="margin-top:8px;">Volver a la carpeta</button>' +
        '</div>';
        return;
      }

      var html = '';
      data.results.forEach(function(item) {
        var icon = '📄';
        var ext = item.ext.toLowerCase();
        if (ext === 'prg' || ext === 'spr' || ext === 'mpr') icon = '💻';
        else if (ext === 'dbf') icon = '📊';
        else if (ext === 'ini' || ext === 'cfg') icon = '⚙️';
        else if (ext === 'bat') icon = '⚡';
        else if (ext === 'exe') icon = '📦';

        var sizeKb = item.sizeBytes ? Math.round(item.sizeBytes / 1024) + ' KB' : '';

        html += '<div class="file-item" onclick="openFile(\'' + escapeHtml(item.path).replace(/\\/g, '\\\\') + '\')">' +
          '<span class="file-icon">' + icon + '</span>' +
          '<div class="file-info">' +
            '<div class="file-name">' + escapeHtml(item.name) + '</div>' +
            '<div class="file-meta">' + escapeHtml(item.dir) + ' (' + sizeKb + ')</div>' +
          '</div>' +
        '</div>';
      });

      fileList.innerHTML = html;
    })
    .catch(function(err) {
      fileList.innerHTML = '<p class="text-danger small">Error buscando: ' + escapeHtml(err.message) + '</p>';
    });
}

function discoverMixnetLocations() {
  var fileList = document.getElementById('file-list');
  var titleEl = document.getElementById('explorer-list-title');
  var countBadge = document.getElementById('file-count');

  if (titleEl) titleEl.innerText = 'Buscando Instalaciones MixNet...';
  fileList.innerHTML = '<p class="text-muted small">⚡ Escaneando todos los discos en busca de MixNet, código FoxPro y bases de datos...</p>';

  fetch('/api/discover')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (countBadge) countBadge.innerText = (data.total || 0) + ' ubicaciones';
      if (!data.locations || data.locations.length === 0) {
        fileList.innerHTML = '<div class="text-warning small" style="padding:14px;">' +
          'No se detectaron carpetas estándar de MixNet en los discos principales.<br>' +
          'Puedes explorar manualmente usando los botones de unidad arriba.' +
        '</div>';
        return;
      }

      detectedLocations = data.locations;
      renderQuickLocations(detectedLocations);

      var html = '<div style="padding:4px 0 10px 0;"><small class="text-muted">Haz clic en <strong>"Conectar"</strong> para cargar los datos en el sistema o en el nombre para explorar la carpeta:</small></div>';

      detectedLocations.forEach(function(loc) {
        var roleLabel = 'Base de Datos Viva';
        var badgeClass = 'badge-stock';
        if (loc.role === 'CODIGO_FUENTE') { roleLabel = 'Código Fuente FoxPro'; badgeClass = 'badge-rotacion-media'; }
        else if (loc.role === 'PROGRAMA_EJECUTABLE') { roleLabel = 'Ejecutable MixNet'; badgeClass = 'badge-rotacion-fria'; }
        else if (loc.role === 'CONFIG_Y_DATOS') { roleLabel = 'Configuración .INI / Datos'; badgeClass = 'badge-rotacion-fria'; }

        html += '<div class="file-item folder" style="flex-direction:column; align-items:flex-start; gap:6px; padding:10px; margin-bottom:8px;">' +
          '<div style="display:flex; justify-content:space-between; width:100%; align-items:center;">' +
            '<span class="badge ' + badgeClass + '">' + roleLabel + '</span>' +
            '<button class="btn btn-success btn-sm" onclick="event.stopPropagation(); setAsDatabaseDirectory(\'' + escapeHtml(loc.path).replace(/\\/g, '\\\\') + '\')">🔌 Conectar</button>' +
          '</div>' +
          '<div style="cursor:pointer; width:100%;" onclick="setExplorerDir(\'' + escapeHtml(loc.path).replace(/\\/g, '\\\\') + '\')">' +
            '<strong>' + escapeHtml(loc.path) + '</strong>' +
            '<div class="file-meta" style="margin-top:4px;">' +
              (loc.dbfCount ? loc.dbfCount + ' tablas .DBF  ' : '') +
              (loc.prgCount ? loc.prgCount + ' archivos .PRG  ' : '') +
              (loc.iniCount ? loc.iniCount + ' config .INI  ' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      });

      fileList.innerHTML = html;
      if (titleEl) titleEl.innerText = 'Instalaciones MixNet Encontradas';
    })
    .catch(function(err) {
      fileList.innerHTML = '<p class="text-danger small">Error en localizador: ' + escapeHtml(err.message) + '</p>';
    });
}

function setAsDatabaseDirectory(dirPath) {
  if (!confirm('¿Deseas conectar "' + dirPath + '" como la carpeta activa de datos de JJ PAPER?')) return;

  var statusText = document.getElementById('status-text');
  if (statusText) statusText.innerText = 'Cargando datos desde ' + dirPath + '...';

  fetch('/api/set-directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        alert('✔ Base de datos conectada exitosamente.\n' +
              'Productos: ' + (data.summary.total_productos || 0) + '\n' +
              'Clientes: ' + (data.summary.total_clientes || 0) + '\n' +
              'Ventas: ' + (data.summary.ventas_recientes_registradas || 0));
        loadStatusAndData();
        loadProducts();
        loadClients();
        loadSales();
      } else {
        alert('Aviso: ' + (data.error || 'No se pudo conectar la carpeta.'));
      }
    })
    .catch(function(err) {
      alert('Error de conexión: ' + err.message);
    });
}

// ─── VISOR DE ARCHIVO Y ANALISIS DE CODIGO IA ───
function openFile(filePath) {
  currentSelectedFilePath = filePath;
  var fileName = pathBasename(filePath);
  var viewer = document.getElementById('file-viewer-content');
  var nameEl = document.getElementById('current-file-name');
  var btnAnalyze = document.getElementById('btn-analyze-code');
  var analysisBox = document.getElementById('analysis-container');

  if (nameEl) nameEl.innerText = fileName;
  if (btnAnalyze) btnAnalyze.style.display = 'inline-block';
  if (analysisBox) analysisBox.style.display = 'none';

  viewer.innerHTML = '<p class="text-muted small">Cargando archivo ' + escapeHtml(fileName) + '...</p>';

  fetch('/api/explorer/read?path=' + encodeURIComponent(filePath) + '&limit=400')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success) {
        viewer.innerHTML = '<p class="text-danger small">Error leyendo archivo: ' + escapeHtml(data.error) + '</p>';
        return;
      }

      var btnExportTbl = document.getElementById('btn-export-table');

      if (data.type === 'dbf') {
        if (btnExportTbl) btnExportTbl.style.display = 'inline-block';
        var html = '<div style="margin-bottom:12px; color:#38bdf8;">' +
          '<strong>Tabla FoxPro DBF:</strong> ' + data.numRecords + ' registros totales, ' + data.fields.length + ' campos.' +
        '</div>';

        html += '<table class="data-table" style="font-size:11px;"><thead><tr>';
        data.fields.forEach(function(f) { html += '<th>' + escapeHtml(f.name) + ' (' + f.type + ')</th>'; });
        html += '</tr></thead><tbody>';

        if (data.sampleRows && data.sampleRows.length > 0) {
          data.sampleRows.forEach(function(row) {
            html += '<tr>';
            data.fields.forEach(function(f) {
              html += '<td>' + escapeHtml(row[f.name] || '') + '</td>';
            });
            html += '</tr>';
          });
        }
        html += '</tbody></table>';
        viewer.innerHTML = html;
        return;
      }

      if (btnExportTbl) btnExportTbl.style.display = 'none';

      // Archivo de texto / código FoxPro / INI
      var codeHtml = '';
      if (data.lines) {
        data.lines.forEach(function(line, idx) {
          codeHtml += '<div class="code-line">' +
            '<span class="line-num">' + (idx + 1) + '</span>' +
            '<span class="line-content">' + escapeHtml(line) + '</span>' +
          '</div>';
        });
      }
      viewer.innerHTML = codeHtml;
    })
    .catch(function(err) {
      viewer.innerHTML = '<p class="text-danger small">Error de conexión: ' + escapeHtml(err.message) + '</p>';
    });
}

function analyzeCurrentFile() {
  if (!currentSelectedFilePath) return;

  var btn = document.getElementById('btn-analyze-code');
  var container = document.getElementById('analysis-container');
  btn.disabled = true;
  btn.innerText = '⏳ Analizando lógica con IA...';

  container.style.display = 'block';
  container.innerHTML = '<div class="code-analysis-box">' +
    '<h4>🤖 Agente 7 (Auditor de Código MixNet):</h4>' +
    '<p>Analizando estructura, fórmulas y tablas abiertas en ' + escapeHtml(pathBasename(currentSelectedFilePath)) + '...</p>' +
  '</div>';

  fetch('/api/explorer/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentSelectedFilePath })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        container.innerHTML = '<div class="code-analysis-box" style="border-color:#ef4444; background:#450a0a;">' +
          '<h4>Error de análisis:</h4>' +
          '<p>' + escapeHtml(data.error) + '</p>' +
        '</div>';
      } else {
        var replyFormatted = renderMarkdown(data.analisis);
        container.innerHTML = '<div class="code-analysis-box">' +
          '<h4>🤖 ' + escapeHtml(data.agente) + ' <span class="key-badge">Llave ' + data.llave + '</span>:</h4>' +
          '<div>' + replyFormatted + '</div>' +
        '</div>';
      }
    })
    .catch(function(err) {
      container.innerHTML = '<div class="code-analysis-box" style="border-color:#ef4444; background:#450a0a;">' +
        '<h4>Error de conexión:</h4>' +
        '<p>' + escapeHtml(err.message) + '</p>' +
      '</div>';
    })
    .finally(function() {
      btn.disabled = false;
      btn.innerText = '🤖 Analizar Lógica con IA (Agente 7)';
    });
}

// ─── CHAT CON LOS 7 AGENTES GEMINI ───
function initChat() {
  var sendBtn = document.getElementById('btn-send-chat');
  var chatInput = document.getElementById('chat-input');

  if (sendBtn) {
    sendBtn.addEventListener('click', function() {
      sendChatMessage();
    });
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }
}

function renderAgentsList(agents) {
  var container = document.getElementById('agents-list');
  if (!container) return;

  var html = '';
  agents.forEach(function(ag) {
    var activeClass = ag.role === currentAgent ? 'active' : '';
    html += '<div class="agent-card ' + activeClass + '" onclick="selectAgent(\'' + ag.role + '\', \'' + escapeHtml(ag.title).replace(/'/g, "\\'") + '\', \'' + escapeHtml(ag.description).replace(/'/g, "\\'") + '\')">' +
      '<div class="agent-avatar">' + (ag.icon || '🤖') + '</div>' +
      '<div class="agent-meta">' +
        '<h4>' + escapeHtml(ag.title) + '</h4>' +
        '<p>' + escapeHtml(ag.description) + '</p>' +
        '<span class="agent-key">Llave ' + ag.keyId + '</span>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;
}

function selectAgent(role, title, desc) {
  currentAgent = role;
  currentAgentTitle = title;

  document.querySelectorAll('.agent-card').forEach(function(c) { c.classList.remove('active'); });
  var selectedCard = Array.from(document.querySelectorAll('.agent-card')).find(function(c) {
    return c.querySelector('h4').innerText === title;
  });
  if (selectedCard) selectedCard.classList.add('active');

  var titleEl = document.getElementById('active-agent-title');
  var roleEl = document.getElementById('active-agent-role');
  if (titleEl) titleEl.innerText = title;
  if (roleEl) roleEl.innerText = desc;
}

function sendChatMessage() {
  var chatInput = document.getElementById('chat-input');
  var text = chatInput.value.trim();
  if (!text) return;

  var chatMessages = document.getElementById('chat-messages');

  var userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = '<div class="msg-avatar">👤</div><div class="msg-body"><p>' + escapeHtml(text) + '</p></div>';
  chatMessages.appendChild(userMsg);
  chatInput.value = '';

  var aiMsg = document.createElement('div');
  aiMsg.className = 'msg assistant';
  aiMsg.innerHTML = '<div class="msg-avatar">🤖</div><div class="msg-body"><strong>' + escapeHtml(currentAgentTitle) + ':</strong><p>⏳ Consultando a la IA...</p></div>';
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
        aiMsg.querySelector('.msg-body').innerHTML = '<strong>Aviso de Consulta:</strong><p class="text-danger">' + escapeHtml(data.error) + '</p>';
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
      aiMsg.querySelector('.msg-body').innerHTML = '<strong>Error de conexión:</strong><p class="text-danger">' + escapeHtml(err.message) + '</p>';
    });
}

// ─── UTILIDADES ───
function pathBasename(p) {
  if (!p) return '';
  var parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
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

// ─── EXPORTACION DE ARCHIVOS A CSV ───
function triggerDownload(url) {
  var a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', '');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function exportCurrentProductsCSV() {
  var prodSearch = document.getElementById('prod-search');
  var q = prodSearch ? prodSearch.value.trim() : '';
  var filterBtn = document.querySelector('.btn-filter.active');
  var filter = filterBtn ? (filterBtn.getAttribute('data-filter') || 'all') : 'all';
  var rotacion = filterBtn ? (filterBtn.getAttribute('data-rotacion') || '') : '';

  var url = '/api/export/products?q=' + encodeURIComponent(q) + '&filter=' + filter;
  if (rotacion) url += '&rotacion=' + encodeURIComponent(rotacion);

  triggerDownload(url);
}

function exportCurrentClientsCSV() {
  var cliSearch = document.getElementById('cli-search');
  var q = cliSearch ? cliSearch.value.trim() : '';
  var filterBtn = document.querySelector('.btn-filter-cli.active');
  var filter = filterBtn ? (filterBtn.getAttribute('data-filter') || 'all') : 'all';

  var url = '/api/export/clients?q=' + encodeURIComponent(q) + '&filter=' + filter;
  triggerDownload(url);
}

function exportCurrentSalesCSV() {
  var salesSearch = document.getElementById('sales-search');
  var q = salesSearch ? salesSearch.value.trim() : '';

  var url = '/api/export/sales?q=' + encodeURIComponent(q);
  triggerDownload(url);
}

function exportCurrentTableCSV() {
  if (!currentSelectedFilePath) {
    alert('Selecciona una tabla .DBF en el explorador primero.');
    return;
  }
  var url = '/api/export/dbf?path=' + encodeURIComponent(currentSelectedFilePath);
  triggerDownload(url);
}

function exportAllToDisk() {
  if (!confirm('¿Deseas generar y guardar todos los archivos CSV (Productos, Clientes y Ventas) directamente en la carpeta del equipo?')) return;

  fetch('/api/export/save-to-disk', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.savedFiles && data.savedFiles.length > 0) {
        alert('✔ Se han guardado ' + data.savedFiles.length + ' archivos CSV en tu equipo:\n\n' + data.savedFiles.join('\n'));
      } else {
        alert('Aviso: No se pudieron generar los archivos CSV en el disco.');
      }
    })
    .catch(function(err) {
      alert('Error guardando archivos CSV: ' + err.message);
    });
}

// ─── CONEXION POR RED Y SERVIDOR (192.168.0.185) ───
function testUncConnection() {
  var uncInput = document.getElementById('unc-path-input');
  var target = uncInput ? uncInput.value.trim() : '\\\\192.168.0.185\\comp01';
  var btn = document.getElementById('btn-test-unc');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Probando...'; }

  fetch('/api/network/test-unc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: target, autoConnect: false })
  })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.accessible) {
        alert('✔ ¡Servidor y ruta accesibles con éxito!\n\nRuta: ' + res.path + '\nArchivos detectados: ' + res.filesCount + '\nTablas DBF: ' + res.dbfCount + '\nInventario: ' + (res.hasProducts ? 'SÍ' : 'NO') + '\nClientes: ' + (res.hasClients ? 'SÍ' : 'NO') + '\nVentas: ' + (res.hasSales ? 'SÍ' : 'NO'));
      } else {
        alert('⚠️ No se pudo acceder a la ruta de red:\n\n' + (res.error || 'Ruta inaccesible') + '\n\nRevisa si tu equipo está en la misma red cableada/WiFi que el servidor 192.168.0.185.');
      }
    })
    .catch(function(err) {
      alert('Error probando conexión: ' + err.message);
    })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.innerText = '🔌 Probar Red (192.168.0.185)'; }
    });
}

function connectUncDirectory() {
  var uncInput = document.getElementById('unc-path-input');
  var target = uncInput ? uncInput.value.trim() : '\\\\192.168.0.185\\comp01';
  var btn = document.getElementById('btn-connect-unc');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Conectando...'; }

  fetch('/api/network/test-unc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: target, autoConnect: true })
  })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.accessible && res.autoConnected) {
        alert('✔ ¡Conexión establecida exitosamente con el servidor ' + target + '!\n\nCatálogo de productos, clientes y facturas cargados en memoria.');
        loadStatusAndData();
        loadProducts();
        loadClients();
        loadSales();
      } else {
        alert('⚠️ No se pudo conectar a ' + target + ':\n' + (res.error || 'Ruta no accesible.'));
      }
    })
    .catch(function(err) {
      alert('Error conectando: ' + err.message);
    })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.innerText = '⚡ Conectar como BD'; }
    });
}

// ─── APRENDIZAJE DE LOGICA MIXNET (.PRG, .INI, RUTAS) ───
function loadLearnedKnowledge() {
  var card = document.getElementById('learned-knowledge-card');
  var body = document.getElementById('learned-knowledge-body');
  if (!card || !body) return;

  card.style.display = 'block';
  body.innerHTML = '<p class="text-muted">⏳ Analizando código fuente FoxPro (.PRG), configuración (.INI) y esquemas de tablas...</p>';

  var pVal = document.getElementById('explorer-path') ? document.getElementById('explorer-path').value.trim() : '';
  var url = '/api/learned-knowledge' + (pVal ? '?path=' + encodeURIComponent(pVal) : '');

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(k) {
      var html = '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">';

      html += '<div class="card" style="padding:12px; background:#1c1d22;">' +
        '<h4 style="margin-top:0; color:#38bdf8;">🖥️ Arquitectura Detectada</h4>' +
        '<ul style="margin:0; padding-left:20px; font-size:13px; line-height:1.6;">' +
          '<li><strong>Motor:</strong> ' + escapeHtml(k.inferredArchitecture.sistema || 'MixNet ERP') + '</li>' +
          '<li><strong>Base de Datos:</strong> ' + escapeHtml(k.inferredArchitecture.motorBaseDatos || 'DBF / CDX') + '</li>' +
          '<li><strong>Servidor de Red:</strong> <code>' + escapeHtml((k.detectedServerIps || []).join(', ') || '192.168.0.185') + '</code></li>' +
          '<li><strong>Ruta Compartida (UNC):</strong> <code>' + escapeHtml((k.networkShares || []).join(', ') || '\\\\192.168.0.185\\comp01') + '</code></li>' +
          '<li><strong>Líneas de Código Analizadas:</strong> ' + k.totalSourceLines + '</li>' +
        '</ul>' +
      '</div>';

      html += '<div class="card" style="padding:12px; background:#1c1d22;">' +
        '<h4 style="margin-top:0; color:#4ade80;">📁 Tablas MixNet Identificadas</h4>' +
        '<div style="max-height:180px; overflow-y:auto; font-size:12px;">';
      var tblKeys = Object.keys(k.tablesReferenced || {});
      if (tblKeys.length === 0) {
        html += '<p class="text-muted">Tablas estándar FoxPro: MXCTAINV, MXCTACLI, MXRENFAC, ALB, MXTRAINV</p>';
      } else {
        html += '<table class="data-table" style="font-size:11px;"><thead><tr><th>Tabla</th><th>Descripción</th><th>Menciones</th></tr></thead><tbody>';
        tblKeys.forEach(function(tk) {
          var t = k.tablesReferenced[tk];
          html += '<tr><td><code>' + escapeHtml(t.nombre) + '</code></td><td>' + escapeHtml(t.descripcion) + '</td><td>' + t.menciones + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div></div>';

      html += '<div class="card" style="padding:12px; background:#1c1d22;">' +
        '<h4 style="margin-top:0; color:#fbbf24;">⚡ Reglas de Negocio en Código</h4>' +
        '<ul style="margin:0; padding-left:20px; font-size:12px; line-height:1.6;">';
      (k.businessRulesInferred || []).forEach(function(br) {
        html += '<li><strong>' + escapeHtml(br.regla) + ':</strong> ' + escapeHtml(br.detalle) + '</li>';
      });
      html += '</ul></div>';

      html += '</div>';
      body.innerHTML = html;
    })
    .catch(function(err) {
      body.innerHTML = '<p class="text-danger">Error aprendiendo lógica: ' + escapeHtml(err.message) + '</p>';
    });
}

// ─── AUDITORIA SIMULTANEA DE LOS 7 AGENTES A LA VEZ ───
function runSimultaneous7Audit() {
  var chatInput = document.getElementById('chat-input');
  var promptVal = (chatInput && chatInput.value.trim())
    ? chatInput.value.trim()
    : 'Realiza una auditoría completa de JJ Paper: precios oficiales cliente (Precio B USD), rotación de mercadería según facturación real, clientes clave y recomendaciones directas.';

  var btn = document.getElementById('btn-audit-simultaneous');
  if (btn) { btn.disabled = true; btn.innerText = '⚡ Ejecutando 7 Agentes a la Vez...'; }

  var container = document.getElementById('simultaneous-audit-container');
  var grid = document.getElementById('simultaneous-cards-grid');
  if (container && grid) {
    container.style.display = 'block';
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:30px;"><div class="agent-thinking">⚡ Consultando en paralelo a los 7 especialistas usando las 7 llaves Gemini...</div></div>';
  }

  fetch('/api/chat/parallel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: promptVal })
  })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.results || res.results.length === 0) {
        if (grid) grid.innerHTML = '<div style="grid-column:1/-1; color:#ef4444; padding:20px;">No se obtuvieron respuestas de los agentes.</div>';
        return;
      }

      var icons = {
        orchestrator: '👑',
        prices: '💰',
        inventory: '📦',
        clients: '👥',
        orders: '📝',
        marketing: '📢',
        code_inspector: '🔍'
      };

      var html = '';
      res.results.forEach(function(ag) {
        var icon = icons[ag.role] || '🤖';
        html += '<div class="card" style="padding:14px; background:#18181b; border:1px solid rgba(255,255,255,0.1); display:flex; flex-direction:column; justify-content:space-between;">' +
          '<div>' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
              '<h4 style="margin:0; font-size:14px; color:#fff;">' + icon + ' ' + escapeHtml(ag.title) + '</h4>' +
              '<span class="badge" style="font-size:10px;">Llave #' + ag.keyUsed + '</span>' +
            '</div>' +
            '<div style="font-size:12px; line-height:1.5; color:#d4d4d8; max-height:260px; overflow-y:auto; padding-right:4px;">' +
              formatMarkdown(ag.reply) +
            '</div>' +
          '</div>' +
          '<div style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); font-size:11px; color:#a1a1aa; display:flex; justify-content:space-between;">' +
            '<span>Modelo: ' + escapeHtml(ag.modelUsed || 'gemini-flash') + '</span>' +
            '<button class="btn-link" style="font-size:11px;" onclick="selectAgent(\'' + ag.role + '\')">Conversar a solas →</button>' +
          '</div>' +
        '</div>';
      });

      if (grid) grid.innerHTML = html;
    })
    .catch(function(err) {
      if (grid) grid.innerHTML = '<div style="grid-column:1/-1; color:#ef4444; padding:20px;">Error ejecutando auditoría simultánea: ' + escapeHtml(err.message) + '</div>';
    })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.innerText = '⚡ Auditoría Simultánea (7 a la Vez)'; }
    });
}

