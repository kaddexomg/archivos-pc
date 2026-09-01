/*
  ============================================================
  JJ Paper — Extractor de CLIENTES desde MixNet (DBF dBase)
  ============================================================
  Versión 2.0 — Reescrito para funcionar de VERDAD en la PC
  con acceso a la red de la empresa.

  RECOMENDADO:
    node extraer-clientes-mixnet.cjs                (flujo completo)
    node extraer-clientes-mixnet.cjs --explorar     (VER qué hay)
    node extraer-clientes-mixnet.cjs --diagnostico  (ver emails)

  Compatible con Node 13 (CommonJS). 2026-09-01 v2
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
   LECTOR DBF —-Compatible Node 13, tolerante a errores
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
  var s = String(v).replace(/\s+/g, '');
  var m = s.match(/\d{7,}/);
  return m ? m[0] : '';
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
   ESCANEO RECURSIVO DE ARCHIVOS DBF
   ============================================================ */
var EXCLUDE_SCAN = /windows|program files|programdata|appdata|perflogs|\$recycle|fonts|drivers|\.git|node_modules|\$windows|bluestacks|anaconda|nodejs|python|nvidia|intel\b|\.thumbnails|dcim|music|videos|pictures|musica|common files|microsoft office|microsoft.net|installshield|nero|brother|bullzip|hp\\|adobe|mozilla|google|java\\|intel\\|dvd maker/i;

function walkDbf(dir, depth, results, stats) {
  if (depth > 40) return;

  stats.carpetas++;
  if (stats.carpetas % 200 === 0) {
    log('    ...recorriendo: ' + dir + ' (' + stats.carpetas + ' carpetas, ' +
      stats.dbfEncontrados + ' DBF encontrados, ' + stats.conEmail + ' con email)');
  }

  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    stats.errores++;
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var fp = path.join(dir, e.name);

    if (e.isDirectory()) {
      if (EXCLUDE_SCAN.test(e.name)) {
        stats.ignoradas++;
        continue;
      }
      walkDbf(fp, depth + 1, results, stats);
    } else if (e.isFile()) {
      // Buscar CUALQUIER archivo .dbf (no solo MXCTACLI)
      if (/\.dbf$/i.test(e.name)) {
        stats.dbfEncontrados++;
        var st;
        try { st = fs.statSync(fp); } catch (_) { continue; }
        if (st.size < 33) continue;

        // Leer el DBF y ver si tiene emails
        var db = parsedb(fp, true, false);
        if (db && db.rows && db.rows.length > 0) {
          var tieneMail = false;
          for (var ri = 0; ri < db.rows.length && !tieneMail; ri++) {
            var row = db.rows[ri];
            // Buscar en todos los campos
            var keys = Object.keys(row);
            for (var ki = 0; ki < keys.length; ki++) {
              if (extractEmail(row[keys[ki]])) {
                tieneMail = true;
                break;
              }
            }
          }
          results.push({
            path: fp,
            nombre: e.name,
            size: st.size,
            registros: db.rows.length,
            campos: db.fields.map(function (f) { return f.name.trim().toLowerCase(); }),
            tieneEmail: tieneMail
          });
          if (tieneMail) stats.conEmail++;
        }
      }
    }
  }
}

/* ============================================================
   LOCALIZACIÓN DE COMPAÑÍA (MXCTACLI)
   ============================================================ */
var COMP_NAMES = ['MXCTACLI', 'mxctacli', 'MXSUCCLI', 'mxsuccli'];

function buscarMxctacli(unidades) {
  var encontrados = [];

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

  // Estrategia 2: escaneo recursivo buscando MXCTACLI.DBF
  if (encontrados.length === 0) {
    log('  No se encontró en rutas típicas. Buscando en toda la red...');
    for (var ui2 = 0; ui2 < unidades.length; ui2++) {
      var u2 = unidades[ui2];
      log('  Escaneando ' + u2.letra + '/ ...');
      var files = [];
      var stats = { carpetas: 0, dbfEncontrados: 0, conEmail: 0, errores: 0, ignoradas: 0 };
      walkDbf(u2.root, 0, files, stats);

      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi];
        if (/MXCTACLI/i.test(f.nombre)) {
          var db2 = parsedb(f.path, false, false);
          encontrados.push({
            dir: path.dirname(f.path),
            path: f.path,
            size: f.size,
            regs: db2 ? db2.header.numRecords : -1,
            fuente: 'escaneo'
          });
          log('  [HALLAZGO] ' + f.path + ' (' + (db2 ? db2.header.numRecords : '?') + ' registros)');
        }
      }
    }
  }

  // Ordenar por registros (el más grande = compañía activa)
  encontrados.sort(function (a, b) { return (b.regs || 0) - (a.regs || 0); });
  return encontrados;
}

/* ============================================================
   BÚSQUEDA DE EMAILS EN TODOS LOS DBF
   ============================================================ */
function buscarEmailsEnTodos(unidades, modoVerbose) {
  var todosLosDbf = [];
  var stats = { carpetas: 0, dbfEncontrados: 0, conEmail: 0, errores: 0, ignoradas: 0 };

  log('Escaneando TODAS las unidades en busca de archivos DBF con emails...');

  for (var i = 0; i < unidades.length; i++) {
    var u = unidades[i];
    log('\n  === Unidad ' + u.letra + '/ ===');
    var archivos = [];
    walkDbf(u.root, 0, archivos, stats);

    if (modoVerbose) {
      log('  Resumen ' + u.letra + ': ' + stats.carpetas + ' carpetas, ' +
        stats.dbfEncontrados + ' DBF totales, ' + stats.conEmail + ' con email');
    }

    for (var j = 0; j < archivos.length; j++) {
      var db = parsedb(archivos[j].path, true, false);
      if (db && db.rows && db.rows.length > 0) {
        todosLosDbf.push(db);
      }
    }
  }

  log('\n  TOTAL: ' + stats.dbfEncontrados + ' archivos DBF encontrados, ' +
    stats.conEmail + ' con emails, ' + stats.errores + ' errores de acceso');

  return { dbFiles: todosLosDbf, stats: stats };
}

/* ============================================================
   CONSTRUIR ÍNDICE DE CORREOS
   ============================================================ */
function buildEmailIndex(dbFiles) {
  var idx = {
    byRazon: {},
    byRif: {},
    byCod: {},
    byTel: {},
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
    var tRif = findField(tk, ['rif', 'nit', 'cedula', 'cedul', 'identif', 'identidad', 'rifc'], null);
    var tCod = findField(tk, ['cod', 'codigo', 'cod_cli', 'codcli', 'cod_cta', 'cta', 'ctacli', 'deudor', 'cliente'], null);
    var tTel = findField(tk, ['telf', 'telef', 'tel', 'tfono', 'tfn', 'movil', 'celular', 'tlf'], null);
    var tCoor = findField(tk, ['corr', 'correo', 'email', 'e_mail', 'e-mail', 'connected', 'into', 'destino'], null);

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

      // Índices por clave
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
        var kc = normTxt(cod);
        if (!idx.byCod[kc]) idx.byCod[kc] = mail;
      }
      if (telDigits && telDigits.length >= 8) {
        if (!idx.byTel[telDigits]) idx.byTel[telDigits] = mail;
      }
    }
    if (tablaMail) idx.dbfConMail++;
  }

  return idx;
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

  var nombre = outF || ('clientes_mixnet_completo_' + Date.now() + '.csv');

  for (var i = 0; i < desks.length; i++) {
    try {
      if (fs.existsSync(desks[i]) && fs.statSync(desks[i]).isDirectory()) {
        return path.join(desks[i], nombre);
      }
    } catch (_) { }
  }
  return path.join(__dirname, nombre);
}

/* ============================================================
   MODO EXPLORAR — Lista TODO lo que encuentra (sin extraer)
   ============================================================ */
function modoExplorar() {
  log('=========================================================');
  log('  MODO EXPLORAR — ¿Qué hay en esta PC?');
  log('=========================================================');

  var unidades = detectarUnidades();
  if (!unidades.length) {
    log('[ERROR] No hay ninguna unidad accesible.');
    return;
  }

  // Buscar MXCTACLI
  log('\n--- Buscando MXCTACLI (clientes) ---');
  var comps = buscarMxctacli(unidades);
  if (comps.length) {
    log('\nCompañías encontradas:');
    for (var i = 0; i < comps.length; i++) {
      log('  ' + (i + 1) + ') ' + comps[i].path + ' (' + comps[i].regs + ' registros, ' +
        (comps[i].size / 1024).toFixed(0) + ' KB)');
    }
  } else {
    log('No se encontró MXCTACLI.DBF en rutas típicas.');
  }

  // Escanear todos los DBF
  log('\n--- Escaneando TODOS los archivos DBF ---');
  var resultado = buscarEmailsEnTodos(unidades, true);

  // Resumen
  log('\n=========================================================');
  log('  RESUMEN DEL EXPLORADOR');
  log('=========================================================');
  log('  Unidades accesibles: ' + unidades.length);
  log('  Archivos DBF encontrados: ' + resultado.stats.dbfEncontrados);
  log('  DBF con emails: ' + resultado.stats.conEmail);
  log('  Carpetas recorridas: ' + resultado.stats.carpetas);
  log('  Errores de acceso: ' + resultado.stats.errores);

  // Construir índice y mostrar ejemplos
  if (resultado.dbFiles.length > 0) {
    var idx = buildEmailIndex(resultado.dbFiles);
    log('\n  Emails encontrados por valor: ' + idx.rows.length);
    log('  DBF que contienen emails: ' + idx.dbfConMail);

    if (idx.ejemplos.length > 0) {
      log('\n  Primeros emails encontrados:');
      for (var ei = 0; ei < idx.ejemplos.length; ei++) {
        var ex = idx.ejemplos[ei];
        log('    ' + ex.email + ' | ' + ex.razon + ' | RIF: ' + ex.rif + ' | archivo: ' + ex.archivo);
      }
    }
  }

  // Guardar reporte detallado
  var reportePath = resolveOutPath('exploracion_mixnet_' + Date.now() + '.csv');
  var reporteLines = ['ARCHIVO,REGISTROS,CON_EMAIL,CAMPOS'];
  for (var ri = 0; ri < resultado.dbFiles.length; ri++) {
    var df = resultado.dbFiles[ri];
    reporteLines.push(
      escCSV(df.filePath) + ',' +
      df.rows.length + ',' +
      (df.tieneEmail ? 'SI' : 'NO') + ',' +
      escCSV(df.fields.map(function (f) { return f.name.trim().toLowerCase(); }).join(';'))
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
        if (n.indexOf('rif') !== -1 || n.indexOf('nit') !== -1) marker += ' <<< RIF';
        log('        ' + String(fi + 1).padStart(2) + '. ' + fld.name + ' [' + fld.type + ' ' + fld.len + ']' + marker);
      }
    }
  }

  // También buscar CUALQUIER DBF con emails en esta carpeta
  log('\n=== Buscando CUALQUIER archivo DBF con emails ===');
  var entries;
  try { entries = fs.readdirSync(baseDir); } catch (e) { log('  Error: ' + e.message); return; }

  var totalEmails = 0;
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
    if (mails > 0) {
      log('  [EMAIL] ' + entries[ei] + ': ' + mails + ' registros con email (de ' + db2.rows.length + ' total)');
      totalEmails += mails;
    }
  }
  log('\n  Total emails encontrados por valor: ' + totalEmails);
}

/* ============================================================
   MODO COMPLETO — Flujo automático completo
   ============================================================ */
function modoCompleto(outF) {
  var t0 = Date.now();
  log('=========================================================');
  log('  EXTRACTOR COMPLETO DE CLIENTES MIXNET');
  log('  Solo lee. No modifica nada.');
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

  // PASO 2: Buscar compañía (MXCTACLI)
  log('\n[PASO 2/6] Buscando la tabla de clientes (MXCTACLI)...');
  var comps = buscarMxctacli(unidades);
  if (!comps.length) {
    log('\n[ERROR] No encontré MXCTACLI.DBF en ninguna ruta típica.');
    log('  Intentando escaneo profundo de todas las unidades...');
    // Si no encontró en rutas típicas, el escaneo profundo ya se hizo
    // Si aún nada, reportar
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
      log('  Ejecuta: node extraer-clientes-mixnet.cjs --explorar');
      log('  para ver qué archivos DBF hay en las unidades.');
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

  // PASO 4: Buscar emails en TODOS los DBF de TODAS las unidades
  log('\n[PASO 4/6] Escaneando todas las unidades buscando emails...');
  var resultado = buscarEmailsEnTodos(unidades, true);

  log('\nConstruyendo índice de correos...');
  var idx = buildEmailIndex(resultado.dbFiles);
  log('  Tablas con correo: ' + idx.dbfConMail);
  log('  Emails encontrados por valor: ' + idx.rows.length);

  if (idx.ejemplos.length > 0) {
    log('\n  Ejemplos de emails encontrados:');
    for (var ei = 0; ei < Math.min(10, idx.ejemplos.length); ei++) {
      log('    ' + idx.ejemplos[ei].email + ' | ' + idx.ejemplos[ei].razon);
    }
  }

  // PASO 5: Cruzar correos con clientes
  log('\n[PASO 5/6] Cruzando cada correo con su cliente...');
  var razF = findField(ck, ['razon', 'razonsocial', 'nombre', 'nombrecli', 'cliente', 'denominacion', 'descrip'], null);
  var rifF = findField(ck, ['rif', 'nit', 'cedula', 'cedul', 'identif', 'identidad', 'rifc'], null);
  var codF = findField(ck, ['cod', 'codigo', 'cod_cli', 'codcli', 'cta', 'ctacli', 'deudor', 'cliente'], null);
  var telF = findField(ck, ['telf', 'telef', 'tel', 'tfono', 'tfn', 'movil', 'celular', 'tlf'], null);

  log('  Campos de cruce: razón=' + (razF || '?') + ', RIF=' + (rifF || '?') +
    ', código=' + (codF || '?') + ', teléfono=' + (telF || '?'));

  var conMail = 0;
  var estrategias = { rif: 0, cod: 0, tel: 0, razon: 0 };

  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    var raz = (razF && r[razF] !== undefined) ? String(r[razF]) : '';
    var rif = (rifF && r[rifF] !== undefined) ? String(r[rifF]) : '';
    var cod = (codF && r[codF] !== undefined) ? String(r[codF]) : '';
    var telR = (telF && r[telF] !== undefined) ? String(r[telF]) : '';
    var mail = '';

    // 1) por RIF
    if (!mail && rif) {
      mail = idx.byRif[normTxt(rif)] || '';
      if (mail) estrategias.rif++;
    }
    // 2) por código
    if (!mail && cod) {
      mail = idx.byCod[normTxt(cod)] || '';
      if (mail) estrategias.cod++;
    }
    // 3) por teléfono
    if (!mail && telR) {
      var d = telR.replace(/\D/g, '');
      if (d.length >= 8) {
        mail = idx.byTel[d] || '';
        if (mail) estrategias.tel++;
      }
    }
    // 4) por razón social (fuzzy)
    if (!mail && raz) {
      var hit = fuzzyMatch(raz, idx.byRazon);
      if (hit) {
        mail = hit.mail || '';
        if (mail) estrategias.razon++;
      }
    }

    if (mail) conMail++;
    r['__email'] = mail;
    r['__tiene_email'] = mail ? 'SI' : 'NO';
  }

  log('\n  Resultado del cruce:');
  log('    Por RIF:       ' + estrategias.rif);
  log('    Por código:    ' + estrategias.cod);
  log('    Por teléfono:  ' + estrategias.tel);
  log('    Por razón:     ' + estrategias.razon);
  log('    TOTAL con correo: ' + conMail + ' de ' + rows.length +
    ' (' + (rows.length ? Math.round(conMail / rows.length * 100) : 0) + '%)');

  // PASO 6: Generar CSV
  log('\n[PASO 6/6] Generando archivo CSV...');
  var head = ck.slice();
  if (head.indexOf('__email') === -1) head.push('__email');
  if (head.indexOf('__tiene_email') === -1) head.push('__tiene_email');

  var outPath = resolveOutPath(outF);
  try {
    fs.writeFileSync(outPath, toCSV(rows, head), 'utf8');
  } catch (e) {
    log('[ERROR] No se pudo escribir el CSV: ' + e.message);
    log('  Intentando guardar junto al script...');
    outPath = path.join(__dirname, outF || ('clientes_mixnet_' + Date.now() + '.csv'));
    fs.writeFileSync(outPath, toCSV(rows, head), 'utf8');
  }

  var elapsed = Math.round((Date.now() - t0) / 1000);
  log('\n=========================================================');
  log('  TERMINADO EN ' + elapsed + ' SEGUNDOS');
  log('=========================================================');
  log('  ARCHIVO: ' + outPath);
  log('  ' + rows.length + ' clientes extraidos');
  log('  ' + conMail + ' con correo (' +
    (rows.length ? Math.round(conMail / rows.length * 100) : 0) + '%)');
  log('=========================================================');
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

  // Sin argumentos: flujo completo automático
  if (args.length === 0) {
    log('=========================================================');
    log('  EXTRACTOR DE CLIENTES MIXNET (automático)');
    log('  Sin comandos: ejecutando flujo completo.');
    log('  Para ver qué hay antes: --explorar');
    log('=========================================================');
    modoCompleto(null);
    return;
  }

  // Con argumentos
  var mode = args[0];

  if (mode === '--explorar' || mode === '--explore') {
    modoExplorar();
    return;
  }

  if (mode === '--diagnostico' || mode === '--diag') {
    var base = args[1] || 'M:\\comp01';
    modoDiagnostico(base);
    return;
  }

  if (mode === '--completo' || mode === '--escaneo') {
    var outI = args.indexOf('--out');
    var outF = outI >= 0 ? args[outI + 1] : null;
    modoCompleto(outF);
    return;
  }

  if (mode === '--esquema') {
    var f = args[1];
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
  log('  EXTRACTOR DE CLIENTES MIXNET v2');
  log('=========================================================');
  log('');
  log('  USO RECOMENDADO:');
  log('    node extraer-clientes-mixnet.cjs                 Flujo completo');
  log('    node extraer-clientes-mixnet.cjs --explorar      VER qué hay en la PC');
  log('    node extraer-clientes-mixnet.cjs --diagnostico   Ver emails en una carpeta');
  log('');
  log('  OTROS:');
  log('    --esquema "RUTA\\ARCHIVO.DBF"   Ver campos de un DBF');
  log('    --detectar                       Ver unidades accesibles');
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
