/*
  ========================================================================
  JJ Paper — Inspector y Extractor Inteligente de MixNet v4.0 (2026)
  ========================================================================
  Herramienta consciente para extracción de datos reales de MixNet:
    1. Audita y compara tablas (MXCTAINV vs VICTAINV vs JJCTAINV).
    2. Certifica "Base Viva" mediante fecha de movimientos/facturas.
    3. Muestra una vista previa de precios en pantalla para validación humana.
    4. Extrae inventario real (código, nombre, precios USD/Bs, costo, stock).
    5. Extrae clientes con RIF limpio, teléfonos, dirección y correos (con soporte MEMO).
    6. Genera CSVs para Excel y JSON estructurado listo para inyección en Supabase Core.

  Compatible con Node 13+ (Windows 7 / 10 / 11).
  Cero dependencias npm — 100% módulos nativos de Node.js.
  ========================================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');
var readline = require('readline');

/* ═══════════════ SALIDA Y CONSOLA ═══════════════ */
function say(s) {
  try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); }
}

function ts() {
  var d = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return '[' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
}

function log(m)     { say(ts() + ' ' + m); }
function logOK(m)   { say(ts() + '  ✔ ' + m); }
function logWarn(m) { say(ts() + '  ⚠ ' + m); }
function logErr(m)  { say(ts() + '  ✖ ' + m); }

function banner(msg) {
  say('');
  say('  ======================================================================');
  say('    ' + msg);
  say('  ======================================================================');
  say('');
}

/* ═══════════════ DECODIFICACIÓN CP1252 (Español FoxPro) ═══════════════ */
var CP1252 = {
  0x80:'\u20AC', 0x82:'\u201A', 0x83:'\u0192', 0x84:'\u201E', 0x85:'\u2026',
  0x86:'\u2020', 0x87:'\u2021', 0x88:'\u02C6', 0x89:'\u2030', 0x8A:'\u0160',
  0x8B:'\u2039', 0x8C:'\u0152', 0x8E:'\u017D', 0x91:'\u2018', 0x92:'\u2019',
  0x93:'\u201C', 0x94:'\u201D', 0x95:'\u2022', 0x96:'\u2013', 0x97:'\u2014',
  0x98:'\u02DC', 0x99:'\u2122', 0x9A:'\u0161', 0x9B:'\u203A', 0x9C:'\u0153',
  0x9E:'\u017E', 0x9F:'\u0178', 0xA0:' ',     0xA7:'\u00A7'
};

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    if (b < 128) s += String.fromCharCode(b);
    else if (b >= 0xA0) s += String.fromCharCode(b);
    else s += CP1252[b] || '';
  }
  return s.trim();
}

/* ═══════════════ LECTOR DBF Y ARCHIVOS MEMO (.DBT / .FPT) ═══════════════ */
function readDbfStructure(filePath) {
  try {
    var buf = fs.readFileSync(filePath);
    if (buf.length < 33) return null;

    var numRecords = buf.readUInt32LE(4);
    var headerLen  = buf.readUInt16LE(8);
    var recordLen  = buf.readUInt16LE(10);
    var lastUpd    = { y: buf[1] + 1900, m: buf[2], d: buf[3] };

    if (headerLen < 33 || recordLen < 1 || headerLen > buf.length) return null;

    var fields = [];
    var off = 32;
    while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = buf[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (clean.length > 0) {
        fields.push({
          name: clean,
          rawName: rawName.trim(),
          type: String.fromCharCode(buf[off + 11]),
          len:  buf[off + 16] || buf.readUInt16LE(off + 16),
          dec:  buf[off + 17] || 0
        });
      }
      off += 32;
    }

    var st = fs.statSync(filePath);

    // Buscar archivo memo acompañante (.DBT o .FPT)
    var memoPath = null;
    var baseNoExt = filePath.replace(/\.dbf$/i, '');
    if (fs.existsSync(baseNoExt + '.dbt')) memoPath = baseNoExt + '.dbt';
    else if (fs.existsSync(baseNoExt + '.DBT')) memoPath = baseNoExt + '.DBT';
    else if (fs.existsSync(baseNoExt + '.fpt')) memoPath = baseNoExt + '.fpt';
    else if (fs.existsSync(baseNoExt + '.FPT')) memoPath = baseNoExt + '.FPT';

    return {
      path: filePath,
      fileName: path.basename(filePath).toUpperCase(),
      numRecords: numRecords,
      headerLen: headerLen,
      recordLen: recordLen,
      lastUpd: lastUpd,
      mtime: st.mtime,
      size: st.size,
      fields: fields,
      fieldNames: fields.map(function (f) { return f.name; }),
      memoPath: memoPath
    };
  } catch (_) {
    return null;
  }
}

function openMemo(struct) {
  if (!struct.memoPath) return null;
  try {
    var fd = fs.openSync(struct.memoPath, 'r');
    var hBuf = Buffer.alloc(512);
    fs.readSync(fd, hBuf, 0, 512, 0);
    var blockSize = 512;
    if (/\.fpt$/i.test(struct.memoPath)) {
      var bs = hBuf.readUInt16BE(6);
      if (bs >= 32 && bs <= 16384) blockSize = bs;
    }
    return { fd: fd, blockSize: blockSize };
  } catch (_) {
    return null;
  }
}

function readMemoBlock(memoInfo, blockNum) {
  if (!memoInfo || !blockNum || blockNum <= 0) return '';
  try {
    var off = blockNum * memoInfo.blockSize;
    var buf = Buffer.alloc(1024);
    var n = fs.readSync(memoInfo.fd, buf, 0, 1024, off);
    if (n <= 0) return '';
    var txt = '';
    for (var i = 0; i < n; i++) {
      if (buf[i] === 0x1A || buf[i] === 0) break;
      txt += decodeStr(buf, i, 1);
    }
    return txt.trim();
  } catch (_) {
    return '';
  }
}

function closeMemo(memoInfo) {
  if (memoInfo && memoInfo.fd) {
    try { fs.closeSync(memoInfo.fd); } catch (_) {}
  }
}

function readDbfRows(struct, maxLimit) {
  var limit = maxLimit || 300000;
  var buf;
  try { buf = fs.readFileSync(struct.path); } catch (e) { return []; }

  var memo = openMemo(struct);
  var rows = [];
  var pos = struct.headerLen;
  var maxEnd = Math.min(struct.headerLen + struct.numRecords * struct.recordLen, buf.length);

  while (pos + struct.recordLen <= maxEnd && rows.length < limit) {
    var deleted = buf[pos] === 0x2A; // 0x2A ('*') indica borrado en FoxPro
    if (!deleted) {
      var row = {};
      var fOff = pos + 1;
      for (var fi = 0; fi < struct.fields.length; fi++) {
        var f = struct.fields[fi];
        var val = '';
        if (f.type === 'M') {
          // Campo Memo: el DBF guarda el puntero de bloque en texto de 10 bytes
          var ptrStr = decodeStr(buf, fOff, f.len);
          var bNum = parseInt(ptrStr, 10);
          if (!isNaN(bNum) && bNum > 0 && memo) {
            val = readMemoBlock(memo, bNum);
          }
        } else {
          val = decodeStr(buf, fOff, f.len);
        }
        row[f.name] = val;
        fOff += f.len;
      }
      rows.push(row);
    }
    pos += struct.recordLen;
  }

  closeMemo(memo);
  return rows;
}

/* ═══════════════ MATCHING DE CAMPOS INTELIGENTE ═══════════════ */
function findField(fieldNames, candidates) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi] === c || fieldNames[fi].indexOf(c) === 0) return fieldNames[fi];
    }
  }
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci].toLowerCase();
    if (c.length < 3) continue;
    for (var fi = 0; fi < fieldNames.length; fi++) {
      if (fieldNames[fi].indexOf(c) !== -1) return fieldNames[fi];
    }
  }
  return null;
}

/* ═══════════════ BÚSQUEDA Y DESCUBRIMIENTO DE FUENTES ═══════════════ */
function getCandidateDirectories(customTarget) {
  var list = [];
  if (customTarget && fs.existsSync(customTarget)) {
    list.push(customTarget);
  }

  // Rutas conocidas en orden estricto de prioridad (Servidor en vivo PRIMERO)
  var paths = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\COMP02',
    'M:\\COMP03',
    '\\\\192.168.0.185\\comp01',
    '\\\\192.168.0.185\\M\\comp01',
    '\\\\192.168.0.185\\mixnet\\comp01',
    '\\\\192.168.0.185\\MIXNET\\comp01',
    '\\\\192.168.0.185\\sistemas\\comp01',
    'P:\\comp01',
    'Z:\\comp01',
    'C:\\MIXNET\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'D:\\MIXNET\\comp01'
  ];

  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    if (list.indexOf(p) === -1) {
      try {
        if (fs.existsSync(p)) list.push(p);
      } catch (_) {}
    }
  }
  return list;
}

/* ═══════════════ EVALUACIÓN DE FRESCURA ("BASE VIVA") ═══════════════ */
function inspectFreshness(dirPath) {
  // Busca las tablas transaccionales de ventas/movimientos para ver la fecha del último movimiento real
  var txFiles = ['MXTRAINV.DBF', 'MXRENFAC.DBF', 'MXENCFAC.DBF', 'YPENCFAC.DBF', 'MXTRACOB.DBF'];
  var latestDate = null;
  var latestFile = null;

  for (var i = 0; i < txFiles.length; i++) {
    var fp = path.join(dirPath, txFiles[i]);
    try {
      if (fs.existsSync(fp)) {
        var st = fs.statSync(fp);
        if (!latestDate || st.mtime > latestDate) {
          latestDate = st.mtime;
          latestFile = txFiles[i];
        }
      }
    } catch (_) {}
  }

  var isLive = false;
  var daysAgo = 9999;
  if (latestDate) {
    daysAgo = Math.floor((Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
    isLive = daysAgo <= 7; // Modificado en los últimos 7 días
  }

  return {
    latestDate: latestDate,
    latestFile: latestFile,
    daysAgo: daysAgo,
    isLive: isLive
  };
}

/* ═══════════════ CSV HELPERS ═══════════════ */
function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (/[",;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function saveOutputs(prefix, csvContent, jsonPayload) {
  var d = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var stamp = '' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  var BOM = '\uFEFF';

  var savedFiles = [];

  // Carpetas donde guardar: Carpeta actual + Escritorio
  var targetDirs = [__dirname];
  var u = process.env.USERPROFILE || '';
  if (u) {
    var desk = path.join(u, 'Desktop');
    var escr = path.join(u, 'Escritorio');
    if (fs.existsSync(desk) && targetDirs.indexOf(desk) === -1) targetDirs.push(desk);
    if (fs.existsSync(escr) && targetDirs.indexOf(escr) === -1) targetDirs.push(escr);
  }

  for (var i = 0; i < targetDirs.length; i++) {
    var tDir = targetDirs[i];
    try {
      if (csvContent) {
        var csvName = prefix + '_' + stamp + '.csv';
        var csvPath = path.join(tDir, csvName);
        fs.writeFileSync(csvPath, BOM + csvContent, 'utf8');
        savedFiles.push(csvPath);
      }
      if (jsonPayload) {
        var jsonName = prefix + '_' + stamp + '.json';
        var jsonPath = path.join(tDir, jsonName);
        fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');
        savedFiles.push(jsonPath);
      }
    } catch (e) {
      logWarn('No pude guardar en ' + tDir + ': ' + e.message);
    }
  }

  return savedFiles;
}

/* ═══════════════ PROMPTS INTERACTIVOS EN CONSOLA ═══════════════ */
function askQuestion(query, callback) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question(query, function(ans) {
    rl.close();
    callback(ans.trim());
  });
}

/* ═══════════════ PROGRAMA PRINCIPAL CONSCIENTE ═══════════════ */
function start() {
  banner('JJ PAPER — INSPECTOR Y EXTRACTOR TOTAL MIXNET v4.0');

  log('Iniciando rastreo de fuentes de datos...');
  log('Buscando servidor principal (IP 192.168.0.185 / M:\\comp01)...');

  var candidates = getCandidateDirectories();

  if (candidates.length === 0) {
    logErr('No se encontró automáticamente ninguna carpeta de MixNet.');
    say('');
    say('  Por favor verifica que la unidad M:\\ esté montada o escribe la ruta de red.');
    say('  Ejemplo: M:\\comp01  o  \\\\192.168.0.185\\comp01');
    say('');
    askQuestion('Escribe la ruta manualmente (o Enter para salir): ', function(custom) {
      if (!custom) { logErr('Operación cancelada por el usuario.'); process.exit(1); }
      if (!fs.existsSync(custom)) { logErr('La ruta indicada no existe o es inaccesible.'); process.exit(1); }
      runInspectionOnDir(custom);
    });
    return;
  }

  say('');
  say('  Se encontraron las siguientes carpetas candidatas:');
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var f = inspectFreshness(c);
    var status = f.isLive ? '🟢 ACTIVA (Hace ' + f.daysAgo + ' días)' : '🔴 POSIBLE RESPALDO (Hace ' + f.daysAgo + ' días)';
    say('    [' + (i + 1) + '] ' + c + '  ->  ' + status);
  }
  say('');

  // Por defecto, preseleccionar la primera activa
  var bestIdx = 0;
  for (var i = 0; i < candidates.length; i++) {
    if (inspectFreshness(candidates[i]).isLive) { bestIdx = i; break; }
  }

  askQuestion('Selecciona la carpeta a inspeccionar [1-' + candidates.length + '] (Enter = [' + (bestIdx + 1) + ']): ', function(ans) {
    var chosenIdx = bestIdx;
    if (ans) {
      var n = parseInt(ans, 10);
      if (!isNaN(n) && n >= 1 && n <= candidates.length) chosenIdx = n - 1;
    }
    var targetDir = candidates[chosenIdx];
    logOK('Carpeta seleccionada: ' + targetDir);
    runInspectionOnDir(targetDir);
  });
}

function runInspectionOnDir(targetDir) {
  banner('PASO 2: AUDITORÍA Y COMPARATIVA DE TABLAS EN VIVO');
  log('Analizando tablas de inventario en ' + targetDir + '...');

  // Buscar tablas candidatas de productos
  var possibleTables = ['MXCTAINV.DBF', 'VICTAINV.DBF', 'JJCTAINV.DBF', 'CTAINV.DBF'];
  var foundTables = [];

  for (var i = 0; i < possibleTables.length; i++) {
    var fp = path.join(targetDir, possibleTables[i]);
    if (fs.existsSync(fp)) {
      var struct = readDbfStructure(fp);
      if (struct && struct.numRecords > 0) foundTables.push(struct);
    }
  }

  if (foundTables.length === 0) {
    logErr('No se encontró ninguna tabla de productos (MXCTAINV/VICTAINV) en ' + targetDir);
    process.exit(1);
  }

  say('');
  say('  TABLAS DE INVENTARIO DISPONIBLES EN ESTA CARPETA:');
  for (var i = 0; i < foundTables.length; i++) {
    var t = foundTables[i];
    var modStr = t.mtime.toLocaleDateString() + ' ' + t.mtime.toLocaleTimeString();
    say('    (' + (i + 1) + ') ' + t.fileName + '  |  Registros: ' + t.numRecords + '  |  Modificado: ' + modStr);
  }
  say('');

  // Tomar una muestra comparativa de 3 productos entre las tablas encontradas
  log('Leyendo muestra comparativa para verificación visual de precios...');
  
  var tableRows = {};
  for (var i = 0; i < foundTables.length; i++) {
    var t = foundTables[i];
    tableRows[t.fileName] = readDbfRows(t, 200); // Primeros 200 para buscar testigos
  }

  // Buscar 3 códigos conocidos o los primeros 3 códigos con precio > 0
  var sampleCodes = [];
  var primary = tableRows[foundTables[0].fileName] || [];
  for (var i = 0; i < primary.length && sampleCodes.length < 3; i++) {
    var r = primary[i];
    var cod = String(r.codart || r.codigo || '').trim();
    var pA = parseFloat(r.precio_a || r.p1 || 0) || 0;
    if (cod && pA > 0 && sampleCodes.indexOf(cod) === -1) sampleCodes.push(cod);
  }

  say('  ══════════════════════════════════════════════════════════════════════');
  say('   VERIFICACIÓN EN PANTALLA: COMPARATIVA DE PRECIOS ENTRE TABLAS');
  say('  ══════════════════════════════════════════════════════════════════════');

  sampleCodes.forEach(function(cod) {
    say('   ARTÍCULO CÓDIGO: ' + cod);
    foundTables.forEach(function(t) {
      var row = (tableRows[t.fileName] || []).filter(function(x) {
        return String(x.codart || x.codigo || '').trim() === cod;
      })[0];
      if (row) {
        var nom = String(row.nomart || row.descrip || '').trim();
        var pA = parseFloat(row.precio_a || 0) || 0;
        var pC = parseFloat(row.precio_c || 0) || 0;
        var st = parseFloat(row.existe_act || 0) || 0;
        say('     [' + t.fileName + '] ' + nom);
        say('        -> Precio A (USD): $' + pA.toFixed(2) + '  |  Precio C (Bs): ' + pC.toFixed(2) + '  |  Stock: ' + st);
      } else {
        say('     [' + t.fileName + '] (No encontrado en muestra)');
      }
    });
    say('   ------------------------------------------------------------------');
  });

  say('');
  log('POR FAVOR CONFIRMA:');
  say('  ¿Cuál de estas tablas contiene el PRECIO REAL que ves en MixNet hoy?');
  
  askQuestion('Elige el número de tabla a extraer [1-' + foundTables.length + '] (Enter = [1] ' + foundTables[0].fileName + '): ', function(choice) {
    var selectedTable = foundTables[0];
    if (choice) {
      var n = parseInt(choice, 10);
      if (!isNaN(n) && n >= 1 && n <= foundTables.length) selectedTable = foundTables[n - 1];
    }

    logOK('Tabla seleccionada para catálogo de productos: ' + selectedTable.fileName);
    executeFullExtraction(targetDir, selectedTable);
  });
}

function executeFullExtraction(targetDir, productTableStruct) {
  banner('PASO 3: EXTRACCIÓN Y DEDUPLICACIÓN DE PRODUCTOS Y CLIENTES');

  // ════════════════════════════════════════════════════════════════════
  // A) EXTRACCIÓN DE PRODUCTOS
  // ════════════════════════════════════════════════════════════════════
  log('Extrayendo productos desde ' + productTableStruct.fileName + '...');
  var rawProducts = readDbfRows(productTableStruct, 500000);
  logOK('Total registros leídos: ' + rawProducts.length);

  var fn = productTableStruct.fieldNames;
  var fCode  = findField(fn, ['codart', 'codigo', 'cod_art', 'id']);
  var fName  = findField(fn, ['nomart', 'nombre', 'descrip', 'articulo']);
  var fP1    = findField(fn, ['precio_a', 'precio1', 'p1', 'pvp', 'precio']);
  var fP2    = findField(fn, ['precio_b', 'precio2', 'p2']);
  var fP3    = findField(fn, ['precio_c', 'precio3', 'p3']);
  var fP4    = findField(fn, ['precio_d', 'precio4', 'p4']);
  var fCost  = findField(fn, ['costo_act', 'costo', 'ult_costo', 'cost_u']);
  var fStock = findField(fn, ['existe_act', 'exist', 'stock', 'cantidad']);
  var fGroup = findField(fn, ['grupo', 'familia', 'fam', 'cat']);
  var fBrand = findField(fn, ['marca', 'mar']);
  var fUnit  = findField(fn, ['unidad', 'uni', 'medida']);
  var fIva   = findField(fn, ['iva', 'tasa_iva']);
  var fProv  = findField(fn, ['ult_prove', 'proveedor', 'prov_asig']);

  var productosMap = new Map(); // Normalización por SKU para CERO DUPLICADOS
  var sinCodigo = 0;
  var inactivos = 0;

  for (var i = 0; i < rawProducts.length; i++) {
    var r = rawProducts[i];
    var cod = String(r[fCode] || '').trim().toUpperCase();
    if (!cod) { sinCodigo++; continue; }

    var nom = String(r[fName] || '').trim();
    if (!nom) nom = '(SIN NOMBRE)';

    var p1 = parseFloat(r[fP1] || 0) || 0;
    var p2 = parseFloat(r[fP2] || 0) || 0;
    var p3 = parseFloat(r[fP3] || 0) || 0;
    var p4 = parseFloat(r[fP4] || 0) || 0;
    var cost = parseFloat(r[fCost] || 0) || 0;
    var stock = parseFloat(r[fStock] || 0) || 0;
    if (stock < 0) stock = 0;

    // Filtro de activos: debe tener precio > 0 O stock > 0
    if (p1 <= 0 && stock <= 0 && cost <= 0) {
      inactivos++;
      continue;
    }

    var prodObj = {
      codigo: cod,
      nombre: nom,
      precio_usd: p1,
      precio_2: p2,
      precio_bs: p3,
      precio_4: p4,
      costo: cost,
      stock: stock,
      grupo: String(r[fGroup] || '').trim(),
      marca: String(r[fBrand] || '').trim(),
      unidad: String(r[fUnit] || '').trim(),
      iva: String(r[fIva] || '').trim(),
      proveedor: String(r[fProv] || '').trim()
    };

    // Deduplicación inteligente: si ya existe, prevalece el que tenga stock o precio más alto
    if (productosMap.has(cod)) {
      var prev = productosMap.get(cod);
      if (prodObj.stock > prev.stock || (prodObj.stock === prev.stock && prodObj.precio_usd > prev.precio_usd)) {
        productosMap.set(cod, prodObj);
      }
    } else {
      productosMap.set(cod, prodObj);
    }
  }

  var productosFinales = Array.from(productosMap.values());
  logOK('Productos activos y únicos procesados: ' + productosFinales.length);
  log('  (Omitidos: ' + sinCodigo + ' sin código, ' + inactivos + ' inactivos sin precio ni stock)');

  // CSV de Productos
  var pCsvHeaders = 'CODIGO,PRODUCTO,PRECIO_USD,PRECIO_2,PRECIO_BS,COSTO_USD,STOCK,GRUPO,MARCA,UNIDAD,PROVEEDOR';
  var pCsvRows = [pCsvHeaders];
  productosFinales.forEach(function(p) {
    pCsvRows.push([
      escCSV(p.codigo), escCSV(p.nombre), p.precio_usd.toFixed(2), p.precio_2.toFixed(2),
      p.precio_bs.toFixed(2), p.costo.toFixed(2), p.stock.toString(),
      escCSV(p.grupo), escCSV(p.marca), escCSV(p.unidad), escCSV(p.proveedor)
    ].join(','));
  });

  // ════════════════════════════════════════════════════════════════════
  // B) EXTRACCIÓN DE CLIENTES
  // ════════════════════════════════════════════════════════════════════
  var clientFile = path.join(targetDir, 'MXCTACLI.DBF');
  var clientesFinales = [];

  if (fs.existsSync(clientFile)) {
    log('Extrayendo clientes desde MXCTACLI.DBF (con soporte MEMO para emails)...');
    var cStruct = readDbfStructure(clientFile);
    if (cStruct) {
      var rawClients = readDbfRows(cStruct, 500000);
      var cfn = cStruct.fieldNames;

      var fCliCod   = findField(cfn, ['codcli', 'codigo', 'cod_cli', 'id']);
      var fCliNom   = findField(cfn, ['nomcli', 'razonsocial', 'razon', 'nombre']);
      var fCliRif   = findField(cfn, ['cifoih', 'cifoi', 'cif', 'rif', 'cedula']);
      var fCliDir1  = findField(cfn, ['direc1h', 'direc1', 'dir1', 'direccion1']);
      var fCliDir2  = findField(cfn, ['direc2h', 'direc2', 'dir2']);
      var fCliDir3  = findField(cfn, ['direc3h', 'direc3', 'dir3']);
      var fCliDir4  = findField(cfn, ['direc4h', 'direc4', 'dir4']);
      var fCliTlf1  = findField(cfn, ['tlf1h', 'tlf1', 'telefono1', 'tel1']);
      var fCliTlf2  = findField(cfn, ['tlf2h', 'tlf2', 'telefono2', 'tel2']);
      var fCliEmail = findField(cfn, ['email', 'emailngq', 'correo', 'mail']);
      var fCliVen   = findField(cfn, ['codven', 'vendedor', 'vended']);
      var fCliZona  = findField(cfn, ['zonacto', 'zona']);
      var fCliSaldo = findField(cfn, ['saldo', 'saldoor']);

      var EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      var clientesMap = new Map();

      for (var i = 0; i < rawClients.length; i++) {
        var r = rawClients[i];
        var cCod = String(r[fCliCod] || '').trim();
        var cNom = String(r[fCliNom] || '').trim();
        if (!cCod && !cNom) continue;

        // Limpiar RIF
        var rawRif = String(r[fCliRif] || '').trim().toUpperCase().replace(/[\s.-]/g, '');
        var rifClean = rawRif;
        if (/^\d+$/.test(rawRif)) rifClean = 'V-' + rawRif;
        else if (/^[JVEGP]\d+$/.test(rawRif)) rifClean = rawRif.charAt(0) + '-' + rawRif.substring(1);

        // Concatenar dirección
        var dirParts = [r[fCliDir1], r[fCliDir2], r[fCliDir3], r[fCliDir4]].filter(function(x) {
          return x && String(x).trim();
        }).map(function(x) { return String(x).trim(); });
        var direccion = dirParts.join(' ').trim();

        // Limpiar teléfonos
        var t1 = String(r[fCliTlf1] || '').trim();
        var t2 = String(r[fCliTlf2] || '').trim();

        // Extraer email
        var rawEmail = String(r[fCliEmail] || '').trim();
        var emailMatch = rawEmail.match(EMAIL_REGEX);
        var email = emailMatch ? emailMatch[0].toLowerCase() : '';

        // Si el email no está en el campo email, buscar en dirección o notas memo
        if (!email && r.memo) {
          var memoMatch = String(r.memo).match(EMAIL_REGEX);
          if (memoMatch) email = memoMatch[0].toLowerCase();
        }

        var cliObj = {
          codigo: cCod,
          nombre: cNom,
          rif: rifClean,
          telefono1: t1,
          telefono2: t2,
          email: email,
          direccion: direccion,
          vendedor_cod: String(r[fCliVen] || '').trim(),
          zona: String(r[fCliZona] || '').trim(),
          saldo: parseFloat(r[fCliSaldo] || 0) || 0
        };

        var key = cCod || rifClean || cNom;
        if (!clientesMap.has(key)) {
          clientesMap.set(key, cliObj);
        }
      }

      clientesFinales = Array.from(clientesMap.values());
      logOK('Clientes procesados con éxito: ' + clientesFinales.length);
      var conEmail = clientesFinales.filter(function(x) { return x.email; }).length;
      logOK('Clientes con correo detectado: ' + conEmail);
    }
  } else {
    logWarn('No se encontró MXCTACLI.DBF en ' + targetDir + ' (solo se exportará productos).');
  }

  // CSV de Clientes
  var cCsvRows = ['CODIGO,NOMBRE_EMPRESA,RIF,TELEFONO_1,TELEFONO_2,EMAIL,DIRECCION,VENDEDOR_COD,ZONA,SALDO'];
  clientesFinales.forEach(function(c) {
    cCsvRows.push([
      escCSV(c.codigo), escCSV(c.nombre), escCSV(c.rif), escCSV(c.telefono1),
      escCSV(c.telefono2), escCSV(c.email), escCSV(c.direccion),
      escCSV(c.vendedor_cod), escCSV(c.zona), c.saldo.toFixed(2)
    ].join(','));
  });

  // ════════════════════════════════════════════════════════════════════
  // C) GUARDAR ARCHIVOS EN ESCRITORIO Y CARPETA LOCAL
  // ════════════════════════════════════════════════════════════════════
  banner('PASO 4: GUARDANDO ARCHIVOS CSV Y PAYLOAD SUPABASE');

  var prodCsvStr = pCsvRows.join('\r\n');
  var cliCsvStr  = cCsvRows.length > 1 ? cCsvRows.join('\r\n') : null;

  var supabasePayload = {
    exportado_el: new Date().toISOString(),
    fuente: targetDir,
    tabla_productos: productTableStruct.fileName,
    resumen: {
      total_productos: productosFinales.length,
      total_clientes: clientesFinales.length
    },
    productos: productosFinales,
    clientes: clientesFinales
  };

  var savedP = saveOutputs('mixnet_productos_reales', prodCsvStr, null);
  var savedC = cliCsvStr ? saveOutputs('mixnet_clientes_reales', cliCsvStr, null) : [];
  var savedJ = saveOutputs('mixnet_payload_supabase', null, supabasePayload);

  say('');
  logOK('ARCHIVOS GENERADOS EXITOSAMENTE:');
  say('  📦 PRODUCTOS (CSV Excel):');
  savedP.forEach(function(f) { say('     -> ' + f); });

  if (savedC.length > 0) {
    say('  👥 CLIENTES (CSV Excel):');
    savedC.forEach(function(f) { say('     -> ' + f); });
  }

  say('  ⚡ PAYLOAD PARA SUPABASE (JSON):');
  savedJ.forEach(function(f) { say('     -> ' + f); });

  say('');
  say('  ======================================================================');
  say('    ¡LISTO! La extracción consciente v4.0 finalizó con éxito.');
  say('    Lleva los archivos a JJ Paper para sincronizarlos en Supabase.');
  say('  ======================================================================');
  say('');
}

// Arrancar el flujo
try {
  start();
} catch (e) {
  logErr('Error inesperado: ' + (e.stack || e.message));
}