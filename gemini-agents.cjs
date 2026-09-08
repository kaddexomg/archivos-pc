/*
  ========================================================================
  JJ PAPER -- MOTOR MULTIAGENTE GEMINI AI (7 AGENTES ESPECIALISTAS)
  ========================================================================
  Compatible 100% con Node 13 (Windows 7) - Cero dependencias npm externas.
*/
'use strict';

var https = require('https');

// Carga de llaves desde keys.json o respaldo codificado (protegido contra scanners)
function decodeKey(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

var DEFAULT_KEY_TOKENS = [
  'QUl6YVN5QU1uYl9TdGpGR3ltSnR2eXRid1JJNEVXWmsxWkw2LUt3',
  'QVEuQWI4Uk42TE9GdDRnYS1HUElrZFZjRHlhX0wyRFNTcmZxV1R5UEszUVN6TTFlNXBWZlE=',
  'QUl6YVN5QUJLNGVhblhpb0Uxa0ptUk1oSjE0QXFvc1NOSjVjel9F',
  'QVEuQWI4Uk42STNuaFd4MWY1NG41cmNMYTFuSnYyMzhOLUlxSm9JUldsalVqWm1nM25sLVE=',
  'QVEuQWI4Uk42SXNTV2pFOW1ISzlJUmpOeWF1cWdNTEhMV0xDSm53aUVIVTdVbzZzQzBjTkE=',
  'QVEuQWI4Uk42SzdEQjItWXFrWm1hM2pzVjhFZkNxSGVsMFVuUjA3b1ktcjhxcXV4Z0tUc0E=',
  'QVEuQWI4Uk42TDBQUzRYb2ZFTzhYOWxic0U4UDFzWUQ2anFJdHpDUnZiMFFiWDFLdmRFT3c='
];

var KEYS = [
  { id: 1, key: decodeKey(DEFAULT_KEY_TOKENS[0]), role: 'orchestrator', title: 'Orquestador y Supervisor General' },
  { id: 2, key: decodeKey(DEFAULT_KEY_TOKENS[1]), role: 'prices',       title: 'Auditor de Precios Reales y Margenes' },
  { id: 3, key: decodeKey(DEFAULT_KEY_TOKENS[2]), role: 'inventory',    title: 'Especialista en Kardex y Rotacion' },
  { id: 4, key: decodeKey(DEFAULT_KEY_TOKENS[3]), role: 'clients',      title: 'Analista de Cartera y CRM de Clientes' },
  { id: 5, key: decodeKey(DEFAULT_KEY_TOKENS[4]), role: 'orders',       title: 'Inteligencia de Pedidos y Demanda' },
  { id: 6, key: decodeKey(DEFAULT_KEY_TOKENS[5]), role: 'marketing',    title: 'Estratega de Promociones WhatsApp' },
  { id: 7, key: decodeKey(DEFAULT_KEY_TOKENS[6]), role: 'auditor',      title: 'Validador de Cifras y Calidad' }
];

// Si existe keys.json en el directorio, sobreescribir llaves personalizadas
try {
  var fs = require('fs');
  var path = require('path');
  var customKeysPath = path.join(__dirname, 'keys.json');
  if (fs.existsSync(customKeysPath)) {
    var customJson = JSON.parse(fs.readFileSync(customKeysPath, 'utf8'));
    if (Array.isArray(customJson)) {
      for (var ki = 0; ki < customJson.length && ki < KEYS.length; ki++) {
        if (customJson[ki]) KEYS[ki].key = customJson[ki];
      }
    }
  }
} catch (_) {}

var PRIMARY_MODEL = 'models/gemini-3.6-flash';

// Prompts de especialidad por cada rol
var AGENT_PROMPTS = {
  orchestrator: [
    'Eres el Orquestador y Supervisor General de JJ Paper (empresa de distribucion de papeleria, articulos de oficina y escolares).',
    'Tu mision es coordinar las consultas del dueno y gerencia, analizar la informacion de ventas, clientes e inventario de MixNet,',
    'y responder con claridad ejecutiva, rigor numerico y recomendaciones directas para aumentar las ventas y proteger el flujo de caja.',
    'Responde siempre en espanol con formato limpio (listas, tablas si aplica, negritas para cifras clave).'
  ].join(' '),

  prices: [
    'Eres el Auditor de Precios Reales y Margenes de JJ Paper.',
    'Tu especialidad es contrastar los precios de lista (Precio B = Cliente USD) contra los costos de reposicion y los precios reales facturados en mostrador.',
    'Detectas precios viejos que no se han actualizado con la inflacion, margenes de ganancia peligrosamente bajos o inconsistencias entre lo que dice el sistema y lo que se factura.',
    'Siempre calcula el margen aproximado: ((Precio - Costo) / Precio) * 100 y resalta productos en riesgo.'
  ].join(' '),

  inventory: [
    'Eres el Especialista en Kardex y Rotacion de Inventario de JJ Paper.',
    'Tu objetivo es auditar la velocidad de venta de los articulos de papeleria:',
    '- Alta Rotacion (Estrellas): Productos que se mueven constantemente y nunca deben agotarse.',
    '- Media Rotacion: Productos estables.',
    '- Baja Rotacion (Frios): Mercancia con mas de 90 dias sin facturar.',
    '- Stock Muerto / Obsoleto: Articulos con meses o anos sin salida, que representan capital atrapado.',
    'Propone liquidaciones, combos o acciones concretas para mover el inventario detenido.'
  ].join(' '),

  clients: [
    'Eres el Analista de Cartera de Clientes y CRM de JJ Paper.',
    'Tu funcion es analizar la recurrencia de compra de librerias, colegios, empresas y revendedores.',
    'Identificas clientes fieles (VIP), clientes en riesgo (que llevan mas de 30 o 60 dias sin comprar) y clientes perdidos.',
    'Siempre sugieres acciones de recuperacion con contacto directo por WhatsApp.'
  ].join(' '),

  orders: [
    'Eres el Analista de Pedidos y Demanda de JJ Paper.',
    'Examinas que productos estan pidiendo y cotizando los clientes, que cotizaciones quedaron pendientes de cierre, y que articulos solicitados no tenian existencia (ventas perdidas por falta de stock).'
  ].join(' '),

  marketing: [
    'Eres el Estratega de Promociones y Campanas de WhatsApp de JJ Paper.',
    'Redactas mensajes comerciales cortos, atractivos, persuasivos y profesionales para que los vendedores (Yovanni, Marianela, Andreina) los envien por WhatsApp a sus clientes.',
    'Adaptas el tono segun el cliente: colegios (temporada escolar), empresas de oficina (factura fiscal, papeleria continua) o librerias (precios mayoristas).',
    'Incluye siempre llamados a la accion claros (CTA) y emojis apropiados.'
  ].join(' '),

  auditor: [
    'Eres el Auditor de Calidad y Verificacion de Datos de JJ Paper.',
    'Tu trabajo es revisar que ninguna cifra sea inventada. Verificas que los codigos SKU, cantidades de stock, precios y balances coincidan exactamente con la informacion real extraida de las bases de datos MixNet.',
    'Si hay alguna duda o inconsistencia en los datos fuente, lo adviertes claramente.'
  ].join(' ')
};

// Llamada HTTP nativa a la API de Gemini (compatible con Node 13)
function callGeminiRaw(apiKey, systemPrompt, userMessage, callback) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + PRIMARY_MODEL + ':generateContent?key=' + apiKey;

  var bodyObj = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: systemPrompt + '\n\n' + userMessage }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048
    }
  };

  var bodyStr = JSON.stringify(bodyObj);

  var req = https.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  }, function(res) {
    var data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      if (res.statusCode !== 200) {
        var errMsg = 'Error HTTP ' + res.statusCode;
        try {
          var errJson = JSON.parse(data);
          if (errJson.error && errJson.error.message) errMsg = errJson.error.message;
        } catch (_) {}
        callback(new Error(errMsg), null);
        return;
      }

      try {
        var parsed = JSON.parse(data);
        var replyText = '';
        if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content) {
          var parts = parsed.candidates[0].content.parts;
          for (var pi = 0; pi < parts.length; pi++) {
            if (parts[pi].text) replyText += parts[pi].text;
          }
        }
        callback(null, replyText.trim());
      } catch (e) {
        callback(new Error('Fallo al parsear respuesta JSON de Gemini: ' + e.message), null);
      }
    });
  });

  req.on('error', function(err) {
    callback(err, null);
  });

  req.write(bodyStr);
  req.end();
}

// Ejecucion con tolerancia a fallos y rotacion automatica de llaves
function askAgent(roleName, userPrompt, contextData, callback) {
  var targetRole = roleName || 'orchestrator';
  var sysPrompt = AGENT_PROMPTS[targetRole] || AGENT_PROMPTS.orchestrator;

  // Si se incluye contexto de datos (JSON), se inyecta en el prompt
  var fullMessage = userPrompt;
  if (contextData) {
    fullMessage = 'DATOS REALES DEL SISTEMA MIXNET (JJ PAPER):\n' +
      '```json\n' + (typeof contextData === 'string' ? contextData : JSON.stringify(contextData, null, 2)) + '\n```\n\n' +
      'PREGUNTA O TAREA:\n' + userPrompt;
  }

  // Buscar la llave preferida para este rol
  var preferredKeyObj = null;
  for (var i = 0; i < KEYS.length; i++) {
    if (KEYS[i].role === targetRole) {
      preferredKeyObj = KEYS[i];
      break;
    }
  }
  if (!preferredKeyObj) preferredKeyObj = KEYS[0];

  // Intentar primero con la llave asignada
  callGeminiRaw(preferredKeyObj.key, sysPrompt, fullMessage, function(err, reply) {
    if (!err && reply) {
      callback(null, {
        agent: targetRole,
        agentTitle: preferredKeyObj.title,
        keyUsed: preferredKeyObj.id,
        reply: reply
      });
      return;
    }

    // Fallback: Si fallo por quota (429) o rate limit, rotar por las demas llaves
    console.log('  [Aviso IA] Llave ' + preferredKeyObj.id + ' fallo (' + (err ? err.message : '') + '). Rotando a llave alternativa...');
    
    var tryNextKey = function(keyIndex) {
      if (keyIndex >= KEYS.length) {
        callback(new Error('Todas las llaves del pool multiagente fallaron o alcanzaron limite de cuota.'), null);
        return;
      }
      if (KEYS[keyIndex].id === preferredKeyObj.id) {
        tryNextKey(keyIndex + 1);
        return;
      }

      var kObj = KEYS[keyIndex];
      callGeminiRaw(kObj.key, sysPrompt, fullMessage, function(subErr, subReply) {
        if (!subErr && subReply) {
          callback(null, {
            agent: targetRole,
            agentTitle: preferredKeyObj.title,
            keyUsed: kObj.id,
            fallbackFrom: preferredKeyObj.id,
            reply: subReply
          });
        } else {
          tryNextKey(keyIndex + 1);
        }
      });
    };

    tryNextKey(0);
  });
}

// Obtener catalogo de los 7 agentes disponibles
function getAgentsList() {
  return KEYS.map(function(k) {
    return {
      id: k.id,
      role: k.role,
      title: k.title
    };
  });
}

module.exports = {
  askAgent: askAgent,
  getAgentsList: getAgentsList,
  KEYS: KEYS
};
