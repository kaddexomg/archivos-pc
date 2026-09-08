/*
  ========================================================================
  JJ PAPER -- SERVIDOR WEB LOCAL & API MULTIAGENTE IA (NODE 13 COMPATIBLE)
  ========================================================================
  Servidor nativo HTTP, cero dependencias npm.
  Expone API REST para el Dashboard y coordina los 7 Agentes Gemini.
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

  // 1. Estado y Resumen
  if (pathname === '/api/status') {
    var state = engine.getState();
    sendJSON(res, 200, {
      online: true,
      initialized: state.initialized,
      liveDir: state.liveDir,
      lastScan: state.lastScan,
      summary: state.summary,
      agents: agents.getAgentsList()
    });
    return;
  }

  // 2. Refrescar escaneo de MixNet
  if (pathname === '/api/refresh') {
    var initResult = engine.initializeDatabase();
    sendJSON(res, 200, initResult);
    return;
  }

  // 3. Consulta de Productos
  if (pathname === '/api/products') {
    var pList = engine.getState().products || [];
    var q = (query.q || '').trim().toLowerCase();
    var filter = query.filter || 'all';

    if (filter === 'stock') {
      pList = pList.filter(function(p) { return p.stock_actual > 0; });
    } else if (filter === 'agotado') {
      pList = pList.filter(function(p) { return p.stock_actual <= 0; });
    }

    if (q) {
      pList = pList.filter(function(p) {
        return p.codigo.toLowerCase().indexOf(q) !== -1 ||
               p.descripcion.toLowerCase().indexOf(q) !== -1 ||
               p.categoria.toLowerCase().indexOf(q) !== -1 ||
               p.marca.toLowerCase().indexOf(q) !== -1;
      });
    }

    var limit = parseInt(query.limit, 10) || 100;
    sendJSON(res, 200, {
      total: pList.length,
      products: pList.slice(0, limit)
    });
    return;
  }

  // 4. Consulta de Clientes
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

    var climit = parseInt(query.limit, 10) || 100;
    sendJSON(res, 200, {
      total: cList.length,
      clients: cList.slice(0, climit)
    });
    return;
  }

  // 5. Consulta de Ventas / Facturacion reciente
  if (pathname === '/api/sales') {
    var sList = engine.getState().recentSales || [];
    sendJSON(res, 200, {
      total: sList.length,
      sales: sList.slice(0, 100)
    });
    return;
  }

  // 6. Consulta a los 7 Agentes Gemini AI
  if (pathname === '/api/chat' && req.method === 'POST') {
    parseBody(req, function(err, payload) {
      if (err || !payload.prompt) {
        sendJSON(res, 400, { error: 'Falta el prompt de la consulta' });
        return;
      }

      var role = payload.role || 'orchestrator';
      var userPrompt = payload.prompt;

      // Inyectar contexto enriquecido segun el rol del agente
      var state = engine.getState();
      var context = {
        resumen_tienda: state.summary,
        muestra_productos_destacados: state.products.slice(0, 25).map(function(p) {
          return {
            sku: p.codigo,
            nombre: p.descripcion,
            precio_cliente_usd: p.precio_cliente_usd,
            stock: p.stock_actual,
            estado: p.estado_stock,
            costo_usd: p.costo_usd,
            margen: p.margen_porcentaje + '%',
            ultimo_movimiento: p.ultimo_movimiento_fmt
          };
        }),
        muestra_clientes_recientes: state.clients.slice(0, 15).map(function(c) {
          return {
            codigo: c.codigo,
            cliente: c.razon_social,
            rif: c.rif,
            whatsapp: c.telefono_movil_whatsapp,
            saldo: c.saldo,
            ultimo_pago: c.ultimo_pago_fmt
          };
        }),
        muestra_ventas_recientes: state.recentSales.slice(0, 15)
      };

      agents.askAgent(role, userPrompt, context, function(agentErr, agentResult) {
        if (agentErr) {
          sendJSON(res, 500, { error: agentErr.message });
        } else {
          sendJSON(res, 200, {
            success: true,
            reply: agentResult.reply,
            agent: agentResult.agent,
            agentTitle: agentResult.agentTitle,
            keyUsed: agentResult.keyUsed,
            fallbackFrom: agentResult.fallbackFrom || null
          });
        }
      });
    });
    return;
  }

  // ─── SERVICIO DE ARCHIVOS ESTÁTICOS (PUBLIC DIR) ───
  var safePath = pathname === '/' ? '/index.html' : pathname;
  var filePath = path.join(PUBLIC_DIR, safePath);

  // Seguridad: evitar path traversal
  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.stat(filePath, function(statErr, stats) {
    if (statErr || !stats.isFile()) {
      // Fallback a index.html
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
console.log('   JJ PAPER -- SUITE DE INTELIGENCIA COMERCIAL & MULTIAGENTE IA');
console.log('========================================================================');
console.log('  Iniciando motor de datos MixNet...');

var dbInit = engine.initializeDatabase();
if (dbInit.success) {
  console.log('  ✔ Base de datos MixNet cargada en memoria:');
  console.log('    - Productos activos: ' + dbInit.summary.total_productos + ' (' + dbInit.summary.productos_en_stock + ' con stock)');
  console.log('    - Clientes cargados: ' + dbInit.summary.total_clientes + ' (' + dbInit.summary.clientes_con_whatsapp + ' con WhatsApp)');
  console.log('    - Ventas recientes:  ' + dbInit.summary.ventas_recientes_registradas);
} else {
  console.log('  ⚠ Aviso: ' + dbInit.error + '. El servidor arrancara en modo espera.');
}

server.listen(PORT, '0.0.0.0', function() {
  console.log('========================================================================');
  console.log('  ✔ Servidor Web Local ACTIVO y escuchando en el puerto ' + PORT);
  console.log('  Acceso local:     http://localhost:' + PORT);
  console.log('  Acceso en red:    http://0.0.0.0:' + PORT);
  console.log('  7 Agentes Gemini: 100% LISTOS con rotacion automatica de cuota');
  console.log('========================================================================');
  console.log('');
});
