/*
  ============================================================
  JJ Paper — Extractor de CLIENTES desde MixNet ($ MXCTACLI.DBF)
  ------------------------------------------------------------
  Corre en la OTRA PC (Windows 7, Node 13.14), la que tiene las
  unidades M:, P:, Z: montadas de la red local de la empresa.

  LEE SOLO los archivos DBF de dBase y genera listas CSV.
  NO modifica nada en MixNet. Es 100% solo lectura.

  MODOS:
    node extraer-clientes-mixnet.cjs --auto   [recomendado]
        Detecta la compañía activa, muestra su esquema y extrae
        TODO de una sola vez, sin escanear toda la unidad.

    node extraer-clientes-mixnet.cjs --esquema "RUTA\MXCTACLI.DBF"
        Muestra los CAMPOS de la tabla elegida.

    node extraer-clientes-mixnet.cjs --extraer "RUTA\MXCTACLI.DBF" [--out salida.csv]
        Extrae directamente de un archivo específico.

    node extraer-clientes-mixnet.cjs --detectar
        Busca las compañías candidatas (recorre unidades, lento).

    node extraer-clientes-mixnet.cjs
        Muestra esta ayuda.

  ARCHIVO PRINCIPAL (detectado del servidor):
    M:\comp01\MXCTACLI.DBF   <- el más grande = compañía activa

  Compatible con Node 13.14 (CommonJS). 2026-08-31
  ============================================================
*/
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- salida inmediata (consola Windows 7 bufferiza) ---------- */
function say(s){ try { fs.writeSync(1, s + '\n'); } catch(_){ console.log(s); } }

/* ============================================================
   LECTOR DE DBF (dBase III / IV / FoxPro) — solo lectura
   Con PROGRESO en vivo para que en Windows 7 no parezca colgado.
   ============================================================ */
function readDbfHeader(buf){
  const type = buf[0];
  const lastUpd = { y: buf[1] + 1900, m: buf[2], d: buf[3] };
  const numRecords = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  return { type, lastUpd, numRecords, headerLen, recordLen };
}

function decodeStr(buf, start, len){
  let s = '';
  for (let i = start; i < start + len; i++) s += String.fromCharCode(buf[i]);
  return s.replace(/\0+$/, '').trim();
}

function readDbfFields(buf, headerLen){
  const fields = [];
  let off = 32;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D){
    const name = decodeStr(buf, off, 11).replace(/\0/g, '').trim();
    const type = String.fromCharCode(buf[off + 11]);
    const fLen = buf.readUInt16LE(off + 16);
    const dec = buf[off + 17];
    fields.push({ name, type, len: fLen, dec });
    off += 32;
  }
  return fields;
}

// Progreso reescrito sobre la misma línea separando el texto del &&
let _progT0 = 0;
let _progLast = 0;

function parsedb(filePath, withData, verbose){
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    say('  [!] No se pudo leer el archivo: ' + e.message);
    process.exit(1);
  }

  const header = readDbfHeader(buf);
  const fields = readDbfFields(buf, header.headerLen);
  const out = { header, fields, rows: null, filePath };

  if (!withData) return out;

  // Si el archivo es MÁS grande que el doble del tamaño de datos esperado,
  // puede que haya bytes/EOF extra: leer solo hasta el último registro completo.
  const maxDataEnd = Math.min(
    header.headerLen + (header.numRecords * header.recordLen),
    buf.length
  );

  const rows = [];
  const seen = new Set();
  let pos = header.headerLen;

  _progT0 = Date.now();
  _progLast = 0;

  // Colecta de campos numéricos y de texto tal cual
  while (pos + header.recordLen <= maxDataEnd && rows.length < 400000){
    const rec = buf.slice(pos, pos + header.recordLen);

    if (rows.length % 1000 === 0 && verbose){
      // progreso: en qué registro vamos y % del archivo
      const pct = (pos / maxDataEnd * 100).toFixed(1);
      const line = '\r  [progreso] fila ' + rows.length + '/' + header.numRecords +
        ' (' + pct + '%)  ' + filePath;
      try { fs.writeSync(1, line + String.fromCharCode(27) + '[K'); } catch(_){}
    }

    if (rec[0] === 0x2A) { pos += header.recordLen; continue; } // borrado '*'
    if (rec[0] !== 0x20) { pos += header.recordLen; continue; } // no empieza con espacio

    const obj = {};
    let fpos = 1;
    for (const f of fields){
      if (fpos + f.len > rec.length) break;
      let raw = decodeStr(rec, fpos, f.len);
      if (f.type === 'N' || f.type === 'F' || f.type === 'I') raw = raw.trim().replace(/,/g, '.');
      obj[f.name.toLowerCase()] = raw;
      fpos += f.len;
    }

    const sig = obj.razon_social || '';
    if (sig && sig !== '') {
      // si ya vimos esta razón social con el mismo RIF, la saltamos (de-dupe)
      const key = (obj[sigName(fields)] || '') + '|' + sig;
      if (!seen.has(key)){ seen.add(key); rows.push(obj); }
    } else if (!seen.has(JSON.stringify(obj))) {
      seen.add(JSON.stringify(obj));
      rows.push(obj);
    }

    pos += header.recordLen;
  }

  if (verbose){
    try { fs.writeSync(1, '\r                                \r'); } catch(_){}
  }

  out.rows = rows;
  return out;
}

// Nombre del campo que suele ser el RIF/NIT para la clave de de-dupe
function sigName(fields){
  const k = fields.map(f => f.name.toLowerCase());
  const hit = k.find(x => x.indexOf('rif') !== -1 || x.indexOf('nit') !== -1 ||
                x.indexOf('cedula') !== -1 || x.indexOf('ci') === 0);
  return hit || k[1] || 'cliente';
}

/* ============================================================
   DETECCION DE COMPAÑIAS — versión RÁPIDA (sin recorrer todo)
   Solo revisa un set de rutas típicas y elige la activa.
   ============================================================ */
function candidates(){
  const comps = [];
  const roots = ['M:', 'P:', 'Z:', 'C:'];

  for (const r of roots){
    const base = r.endsWith('\\') ? r : r + '\\';
    const tops = ['comp01', 'COMP01', 'comp02', 'COMP02', 'comp03', 'COMP03',
                  'comp01-ORIGINAL'];
    for (const t of tops){
      const dir = path.join(base, t);
      const dbf = path.join(dir, 'MXCTACLI.DBF');
      if (fs.existsSync(dbf)){
        let st, n = -1;
        try { st = fs.statSync(dbf); } catch(_){ continue; }
        try { n = parsedb(dbf, false, false).header.numRecords; } catch(_){}
        comps.push({ dir, path: dbf, size: st.size, mtime: st.mtimeMs, regs: n });
      }
      // también bajo un subdirectorio "MIX11" de la raíz (P:\Elias\... lo saltamos)
    }
  }
  return comps.sort((a,b)=> (b.regs||0) - (a.regs||0) || b.size - a.size);
}

/* ============================================================
   Mapeo de campos -> humano. ADAPTADO a MXCTACLI real.
   ============================================================ */
function findField(keys, candidates, defaultValue){
  const k = keys.map(x=>x.toLowerCase());
  for (const c of candidates){
    const hit = k.find(x => x === c || x.indexOf(c) === 0 || x.indexOf(c) !== -1);
    if (hit) return hit;
  }
  return defaultValue;
}

function escCSV(v){
  v = (v == null ? '' : String(v)).trim();
  if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function toCSV(rows, head){
  const lines = [];
  lines.push(head.join(','));
  for (const r of rows){
    lines.push(head.map(h => escCSV(r[h])).join(','));
  }
  return lines.join('\r\n');
}

/* ============================================================
   MODO ESQUEMA
   ============================================================ */
function modoEsquema(filePath){
  const db = parsedb(filePath, false, true);
  say('Archivo: ' + filePath);
  say('Registros: ' + db.header.numRecords + ' | tipo=' + db.header.type +
      ' | fecha=' + db.header.lastUpd.y + '/' + db.header.lastUpd.m + '/' + db.header.lastUpd.d);
  say('=== CAMPOS (' + db.fields.length + ') ===');
  db.fields.forEach((fld,i)=> say('  ' + String(i+1).padStart(2) + '. ' + fld.name +
      '  [' + fld.type + ' ' + fld.len + (fld.dec>0 ? '.'+fld.dec : '') + ']'));
  say('');
  say('Todos los campos se exportan tal cual al CSV (columnas nombradas con el campo DBF).');
}

/* ============================================================
   MODO EXTRAER — exporta TODOS los campos tal cual
   + algunas columnas humanas derivadas (teléfono, correo, ...).
   Si junto al MXCTACLI hay un MXSUCCLI (sucursales), lo lee y
   completa email/teléfono/dirección cuando el cliente no los tenga.
   ============================================================ */
function modoExtraer(filePath, outF){
  say('Leyendo ' + filePath + ' ...');
  const db = parsedb(filePath, true, true);
  say('Registros totales: ' + db.header.numRecords +
      ' | leídos (activos + dedup): ' + (db.rows ? db.rows.length : 0));

  if (!db.rows || !db.rows.length){
    say('[!] No se extrajeron registros. Revisa que la ruta sea correcta.');
    return;
  }

  const keys = db.fields.map(f=>f.name.toLowerCase());

  // --- CAMPOS relevantes del MXCTACLI ---
  const tel   = findField(keys, ['telf','telef','tel','tfono','tfn','movil','celular','tlf'], null);
  const corr  = findField(keys, ['corr','email','correo','mail','e_mail','e-mail','contact'], null);
  const dir   = findField(keys, ['direccion','direcc','domicilio','dir','direc'], null);
  const ciu   = findField(keys, ['ciudad','poblacion','municipio','zona'], null);
  // código de cliente: suele ser un número/campo clave (codigo, cliente, ctacli, cod_cli)
  const cod   = findField(keys, ['cod','codigo','cod_cli','cliente','ctacli','codcliente','coddeb','deudor','cta'], null);
  const razon = findField(keys, ['razon','razonsocial','nombre','nombrecli','cliente','denominacion','descrip'], null);

  // --- Leer SUCURSALES (MXSUCCLI.DBF en la misma carpeta) para completar datos ---
  const succPath = path.join(path.dirname(filePath), 'MXSUCCLI.DBF');
  let succMap = {};
  let succFields = [];
  if (fs.existsSync(succPath)){
    try {
      say('  (+) Sucursales encontradas: ' + succPath);
      say('      Leyendo sucursales para completar email/teléfono/dirección...');
      const sdb = parsedb(succPath, true, true);
      const sk = sdb.fields.map(f=>f.name.toLowerCase());
      const sTel  = findField(sk, ['telf','telef','tel','tfono','tfn','movil','celular','tlf'], null);
      const sCoor = findField(sk, ['corr','email','correo','mail','e_mail','e-mail','contact'], null);
      const sDir  = findField(sk, ['direccion','direcc','domicilio','dir','direc'], null);
      const sCiu  = findField(sk, ['ciudad','poblacion','municipio','zona'], null);
      // clave de la sucursal hacia el cliente principal
      const sCod  = findField(sk, ['cod','codigo','cod_cli','cliente','ctacli','codcliente','coddeb','deudor','cta'], null);
      succFields = sdb.fields.map(f=>f.name.toLowerCase());
      (sdb.rows||[]).forEach(s => {
        const key = (sCod && s[sCod] !== undefined) ? String(s[sCod]).trim().toLowerCase() : null;
        if (!key || key === '') return;
        if (!succMap[key]) succMap[key] = [];
        succMap[key].push({
          tel:  (sTel  && s[sTel]  !== undefined) ? String(s[sTel]).trim() : '',
          mail: (sCoor && s[sCoor] !== undefined) ? String(s[sCoor]).trim() : '',
          dir:  (sDir  && s[sDir]  !== undefined) ? String(s[sDir]).trim() : '',
          ciu:  (sCiu  && s[sCiu]  !== undefined) ? String(s[sCiu]).trim() : ''
        });
      });
      say('      Sucursales leídas: ' + sdb.rows.length);
    } catch (e){
      say('      [!] No se pudieron leer las sucursales: ' + e.message);
    }
  } else {
    say('  (—) No hay MXSUCCLI.DBF junto al MXCTACLI; no se fusionan sucursales.');
  }

  // --- Buscar EMAIL en TODAS las tablas de la carpeta, POR CONTENIDO ---
  // MixNet puede guardar el correo en cualquier tabla/campo con nombres
  // variables (CORREO, EMAIL, EADR, MXMAIL, CONTACTO, MAILCLI...). Para no
  // depender del nombre, se detecta el email REAL por el VALOR: cualquier
  // texto que contenga "algo@dominio.tld" se considera un correo, sin
  // importar cómo se llame la columna. Se cruza con los clientes por
  // código y por razón social.
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  const dirDBF = path.dirname(filePath);
  const emailExtra = {};   // key -> {mail, tel} cruzándose por código o razón social
  let dbfEscaneados = 0, dbfConEmail = 0, mailHalls = 0;
  try {
    const todos = fs.readdirSync(dirDBF).filter(x => /\.dbf$/i.test(x));
    for (const nom of todos){
      const fp2 = path.join(dirDBF, nom);
      let st2; try { st2 = fs.statSync(fp2); } catch(_){ continue; }
      if (st2.size < 33) continue;
      // saltar respaldos/copias
      if (/copia|backup|respald|original/i.test(nom)) continue;
      dbfEscaneados++;
      let tdb;
      try { tdb = parsedb(fp2, true, false); } catch(_){ continue; }
      if (!tdb.rows || !tdb.rows.length) continue;
      const tk = tdb.fields.map(f=>f.name.toLowerCase());
      // usar el nombre del campo SOLO para el reporte (no para decidir)
      const tCoor = findField(tk, ['corr','correo','email','e_mail','e-mail','cor_elec','mail','contact'], null);
      const tTel  = findField(tk, ['telf','telef','tel','tfono','tfn','movil','celular','tlf'], null);
      const tCod  = findField(tk, ['cod','codigo','cod_cli','codcli','cod_cta','cta','ctacli','cliente','deudor','identif','rif','nit'], null);
      const tRaz  = findField(tk, ['razon','razonsocial','nombre','nombrecli','cliente','descrip','denominacion'], null);

      // Recorrer TODAS las filas y TODOS los campos buscando emails por valor
      let tablaTieneMail = false;
      (tdb.rows||[]).forEach(x => {
        let mail = '';
        let telT = '';
        // si hay un campo "de correo" por nombre, revisarlo primero
        if (tCoor && x[tCoor] !== undefined){
          const v = String(x[tCoor]).trim();
          const m = v.match(EMAIL_RE);
          if (m) mail = m[0];
        }
        // si no, barrer todos los campos buscando un valor con @
        if (!mail){
          for (const f of tdb.fields){
            const fname = f.name.toLowerCase();
            const v = x[fname] !== undefined ? String(x[fname]).trim() : '';
            const m = v.match(EMAIL_RE);
            if (m){ mail = m[0]; break; }
          }
        }
        if (!mail) return;
        tablaTieneMail = true;
        if (tTel && x[tTel] !== undefined) telT = String(x[tTel]).trim();
        // clave por código
        let k = null;
        if (tCod && x[tCod] !== undefined){
          const cc = String(x[tCod]).trim().replace(/\s+/g,'').toLowerCase();
          if (cc){ k = 'cod:' + cc; }
        }
        // y también por razón social (por si no hay código en esa tabla)
        if ((tRaz && x[tRaz] !== undefined)) {
          const rr = String(x[tRaz]).trim().toLowerCase();
          if (rr) emailExtra['raz:'+rr] = emailExtra['raz:'+rr] || { mail: mail, tel: telT };
        }
        if (k && !emailExtra[k]) emailExtra[k] = { mail: mail, tel: telT };
        mailHalls++;
      });
      if (tablaTieneMail) dbfConEmail++;
    }
    if (dbfEscaneados > 0){
      say('  (+) Escaneadas ' + dbfEscaneados + ' tablas .DBF de la carpeta; ' +
          dbfConEmail + ' tenían correo (por valor). Emails hallados: ' + mailHalls);
    }
  } catch(e){
    say('  (—) No se pudo escanear otras tablas: ' + e.message);
  }

  // --- Columnas del CSV: todos los campos del MXCTACLI + derivadas ---
  const head = db.fields.map(f=>f.name.toLowerCase());
  function addCol(name){
    if (head.indexOf(name) === -1) head.push(name);
  }
  addCol('email_otras_tablas');
  addCol('email_sucursal');
  addCol('telefono_sucursal');
  addCol('telefono_principal');
  addCol('tiene_telefono');
  addCol('tiene_correo');

  const rows = [];
  let fusEmail = 0, fusTel = 0;
  (db.rows || []).forEach(r => {
    const out = {};
    head.forEach(h => { if (Object.prototype.hasOwnProperty.call(r, h)) out[h] = r[h]; });
    if (tel) out['telefono_principal'] = r[tel] || '';
    // correo directo real (dejamos también el campo original si existe)
    const mailDirecto = (corr && r[corr] !== undefined) ? String(r[corr]).trim() : '';

    // buscar datos de sucursal fusionados
    const key = (cod && r[cod] !== undefined) ? String(r[cod]).trim().toLowerCase() : '';
    let sTel='', sMail='', sDir='', sCiu='';
    if (key && succMap[key] && succMap[key].length){
      const s0 = succMap[key][0];
      sTel  = s0.tel || '';
      sMail = s0.mail || '';
      sDir  = s0.dir || '';
      sCiu  = s0.ciu || '';
    }
    // buscar en OTRAS tablas con correo (emailExtra): por código y por razón social
    let eMail='', eTel='';
    const keyNorm = (cod && r[cod] !== undefined) ? String(r[cod]).replace(/\s+/g,'').toLowerCase() : '';
    const razNorm = (razon && r[razon] !== undefined) ? String(r[razon]).trim().toLowerCase() : '';
    if (keyNorm && emailExtra['cod:'+keyNorm] && emailExtra['cod:'+keyNorm].mail){
      eMail = emailExtra['cod:'+keyNorm].mail; eTel = emailExtra['cod:'+keyNorm].tel || '';
    }
    if (!eMail && razNorm && emailExtra['raz:'+razNorm] && emailExtra['raz:'+razNorm].mail){
      eMail = emailExtra['raz:'+razNorm].mail; eTel = emailExtra['raz:'+razNorm].tel || '';
    }
    // fusión final: principal -> sucursal -> otras tablas
    const correoFinal = mailDirecto || sMail || eMail;
    const telFinal = out['telefono_principal'] || sTel || eTel;
    if (!mailDirecto && (sMail || eMail)){ fusEmail++; }
    if (!out['telefono_principal'] && (sTel || eTel)){ fusTel++; }

    out['email_otras_tablas'] = eMail;
    out['email_sucursal'] = sMail;
    out['telefono_sucursal'] = sTel;
    // si hay un campo de correo en la tabla principal, no "reescribir" el valor; solo la columna derivada
    out['telefono_principal'] = telFinal;
    out['tiene_telefono'] = telFinal ? 'SI' : 'NO';
    out['tiene_correo']   = (correoFinal) ? 'SI' : 'NO';
    rows.push(out);
  });

  const csv = toCSV(rows, head);
  const outPath = path.isAbsolute(outF) ? outF : path.join(__dirname, outF);
  fs.writeFileSync(outPath, csv, 'utf8');
  say('CSV generado: ' + outPath + '  (' + rows.length + ' registros, ' + head.length + ' columnas)');
  say('');
  say('Resumen de calidad:');
  const withTel = rows.filter(r => String(r['tiene_telefono']||'')==='SI').length;
  const withMail = rows.filter(r => String(r['tiene_correo']||'')==='SI').length;
  say('  con teléfono: ' + withTel + '  (' + (rows.length?Math.round(withTel/rows.length*100):0) + '%)');
  say('  con correo  : ' + withMail + '  (' + (rows.length?Math.round(withMail/rows.length*100):0) + '%)');
  say('  correo completado desde sucursal: ' + fusEmail);
  say('  teléfono completado desde sucursal: ' + fusTel);
  if (rows.length && (withMail===0) && !fs.existsSync(path.join(path.dirname(filePath),'MXSUCCLI.DBF'))){
    say('');
    say('  OJO: no hay correo en MXCTACLI ni MXSUCCLI cercano. Si en MixNet ves el email en OTRA');
    say('  tabla (p.ej. MXOFECLI/MXAGENDA), dime y lo agrego.');
  }
}

/* ============================================================
   MODO DIAGNOSTICO — escanea TODAS las tablas DBF de la carpeta,
   detecta emails por VALOR (texto que parezca un correo) y reporta
   DÓNDE está cada email. Solo lectura. Clave para ajustar.
   ============================================================ */
function modoDiagnostico(baseDir){
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  say('=========================================================');
  say('  DIAGNÓSTICO DE EMAIL/CONTACTOS EN MIXNET (solo lectura)');
  say('=========================================================');
  say('Carpeta base: ' + baseDir);

  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()){
    say('[!] La carpeta no existe o no es un directorio: ' + baseDir);
    say('    Uso correcto:  node extraer-clientes-mixnet.cjs --diagnostico --dir "M:\\comp01"');
    return;
  }

  // 1) Listar panel prioritario
  var archivos = ['MXCTACLI.DBF','MXSUCCLI.DBF','MXAGENDA.DBF',
                  'MXOFECLI.DBF','MXCLIESP.DBF','MXCTAZON.DBF','MXCTADPT.DBF'];
  say('\n=== PANEL PRIORITARIO ===');
  archivos.forEach(function(nombre){
    var fp = path.join(baseDir, nombre);
    if (!fs.existsSync(fp)){
      say('\n[-] ' + nombre + ': NO EXISTE');
      return;
    }
    say('\n[+] ' + nombre + ':');
    var db;
    try { db = parsedb(fp, false, true); } catch(e){ say('    Error: ' + e.message); return; }
    say('    Registros: ' + db.header.numRecords +
        ' | fecha: ' + db.header.lastUpd.y + '/' + db.header.lastUpd.m + '/' + db.header.lastUpd.d);
    say('    Campos (' + db.fields.length + '):');
    db.fields.forEach(function(f,i){
      var marker = '';
      var n = f.name.toLowerCase();
      if (n.indexOf('cor') !== -1 || n.indexOf('mail') !== -1 || n.indexOf('email') !== -1) marker += ' <<< EMAIL';
      if (n.indexOf('tel') !== -1 || n.indexOf('tlf') !== -1 || n.indexOf('tfn') !== -1) marker += ' <<< TEL';
      if (n.indexOf('dir') !== -1 || n.indexOf('domic') !== -1) marker += ' <<< DIR';
      if (n.indexOf('rif') !== -1 || n.indexOf('nit') !== -1 || n.indexOf('ci') === 0) marker += ' <<< ID';
      if (n.indexOf('cli') !== -1 || n.indexOf('cod') !== -1 || n.indexOf('cta') !== -1) marker += ' <<< COD';
      say('      ' + String(i+1).padStart(2) + '. ' + f.name + ' [' + f.type + ' ' + f.len + ']' + marker);
    });
  });

  // 2) Escaneo TOTAL: cada DBF, buscar emails por VALOR
  say('\n\n=== ESCANEO TOTAL DE TODAS LAS TABLAS (busca emails por valor) ===');
  var encontr = 0;
  var soloHeader = 0;
  var conMail = 0;
  try {
    var todos = fs.readdirSync(baseDir).filter(function(x){ return /\.dbf$/i.test(x) && !/copia|backup|respald|original/i.test(x); });
    if (!todos.length){ say('  (sin archivos .DBF en la carpeta)'); }
    todos.forEach(function(nom){
      var fp = path.join(baseDir, nom);
      var st;
      try { st = fs.statSync(fp); } catch(_){ return; }
      if (st.size < 33){ soloHeader++; return; }
      var db;
      try { db = parsedb(fp, true, false); } catch(_){ return; }
      if (!db.rows || !db.rows.length){ soloHeader++; return; }
      // buscar primer email por valor en cualquier campo
      var mailHallado = null, campoHallado = null, ejemplos = [];
      for (var i = 0; i < db.rows.length; i++){
        var row = db.rows[i];
        for (var j = 0; j < db.fields.length; j++){
          var f = db.fields[j];
          var fname = f.name.toLowerCase();
          var v = row[fname] !== undefined ? String(row[fname]) : '';
          var m = v.match(EMAIL_RE);
          if (m && m[0] && m[0].indexOf('@') !== -1){
            if (!mailHallado){ mailHallado = m[0]; campoHallado = f.name; }
            if (ejemplos.indexOf(m[0]) === -1 && ejemplos.length < 2) ejemplos.push(m[0]);
          }
          if (mailHallado && ejemplos.length >= 2) break;
        }
        if (mailHallado && ejemplos.length >= 2) break;
      }
      if (mailHallado){
        conMail++;
        say('  [' + nom + ']  campo=' + campoHallado + '  ej.: ' + ejemplos.join(' | '));
      }
    });
  } catch(e){
    say('  (error escaneando: ' + e.message + ')');
  }
  say('');
  say('  Tablas escaneadas: ' + (todos ? todos.length : 0) +
      ' | con email por valor: ' + conMail +
      ' | vacías/sin datos: ' + soloHeader);
  say('');
  say('Las tablas marcadas arriba son las que guardan el correo.');
  say('Con eso ajustamos el extractor para el 100% de los emails.');
}

/* ============================================================
   MODO EMAILS — muestra los emails encontrados POR VALOR en TODAS
   las tablas, junto a la clave (código y razón social) de cada uno,
   para ver si el cruce con los clientes es posible. Solo lectura.
   ============================================================ */
function modoEmails(baseDir){
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  say('=========================================================');
  say('  LISTADO DE EMAILS ENCONTRADOS EN MIXNET (solo lectura)');
  say('=========================================================');
  say('Carpeta base: ' + baseDir);

  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()){
    say('[!] La carpeta no existe o no es un directorio: ' + baseDir);
    say('    Uso:  node extraer-clientes-mixnet.cjs --emails --dir "M:\\comp01"');
    return;
  }

  let total = 0;
  try {
    const todos = fs.readdirSync(baseDir).filter(x => /\.dbf$/i.test(x) && !/copia|backup|respald|original/i.test(x));
    for (const nom of todos){
      const fp = path.join(baseDir, nom);
      let st; try { st = fs.statSync(fp); } catch(_){ continue; }
      if (st.size < 33) continue;
      let db; try { db = parsedb(fp, true, false); } catch(_){ continue; }
      if (!db.rows || !db.rows.length) continue;
      const tk = db.fields.map(f=>f.name.toLowerCase());
      const tCod = findField(tk, ['cod','codigo','cod_cli','codcli','cod_cta','cta','ctacli','cliente','deudor','identif','rif','nit'], null);
      const tRaz = findField(tk, ['razon','razonsocial','nombre','nombrecli','cliente','descrip','denominacion'], null);

      let tablaConMail = 0;
      const mostrados = [];
      for (const row of db.rows){
        let mail = null;
        for (const f of db.fields){
          const v = row[f.name.toLowerCase()] !== undefined ? String(row[f.name.toLowerCase()]).trim() : '';
          const m = v.match(EMAIL_RE);
          if (m){ mail = m[0]; break; }
        }
        if (!mail) continue;
        tablaConMail++;
        total++;
        const codVal = (tCod && row[tCod] !== undefined) ? String(row[tCod]).trim() : '';
        const razVal = (tRaz && row[tRaz] !== undefined) ? String(row[tRaz]).trim() : '';
        if (mostrados.length < 15) mostrados.push('    cod=[' + codVal + '] razon=[' + razVal + ']  EMAIL=' + mail);
      }
      if (tablaConMail){
        say('\n[' + nom + ']  ' + tablaConMail + ' emails:');
        mostrados.forEach(m => say(m));
        if (tablaConMail > 15) say('    ... y ' + (tablaConMail - 15) + ' más');
      }
    }
  } catch(e){
    say('  (error: ' + e.message + ')');
  }
  say('\nTotal de emails encontrados por valor en todas las tablas: ' + total);
  say('');
  say('Si los emails aparecen arriba pero en el CSV salen vacíos, el CRUCE');
  say('con los clientes no coincide (código/razón social distintos).');
}

/* ============================================================
   MODO AUTO — detecta la principal + esquema + extrae todo
   ============================================================ */
function modoAuto(outF){
  say('=========================================================');
  say('  EXTRACTOR DE CLIENTES MIXNET  (auto)');
  say('=========================================================');

  // 1) Detectar compañías candidatas (rápido, rutas típicas)
  say('\n[1/3] Detectando compañías activas (rutas típicas)...');
  const comps = candidates();
  if (!comps.length){
    say('[!] No encontré ningún MXCTACLI.DBF en las rutas típicas.');
    say('    Corre en modo --detectar (recorre unidades, más lento) para localizarlo.');
    process.exit(1);
  }
  comps.forEach((c,i)=>{
    say('  ' + (i+1) + ') ' + c.dir.replace(/\\+$/, '') +
        '  | registros=' + (c.regs>=0?c.regs:'?') +
        ' | ' + (c.size/1024).toFixed(0) + ' KB');
  });
  const best = comps[0];
  say('  -> Compañía ACTIVA estimada: ' + best.dir.replace(/[\\\/]+$/, ''));

  // 2) Esquema
  say('\n[2/3] Leyendo esquema de ' + best.dir.replace(/[\\\/]+$/, '') + '\\MXCTACLI.DBF ...');
  const db = parsedb(best.path, false, true);
  say('  ' + db.fields.length + ' campos | ' + db.header.numRecords + ' registros');
  db.fields.forEach((fld,i)=> say('    ' + String(i+1).padStart(2) + '. ' + fld.name +
      ' [' + fld.type + ' ' + fld.len + ']'));

  // 3) Extraer
  say('\n[3/3] Extrayendo clientes...');
  const out = outF || ('clientes_mixnet_' + Date.now() + '.csv');
  modoExtraer(best.path, out);

  say('');
  say('✔ Terminado. Revisa el CSV generado.');
}

/* ============================================================
   MODO ESCANEO — FLUJO ÚNICO, AUTOMÁTICO Y COMPLETO.
   No pide nada: detecta la compañía activa, recoge TODOS los
   clientes con todos sus campos, escanea TODAS las unidades en
   busca del email por VALOR (@) en cualquier tabla, cruza por
   razón social y código, y genera el CSV final. Termina solo.
   ============================================================ */
const EXCLUDE_SCAN = /RESPAMIX|copia|backup|respald|\d{4}-\d{2}-\d{2}|servidor|windows|program files|appdata|perflogs|\$recycle|fonts|drivers|\.git|node_modules|\$windows/i;

function walkScan(dir, depth, mask, files){
  if (depth > 14) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return; }
  for (const e of entries){
    const fp = path.join(dir, e.name);
    if (e.isDirectory()){
      if (EXCLUDE_SCAN.test(e.name)) continue;
      walkScan(fp, depth + 1, mask, files);
    } else if (e.isFile() && mask.test(e.name)){
      let st; try { st = fs.statSync(fp); } catch(_){ continue; }
      if (st.size < 33) continue;
      files.push({ path: fp, size: st.size });
    }
  }
}

function findAnyMxctacli(){
  // Si candidates() no encontró la compañía en rutas típicas,
  // recorremos TODAS las unidades en busca de cualquier MXCTACLI.DBF
  const out = [];
  const drives = ['M:', 'P:', 'Z:', 'C:'];
  for (const d of drives){
    const root = d.endsWith('\\') ? d : d + '\\';
    if (!fs.existsSync(root)) continue;
    const files = [];
    walkScan(root, 0, /^MXCTACLI\.dbf$/i, files);
    files.forEach(f => {
      const dir = path.dirname(f.path);
      if (/EJ\d+$|EJERCICIOS/i.test(dir)) return;
      out.push({ dir, path: f.path, size: f.size });
    });
  }
  return out;
}

function modoEscaneo(outF){
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/ig;
  const t0 = Date.now();
  say('=========================================================');
  say('  FLUJO COMPLETO: detecta, escanea y arma el archivo solo');
  say('  (solo lectura — NO modifica nada en MixNet)');
  say('=========================================================');

  // ---- PASO 1: localizar la compañía activa (MXCTACLI) ----
  say('\n[1/6] Localizando la base de clientes (MXCTACLI)...');
  let comps = candidates();
  if (!comps.length){
    say('  No está en rutas típicas. Buscando en TODAS las unidades...');
    comps = findAnyMxctacli();
  }
  if (!comps.length){
    say('[ERROR] No encontré ningún MXCTACLI.DBF en ninguna unidad.');
    say('  Verifica que la red esté conectada o monta la unidad M:.');
    say('');
    say('  INFO: Si el archivo se llama OtraCosa.DBF, avísame el nombre real');
    say('  y ajusto el script. Por ahora el flujo se detiene aquí.');
    return;
  }
  const best = comps.sort((a,b)=> (b.regs||0) - (a.regs||0) || b.size - a.size)[0];
  say('  Compañía activa: ' + best.dir.replace(/[\\\/]+$/,''));
  say('  Archivo: ' + best.path);

  // ---- PASO 2: leer TODOS los clientes con TODOS sus campos ----
  say('\n[2/6] Leyendo todos los clientes y sus datos...');
  const cdb = parsedb(best.path, true, false);
  say('  Clientes encontrados: ' + (cdb.rows||[]).length);
  say('  Campos: ' + cdb.fields.map(f=>f.name).join(', '));
  const ck = cdb.fields.map(f=>f.name.toLowerCase());
  if (!(cdb.rows||[]).length){ say('[ERROR] MXCTACLI no tiene registros.'); return; }

  // ---- PASO 3: escanear TODAS las unidades buscando emails por valor ----
  say('\n[3/6] Escaneando TODAS las unidades en busca del email del cliente...');
  say('  (Esto puede tardar varios minutos. Busca el email por su valor @');
  say('   en cada tabla que encuentre, esté donde esté.)');
  const emailPorRazon = {};
  const emailPorCod = {};
  const emailSuelto = [];
  const archivosConMail = [];
  let dbfVistos = 0, dbfConMail = 0, archivosVistos = 0;

  const drives = ['M:', 'P:', 'Z:', 'C:'];
  for (const d of drives){
    const root = d.endsWith('\\') ? d : d + '\\';
    if (!fs.existsSync(root)) continue;
    const files = [];
    walkScan(root, 0, /\.dbf$/i, files);
    if (files.length) say('  Unidad ' + d + ': ' + files.length + ' archivos DBF...');
    for (const f of files){
      archivosVistos++;
      if (archivosVistos % 1000 === 0) say('    ...' + archivosVistos + ' archivos revisados');
      let db;
      try { db = parsedb(f.path, true, false); } catch(_){ continue; }
      if (!db.rows || !db.rows.length) continue;
      dbfVistos++;
      const tk = db.fields.map(x=>x.name.toLowerCase());
      const tRaz = findField(tk, ['razon','razonsocial','nombre','nombrecli','cliente','denominacion','descrip'], null);
      const tCod = findField(tk, ['cod','codigo','cod_cli','codcli','cta','ctacli','deudor','cliente'], null);
      let tablaMail = false;
      for (const row of db.rows){
        let mail = '';
        for (const fld of db.fields){
          const v = row[fld.name.toLowerCase()] !== undefined ? String(row[fld.name.toLowerCase()]) : '';
          const m = v.match(EMAIL_RE);
          if (m && m[0]){ mail = m[0]; break; }
        }
        if (!mail) continue;
        tablaMail = true;
        let raz = (tRaz && row[tRaz] !== undefined) ? String(row[tRaz]).trim() : '';
        let codv = (tCod && row[tCod] !== undefined) ? String(row[tCod]).trim() : '';
        if (raz){ const k = raz.toLowerCase(); if (!emailPorRazon[k]) emailPorRazon[k] = {}; emailPorRazon[k][mail.toLowerCase()] = mail; }
        if (codv){ const k = codv.replace(/\s+/g,'').toLowerCase(); if (!emailPorCod[k]) emailPorCod[k] = {}; emailPorCod[k][mail.toLowerCase()] = mail; }
        if (!raz && !codv) emailSuelto.push({ archivo: f.path, mail });
      }
      if (tablaMail){ dbfConMail++; archivosConMail.push(f.path); }
    }
  }
  say('  → Tablas DBF revisadas: ' + dbfVistos);
  say('  → Tablas con email: ' + dbfConMail);
  say('  → Emails asociados a una razón social: ' + Object.keys(emailPorRazon).length);
  say('  → Emails asociados a un código: ' + Object.keys(emailPorCod).length);

  // ---- PASO 4: cruzar emails con los clientes ----
  say('\n[4/6] Cruzando cada email con su cliente...');
  const rows = (cdb.rows||[]).map(r => {
    const out = {};
    cdb.fields.forEach(f => { const k = f.name.toLowerCase(); out[k] = r[k] !== undefined ? r[k] : ''; });
    return out;
  });
  const razF = findField(ck, ['razon','razonsocial','nombre','nombrecli','cliente','denominacion','descrip'], null);
  const codF = findField(ck, ['cod','codigo','cod_cli','codcli','cta','ctacli','deudor','cliente'], null);
  let conMail = 0;
  rows.forEach(r => {
    let raz = (razF && r[razF] !== undefined) ? String(r[razF]).trim() : '';
    let codf = (codF && r[codF] !== undefined) ? String(r[codF]).trim() : '';
    let mail = '';
    if (raz && emailPorRazon[raz.toLowerCase()]){ const a = Object.keys(emailPorRazon[raz.toLowerCase()]); if (a.length) mail = a[0]; }
    if (!mail && codf && emailPorCod[codf.replace(/\s+/g,'').toLowerCase()]){ const a = Object.keys(emailPorCod[codf.replace(/\s+/g,'').toLowerCase()]); if (a.length) mail = a[0]; }
    if (mail) conMail++;
    r['__email'] = mail;
    r['__tiene_email'] = mail ? 'SI' : 'NO';
  });
  say('  Clientes con email: ' + conMail + ' de ' + rows.length +
      ' (' + (rows.length ? Math.round(conMail/rows.length*100) : 0) + '%)');

  // ---- PASO 5: armar el CSV con TODOS los campos del cliente + email ----
  say('\n[5/6] Armando el archivo final...');
  let head = ck.slice();
  if (head.indexOf('__email') === -1) head.push('__email');
  if (head.indexOf('__tiene_email') === -1) head.push('__tiene_email');
  const lines = [head.join(',')];
  rows.forEach(r => {
    lines.push(head.map(h => escCSV(r[h])).join(','));
  });
  const outPath = path.isAbsolute(outF) ? outF : path.join(__dirname, outF || 'clientes_mixnet_completo.csv');
  fs.writeFileSync(outPath, lines.join('\r\n'), 'utf8');

  // ---- PASO 6: resumen ----
  say('\n[6/6] Terminado en ' + Math.round((Date.now()-t0)/1000) + 's.');
  say('=========================================================');
  say('  ARCHIVO GENERADO:  ' + outPath);
  say('  ' + rows.length + ' clientes | ' + conMail + ' con email (' +
      (rows.length ? Math.round(conMail/rows.length*100) : 0) + '%)');
  say('=========================================================');
  if (archivosConMail.length){
    say('  El email se encontró en estas tablas:');
    const vis = {};
    archivosConMail.forEach(p => { if (!vis[p]){ vis[p] = true; say('    ' + p); } });
  }
  if (emailSuelto.length){
    say('  Nota: ' + emailSuelto.length + ' emails en tablas sin campo de');
    say('  razón/código no se cruzaron. Ejemplos:');
    const vis = {};
    emailSuelto.slice(0,20).forEach(s => { const k = s.archivo; if (!vis[k]){ vis[k]=true; say('    ' + s.archivo + ' → ' + s.mail); } });
  }
  say('');
  say('  Revisa ' + outPath + ' en la columna __email (y __tiene_email = SI).');
  say('  Si aún faltan muchos, dime cuál es el nombre real de la tabla del');
  say('  correo que ves en MixNet y ajusto el cruce.');
}

/* ============================================================
   MODO DETECTAR — recorre unidades en busca de compañías
   (LENTO en redes; preferir --auto).
   ============================================================ */
const EXCLUDE_DIR = /RESPAMIX|ORIGINAL|Completo|no usar|\d{4}-\d{2}-\d{2}|[Xx] ?EJ|servidor|backup|respald/i;

function walkForDbf(dir, depth, found){
  if (depth > 10) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return; }
  for (const e of entries){
    const fp = path.join(dir, e.name);
    if (e.isDirectory()){
      if (EXCLUDE_DIR.test(e.name)) continue;
      walkForDbf(fp, depth + 1, found);
    } else if (e.isFile() && /^MXCTACLI\.dbf$/i.test(e.name)){
      let st; try { st = fs.statSync(fp); } catch(_){ continue; }
      found.push({ compDir: path.dirname(fp), path: fp, size: st.size, mtime: st.mtimeMs });
    }
  }
}

function modoDetectar(){
  const drives = ['M:', 'P:', 'Z:', 'C:'];
  say('\nEscaneando MXCTACLI.DBF (esto puede tardar en red)...');
  const found = [];
  for (const d of drives){
    const root = d.endsWith('\\') ? d : d + '\\';
    if (fs.existsSync(root)){ say('  ... ' + d); walkForDbf(root, 0, found); }
  }
  say('Encontrados ' + found.length + ' archivos MXCTACLI.DBF.');

  // agrupar solo por raíz de compañía (sin EJ)
  const comps = [];
  const uniq = {};
  for (const f of found){
    if (/EJ\d+$/i.test(f.compDir)) continue;
    let n=-1; try { n = parsedb(f.path,false,false).header.numRecords; } catch(_){}
    const rootP = f.compDir;
    if (!uniq[rootP] || n > (uniq[rootP].regs||0)){
      uniq[rootP] = { dir: f.compDir, path: f.path, size: f.size, mtime: f.mtime, regs: n };
    }
  }
  comps.push.apply(comps, Object.values(uniq).sort((a,b)=>(b.regs||0)-(a.regs||0)));

  say('');
  say('=== COMPAÑÍAS (la de más registros primero = posible activa) ===');
  comps.forEach((c,i)=> say('  ' + (i+1) + ') ' + c.dir +
      '  | registros=' + (c.regs>=0?c.regs:'?') + ' | ' + new Date(c.mtime).toLocaleString()));
  say('');
  say('Siguiente:  node extraer-clientes-mixnet.cjs --auto');
}

/* ============================================================
   MAIN
   ============================================================ */
function main(){
  const args = process.argv.slice(2);
  const mode = args.find(a => a.startsWith('--'));
  const outI = args.indexOf('--out');
  const outF = outI>=0 ? args[outI+1] : null;

  if (mode === '--auto'){
    modoAuto(outF);
    return;
  }

  if (mode === '--diagnostico'){
    var di = args.indexOf('--dir');
    var base = di !== -1 ? args[di+1] : 'M:\\comp01';
    modoDiagnostico(base);
    return;
  }

  if (mode === '--emails'){
    var di2 = args.indexOf('--dir');
    var base2 = di2 !== -1 ? args[di2+1] : 'M:\\comp01';
    modoEmails(base2);
    return;
  }

  if (mode === '--escaneo'){
    modoEscaneo(outF);
    return;
  }

  if (mode && mode.indexOf('--esquema') === 0){
    const f = args[args.indexOf('--esquema')+1];
    if (!f){ say('Falta la ruta. Ej: --esquema "M:\\comp01\\MXCTACLI.DBF"'); return; }
    modoEsquema(f);
    return;
  }

  if (mode && mode.indexOf('--extraer') === 0){
    const f = args[args.indexOf('--extraer')+1];
    if (!f){ say('Falta la ruta. Ej: --extraer "M:\\comp01\\MXCTACLI.DBF" [--out salida.csv]'); return; }
    modoExtraer(f, outF || 'clientes_mixnet.csv');
    return;
  }

  if (mode === '--detectar'){
    modoDetectar();
    return;
  }

  // ayuda
  say('=========================================================');
  say('  EXTRACTOR DE CLIENTES MIXNET  (envía a otra PC con Node 13)');
  say('=========================================================');
  say('');
  say('RECOMENDADO — un solo comando detecta, muestra esquema y extrae:');
  say('   node extraer-clientes-mixnet.cjs --auto');
  say('');
  say('Otros modos:');
  say('   --esquema "RUTA\\MXCTACLI.DBF"    ver los campos de la tabla');
  say('   --extraer "RUTA\\MXCTACLI.DBF"    extraer a CSV (con --out salida.csv)');
  say('   --diagnostico [--dir RUTA]        ver campos de MXCTACLI+SUCCLI+AGENDA');
  say('                                     y LOCALIZAR dónde está el email');
  say('   --escaneo [--out salida.csv]      ESCANEO PROFUNDO de TODAS las unidades:');
  say('                                     busca emails por valor en TODO y los');
  say('                                     cruza con clientes por razón social');
  say('   --detectar                       buscar compañías (recorre unidades, lento)');
  say('');
  say('Detección conocida del servidor:  M:\\comp01\\MXCTACLI.DBF');
  say('');
  say('El CSV exporta TODOS los campos de la tabla + columnas derivadas');
  say('(email_sucursal, telefono_sucursal, telefono_principal,');
  say(' tiene_telefono, tiene_correo).');
  say('Si hay MXSUCCLI.DBF junto al MXCTACLI, se fusiona para');
  say('completar el email/teléfono/dirección de los clientes.');
  say('');
  say('COMANDO UNO-LINER TÍPICO:');
  say('   node extraer-clientes-mixnet.cjs --auto --out clientes.csv');
}

main();
