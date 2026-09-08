/*
  ========================================================================
  JJ Paper — Inspector y Extractor Inteligente de MixNet v4.2 (2026)
  ========================================================================
  Herramienta 100% automatica y consciente para la PC de la tienda:
    1. Acceso directo e instantaneo a M:\comp01 (sin esperas ni cuelgues de red).
    2. Deteccion automatica de la tabla con los PRECIOS MAS RECIENTES (fecha_mod).
    3. Muestra en pantalla el resumen de precios reales para confirmacion visual.
    4. Extraccion completa de inventario (codigo, nombre, precios USD/Bs, costo, stock, fecha_mod).
    5. Extraccion completa de clientes con RIF limpio, telefonos, direccion y EMAIL (MXCTACLI + MEMO + MXAGENDA).
    6. Guardado automatico en el ESCRITORIO y en la carpeta local.

  Compatible con Node 13+ (Windows 7 / 10 / 11).
  Cero dependencias npm — 100% modulos nativos.
  ========================================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ═══════════════ SALIDA INMEDIATA A CONSOLA (SIN BUFFER) ═══════════════ */
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

/* ═══════════════ DECODIFICACION CP1252 (FoxPro Latino) ═══════════════ */
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

    // Buscar archivo memo acompanante (.DBT o .FPT)
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
  var limit = maxLimit || 500000;
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
    // 0x2A = borrado FoxPro. Omitir.
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

/* ═══════════════ DETECCION DIRECTA DE FUENTE DE DATOS ═══════════════ */
function findMixNetDirectory() {
  // Lista priorizada de rutas directas (sin escaneos lentos de red)
  var directPaths = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\RESPAMIX\\COMP01-10012023',
    'C:\\MIXNET\\comp01',
    'D:\\MIXNET\\comp01',
    'D:\\comp01'
  ];

  for (var i = 0; i < directPaths.length; i++) {
    var p = directPaths[i];
    try {
      if (fs.existsSync(p)) {
        // Verificar si contiene tablas reales
        if (fs.existsSync(path.join(p, 'MXCTACLI.DBF')) ||
            fs.existsSync(path.join(p, 'VICTAINV.DBF')) ||
            fs.existsSync(path.join(p, 'MXCTAINV.DBF')) ||
            fs.existsSync(path.join(p, 'CTAEVA.DBF'))) {
          return p;
        }
      }
    } catch (_) {}
  }

  // Si no se encuentra en las rutas directas, probar letras C a Z
  var letters = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'P', 'Z'];
  for (var li = 0; li < letters.length; li++) {
    var root = letters[li] + ':\\';
    try {
      if (fs.existsSync(root)) {
        var subDirs = ['comp01', 'COMP01', 'mixnet\\comp01', 'sistemas\\comp01'];
        for (var si = 0; si < subDirs.length; si++) {
          var target = path.join(root, subDirs[si]);
          if (fs.existsSync(target) && fs.existsSync(path.join(target, 'MXCTACLI.DBF'))) {
            return target;
          }
        }
      }
    } catch (_) {}
  }

  return null;
}

/* ═══════════════ SELECCION INTELIGENTE DE LA TABLA MAS FRESCA ═══════════════ */
function selectBestProductTable(targetDir) {
  var candidateFiles = [
    'MXCTAINV.DBF', 'mxctainv.dbf',
    'VICTAINV.DBF', 'victainv.dbf',
    'CTAEVA.DBF',   'ctaeva.dbf',
    'JJCTAINV.DBF', 'jjctainv.dbf',
    'CTAINV.DBF',   'ctainv.dbf'
  ];

  var found = [];
  var seen = {};

  for (var i = 0; i < candidateFiles.length; i++) {
    var fname = candidateFiles[i];
    var fpath = path.join(targetDir, fname);
    var upper = fname.toUpperCase();
    if (!seen[upper] && fs.existsSync(fpath)) {
      seen[upper] = true;
      var struct = readDbfStructure(fpath);
      if (struct && struct.numRecords > 10) {
        found.push(struct);
      }
    }
  }

  if (found.length === 0) return null;

  // Analizar fecha_mod de los registros en cada tabla para saber cual tiene los precios de hoy
  var scored = found.map(function(tStruct) {
    var sampleRows = readDbfRows(tStruct, 200);
    var maxFechaMod = '00000000';
    var countWithPrice = 0;

    sampleRows.forEach(function(r) {
      var fMod = String(r.fecha_mod || '').trim();
      if (fMod && fMod > maxFechaMod) maxFechaMod = fMod;
      var p = parseFloat(r.precio_a || r.p1 || 0);
      if (p > 0) countWithPrice++;
    });

    var mtimeStr = tStruct.mtime ? tStruct.mtime.toISOString().substring(0, 10).replace(/-/g, '') : '00000000';
    var scoreDate = maxFechaMod > mtimeStr ? maxFechaMod : mtimeStr;

    return {
      struct: tStruct,
      maxFechaMod: scoreDate,
      countWithPrice: countWithPrice,
      numRecords: tStruct.numRecords,
      sampleRows: sampleRows
    };
  });

  // Ordenar: fecha mas reciente primero, luego por cantidad de registros
  scored.sort(function(a, b) {
    if (a.maxFechaMod !== b.maxFechaMod) {
      return a.maxFechaMod > b.maxFechaMod ? -1 : 1;
    }
    return b.numRecords - a.numRecords;
  });

  return scored;
}

/* ═══════════════ CSV HELPERS ═══════════════ */
function escCSV(v) {
  if (v === null || v === undefined) v = '';
  v = String(v).trim().replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  if (/[",;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function saveFiles(prefix, csvContent, jsonPayload) {
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
        var csvPath = path.join(tDir, prefix + '_' + stamp + '.csv');
        fs.writeFileSync(csvPath, BOM + csvContent, 'utf8');
        savedFiles.push(csvPath);
      }
      if (jsonPayload) {
        var jsonPath = path.join(tDir, prefix + '_' + stamp + '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');
        savedFiles.push(jsonPath);
      }
    } catch (e) {
      logWarn('No se pudo guardar en ' + tDir + ': ' + e.message);
    }
  }

  return savedFiles;
}

/* ═══════════════ FLUJO PRINCIPAL AUTOMATIZADO ═══════════════ */
function run() {
  banner('JJ PAPER -- EXTRACTOR CONSCIENTE Y AUTOMATICO MIXNET v4.2');

  log('Paso 1: Localizando servidor de MixNet...');
  var mixDir = findMixNetDirectory();

  if (!mixDir) {
    logErr('No se pudo encontrar la carpeta de MixNet.');
    say('');
    say('  Por favor verifica que la unidad M:\\ este montada en esta PC.');
    say('  (En "Mi PC" o "Equipo" debe verse la unidad M: conectada al servidor 192.168.0.185).');
    say('');
    return;
  }

  logOK('Servidor MixNet localizado en: ' + mixDir);

  // Paso 2: Evaluar tablas de productos y elegir la mas fresca
  log('Paso 2: Evaluando tablas para certificar PRECIOS REALES...');
  var tableScores = selectBestProductTable(mixDir);

  if (!tableScores || tableScores.length === 0) {
    logErr('No se encontraron tablas de inventario en ' + mixDir);
    return;
  }

  say('');
  say('  TABLAS ENCONTRADAS Y FECHAS DE ACTUALIZACION:');
  say('  ----------------------------------------------------------------------');
  for (var i = 0; i < tableScores.length; i++) {
    var tsItem = tableScores[i];
    var isBest = i === 0;
    var tag = isBest ? ' [RECOMENDADA - PRECIOS MAS RECIENTES]' : ' [Posible respaldo viejo]';
    say('    ' + (i + 1) + '. ' + tsItem.struct.fileName + ' -> ' + tsItem.numRecords + ' items | Modificado: ' + tsItem.maxFechaMod + tag);
  }
  say('  ----------------------------------------------------------------------');

  var chosen = tableScores[0];
  logOK('Seleccionada automaticamente: ' + chosen.struct.fileName);

  // Mostrar muestra de 3 articulos en vivo
  say('');
  say('  MUESTRA DE PRECIOS DETECTADOS EN ' + chosen.struct.fileName + ':');
  var sample = chosen.sampleRows.filter(function(r) {
    var p = parseFloat(r.precio_a || r.p1 || 0);
    return p > 0;
  }).slice(0, 3);

  sample.forEach(function(r) {
    var cod = String(r.codart || r.codigo || '').trim();
    var nom = String(r.nomart || r.descrip || '').trim();
    var pUSD = parseFloat(r.precio_a || r.p1 || 0) || 0;
    var pBs = parseFloat(r.precio_c || r.p3 || 0) || 0;
    var cost = parseFloat(r.costo_act || r.ult_costo || 0) || 0;
    var stk = parseFloat(r.existe_act || r.stock || 0) || 0;
    var fMod = String(r.fecha_mod || '').trim();
    say('    * [' + cod + '] ' + nom);
    say('      USD: $' + pUSD.toFixed(2) + ' | Bs: ' + pBs.toFixed(2) + ' | Costo: $' + cost.toFixed(2) + ' | Stock: ' + stk + (fMod ? ' | Fecha: ' + fMod : ''));
  });
  say('');

  // Paso 3: Extraccion completa de inventario
  log('Paso 3: Extrayendo catalogo completo de productos...');
  var rawProducts = readDbfRows(chosen.struct, 500000);
  logOK('Total articulos leidos: ' + rawProducts.length);

  var fn = chosen.struct.fieldNames;
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
  var fFMod  = findField(fn, ['fecha_mod', 'fec_mod', 'fechamod']);

  var productosMap = new Map();
  for (var pi = 0; pi < rawProducts.length; pi++) {
    var rp = rawProducts[pi];
    var cod = String(rp[fCode] || '').trim().toUpperCase();
    if (!cod) continue;

    var nom = String(rp[fName] || '').trim();
    if (!nom) nom = '(SIN NOMBRE)';

    var p1 = parseFloat(rp[fP1] || 0) || 0;
    var p2 = parseFloat(rp[fP2] || 0) || 0;
    var p3 = parseFloat(rp[fP3] || 0) || 0;
    var p4 = parseFloat(rp[fP4] || 0) || 0;
    var cost = parseFloat(rp[fCost] || 0) || 0;
    var stock = parseFloat(rp[fStock] || 0) || 0;
    if (stock < 0) stock = 0;

    // Solo articulos con precio, stock o costo
    if (p1 <= 0 && stock <= 0 && cost <= 0) continue;

    var prodObj = {
      codigo: cod,
      nombre: nom,
      precio_usd: p1,
      precio_2: p2,
      precio_bs: p3,
      precio_4: p4,
      costo: cost,
      stock: stock,
      grupo: String(rp[fGroup] || '').trim(),
      marca: String(rp[fBrand] || '').trim(),
      unidad: String(rp[fUnit] || '').trim(),
      iva: String(rp[fIva] || '').trim(),
      proveedor: String(rp[fProv] || '').trim(),
      fecha_mod: String(rp[fFMod] || '').trim()
    };

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

  var pCsvHeaders = 'CODIGO,PRODUCTO,PRECIO_USD,PRECIO_2,PRECIO_BS,COSTO_USD,STOCK,GRUPO,MARCA,UNIDAD,PROVEEDOR,FECHA_MOD';
  var pCsvRows = [pCsvHeaders];
  productosFinales.forEach(function(p) {
    pCsvRows.push([
      escCSV(p.codigo), escCSV(p.nombre), p.precio_usd.toFixed(2), p.precio_2.toFixed(2),
      p.precio_bs.toFixed(2), p.costo.toFixed(2), p.stock.toString(),
      escCSV(p.grupo), escCSV(p.marca), escCSV(p.unidad), escCSV(p.proveedor),
      escCSV(p.fecha_mod)
    ].join(','));
  });

  // Paso 4: Extraccion de clientes con correos
  log('Paso 4: Extrayendo cartera de clientes con emails y telefonos...');
  var clientFile = path.join(mixDir, 'MXCTACLI.DBF');
  var clientesFinales = [];

  if (fs.existsSync(clientFile)) {
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

      // Buscar emails adicionales en M:\MXAGENDA.DBF si existe
      var agendaMap = {};
      var agendaFile = path.join(path.dirname(mixDir), 'MXAGENDA.DBF');
      if (fs.existsSync(agendaFile)) {
        try {
          var agStruct = readDbfStructure(agendaFile);
          if (agStruct) {
            var agRows = readDbfRows(agStruct, 20000);
            agRows.forEach(function(ar) {
              var m = String(ar.email || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
              var kCod = String(ar.codigo || ar.codcli || '').trim();
              if (m && kCod) agendaMap[kCod] = m[0].toLowerCase();
            });
          }
        } catch (_) {}
      }

      var EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      var clientesMap = new Map();

      for (var ci = 0; ci < rawClients.length; ci++) {
        var rc = rawClients[ci];
        var cCod = String(rc[fCliCod] || '').trim();
        var cNom = String(rc[fCliNom] || '').trim();
        if (!cCod && !cNom) continue;

        var rawRif = String(rc[fCliRif] || '').trim().toUpperCase().replace(/[\s.-]/g, '');
        var rifClean = rawRif;
        if (/^\d+$/.test(rawRif)) rifClean = 'V-' + rawRif;
        else if (/^[JVEGP]\d+$/.test(rawRif)) rifClean = rawRif.charAt(0) + '-' + rawRif.substring(1);

        var dirParts = [rc[fCliDir1], rc[fCliDir2], rc[fCliDir3], rc[fCliDir4]].filter(function(x) {
          return x && String(x).trim();
        }).map(function(x) { return String(x).trim(); });
        var direccion = dirParts.join(' ').trim();

        var t1 = String(rc[fCliTlf1] || '').trim();
        var t2 = String(rc[fCliTlf2] || '').trim();

        // Extraer email de campo o memo
        var rawEmail = String(rc[fCliEmail] || '').trim();
        var emMatch = rawEmail.match(EMAIL_REGEX);
        var email = emMatch ? emMatch[0].toLowerCase() : '';

        if (!email && rc.memo) {
          var memMatch = String(rc.memo).match(EMAIL_REGEX);
          if (memMatch) email = memMatch[0].toLowerCase();
        }

        // Buscar en agenda complementaria
        if (!email && agendaMap[cCod]) {
          email = agendaMap[cCod];
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
        if (!clientesMap.has(key)) clientesMap.set(key, cliObj);
      }

      clientesFinales = Array.from(clientesMap.values());
      logOK('Clientes procesados: ' + clientesFinales.length);
      var conMail = clientesFinales.filter(function(x) { return x.email; }).length;
      logOK('Clientes con email valido: ' + conMail);
    }
  }

  var cCsvRows = ['CODIGO,NOMBRE_EMPRESA,RIF,TELEFONO_1,TELEFONO_2,EMAIL,DIRECCION,VENDEDOR_COD,ZONA,SALDO'];
  clientesFinales.forEach(function(c) {
    cCsvRows.push([
      escCSV(c.codigo), escCSV(c.nombre), escCSV(c.rif), escCSV(c.telefono1),
      escCSV(c.telefono2), escCSV(c.email), escCSV(c.direccion),
      escCSV(c.vendedor_cod), escCSV(c.zona), c.saldo.toFixed(2)
    ].join(','));
  });

  // Paso 5: Guardar archivos
  log('Paso 5: Guardando archivos finales...');
  var prodCsvStr = pCsvRows.join('\r\n');
  var cliCsvStr  = cCsvRows.length > 1 ? cCsvRows.join('\r\n') : null;

  var supabasePayload = {
    exportado_el: new Date().toISOString(),
    fuente: mixDir,
    tabla_productos: chosen.struct.fileName,
    resumen: {
      total_productos: productosFinales.length,
      total_clientes: clientesFinales.length
    },
    productos: productosFinales,
    clientes: clientesFinales
  };

  var savedP = saveFiles('mixnet_productos_reales', prodCsvStr, null);
  var savedC = cliCsvStr ? saveFiles('mixnet_clientes_reales', cliCsvStr, null) : [];
  var savedJ = saveFiles('mixnet_payload_supabase', null, supabasePayload);

  say('');
  say('========================================================================');
  say('  ¡EXTRACCION EXITOSA Y COMPLETA!');
  say('========================================================================');
  say('  Archivos generados en tu Escritorio:');
  savedP.forEach(function(f) { say('    * PRODUCTOS : ' + f); });
  if (savedC.length > 0) {
    savedC.forEach(function(f) { say('    * CLIENTES  : ' + f); });
  }
  savedJ.forEach(function(f) { say('    * SUPABASE  : ' + f); });
  say('========================================================================');
  say('');
}

try {
  run();
} catch (e) {
  logErr('Error fatal: ' + (e.stack || e.message));
}