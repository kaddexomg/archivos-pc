/*
  ========================================================================
  JJ Paper — Inspector y Extractor Inteligente de MixNet v4.1 (2026)
  ========================================================================
  Herramienta consciente para extracción de datos reales de MixNet:
    1. Escaneo profundo de todas las unidades (A: a Z:) y red (192.168.0.185).
    2. Certificación de "Base Viva" por fecha de movimientos/facturas reales.
    3. Comparativa de tablas (MXCTAINV vs VICTAINV vs CTAEVA vs JJCTAINV).
    4. Búsqueda interactiva de cualquier CÓDIGO para validación en pantalla.
    5. Extracción de inventario real (código, nombre, precios USD/Bs, costo, stock).
    6. Extracción de clientes con RIF limpio, teléfonos, dirección y correos (MEMO).
    7. Generación de CSVs con BOM para Excel y JSON estructurado para Supabase.

  Compatible con Node 13+ en Windows 7 / 10 / 11.
  Cero dependencias npm — 100% módulos nativos de Node.js.
  ========================================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');
var readline = require('readline');

/* ═══════════════ SALIDA Y CONSOLA (SIN BUFFER EN WINDOWS 7) ═══════════════ */
function say(s) {
  try {
    fs.writeSync(1, s + '\r\n');
  } catch (_) {
    console.log(s);
  }
}

function ts() {
  var d = new Date();
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  return '[' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
}

function log(m)     { say(ts() + ' ' + m); }
function logOK(m)   { say(ts() + '  [OK] ' + m); }
function logWarn(m) { say(ts() + '  [!] ' + m); }
function logErr(m)  { say(ts() + '  [ERROR] ' + m); }

function banner(msg) {
  say('');
  say('========================================================================');
  say('  ' + msg);
  say('========================================================================');
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

    // Buscar archivo memo (.DBT o .FPT)
    var memoPath = null;
    var baseNoExt = filePath.replace(/\.dbf$/i, '');
    var memoExts = ['.dbt', '.DBT', '.fpt', '.FPT'];
    for (var mi = 0; mi < memoExts.length; mi++) {
      var mp = baseNoExt + memoExts[mi];
      if (fs.existsSync(mp)) { memoPath = mp; break; }
    }

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
      fieldNames: fields.map(function(f) { return f.name; }),
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
  try { buf = fs.readFileSync(struct.path); } catch (_) { return []; }

  var memo = openMemo(struct);
  var rows = [];
  var pos = struct.headerLen;
  var maxDataEnd = Math.min(
    struct.headerLen + (struct.numRecords * struct.recordLen),
    buf.length
  );

  while (pos + struct.recordLen <= maxDataEnd && rows.length < limit) {
    var flag = buf[pos];
    // 0x2A = registro borrado FoxPro. Omitir.
    if (flag !== 0x2A && flag === 0x20) {
      var row = {};
      var fOff = 1;
      for (var fi = 0; fi < struct.fields.length; fi++) {
        var f = struct.fields[fi];
        var val = decodeStr(buf, pos + fOff, f.len);
        if (f.type === 'M') {
          var blk = parseInt(val, 10);
          if (!isNaN(blk) && blk > 0) {
            row[f.name] = readMemoBlock(memo, blk);
          } else {
            row[f.name] = '';
          }
        } else {
          row[f.name] = val;
        }
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
  for (var ci2 = 0; ci2 < candidates.length; ci2++) {
    var c2 = candidates[ci2].toLowerCase();
    if (c2.length < 3) continue;
    for (var fi2 = 0; fi2 < fieldNames.length; fi2++) {
      if (fieldNames[fi2].indexOf(c2) !== -1) return fieldNames[fi2];
    }
  }
  return null;
}

/* ═══════════════ ESCANEO PROFUNDO DE TODAS LAS UNIDADES ═══════════════ */
function detectAvailableDrives() {
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var active = [];
  for (var i = 0; i < letters.length; i++) {
    var d = letters[i] + ':';
    try {
      if (fs.existsSync(d + '\\')) {
        active.push(d);
      }
    } catch (_) {}
  }
  return active;
}

function getCandidateDirectories(customTarget) {
  var list = [];
  var seen = {};

  function addPath(p) {
    if (!p) return;
    var norm = path.normalize(p).replace(/[\/\\]+$/, '');
    var key = norm.toUpperCase();
    if (seen[key]) return;
    try {
      if (fs.existsSync(norm)) {
        // Verificar si tiene al menos un DBF de inventario o clientes
        var entries = fs.readdirSync(norm);
        var hasRelevant = false;
        for (var ei = 0; ei < entries.length; ei++) {
          var name = entries[ei].toUpperCase();
          if (name.indexOf('CTAINV') !== -1 || name.indexOf('CTACLI') !== -1 ||
              name === 'VICTAINV.DBF' || name === 'JJCTAINV.DBF' || name === 'CTAEVA.DBF' ||
              name === 'MXTRAINV.DBF' || name === 'MXCAMBIO.DBF') {
            hasRelevant = true;
            break;
          }
        }
        if (hasRelevant) {
          seen[key] = true;
          list.push(norm);
        }
      }
    } catch (_) {}
  }

  if (customTarget) addPath(customTarget);

  // 1. Detectar todas las unidades montadas en la PC (C:, M:, P:, Z:, etc.)
  var drives = detectAvailableDrives();
  log('Unidades de disco detectadas en esta PC: ' + drives.join(', '));

  var subNames = [
    '', // En la propia raíz de la unidad (ej: M:\)
    'comp01', 'COMP01',
    'comp02', 'COMP02',
    'comp03', 'COMP03',
    'mixnet', 'MIXNET',
    'mixnet\\comp01', 'MIXNET\\comp01',
    'mixnet\\COMP01', 'MIXNET\\COMP01',
    'sistemas\\comp01', 'SISTEMAS\\comp01',
    'sistemas', 'SISTEMAS',
    'datos\\comp01', 'DATOS\\comp01',
    'RESPAMIX', 'respamix',
    'RESPAMIX\\comp01',
    'RESPAMIX\\MIX11 (servidor)\\comp01'
  ];

  for (var di = 0; di < drives.length; di++) {
    var d = drives[di];
    for (var si = 0; si < subNames.length; si++) {
      var candidate = path.join(d + '\\', subNames[si]);
      addPath(candidate);
    }

    // Inspección de carpetas de primer nivel en esa unidad
    try {
      var topDirs = fs.readdirSync(d + '\\');
      for (var ti = 0; ti < topDirs.length && ti < 50; ti++) {
        var folderName = topDirs[ti];
        var folderLower = folderName.toLowerCase();
        if (folderLower.indexOf('comp') !== -1 || folderLower.indexOf('mix') !== -1 ||
            folderLower.indexOf('sist') !== -1 || folderLower.indexOf('dato') !== -1 ||
            folderLower.indexOf('respa') !== -1) {
          var fullF = path.join(d + '\\', folderName);
          addPath(fullF);
          addPath(path.join(fullF, 'comp01'));
          addPath(path.join(fullF, 'COMP01'));

          // Probar subcarpetas de ejercicios fiscales recientes (EJ010, EJ009)
          try {
            var subItems = fs.readdirSync(fullF);
            for (var sbi = 0; sbi < subItems.length; sbi++) {
              if (/^ej\d+/i.test(subItems[sbi])) {
                addPath(path.join(fullF, subItems[sbi]));
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 2. Rutas UNC directas al servidor de la tienda (192.168.0.185)
  var uncPaths = [
    '\\\\192.168.0.185\\comp01',
    '\\\\192.168.0.185\\COMP01',
    '\\\\192.168.0.185\\mixnet',
    '\\\\192.168.0.185\\MIXNET',
    '\\\\192.168.0.185\\mixnet\\comp01',
    '\\\\192.168.0.185\\MIXNET\\comp01',
    '\\\\192.168.0.185\\sistemas\\comp01',
    '\\\\192.168.0.185\\SISTEMAS\\comp01',
    '\\\\192.168.0.185\\d\\comp01',
    '\\\\192.168.0.185\\m\\comp01',
    '\\\\192.168.0.185\\c\\comp01'
  ];

  for (var ui = 0; ui < uncPaths.length; ui++) {
    addPath(uncPaths[ui]);
  }

  return list;
}

/* ═══════════════ EVALUACIÓN DE FRESCURA ("BASE VIVA") ═══════════════ */
function inspectFreshness(dirPath) {
  var txFiles = [
    'MXTRAINV.DBF', 'mxtrainv.dbf',
    'MXRENFAC.DBF', 'mxrenfac.dbf',
    'MXENCFAC.DBF', 'mxencfac.dbf',
    'YPENCFAC.DBF', 'ypencfac.dbf',
    'MXTRACOB.DBF', 'mxtracob.dbf',
    'MXCTAINV.DBF', 'mxctainv.dbf',
    'VICTAINV.DBF', 'victainv.dbf',
    'CTAEVA.DBF',   'ctaeva.dbf'
  ];

  var latestDate = null;
  var latestFile = null;

  for (var i = 0; i < txFiles.length; i++) {
    var fp = path.join(dirPath, txFiles[i]);
    try {
      if (fs.existsSync(fp)) {
        var st = fs.statSync(fp);
        if (!latestDate || st.mtime > latestDate) {
          latestDate = st.mtime;
          latestFile = txFiles[i].toUpperCase();
        }
      }
    } catch (_) {}
  }

  var isLive = false;
  var daysAgo = 9999;
  if (latestDate) {
    daysAgo = Math.floor((Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
    isLive = daysAgo <= 5; // Modificado en los últimos 5 días = SERVIDOR EN VIVO
  }

  return {
    latestDate: latestDate,
    latestFile: latestFile,
    daysAgo: daysAgo,
    isLive: isLive
  };
}

/* ═══════════════ CSV & GUARDADO ═══════════════ */
function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (/[",;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function saveOutputs(prefix, csvContent, jsonPayload) {
  var d = new Date();
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  var stamp = '' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  var BOM = '\uFEFF';

  var savedFiles = [];
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
      logWarn('No se pudo guardar en ' + tDir + ': ' + e.message);
    }
  }

  return savedFiles;
}

/* ═══════════════ PROMPT INTERACTIVO ═══════════════ */
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

/* ═══════════════ PROGRAMA PRINCIPAL ═══════════════ */
function start() {
  banner('JJ PAPER — INSPECTOR Y EXTRACTOR CONSCIENTE MIXNET v4.1');

  log('Escaneando discos locales, unidades de red mapeadas y servidor...');
  var rawCandidates = getCandidateDirectories();

  if (rawCandidates.length === 0) {
    logErr('No se encontró automáticamente ninguna carpeta de MixNet.');
    say('');
    say('  Por favor escribe la ruta donde están las tablas.');
    say('  Ejemplos habituales:');
    say('     M:\\comp01');
    say('     M:\\');
    say('     P:\\comp01');
    say('     \\\\192.168.0.185\\comp01');
    say('');
    askQuestion('Escribe la ruta (o presiona Enter para salir): ', function(custom) {
      if (!custom) {
        logErr('Operación cancelada por el usuario.');
        process.exit(1);
      }
      if (!fs.existsSync(custom)) {
        logErr('La ruta especificada no existe o no es accesible: ' + custom);
        process.exit(1);
      }
      runInspectionOnDir(custom);
    });
    return;
  }

  // Ordenar candidatos: los que tienen movimientos más recientes PRIMERO
  var candidatesWithStats = rawCandidates.map(function(c) {
    return { path: c, freshness: inspectFreshness(c) };
  });

  candidatesWithStats.sort(function(a, b) {
    var da = a.freshness.latestDate ? a.freshness.latestDate.getTime() : 0;
    var db = b.freshness.latestDate ? b.freshness.latestDate.getTime() : 0;
    return db - da; // Más reciente primero
  });

  say('');
  say('  FUENTES DE DATOS LOCALIZADAS EN TU SISTEMA:');
  say('  ----------------------------------------------------------------------');
  for (var i = 0; i < candidatesWithStats.length; i++) {
    var item = candidatesWithStats[i];
    var f = item.freshness;
    var dateStr = f.latestDate ? f.latestDate.toLocaleDateString() : 'Sin movimientos';
    var status = f.isLive
      ? '(*) SERVIDOR EN VIVO [Movimiento: ' + dateStr + ']'
      : '[-] Respaldo/Historico [' + (f.daysAgo < 9000 ? 'Hace ' + f.daysAgo + ' dias' : 'Sin fecha') + ']';
    say('    [' + (i + 1) + '] ' + item.path);
    say('        -> ' + status);
  }
  say('  ----------------------------------------------------------------------');
  say('');

  var defaultIdx = 0; // El primero es el más fresco
  var promptText = 'Selecciona la carpeta a inspeccionar [1-' + candidatesWithStats.length + '] (Enter = [1]): ';

  askQuestion(promptText, function(ans) {
    var chosenIdx = defaultIdx;
    if (ans) {
      var n = parseInt(ans, 10);
      if (!isNaN(n) && n >= 1 && n <= candidatesWithStats.length) chosenIdx = n - 1;
    }
    var targetDir = candidatesWithStats[chosenIdx].path;
    logOK('Carpeta seleccionada: ' + targetDir);
    runInspectionOnDir(targetDir);
  });
}

/* ═══════════════ PASO 2: AUDITORÍA Y COMPARATIVA DE TABLAS ═══════════════ */
function runInspectionOnDir(targetDir) {
  banner('PASO 2: AUDITORIA Y COMPARATIVA DE PRECIOS EN VIVO');
  log('Analizando tablas de productos en ' + targetDir + '...');

  var candidateTableNames = [
    'MXCTAINV.DBF', 'mxctainv.dbf',
    'VICTAINV.DBF', 'victainv.dbf',
    'CTAEVA.DBF',   'ctaeva.dbf',
    'JJCTAINV.DBF', 'jjctainv.dbf',
    'CTAINV.DBF',   'ctainv.dbf'
  ];

  var foundTables = [];
  var seenTable = {};

  for (var i = 0; i < candidateTableNames.length; i++) {
    var fp = path.join(targetDir, candidateTableNames[i]);
    var upper = candidateTableNames[i].toUpperCase();
    if (!seenTable[upper] && fs.existsSync(fp)) {
      seenTable[upper] = true;
      var struct = readDbfStructure(fp);
      if (struct && struct.numRecords > 0) foundTables.push(struct);
    }
  }

  // Buscar cualquier otro *.DBF en la carpeta que tenga campos de productos
  try {
    var dirFiles = fs.readdirSync(targetDir);
    for (var dfi = 0; dfi < dirFiles.length; dfi++) {
      var df = dirFiles[dfi];
      var dfUpper = df.toUpperCase();
      if (/\.dbf$/i.test(df) && !seenTable[dfUpper]) {
        if (dfUpper.indexOf('INV') !== -1 || dfUpper.indexOf('ART') !== -1 || dfUpper.indexOf('PROD') !== -1) {
          var extraPath = path.join(targetDir, df);
          var extraStruct = readDbfStructure(extraPath);
          if (extraStruct && extraStruct.numRecords > 10) {
            seenTable[dfUpper] = true;
            foundTables.push(extraStruct);
          }
        }
      }
    }
  } catch (_) {}

  if (foundTables.length === 0) {
    logErr('No se encontro ninguna tabla de inventario en ' + targetDir);
    say('  Verifica que seleccionaste la carpeta correcta donde estan los .DBF');
    process.exit(1);
  }

  say('');
  say('  TABLAS DE PRODUCTOS ENCONTRADAS:');
  for (var ti = 0; ti < foundTables.length; ti++) {
    var t = foundTables[ti];
    var mStr = t.mtime.toLocaleDateString() + ' ' + t.mtime.toLocaleTimeString();
    say('    (' + (ti + 1) + ') ' + t.fileName + ' | Registros: ' + t.numRecords + ' | Modificado: ' + mStr);
  }
  say('');

  // Leer muestra de las tablas para comparar
  log('Cargando muestra comparativa...');
  var tableCache = {};
  for (var ti2 = 0; ti2 < foundTables.length; ti2++) {
    var tStruct = foundTables[ti2];
    tableCache[tStruct.fileName] = readDbfRows(tStruct, 300);
  }

  // Buscar 3 artículos de muestra que tengan precio > 0
  var sampleCodes = [];
  var primary = tableCache[foundTables[0].fileName] || [];
  for (var si = 0; si < primary.length && sampleCodes.length < 3; si++) {
    var r = primary[si];
    var cod = String(r.codart || r.codigo || r.cod_art || '').trim();
    var pA = parseFloat(r.precio_a || r.p1 || r.pvp || 0) || 0;
    if (cod && pA > 0 && sampleCodes.indexOf(cod) === -1) {
      sampleCodes.push(cod);
    }
  }

  say('========================================================================');
  say('  COMPARATIVA DE MUESTRA (Precios entre las tablas encontradas):');
  say('========================================================================');

  function printCodeComparison(codToSearch) {
    say('');
    say('  >> CODIGO: [' + codToSearch + ']');
    for (var fti = 0; fti < foundTables.length; fti++) {
      var curT = foundTables[fti];
      var rows = tableCache[curT.fileName] || [];
      var match = rows.filter(function(x) {
        var c = String(x.codart || x.codigo || x.cod_art || '').trim().toUpperCase();
        return c === codToSearch.toUpperCase();
      })[0];

      // Si no estaba en los primeros 300, buscar en toda la tabla
      if (!match) {
        var allRows = readDbfRows(curT, 50000);
        match = allRows.filter(function(x) {
          var c = String(x.codart || x.codigo || x.cod_art || '').trim().toUpperCase();
          return c === codToSearch.toUpperCase();
        })[0];
      }

      if (match) {
        var nom = String(match.nomart || match.descrip || match.nombre || '').trim();
        var pUSD = parseFloat(match.precio_a || match.p1 || 0) || 0;
        var pBs  = parseFloat(match.precio_c || match.precio_b || match.p3 || 0) || 0;
        var cost = parseFloat(match.costo_act || match.ult_costo || match.costo || 0) || 0;
        var stk  = parseFloat(match.existe_act || match.stock || match.cantidad || 0) || 0;
        var fMod = String(match.fecha_mod || '').trim();

        say('     [' + curT.fileName + '] ' + nom);
        say('         Precio USD: $' + pUSD.toFixed(2) + ' | Precio Bs: ' + pBs.toFixed(2) + ' | Costo: $' + cost.toFixed(2) + ' | Stock: ' + stk + (fMod ? ' | Modif: ' + fMod : ''));
      } else {
        say('     [' + curT.fileName + '] (Articulo no existe en esta tabla)');
      }
    }
  }

  sampleCodes.forEach(function(sc) {
    printCodeComparison(sc);
  });

  say('');
  say('========================================================================');
  say('  VERIFICADOR EN VIVO: ¿Quieres verificar un codigo que tienes en pantalla?');
  say('========================================================================');
  say('  Si quieres revisar un codigo especifico de MixNet ahora mismo,');
  say('  escribelo abajo para comparar su precio en vivo entre las tablas.');
  say('  (O simplemente presiona ENTER para pasar a elegir la tabla).');
  say('');

  function promptSearchCode() {
    askQuestion('Escribe un CODIGO para comparar precios (o ENTER para continuar): ', function(userCod) {
      if (userCod) {
        printCodeComparison(userCod);
        say('');
        promptSearchCode(); // Permite buscar varios códigos
      } else {
        promptChooseTable();
      }
    });
  }

  function promptChooseTable() {
    say('');
    say('========================================================================');
    say('  SELECCION DE LA TABLA MAESTRA DE PRECIOS:');
    say('========================================================================');
    say('  ¿Cual de las siguientes tablas tiene el PRECIO REAL de hoy en MixNet?');
    for (var i = 0; i < foundTables.length; i++) {
      say('    [' + (i + 1) + '] ' + foundTables[i].fileName);
    }
    say('');

    askQuestion('Elige el numero [1-' + foundTables.length + '] (Enter = [1] ' + foundTables[0].fileName + '): ', function(ans) {
      var chosen = foundTables[0];
      if (ans) {
        var num = parseInt(ans, 10);
        if (!isNaN(num) && num >= 1 && num <= foundTables.length) chosen = foundTables[num - 1];
      }
      logOK('Tabla maestra seleccionada: ' + chosen.fileName);
      executeFullExtraction(targetDir, chosen);
    });
  }

  promptSearchCode();
}

/* ═══════════════ PASO 3: EXTRACCIÓN TOTAL DE PRODUCTOS Y CLIENTES ═══════════════ */
function executeFullExtraction(targetDir, productTableStruct) {
  banner('PASO 3: EXTRACCION Y NORMALIZACION DE DATOS');

  // 1. PRODUCTOS
  log('Leyendo catálogo completo desde ' + productTableStruct.fileName + '...');
  var rawProducts = readDbfRows(productTableStruct, 500000);
  logOK('Total registros leidos en bruto: ' + rawProducts.length);

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

  var productosMap = new Map();
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

    // Filtro de activos: debe tener precio > 0 O stock > 0 O costo > 0
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

    // Deduplicación por SKU: si ya existe, se conserva el que tenga mayor stock o precio
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
  logOK('Productos procesados y desduplicados: ' + productosFinales.length);
  log('  (Omitidos: ' + sinCodigo + ' sin codigo, ' + inactivos + ' inactivos sin precio ni stock)');

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

  // 2. CLIENTES
  var clientCandidates = ['MXCTACLI.DBF', 'mxctacli.dbf', 'CTACLI.DBF', 'ctacli.dbf'];
  var clientFile = null;
  for (var ci = 0; ci < clientCandidates.length; ci++) {
    var cPath = path.join(targetDir, clientCandidates[ci]);
    if (fs.existsSync(cPath)) { clientFile = cPath; break; }
  }

  var clientesFinales = [];

  if (clientFile) {
    log('Extrayendo clientes desde ' + path.basename(clientFile) + ' (con soporte MEMO)...');
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

      for (var j = 0; j < rawClients.length; j++) {
        var rc = rawClients[j];
        var cCod = String(rc[fCliCod] || '').trim();
        var cNom = String(rc[fCliNom] || '').trim();
        if (!cCod && !cNom) continue;

        // Normalizar RIF
        var rawRif = String(rc[fCliRif] || '').trim().toUpperCase().replace(/[\s.-]/g, '');
        var rifClean = rawRif;
        if (/^\d+$/.test(rawRif)) rifClean = 'V-' + rawRif;
        else if (/^[JVEGP]\d+$/.test(rawRif)) rifClean = rawRif.charAt(0) + '-' + rawRif.substring(1);

        // Concatenar direcciones
        var dirParts = [rc[fCliDir1], rc[fCliDir2], rc[fCliDir3], rc[fCliDir4]].filter(function(x) {
          return x && String(x).trim();
        }).map(function(x) { return String(x).trim(); });
        var direccion = dirParts.join(' ').trim();

        // Limpiar teléfonos
        var t1 = String(rc[fCliTlf1] || '').trim();
        var t2 = String(rc[fCliTlf2] || '').trim();

        // Extraer email
        var rawEmail = String(rc[fCliEmail] || '').trim();
        var emailMatch = rawEmail.match(EMAIL_REGEX);
        var email = emailMatch ? emailMatch[0].toLowerCase() : '';

        // Buscar en memo si no está en campo plano
        if (!email && rc.memo) {
          var memoMatch = String(rc.memo).match(EMAIL_REGEX);
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
          vendedor_cod: String(rc[fCliVen] || '').trim(),
          zona: String(rc[fCliZona] || '').trim(),
          saldo: parseFloat(rc[fCliSaldo] || 0) || 0
        };

        var key = cCod || rifClean || cNom;
        if (!clientesMap.has(key)) {
          clientesMap.set(key, cliObj);
        }
      }

      clientesFinales = Array.from(clientesMap.values());
      logOK('Clientes procesados exitosamente: ' + clientesFinales.length);
      var conEmail = clientesFinales.filter(function(x) { return x.email; }).length;
      logOK('Clientes con email valido: ' + conEmail);
    }
  } else {
    logWarn('No se encontro tabla de clientes (MXCTACLI.DBF) en ' + targetDir);
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
  // 3. GUARDADO DE ARCHIVOS
  // ════════════════════════════════════════════════════════════════════
  banner('PASO 4: GENERANDO ARCHIVOS EN ESCRITORIO');

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
  logOK('ARCHIVOS CREADOS CON EXITO:');
  say('  [PRODUCTOS EN EXCEL (CSV)]');
  savedP.forEach(function(f) { say('    -> ' + f); });

  if (savedC.length > 0) {
    say('  [CLIENTES EN EXCEL (CSV)]');
    savedC.forEach(function(f) { say('    -> ' + f); });
  }

  say('  [PAYLOAD PARA SUPABASE (JSON)]');
  savedJ.forEach(function(f) { say('    -> ' + f); });

  say('');
  say('========================================================================');
  say('  ¡EXTRACCION COMPLETADA CON EXITO!');
  say('  Los archivos estan listos en tu Escritorio.');
  say('========================================================================');
  say('');
}

// Iniciar
try {
  start();
} catch (err) {
  logErr('Fallo en ejecucion: ' + (err.stack || err.message));
}