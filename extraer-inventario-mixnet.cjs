/*
  ============================================================
  JJ Paper — Extractor de INVENTARIO/PRODUCTOS desde MixNet (DBF dBase)
  ============================================================
  Auto-detecta tablas de artículos, precios, stock, familias y
  proveedores por NOMBRE DE CAMPO, sin depender de nombres
  fijos de archivo. Compatible con cualquier instalación MixNet.

  MODO FLUJO COMPLETO:
    node extraer-inventario-mixnet.cjs
    node extraer-inventario-mixnet.cjs --objetivo 70 --tiempo 600
    node extraer-inventario-mixnet.cjs --out "C:\MiCarpeta\salida.csv"

  MODO EXPLORAR (qué tablas hay, con qué campos):
    node extraer-inventario-mixnet.cjs --explorar
    node extraer-inventario-mixnet.cjs --explorar --tiempo 30

  MODO DIAGNOSTICAR carpeta específica:
    node extraer-inventario-mixnet.cjs --diagnostico "M:\comp01"

  MODO VER ESQUEMA de un archivo:
    node extraer-inventario-mixnet.cjs --esquema "M:\comp01\MXARTIC.DBF"

  Autores: JJ Paper
  Compatible con Node 13+ (CommonJS). 2026-09-01 v1
  ============================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ─────────────────────────────────────────────────────────────
   HELPERS DE E/S
   ───────────────────────────────────────────────────────────── */
function say(s) {
  try { fs.writeSync(1, s + '\n'); } catch (_) { console.log(s); }
}
function ts()  { return new Date().toLocaleTimeString(); }
function log(m){ say('[' + ts() + '] ' + m); }

/* ─────────────────────────────────────────────────────────────
   LECTOR DBF  (Node 13, tolerante)
   ───────────────────────────────────────────────────────────── */
function readDbfHeader(buf) {
  var lastUpd = { y: buf[1]+1900, m: buf[2], d: buf[3] };
  return {
    numRecords : buf.readUInt32LE(4),
    headerLen  : buf.readUInt16LE(8),
    recordLen  : buf.readUInt16LE(10),
    lastUpd    : lastUpd
  };
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
  var fields = [], off = 32;
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    fields.push({
      name : decodeStr(buf, off, 11).replace(/\0/g, '').trim().toLowerCase(),
      type : String.fromCharCode(buf[off + 11]),
      len  : buf.readUInt16LE(off + 16),
      dec  : buf[off + 17]
    });
    off += 32;
  }
  return fields;
}

function readDbfHeaderFields(filePath, verbose) {
  var buf;
  try { buf = fs.readFileSync(filePath); } catch (_) { return null; }
  if (buf.length < 33) return null;
  var hdr;
  try { hdr = readDbfHeader(buf); } catch (_) { return null; }
  if (hdr.headerLen < 32 || hdr.recordLen < 1 || hdr.headerLen > buf.length) return null;
  var fields;
  try { fields = readDbfFields(buf, hdr.headerLen); } catch (_) { return null; }
  return { header: hdr, fields: fields, size: buf.length };
}

function readDbfData(filePath) {
  var buf;
  try { buf = fs.readFileSync(filePath); } catch (_) { return null; }
  if (buf.length < 33) return null;
  var hdr;
  try { hdr = readDbfHeader(buf); } catch (_) { return null; }
  if (hdr.headerLen < 32 || hdr.recordLen < 1 || hdr.headerLen > buf.length) return null;
  var fields;
  try { fields = readDbfFields(buf, hdr.headerLen); } catch (_) { return null; }

  var maxEnd = Math.min(hdr.headerLen + hdr.numRecords * hdr.recordLen, buf.length);
  var rows = [], pos = hdr.headerLen;
  while (pos + hdr.recordLen <= maxEnd && rows.length < 200000) {
    var rec = buf.slice(pos, pos + hdr.recordLen);
    if (rec[0] !== 0x2A && rec[0] === 0x20) {
      var obj = {}, fpos = 1;
      for (var fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        if (fpos + f.len > rec.length) break;
        obj[f.name] = decodeStr(rec, fpos, f.len);
        fpos += f.len;
      }
      rows.push(obj);
    }
    pos += hdr.recordLen;
  }
  return { fields: fields, rows: rows, numRecords: hdr.numRecords, filePath: filePath };
}

/* ─────────────────────────────────────────────────────────────
   HELPERS DE TEXTOS
   ───────────────────────────────────────────────────────────── */
function normTxt(s) {
  if (s == null) return '';
  s = String(s).toLowerCase().trim();
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normCod(s) {
  if (s == null) return '';
  return String(s).toLowerCase().trim()
    .split('-').map(function(seg){ return seg.replace(/^0+/,''); }).join('-')
    .replace(/[^a-z0-9\-]/g, '');
}
function escCSV(v) {
  v = (v == null ? '' : String(v)).trim();
  return /[",\n\r]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
}
function toCSV(rows, head) {
  var lines = [ head.join(',') ];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], cols = [];
    for (var j = 0; j < head.length; j++) cols.push(escCSV(r[head[j]]));
    lines.push(cols.join(','));
  }
  return lines.join('\r\n');
}
function findField(keys, candidates, def) {
  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci];
    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      if (k === c || k.indexOf(c) === 0 || k.indexOf(c) !== -1) return k;
    }
  }
  return def;
}

/* ─────────────────────────────────────────────────────────────
   RUTAS Y ARCHIVOS
   ───────────────────────────────────────────────────────────── */
function stFecha() {
  var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); };
  return ''+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+
         p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}

/* Devuelve TODAS las rutas de salida posibles donde escribir el CSV.
   Se escribe en CADA UNA, garantizando que el archivo aparezca
   en C: tenga el escritorio donde tenga. */
function rutasSalida(nombre) {
  var rutas = [];
  var vista = [];
  var userHome = process.env.USERPROFILE || '';

  // Escritorio real de Windows (via registros de shell folders)
  try {
    var reg = [
      '"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop',
      '"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders" /v Desktop'
    ];
    for (var ri = 0; ri < reg.length; ri++) {
      var cp = require('child_process');
      var out = cp.execSync('reg query ' + reg[ri], { encoding: 'utf8' });
      var m = out.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i);
      if (m) {
        var val = m[1].trim();
        val = val.replace(/%USERPROFILE%/i, process.env.USERPROFILE || '');
        val = val.replace(/%HOMEDRIVE%%HOMEPATH%/i, (process.env.HOMEDRIVE||'') + (process.env.HOMEPATH||''));
        vista.push(val);
      }
    }
  } catch (_) { }

  var cand = [];
  if (userHome) cand.push(userHome + '\\Desktop', userHome + '\\Escritorio', userHome + '\\Documents\\Desktop');
  cand.push('C:\\Users\\Public\\Desktop', 'C:\\Users\\Public\\Escritorio');

  for (var ci = 0; ci < cand.length; ci++) {
    try { if (fs.existsSync(cand[ci]) && fs.statSync(cand[ci]).isDirectory()) rutas.push(path.join(cand[ci], nombre)); } catch (_) {}
  }
  for (var vi = 0; vi < vista.length; vi++) {
    try { if (fs.existsSync(vista[vi]) && fs.statSync(vista[vi]).isDirectory()) rutas.push(path.join(vista[vi], nombre)); } catch (_) {}
  }

  rutas.push(path.join(__dirname, nombre));

  var unicas = [], visto = {};
  for (var ui = 0; ui < rutas.length; ui++) {
    var r = path.normalize(rutas[ui]);
    if (!visto[r]) { visto[r] = true; unicas.push(r); }
  }
  return unicas;
}

function resolveOutPath(outF) {
  if (outF && path.isAbsolute(outF)) return outF;
  var nombre = outF || ('inventario_mixnet_' + Date.now() + '.csv');
  return rutasSalida(nombre)[0] || path.join(__dirname, nombre);
}

/* Escribe el CSV en TODAS las rutas de salida. Devuelve la primera exitosa. */
function escribirCSVTodas(rows, head, outF) {
  var nombre = outF && path.isAbsolute(outF) ? path.basename(outF) : (outF || ('inventario_mixnet_' + Date.now() + '.csv'));
  var rutas = rutasSalida(nombre);
  var csv = toCSV(rows, head);
  var primera = null;
  for (var i = 0; i < rutas.length; i++) {
    try { fs.writeFileSync(rutas[i], csv, 'utf8'); if (!primera) primera = rutas[i]; } catch (_) {}
  }
  return { primera: primera, rutas: rutas, csv: csv };
}

function escribirCSV(rows, head, outPath) {
  var res = escribirCSVTodas(rows, head, path.basename(outPath));
  return !!res.primera;
}

/* Escribe un texto (reporte/resumen) en TODAS las rutas de salida. */
function escribirEnTodas(texto, outF) {
  var nombre = outF && path.isAbsolute(outF) ? path.basename(outF) : (outF || 'archivo_' + Date.now() + '.csv');
  var rutas = rutasSalida(nombre);
  var primera = null;
  for (var i = 0; i < rutas.length; i++) {
    try { fs.writeFileSync(rutas[i], texto, 'utf8'); if (!primera) primera = rutas[i]; } catch (_) {}
  }
  return primera || path.join(__dirname, nombre);
}

/* ─────────────────────────────────────────────────────────────
   DETECCIÓN DE UNIDADES
   ───────────────────────────────────────────────────────────── */
function detectarUnidades() {
  var unidades = [];
  var candidatas = ['M:','P:','Z:','C:','D:','E:','F:','G:','H:','I:'];
  log('Detectando unidades...');
  for (var i = 0; i < candidatas.length; i++) {
    var u = candidatas[i], root = u+'\\';
    try {
      if (fs.existsSync(root)) {
        var entries = fs.readdirSync(root);
        unidades.push({ letra:u, root:root, archivos:entries.length });
        log('  [OK] '+u+'/  ('+entries.length+' elementos)');
      } else log('  [--] '+u+'/  no existe');
    } catch(e) { log('  [!!] '+u+'/  ERROR: '+e.message); }
  }
  return unidades;
}

/* ─────────────────────────────────────────────────────────────
   ESCANEO CON PRESUPUESTO (mismo motor que clientes v3)
   ───────────────────────────────────────────────────────────── */
var EXCLUDE_SCAN = /windows|program files|programdata|appdata|perflogs|\$recycle|fonts|drivers|\.git|node_modules|\$windows|bluestacks|anaconda|nodejs|python|nvidia|intel\b|\.thumbnails|dcim|music|videos|pictures|musica|common files|microsoft office|microsoft.net|installshield|nero|brother|bullzip|hp\\|adobe|mozilla|google|java\\|intel\\|dvd maker/i;
var PRIORITY_DIRS = /mixnet|mixer|respami|comp\d|multiemp|ventas|venta|factura|sistema|sistemas|datos|base|clientes|contab|bases|dbf|banco|admin|\bmx\b|invent|stock|articulo|precio|provee/i;

function crearEscaneador(unidades) {
  var queue = [], visitados = {};
  var stats = { carpetas:0, dbfEncontrados:0, procesados:0, conEmail:0, errores:0, ignoradas:0 };
  var meta = [];
  for (var i = 0; i < unidades.length; i++)
    queue.push({ dir:unidades[i].root, prio:0, depth:0 });

  function prioridadDe(nombre, depth) {
    var p = 100 - depth*3;
    if (PRIORITY_DIRS.test(nombre)) p += 800;
    if (/\.bak|backup|old|orig|tmp/i.test(nombre)) p -= 400;
    return p;
  }

  return {
    stats: stats,
    meta: meta,
    hayPendientes: function(){ return queue.length > 0; },
    pendientes:    function(){ return queue.length; },

    recorrer: function(limite) {
      var dbLeidos = [], procesadas = 0;
      queue.sort(function(a,b){ return b.prio-a.prio; });
      while (queue.length && procesadas < limite) {
        var item = queue.pop(), dir = item.dir, depth = item.depth;
        procesadas++;
        if (visitados[dir]) continue;
        visitados[dir] = true;
        if (depth > 40) continue;
        stats.carpetas++;
        var entries;
        try { entries = fs.readdirSync(dir,{withFileTypes:true}); } catch(_){ stats.errores++; continue; }
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i], fp = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (EXCLUDE_SCAN.test(e.name)) { stats.ignoradas++; continue; }
            queue.push({ dir:fp, prio:prioridadDe(e.name, depth+1), depth:depth+1 });
          } else if (e.isFile() && /\.dbf$/i.test(e.name)) {
            stats.dbfEncontrados++;
            var st; try{ st=fs.statSync(fp); }catch(_){ continue; }
            if(st.size<33) continue;
            var leido = readDbfHeaderFields(fp, false);
            if(!leido) continue;
            stats.procesados++;
            var clasif = clasificarCampos(leido.fields);
            if(clasif.esProducto) {
              var db = readDbfData(fp);
              if(db && db.rows.length) {
                clasif.total = db.rows.length;
                clasif.size = st.size;
                clasif.path = fp;
                meta.push(clasif);
                dbLeidos.push({ db: db, clasif: clasif });
              }
            }
          }
        }
        if (stats.carpetas % 300 === 0)
          log('    ...'+stats.carpetas+' carpetas, '+stats.dbfEncontrados+' DBF, '+stats.procesados+' procesados');
      }
      return dbLeidos;
    }
  };
}

/* ─────────────────────────────────────────────────────────────
   CLASIFICACIÓN AUTOMÁTICA DE CAMPOS (artic/prec/stock/fam/prov)
   ───────────────────────────────────────────────────────────── */
var CAMPO_COD      = /^cod|^id_|^id$|^no artic|^item|^art_|^articulo_/i;
var CAMPO_DESC     = /^descri|^artic|^nombr|^producto|^denomi|^detalle|^nombre_|^desc_|^DESCRIP/i;
var CAMPO_PRECIO   = /^prec|pvp|p\.?vent|^cost|p\.?mayor|p\.?minor|precio_|preciob|preciou|p1|p2|p3|p4|^costo/i;
var CAMPO_STOCK    = /^exis|stock|saldo|cant|dispo|stk|^kardex|^exist/i;
var CAMPO_FAMILIA  = /^fam|grupo|categ|rubro|linea|^tipo$|^subcateg|^seccion|^categ_/i;
var CAMPO_PROVE    = /^prove|provee|suppli|prove_|suplidor|^alma|^deposito|^bodega/i;
var CAMPO_COD_FAM  = /^cod(?:fam|grup|categ|linea|rubro|sub)/i;

function clasificarCampos(fields) {
  var fn = fields.map(function(f){ return f.name; });
  var res = {
    esProducto: false,
    nombreArchivo: '',
    tipo: 'OTROS',
    total: 0,
    size: 0,
    path: '',
    camposCod : fn.filter(function(n){ return CAMPO_COD.test(n); }),
    camposDesc: fn.filter(function(n){ return CAMPO_DESC.test(n); }),
    camposPre : fn.filter(function(n){ return CAMPO_PRECIO.test(n); }),
    camposStk : fn.filter(function(n){ return CAMPO_STOCK.test(n); }),
    camposFam : fn.filter(function(n){ return CAMPO_FAMILIA.test(n); }),
    camposProv: fn.filter(function(n){ return CAMPO_PROVE.test(n); }),
    camposCodFam: fn.filter(function(n){ return CAMPO_COD_FAM.test(n); }),
    camposTodos: fn
  };

  var score = 0;
  if(res.camposCod.length)  score++;
  if(res.camposDesc.length) score++;
  if(res.camposPre.length)  score+=2; // precio con más peso
  if(res.camposStk.length)  score++;
  if(res.camposFam.length)  score++;
  if(res.camposProv.length) score++;

  if(score >= 2) {
    res.esProducto = true;
    res.tipo =
      (res.camposCod.length && res.camposDesc.length && res.camposPre.length) ? 'ARTICULOS' :
      (res.camposPre.length)  ? 'PRECIOS' :
      (res.camposStk.length) ? 'STOCK' :
      (res.camposFam.length) ? 'FAMILIAS' :
      (res.camposProv.length)? 'PROVEEDORES' : 'REFERENCIA';
  }
  return res;
}

/* ─────────────────────────────────────────────────────────────
   BUSCAR CARPETA DE COMPAÑÍA (MXCTACLI)
   ───────────────────────────────────────────────────────────── */
var COMP_NAMES = ['MXCTACLI','mxctacli','MXSUCCLI','mxsuccli'];

function buscarCompania(unidades, tiempoMaxMs) {
  var encontrados = [], tIni = Date.now(), pres = tiempoMaxMs || 90000;
  var tipicas = ['comp01','COMP01','comp02','COMP02','comp03','COMP03',
    'mixnet','MIXNET','datos','DATOS','sistema','SISTEMA','base','BASE','dbf','DBF'];
  for (var ui=0; ui<unidades.length; ui++) {
    for (var ti=0; ti<tipicas.length; ti++) {
      for (var ni=0; ni<COMP_NAMES.length; ni++) {
        var fp = path.join(unidades[ui].root, tipicas[ti], COMP_NAMES[ni]+'.DBF');
        try { if(fs.existsSync(fp)) {
          var st = fs.statSync(fp);
          var leido = readDbfHeaderFields(fp, false);
          encontrados.push({ dir:path.join(unidades[ui].root,tipicas[ti]), path:fp, regs:leido?leido.header.numRecords:-1, size:st.size });
        }} catch(_){}
      }
    }
  }
  if(encontrados.length===0) {
    log('  No se encontro MXCTACLI en rutas tipicas. Buscando...');
    var esc = crearEscaneador(unidades);
    while(esc.hayPendientes() && Date.now()-tIni<pres){
      esc.recorrer(2000);
      for(var di=0;di<esc.meta.length;di++){
        if(encontrados.length===0 && /MXCTACLI/i.test(path.basename(esc.meta[di].path))){
          encontrados.push({ dir:path.dirname(esc.meta[di].path), path:esc.meta[di].path, regs:esc.meta[di].total, size:esc.meta[di].size });
          break;
        }
      }
      if(encontrados.length) break;
    }
  }
  encontrados.sort(function(a,b){ return(b.regs||0)-(a.regs||0); });
  return encontrados;
}

/* ─────────────────────────────────────────────────────────────
   ÍNDICE DE INVENTARIO POR CÓDIGO (normalize normCod)
   ───────────────────────────────────────────────────────────── */
function construirIndice(dbClasificados) {
  var idx = { precios:{}, stock:{}, familias:{}, proveedores:{}, extra:{}, stats:{ tablas:0, totalFilas:0 } };

  for(var ti=0; ti<dbClasificados.length; ti++){
    var reg = dbClasificados[ti];
    var db = reg.db, cls = reg.clasif;
    idx.stats.tablas++;
    idx.stats.totalFilas += db.rows.length;

    // Determinar campo código
    var codF = findField(cls.camposTodos, ['cod','codigo','cod_art','artcod','codart','item','id','codpro','cod_producto','art'], null);
    if(!codF) continue;

    for(var ri=0; ri<db.rows.length; ri++){
      var r = db.rows[ri];
      var cod = (r[codF]||'').trim();
      if(!cod) continue;
      var ncod = normCod(cod);
      if(!idx.precios[ncod]) idx.precios[ncod] = {};
      if(!idx.stock[ncod])   idx.stock[ncod] = {};

      // Precios
      for(var pi=0; pi<cls.camposPre.length; pi++){
        var pf = cls.camposPre[pi];
        var val = (r[pf]||'').trim();
        if(val && val!=='0' && val!=='0.00') idx.precios[ncod][pf] = val;
      }
      // Stock
      for(var si=0; si<cls.camposStk.length; si++){
        var sf = cls.camposStk[si];
        var val = (r[sf]||'').trim();
        if(val) idx.stock[ncod][sf] = val;
      }
      // Familias (capturar el primero que tenga valor)
      for(var fi2=0; fi2<cls.camposFam.length; fi2++){
        var ff = cls.camposFam[fi2];
        var val = (r[ff]||'').trim();
        if(val && !idx.familias[ncod]) idx.familias[ncod] = val;
      }
      // Proveedor
      for(var vi=0; vi<cls.camposProv.length; vi++){
        var vf = cls.camposProv[vi];
        var val = (r[vf]||'').trim();
        if(val && !idx.proveedores[ncod]) idx.proveedores[ncod] = val;
      }
      // Código familia (para tabla de familias por separado)
      for(var ci2=0; ci2<cls.camposCodFam.length; ci2++){
        var cf = cls.camposCodFam[ci2];
        var val = (r[cf]||'').trim();
        if(val && !idx.familias[ncod]) idx.familias[ncod] = val;
      }
    }
  }
  return idx;
}

/* ─────────────────────────────────────────────────────────────
   APLICAR ENRIQUECIMIENTO + MEDIR COBERTURA
   ───────────────────────────────────────────────────────────── */
function camposArticulo(fields) {
  var fn = fields.map(function(f){ return f.name; });
  return {
    codF  : findField(fn, ['cod','codigo','cod_art','artcod','codart','item','id','codpro','cod_producto','art'], null),
    descF : findField(fn, ['descri','artic','nombr','producto','denomi','detalle','nombre_','desc_','descr'], null),
    precioF : findField(fn, ['prec','pvp','pventa','cost','precio','preciob','preciou'], null),
    stockF  : findField(fn, ['exis','stock','saldo','cant','dispo','stk','exist'], null),
    famF    : findField(fn, ['fam','grupo','categ','rubro','linea','tipo'], null),
    provF   : findField(fn, ['prove','provee','suplidor','prove_'], null),
  };
}

function aplicarEnriquecimiento(rows, campos, idx) {
  var conPrecio = 0, conStock = 0, conFam = 0, conProv = 0;
  var sinPrecio = [];

  // Detectar todas las columnas de precio en la tabla principal (para guardar)
  var colsPrecio = [];
  for(var fi=0;fi<rows[0]?Object.keys(rows[0]).length:0;fi++){ /* dummy */ }
  var colsAll = Object.keys(rows[0]||{});

  // Agregar columnas de enriquecimiento al final
  var novos = ['__precio1','__precio2','__stock_txt','__familia','__proveedor'];

  for(var ri=0; ri<rows.length; ri++){
    var r = rows[ri];
    var cod = (campos.codF && r[campos.codF]!==undefined) ? String(r[campos.codF]).trim() : '';
    if(!cod) continue;
    var ncod = normCod(cod);

    // Precio
    var precios = idx.precios[ncod] || {};
    var pk = Object.keys(precios);
    r['__precio1'] = pk[0] ? precios[pk[0]] : '';
    r['__precio2'] = pk[1] ? precios[pk[1]] : '';
    if(pk.length) conPrecio++;

    // Stock
    var stocks = idx.stock[ncod] || {};
    var sk = Object.keys(stocks);
    r['__stock_txt'] = sk.map(function(k){ return k+':'+stocks[k]; }).join(' ');
    if(sk.length) conStock++;

    // Familia
    r['__familia'] = idx.familias[ncod] || '';
    if(r['__familia']) conFam++;

    // Proveedor
    r['__proveedor'] = idx.proveedores[ncod] || '';
    if(r['__proveedor']) conProv++;

    if(!pk.length) sinPrecio.push({ cod: cod, desc: (campos.descF && r[campos.descF]) ? r[campos.descF].substring(0,60) : '' });
  }

  return { conPrecio:conPrecio, conStock:conStock, conFam:conFam, conProv:conProv,
           total:rows.length, sinPrecio:sinPrecio,
           pctPrecio: rows.length? Math.round(conPrecio/rows.length*100):0,
           pctStock:  rows.length? Math.round(conStock/rows.length*100):0,
           pctFam:    rows.length? Math.round(conFam/rows.length*100):0,
           pctProv:   rows.length? Math.round(conProv/rows.length*100):0 };
}

/* ─────────────────────────────────────────────────────────────
   RESUMEN DE COBERTURA
   ───────────────────────────────────────────────────────────── */
function escribirResumen(campos, clasifPrincipal, idx, cob, stats, tIni) {
  var elapsed = Math.round((Date.now()-tIni)/1000);
  var outPath = escribirEnTodas([
    'METRICA,VALOR',
    'ARTICULOS_TOTAL,'+cob.total,
    'CON_PRECIO,'+cob.conPrecio+' ('+cob.pctPrecio+'%)',
    'CON_STOCK,'+cob.conStock+' ('+cob.pctStock+'%)',
    'CON_FAMILIA,'+cob.conFam+' ('+cob.pctFam+'%)',
    'CON_PROVEEDOR,'+cob.conProv+' ('+cob.pctProv+'%)',
    'TABLAS_PROCESADAS,'+stats.tablas,
    'TABLA_PRINCIPAL,'+((clasifPrincipal&&clasifPrincipal.path)||'Ninguna'),
    'TABLA_PRINCIPAL_ROWS,'+((clasifPrincipal&&clasifPrincipal.total)||0),
    'INDICE_PRECIOS,'+Object.keys(idx.precios).length+' codigos',
    'INDICE_STOCK,'+Object.keys(idx.stock).length+' codigos',
    'INDICE_FAMILIAS,'+Object.keys(idx.familias).length+' codigos',
    'INDICE_PROVEEDORES,'+Object.keys(idx.proveedores).length+' codigos',
    'TIEMPO_TOTAL_SEG,'+elapsed
  ].join('\r\n'), 'resumen_inventario_'+stFecha()+'.csv');
  log('  Resumen: '+outPath);
}

function escribirSinPrecio(sinPrecio) {
  var lines = ['CODIGO,DESCRIPCION'];
  for(var i=0;i<sinPrecio.length;i++) lines.push([sinPrecio[i].cod,sinPrecio[i].desc].map(escCSV).join(','));
  var outPath = escribirEnTodas(lines.join('\r\n'), 'inventario_sin_precio_'+stFecha()+'.csv');
  log('  Sin precio ('+sinPrecio.length+'): '+outPath);
}

/* ═════════════════════════════════════════════════════════════
   MODO COMPLETO
   ═════════════════════════════════════════════════════════════ */
function modoCompleto(opts) {
  var objetivo = opts.objetivo || 70;
  var presupuestoMs = (opts.tiempo || 600) * 1000;
  var outF = opts.out || null;
  var t0 = Date.now(), finT = t0 + presupuestoMs;

  log('=========================================================');
  log('  EXTRACTOR DE INVENTARIO MIXNET  (solo lectura)');
  log('  Objetivo: '+objetivo+'% con precio/stock  Presupuesto: '+Math.round(presupuestoMs/1000)+'s');
  log('=========================================================');

  // 1. Detectar unidades
  log('\n[PASO 1/5] Detectando unidades...');
  var unidades = detectarUnidades();
  if(!unidades.length){
    log('[ERROR] No hay unidades accesibles. Verifica la red.');
    return;
  }

  // 2. Buscar compañía (MXCTACLI) → carpeta de datos
  log('\n[PASO 2/5] Buscando MXCTACLI (tabla maestra de clientes)...');
  var comps = buscarCompania(unidades, Math.min(60000, Math.round(presupuestoMs/3)));
  if(!comps.length){
    log('[ERROR] No encontré MXCTACLI.DBF (se usa para ubicar la carpeta de datos).');
    log('  Ejecuta --explorar para ver qué tablas DBF existen.');
    return;
  }
  log('  Carpeta de datos: '+comps[0].dir+' ('+comps[0].regs+' clientes, '+
      Math.round(comps[0].size/1024)+'KB)');

  // 3. Escanear en busca de tablas de productos
  log('\n[PASO 3/5] Buscando tablas de inventario (priorizando carpetas MixNet)...');
  var esc = crearEscaneador(unidades);
  var dbClasificados = [];
  var tablaPrincipal = null;
  var todosMeta = [];
  var tablaMeta = {};
  var ronda = 0;

  while(esc.hayPendientes() && Date.now()<finT){
    ronda++;
    var nuevos = esc.recorrer(4000);
    if(nuevos.length){
      dbClasificados = dbClasificados.concat(nuevos);
      todosMeta = todosMeta.concat(esc.meta);
      // Actualizar tabla principal
      tablaPrincipal = null;
      var maxFilas = 0;
      for(var ti=0;ti<dbClasificados.length;ti++){
        var reg = dbClasificados[ti];
        var c = reg.clasif;
        if(c.camposCod.length && c.camposDesc.length && (c.camposPre.length||c.camposStk.length)){
          if(c.total > maxFilas){ tablaPrincipal = c; maxFilas = c.total; }
        }
      }
      // Construir índice y medir
      var idx = construirIndice(dbClasificados);
      var cob = aplicarEnriquecimiento(tablaPrincipal? tablaPrincipal.rows : [], camposArticulo(tablaPrincipal? tablaPrincipal.camposTodos:[]), idx);
      log('  Ronda '+ronda+': tablas=:'+dbClasificados.length+', articulos='+(tablaPrincipal?tablaPrincipal.total:0)+
          ', precio='+cob.pctPrecio+'%, stock='+cob.pctStock+'%, fam='+cob.pctFam+'%, prov='+cob.pctProv+'%');
      // Guardar tablaMeta para informe
      for(var mi=0;mi<esc.meta.length;mi++){
        var mm = esc.meta[mi];
        if(!tablaMeta[mm.path]) tablaMeta[mm.path] = mm;
      }
      if(cob.pctPrecio >= objetivo){ log('  >>> OBJETIVO ALCANZADO: '+cob.pctPrecio+'% con precio <<<'); break; }
    }
  }

  var tScan = Math.round((Date.now()-t0)/1000);
  log('\n  Escaneo finalizado en '+tScan+'s. Tablas inventario: '+dbClasificados.length);

  if(!tablaPrincipal){
    log('[ERROR] No se encontró ninguna tabla de ARTICULOS con código + descripción.');
    log('  Usa --diagnostico para inspeccionar una carpeta específica.');
    // Escribir reporte de exploración de todas las tablas encontradas
    var repLines = ['TIPO,ARCHIVO,TOTAL,CAMPOS'];
    for(var ri=0;ri<todosMeta.length;ri++){
      var m = todosMeta[ri];
      repLines.push([m.tipo,path.basename(m.path),m.total,camposTodosJoin(m)].map(escCSV).join(','));
    }
    var repPath = escribirEnTodas(repLines.join('\r\n'), 'exploracion_inventario_'+stFecha()+'.csv');
    log('  Reporte exploración: '+repPath);
    return;
  }

  var campos = camposArticulo(tablaPrincipal.camposTodos);
  log('\n  TABLA PRINCIPAL: '+tablaPrincipal.path);
  log('  Artículos: '+tablaPrincipal.total);
  log('  Campo código: '+(campos.codF||'NO DETECTADO'));
  log('  Campo descripción: '+(campos.descF||'NO DETECTADO'));
  log('  Campo precio: '+(campos.precioF||'NO DETECTADO'));
  log('  Campo stock: '+(campos.stockF||'NO DETECTADO'));

  // 4. Escribir CSV inmediato
  log('\n[PASO 4/5] Escribiendo CSV de inventario...');
  var stamp = stFecha();
  var base = outF || 'inventario_mixnet_'+stamp;
  var ext = (base.slice(-4).toLowerCase()==='.csv')?'':'.csv';
  var mainPath = resolveOutPath(base+ext);

  // Aplicar enriquecimiento
  var cob = aplicarEnriquecimiento(tablaPrincipal.rows, campos, idx);
  var head = tablaPrincipal.camposTodos.slice();
  head.push('__precio1','__precio2','__stock_txt','__familia','__proveedor');

  // Agregar cols de precio/tabla de precios como __prec_NOMBRE
  var colsPrecExt = [];
  var idx2 = construirIndice(dbClasificados); // reconstruir para extraer columnas extras
  // (ya tenemos las keys de idx2.precios por Ncod, pero no las columnas originales)
  // Extraer columnas de precio originales del indice (ya en __precio1/2). No es necesario más.

  // Agregar precio original de la tabla principal si existen
  for(var pi=0;pi<tablaPrincipal.camposPre.length;pi++){
    var pf = tablaPrincipal.camposPre[pi];
    if(head.indexOf(pf)===-1) head.push(pf);
  }
  // Agregar columnas de stock/fam/orig si no están
  for(var si2=0;si2<tablaPrincipal.camposStk.length;si2++){
    var sf2 = tablaPrincipal.camposStk[si2];
    if(head.indexOf(sf2)===-1) head.push(sf2);
  }
  for(var fi3=0;fi3<tablaPrincipal.camposFam.length;fi3++){
    var ff2 = tablaPrincipal.camposFam[fi3];
    if(head.indexOf(ff2)===-1) head.push(ff2);
  }
  for(var vi2=0;vi2<tablaPrincipal.camposProv.length;vi2++){
    var vf2 = tablaPrincipal.camposProv[vi2];
    if(head.indexOf(vf2)===-1) head.push(vf2);
  }

  var resBase = escribirCSVTodas(tablaPrincipal.rows, head, base + ext);
  mainPath = resBase.primera;
  log('  [CSV BASE GUARDADO] ' + mainPath + ' (' + tablaPrincipal.rows.length + ' articulos)');
  log('  Copias escritas en ' + resBase.rutas.length + ' ubicaciones:');
  for (var rb = 0; rb < resBase.rutas.length; rb++) {
    log('      - ' + resBase.rutas[rb]);
  }

  // 5. Reportes
  log('\n[PASO 5/5] Generando reportes...');
  escribirSinPrecio(cob.sinPrecio);
  escribirResumen(campos, tablaPrincipal, idx, cob, {tablas:dbClasificados.length}, t0);

  // Exploración completa de tablas encontradas
  var repPath = escribirEnTodas(
    ['TIPO,ARCHIVO,TOTAL,CAMPOS'].concat(todosMeta.map(function(mm){
      return [mm.tipo, path.basename(mm.path), mm.total, (mm.camposTodos||[]).slice(0,30).join(';')].map(escCSV).join(',');
    })).join('\r\n'), 'exploracion_inventario_'+stamp+'.csv');
  log('  Exploracion tablas: ' + repPath);

  log('\n=========================================================');
  log('  RESUMEN DE COBERTURA');
  log('=========================================================');
  log('  Total artículos: '+cob.total);
  log('  Con precio:      '+cob.conPrecio+' ('+cob.pctPrecio+'%)');
  log('  Con stock:       '+cob.conStock+' ('+cob.pctStock+'%)');
  log('  Con familia:     '+cob.conFam+' ('+cob.pctFam+'%)');
  log('  Con proveedor:   '+cob.conProv+' ('+cob.pctProv+'%)');
  log('=========================================================');
  log('  CSV: '+mainPath);
  log('=========================================================');
}

function camposTodosJoin(m){ return (m.camposTodos||[]).slice(0,30).join(';'); }

/* ═════════════════════════════════════════════════════════════
   MODO EXPLORAR
   ═════════════════════════════════════════════════════════════ */
function modoExplorar(opts) {
  var presupuestoMs = (opts.tiempo || 300)*1000;
  var t0 = Date.now();
  log('=========================================================');
  log('  EXPLORADOR DE INVENTARIO MIXNET');
  log('=========================================================');

  var unidades = detectarUnidades();
  if(!unidades.length) return;

  log('\n--- Escaneo (presupuesto '+Math.round(presupuestoMs/1000)+'s) ---');
  var esc = crearEscaneador(unidades);
  while(esc.hayPendientes() && Date.now()-t0 < presupuestoMs) esc.recorrer(4000);

  log('\n  RESUMEN:');
  log('  DBF totales: '+esc.stats.dbfEncontrados);
  log('  DBF procesados (lectura de campos): '+esc.stats.procesados);
  log('  Tablas con datos de inventario: '+esc.meta.length);
  log('  Tiempo: '+Math.round((Date.now()-t0)/1000)+'s');

  // Clasificar encontrados
  var porTipo = {};
  for(var i=0;i<esc.meta.length;i++){
    var tipo = esc.meta[i].tipo || 'OTROS';
    if(!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(esc.meta[i]);
  }

  log('\n  Tablas por tipo:');
  var tipos = Object.keys(porTipo);
  for(var ti=0;ti<tipos.length;ti++){
    var arr = porTipo[tipos[ti]];
    log('    '+tipos[ti]+': '+arr.length+' tablas');
    for(var ai=0;ai<Math.min(3,arr.length);ai++){
      log('      '+path.basename(arr[ai].path)+' ('+arr[ai].total+' regs, '+
          arr[ai].camposTodos.slice(0,5).join(',')+'...)');
    }
  }

  var stamp = stFecha();
  var repLines = ['TIPO,ARCHIVO,TOTAL,RUTA,CAMPOS'];
  for(var ri=0;ri<esc.meta.length;ri++){
    var m = esc.meta[ri];
    repLines.push([m.tipo, path.basename(m.path), m.total, m.path, (m.camposTodos||[]).slice(0,20).join(';')].map(escCSV).join(','));
  }
  var repPath = escribirEnTodas(repLines.join('\r\n'), 'exploracion_inventario_'+stamp+'.csv');
  log('\n  Reporte guardado: '+repPath);
}

/* ═════════════════════════════════════════════════════════════
   MODO DIAGNOSTICO
   ═════════════════════════════════════════════════════════════ */
function modoDiagnostico(baseDir) {
  log('=========================================================');
  log('  DIAGNÓSTICO DE INVENTARIO EN CARPETA');
  log('=========================================================');
  log('Carpeta: '+baseDir);
  if(!fs.existsSync(baseDir)){ log('[ERROR] La carpeta no existe.'); return; }

  var entries;
  try { entries = fs.readdirSync(baseDir); } catch(e) { log('[ERROR] '+e.message); return; }

  var total = 0, producto = 0, conPrecio = 0, conStock = 0, conFam = 0, conProv = 0;
  var reportLines = ['TIPO,ARCHIVO,TOTAL,CAMPOS'];
  var reportPath = resolveOutPath('diagnostico_inv_'+stFecha()+'.csv');

  for(var ei=0; ei<entries.length; ei++){
    if(!/\.dbf$/i.test(entries[ei])) continue;
    var fp = path.join(baseDir, entries[ei]);
    var st; try{ st=fs.statSync(fp); } catch(_){continue;} if(st.size<33) continue;
    total++;
    var leido = readDbfHeaderFields(fp, false);
    if(!leido) continue;
    var cls = clasificarCampos(leido.fields);
    reportLines.push([cls.tipo, entries[ei], cls.header?cls.header.numRecords:'?', cls.camposTodos.join(';')].map(escCSV).join(','));

    if(cls.esProducto){
      producto++;
      if(cls.camposPre.length) conPrecio++;
      if(cls.camposStk.length) conStock++;
      if(cls.camposFam.length) conFam++;
      if(cls.camposProv.length) conProv++;
      log('  ['+cls.tipo+'] '+entries[ei]+' ('+cls.header.numRecords+' regs)');
      log('      cod='+(cls.camposCod[0]||'-')+' desc='+(cls.camposDesc[0]||'-')+
          ' prec='+(cls.camposPre[0]||'-')+' stk='+(cls.camposStk[0]||'-')+
          ' fam='+(cls.camposFam[0]||'-')+' prov='+(cls.camposProv[0]||'-'));
    }
  }

  log('\n  RESUMEN:');
  log('  DBF totales: '+total);
  log('  Con campos de inventario: '+producto);
  log('  Con precio: '+conPrecio);
  log('  Con stock: '+conStock);
  log('  Con familia: '+conFam);
  log('  Con proveedor: '+conProv);

  var reportPath = escribirEnTodas(reportLines.join('\r\n'), 'diagnostico_inv_'+stFecha()+'.csv');
  log('\n  Reporte: '+reportPath);
}

/* ═════════════════════════════════════════════════════════════
   MODO ESQUEMA
   ═════════════════════════════════════════════════════════════ */
function modoEsquema(filePath) {
  log('Esquema de: '+filePath);
  var leido = readDbfHeaderFields(filePath, false);
  if(!leido) { log('[ERROR] No se pudo leer.'); return; }
  log('Registros: '+leido.header.numRecords+' | Fecha: '+leido.header.lastUpd.y+'/'+leido.header.lastUpd.m+'/'+leido.header.lastUpd.d);
  log('Campos ('+leido.fields.length+'):');
  var cls = clasificarCampos(leido.fields);
  for(var i=0;i<leido.fields.length;i++){
    var f = leido.fields[i];
    var m = '';
    if(cls.camposCod.indexOf(f.name)!==-1)  m+=' <COD';
    if(cls.camposDesc.indexOf(f.name)!==-1) m+=' <DESC';
    if(cls.camposPre.indexOf(f.name)!==-1)  m+=' <PRECIO';
    if(cls.camposStk.indexOf(f.name)!==-1)  m+=' <STOCK';
    if(cls.camposFam.indexOf(f.name)!==-1)  m+=' <FAMILIA';
    if(cls.camposProv.indexOf(f.name)!==-1) m+=' <PROV';
    log('  '+(i+1).toString().padStart(2)+'. '+f.name+' ['+f.type+' '+f.len+']'+m);
  }
  log('\nClasificación: '+cls.tipo);
}

/* ═════════════════════════════════════════════════════════════
   MAIN
   ═════════════════════════════════════════════════════════════ */
function main() {
  var args = process.argv.slice(2);
  var objetivo = 70, tiempo = 600, out = null;
  var modos = [];
  for(var i=0;i<args.length;i++){
    var a=args[i];
    if(a==='--objetivo'){ objetivo=parseInt(args[i+1],10)||70; i++; }
    else if(a==='--tiempo'){ tiempo=parseInt(args[i+1],10)||600; i++; }
    else if(a==='--out'){ out=args[i+1]; i++; }
    else modos.push(a);
  }
  var opts = { objetivo:objetivo, tiempo:tiempo, out:out };

  if(!modos.length){
    log('=========================================================');
    log('  EXTRACTOR DE INVENTARIO MIXNET (automático)');
    log('  Objetivo: '+objetivo+'%  Presupuesto: '+tiempo+'s');
    log('=========================================================');
    modoCompleto(opts);
    return;
  }

  var mode = modos[0];
  if(mode==='--explorar'||mode==='--explore')  return modoExplorar(opts);
  if(mode==='--diagnostico'||mode==='--diag')  return modoDiagnostico(modos[1]||'M:\\comp01');
  if(mode==='--completo'||mode==='--inventario') return modoCompleto(opts);
  if(mode==='--esquema')                       return modoEsquema(modos[1]||'');
  if(mode==='--detectar')                       return detectarUnidades();

  log('=========================================================');
  log('  EXTRACTOR DE INVENTARIO MIXNET v1');
  log('=========================================================');
  log('');
  log('  USO RECOMENDADO:');
  log('    node extraer-inventario-mixnet.cjs                      Flujo completo');
  log('    node extraer-inventario-mixnet.cjs --objetivo 85        Buscar hasta 85% de precio');
  log('    node extraer-inventario-mixnet.cjs --explorar           VER qué tablas hay');
  log('    node extraer-inventario-mixnet.cjs --diagnostico "RUTA" Inspeccionar una carpeta');
  log('');
  log('  OTROS:');
  log('    --esquema "RUTA\\ARCHIVO.DBF"   Ver campos de un DBF');
  log('    --detectar                       Ver unidades accesibles');
}

/* ───────────────────────────────────────────────────────────── */
try { main(); } catch(e) {
  var msg = e&&e.stack? e.stack:String(e);
  log('\n[FATAL] '+msg);
  try { fs.writeFileSync(path.join(__dirname,'error_inventario.log'),
      'FECHA: '+new Date().toLocaleString()+'\r\nERROR: '+msg+'\r\n','utf8');
    log('  Log: error_inventario.log'); } catch(_){}
  process.exit(1);
}