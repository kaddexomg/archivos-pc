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

  // Columnas: TODOS los campos DBF + derivadas humanas al final
  const head = db.fields.map(f=>f.name.toLowerCase());

  // derivadas que no existan ya como campo
  const add = [];
  function addCol(name){
    if (head.indexOf(name) === -1){ head.push(name); add.push(name); }
  }

  // teléfono principal: el campo que parezca teléfono
  const tel   = findField(keys, ['telf','telef','tel','tfono','tfn','movil','celular','tlf'], null);
  const rif   = findField(keys, ['rif','nit','cedula','ci'], null);
  const corr  = findField(keys, ['email','correo','mail','e_mail','e-mail','contact'], null);
  const dir   = findField(keys, ['direccion','direcc','domicilio','dir','direc'], null);
  const ciu   = findField(keys, ['ciudad','poblacion','municipio','zona'], null);

  addCol('telefono_principal');
  addCol('tiene_telefono');
  addCol('tiene_correo');

  const rows = (db.rows || []).map(r => {
    const out = {};
    // copiar todos los campos
    head.forEach(h => { if (Object.prototype.hasOwnProperty.call(r, h)) out[h] = r[h]; });
    if (tel) out['telefono_principal'] = r[tel] || '';
    out['tiene_telefono'] = (tel && r[tel] && String(r[tel]).trim()) ? 'SI' : 'NO';
    out['tiene_correo']   = (corr && r[corr] && String(r[corr]).trim()) ? 'SI' : 'NO';
    return out;
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
  say('   --detectar                       buscar compañías (recorre unidades, lento)');
  say('');
  say('Detección conocida del servidor:  M:\\comp01\\MXCTACLI.DBF');
  say('');
  say('El CSV exporta TODOS los campos de la tabla + columnas derivadas');
  say('(telefono_principal, tiene_telefono, tiene_correo).');
  say('');
  say('COMANDO UNO-LINER TÍPICO:');
  say('   node extraer-clientes-mixnet.cjs --auto --out clientes.csv');
}

main();
