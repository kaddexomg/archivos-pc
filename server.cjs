/*
  ========================================================================
  JJ PAPER -- SERVIDOR WEB LOCAL & API MULTIAGENTE IA v6.2
  ========================================================================
  Servidor nativo HTTP, cero dependencias npm.
  Expone API REST para el Dashboard, Explorador de Archivos, Buscador y los 7 Agentes Gemini.
  100% compatible con Node 13 y Windows 7.
*/
'use strict';

var http = require('http');
var fs   = require('fs');
var path = require('path');
var url  = require('url');

var engine = require('./mixnet-engine.cjs');
var agents = require('./gemini-agents.cjs');

var PORT = process.env.PORT || 3000;
var PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types para el servidor estático
var MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png'
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendCSV(res, filename, csvContent) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(csvContent);
}

function getDateStamp() {
  var d = new Date();
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
}

function parseBody(req, callback) {
  var body = '';
  req.on('data', function(chunk) { body += chunk; });
  req.on('end', function() {
    try {
      var json = body ? JSON.parse(body) : {};
      callback(null, json);
    } catch (e) {
      callback(e, null);
    }
  });
}

// Servidor HTTP principal
var server = http.createServer(function(req, res) {
  // Manejo de CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  var parsedUrl = url.parse(req.url, true);
  var pathname = parsedUrl.pathname;
  var query = parsedUrl.query;

  // ─── API ENDPOINTS ───

  // 1. Estado y Resumen General
  if (pathname === '/api/status') {
    var state = engine.getState();
    sendJSON(res, 200, {
      online: true,
      initialized: state.initialized,
      liveDir: state.liveDir,
      availableDrives: engine.getAvailableDrives(),
      detectedLocations: state.detectedLocations || [],
      maxSystemDate: state.maxSystemDate,
      maxSystemDateFmt: state.maxSystemDateFmt,
      lastScan: state.lastScan,
      summary: state.summary,
      agents: agents.getAgentsList()
    });
    return;
  }

  // 2. Unidades de disco detectadas en Windows
  if (pathname === '/api/drives') {
    sendJSON(res, 200, {
      drives: engine.getAvailableDrives()
    });
    return;
  }

  // 3. Localizador profundo de instalaciones MixNet y codigo fuente
  if (pathname === '/api/discover') {
    var locs = engine.findMixnetLocations();
    sendJSON(res, 200, {
      total: locs.length,
      locations: locs
    });
    return;
  }

  // 4. Establecer carpeta activa de base de datos en caliente
  if (pathname === '/api/set-directory' && req.method === 'POST') {
    parseBody(req, function(err, payload) {
      if (err || !payload.path) {
        sendJSON(res, 400, { error: 'Falta parametro path con la ruta del directorio' });
        return;
      }
      var switchRes = engine.switchDatabaseDirectory(payload.path);
      sendJSON(res, switchRes.success ? 200 : 400, switchRes);
    });
    return;
  }

  // 5. Refrescar escaneo de MixNet
  if (pathname === '/api/refresh') {
    var initResult = engine.initializeDatabase();
    sendJSON(res, 200, initResult);
    return;
  }

  // 6. Consulta Inteligente de Productos (Filtros dinámicos y rotación)
  if (pathname === '/api/products') {
    var pList = engine.getState().products || [];
    var q = (query.q || '').trim().toLowerCase();
    var filter = query.filter || 'all';
    var rotacion = query.rotacion || '';

    if (filter === 'stock') {
      pList = pList.filter(function(p) { return p.stock_actual > 0; });
    } else if (filter === 'agotado') {
      pList = pList.filter(function(p) { return p.stock_actual <= 0; });
    } else if (filter === 'recientes') {
      pList = pList.filter(function(p) { return p.es_reciente_o_modificado; });
    }

    if (rotacion) {
      pList = pList.filter(function(p) { return p.estado_rotacion === rotacion; });
    }

    if (q) {
      pList = pList.filter(function(p) {
        return p.codigo.toLowerCase().indexOf(q) !== -1 ||
               p.descripcion.toLowerCase().indexOf(q) !== -1 ||
               p.categoria.toLowerCase().indexOf(q) !== -1 ||
               p.marca.toLowerCase().indexOf(q) !== -1;
      });
    }

    var limit = parseInt(query.limit, 10) || 150;
    sendJSON(res, 200, {
      total: pList.length,
      maxSystemDate: engine.getState().maxSystemDateFmt,
      products: pList.slice(0, limit)
    });
    return;
  }

  // 7. Consulta de Clientes
  if (pathname === '/api/clients') {
    var cList = engine.getState().clients || [];
    var cq = (query.q || '').trim().toLowerCase();
    var cFilter = query.filter || 'all';

    if (cFilter === 'whatsapp') {
      cList = cList.filter(function(c) { return c.telefono_movil_whatsapp; });
    } else if (cFilter === 'email') {
      cList = cList.filter(function(c) { return c.email; });
    }

    if (cq) {
      cList = cList.filter(function(c) {
        return c.codigo.toLowerCase().indexOf(cq) !== -1 ||
               c.razon_social.toLowerCase().indexOf(cq) !== -1 ||
               c.rif.toLowerCase().indexOf(cq) !== -1 ||
               c.telefono_movil_whatsapp.indexOf(cq) !== -1;
      });
    }

    var climit = parseInt(query.limit, 10) || 150;
    sendJSON(res, 200, {
      total: cList.length,
      clients: cList.slice(0, climit)
    });
    return;
  }

  // 8. Consulta de Ventas / Facturacion reciente
  if (pathname === '/api/sales') {
    var sList = engine.getState().recentSales || [];
    var sq = (query.q || '').trim().toLowerCase();

    if (sq) {
      sList = sList.filter(function(s) {
        return s.documento.toLowerCase().indexOf(sq) !== -1 ||
               s.cliente.toLowerCase().indexOf(sq) !== -1 ||
               s.rif.toLowerCase().indexOf(sq) !== -1 ||
               s.codigo_cliente.toLowerCase().indexOf(sq) !== -1;
      });
    }

    var slimit = parseInt(query.limit, 10) || 150;
    sendJSON(res, 200, {
      total: sList.length,
      sales: sList.slice(0, slimit)
    });
    return;
  }

  // ─── EXPORTACION DE ARCHIVOS A CSV ───

  // 8.1 Exportar Productos a CSV
  if (pathname === '/api/export/products') {
    var prodCsv = engine.exportProductsToCSV(query.filter, query.rotacion, query.q);
    sendCSV(res, 'productos_mixnet_' + getDateStamp() + '.csv', prodCsv);
    return;
  }

  // 8.2 Exportar Clientes a CSV
  if (pathname === '/api/export/clients') {
    var cliCsv = engine.exportClientsToCSV(query.filter, query.q);
    sendCSV(res, 'clientes_mixnet_' + getDateStamp() + '.csv', cliCsv);
    return;
  }

  // 8.3 Exportar Ventas a CSV
  if (pathname === '/api/export/sales') {
    var salesCsv = engine.exportSalesToCSV(query.q);
    sendCSV(res, 'ventas_mixnet_' + getDateStamp() + '.csv', salesCsv);
    return;
  }

  // 8.4 Exportar cualquier tabla DBF completa a CSV
  if (pathname === '/api/export/dbf') {
    var targetDbf = query.path;
    if (!targetDbf) {
      sendJSON(res, 400, { error: 'Falta parametro path de la tabla DBF' });
      return;
    }
    var dbfCsv = engine.exportDbfToCSV(targetDbf, parseInt(query.limit, 10) || 100000);
    if (!dbfCsv) {
      sendJSON(res, 404, { error: 'No se pudo exportar la tabla DBF especificada' });
      return;
    }
    var baseName = path.basename(targetDbf).replace(/\.[^.]+$/, '');
    sendCSV(res, baseName + '_' + getDateStamp() + '.csv', dbfCsv);
    return;
  }

  // 8.5 Guardar todos los CSVs directamente en el disco del equipo
  if (pathname === '/api/export/save-to-disk' && req.method === 'POST') {
    var savedPaths = engine.saveAllExportsToDisk();
    sendJSON(res, 200, {
      success: true,
      totalSaved: savedPaths.length,
      savedFiles: savedPaths
    });
    return;
  }

  // 9. Explorador de Carpetas y Archivos (Navegacion interactiva)
  if (pathname === '/api/explorer/scan') {
    var stateLive = engine.getState().liveDir;
    var targetScanDir = query.path || stateLive || 'C:\\';
    var exts = query.exts ? query.exts.split(',') : null;
    var depth = parseInt(query.depth, 10) || 1;

    var tree = engine.scanDirectory(targetScanDir, exts, depth);
    sendJSON(res, 200, tree);
    return;
  }

  // 10. Buscador Recursivo de Archivos (Persuadir y Conseguir)
  if (pathname === '/api/explorer/search') {
    var searchQuery = query.q || '';
    var searchPath = query.path || engine.getState().liveDir || 'C:\\';
    var searchDepth = parseInt(query.depth, 10) || 4;
    var searchLimit = parseInt(query.limit, 10) || 200;

    var sResults = engine.searchFiles(searchPath, searchQuery, searchDepth, searchLimit);
    sendJSON(res, 200, sResults);
    return;
  }

  // 11. Lector de Contenido de Archivo (.PRG, .INI, .TXT, .BAT, .DBF)
  if (pathname === '/api/explorer/read') {
    var targetFile = query.path;
    if (!targetFile) {
      sendJSON(res, 400, { error: 'Falta parametro path' });
      return;
    }
    var limitLines = parseInt(query.limit, 10) || 300;
    var fileData = engine.readFileContent(targetFile, limitLines);
    sendJSON(res, 200, fileData);
    return;
  }

  // 12. Analisis de Codigo Fuente MixNet con IA (Ingenieria Inversa)
  if (pathname === '/api/explorer/analyze' && req.method === 'POST') {
    parseBody(req, function(err, payload) {
      if (err || !payload.path) {
        sendJSON(res, 400, { error: 'Falta la ruta del archivo a analizar' });
        return;
      }

      var fileRead = engine.readFileContent(payload.path, 400);
      if (!fileRead.success) {
        sendJSON(res, 400, { error: fileRead.error });
        return;
      }

      var userPrompt = payload.prompt || 'Explica que hace este codigo/archivo de MixNet, que tablas abre, que campos consulta y como influye en la logica de precios o inventario.';

      var codeContext = {
        archivo: payload.path,
        tipo: fileRead.type,
        contenido: fileRead.type === 'text' ? fileRead.lines.join('\n') : fileRead
      };

      agents.askAgent('code_inspector', userPrompt, codeContext, function(agErr, agResult) {
        if (agErr) {
          sendJSON(res, 500, { error: agErr.message });
        } else {
          sendJSON(res, 200, {
            success: true,
            archivo: payload.path,
            analisis: agResult.reply,
            agente: agResult.agentTitle,
            llave: agResult.keyUsed,
            modelo: agResult.modelUsed
          });
        }
      });
    });
    return;
  }

  // 13. Consulta a los 7 Agentes Gemini AI
  if (pathname === '/api/chat' && req.method === 'POST') {
    parseBody(req, function(err, payload) {
      if (err || !payload.prompt) {
        sendJSON(res, 400, { error: 'Se requiere un prompt de consulta.' });
        return;
      }

      var role = payload.role || 'orchestrator';
      var prompt = payload.prompt;

      var dbState = engine.getState();
      var enrichedContext = {
        empresa_directorio: dbState.liveDir || 'No conectado',
        fecha_maxima_sistema: dbState.maxSystemDateFmt || 'No detectada',
        total_productos_en_catalogo: dbState.products.length,
        productos_con_stock_fisico: dbState.summary.productos_en_stock || 0,
        total_clientes_cartera: dbState.clients.length,
        clientes_con_whatsapp: dbState.summary.clientes_con_whatsapp || 0,
        ventas_recientes_en_memoria: dbState.recentSales.length,
        top_productos_alta_rotacion: dbState.products.filter(function(p) { return p.estado_rotacion === 'ALTA_ROTACION'; }).slice(0, 10).map(function(p) {
          return p.codigo + ' - ' + p.descripcion + ' ($' + p.precio_cliente_usd + ', Stock: ' + p.stock_actual + ')';
        }),
        ultimas_ventas_muestras: dbState.recentSales.slice(0, 5)
      };

      agents.askAgent(role, prompt, enrichedContext, function(agentErr, agentResult) {
        if (agentErr) {
          sendJSON(res, 500, {
            error: agentErr.message,
            status: agentErr.status,
            allModelsFailed: true
          });
        } else {
          sendJSON(res, 200, agentResult);
        }
      });
    });
    return;
  }

  // ─── SERVIDOR DE ARCHIVOS ESTATICOS (SPA) ───
  var safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  var filePath = path.join(PUBLIC_DIR, safePath);

  if (pathname === '/' || pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  fs.stat(filePath, function(statErr, stats) {
    if (statErr || !stats.isFile()) {
      var indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, function(idxErr, idxData) {
        if (idxErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Archivo no encontrado');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(idxData);
        }
      });
      return;
    }

    var ext = path.extname(filePath).toLowerCase();
    var contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, function(readErr, data) {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error leyendo archivo');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
  });
});

// Inicializar base de datos y arrancar servidor
console.log('');
console.log('========================================================================');
console.log('   JJ PAPER -- SUITE DE INTELIGENCIA COMERCIAL & MULTIAGENTE IA v6.2');
console.log('========================================================================');
console.log('  Detectando unidades y carpetas MixNet en el equipo...');

var dbInit = engine.initializeDatabase();
if (dbInit.success && dbInit.initialized) {
  console.log('  ✔ Base de datos MixNet conectada: ' + dbInit.summary.servidor_fuente);
  console.log('    - Fecha maxima registrada en tienda: ' + (dbInit.summary.fecha_maxima_sistema || 'Detectada'));
  console.log('    - Productos activos evaluados:       ' + dbInit.summary.total_productos + ' (' + dbInit.summary.productos_en_stock + ' con stock)');
  console.log('    - Clientes cargados:                 ' + dbInit.summary.total_clientes + ' (' + dbInit.summary.clientes_con_whatsapp + ' con WhatsApp)');
  console.log('    - Ventas recientes:                  ' + dbInit.summary.ventas_recientes_registradas);
} else {
  console.log('  ⚠ Aviso: ' + (dbInit.error || 'Esperando conexion'));
  console.log('    El servidor web arrancara de inmediato para permitirte escanear');
  console.log('    o conectar cualquier carpeta de MixNet desde el panel web.');
}

server.listen(PORT, '0.0.0.0', function() {
  console.log('========================================================================');
  console.log('  ✔ Servidor Web Local ACTIVO en puerto ' + PORT);
  console.log('  Acceso local:     http://localhost:' + PORT);
  console.log('  Acceso en red:    http://0.0.0.0:' + PORT);
  console.log('  7 Agentes Gemini: 100% LISTOS con cascada multi-modelo y multi-llave');
  console.log('  Explorador Codigo: Activo para navegar discos y analizar .PRG / .INI');
  console.log('========================================================================');
  console.log('');
});
