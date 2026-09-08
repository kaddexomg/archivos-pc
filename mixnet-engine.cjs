/*
  ========================================================================
  JJ PAPER -- MOTOR DE DATOS TRANSACCIONALES E HISTORICOS MIXNET
  ========================================================================
  Lee tablas maestras y transaccionales (VICTAINV, MXCTACLI, ALB, MXRENFAC, MXTRAINV).
  100% compatible con Node 13 (Windows 7) - Cero dependencias npm externas.
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

/* ═══════════════ LOCALIZACION DE EMPRESA VIVA ═══════════════ */
function locateLiveStoreCompany() {
  var candidateDirs = [
    'M:\\comp01',
    'M:\\COMP01',
    'M:\\',
    'P:\\comp01',
    'P:\\Elias\\MIX\\MIX11\\comp01',
    'C:\\RESPAMIX\\MIX11 (servidor)\\comp01',
    'C:\\MIXNET\\comp01',
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

  return { dir: bestDir, lastTx: latestTxDate };
}

/* ═══════════════ CACHE Y BASE DE DATOS EN MEMORIA ═══════════════ */
var databaseState = {
  initialized: false,
  lastScan: null,
  liveDir: null,
  products: [],
  productsByCode: {},
  clients: [],
  clientsByCode: {},
  clientsByRif: {},
  recentSales: [],
  summary: {}
};

function fmtDate(s) {
  if (!s || s.length < 8) return '';
  return s.substring(0, 4) + '-' + s.substring(4, 6) + '-' + s.substring(6, 8);
}

// Escaneo y carga de productos
function loadProducts(liveDir) {
  var targetTable = null;
  var candidateTables = ['VICTAINV.DBF', 'MXCTAINV.DBF', 'CTAINV.DBF'];
  for (var ci = 0; ci < candidateTables.length; ci++) {
    var p = path.join(liveDir, candidateTables[ci]);
    if (fs.existsSync(p)) { targetTable = p; break; }
  }
  if (!targetTable) return [];

  var struct = readDbfStructure(targetTable);
  if (!struct) return [];

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

  var list = [];
  var byCode = {};

  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    var cod = String(r[fCode] || '').trim().toUpperCase();
    if (!cod) continue;

    var nom = String(r[fName] || '').trim();
    if (!nom) nom = '(SIN NOMBRE)';

    // Filtros de estatus y marcas de borrado
    var stVal = String(r[fStatus] || '').trim();
    if (stVal === '1') continue;
    if (/^(\*{2,}|NO USAR|ELIMINADO|ANULADO|DESCONTINUADO|OBSOLETO|PRUEBA)/i.test(nom)) continue;

    var pB = parseFloat(String(r[fPB] || '0').replace(/,/g, '.')) || 0;
    var pA = parseFloat(String(r[fPA] || '0').replace(/,/g, '.')) || 0;
    var pC = parseFloat(String(r[fPC] || '0').replace(/,/g, '.')) || 0;
    var cost = parseFloat(String(r[fCost] || '0').replace(/,/g, '.')) || 0;
    var stock = parseFloat(String(r[fStock] || '0').replace(/,/g, '.')) || 0;

    var precioCliente = pB > 0 ? pB : pA;
    var precioMayor   = pA > 0 ? pA : pB;
    if (precioCliente <= 0) continue;

    var dSal  = String(r[fFSal] || '').trim().replace(/[^0-9]/g, '');
    var dMod  = String(r[fFMod] || '').trim().replace(/[^0-9]/g, '');
    var dCos  = String(r[fFCos] || '').trim().replace(/[^0-9]/g, '');

    var lastActivity = '';
    if (dSal > lastActivity) lastActivity = dSal;
    if (dMod > lastActivity) lastActivity = dMod;
    if (dCos > lastActivity) lastActivity = dCos;

    var hasStock = stock > 0;
    var hasRecent = (lastActivity && lastActivity >= '20240101');
    if (!hasStock && !hasRecent) continue;

    // Calcular margen bruto estimado %
    var marginPct = 0;
    if (precioCliente > 0 && cost > 0) {
      marginPct = Math.round(((precioCliente - cost) / precioCliente) * 100);
    }

    var prod = {
      codigo: cod,
      descripcion: nom,
      precio_cliente_usd: precioCliente,
      precio_mayor_usd: precioMayor,
      precio_bs: pC,
      stock_actual: stock > 0 ? stock : 0,
      estado_stock: hasStock ? 'EN_STOCK' : 'AGOTADO_VIGENTE',
      costo_usd: cost,
      margen_porcentaje: marginPct,
      categoria: String(r[fGroup] || '').trim(),
      marca: String(r[fBrand] || '').trim(),
      empaque: String(r[fUnit] || '').trim(),
      proveedor: String(r[fProv] || '').trim(),
      ultimo_movimiento: lastActivity,
      ultimo_movimiento_fmt: fmtDate(lastActivity)
    };

    if (!byCode[cod]) {
      byCode[cod] = prod;
      list.push(prod);
    }
  }

  list.sort(function(a, b) { return a.descripcion.localeCompare(b.descripcion); });
  return { list: list, byCode: byCode };
}

// Escaneo y carga de clientes
function loadClients(liveDir) {
  var tPath = path.join(liveDir, 'MXCTACLI.DBF');
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

// Escaneo de facturacion y despachos recientes (carpetas EJxxx / ALB / MXRENFAC)
function loadRecentSales(liveDir) {
  var sales = [];
  var parentDir = path.dirname(liveDir);

  // Buscar carpetas de ejercicios recientes (EJ007, EJ008, EJ010, EJ011)
  var ejDirs = [];
  var searchDirs = [liveDir, parentDir, 'M:\\ejercicios', 'M:\\comp01'];
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

  // Ordenar ejercicios descendentes (los mas nuevos primero)
  ejDirs.sort().reverse();

  for (var di = 0; di < ejDirs.length; di++) {
    var ejDir = ejDirs[di];
    var albPath = path.join(ejDir, 'ALB.DBF');
    if (!fs.existsSync(albPath)) albPath = path.join(ejDir, 'ALB01.DBF');

    if (fs.existsSync(albPath)) {
      var struct = readDbfStructure(albPath);
      if (struct && struct.numRecords > 0) {
        var rows = readDbfRows(struct, 5000); // ultimos registros
        var fn = struct.fieldNames;
        var fDoc   = findField(fn, ['numalb', 'numfac', 'documento']);
        var fFec   = findField(fn, ['emision', 'fecha']);
        var fCli   = findField(fn, ['cliente', 'codcli']);
        var fNom   = findField(fn, ['nomcli', 'nombre']);
        var fRif   = findField(fn, ['cif', 'rif']);
        var fTot   = findField(fn, ['tot_alb', 'total', 'monto']);
        var fVen   = findField(fn, ['codven', 'vendedor']);

        for (var ri = rows.length - 1; ri >= 0 && sales.length < 500; ri--) {
          var r = rows[ri];
          var doc = String(r[fDoc] || '').trim();
          var fec = String(r[fFec] || '').trim();
          var tot = parseFloat(String(r[fTot] || '0').replace(/,/g, '.')) || 0;
          if (tot > 0) {
            sales.push({
              documento: doc,
              fecha: fec,
              fecha_fmt: fmtDate(fec),
              codigo_cliente: String(r[fCli] || '').trim(),
              cliente: String(r[fNom] || '').trim(),
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

// Inicializar y refrescar base de datos completa
function initializeDatabase() {
  var live = locateLiveStoreCompany();
  if (!live.dir) {
    return { success: false, error: 'No se encontro la unidad de red M:\\comp01' };
  }

  databaseState.liveDir = live.dir;
  databaseState.lastScan = new Date();

  var pData = loadProducts(live.dir);
  databaseState.products = pData.list;
  databaseState.productsByCode = pData.byCode;

  var cData = loadClients(live.dir);
  databaseState.clients = cData.list;
  databaseState.clientsByCode = cData.byCode;
  databaseState.clientsByRif = cData.byRif;

  databaseState.recentSales = loadRecentSales(live.dir);

  var enStock = databaseState.products.filter(function(p) { return p.stock_actual > 0; }).length;
  var agotados = databaseState.products.filter(function(p) { return p.stock_actual <= 0; }).length;
  var conCelular = databaseState.clients.filter(function(c) { return c.telefono_movil_whatsapp; }).length;
  var conEmail = databaseState.clients.filter(function(c) { return c.email; }).length;

  databaseState.summary = {
    total_productos: databaseState.products.length,
    productos_en_stock: enStock,
    productos_agotados_vigentes: agotados,
    total_clientes: databaseState.clients.length,
    clientes_con_whatsapp: conCelular,
    clientes_con_email: conEmail,
    ventas_recientes_registradas: databaseState.recentSales.length,
    servidor_fuente: live.dir,
    ultimo_escaneo: databaseState.lastScan.toISOString()
  };

  databaseState.initialized = true;
  return { success: true, summary: databaseState.summary };
}

module.exports = {
  initializeDatabase: initializeDatabase,
  getState: function() { return databaseState; },
  locateLiveStoreCompany: locateLiveStoreCompany
};
