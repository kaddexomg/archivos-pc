/*
  ========================================================================
  JJ PAPER -- MOTOR DE DATOS MIXNET & LOCALIZADOR UNIVERSAL v6.2
  ========================================================================
  - Deteccion AUTOMATICA y DINAMICA de unidades (C:, D:, M:, P:, etc.).
  - Localizador Profundo de Instalaciones MixNet, Codigo Fuente (.PRG) y Datos.
  - Buscador recursivo de archivos con wildcards (*.prg, *.ini, *.dbf, etc.).
  - Cambio en caliente de carpeta activa de base de datos (switchDatabaseDirectory).
  - Horizonte dinamico de rotacion y vigencia (sin fechas fijas cableadas).
  - 100% compatible con Node 13 / Windows 7 - Cero dependencias npm externas.
*/
'use strict';

var fs   = require('fs');
var path = require('path');

/* ═══════════════ DECODIFICADOR CP1252 ═══════════════ */
var CP1252 = {
  0x80:'\u20AC', 0x82:'\u201A', 0x83:'\u0192', 0x84:'\u201E', 0x85:'\u2026',
  0x86:'\u2020', 0x87:'\u2021', 0x88:'\u02C6', 0x89:'\u2030', 0x8A:'\u0160',
  0x8B:'\u2039', 0x8C:'\u0152', 0x8E:'\u017D', 0x91:'\u2018', 0x92:'\u2019',
  0x93:'\u201C', 0x94:'\u201D', 0x95:'\u2022', 0x96:'\u2013', 0x97:'\u2014',
  0x98:'\u02DC', 0x99:'\u2122', 0x9A:'\u0161', 0x9B:'\u203A', 0x9C:'\u0153',
  0x9E:'\u017E', 0x9F:'\u0178'
};

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var b = buf[i];
    if (b === 0) break;
    if (b < 128 || b >= 0xA0) s += String.fromCharCode(b);
    else s += CP1252[b] || '';
  }
  return s.trim();
}

/* ═══════════════ LECTOR DBF Y MEMO ═══════════════ */
function readDbfStructure(filePath) {
  try {
    var fd = fs.openSync(filePath, 'r');
    var headerBuf = Buffer.alloc(32);
    fs.readSync(fd, headerBuf, 0, 32, 0);

    var numRecords = headerBuf.readUInt32LE(4);
    var headerLen  = headerBuf.readUInt16LE(8);
    var recordLen  = headerBuf.readUInt16LE(10);

    var fieldDescLen = headerLen - 32;
    var fieldBuf = Buffer.alloc(fieldDescLen);
    fs.readSync(fd, fieldBuf, 0, fieldDescLen, 32);
    fs.closeSync(fd);

    var fields = [];
    var fieldNames = [];
    var off = 0;
    while (off + 32 <= fieldDescLen && fieldBuf[off] !== 0x0D) {
      var rawName = '';
      for (var i = 0; i < 11; i++) {
        var c = fieldBuf[off + i];
        if (c === 0) break;
        rawName += String.fromCharCode(c);
      }
      var clean = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      var type = String.fromCharCode(fieldBuf[off + 11]);
      var flen = fieldBuf[off + 16];
      if (flen === 0) flen = fieldBuf.readUInt16LE(off + 16);

      if (clean.length > 0) {
        fields.push({ name: clean, type: type, len: flen });
        fieldNames.push(clean);
      }
      off += 32;
    }

    var baseWithoutExt = filePath.replace(/\.[^.]+$/, '');
    var memoPath = null;
    if (fs.existsSync(baseWithoutExt + '.fpt')) memoPath = baseWithoutExt + '.fpt';
    else if (fs.existsSync(baseWithoutExt + '.FPT')) memoPath = baseWithoutExt + '.FPT';
    else if (fs.existsSync(baseWithoutExt + '.dbt')) memoPath = baseWithoutExt + '.dbt';
    else if (fs.existsSync(baseWithoutExt + '.DBT')) memoPath = baseWithoutExt + '.DBT';

    return {
      path: filePath,
      fileName: path.basename(filePath).toUpperCase(),
      numRecords: numRecords,
      headerLen: headerLen,
      recordLen: recordLen,
      fields: fields,
      fieldNames: fieldNames,
      memoPath: memoPath
    };
  } catch (_) {
    return null;
  }
}

function readDbfRows(struct, maxLimit) {
  var limit = maxLimit || 500000;
  var buf;
  try { buf = fs.readFileSync(struct.path); } catch (_) { return []; }

  var rows = [];
  var pos = struct.headerLen;
  var maxDataEnd = Math.min(
    struct.headerLen + (struct.numRecords * struct.recordLen),
    buf.length
  );

  while (pos + struct.recordLen <= maxDataEnd && rows.length < limit) {
    var flag = buf[pos];
    // 0x2A = borrado en FoxPro. Omitir.
    if (flag !== 0x2A && flag === 0x20) {
      var row = {};
      var fOff = 1;
      for (var fi = 0; fi < struct.fields.length; fi++) {
        var f = struct.fields[fi];
        var val = decodeStr(buf, pos + fOff, f.len);
        row[f.name] = val;
        fOff += f.len;
      }
      rows.push(row);
    }
    pos += struct.recordLen;
  }

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

/* ═══════════════ DETECCION DE UNIDADES DEL SISTEMA ═══════════════ */
function getAvailableDrives() {
  var candidates = ['C', 'D', 'E', 'F', 'G', 'H', 'M', 'N', 'P', 'Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'O', 'L', 'K', 'J', 'I', 'B', 'A'];
  var found = [];
  for (var i = 0; i < candidates.length; i++) {
    var letter = candidates[i];
    var driveRoot = letter + ':\\';
    try {
      if (fs.existsSync(driveRoot)) {
        found.push(driveRoot);
      }
    } catch (_) {}
  }
  return found;
}

/* ═══════════════ LOCALIZADOR PROFUNDO DE MIXNET & CODIGO FUENTE ═══════════════ */
function findMixnetLocations() {
  var drives = getAvailableDrives();
  var locations = [];
  var visitedDirs = {};

  var probeFolders = [
    'comp01', 'COMP01', 'comp02',
    'MIXNET', 'mixnet', 'Mixnet',
    'MIX11', 'mix11', 'MIX',
    'RESPAMIX', 'respamix',
    'SISTEMAS', 'sistemas',
    'Archivos de programa\\MIXNET',
    'Archivos de programa\\Mixnet',
    'Archivos de programa (x86)\\MIXNET',
    'Archivos de programa (x86)\\Mixnet',
    'Program Files\\MIXNET',
    'Program Files\\Mixnet',
    'Program Files (x86)\\MIXNET',
    'Program Files (x86)\\Mixnet',
    'INSTALADORES', 'instaladores', 'Instaladores',
    'SETUP', 'setup', 'Instalacion', 'INSTALACION',
    'DLL-Pre', 'DLL-Pre\\DLL\\PRG', 'DLL\\PRG', 'PRG', 'prg',
    'ejercicios'
  ];

  function inspectCandidate(dirPath) {
    var norm = path.normalize(dirPath).toLowerCase();
    if (visitedDirs[norm]) return;
    visitedDirs[norm] = true;

    try {
      if (!fs.existsSync(dirPath)) return;
      var stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return;

      var files = fs.readdirSync(dirPath);
      var dbfCount = 0;
      var prgCount = 0;
      var iniCount = 0;
      var exeCount = 0;
      var hasInventoryTable = false;
      var hasClientTable = false;
      var hasSalesTable = false;
      var hasMixExe = false;
      var sampleFiles = [];

      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi];
        var fUp = f.toUpperCase();
        var fExt = path.extname(fUp);

        if (fExt === '.DBF') {
          dbfCount++;
          if (fUp === 'VICTAINV.DBF' || fUp === 'MXCTAINV.DBF' || fUp === 'CTAINV.DBF') hasInventoryTable = true;
          if (fUp === 'MXCTACLI.DBF' || fUp === 'CTACLI.DBF') hasClientTable = true;
          if (fUp === 'ALB.DBF' || fUp === 'MXRENFAC.DBF' || fUp === 'MXTRAINV.DBF' || fUp === 'YPENCFAC.DBF') hasSalesTable = true;
        } else if (fExt === '.PRG' || fExt === '.SPR' || fExt === '.MPR') {
          prgCount++;
        } else if (fExt === '.INI' || fExt === '.CFG') {
          iniCount++;
        } else if (fExt === '.EXE') {
          exeCount++;
          if (/mix/i.test(fUp)) hasMixExe = true;
        }

        if (sampleFiles.length < 8 && (fExt === '.PRG' || fExt === '.INI' || fExt === '.DBF' || fExt === '.EXE')) {
          sampleFiles.push(f);
        }
      }

      var role = null;
      if (hasInventoryTable || hasClientTable) {
        role = 'BASE_DATOS_VIVA';
      } else if (prgCount > 0) {
        role = 'CODIGO_FUENTE';
      } else if (hasMixExe) {
        role = 'PROGRAMA_EJECUTABLE';
      } else if (iniCount > 0 && dbfCount > 0) {
        role = 'CONFIG_Y_DATOS';
      } else if (dbfCount > 5) {
        role = 'TABLAS_AUXILIARES';
      }

      if (role) {
        locations.push({
          path: dirPath,
          role: role,
          hasInventory: hasInventoryTable,
          hasClients: hasClientTable,
          hasSales: hasSalesTable,
          dbfCount: dbfCount,
          prgCount: prgCount,
          iniCount: iniCount,
          exeCount: exeCount,
          sampleFiles: sampleFiles,
          mtime: stat.mtime
        });
      }
    } catch (_) {}
  }

  // 1. Probar carpetas conocidas en cada unidad
  for (var di = 0; di < drives.length; di++) {
    var drv = drives[di];
    inspectCandidate(drv);

    for (var pi = 0; pi < probeFolders.length; pi++) {
      var candidate = path.join(drv, probeFolders[pi]);
      inspectCandidate(candidate);
    }
  }

  // 2. Busqueda superficial (nivel 1 y 2) en unidades detectadas
  for (var di2 = 0; di2 < drives.length; di2++) {
    var drv2 = drives[di2];
    try {
      var rootEntries = fs.readdirSync(drv2);
      for (var rei = 0; rei < rootEntries.length; rei++) {
        var entry = rootEntries[rei];
        if (/^(mix|comp|resp|sist|vfp|fox|inst|set)/i.test(entry)) {
          var entryPath = path.join(drv2, entry);
          inspectCandidate(entryPath);
          try {
            var subList = fs.readdirSync(entryPath);
            for (var sli = 0; sli < subList.length; sli++) {
              var subName = subList[sli];
              if (/^(comp|prg|dll|ejerc|datos|data)/i.test(subName)) {
                inspectCandidate(path.join(entryPath, subName));
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // Ordenar: primero bases de datos vivas, luego código fuente
  locations.sort(function(a, b) {
    if (a.role === 'BASE_DATOS_VIVA' && b.role !== 'BASE_DATOS_VIVA') return -1;
    if (b.role === 'BASE_DATOS_VIVA' && a.role !== 'BASE_DATOS_VIVA') return 1;
    if (a.role === 'CODIGO_FUENTE' && b.role !== 'CODIGO_FUENTE') return -1;
    if (b.role === 'CODIGO_FUENTE' && a.role !== 'CODIGO_FUENTE') return 1;
    return b.mtime - a.mtime;
  });

  return locations;
}

/* ═══════════════ SELECCION DE EMPRESA VIVA ═══════════════ */
function locateLiveStoreCompany() {
  var candidateDirs = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\',
    'C:\\comp01',
    'C:\\COMP01',
    'C:\\MIXNET\\comp01',
    'C:\\Archivos de programa\\MIXNET\\comp01',
    'C:\\Program Files\\MIXNET\\comp01',
    'C:\\Program Files (x86)\\MIXNET\\comp01',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'D:\\MIXNET\\comp01'
  ];

  var bestDir = null;
  var latestTxDate = null;
  var txFiles = ['MXTRAINV.DBF', 'MXTRACOB.DBF', 'MXRENFAC.DBF', 'YPENCFAC.DBF', 'VICTAINV.DBF', 'MXCTACLI.DBF'];

  for (var i = 0; i < candidateDirs.length; i++) {
    var d = candidateDirs[i];
    try {
      if (fs.existsSync(d)) {
        for (var ti = 0; ti < txFiles.length; ti++) {
          var fp = path.join(d, txFiles[ti]);
          if (fs.existsSync(fp)) {
            var st = fs.statSync(fp);
            if (!latestTxDate || st.mtime > latestTxDate) {
              latestTxDate = st.mtime;
              bestDir = d;
            }
          }
        }
      }
    } catch (_) {}
  }

  if (!bestDir) {
    var detected = findMixnetLocations();
    for (var k = 0; k < detected.length; k++) {
      if (detected[k].role === 'BASE_DATOS_VIVA' || detected[k].hasInventory) {
        bestDir = detected[k].path;
        latestTxDate = detected[k].mtime;
        break;
      }
    }
  }

  return { dir: bestDir, lastTx: latestTxDate };
}

/* ═══════════════ AYUDANTES DE FECHAS DINAMICAS ═══════════════ */
function parseFoxDate(str) {
  if (!str || str.length < 8) return null;
  var y = parseInt(str.substring(0, 4), 10);
  var m = parseInt(str.substring(4, 6), 10) - 1;
  var d = parseInt(str.substring(6, 8), 10);
  if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1990 || y > 2050) return null;
  return new Date(y, m, d);
}

function fmtDate(s) {
  if (!s || s.length < 8) return '';
  return s.substring(0, 4) + '-' + s.substring(4, 6) + '-' + s.substring(6, 8);
}

/* ═══════════════ CACHE Y BASE DE DATOS EN MEMORIA ═══════════════ */
var databaseState = {
  initialized: false,
  lastScan: null,
  liveDir: null,
  maxSystemDate: '',
  maxSystemDateFmt: '',
  products: [],
  productsByCode: {},
  clients: [],
  clientsByCode: {},
  clientsByRif: {},
  recentSales: [],
  detectedLocations: [],
  availableDrives: [],
  summary: {}
};

// Escaneo y carga DINAMICA de productos
function loadProducts(liveDir) {
  if (!liveDir) return { list: [], byCode: {}, maxDate: '' };

  var targetTable = null;
  var candidateTables = ['VICTAINV.DBF', 'MXCTAINV.DBF', 'CTAINV.DBF'];
  for (var ci = 0; ci < candidateTables.length; ci++) {
    var p = path.join(liveDir, candidateTables[ci]);
    if (fs.existsSync(p)) { targetTable = p; break; }
  }
  if (!targetTable) return { list: [], byCode: {}, maxDate: '' };

  var struct = readDbfStructure(targetTable);
  if (!struct) return { list: [], byCode: {}, maxDate: '' };

  var rows = readDbfRows(struct, 500000);
  var fn = struct.fieldNames;

  var fCode   = findField(fn, ['codart', 'codigo', 'cod_art', 'id']);
  var fName   = findField(fn, ['nomart', 'nombre', 'descrip', 'articulo']);
  var fPA     = findField(fn, ['precio_a', 'p1', 'precio1']);
  var fPB     = findField(fn, ['precio_b', 'p2', 'precio2']);
  var fPC     = findField(fn, ['precio_c', 'p3', 'precio3']);
  var fCost   = findField(fn, ['costo_act', 'costo', 'ult_costo', 'cost_u']);
  var fStock  = findField(fn, ['existe_act', 'exist', 'stock', 'cantidad']);
  var fGroup  = findField(fn, ['grupo', 'familia', 'fam', 'cat']);
  var fBrand  = findField(fn, ['marca', 'mar']);
  var fUnit   = findField(fn, ['unidad', 'uni', 'medida']);
  var fProv   = findField(fn, ['ult_prove', 'proveedor', 'prov_asig']);
  var fStatus = findField(fn, ['estatus', 'status', 'inactivo']);
  var fFSal   = findField(fn, ['fecha_sal', 'fec_sal', 'fechasal']);
  var fFCos   = findField(fn, ['fecha_cos', 'fec_cos', 'fechacos']);
  var fFMod   = findField(fn, ['fecha_mod', 'fec_mod', 'fechamod']);
  var fFCrea  = findField(fn, ['fecha_crea', 'fec_crea', 'fechacrea']);

  var highestDate = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ds = [
      String(r[fFSal] || '').trim().replace(/[^0-9]/g, ''),
      String(r[fFMod] || '').trim().replace(/[^0-9]/g, ''),
      String(r[fFCos] || '').trim().replace(/[^0-9]/g, ''),
      String(r[fFCrea] || '').trim().replace(/[^0-9]/g, '')
    ];
    for (var di = 0; di < ds.length; di++) {
      var dStr = ds[di];
      if (dStr.length === 8 && dStr > highestDate && dStr < '20300000') {
        highestDate = dStr;
      }
    }
  }

  var maxDateObj = parseFoxDate(highestDate) || new Date();

  var list = [];
  var byCode = {};

  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri];
    var cod = String(row[fCode] || '').trim().toUpperCase();
    if (!cod) continue;

    var nom = String(row[fName] || '').trim();
    if (!nom) nom = '(SIN NOMBRE)';

    var stVal = String(row[fStatus] || '').trim();
    if (stVal === '1') continue;
    if (/^(\*{2,}|NO USAR|ELIMINADO|ANULADO|DESCONTINUADO|OBSOLETO|PRUEBA)/i.test(nom)) continue;

    var pB = parseFloat(String(row[fPB] || '0').replace(/,/g, '.')) || 0;
    var pA = parseFloat(String(row[fPA] || '0').replace(/,/g, '.')) || 0;
    var pC = parseFloat(String(row[fPC] || '0').replace(/,/g, '.')) || 0;
    var cost = parseFloat(String(row[fCost] || '0').replace(/,/g, '.')) || 0;
    var stock = parseFloat(String(row[fStock] || '0').replace(/,/g, '.')) || 0;

    var precioCliente = pB > 0 ? pB : pA;
    var precioMayor   = pA > 0 ? pA : pB;

    if (precioCliente <= 0) continue;

    var dSal  = String(row[fFSal] || '').trim().replace(/[^0-9]/g, '');
    var dMod  = String(row[fFMod] || '').trim().replace(/[^0-9]/g, '');
    var dCos  = String(row[fFCos] || '').trim().replace(/[^0-9]/g, '');
    var dCrea = String(row[fFCrea] || '').trim().replace(/[^0-9]/g, '');

    var lastActivity = '';
    if (dSal > lastActivity) lastActivity = dSal;
    if (dMod > lastActivity) lastActivity = dMod;
    if (dCos > lastActivity) lastActivity = dCos;
    if (dCrea > lastActivity && !lastActivity) lastActivity = dCrea;

    var lastDateObj = parseFoxDate(lastActivity);
    var daysSince = lastDateObj ? Math.round((maxDateObj - lastDateObj) / (1000 * 60 * 60 * 24)) : 9999;
    if (daysSince < 0) daysSince = 0;

    var hasStock = stock > 0;
    var isRecentActive = daysSince <= 365;

    if (!hasStock && !isRecentActive) continue;

    var estadoRotacion = 'STOCK_INMOVILIZADO';
    if (!hasStock) {
      estadoRotacion = 'AGOTADO_VIGENTE';
    } else if (daysSince <= 60) {
      estadoRotacion = 'ALTA_ROTACION';
    } else if (daysSince <= 180) {
      estadoRotacion = 'ROTACION_MEDIA';
    } else if (daysSince <= 365) {
      estadoRotacion = 'BAJA_ROTACION_FRIO';
    }

    var isRecentUpdate = (dMod && daysSince <= 45) || (dCrea && daysSince <= 45);
    var marginPct = (precioCliente > 0 && cost > 0) ? Math.round(((precioCliente - cost) / precioCliente) * 100) : 0;

    var prod = {
      codigo: cod,
      descripcion: nom,
      precio_cliente_usd: precioCliente,
      precio_mayor_usd: precioMayor,
      precio_bs: pC,
      stock_actual: stock > 0 ? stock : 0,
      estado_stock: hasStock ? 'EN_STOCK' : 'AGOTADO_VIGENTE',
      estado_rotacion: estadoRotacion,
      es_reciente_o_modificado: isRecentUpdate,
      costo_usd: cost,
      margen_porcentaje: marginPct,
      dias_sin_movimiento: daysSince,
      categoria: String(row[fGroup] || '').trim(),
      marca: String(row[fBrand] || '').trim(),
      empaque: String(row[fUnit] || '').trim(),
      proveedor: String(row[fProv] || '').trim(),
      ultimo_movimiento: lastActivity,
      ultimo_movimiento_fmt: fmtDate(lastActivity)
    };

    if (!byCode[cod]) {
      byCode[cod] = prod;
      list.push(prod);
    }
  }

  list.sort(function(a, b) { return a.descripcion.localeCompare(b.descripcion); });
  return { list: list, byCode: byCode, maxDate: highestDate };
}

// Escaneo y carga de clientes
function loadClients(liveDir) {
  if (!liveDir) return { list: [], byCode: {}, byRif: {} };

  var tPath = path.join(liveDir, 'MXCTACLI.DBF');
  if (!fs.existsSync(tPath)) tPath = path.join(liveDir, 'CTACLI.DBF');
  if (!fs.existsSync(tPath)) return { list: [], byCode: {}, byRif: {} };

  var struct = readDbfStructure(tPath);
  if (!struct) return { list: [], byCode: {}, byRif: {} };

  var rows = readDbfRows(struct, 500000);
  var fn = struct.fieldNames;

  var fCod  = findField(fn, ['codcli', 'codigo', 'cod_cli']);
  var fNom  = findField(fn, ['nomcli', 'nombre', 'razon']);
  var fRif  = findField(fn, ['cif', 'rif', 'nit']);
  var fDir1 = findField(fn, ['direc1', 'dir1', 'direccion']);
  var fDir2 = findField(fn, ['direc2', 'dir2']);
  var fTlf1 = findField(fn, ['tlf1', 'telefono1', 'tel1']);
  var fTlf2 = findField(fn, ['tlf2', 'telefono2', 'tel2']);
  var fFax  = findField(fn, ['fax', 'tlf3']);
  var fMail = findField(fn, ['email', 'correo', 'mail']);
  var fVen  = findField(fn, ['vendedor', 'codven']);
  var fSal  = findField(fn, ['saldo', 'deuda']);
  var fFecP = findField(fn, ['fec_upag', 'ult_pago']);

  var list = [];
  var byCode = {};
  var byRif = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cod = String(r[fCod] || '').trim().toUpperCase();
    var nom = String(r[fNom] || '').trim();
    if (!cod && !nom) continue;
    if (/^(\*{3,}|NO USAR|ELIMINADO|ANULADO)/i.test(nom)) continue;

    var rif = String(r[fRif] || '').trim().toUpperCase();
    var tlf1 = String(r[fTlf1] || '').trim();
    var tlf2 = String(r[fTlf2] || '').trim();
    var fax  = String(r[fFax] || '').trim();
    var allPhones = [tlf1, tlf2, fax].join(' ');

    var mobile = '';
    var landline = '';
    var mMatch = allPhones.match(/(04\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|4\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/);
    if (mMatch) {
      var rawM = mMatch[0].replace(/[^0-9]/g, '');
      if (rawM.length === 10 && rawM.indexOf('4') === 0) rawM = '0' + rawM;
      if (rawM.length === 11) mobile = rawM;
    }

    var fMatch = allPhones.match(/(02\d{2}[\s.-]?\d{7}|2\d{2}[\s.-]?\d{7}|\b\d{7}\b)/);
    if (fMatch) landline = fMatch[0].replace(/[^0-9]/g, '');

    var email = '';
    var rawMail = String(r[fMail] || '').trim();
    var emMatch = rawMail.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emMatch) email = emMatch[0].toLowerCase();

    var dir = [String(r[fDir1] || '').trim(), String(r[fDir2] || '').trim()].filter(Boolean).join(' ');
    var saldo = parseFloat(String(r[fSal] || '0').replace(/,/g, '.')) || 0;
    var ultPago = String(r[fFecP] || '').trim();

    var cli = {
      codigo: cod,
      razon_social: nom,
      rif: rif,
      telefono_movil_whatsapp: mobile,
      telefono_fijo: landline,
      email: email,
      direccion: dir,
      vendedor: String(r[fVen] || '').trim(),
      saldo: saldo,
      ultimo_pago: ultPago,
      ultimo_pago_fmt: fmtDate(ultPago)
    };

    byCode[cod] = cli;
    if (rif) byRif[rif] = cli;
    list.push(cli);
  }

  list.sort(function(a, b) { return a.razon_social.localeCompare(b.razon_social); });
  return { list: list, byCode: byCode, byRif: byRif };
}

// Escaneo de facturacion y despachos recientes
function loadRecentSales(liveDir) {
  if (!liveDir) return [];
  var sales = [];
  var parentDir = path.dirname(liveDir);

  var ejDirs = [];
  var searchDirs = [liveDir, parentDir, path.join(parentDir, 'ejercicios'), 'M:\\ejercicios', 'C:\\ejercicios'];
  for (var si = 0; si < searchDirs.length; si++) {
    var sDir = searchDirs[si];
    try {
      if (fs.existsSync(sDir)) {
        var subEntries = fs.readdirSync(sDir);
        for (var ei = 0; ei < subEntries.length; ei++) {
          if (/^EJ\d+/i.test(subEntries[ei])) {
            var fullEj = path.join(sDir, subEntries[ei]);
            if (ejDirs.indexOf(fullEj) === -1) ejDirs.push(fullEj);
          }
        }
      }
    } catch (_) {}
  }

  ejDirs.sort().reverse();
  if (ejDirs.indexOf(liveDir) === -1) ejDirs.unshift(liveDir);

  for (var di = 0; di < ejDirs.length; di++) {
    var ejDir = ejDirs[di];
    var albPath = path.join(ejDir, 'ALB.DBF');
    if (!fs.existsSync(albPath)) albPath = path.join(ejDir, 'ALB01.DBF');
    if (!fs.existsSync(albPath)) albPath = path.join(ejDir, 'MXRENFAC.DBF');

    if (fs.existsSync(albPath)) {
      var struct = readDbfStructure(albPath);
      if (struct && struct.numRecords > 0) {
        var rows = readDbfRows(struct, 5000);
        var fn = struct.fieldNames;
        var fDoc   = findField(fn, ['numalb', 'numfac', 'documento', 'num_doc']);
        var fFec   = findField(fn, ['emision', 'fecha', 'fec_doc', 'fec_emi']);
        var fCli   = findField(fn, ['cliente', 'codcli', 'cod_cli']);
        var fNom   = findField(fn, ['nomcli', 'nombre', 'nom_cli']);
        var fRif   = findField(fn, ['cif', 'rif']);
        var fTot   = findField(fn, ['tot_alb', 'total', 'monto', 'tot_fac']);
        var fVen   = findField(fn, ['codven', 'vendedor']);

        for (var ri = rows.length - 1; ri >= 0 && sales.length < 500; ri--) {
          var r = rows[ri];
          var doc = String(r[fDoc] || '').trim();
          var fec = String(r[fFec] || '').trim();
          var tot = parseFloat(String(r[fTot] || '0').replace(/,/g, '.')) || 0;
          if (tot > 0 || doc) {
            sales.push({
              documento: doc || ('VENTA-' + (rows.length - ri)),
              fecha: fec,
              fecha_fmt: fmtDate(fec),
              codigo_cliente: String(r[fCli] || '').trim(),
              cliente: String(r[fNom] || '').trim() || 'Cliente Mostrador',
              rif: String(r[fRif] || '').trim(),
              total_usd: tot,
              vendedor: String(r[fVen] || '').trim(),
              ejercicio: path.basename(ejDir)
            });
          }
        }
      }
    }
  }

  return sales;
}

/* ═══════════════ EXPLORADOR INTERACTIVO CON NAVEGACION REAL ═══════════════ */
function scanDirectory(basePath, filterExtensions, maxDepth) {
  var targetPath = basePath ? path.normalize(basePath) : 'C:\\';
  var targetExts = filterExtensions && filterExtensions.length > 0
    ? filterExtensions.map(function(e) { return e.toLowerCase(); })
    : null;

  var drives = getAvailableDrives();
  var parentDir = path.dirname(targetPath);
  if (parentDir === targetPath) parentDir = null;

  var folders = [];
  var files = [];
  var stats = { totalFolders: 0, totalFiles: 0, hasDbfs: 0, hasPrgs: 0, hasInis: 0 };

  try {
    if (!fs.existsSync(targetPath)) {
      return {
        success: false,
        error: 'El directorio no existe: ' + targetPath,
        currentPath: targetPath,
        parentPath: parentDir,
        drives: drives,
        folders: [],
        files: [],
        stats: stats
      };
    }

    var entries = fs.readdirSync(targetPath);
    for (var i = 0; i < entries.length; i++) {
      var entryName = entries[i];
      if (/^\./.test(entryName) || entryName === '$RECYCLE.BIN' || entryName === 'System Volume Information') continue;

      var fullPath = path.join(targetPath, entryName);
      try {
        var st = fs.statSync(fullPath);
        if (st.isDirectory()) {
          stats.totalFolders++;
          folders.push({
            name: entryName,
            path: fullPath,
            mtime: st.mtime
          });
        } else if (st.isFile()) {
          var ext = path.extname(entryName).toLowerCase().replace(/^\./, '');
          if (ext === 'dbf') stats.hasDbfs++;
          if (ext === 'prg' || ext === 'spr' || ext === 'mpr') stats.hasPrgs++;
          if (ext === 'ini' || ext === 'cfg') stats.hasInis++;

          if (!targetExts || targetExts.indexOf(ext) !== -1) {
            stats.totalFiles++;
            files.push({
              name: entryName,
              path: fullPath,
              ext: ext,
              sizeBytes: st.size,
              mtime: st.mtime
            });
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    return {
      success: false,
      error: 'Error de acceso al directorio: ' + err.message,
      currentPath: targetPath,
      parentPath: parentDir,
      drives: drives,
      folders: [],
      files: [],
      stats: stats
    };
  }

  folders.sort(function(a, b) { return a.name.localeCompare(b.name); });
  files.sort(function(a, b) { return a.name.localeCompare(b.name); });

  return {
    success: true,
    currentPath: targetPath,
    parentPath: parentDir,
    drives: drives,
    folders: folders,
    files: files,
    stats: stats
  };
}

/* ═══════════════ BUSCADOR RECURSIVO DE ARCHIVOS (PERSUADIR Y CONSEGUIR) ═══════════════ */
function searchFiles(basePath, queryPattern, maxDepth, maxResults) {
  var startDir = basePath ? path.normalize(basePath) : 'C:\\';
  var depthLimit = typeof maxDepth === 'number' ? maxDepth : 4;
  var limit = typeof maxResults === 'number' ? maxResults : 250;
  var q = (queryPattern || '').trim().toLowerCase();

  var regex = null;
  if (q) {
    var escaped = q.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    regex = new RegExp(escaped, 'i');
  }

  var results = [];

  function traverse(dir, currentDepth) {
    if (results.length >= limit || currentDepth > depthLimit) return;
    try {
      var list = fs.readdirSync(dir);
      for (var i = 0; i < list.length; i++) {
        if (results.length >= limit) break;
        var name = list[i];
        if (/^\./.test(name) || name === '$RECYCLE.BIN' || name === 'node_modules' || name === 'System Volume Information') continue;

        var fullPath = path.join(dir, name);
        try {
          var st = fs.statSync(fullPath);
          if (st.isDirectory()) {
            traverse(fullPath, currentDepth + 1);
          } else if (st.isFile()) {
            var match = !regex || regex.test(name);
            if (match) {
              results.push({
                name: name,
                path: fullPath,
                dir: dir,
                ext: path.extname(name).toLowerCase().replace(/^\./, ''),
                sizeBytes: st.size,
                mtime: st.mtime
              });
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  traverse(startDir, 0);

  return {
    query: queryPattern,
    startDir: startDir,
    totalFound: results.length,
    results: results
  };
}

/* ═══════════════ LECTOR DE CONTENIDO DE ARCHIVO ═══════════════ */
function readFileContent(targetPath, maxLines) {
  var limit = typeof maxLines === 'number' ? maxLines : 300;

  if (!fs.existsSync(targetPath)) {
    return { success: false, error: 'El archivo no existe: ' + targetPath };
  }

  var ext = path.extname(targetPath).toLowerCase();

  if (ext === '.dbf') {
    var struct = readDbfStructure(targetPath);
    if (!struct) return { success: false, error: 'No se pudo leer cabecera DBF' };
    var rows = readDbfRows(struct, limit);
    return {
      success: true,
      type: 'dbf',
      fileName: path.basename(targetPath),
      numRecords: struct.numRecords,
      fields: struct.fields,
      sampleRows: rows
    };
  }

  try {
    var rawBuf = fs.readFileSync(targetPath);
    var contentStr = decodeStr(rawBuf, 0, Math.min(rawBuf.length, 500000));
    var lines = contentStr.split(/\r?\n/);
    return {
      success: true,
      type: 'text',
      fileName: path.basename(targetPath),
      totalLines: lines.length,
      lines: lines.slice(0, limit),
      truncated: lines.length > limit
    };
  } catch (err) {
    return { success: false, error: 'Error leyendo archivo: ' + err.message };
  }
}

/* ═══════════════ CAMBIO DE DIRECTORIO ACTIVO EN CALIENTE ═══════════════ */
function switchDatabaseDirectory(targetDir) {
  if (!targetDir || !fs.existsSync(targetDir)) {
    return { success: false, error: 'El directorio especificado no existe: ' + targetDir };
  }

  databaseState.liveDir = targetDir;
  databaseState.lastScan = new Date();

  var pData = loadProducts(targetDir);
  databaseState.products = pData.list;
  databaseState.productsByCode = pData.byCode;
  databaseState.maxSystemDate = pData.maxDate;
  databaseState.maxSystemDateFmt = fmtDate(pData.maxDate);

  var cData = loadClients(targetDir);
  databaseState.clients = cData.list;
  databaseState.clientsByCode = cData.byCode;
  databaseState.clientsByRif = cData.byRif;

  databaseState.recentSales = loadRecentSales(targetDir);

  var enStock = databaseState.products.filter(function(p) { return p.stock_actual > 0; }).length;
  var agotados = databaseState.products.filter(function(p) { return p.stock_actual <= 0; }).length;
  var conCelular = databaseState.clients.filter(function(c) { return c.telefono_movil_whatsapp; }).length;
  var conEmail = databaseState.clients.filter(function(c) { return c.email; }).length;
  var novedades = databaseState.products.filter(function(p) { return p.es_reciente_o_modificado; }).length;

  databaseState.summary = {
    total_productos: databaseState.products.length,
    productos_en_stock: enStock,
    productos_agotados_vigentes: agotados,
    productos_modificados_recientes: novedades,
    fecha_maxima_sistema: databaseState.maxSystemDateFmt,
    total_clientes: databaseState.clients.length,
    clientes_con_whatsapp: conCelular,
    clientes_con_email: conEmail,
    ventas_recientes_registradas: databaseState.recentSales.length,
    servidor_fuente: targetDir,
    ultimo_escaneo: databaseState.lastScan.toISOString()
  };

  databaseState.initialized = (databaseState.products.length > 0 || databaseState.clients.length > 0);
  return { success: true, summary: databaseState.summary, initialized: databaseState.initialized };
}

/* ═══════════════ INICIALIZACION GENERAL DE LA BASE DE DATOS ═══════════════ */
function initializeDatabase() {
  databaseState.availableDrives = getAvailableDrives();
  databaseState.detectedLocations = findMixnetLocations();

  var live = locateLiveStoreCompany();

  if (live.dir) {
    return switchDatabaseDirectory(live.dir);
  }

  databaseState.initialized = false;
  databaseState.liveDir = null;
  databaseState.summary = {
    total_productos: 0,
    productos_en_stock: 0,
    productos_agotados_vigentes: 0,
    productos_modificados_recientes: 0,
    fecha_maxima_sistema: '',
    total_clientes: 0,
    clientes_con_whatsapp: 0,
    clientes_con_email: 0,
    ventas_recientes_registradas: 0,
    servidor_fuente: 'NO CONECTADO (Usa el localizador para conectar a MixNet)',
    ultimo_escaneo: new Date().toISOString()
  };

  return {
    success: false,
    error: 'No se detecto automaticamente la base de datos viva. Usa el localizador para conectar una carpeta.',
    detectedLocations: databaseState.detectedLocations,
    availableDrives: databaseState.availableDrives
  };
}

module.exports = {
  initializeDatabase: initializeDatabase,
  switchDatabaseDirectory: switchDatabaseDirectory,
  getState: function() { return databaseState; },
  getAvailableDrives: getAvailableDrives,
  findMixnetLocations: findMixnetLocations,
  scanDirectory: scanDirectory,
  searchFiles: searchFiles,
  readFileContent: readFileContent
};
