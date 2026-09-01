/*
  ============================================================
  JJ Paper — Extractor de CLIENTES desde MixNet (DBF dBase)
  ============================================================
  Versión 3.0 — "SIEMPRE GENERA EL ARCHIVO + BUSCA CORREOS
  HASTA UN OBJETIVO DE COBERTURA"

  ARREGLOS v3 (vs v2):
  1. El CSV de clientes se escribe INMEDIATAMENTE después de leer
     MXCTACLI (no al final). Aunque la búsqueda de correos se
     cancele o tarde, SIEMPRE queda el archivo con los clientes.
  2. Luego se busca correos con un PRESUPUESTO DE TIEMPO y se va
     REESCRIBIENDO el CSV en cada ronda mientras mejora la
     cobertura. No hay que esperar a que termine todo.
  3. Cruce de correos por 5 llaves: código de cliente, RIF
     (incluye campo real "cifoih"), teléfono, correo directo en
     la tabla principal y razón social (fuzzy al final).
  4. Normalización de códigos (001-795 == 1-795) y teléfonos.
  5. Genera además: clientes_sin_correo_FECHA.csv (para captura
     manual) y resumen_mixnet_FECHA.csv (cobertura/estadísticas).
  6. El escaneo PRIORIZA carpetas tipo MixNet (comp*, RESPAMIX,
     ventas, factura*, datos, MX*) sobre el resto del disco.

  USO:
    node extraer-clientes-mixnet.cjs
      → flujo completo (objetivo 60%, presupuesto 300 s)
    node extraer-clientes-mixnet.cjs --objetivo 75 --tiempo 600
      → busca hasta 75% de cobertura o 10 min, lo que llegue antes
    node extraer-clientes-mixnet.cjs --explorar
    node extraer-clientes-mixnet.cjs --diagnostico "RUTA"

  Compatible con Node 13 (CommonJS). 2026-09-01 v3
  ============================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ───── Salida inmediata (Windows 7 bufferiza) ───── */
function say(s) {
  try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); }
}

/* ───── Timestamp para logs ───── */
function ts() {
  return new Date().toLocaleTimeString();
}

function log(msg) {
  say('[' + ts() + '] ' + msg);
}

/* ============================================================
   LECTOR DBF — Compatible Node 13, tolerante a errores
   ============================================================ */
function readDbfHeader(buf) {
  var type = buf[0];
  var lastUpd = { y: buf[1] + 1900, m: buf[2], d: buf[3] };
  var numRecords = buf.readUInt32LE(4);
  var headerLen = buf.readUInt16LE(8);
  var recordLen = buf.readUInt16LE(10);
  return { type: type, lastUpd: lastUpd, numRecords: numRecords, headerLen: headerLen, recordLen: recordLen };
}

function decodeStr(buf, start, len) {
  var s = '';
  for (var i = start; i < start + len; i++) {
    var c = buf[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function readDbfFields(buf, headerLen) {
  var fields = [];
  var off = 32;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    var name = decodeStr(buf, off, 11).replace(/\0/g, '').trim();
    var type = String.fromCharCode(buf[off + 11]);
    var fLen = buf.readUInt16LE(off + 16);
    var dec = buf[off + 17];
    fields.push({ name: name, type: type, len: fLen, dec: dec });
    off += 32;
  }
  return fields;
}

function parsedb(filePath, withData, verbose) {
  var buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    if (verbose) log('  [!] No se pudo leer: ' + e.message);
    return null;
  }

  if (buf.length < 32) {
    if (verbose) log('  [!] Archivo muy pequenio: ' + buf.length + ' bytes');
    return null;
  }

  var header;
  try {
    header = readDbfHeader(buf);
  } catch (e) {
    if (verbose) log('  [!] Header corrupto: ' + e.message);
    return null;
  }

  if (header.headerLen < 32 || header.recordLen < 1 || header.headerLen > buf.length) {
    if (verbose) log('  [!] Header invalido: headerLen=' + header.headerLen + ' recordLen=' + header.recordLen);
    return null;
  }

  var fields;
  try {
    fields = readDbfFields(buf, header.headerLen);
  } catch (e) {
    if (verbose) log('  [!] Error leyendo campos: ' + e.message);
    return null;
  }

  var out = { header: header, fields: fields, rows: null, filePath: filePath };

  if (!withData) return out;

  var maxDataEnd = Math.min(
    header.headerLen + (header.numRecords * header.recordLen),
    buf.length
  );

  var rows = [];
  var seen = {};
  var pos = header.headerLen;

  while (pos + header.recordLen <= maxDataEnd && rows.length < 500000) {
    var rec = buf.slice(pos, pos + header.recordLen);

    // El primer byte indica: 0x20=activo, 0x2A=borrado, otro=skip
    if (rec[0] === 0x2A || rec[0] !== 0x20) {
      pos += header.recordLen;
      continue;
    }

    var obj = {};
    var fpos = 1;
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      if (fpos + f.len > rec.length) break;
      var raw = decodeStr(rec, fpos, f.len);
      if (f.type === 'N' || f.type === 'F' || f.type === 'I') {
        raw = raw.trim().replace(/,/g, '.');
      }
      obj[f.name.trim().toLowerCase()] = raw;
      fpos += f.len;
    }

    var key = JSON.stringify(obj);
    if (!seen[key]) {
      seen[key] = true;
      rows.push(obj);
    }
    pos += header.recordLen;
  }

  out.rows = rows;
  return out;
}

/* ============================================================
   HELPERS
   ============================================================ */
function normTxt(s) {
  if (s == null) return '';
  s = String(s).toLowerCase().trim();
  // Quitar acentos: NFD + remove combining. Si normalize no existe, dejar tal cual.
  if (s.normalize) {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  s = s.replace(/[^a-z0-9]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function tokenize(s) {
  return normTxt(s).split(' ').filter(function (w) { return w.length > 1; });
}

function extractEmail(v) {
  if (v == null) return '';
  var m = String(v).match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? m[0] : '';
}

function extractPhone(v) {
  if (v == null) return '';
  var s = String(v).replace(/[^\d.]/g, '');
  var m = s.match(/\d{7,}/);
  return m ? m[0] : '';
}

/* Normaliza códigos de cliente: "001-795" -> "1-795", "000123" -> "123" */
function normCod(s) {
  if (s == null) return '';
  return String(s).toLowerCase().replace(/\s+/g, '').split('-')
    .map(function (seg) { return seg.replace(/^0+/, ''); })
    .join('-')
    .replace(/[^a-z0-9\-]/g, '');
}

function escCSV(v) {
  v = (v == null ? '' : String(v)).trim();
  if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function toCSV(rows, head) {
  var lines = [];
  lines.push(head.join(','));
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cols = [];
    for (var j = 0; j < head.length; j++) {
      cols.push(escCSV(r[head[j]]));
    }
    lines.push(cols.join(','));
  }
  return lines.join('\r\n');
}

function findField(keys, candidates, defaultValue) {
  var k = [];
  for (var i = 0; i < keys.length; i++) k.push(keys[i].toLowerCase());
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci];
    for (var ki = 0; ki < k.length; ki++) {
      if (k[ki] === c || k[ki].indexOf(c) === 0 || k[ki].indexOf(c) !== -1) {
        return k[ki];
      }
    }
  }
  return defaultValue;
}

function fuzzyMatch(raz, idxByRazon) {
  var tokens = tokenize(raz);
  if (tokens.length < 2) return null;
  var razNorm = normTxt(raz);
  if (idxByRazon[razNorm]) return idxByRazon[razNorm][0];
  var best = null;
  var bestScore = 0;
  var keys = Object.keys(idxByRazon);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var keyTokens = key.split(' ');
    var hits = 0;
    for (var t = 0; t < tokens.length; t++) {
      for (var kt = 0; kt < keyTokens.length; kt++) {
        if (keyTokens[kt].indexOf(tokens[t]) !== -1 || tokens[t].indexOf(keyTokens[kt]) !== -1) {
          hits++;
          break;
        }
      }
    }
    var score = hits / tokens.length;
    if (score >= 0.6 && score > bestScore) {
      bestScore = score;
      best = idxByRazon[key][0];
    }
  }
  return best;
}

/* ============================================================
   DETECCIÓN DE UNIDADES ACCESIBLES
   ============================================================ */
function detectarUnidades() {
  var unidades = [];
  var candidatas = ['M:', 'P:', 'Z:', 'C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:'];

  log('Detectando unidades accesibles...');

  for (var i = 0; i < candidatas.length; i++) {
    var u = candidatas[i];
    var root = u + '\\';
    try {
      if (fs.existsSync(root)) {
        // Intentar listar el contenido para confirmar acceso real
        var entries = fs.readdirSync(root);
        unidades.push({ letra: u, root: root, archivos: entries.length });
        log('  [OK] ' + u + '/  (' + entries.length + ' elementos en raiz)');
      } else {
        log('  [--] ' + u + '/  no existe o no esta montada');
      }
    } catch (e) {
      log('  [!!] ' + u + '/  existe pero ERROR: ' + e.message);
    }
  }
  return unidades;
}

/* ============================================================
   ESCANEO RECURSIVO CON PRESUPUESTO DE TIEMPO y PRIORIDAD
   ============================================================ */
var EXCLUDE_SCAN = /windows|program files|programdata|appdata|perflogs|\$recycle|fonts|drivers|\.git|node_modules|\$windows|bluestacks|anaconda|nodejs|python|nvidia|intel\b|\.thumbnails|dcim|music|videos|pictures|musica|common files|microsoft office|microsoft.net|installshield|nero|brother|bullzip|hp\\|adobe|mozilla|google|java\\|intel\\|dvd maker/i;

// Carpetas con probabilidad ALTA de contener datos MixNet → se exploran primero
var PRIORITY_DIRS = /mixnet|mixer|respami|comp\d|comp-|multiemp|ventas|venta|factura|sistema|sistemas|datos|base|clientes|contab|bases|dbf|banco|admin|\bmx\b|mixnetdata/i;

function crearEscaneador(unidades) {
  var queue = [];
  var visitados = {};
  var stats = { carpetas: 0, dbfEncontrados: 0, conEmail: 0, errores: 0, ignoradas: 0 };
  var meta = []; // metadata de cada DBF con emails posible

  // Semillas: la raiz de cada unidad
  for (var i = 0; i < unidades.length; i++) {
    queue.push({ dir: unidades[i].root, prio: 0, depth: 0 });
  }

  function prioridadDe(nombre, depth) {
    var p = 100 - depth * 3;
    if (PRIORITY_DIRS.test(nombre)) p += 800;
    if (/\.bak|backup|old|orig|tmp/i.test(nombre)) p -= 400;
    return p;
  }

  return {
    stats: stats,
    meta: meta,
    hayPendientes: function () { return queue.length > 0; },
    pendientes: function () { return queue.length; },

    /* Procesa hasta `limite` carpetas en esta llamada. Devuelve los DBF
       con datos leidos (para construir el indice de correos). */
    recorrer: function (limite) {
      var dbLeidos = [];
      var procesadas = 0;

      queue.sort(function (a, b) { return b.prio - a.prio; });

      while (queue.length && procesadas < limite) {
        var item = queue.pop();
        var dir = item.dir;
        var depth = item.depth;
        procesadas++;

        if (visitados[dir]) continue;
        visitados[dir] = true;

        if (depth > 40) continue;
        stats.carpetas++;

        var entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
          stats.errores++;
          continue;
        }

        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          var fp = path.join(dir, e.name);

          if (e.isDirectory()) {
            if (EXCLUDE_SCAN.test(e.name)) {
              stats.ignoradas++;
              continue;
            }
            queue.push({ dir: fp, prio: prioridadDe(e.name, depth + 1), depth: depth + 1 });
          } else if (e.isFile() && /\.dbf$/i.test(e.name)) {
            stats.dbfEncontrados++;
            var st;
            try { st = fs.statSync(fp); } catch (_) { continue; }
            if (st.size < 33) continue;

            // Búsqueda rápida de emails EN EL ARCHIVO sin parser completo
            var dbMeta = { path: fp, nombre: e.name, size: st.size, tieneEmail: false, regs: -1, campos: [] };

            // Revisar header para campos
            var hdrFd = fs.openSync(fp, 'r');
            var hdrBuf = Buffer.alloc(512);
            fs.readSync(hdrFd, hdrBuf, 0, 512, 0);
            fs.closeSync(hdrFd);
            var hLen = hdrBuf.readUInt16LE(8);
            if (hLen < 32 || hLen > 4096) continue;
            var numRec = hdrBuf.readUInt32LE(4);
            dbMeta.regs = numRec;

            var campos = readDbfFields(hdrBuf, hLen);
            dbMeta.campos = campos.map(function (f) { return f.name.trim().toLowerCase(); });

            // Detectar campos de correo en el header
            var tieneCampoMail = false;
            for (var ci = 0; ci < campos.length; ci++) {
              var cn = campos[ci].name.toLowerCase();
              if (/corr|mail|email|nmail|clave|correo|agenda|e_mail|e-mail/i.test(cn)) {
                tieneCampoMail = true;
                break;
              }
            }

            // Leer el DBF completo SOLO si tiene campo de correo o el archivo es MX*/COD*
            var archivoSospechoso = /MX|CLI|COD|CTACLI|AGEN|CONTAC|CORREO|MAIL|EMAIL/i.test(e.name);
            if (!tieneCampoMail && !archivoSospechoso) continue;

            var db = parsedb(fp, true, false);
            if (!db || !db.rows || !db.rows.length) continue;

            // Confirmar emails por valor
            var tieneMail = false;
            for (var ri = 0; ri < db.rows.length && !tieneMail; ri++) {
              var row = db.rows[ri];
              var keys = Object.keys(row);
              for (var ki = 0; ki < keys.length; ki++) {
                if (extractEmail(row[keys[ki]])) { tieneMail = true; break; }
              }
            }
            dbMeta.tieneEmail = tieneMail;
            if (tieneMail) stats.conEmail++;

            meta.push(dbMeta);
            dbLeidos.push(db);
          }
        }

        // Progreso
        if (stats.carpetas % 300 === 0) {
          log('    ...' + stats.carpetas + ' carpetas, ' + stats.dbfEncontrados + ' DBF, ' +
            stats.conEmail + ' con email');
        }
      }

      return dbLeidos;
    }
  };
}

/* ============================================================
   LOCALIZACIÓN DE COMPAÑÍA (MXCTACLI)
   ============================================================ */
var COMP_NAMES = ['MXCTACLI', 'mxctacli', 'MXSUCCLI', 'mxsuccli'];

function buscarMxctacli(unidades, tiempoMaxMs) {
  var encontrados = [];
  var tIni = Date.now();
  var presupuesto = tiempoMaxMs || 90000;

  // Estrategia 1: buscar en rutas típicas
  var tipicas = [
    'comp01', 'COMP01', 'comp02', 'COMP02', 'comp03', 'COMP03',
    'comp01-ORIGINAL', 'COMP01-ORIGINAL', 'mixnet', 'MIXNET',
    'datos', 'DATOS', 'sistema', 'SISTEMA', 'base', 'BASE',
    'dbf', 'DBF', 'sistemas', 'SISTEMAS'
  ];

  for (var ui = 0; ui < unidades.length; ui++) {
    var u = unidades[ui];
    for (var ti = 0; ti < tipicas.length; ti++) {
      var comp = tipicas[ti];
      for (var ni = 0; ni < COMP_NAMES.length; ni++) {
        var dbfPath = path.join(u.root, comp, COMP_NAMES[ni] + '.DBF');
        try {
          if (fs.existsSync(dbfPath)) {
            var st = fs.statSync(dbfPath);
            var db = parsedb(dbfPath, false, false);
            encontrados.push({
              dir: path.join(u.root, comp),
              path: dbfPath,
              size: st.size,
              regs: db ? db.header.numRecords : -1,
              fuente: 'tipica'
            });
            log('  [HALLAZGO] ' + dbfPath + ' (' + (db ? db.header.numRecords : '?') + ' registros)');
          }
        } catch (_) { }
      }
    }
  }

  // Estrategia 2: escaneo rápido por prioridad buscando MXCTACLI.DBF
  if (encontrados.length === 0) {
    log('  No se encontró en rutas típicas. Buscando en la red (con presupuesto)...');
    var esc = crearEscaneador(unidades);
    while (esc.hayPendientes() && Date.now() - tIni < presupuesto) {
      var dbLeidos = esc.recorrer(2000);
      for (var di = 0; di < esc.meta.length; di++) {
        var m = esc.meta[di];
        if (encontrados.length === 0 && /MXCTACLI/i.test(m.nombre)) {
          var db2 = parsedb(m.path, false, false);
          encontrados.push({
            dir: path.dirname(m.path),
            path: m.path,
            size: m.size,
            regs: db2 ? db2.header.numRecords : -1,
            fuente: 'escaneo'
          });
          log('  [HALLAZGO] ' + m.path + ' (' + (db2 ? db2.header.numRecords : '?') + ' registros)');
        }
      }
      if (encontrados.length) break;
    }
  }

  // Ordenar por registros (el más grande = compañía activa)
  encontrados.sort(function (a, b) { return (b.regs || 0) - (a.regs || 0); });
  return encontrados;
}

/* ============================================================
   CONSTRUIR ÍNDICE DE CORREOS (con códigos normalizados)
   ============================================================ */
function buildEmailIndex(dbFiles) {
  var idx = {
    byRazon: {},
    byRif: {},
    byCod: {},
    byTel: {},
    byTel10: {},
    rows: [],
    dbfConMail: 0,
    ejemplos: []
  };

  for (var di = 0; di < dbFiles.length; di++) {
    var db = dbFiles[di];
    if (!db.rows || !db.rows.length) continue;

    var tk = [];
    for (var fi = 0; fi < db.fields.length; fi++) {
      tk.push(db.fields[fi].name.trim().toLowerCase());
    }

    var tRaz = findField(tk, ['razon', 'razonsocial', 'nombre', 'nombrecli', 'cliente', 'denominacion', 'descrip', 'descr'], null);
    var tRif = findField(tk, ['rif', 'nit', 'cedula', 'cedul', 'identif', 'identidad', 'rifc', 'cif', 'cifoi', 'cifoih', 'codrif'], null);
    var tCod = findField(tk, ['cod', 'codigo', 'cod_cli', 'codcli', 'cod_cta', 'cta', 'ctacli', 'deudor', 'cliente', 'codigo_cli'], null);
    var tTel = findField(tk, ['telf', 'telef', 'tel', 'tfono', 'tfn', 'movil', 'celular', 'tlf'], null);
    var tCoor = findField(tk, ['corr', 'correo', 'email', 'e_mail', 'e-mail', 'connected', 'into', 'destino', 'nmail', 'clave', 'agenda'], null);

    var tablaMail = false;

    for (var ri = 0; ri < db.rows.length; ri++) {
      var row = db.rows[ri];

      // Buscar email en campo de correo primero
      var mail = '';
      var mailField = '';
      if (tCoor && row[tCoor] !== undefined) {
        mail = extractEmail(row[tCoor]);
        if (mail) mailField = tCoor;
      }

      // Si no, buscar en TODOS los campos
      if (!mail) {
        var keys = Object.keys(row);
        for (var ki = 0; ki < keys.length; ki++) {
          mail = extractEmail(row[keys[ki]]);
          if (mail) {
            mailField = keys[ki];
            break;
          }
        }
      }

      if (!mail) continue;
      tablaMail = true;

      var raz = (tRaz && row[tRaz] !== undefined) ? String(row[tRaz]) : '';
      var rif = (tRif && row[tRif] !== undefined) ? String(row[tRif]) : '';
      var cod = (tCod && row[tCod] !== undefined) ? String(row[tCod]) : '';
      var telR = (tTel && row[tTel] !== undefined) ? String(row[tTel]) : '';
      var telDigits = telR.replace(/\D/g, '');

      var rec = { mail: mail, tel: telR, raz: raz, rif: rif, cod: cod, archivo: db.filePath };
      idx.rows.push(rec);

      // Guardar hasta 20 ejemplos para el reporte
      if (idx.ejemplos.length < 20) {
        idx.ejemplos.push({
          email: mail,
          razon: raz.substring(0, 50),
          rif: rif,
          archivo: path.basename(db.filePath)
        });
      }

      // Índices por clave normalizadas
      if (raz) {
        var k = normTxt(raz);
        if (!idx.byRazon[k]) idx.byRazon[k] = [];
        idx.byRazon[k].push({ mail: mail, tel: telR });
      }
      if (rif) {
        var kr = normTxt(rif);
        if (!idx.byRif[kr]) idx.byRif[kr] = mail;
      }
      if (cod) {
        var kc = normCod(cod);
        if (!idx.byCod[kc]) idx.byCod[kc] = mail;
      }
      if (telDigits && telDigits.length >= 8) {
        if (!idx.byTel[telDigits]) idx.byTel[telDigits] = mail;
        var ult10 = telDigits.slice(-10);
        if (!idx.byTel10[ult10]) idx.byTel10[ult10] = mail;
      }
    }
    if (tablaMail) idx.dbfConMail++;
  }

  return idx;
}

/* ============================================================
   APLICAR CORREOS A LOS CLIENTES + MEDIR COBERTURA
   ============================================================ */
function camposCliente(ck) {
  return {
    razF: findField(ck, ['razon', 'razonsocial', 'nombre', 'nombrecli', 'cliente', 'denominacion', 'descrip', 'descr'], null),
    rifF: findField(ck, ['rif', 'nit', 'cedula', 'cedul', 'identif', 'identidad', 'rifc', 'cif', 'cifoi', 'cifoih', 'codrif'], null),
    codF: findField(ck, ['cod', 'codigo', 'cod_cli', 'codcli', 'cta', 'ctacli', 'deudor', 'cliente', 'codigo_cli'], null),
    telF: findField(ck, ['telf', 'telef', 'tel', 'tfono', 'tfn', 'movil', 'celular', 'tlf'], null),
    mailF: findField(ck, ['corr', 'correo', 'email', 'e_mail', 'e-mail', 'nmail', 'clave', 'agenda'], null)
  };
}

/* Devuelve { conMail, total, pct, estrategias } sin modificar filas.
   Es RÁPIDO (solo llaves exactas) para usarlo en cada ronda. */
function medirCobertura(rows, campos, idx) {
  var conMail = 0;
  var estrategias = { rif: 0, cod: 0, tel: 0, directo: 0 };
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    var mail = '';

    if (!mail && campos.codF && r[campos.codF] !== undefined) {
      mail = idx.byCod[normCod(r[campos.codF])] || '';
      if (mail) estrategias.cod++;
    }
    if (!mail && campos.rifF && r[campos.rifF] !== undefined) {
      mail = idx.byRif[normTxt(r[campos.rifF])] || '';
      if (mail) estrategias.rif++;
    }
    if (!mail && campos.telF && r[campos.telF] !== undefined) {
      var d = String(r[campos.telF]).replace(/\D/g, '');
      mail = idx.byTel[d] || idx.byTel10[d.slice(-10)] || '';
      if (mail) estrategias.tel++;
    }
    if (!mail && campos.mailF && r[campos.mailF] !== undefined) {
      mail = extractEmail(r[campos.mailF]);
      if (mail) estrategias.directo++;
    }

    if (mail) conMail++;
  }
  return {
    conMail: conMail,
    total: rows.length,
    pct: rows.length ? Math.round(conMail / rows.length * 100) : 0,
    estrategias: estrategias
  };
}

/* Aplica correos a las filas (escribe __email y __tiene_email).
   Si usarFuzzy=true, incluye la razón social como último recurso. */
function aplicarCorreos(rows, campos, idx, usarFuzzy) {
  var conMail = 0;
  var estrategias = { rif: 0, cod: 0, tel: 0, directo: 0, razon: 0 };
  var sinCorreo = [];

  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    var raz = (campos.razF && r[campos.razF] !== undefined) ? String(r[campos.razF]) : '';
    var rif = (campos.rifF && r[campos.rifF] !== undefined) ? String(r[campos.rifF]) : '';
    var cod = (campos.codF && r[campos.codF] !== undefined) ? String(r[campos.codF]) : '';
    var telR = (campos.telF && r[campos.telF] !== undefined) ? String(r[campos.telF]) : '';
    var mail = '';

    // 1) Email directo en la tabla principal (si existe)
    if (campos.mailF && r[campos.mailF] !== undefined) {
      mail = extractEmail(r[campos.mailF]);
      if (mail) estrategias.directo++;
    }

    // 2) por código (llave más estable de MixNet)
    if (!mail && cod) {
      mail = idx.byCod[normCod(cod)] || '';
      if (mail) estrategias.cod++;
    }
    // 3) por RIF
    if (!mail && rif) {
      mail = idx.byRif[normTxt(rif)] || '';
      if (mail) estrategias.rif++;
    }
    // 4) por teléfono
    if (!mail && telR) {
      var d = telR.replace(/\D/g, '');
      if (d.length >= 8) {
        mail = idx.byTel[d] || idx.byTel10[d.slice(-10)] || '';
        if (mail) estrategias.tel++;
      }
    }
    // 5) por razón social (solo en la pasada final)
    if (!mail && usarFuzzy && raz) {
      var hit = fuzzyMatch(raz, idx.byRazon);
      if (hit) {
        mail = hit.mail || '';
        if (mail) estrategias.razon++;
      }
    }

    r['__email'] = mail;
    r['__tiene_email'] = mail ? 'SI' : 'NO';
    if (mail) {
      conMail++;
    } else {
      sinCorreo.push({
        cod: cod,
        raz: raz,
        rif: rif,
        tel: telR,
        dir: (campos.razF && r[campos.razF]) ? '' : ''
      });
    }
  }

  return {
    rows: rows,
    conMail: conMail,
    total: rows.length,
    pct: rows.length ? Math.round(conMail / rows.length * 100) : 0,
    estrategias: estrategias,
    sinCorreo: sinCorreo,
    idx: idx
  };
}

/* ============================================================
   RESOLVER RUTA DE SALIDA (ESCRITORIO)
   ============================================================ */
function resolveOutPath(outF) {
  if (outF && path.isAbsolute(outF)) return outF;

  var userHome = process.env.USERPROFILE || '';
  if (!userHome && process.env.HOMEDRIVE && process.env.HOMEPATH) {
    userHome = process.env.HOMEDRIVE + process.env.HOMEPATH;
  }

  var desks = [];
  if (userHome) {
    desks.push(path.join(userHome, 'Desktop'));
    desks.push(path.join(userHome, 'Escritorio'));
  }
  desks.push('C:\\Users\\Public\\Desktop');

  var nombre = outF || ('clientes_mixnet_' + Date.now() + '.csv');

  for (var i = 0; i < desks.length; i++) {
    try {
      if (fs.existsSync(desks[i]) && fs.statSync(desks[i]).isDirectory()) {
        return path.join(desks[i], nombre);
      }
    } catch (_) { }
  }
  return path.join(__dirname, nombre);
}

/* esc+rv3 funciona igual que resolveOutPath pero para fechas. */
function stFecha() {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, '0'); };
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function escribirCSV(rows, head, outPath) {
  try {
    fs.writeFileSync(outPath, toCSV(rows, head), 'utf8');
    return true;
  } catch (e) {
    log('[ERROR] No se pudo escribir el CSV: ' + e.message);
    return false;
  }
}

/* ============================================================
   MODO COMPLETO — Flujo automático completo (v3)
   ============================================================ */
function modoCompleto(opts) {
  var objetivo = opts.objetivo || 60;
  var presupuestoMs = (opts.tiempo || 300) * 1000;
  var outF = opts.out || null;

  var t0 = Date.now();
  var finT = t0 + presupuestoMs;
  log('=========================================================');
  log('  EXTRACTOR COMPLETO DE CLIENTES MIXNET v3');
  log('  Solo lee. No modifica nada de MixNet.');
  log('  Objetivo de correos: ' + objetivo + '%  Presupuesto: ' +
    Math.round(presupuestoMs / 1000) + 's');
  log('=========================================================');

  // PASO 1: Detectar unidades
  log('\n[PASO 1/6] Detectando unidades de la red...');
  var unidades = detectarUnidades();
  if (!unidades.length) {
    log('\n[ERROR FATAL] No hay ninguna unidad accesible.');
    log('  ¿Está la red conectada? ¿Las unidades están montadas?');
    log('  Prueba: Abre el Explorador de Windows y verifica M:/ P:/ Z:/');
    var outErr = resolveOutPath(outF);
    try {
      fs.writeFileSync(outErr,
        'RESULTADO,EXTRAER-CLIENTES-MIXNET\r\n' +
        'ESTADO,ERROR_NO_HAY_UNIDADES\r\n' +
        'MOTIVO,No se pudo acceder a ninguna unidad de red ni local\r\n' +
        'FECHA,' + new Date().toLocaleString() + '\r\n', 'utf8');
      log('  Reporte de error en: ' + outErr);
    } catch (_) { }
    return;
  }

  // PASO 2: Buscar compañía (MXCTACLI) — máximo 60s (~1/5 del presupuesto)
  log('\n[PASO 2/6] Buscando la tabla de clientes (MXCTACLI)...');
  var comps = buscarMxctacli(unidades, Math.min(60000, Math.round(presupuestoMs / 3)));
  if (!comps.length) {
    log('\n[ERROR] No encontré MXCTACLI.DBF en ninguna ruta típica ni en la red.');
    log('  Ejecuta --explorar para ver qué archivos DBF existen.');
    var outErr2 = resolveOutPath(outF);
    try {
      fs.writeFileSync(outErr2,
        'RESULTADO,EXTRAER-CLIENTES-MIXNET\r\n' +
        'ESTADO,ERROR_NO_HAY_MXCTACLI\r\n' +
        'MOTIVO,No se encontro MXCTACLI.DBF en ninguna unidad\r\n' +
        'UNIDADES,' + unidades.map(function (u) { return u.letra; }).join(';') + '\r\n' +
        'AYUDA,Usa --explorar para ver que archivos DBF existen\r\n' +
        'FECHA,' + new Date().toLocaleString() + '\r\n', 'utf8');
      log('  Reporte de error en: ' + outErr2);
    } catch (_) { }
    return;
  }

  log('\nCompañías encontradas (' + comps.length + '):');
  for (var ci = 0; ci < comps.length; ci++) {
    log('  ' + (ci + 1) + ') ' + comps[ci].path + ' | ' + comps[ci].regs + ' registros');
  }
  var best = comps[0];
  log('\n  -> Usando: ' + best.path);

  // PASO 3: Leer todos los clientes
  log('\n[PASO 3/6] Leyendo todos los clientes de la tabla principal...');
  var cdb = parsedb(best.path, true, true);
  if (!cdb || !cdb.rows || !cdb.rows.length) {
    log('[ERROR] No se pudieron leer registros de MXCTACLI.');
    return;
  }

  var rows = cdb.rows;
  var ck = [];
  for (var fi = 0; fi < cdb.fields.length; fi++) {
    ck.push(cdb.fields[fi].name.trim().toLowerCase());
  }
  log('  Clientes: ' + rows.length);
  log('  Campos: ' + ck.join(', '));

  // Enriquecer filas con llaves vacías
  for (var pi = 0; pi < rows.length; pi++) {
    rows[pi]['__email'] = '';
    rows[pi]['__tiene_email'] = 'NO';
  }

  // PASO 3.5: ESCRIBIR EL CSV AHORA (garantizado)
  var stamp = stFecha();
  var base = (outF || 'clientes_mixnet_' + stamp);
  var ext = (base.slice(-4).toLowerCase() === '.csv') ? '' : '.csv';
  var mainPath = resolveOutPath(base + ext);
  var head = ck.slice();
  head.push('__email', '__tiene_email');

  log('\n  Escribiendo CSV de clientes en ' + mainPath + ' ...');
  escribirCSV(rows, head, mainPath);
  log('  [CSV BASE GUARDADO] ' + mainPath + ' (' + rows.length + ' clientes)');

  var campos = camposCliente(ck);
  log('  Campos de cruce: razón=' + (campos.razF || '?') + ', RIF=' + (campos.rifF || '?') +
    ', código=' + (campos.codF || '?') + ', teléfono=' + (campos.telF || '?') +
    ', correo=' + (campos.mailF || '?'));

  // PASO 4: Escanear y buscar correos con presupuesto + cobertura
  log('\n[PASO 4/6] Buscando correos en TODAS las unidades (priorizando MixNet)...');
  var esc = crearEscaneador(unidades);
  var dbFilesAll = [cdb]; // el propio MXCTACLI también cuenta (emailngq directo)
  var idx = buildEmailIndex(dbFilesAll);
  var mejor = medirCobertura(rows, campos, idx);
  log('  Cobertura inicial (solo MXCTACLI): ' + mejor.conMail + '/' + rows.length +
    ' (' + mejor.pct + '%)');

  var ronda = 0;
  while (esc.hayPendientes() && Date.now() < finT) {
    ronda++;
    log('\n  --- Ronda ' + ronda + ' de escaneo (carpetas pendientes: ' + esc.pendientes() + ') ---');

    var nuevos = esc.recorrer(4000);
    if (nuevos.length) {
      dbFilesAll = dbFilesAll.concat(nuevos);
      var idxNuevo = buildEmailIndex(dbFilesAll);
      var cob = medirCobertura(rows, campos, idxNuevo);

      log('  DBF con datos nuevos: ' + nuevos.length +
        ' | DBF con email: ' + idxNuevo.dbfConMail +
        ' | emails por valor: ' + idxNuevo.rows.length);
      log('  Cobertura AHORA: ' + cob.conMail + '/' + rows.length + ' (' + cob.pct + '%)' +
        '  (objetivo ' + objetivo + '%)');

      // Reescribir CSV incremental con los correos encontrados (no fuzzy aún)
      aplicarCorreos(rows, campos, idxNuevo, false);
      escribirCSV(rows, head, mainPath);
      log('  CSV actualizado: ' + mainPath);

      idx = idxNuevo;
      mejor = cob;

      if (cob.pct >= objetivo) {
        log('\n  >>> OBJETIVO ALCANZADO: ' + cob.pct + '% >= ' + objetivo + '% <<<');
        break;
      }
    }

    // El CSV ya quedó con los correos de esta ronda aunque no se alcance el objetivo
  }

  var totalT = Math.round((Date.now() - t0) / 1000);
  log('\n  Escaneo finalizado en ' + totalT + 's. Carpetas: ' + esc.stats.carpetas +
    ', DBF: ' + esc.stats.dbfEncontrados + ', con email: ' + esc.stats.conEmail);

  // PASO 5: Pasada final incluyendo fuzzy por razón social
  log('\n[PASO 5/6] Pasada final (incluye razón social)...');
  var res = aplicarCorreos(rows, campos, idx, true);
  log('  Resultado final: ' + res.conMail + '/' + rows.length + ' con correo (' + res.pct + '%)');
  log('    Por código:    ' + res.estrategias.cod);
  log('    Por RIF:       ' + res.estrategias.rif);
  log('    Por teléfono:  ' + res.estrategias.tel);
  log('    Directo tabla: ' + res.estrategias.directo);
  log('    Por razón:     ' + res.estrategias.razon);

  // PASO 6: Escribir CSV final + reportes
  log('\n[PASO 6/6] Escribiendo archivos finales...');
  escribirCSV(rows, head, mainPath);

  // Reporte de clientes sin correo
  var sinPath = resolveOutPath('clientes_sin_correo_' + stamp + '.csv');
  var sinHead = ['CODIGO', 'RAZON_SOCIAL', 'RIF', 'TELEFONO'];
  var sinLines = [sinHead.join(',')];
  for (var si = 0; si < res.sinCorreo.length; si++) {
    var s = res.sinCorreo[si];
    sinLines.push([s.cod, s.raz, s.rif, s.tel].map(escCSV).join(','));
  }
  try {
    fs.writeFileSync(sinPath, sinLines.join('\r\n'), 'utf8');
    log('  Sin correo (' + res.sinCorreo.length + '): ' + sinPath);
  } catch (e) {
    log('  No se pudo escribir reporte sin correo: ' + e.message);
  }

  // Resumen
  var resPath = resolveOutPath('resumen_mixnet_' + stamp + '.csv');
  var resLines = [
    'METRICA,VALOR',
    'CLIENTES_TOTAL,' + rows.length,
    'CLIENTES_CON_CORREO,' + res.conMail,
    'COBERTURA_PCT,' + res.pct,
    'OBJETIVO_PCT,' + objetivo,
    'PRESUPUESTO_SEG,' + Math.round(presupuestoMs / 1000),
    'TIEMPO_TOTAL_SEG,' + totalT,
    'CARPETAS_ESCANEADAS,' + esc.stats.carpetas,
    'DBF_ENCONTRADOS,' + esc.stats.dbfEncontrados,
    'DBF_CON_EMAIL,' + esc.stats.conEmail,
    'EMAILS_POR_VALOR,' + idx.rows.length,
    'POR_CODIGO,' + res.estrategias.cod,
    'POR_RIF,' + res.estrategias.rif,
    'POR_TELEFONO,' + res.estrategias.tel,
    'DIRECTO_TABLA,' + res.estrategias.directo,
    'POR_RAZON,' + res.estrategias.razon,
    'SIN_CORREO,' + res.sinCorreo.length,
    'ARCHIVO_CLIENTES,' + mainPath,
    'ARCHIVO_SIN_CORREO,' + sinPath
  ];
  try {
    fs.writeFileSync(resPath, resLines.join('\r\n'), 'utf8');
    log('  Resumen: ' + resPath);
  } catch (e) {
    log('  No se pudo escribir resumen: ' + e.message);
  }

  var elapsed = Math.round((Date.now() - t0) / 1000);
  log('\n=========================================================');
  log('  TERMINADO EN ' + elapsed + ' SEGUNDOS');
  log('=========================================================');
  log('  ARCHIVO PRINCIPAL: ' + mainPath);
  log('  ' + rows.length + ' clientes extraidos');
  log('  ' + res.conMail + ' con correo (' + res.pct + '%)');
  log('=========================================================');
}

/* ============================================================
   MODO EXPLORAR — Lista TODO lo que encuentra (sin extraer)
   ============================================================ */
function modoExplorar(opts) {
  var presupuestoMs = (opts.tiempo || 300) * 1000;
  var t0 = Date.now();
  log('=========================================================');
  log('  MODO EXPLORAR — ¿Qué hay en esta PC?');
  log('=========================================================');

  var unidades = detectarUnidades();
  if (!unidades.length) {
    log('[ERROR] No hay ninguna unidad accesible.');
    return;
  }

  // Buscar MXCTACLI (usar la mitad del presupuesto para no agotarlo todo aquí)
  log('\n--- Buscando MXCTACLI (clientes) ---');
  var comps = buscarMxctacli(unidades, Math.round(presupuestoMs / 2));
  if (comps.length) {
    log('\nCompañías encontradas:');
    for (var i = 0; i < comps.length; i++) {
      log('  ' + (i + 1) + ') ' + comps[i].path + ' (' + comps[i].regs + ' registros, ' +
        (comps[i].size / 1024).toFixed(0) + ' KB)');
    }
  } else {
    log('No se encontró MXCTACLI.DBF en rutas típicas (sin escaneo profundo en explorar).');
  }

  // Escanear todos los DBF con presupuesto
  log('\n--- Escaneando TODOS los archivos DBF (presupuesto ' +
    Math.round(presupuestoMs / 1000) + 's) ---');
  var esc = crearEscaneador(unidades);

  try {
    while (esc.hayPendientes() && Date.now() - t0 < presupuestoMs) {
      esc.recorrer(4000);
    }
  } catch (e) {
    log('  Error durante escaneo: ' + e.message);
  }

  // Resumen
  log('\n=========================================================');
  log('  RESUMEN DEL EXPLORADOR');
  log('=========================================================');
  log('  Unidades accesibles: ' + unidades.length);
  log('  Archivos DBF encontrados: ' + esc.stats.dbfEncontrados);
  log('  DBF con emails: ' + esc.stats.conEmail);
  log('  Carpetas recorridas: ' + esc.stats.carpetas);
  log('  Errores de acceso: ' + esc.stats.errores);
  log('  Tiempo: ' + Math.round((Date.now() - t0) / 1000) + 's');

  // Reporte siempre al final
  var stamp = stFecha();
  var reportePath = resolveOutPath('exploracion_mixnet_' + stamp + '.csv');
  var reporteLines = ['ARCHIVO,REGISTROS,CAMPOS,TAMANO_KB'];
  for (var ri = 0; ri < esc.meta.length; ri++) {
    var m = esc.meta[ri];
    reporteLines.push(
      escCSV(m.path) + ',' +
      m.regs + ',' +
      escCSV((m.campos || []).join(';')) + ',' +
      Math.round((m.size || 0) / 1024)
    );
  }
  try {
    fs.writeFileSync(reportePath, reporteLines.join('\r\n'), 'utf8');
    log('\n  Reporte guardado en: ' + reportePath);
  } catch (e) {
    log('\n  No se pudo guardar el reporte: ' + e.message);
  }
}

/* ============================================================
   MODO DIAGNÓSTICO — Ver emails en una carpeta específica
   ============================================================ */
function modoDiagnostico(baseDir) {
  log('=========================================================');
  log('  DIAGNÓSTICO DE EMAILS EN MIXNET');
  log('=========================================================');
  log('Carpeta: ' + baseDir);

  if (!fs.existsSync(baseDir)) {
    log('[ERROR] La carpeta no existe: ' + baseDir);
    return;
  }

  var archivosNombres = [
    'MXCTACLI.DBF', 'MXSUCCLI.DBF', 'MXAGENDA.DBF', 'MXOFECLI.DBF',
    'MXCLIESP.DBF', 'MXCTAZON.DBF', 'MXCTADPT.DBF', 'MXCONTAC.DBF',
    'MXTELEFO.DBF', 'MXCORREO.DBF', 'MXEMAILE.DBF', 'MXE_MAIL.DBF'
  ];

  log('\n=== Buscando archivos conocidos ===');
  for (var i = 0; i < archivosNombres.length; i++) {
    var nombre = archivosNombres[i];
    var fp = path.join(baseDir, nombre);
    if (!fs.existsSync(fp)) {
      log('  [-] ' + nombre + ': NO EXISTE');
      continue;
    }
    var st;
    try { st = fs.statSync(fp); } catch (_) { log('  [-] ' + nombre + ': error'); continue; }
    log('  [+] ' + nombre + ' (' + (st.size / 1024).toFixed(0) + ' KB):');
    var db = parsedb(fp, false, true);
    if (db) {
      log('      Registros: ' + db.header.numRecords + ' | Fecha: ' +
        db.header.lastUpd.y + '/' + db.header.lastUpd.m + '/' + db.header.lastUpd.d);
      log('      Campos (' + db.fields.length + '):');
      for (var fi = 0; fi < db.fields.length; fi++) {
        var fld = db.fields[fi];
        var marker = '';
        var n = fld.name.toLowerCase();
        if (n.indexOf('cor') !== -1 || n.indexOf('mail') !== -1 || n.indexOf('email') !== -1) marker += ' <<< EMAIL';
        if (n.indexOf('tel') !== -1 || n.indexOf('tlf') !== -1) marker += ' <<< TEL';
        if (n.indexOf('rif') !== -1 || n.indexOf('nit') !== -1 || n.indexOf('cif') !== -1) marker += ' <<< RIF';
        if (n.indexOf('cod') !== -1) marker += ' <<< COD';
        log('        ' + String(fi + 1).padStart(2) + '. ' + fld.name + ' [' + fld.type + ' ' + fld.len + ']' + marker);
      }
    }
  }

  // También buscar CUALQUIER DBF con emails en esta carpeta
  log('\n=== Buscando CUALQUIER archivo DBF con emails ===');
  var entries;
  try { entries = fs.readdirSync(baseDir); } catch (e) { log('  Error: ' + e.message); return; }

  var totalEmails = 0;
  var reportePath = resolveOutPath('diagnostico_' + stFecha() + '.csv');
  var repLines = ['ARCHIVO,REGISTROS,CON_EMAIL,CAMPOS'];
  for (var ei = 0; ei < entries.length; ei++) {
    if (!/\.dbf$/i.test(entries[ei])) continue;
    var fp2 = path.join(baseDir, entries[ei]);
    var st2;
    try { st2 = fs.statSync(fp2); } catch (_) { continue; }
    if (st2.size < 33) continue;

    var db2 = parsedb(fp2, true, false);
    if (!db2 || !db2.rows || !db2.rows.length) continue;

    var mails = 0;
    for (var ri = 0; ri < db2.rows.length; ri++) {
      var row = db2.rows[ri];
      var keys = Object.keys(row);
      for (var ki = 0; ki < keys.length; ki++) {
        if (extractEmail(row[keys[ki]])) { mails++; break; }
      }
    }
    repLines.push(escCSV(fp2) + ',' + db2.rows.length + ',' + mails + ',' +
      escCSV(db2.fields.map(function (f) { return f.name.trim().toLowerCase(); }).join(';')));
    if (mails > 0) {
      log('  [EMAIL] ' + entries[ei] + ': ' + mails + ' registros con email (de ' + db2.rows.length + ' total)');
      totalEmails += mails;
    }
  }
  try {
    fs.writeFileSync(reportePath, repLines.join('\r\n'), 'utf8');
    log('  Reporte diagnóstico: ' + reportePath);
  } catch (e) { log('  No se pudo escribir reporte: ' + e.message); }

  log('\n  Total emails encontrados por valor: ' + totalEmails);
}

/* ============================================================
   MODO ESQUEMA — Ver campos de un DBF específico
   ============================================================ */
function modoEsquema(filePath) {
  log('Esquema de: ' + filePath);
  var db = parsedb(filePath, false, true);
  if (!db) { log('[ERROR] No se pudo leer el archivo.'); return; }
  log('Registros: ' + db.header.numRecords + ' | Fecha: ' +
    db.header.lastUpd.y + '/' + db.header.lastUpd.m + '/' + db.header.lastUpd.d);
  log('Campos (' + db.fields.length + '):');
  for (var i = 0; i < db.fields.length; i++) {
    var fld = db.fields[i];
    log('  ' + String(i + 1).padStart(2) + '. ' + fld.name + ' [' + fld.type + ' ' + fld.len +
      (fld.dec > 0 ? '.' + fld.dec : '') + ']');
  }
}

/* ============================================================
   MAIN
   ============================================================ */
function main() {
  var args = process.argv.slice(2);

  // Parámetros
  var objetivo = 60;
  var tiempo = 300;
  var out = null;
  var modos = [];

  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--objetivo') { objetivo = parseInt(args[i + 1], 10) || 60; i++; }
    else if (a === '--tiempo') { tiempo = parseInt(args[i + 1], 10) || 300; i++; }
    else if (a === '--out') { out = args[i + 1]; i++; }
    else modos.push(a);
  }

  var opts = { objetivo: objetivo, tiempo: tiempo, out: out };

  // Sin modos: flujo completo automático
  if (modos.length === 0) {
    log('=========================================================');
    log('  EXTRACTOR DE CLIENTES MIXNET v3 (automático)');
    log('  Objetivo de correos: ' + objetivo + '%');
    log('=========================================================');
    modoCompleto(opts);
    return;
  }

  var mode = modos[0];

  if (mode === '--explorar' || mode === '--explore') {
    modoExplorar(opts);
    return;
  }

  if (mode === '--diagnostico' || mode === '--diag') {
    var base = modos[1] || 'M:\\comp01';
    modoDiagnostico(base);
    return;
  }

  if (mode === '--completo' || mode === '--escaneo') {
    modoCompleto(opts);
    return;
  }

  if (mode === '--esquema') {
    var f = modos[1];
    if (!f) { log('Falta la ruta. Ej: --esquema "M:\\comp01\\MXCTACLI.DBF"'); return; }
    modoEsquema(f);
    return;
  }

  if (mode === '--detectar') {
    detectarUnidades();
    return;
  }

  // Modo desconocido
  log('=========================================================');
  log('  EXTRACTOR DE CLIENTES MIXNET v3');
  log('=========================================================');
  log('');
  log('  USO RECOMENDADO:');
  log('    node extraer-clientes-mixnet.cjs                       Flujo completo');
  log('    node extraer-clientes-mixnet.cjs --objetivo 75 --tiempo 600');
  log('                                    Sube a 75% de cobertura o 10 min');
  log('    node extraer-clientes-mixnet.cjs --explorar            VER qué hay en la PC');
  log('    node extraer-clientes-mixnet.cjs --diagnostico "RUTA"  Ver emails en una carpeta');
  log('');
  log('  OTROS:');
  log('    --esquema "RUTA\\ARCHIVO.DBF"   Ver campos de un DBF');
  log('    --detectar                     Ver unidades accesibles');
}

/* ============================================================
   WRAPPER: Capturar errores inesperados
   ============================================================ */
try {
  main();
} catch (e) {
  var msg = e && e.stack ? e.stack : String(e);
  log('\n[FATAL] Error inesperado: ' + msg);
  try {
    var logPath = path.join(__dirname, 'error_extractor.log');
    fs.writeFileSync(logPath,
      'FECHA: ' + new Date().toLocaleString() + '\r\n' +
      'ERROR: ' + msg + '\r\n', 'utf8');
    log('  Log guardado en: ' + logPath);
  } catch (_) { }
  process.exit(1);
}