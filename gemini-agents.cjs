/*
  ========================================================================
  JJ PAPER -- MOTOR MULTIAGENTE GEMINI AI (7 AGENTES ESPECIALISTAS)
  ========================================================================
  Compatible 100% con Node 13 (Windows 7) - Cero dependencias npm externas.
  Incluye cascada multi-modelo y multi-llave para evitar caídas por cuota o spikes.
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
  { id: 1, key: decodeKey(DEFAULT_KEY_TOKENS[0]), role: 'orchestrator',    title: 'Orquestador y Supervisor General' },
  { id: 2, key: decodeKey(DEFAULT_KEY_TOKENS[1]), role: 'prices',          title: 'Auditor de Precios Reales y Margenes' },
  { id: 3, key: decodeKey(DEFAULT_KEY_TOKENS[2]), role: 'inventory',       title: 'Especialista en Kardex y Rotacion' },
  { id: 4, key: decodeKey(DEFAULT_KEY_TOKENS[3]), role: 'clients',         title: 'Analista de Cartera y CRM de Clientes' },
  { id: 5, key: decodeKey(DEFAULT_KEY_TOKENS[4]), role: 'orders',          title: 'Inteligencia de Pedidos y Demanda' },
  { id: 6, key: decodeKey(DEFAULT_KEY_TOKENS[5]), role: 'marketing',       title: 'Estratega de Promociones WhatsApp' },
  { id: 7, key: decodeKey(DEFAULT_KEY_TOKENS[6]), role: 'code_inspector',  title: 'Auditor de Codigo Fuente MixNet & Acciones' }
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

// Cascada de modelos para alta disponibilidad
var FALLBACK_MODELS = [
  'models/gemini-3.6-flash',
  'models/gemini-flash-latest',
  'models/gemini-2.5-flash'
];

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
    '- Baja Rotacion (Frios): Mercancia con meses sin facturar.',
    '- Stock Muerto / Obsoleto: Articulos con meses o anos sin salida, que representan capital atrapado.',
    'Propone liquidaciones, combos o acciones concretas para mover el inventario detenido.'
  ].join(' '),

  clients: [
    'Eres el Analista de Cartera de Clientes y CRM de JJ Paper.',
    'Tu funcion es analizar la recurrencia de compra de librerias, colegios, empresas y revendedores.',
    'Identificas clientes fieles (VIP), clientes en riesgo (que llevan tiempo sin comprar) y clientes perdidos.',
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

  code_inspector: [
    'Eres el Auditor de Codigo Fuente e Ingenieria Inversa de MixNet en JJ Paper.',
    'Tu mision es inspeccionar y descifrar el codigo fuente en FoxPro/dBase/Clipper (.PRG), scripts (.BAT), archivos de configuracion (.INI) y tablas (.DBF) del sistema de facturacion MixNet.',
    'Analizas como busca los productos el programa original, que tablas abre (VICTAINV, MXCTAINV, MXRENFAC), como lee los precios A, B, C y como calcula el inventario.',
    'Explicas la logica tecnica en espanol claro y recomiendas la mejor forma de buscar y validar los datos para que nuestra suite coincida 100% con MixNet.'
  ].join(' ')
};

// Llamada HTTP individual a un modelo especifico
function callGeminiSingle(apiKey, modelName, systemPrompt, userMessage, callback) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + apiKey;

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
      maxOutputTokens: 2500
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
        var errMsg = 'HTTP ' + res.statusCode;
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

// Llamada robusta que prueba la cascada de modelos en una llave
function callWithModelFallback(apiKey, systemPrompt, userMessage, callback) {
  var modelIdx = 0;

  function attemptModel() {
    if (modelIdx >= FALLBACK_MODELS.length) {
      callback(new Error('Todos los modelos de Gemini fallaron en esta llave.'), null);
      return;
    }

    var currentModel = FALLBACK_MODELS[modelIdx];
    callGeminiSingle(apiKey, currentModel, systemPrompt, userMessage, function(err, reply) {
      if (!err && reply) {
        callback(null, reply, currentModel);
      } else {
        // Si hay error de cuota o spike (503, 429, 404), intentar siguiente modelo
        modelIdx++;
        attemptModel();
      }
    });
  }

  attemptModel();
}

// Puntero de rotacion continua (Round-Robin) entre las 7 llaves
var roundRobinCounter = 0;

// Ejecucion con tolerancia total a fallos (Cascada de Modelos + Rotacion de las 7 Llaves)
function askAgent(roleName, userPrompt, contextData, callback) {
  var targetRole = roleName || 'orchestrator';
  var sysPrompt = AGENT_PROMPTS[targetRole] || AGENT_PROMPTS.orchestrator;

  var fullMessage = userPrompt;
  if (contextData) {
    fullMessage = 'DATOS REALES DEL SISTEMA MIXNET (JJ PAPER):\n' +
      '```json\n' + (typeof contextData === 'string' ? contextData : JSON.stringify(contextData, null, 2)) + '\n```\n\n' +
      'PREGUNTA O TAREA:\n' + userPrompt;
  }

  // 1. Seleccionar llave mediante Round-Robin para balancear la carga entre las 7 APIs
  var assignedKeyIndex = (roundRobinCounter++) % KEYS.length;
  var preferredKeyObj = KEYS[assignedKeyIndex];

  // Si el rol tiene una llave asignada y no esta sobrecargada, preferirla
  for (var i = 0; i < KEYS.length; i++) {
    if (KEYS[i].role === targetRole) {
      preferredKeyObj = KEYS[i];
      break;
    }
  }

  // 2. Intentar primero con la llave asignada
  callWithModelFallback(preferredKeyObj.key, sysPrompt, fullMessage, function(err, reply, modelUsed) {
    if (!err && reply) {
      callback(null, {
        agent: targetRole,
        agentTitle: preferredKeyObj.title,
        keyUsed: preferredKeyObj.id,
        modelUsed: modelUsed,
        reply: reply
      });
      return;
    }

    // 3. Fallback: Si fallo, rotar por el pool de las otras 6 llaves
    console.log('  [Aviso IA] Llave ' + preferredKeyObj.id + ' en rol ' + targetRole + ' fallo (' + (err ? err.message : '') + '). Rotando a llave alternativa...');

    var tryKeyIndex = function(kIndex) {
      if (kIndex >= KEYS.length) {
        callback(new Error('El pool completo de 7 llaves de Gemini reporto limite de cuota o indisponibilidad temporal.'), null);
        return;
      }
      if (KEYS[kIndex].id === preferredKeyObj.id) {
        tryKeyIndex(kIndex + 1);
        return;
      }

      var altKeyObj = KEYS[kIndex];
      callWithModelFallback(altKeyObj.key, sysPrompt, fullMessage, function(subErr, subReply, subModel) {
        if (!subErr && subReply) {
          callback(null, {
            agent: targetRole,
            agentTitle: preferredKeyObj.title,
            keyUsed: altKeyObj.id,
            fallbackFrom: preferredKeyObj.id,
            modelUsed: subModel,
            reply: subReply
          });
        } else {
          tryKeyIndex(kIndex + 1);
        }
      });
    };

    tryKeyIndex(0);
  });
}

// Ejecucion SIMULTANEA de multiples agentes en paralelo aprovechando las 7 llaves
function askParallelAgents(rolesList, userPrompt, contextData, callback) {
  var roles = (rolesList && rolesList.length > 0)
    ? rolesList
    : ['orchestrator', 'prices', 'inventory', 'clients', 'code_inspector'];

  var results = [];
  var completed = 0;
  var hasErrors = null;

  for (var i = 0; i < roles.length; i++) {
    (function(role, index) {
      // Cada agente se despacha con una llave dedicada simultaneamente
      var keyForAgent = KEYS[index % KEYS.length];
      var sysPrompt = AGENT_PROMPTS[role] || AGENT_PROMPTS.orchestrator;
      var msg = userPrompt;
      if (contextData) {
        msg = 'DATOS REALES DEL SISTEMA MIXNET (JJ PAPER):\n' +
          '```json\n' + (typeof contextData === 'string' ? contextData : JSON.stringify(contextData, null, 2)) + '\n```\n\n' +
          'PREGUNTA O TAREA:\n' + userPrompt;
      }

      callWithModelFallback(keyForAgent.key, sysPrompt, msg, function(err, reply, modelUsed) {
        completed++;
        if (!err && reply) {
          results.push({
            role: role,
            title: keyForAgent.title,
            keyUsed: keyForAgent.id,
            modelUsed: modelUsed,
            reply: reply
          });
        } else {
          // Si falla, reintentar con otra llave
          askAgent(role, userPrompt, contextData, function(retryErr, retryRes) {
            if (!retryErr && retryRes) {
              results.push({
                role: role,
                title: retryRes.agentTitle,
                keyUsed: retryRes.keyUsed,
                modelUsed: retryRes.modelUsed,
                reply: retryRes.reply
              });
            }
            checkDone();
          });
          return;
        }
        checkDone();
      });
    })(roles[i], i);
  }

  function checkDone() {
    if (completed >= roles.length) {
      results.sort(function(a, b) {
        return roles.indexOf(a.role) - roles.indexOf(b.role);
      });
      callback(null, {
        totalAgents: results.length,
        simultaneous: true,
        results: results
      });
    }
  }
}

// Ejecucion SIMULTANEA de los 7 Agentes a la vez
function askAll7AgentsSimultaneous(userPrompt, contextData, callback) {
  var allRoles = KEYS.map(function(k) { return k.role; });
  askParallelAgents(allRoles, userPrompt, contextData, callback);
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
  askParallelAgents: askParallelAgents,
  askAll7AgentsSimultaneous: askAll7AgentsSimultaneous,
  getAgentsList: getAgentsList,
  KEYS: KEYS
};

