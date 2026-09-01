/*
  ============================================================
  JJ Paper — Extractor de CLIENTES desde MixNet (DBF dBase)
  ------------------------------------------------------------
  Corre en la PC que tiene acceso a las unidades de la red de
  la empresa (C:, M:, P:, Z:, y carpetas RESPAMIX con respaldos).

  Solo LEE archivos DBF. NO modifica nada en MixNet.

  MODO PRINCIPAL (recomendado, flujo completo automático):
    node extraer-clientes-mixnet.cjs --completo [--out salida.csv]

  Otros modos:
    --esquema "RUTA\MXCTACLI.DBF"    ver campos de una tabla
    --extraer "RUTA\MXCTACLI.DBF"    extraer de un archivo puntual
    --diagnostico [--dir RUTA]       ver dónde está el email
    --emails [--dir RUTA]            listar emails por valor
    --detectar                      buscar compañías (recorre unidades)

  Compatible con Node 13 (CommonJS). 2026-09-01
  ============================================================
*/
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- salida inmediata (Windows 7 bufferiza) ---------- */
function say(s){ try { fs.writeSync(1, s + '\n'); } catch(_){ console.log(s); } }

/* ============================================================
   LECTOR DE DBF
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
  for (let i = start; i < start + len; i++){
    const c = buf[i];
    if (c === 0) break; // null terminator
    s += String.fromCharCode(c);
  }
  return s.trim();
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

let _progT0 = 0;
let _progLast = 0;

function parsedb(filePath, withData, verbose){
  let buf;
  try { buf = fs.readFileSync(filePath); }
  catch (e) {
    say('  [!] No se pudo leer el archivo: ' + e.message);
    process.exit(1);
  }

  const header = readDbfHeader(buf);
  const fields = readDbfFields(buf, header.headerLen);
  const out = { header, fields, rows: null, filePath };

  if (!withData) return out;

  // Seguridad: solo leer hasta donde haya registros completos reales
  const maxDataEnd = Math.min(
    header.headerLen + (header.numRecords * header.recordLen),
    buf.length
  );

  const rows = [];
  const seen = new Set();
  let pos = header.headerLen;

  _progT0 = Date.now();
  _progLast = 0;

  while (pos + header.recordLen <= maxDataEnd && rows.length < 500000){
    const rec = buf.slice(pos, pos + header.recordLen);

    if (rows.length % 1000 === 0 && verbose){
      const pct = (pos / maxDataEnd * 100).toFixed(1);
      try { fs.writeSync(1, '\r  [progreso] fila ' + rows.length + '/' + header.numRecords +
        ' (' + pct + '%)'); } catch(_){}
    }

    if (rec[0] === 0x2A || rec[0] !== 0x20){
      pos += header.recordLen; continue;
    }

    const obj = {};
    let fpos = 1;
    for (const f of fields){
      if (fpos + f.len > rec.length) break;
      let raw = decodeStr(rec, fpos, f.len);
      if (f.type === 'N' || f.type === 'F' || f.type === 'I') raw = raw.trim().replace(/,/g, '.');
      if (fpos + f.len <= rec.length) obj[f.name.trim().toLowerCase()] = raw;
      fpos += f.len;
    }

    // dedupe por llave estable
    const key = JSON.stringify(obj);
    if (!seen.has(key)){ seen.add(key); rows.push(obj); }

    pos += header.recordLen;
  }

  if (verbose){ try { fs.writeSync(1, '\r                                \r'); } catch(_){} }

  out.rows = rows;
  return out;
}

/* ============================================================
   HELPERS
   ============================================================ */
function findField(keys, candidates, defaultValue){
  const k = keys.map(x => x.toLowerCase());
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

// Normaliza texto para cruces: minúsculas, sin acentos, sin símbolos raros
function normTxt(s){
  if (s == null) return '';
  s = String(s).toLowerCase().trim();
  s = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  s = s.replace(/[^a-z0-9]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Devuelve palabras "significativas" para coincidencia difusa
function tokenize(s){
  return normTxt(s).split(' ').filter(w => w.length > 1);
}

// Extrae el primer email real de un texto
function extractEmail(v){
  if (v == null) return '';
  const m = String(v).match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return m ? m[0] : '';
}

// Extrae el primer teléfono (>=7 dígitos) de un texto
function extractPhone(v){
  if (v == null) return '';
  const s = String(v).replace(/\s+/g, '');
  const m = s.match(/\d{9,}/);
  return m ? m[0] : '';
}

/* ============================================================
   CANDIDATOS / LOCALIZACIÓN DE MXCTACLI
   ============================================================ */
const ROOTS = ['M:', 'P:', 'Z:', 'C:', 'D:', 'E:', 'F:'];

function candidates(){
  const comps = [];
  for (const r of ROOTS){
    if (!fs.existsSync(r.endsWith('\\') ? r : r + '\\')) continue;
    const base = r.endsWith('\\') ? r : r + '\\';
    const tops = ['comp01','COMP01','comp02','COMP02','comp03','COMP03','comp01-ORIGINAL'];
    for (const t of tops){
      const dir = path.join(base, t);
      const dbf = path.join(dir, 'MXCTACLI.DBF');
      if (fs.existsSync(dbf)){
        let st, n = -1;
        try { st = fs.statSync(dbf); } catch(_){ continue; }
        try { n = parsedb(dbf, false, false).header.numRecords; } catch(_){}
        comps.push({ dir, path: dbf, size: st.size, mtime: st.mtimeMs, regs: n });
      }
    }
  }
  return comps.sort((a,b) => (b.regs||0) - (a.regs||0) || b.size - a.size);
}

// NO excluimos RESPAMIX (los respaldos de MixNet suelen estar ahí y contienen
// los correos de clientes). Solo se evitan carpetas de sistema irrelevantes.
const EXCLUDE_SCAN = /windows|program files|programdata|appdata|perflogs|\$recycle|fonts|drivers|\.git|node_modules|\$windows|bluestacks|anaconda|nodejs|python|nvidia| intel\b|\.thumbnails|isabel\/dcim|music|videos|pictures|musica/i;

// Escaneo total y profundo: baja hasta 40 niveles (cualquier carpeta anidada).
// `stats` acumula: carpetas/folders revisados, archivos vistos, intervalos de
// reporte en vivo para que el usuario VEA qué está haciendo en todo momento.
function walkScan(dir, depth, mask, files, stats, verbose){
  if (depth > 40) return;
  if (stats){
    stats.folders++;
    if (verbose && (stats.folders % 300 === 1)){
      try { fs.writeSync(1, '\r  [revisando] ' + dir + '   (carpetas: ' + stats.folders +
        ', archivos vistos: ' + stats.filesSeen + ')      '); } catch(_){}
    }
  }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch(_) { return; }
  for (const e of entries){
    const fp = path.join(dir, e.name);
    if (e.isDirectory()){
      if (EXCLUDE_SCAN.test(e.name)) continue;
      walkScan(fp, depth + 1, mask, files, stats, verbose);
    } else if (e.isFile() && mask.test(e.name)){
      if (stats) stats.filesSeen++;
      let st; try { st = fs.statSync(fp); } catch(_){ continue; }
      if (st.size < 33) continue;
      files.push({ path: fp, size: st.size });
    }
  }
}

// Resuelve dónde va el CSV: SIEMPRE al Escritorio del usuario si existe
// (aunque el .bat esté en otra carpeta), y si no, junto al script.
function resolveOutPath(outF){
  if (outF && path.isAbsolute(outF)) return outF;
  const desks = [];
  const userHome = process.env.USERPROFILE || process.env.HOMEDRIVE + process.env.HOMEPATH || '';
  if (userHome){
    desks.push(path.join(userHome, 'Desktop'));
    desks.push(path.join(userHome, 'Escritorio'));
    if (process.env.USERPROFILE) desks.push(path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop'));
  }
  desks.push('C:\\Users\\Public\\Desktop');
  for (const d of desks){
    try { if (fs.existsSync(d) && fs.statSync(d).isDirectory()){
      const base = outF || ('clientes_mixnet_completo_' + Date.now() + '.csv');
      return path.isAbsolute(base) ? base : path.join(d, base);
    } } catch(_){}
  }
  return path.join(__dirname, outF || ('clientes_mixnet_completo_' + Date.now() + '.csv'));
}

function findAnyMxctacli(){
  const out = [];
  for (const d of ROOTS){
    const root = d.endsWith('\\') ? d : d + '\\';
    if (!fs.existsSync(root)) continue;
    const files = [];
    walkScan(root, 0, /^MXCTACLI\.dbf$/i, files);
    files.forEach(f => {
      const dir = path.dirname(f.path);
      out.push({ dir, path: f.path, size: f.size });
    });
  }
  return out;
}

// Usa reporte_mixnet.json (si existe, genera con el explorador) para conocer
// las rutas exactas donde están los MXCTACLI, MXSUCCLI y cualquier DBF.
const REPORT_PATH = path.join(__dirname, 'reporte_mixnet.json');
function loadReporteDbfs(){
  if (!fs.existsSync(REPORT_PATH)) return null;
  try {
    const rep = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    return rep;
  } catch(_) { return null; }
}

// Encuentra la compañía activa PRIORIZANDO las rutas reportadas en
// reporte_mixnet.json, y luego las rutas típicas y el escaneo completo.
function locateCompanies(){
  const comps = [];

  // Fuente 1: reporte generado por el explorador (si existe) — rutas exactas
  const reporte = loadReporteDbfs();
  if (reporte){
    const rutas = [];
    if (Array.isArray(reporte.grandes)){
      for (const g of reporte.grandes){
        if (g.path && /MXCTACLI\.dbf$/i.test(g.path)) rutas.push(g.path);
      }
    }
    if (Array.isArray(reporte.relevantes)){
      for (const r of reporte.relevantes){
        if (r.path && /MXCTACLI\.dbf$/i.test(r.path)) rutas.push(r.path);
      }
    }
    const uniq = {};
    rutas.forEach(p => uniq[p] = true);
    for (const p of Object.keys(uniq)){
      if (!fs.existsSync(p)) continue;
      let st, n = -1;
      try { st = fs.statSync(p); n = parsedb(p,false,false).header.numRecords; } catch(_){}
      comps.push({ dir: path.dirname(p), path: p, size: st?st.size:0, mtime: st?st.mtimeMs:0, regs: n,
        fuentes: 'reporte' });
    }
  }

  // Fuente 2: rutas típicas comp01/02/03
  {
    const c = candidates();
    c.forEach(x => {
      if (!comps.find(y => y.path.toLowerCase() === x.path.toLowerCase())){
        comps.push(Object.assign({ fuentes: 'tipica' }, x));
      }
    });
  }

  // Fuente 3: escaneo completo de todas las unidades (si no hay ninguna aún)
  if (!comps.length){
    const found = findAnyMxctacli();
    found.forEach(f => comps.push(Object.assign({ fuentes: 'escaneo' }, f)));
  }

  // ordenar por número de registros desc (la más grande = compañía activa)
  return comps.sort((a,b) => (b.regs||0) - (a.regs||0) || b.size - a.size);
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
}

/* ============================================================
   DETECCIÓN DE EMAILS POR VALOR EN TODAS LAS TABLAS
   Construye un índice cruzable por (razón, rif, código, teléfono, y fuzzy)
   que luego se usa para completar cada cliente.
   ============================================================ */
function buildEmailIndex(dbFiles){
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  const idx = {
    byRazon: {},   // normTxt(razón) -> [{mail, tel}]
    byRif: {},     // normTxt(rif) -> mail
    byCod: {},     // normTxt(código) -> mail
    byTel: {},     // dígitos tel -> mail
    rows: []       // todos los pares (raz,rif,cod,tel,mail)
  };
  let dbfConMail = 0;

  for (const db of dbFiles){
    if (!db.rows || !db.rows.length) continue;
    const tk = db.fields.map(f => f.name.trim().toLowerCase());
    const tRaz = findField(tk, ['razon','razonsocial','nombre','nombrecli','cliente','denominacion','descrip','descr'], null);
    const tRif = findField(tk, ['rif','nit','cedula','cedul','identif','identidad','rifc'], null);
    const tCod = findField(tk, ['cod','codigo','cod_cli','codcli','cod_cta','cta','ctacli','deudor','cliente'], null);
    const tTel = findField(tk, ['telf','telef','tel','tfono','tfn','movil','celular','tlf'], null);
    const tCoor = findField(tk, ['corr','correo','email','e_mail','e-mail','connected','into','destino'], null);

    let tablaMail = false;
    for (const row of db.rows){
      // Buscar email en el campo de correo primero, luego en cualquier campo
      let mail = '';
      let mailField = null;
      if (tCoor && row[tCoor] !== undefined){
        const m = extractEmail(row[tCoor]);
        if (m){ mail = m; mailField = tCoor; }
      }
      if (!mail){
        for (const f of db.fields){
          const v = row[f.name.trim().toLowerCase()] !== undefined ? row[f.name.trim().toLowerCase()] : '';
          const m = extractEmail(v);
          if (m){ mail = m; mailField = f.name.trim().toLowerCase(); break; }
        }
      }
      if (!mail) continue;
      tablaMail = true;

      const raz = (tRaz && row[tRaz] !== undefined) ? String(row[tRaz]) : '';
      const rif = (tRif && row[tRif] !== undefined) ? String(row[tRif]) : '';
      const cod = (tCod && row[tCod] !== undefined) ? String(row[tCod]) : '';
      const telR = (tTel && row[tTel] !== undefined) ? String(row[tTel]) : '';
      const telDigits = telR.replace(/\D/g, '');

      const rec = { mail, tel: telR, raz, rif, cod };
      idx.rows.push(rec);

      // Índices por clave exacta
      if (raz){
        const k = normTxt(raz);
        if (!idx.byRazon[k]) idx.byRazon[k] = [];
        idx.byRazon[k].push({ mail, tel: telR });
      }
      if (rif){
        const k = normTxt(rif);
        if (!idx.byRif[k]) idx.byRif[k] = mail;
      }
      if (cod){
        const k = normTxt(cod);
        if (!idx.byCod[k]) idx.byCod[k] = mail;
      }
      if (telDigits && telDigits.length >= 8){
        if (!idx.byTel[telDigits]) idx.byTel[telDigits] = mail;
      }
    }
    if (tablaMail) dbfConMail++;
  }
  idx.dbfConMail = dbfConMail;
  return idx;
}

// Coincidencia difusa por token (>=60% de palabras coinciden)
function fuzzyMatch(raz, idxByRazon){
  const tokens = tokenize(raz);
  if (tokens.length < 2) return null;
  const razNorm = normTxt(raz);
  // búsqueda directa normalizada primero
  if (idxByRazon[razNorm]) return idxByRazon[razNorm][0];
  // búsqueda difusa
  let best = null, bestScore = 0;
  for (const key of Object.keys(idxByRazon)){
    const keyTokens = key.split(' ');
    let hits = 0;
    for (const t of tokens){
      if (keyTokens.some(kt => kt.indexOf(t) !== -1 || t.indexOf(kt) !== -1)) hits++;
    }
    const score = hits / tokens.length;
    if (score >= 0.6 && score > bestScore){ bestScore = score; best = idxByRazon[key][0]; }
  }
  return best;
}

/* ============================================================
   MODO COMPLETO — FLUJO ÚNICO
   Encuentra la compañía activa, lee TODOS los clientes, escanea
   TODAS las unidades en busca del email por VALOR, cruza por
   razón social / rif / código / teléfono / fuzzy, y genera el CSV.
   ============================================================ */
function modoCompleto(outF, directDir){
  const t0 = Date.now();
  say('=========================================================');
  say('  EXTRACTOR COMPLETO DE CLIENTES MIXNET (solo lectura)');
  say('=========================================================');

  // ---- PASO 1: localizar compañías ----
  say('\n[1/6] Localizando compañías activas (MXCTACLI)...');
  let comps = [];
  if (directDir){
    const dbf = path.join(directDir, 'MXCTACLI.DBF');
    if (fs.existsSync(dbf)){
      let st, n = -1;
      try { st = fs.statSync(dbf); n = parsedb(dbf,false,false).header.numRecords; } catch(_){}
      comps.push({ dir: directDir, path: dbf, size: st?st.size:0, mtime: st?st.mtimeMs:0, regs: n });
      say('  Usando carpeta indicada: ' + directDir);
    } else {
      say('  [!] No hay MXCTACLI.DBF en la carpeta indicada: ' + directDir);
    }
  }
  if (!comps.length){
    comps = locateCompanies();
  }
  if (!comps.length){
    say('[ERROR] No encontré ningún MXCTACLI.DBF en ninguna unidad.');
    say('  Verifica que la red esté conectada o monta la unidad M:.');
    say('  O usa:  --completo --dir "C:\\ruta\\a\\la\\compa\\fia"');
    // Aunque falle, SIEMPRE dejamos un CSV en el ESCRITORIO con el motivo,
    // para que el usuario sepa que el script corrió y qué se revisó.
    const outErr = resolveOutPath(outF);
    try {
      fs.writeFileSync(outErr,
        'RESULTADO,EXTRAER-CLIENTES-MIXNET\r\n' +
        'ESTADO,ERROR_NO_HAY_MXCTACLI\r\n' +
        'MOTIVO,No se encontro ningun MXCTACLI.DBF en ninguna unidad\r\n' +
        'UNIDADES_REVISADAS,' + ROOTS.join(';') + '\r\n' +
        'FECHA,' + new Date().toLocaleString() + '\r\n' +
        'AYUDA,Verifica que la red este conectada o usa --dir con la ruta de la compania\r\n', 'utf8');
      say('  (de todos modos se creo el reporte en tu ESCRITORIO: ' + outErr + ')');
    } catch(_){}
    return;
  }
  comps.forEach((c,i) => say('  ' + (i+1) + ') ' + c.dir.replace(/[\\\/]+$/, '') +
      ' | registros=' + (c.regs>=0 ? c.regs:'?') + ' | ' + (c.size/1024).toFixed(0) + ' KB'));
  const best = comps[0];
  say('  -> Compañía ACTIVA estimada: ' + best.dir.replace(/[\\\/]+$/, ''));

  // ---- PASO 2: leer todos los clientes ----
  say('\n[2/6] Leyendo todos los clientes y sus datos...');
  const cdb = parsedb(best.path, true, true);
  const ck = cdb.fields.map(f => f.name.trim().toLowerCase());
  const rows = (cdb.rows || []).map(r => {
    const out = {};
    for (const f of cdb.fields){
      const k = f.name.trim().toLowerCase();
      out[k] = r[k] !== undefined ? r[k] : '';
    }
    return out;
  });
  say('  Clientes encontrados: ' + rows.length);
  say('  Campos: ' + ck.join(', '));
  if (!rows.length){ say('[ERROR] MXCTACLI no tiene registros.');
    try {
      fs.writeFileSync(resolveOutPath(outF),
        'RESULTADO,EXTRAER-CLIENTES-MIXNET\r\n' +
        'ESTADO,ERROR_MXCTACLI_VACIO\r\n' +
        'MOTIVO,MXCTACLI no tiene registros\r\n' +
        'FUENTE,' + best.path + '\r\n' +
        'FECHA,' + new Date().toLocaleString() + '\r\n', 'utf8');
      say('  (reporte dejado en tu ESCRITORIO)');
    } catch(_){}
    return;
  }

  // ---- PASO 3: escanear TODAS las unidades buscando emails por valor ----
  say('\n[3/6] Escaneando TODAS las unidades en busca del correo del cliente...');
  say('  Busca el email por su VALOR (@) en cada tabla DBF que encuentre.');
  const dbFiles = [];

  // 3a) Primero la carpeta de la compañía activa (completa, SIN descartar respaldos)
  const dirDBF = path.dirname(best.path);
  try {
    const todos = fs.readdirSync(dirDBF).filter(x => /\.dbf$/i.test(x));
    for (const nom of todos){
      const fp2 = path.join(dirDBF, nom);
      let st2; try { st2 = fs.statSync(fp2); } catch(_){ continue; }
      if (st2.size < 33) continue;
      try {
        const tdb = parsedb(fp2, true, false);
        if (tdb.rows && tdb.rows.length) dbFiles.push(tdb);
      } catch(_){}
    }
  } catch(_){}

  // 3b) Luego TODO el resto: red y discos locales (incluye C: con RESPAMIX)
  //     Busca en CUALQUIER directorio hasta 40 niveles de profundidad.
  const drives = ['M:', 'P:', 'Z:', 'C:', 'D:', 'E:', 'F:'];
  const seenByfile = {};
  function addFile(fp){
    if (seenByfile[fp]) return;
    seenByfile[fp] = true;
    try {
      const tdb = parsedb(fp, true, false);
      if (tdb.rows && tdb.rows.length) dbFiles.push(tdb);
    } catch(_){}
  }
  let scannedFiles = 0;
  for (const d of drives){
    const root = d.endsWith('\\') ? d : d + '\\';
    if (!fs.existsSync(root)) continue;
    say('\n  === Unidad ' + d + ' ===');
    const files = [];
    const stats = { folders: 0, filesSeen: 0 };
    walkScan(root, 0, /\.dbf$/i, files, stats, true);
    if (stats.folders > 300){ try { fs.writeSync(1, '\r' + new Array(40).join(' ') + '\r'); } catch(_){} }
    say('  Unidad ' + d + ' terminada: ' + stats.folders + ' carpetas, ' +
        stats.filesSeen + ' archivos DBF vistos, ' + files.length + ' valiosos.');
    for (const f of files){
      addFile(f.path);
      scannedFiles++;
      if (scannedFiles % 500 === 0) say('    ...' + scannedFiles + ' archivos revisados');
    }
  }

  say('  Tablas DBF con datos leídas: ' + dbFiles.length);
  say('\n  Construyendo índice de correos...');
  const idx = buildEmailIndex(dbFiles);
  say('  Tablas con correo: ' + idx.dbfConMail);
  say('  Correos hallados: ' + idx.rows.length);

  // ---- PASO 4: cruzar correos con los clientes ----
  say('\n[4/6] Cruzando cada correo con su cliente...');
  const razF = findField(ck, ['razon','razonsocial','nombre','nombrecli','cliente','denominacion','descrip'], null);
  const rifF = findField(ck, ['rif','nit','cedula','cedul','identif','identidad','rifc'], null);
  const codF = findField(ck, ['cod','codigo','cod_cli','codcli','cta','ctacli','deudor','cliente'], null);
  const telF = findField(ck, ['telf','telef','tel','tfono','tfn','movil','celular','tlf'], null);

  let conMail = 0;
  rows.forEach(r => {
    let raz = (razF && r[razF] !== undefined) ? String(r[razF]) : '';
    let rif = (rifF && r[rifF] !== undefined) ? String(r[rifF]) : '';
    let cod = (codF && r[codF] !== undefined) ? String(r[codF]) : '';
    let telR = (telF && r[telF] !== undefined) ? String(r[telF]) : '';
    let mail = '';

    // 1) por RIF (más fiable)
    if (!mail && rif){
      mail = idx.byRif[normTxt(rif)] || '';
    }
    // 2) por código
    if (!mail && cod){
      mail = idx.byCod[normTxt(cod)] || '';
    }
    // 3) por teléfono
    if (!mail && telR){
      const d = telR.replace(/\D/g, '');
      if (d.length >= 8) mail = idx.byTel[d] || '';
    }
    // 4) por razón social exacta
    if (!mail && raz){
      const hit = fuzzyMatch(raz, idx.byRazon);
      if (hit) mail = hit.mail || '';
    }

    if (mail) conMail++;
    r['__email'] = mail;
    r['__tiene_email'] = mail ? 'SI' : 'NO';
  });
  say('  Clientes con correo: ' + conMail + ' de ' + rows.length +
      ' (' + (rows.length ? Math.round(conMail/rows.length*100) : 0) + '%)');

  // ---- PASO 5: armar el CSV final ----
  say('\n[5/6] Armando el archivo final...');
  let head = ck.slice();
  if (head.indexOf('__email') === -1) head.push('__email');
  if (head.indexOf('__tiene_email') === -1) head.push('__tiene_email');
  const outPath = resolveOutPath(outF);
  fs.writeFileSync(outPath, toCSV(rows, head), 'utf8');

  // ---- PASO 6: resumen ----
  say('\n[6/6] Terminado en ' + Math.round((Date.now()-t0)/1000) + 's.');
  say('=========================================================');
  say('  ARCHIVO GENERADO:  ' + outPath);
  say('  ' + rows.length + ' clientes | ' + conMail + ' con correo (' +
      (rows.length ? Math.round(conMail/rows.length*100) : 0) + '%)');
  say('  EL ARCHIVO ESTA EN TU ESCRITORIO.');
  say('=========================================================');
}

/* ============================================================
   MODO DIAGNOSTICO — ver dónde está el email
   ============================================================ */
function modoDiagnostico(baseDir){
  say('=========================================================');
  say('  DIAGNÓSTICO DE EMAIL/CONTACTOS EN MIXNET (solo lectura)');
  say('=========================================================');
  say('Carpeta base: ' + baseDir);
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()){
    say('[!] La carpeta no existe: ' + baseDir);
    return;
  }
  const archivos = ['MXCTACLI.DBF','MXSUCCLI.DBF','MXAGENDA.DBF','MXOFECLI.DBF','MXCLIESP.DBF','MXCTAZON.DBF','MXCTADPT.DBF'];
  say('\n=== PANEL PRIORITARIO ===');
  archivos.forEach(function(nombre){
    var fp = path.join(baseDir, nombre);
    if (!fs.existsSync(fp)){ say('[-] ' + nombre + ': NO EXISTE'); return; }
    say('\n[+] ' + nombre + ':');
    var db;
    try { db = parsedb(fp, false, true); } catch(e){ say('    Error: ' + e.message); return; }
    say('    Registros: ' + db.header.numRecords + ' | fecha: ' + db.header.lastUpd.y + '/' + db.header.lastUpd.m + '/' + db.header.lastUpd.d);
    say('    Campos (' + db.fields.length + '):');
    db.fields.forEach(function(f,i){
      var marker = '';
      var n = f.name.toLowerCase();
      if (n.indexOf('cor') !== -1 || n.indexOf('mail') !== -1 || n.indexOf('email') !== -1) marker += ' <<< EMAIL';
      if (n.indexOf('tel') !== -1 || n.indexOf('tlf') !== -1 || n.indexOf('tfn') !== -1) marker += ' <<< TEL';
      if (n.indexOf('rif') !== -1 || n.indexOf('nit') !== -1 || n.indexOf('ci') === 0) marker += ' <<< ID';
      say('      ' + String(i+1).padStart(2) + '. ' + f.name + ' [' + f.type + ' ' + f.len + ']' + marker);
    });
  });
}

/* ============================================================
   MODO EMAILS — listar emails por valor
   ============================================================ */
function modoEmails(baseDir){
  const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  say('=========================================================');
  say('  LISTADO DE EMAILS ENCONTRADOS EN MIXNET (solo lectura)');
  say('=========================================================');
  say('Carpeta base: ' + baseDir);
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()){
    say('[!] La carpeta no existe: ' + baseDir);
    return;
  }
  let total = 0;
  try {
    const todos = fs.readdirSync(baseDir).filter(x => /\.dbf$/i.test(x));
    for (const nom of todos){
      const fp = path.join(baseDir, nom);
      let st; try { st = fs.statSync(fp); } catch(_){ continue; }
      if (st.size < 33) continue;
      let db; try { db = parsedb(fp, true, false); } catch(_){ continue; }
      if (!db.rows || !db.rows.length) continue;
      let tablaConMail = 0;
      const mostrados = [];
      for (const row of db.rows){
        let mail = extractEmail(JSON.stringify(row));
        if (!mail) continue;
        tablaConMail++;
        total++;
        if (mostrados.length < 15) mostrados.push('    ' + path.basename(fp) + ' → EMAIL=' + mail);
      }
      if (tablaConMail){
        say('\n[' + nom + ']  ' + tablaConMail + ' emails:');
        mostrados.forEach(m => say(m));
      }
    }
  } catch(e){ say('  (error: ' + e.message + ')'); }
  say('\nTotal de emails encontrados por valor: ' + total);
}

/* ============================================================
   MAIN
   ============================================================ */
function main(){
  const args = process.argv.slice(2);
  const mode = args.find(a => a.startsWith('--'));
  const outI = args.indexOf('--out');
  const outF = outI>=0 ? args[outI+1] : null;
  const hasDir = args.indexOf('--dir') >= 0;

  // SIN COMANDOS: si no pasan ningún modo, igual se ejecuta el flujo
  // completo automático (basta con hacer doble clic al .cjs o al .bat).
  if (!mode){
    say('=========================================================');
    say('  EXTRACTOR DE CLIENTES MIXNET  (modo automático completo)');
    say('  Sin comandos: ya está buscando todos los datos de clientes.');
    say('=========================================================');
    modoCompleto(outF || ('clientes_mixnet_completo_' + Date.now() + '.csv'), null);
    return;
  }

  if (mode === '--completo' || mode === '--escaneo'){
    var dirI = args.indexOf('--dir');
    var directDir = dirI !== -1 ? args[dirI+1] : null;
    modoCompleto(outF, directDir);
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
  if (mode && mode.indexOf('--esquema') === 0){
    const f = args[args.indexOf('--esquema')+1];
    if (!f){ say('Falta la ruta. Ej: --esquema "M:\\comp01\\MXCTACLI.DBF"'); return; }
    modoEsquema(f);
    return;
  }
  if (mode && mode.indexOf('--extraer') === 0){
    const f = args[args.indexOf('--extraer')+1];
    if (!f){ say('Falta la ruta. Ej: --extraer "M:\\comp01\\MXCTACLI.DBF" [--out salida.csv]'); return; }
    say('Para extracción puntual usa: node extraer-clientes-mixnet.cjs --completo --out salida.csv');
    return;
  }
  if (mode === '--detectar'){
    const found = findAnyMxctacli();
    say('Encontrados ' + found.length + ' archivos MXCTACLI.DBF:');
    found.forEach(f => say('  ' + f.path));
    return;
  }

  say('=========================================================');
  say('  EXTRACTOR DE CLIENTES MIXNET (envía a la PC con red)');
  say('=========================================================');
  say('');
  say('RECOMENDADO — flujo completo automático (detecta, escanea y arma):');
  say('   node extraer-clientes-mixnet.cjs --completo');
  say('   node extraer-clientes-mixnet.cjs --completo --out clientes.csv');
  say('');
  say('Otros modos:');
  say('   --esquema "RUTA\\MXCTACLI.DBF"   ver los campos de una tabla');
  say('   --diagnostico [--dir RUTA]      ver dónde vive el email');
  say('   --emails [--dir RUTA]           listar emails encontrados por valor');
  say('   --detectar                      buscar dónde está MXCTACLI');
}

// Envoltorio global: si algo falla inesperadamente, escribimos un log al
// lado del script para que el usuario sepa qué pasó (en vez de cerrar en silencio).
try {
  main();
} catch (e) {
  try {
    const logPath = path.join(__dirname, 'error_extractor.log');
    fs.writeFileSync(logPath,
      'FECHA: ' + new Date().toLocaleString() + '\r\n' +
      'ERROR : ' + (e && e.stack ? e.stack : String(e)) + '\r\n', 'utf8');
    say('\n[ERROR] Ocurri\u00f3 un error inesperado. Detalles guardados en: ' + logPath);
  } catch (_){}
  say(String(e && e.stack ? e.stack : e));
  process.exit(1);
}
