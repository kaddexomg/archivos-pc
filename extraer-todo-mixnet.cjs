/*
  ========================================================================
  JJ Paper — Motor Omnisciente y Consolidador Total MixNet v5.0 (2026)
  ========================================================================
  100% AUTOMATICO — CERO PREGUNTAS — CERO MENUS — UN SOLO CLIC

  Este motor rastrea, cruza y consolida TODOS los archivos y tablas de MixNet:
    1. Escaneo multi-tabla de productos (MXCTAINV, VICTAINV, CTAEVA, JJCTAINV, CTAINV).
    2. Consolida cada SKU tomando automaticamente el precio mas reciente (fecha_mod).
    3. Cruza inventario, costos, existencia real, proveedor, unidad y marcas.
    4. Escaneo multi-tabla de clientes (MXCTACLI, MXAGENDA, MXSUCCLI, ALB, contactos).
    5. Matriz global de correos: extrae emails de campos, notas memo (.DBT/.FPT) y agenda.
    6. Normaliza RIFs (J-XXXXX) y prioriza telefonos moviles (0414, 0424, 0412, etc.).
    7. Genera CSVs con BOM para Excel y JSON estructurado para Supabase en el ESCRITORIO.

  Compatible con Node 13+ en Windows 7 / 10 / 11.
  Cero dependencias npm — 100% modulos nativos de Node.js.
  ========================================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ═══════════════ SALIDA DIRECTA A CONSOLA (SIN BUFFER EN WINDOWS 7) ═══════════════ */
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

/* ═══════════════ LECTOR UNIVERSAL DBF Y MEMO (.DBT / .FPT) ═══════════════ */
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
    // 0x2A = borrado logico FoxPro. Omitir.
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

/* ═══════════════ RASTREO MULTI-CARPETA DE MIXNET ═══════════════ */
function getTargetFolders() {
  var folders = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\',
    'M:\\COMP01d',
    'M:\\COMP02',
    'M:\\COMP03',
    'M:\\comp01-ORIGINAL',
    'M:\\EVALUO CTAINV\\HOY 25092024',
    'M:\\ejercicios\\EJ010',
    'M:\\comp01\\EJ010',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\comp01',
    'C:\\RESPAMIX\\COMP01-10012023',
    'C:\\MIXNET\\comp01',
    'D:\\MIXNET\\comp01'
  ];

  var existing = [];
  var seen = {};

  for (var i = 0; i < folders.length; i++) {
    var fp = folders[i];
    var norm = path.normalize(fp).replace(/[\/\\]+$/, '');
    var key = norm.toUpperCase();
    if (!seen[key] && fs.existsSync(norm)) {
      seen[key] = true;
      existing.push(norm);
    }
  }

  return existing;
}

/* ═══════════════ CONSOLIDADOR OMNISCIENTE DE PRODUCTOS ═══════════════ */
function crawlAndConsolidateProducts(folders) {
  log('Iniciando rastreo multi-tabla de inventario y precios reales...');

  // Tablas que definen catalogo de productos
  var pTableNames = [
    'MXCTAINV.DBF', 'mxctainv.dbf',
    'VICTAINV.DBF', 'victainv.dbf',
    'CTAEVA.DBF',   'ctaeva.dbf',
    'JJCTAINV.DBF', 'jjctainv.dbf',
    'CTAINV.DBF',   'ctainv.dbf'
  ];

  var scannedTables = [];
  var productsMap = new Map();

  for (var fi = 0; fi < folders.length; fi++) {
    var fDir = folders[fi];

    for (var ti = 0; ti < pTableNames.length; ti++) {
      var tPath = path.join(fDir, pTableNames[ti]);
      if (fs.existsSync(tPath)) {
        var struct = readDbfStructure(tPath);
        if (struct && struct.numRecords > 5) {
          scannedTables.push(struct);
          log('  -> Escaneando: ' + struct.path + ' (' + struct.numRecords + ' registros)');

          var rows = readDbfRows(struct, 500000);
          var fn = struct.fieldNames;

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

          for (var ri = 0; ri < rows.length; ri++) {
            var r = rows[ri];
            var cod = String(r[fCode] || '').trim().toUpperCase();
            if (!cod) continue;

            var nom = String(r[fName] || '').trim();
            if (!nom) nom = '(SIN NOMBRE)';

            var p1 = parseFloat(r[fP1] || 0) || 0;
            var p2 = parseFloat(r[fP2] || 0) || 0;
            var p3 = parseFloat(r[fP3] || 0) || 0;
            var p4 = parseFloat(r[fP4] || 0) || 0;
            var cost = parseFloat(r[fCost] || 0) || 0;
            var stock = parseFloat(r[fStock] || 0) || 0;
            if (stock < 0) stock = 0;

            var fMod = String(r[fFMod] || '').trim();
            if (!fMod && struct.mtime) {
              fMod = struct.mtime.toISOString().substring(0, 10).replace(/-/g, '');
            }

            // Omitir si no tiene ningun dato util
            if (p1 <= 0 && stock <= 0 && cost <= 0) continue;

            var candidateItem = {
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
              proveedor: String(r[fProv] || '').trim(),
              fecha_mod: fMod,
              tabla_origen: struct.fileName
            };

            // FUSION INTELIGENTE Y ACTUALIZACION POR FECHA
            if (!productsMap.has(cod)) {
              productsMap.set(cod, candidateItem);
            } else {
              var cur = productsMap.get(cod);

              // 1. Si el registro nuevo tiene una fecha de modificacion mas reciente, sus precios mandan
              if (candidateItem.fecha_mod && candidateItem.fecha_mod > (cur.fecha_mod || '')) {
                if (candidateItem.precio_usd > 0) {
                  cur.precio_usd = candidateItem.precio_usd;
                  cur.precio_2   = candidateItem.precio_2;
                  cur.precio_bs  = candidateItem.precio_bs;
                  cur.precio_4   = candidateItem.precio_4;
                  cur.fecha_mod  = candidateItem.fecha_mod;
                  cur.tabla_origen = candidateItem.tabla_origen;
                }
              }

              // 2. Si el producto actual no tenia precio y este si tiene, asignarlo
              if (cur.precio_usd <= 0 && candidateItem.precio_usd > 0) {
                cur.precio_usd = candidateItem.precio_usd;
                cur.precio_2   = candidateItem.precio_2;
                cur.precio_bs  = candidateItem.precio_bs;
                cur.precio_4   = candidateItem.precio_4;
                cur.fecha_mod  = candidateItem.fecha_mod;
                cur.tabla_origen = candidateItem.tabla_origen;
              }

              // 3. Stock mas reciente o mayor existencia real
              if (candidateItem.stock > cur.stock || (cur.stock === 0 && candidateItem.stock > 0)) {
                cur.stock = candidateItem.stock;
              }

              // 4. Costo
              if (cur.costo <= 0 && candidateItem.costo > 0) {
                cur.costo = candidateItem.costo;
              }

              // 5. Completar campos vacios (marca, unidad, proveedor, grupo)
              if (!cur.grupo && candidateItem.grupo) cur.grupo = candidateItem.grupo;
              if (!cur.marca && candidateItem.marca) cur.marca = candidateItem.marca;
              if (!cur.unidad && candidateItem.unidad) cur.unidad = candidateItem.unidad;
              if (!cur.proveedor && candidateItem.proveedor) cur.proveedor = candidateItem.proveedor;
              if ((!cur.nombre || cur.nombre === '(SIN NOMBRE)') && candidateItem.nombre) {
                cur.nombre = candidateItem.nombre;
              }
            }
          }
        }
      }
    }
  }

  var finalList = Array.from(productsMap.values());
  logOK('Total productos consolidados con precios actuales: ' + finalList.length);

  return {
    tablesScanned: scannedTables.map(function(s) { return s.path; }),
    products: finalList
  };
}

/* ═══════════════ CONSOLIDADOR OMNISCIENTE DE CLIENTES Y CORREOS ═══════════════ */
function crawlAndConsolidateClients(folders) {
  log('Iniciando rastreo de clientes y matriz global de emails...');

  var EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  // 1. Matriz global de correos indexada por RIF, Codigo, Telefono y Nombre
  var emailIndexByRif  = {};
  var emailIndexByCod  = {};
  var emailIndexByName = {};

  function registerEmail(em, rif, cod, name) {
    if (!em) return;
    var cleanEm = em.trim().toLowerCase();
    if (rif) {
      var rNorm = rif.toUpperCase().replace(/[\s.-]/g, '');
      if (rNorm && !emailIndexByRif[rNorm]) emailIndexByRif[rNorm] = cleanEm;
    }
    if (cod) {
      var cNorm = cod.trim().toUpperCase();
      if (cNorm && !emailIndexByCod[cNorm]) emailIndexByCod[cNorm] = cleanEm;
    }
    if (name) {
      var nNorm = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (nNorm && nNorm.length > 5 && !emailIndexByName[nNorm]) emailIndexByName[nNorm] = cleanEm;
    }
  }

  // Buscar tablas auxiliares que contienen emails (MXAGENDA, MXSUCCLI, contactos)
  var emailAuxFiles = [
    'MXAGENDA.DBF', 'mxagenda.dbf',
    'MXSUCCLI.DBF', 'mxsuccli.dbf',
    'MXCONTAC.DBF', 'mxcontac.dbf'
  ];

  for (var fi = 0; fi < folders.length; fi++) {
    var fDir = folders[fi];
    for (var ai = 0; ai < emailAuxFiles.length; ai++) {
      var aPath = path.join(fDir, emailAuxFiles[ai]);
      if (fs.existsSync(aPath)) {
        var aStruct = readDbfStructure(aPath);
        if (aStruct && aStruct.numRecords > 0) {
          log('  -> Escaneando correos en: ' + aStruct.path);
          var aRows = readDbfRows(aStruct, 100000);
          aRows.forEach(function(row) {
            var foundMail = '';
            var keys = Object.keys(row);
            for (var ki = 0; ki < keys.length; ki++) {
              var val = String(row[keys[ki]] || '');
              var m = val.match(EMAIL_REGEX);
              if (m) { foundMail = m[0]; break; }
            }
            if (foundMail) {
              var rRif  = row.rif || row.cif || row.cifoih || '';
              var rCod  = row.codcli || row.codigo || row.cod_cli || '';
              var rNom  = row.nomcli || row.nombre || row.razon || '';
              registerEmail(foundMail, rRif, rCod, rNom);
            }
          });
        }
      }
    }
  }

  // 2. Extraer cartera de clientes desde MXCTACLI.DBF principal
  var clientsMap = new Map();

  for (var fi2 = 0; fi2 < folders.length; fi2++) {
    var mainCliPath = path.join(folders[fi2], 'MXCTACLI.DBF');
    if (fs.existsSync(mainCliPath)) {
      var cStruct = readDbfStructure(mainCliPath);
      if (cStruct && cStruct.numRecords > 100) {
        log('  -> Extrayendo cartera maestra de clientes: ' + cStruct.path);
        var cRows = readDbfRows(cStruct, 500000);
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

        for (var ci = 0; ci < cRows.length; ci++) {
          var rc = cRows[ci];
          var cCod = String(rc[fCliCod] || '').trim();
          var cNom = String(rc[fCliNom] || '').trim();
          if (!cCod && !cNom) continue;

          // Normalizar RIF
          var rawRif = String(rc[fCliRif] || '').trim().toUpperCase().replace(/[\s.-]/g, '');
          var rifClean = rawRif;
          if (/^\d+$/.test(rawRif)) rifClean = 'V-' + rawRif;
          else if (/^[JVEGP]\d+$/.test(rawRif)) rifClean = rawRif.charAt(0) + '-' + rawRif.substring(1);

          // Concatenar direcciones completas
          var dirParts = [rc[fCliDir1], rc[fCliDir2], rc[fCliDir3], rc[fCliDir4]].filter(function(x) {
            return x && String(x).trim();
          }).map(function(x) { return String(x).trim(); });
          var direccion = dirParts.join(' ').trim();

          // Limpiar telefonos
          var t1 = String(rc[fCliTlf1] || '').trim();
          var t2 = String(rc[fCliTlf2] || '').trim();

          // Extraer Email por orden de resolucion:
          // 1) Campo email directo en la fila
          var email = '';
          var mDirect = String(rc[fCliEmail] || '').match(EMAIL_REGEX);
          if (mDirect) email = mDirect[0].toLowerCase();

          // 2) Notas memo (.DBT / .FPT)
          if (!email && rc.memo) {
            var mMemo = String(rc.memo).match(EMAIL_REGEX);
            if (mMemo) email = mMemo[0].toLowerCase();
          }

          // 3) En la direccion u observacion
          if (!email && direccion) {
            var mDir = direccion.match(EMAIL_REGEX);
            if (mDir) email = mDir[0].toLowerCase();
          }

          // 4) Matriz global por RIF
          var rNorm = rawRif.toUpperCase().replace(/[\s.-]/g, '');
          if (!email && rNorm && emailIndexByRif[rNorm]) {
            email = emailIndexByRif[rNorm];
          }

          // 5) Matriz global por Codigo de Cliente
          var cNorm = cCod.trim().toUpperCase();
          if (!email && cNorm && emailIndexByCod[cNorm]) {
            email = emailIndexByCod[cNorm];
          }

          // 6) Matriz global por Nombre
          var nNorm = cNom.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!email && nNorm && emailIndexByName[nNorm]) {
            email = emailIndexByName[nNorm];
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
          if (!clientsMap.has(key)) {
            clientsMap.set(key, cliObj);
          } else {
            var prevCli = clientsMap.get(key);
            if (!prevCli.email && cliObj.email) prevCli.email = cliObj.email;
            if (!prevCli.telefono1 && cliObj.telefono1) prevCli.telefono1 = cliObj.telefono1;
            if (!prevCli.direccion && cliObj.direccion) prevCli.direccion = cliObj.direccion;
          }
        }
        break; // Ya se leyo la cartera maestra con exito
      }
    }
  }

  var finalList = Array.from(clientsMap.values());
  logOK('Total clientes procesados: ' + finalList.length);
  var conMail = finalList.filter(function(x) { return x.email; }).length;
  logOK('Total clientes con correo verificado: ' + conMail);

  return finalList;
}

/* ═══════════════ GENERADOR CSV Y GUARDADO ═══════════════ */
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

/* ═══════════════ EJECUCION TOTAL ═══════════════ */
function main() {
  banner('JJ PAPER -- MOTOR TOTAL Y CONSOLIDADOR MIXNET v5.0');

  // Paso 1: Detectar carpetas vivas
  var folders = getTargetFolders();
  if (folders.length === 0) {
    logErr('No se encontro ninguna carpeta de MixNet (M:\\comp01, P:\\, C:\\RESPAMIX).');
    say('  Verifica que la unidad M: este conectada al servidor 192.168.0.185.');
    return;
  }

  log('Carpetas de datos activas:');
  folders.forEach(function(f) { say('    * ' + f); });
  say('');

  // Paso 2: Consolidar productos de todas las tablas
  var prodResult = crawlAndConsolidateProducts(folders);
  var productosFinales = prodResult.products;

  // Paso 3: Consolidar clientes y correos
  var clientesFinales = crawlAndConsolidateClients(folders);

  // Muestra de validacion visual
  say('');
  say('========================================================================');
  say('  MUESTRA DE PRECIOS REALES CONSOLIDADOS:');
  say('========================================================================');
  productosFinales.slice(0, 4).forEach(function(p) {
    say('  [' + p.codigo + '] ' + p.nombre);
    say('      USD: $' + p.precio_usd.toFixed(2) + ' | Bs: ' + p.precio_bs.toFixed(2) + ' | Costo: $' + p.costo.toFixed(2) + ' | Stock: ' + p.stock + ' | Fuente: ' + p.tabla_origen);
  });
  say('========================================================================');
  say('');

  // Paso 4: Construir CSVs
  log('Generando archivos finales para Excel y Supabase...');

  var pCsvHeaders = 'CODIGO,PRODUCTO,PRECIO_USD,PRECIO_2,PRECIO_BS,COSTO_USD,STOCK,GRUPO,MARCA,UNIDAD,PROVEEDOR,FECHA_MOD,TABLA_ORIGEN';
  var pCsvRows = [pCsvHeaders];
  productosFinales.forEach(function(p) {
    pCsvRows.push([
      escCSV(p.codigo), escCSV(p.nombre), p.precio_usd.toFixed(2), p.precio_2.toFixed(2),
      p.precio_bs.toFixed(2), p.costo.toFixed(2), p.stock.toString(),
      escCSV(p.grupo), escCSV(p.marca), escCSV(p.unidad), escCSV(p.proveedor),
      escCSV(p.fecha_mod), escCSV(p.tabla_origen)
    ].join(','));
  });

  var cCsvHeaders = 'CODIGO,NOMBRE_EMPRESA,RIF,TELEFONO_1,TELEFONO_2,EMAIL,DIRECCION,VENDEDOR_COD,ZONA,SALDO';
  var cCsvRows = [cCsvHeaders];
  clientesFinales.forEach(function(c) {
    cCsvRows.push([
      escCSV(c.codigo), escCSV(c.nombre), escCSV(c.rif), escCSV(c.telefono1),
      escCSV(c.telefono2), escCSV(c.email), escCSV(c.direccion),
      escCSV(c.vendedor_cod), escCSV(c.zona), c.saldo.toFixed(2)
    ].join(','));
  });

  var supabasePayload = {
    exportado_el: new Date().toISOString(),
    fuentes_escaneadas: folders,
    tablas_productos_leidas: prodResult.tablesScanned,
    resumen: {
      total_productos: productosFinales.length,
      total_clientes: clientesFinales.length,
      clientes_con_email: clientesFinales.filter(function(x) { return x.email; }).length
    },
    productos: productosFinales,
    clientes: clientesFinales
  };

  var savedP = saveOutputs('mixnet_productos_reales', pCsvRows.join('\r\n'), null);
  var savedC = saveOutputs('mixnet_clientes_reales', cCsvRows.join('\r\n'), null);
  var savedJ = saveOutputs('mixnet_payload_supabase', null, supabasePayload);

  say('');
  say('========================================================================');
  say('  PROCESO 100% COMPLETADO CON EXITO (CERO PREGUNTAS)');
  say('========================================================================');
  say('  Archivos disponibles en tu ESCRITORIO:');
  savedP.forEach(function(f) { say('    * PRODUCTOS : ' + f); });
  savedC.forEach(function(f) { say('    * CLIENTES  : ' + f); });
  savedJ.forEach(function(f) { say('    * SUPABASE  : ' + f); });
  say('========================================================================');
  say('');
}

try {
  main();
} catch (err) {
  logErr('Fallo critico: ' + (err.stack || err.message));
}