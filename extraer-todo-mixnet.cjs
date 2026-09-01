/*
  ============================================================
  JJ Paper — Extractor TOTAL de MixNet (DBF dBase)
  ============================================================
  Captura TODA la informacion util para nutrir JJ Paper:

    [A] INVENTARIO / CATALOGO  -> codigo real, nombre real,
        descripcion, precio(s), existencia/stock, familia,
        categoria, proveedor, impuesto.

    [B] CLIENTES               -> codigo, razon social, RIF,
        direccion, telefonos, contacto, email, vendedor,
        cobrador, zona, saldo, limite de credito, banco.

    [C] MAESTRAS DE REFERENCIA -> vendedores, cobradores,
        zonas, familias, proveedores, bancos de clientes.

  Objetivo principal: que los productos del catalogo de JJ Paper
  puedan coincidir con los productos REALES de MixNet por codigo
  de inventario, nombre real, precio real y existencia real.

  AUTODETECTA por nombre de CAMPO (no depende de nombres de archivo).

  USO:
    node extraer-todo-mixnet.cjs                flujo completo
    node extraer-todo-mixnet.cjs --tiempo 900   mas presupuesto
    node extraer-todo-mixnet.cjs --explorar     ver que tablas hay
    node extraer-todo-mixnet.cjs --diagnostico "M:\comp01"
    node extraer-todo-mixnet.cjs --esquema "RUTA\ARCHIVO.DBF"

  Compatible con Node 13+ (CommonJS). 2026-09-01 v1
  ============================================================
*/
'use strict';

var fs = require('fs');
var path = require('path');

/* ─────────── E/S ─────────── */
function say(s){ try{ fs.writeSync(1, s+'\n'); }catch(_){ console.log(s); } }
function ts(){ return new Date().toLocaleTimeString(); }
function log(m){ say('['+ts()+'] '+m); }

/* ─────────── LECTOR DBF ─────────── */
function readDbfHeader(buf){
  return { numRecords:buf.readUInt32LE(4), headerLen:buf.readUInt16LE(8),
           recordLen:buf.readUInt16LE(10),
           lastUpd:{ y:buf[1]+1900, m:buf[2], d:buf[3] } };
}
function decodeStr(buf,start,len){
  var s=''; for(var i=start;i<start+len;i++){ var c=buf[i]; if(c===0) break; s+=String.fromCharCode(c); }
  return s.trim();
}
function readDbfFields(buf,headerLen){
  var fields=[],off=32;
  while(off+32<=headerLen-1 && buf[off]!==0x0D){
    fields.push({ name:decodeStr(buf,off,11).replace(/\0/g,'').trim().toLowerCase(),
                  type:String.fromCharCode(buf[off+11]), len:buf.readUInt16LE(off+16), dec:buf[off+17] });
    off+=32;
  }
  return fields;
}
function readDbfHeaderFields(filePath){
  var buf; try{ buf=fs.readFileSync(filePath); }catch(_){ return null; }
  if(buf.length<33) return null;
  var hdr; try{ hdr=readDbfHeader(buf); }catch(_){ return null; }
  if(hdr.headerLen<32||hdr.recordLen<1||hdr.headerLen>buf.length) return null;
  var fields; try{ fields=readDbfFields(buf,hdr.headerLen); }catch(_){ return null; }
  return { header:hdr, fields:fields, size:buf.length };
}
function readDbfData(filePath){
  var buf; try{ buf=fs.readFileSync(filePath); }catch(_){ return null; }
  if(buf.length<33) return null;
  var hdr; try{ hdr=readDbfHeader(buf); }catch(_){ return null; }
  if(hdr.headerLen<32||hdr.recordLen<1||hdr.headerLen>buf.length) return null;
  var fields; try{ fields=readDbfFields(buf,hdr.headerLen); }catch(_){ return null; }
  var maxEnd=Math.min(hdr.headerLen+hdr.numRecords*hdr.recordLen, buf.length);
  var rows=[],pos=hdr.headerLen;
  while(pos+hdr.recordLen<=maxEnd && rows.length<300000){
    var rec=buf.slice(pos,pos+hdr.recordLen);
    if(rec[0]!==0x2A && rec[0]===0x20){
      var obj={},fpos=1;
      for(var fi=0;fi<fields.length;fi++){ var f=fields[fi]; if(fpos+f.len>rec.length) break;
        obj[f.name]=decodeStr(rec,fpos,f.len); fpos+=f.len; }
      rows.push(obj);
    }
    pos+=hdr.recordLen;
  }
  return { fields:fields, rows:rows, numRecords:hdr.numRecords, filePath:filePath };
}

/* ─────────── TEXTOS ─────────── */
function normTxt(s){ if(s==null)return''; s=String(s).toLowerCase().trim();
  if(s.normalize) s=s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return s.replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }
function normCod(s){ if(s==null)return''; return String(s).toLowerCase().trim()
  .split('-').map(function(seg){return seg.replace(/^0+/,'');}).join('-')
  .replace(/[^a-z0-9\-]/g,''); }
function escCSV(v){ v=(v==null?'':String(v)).trim(); return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function toCSV(rows,head){ var l=[head.join(',')]; for(var i=0;i<rows.length;i++){ var r=rows[i],c=[];
    for(var j=0;j<head.length;j++) c.push(escCSV(r[head[j]])); l.push(c.join(',')); } return l.join('\r\n'); }
function findField(keys, cands, def){ for(var ci=0;ci<cands.length;ci++){ var c=cands[ci];
    for(var ki=0;ki<keys.length;ki++){ var k=keys[ki]; if(k===c||k.indexOf(c)===0||k.indexOf(c)!==-1) return k; } }
  return def; }
function hasField(keys, re){ for(var i=0;i<keys.length;i++){ if(re.test(keys[i])) return true; } return false; }

/* ─────────── RUTAS (escribe en TODAS, garantiza C:) ─────────── */
function rutasSalida(nombre){
  var rutas=[], vista=[], userHome=process.env.USERPROFILE||'';
  try{
    var regs=[
      '"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop',
      '"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders" /v Desktop'];
    for(var ri=0;ri<regs.length;ri++){
      var out=require('child_process').execSync('reg query '+regs[ri],{encoding:'utf8'});
      var m=out.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i);
      if(m){ var v=m[1].trim(); v=v.replace(/%USERPROFILE%/i,process.env.USERPROFILE||'');
        vista.push(v); }
    }
  }catch(_){}
  var cand=[];
  if(userHome) cand.push(userHome+'\\Desktop',userHome+'\\Escritorio',userHome+'\\Documents\\Desktop');
  cand.push('C:\\Users\\Public\\Desktop','C:\\Users\\Public\\Escritorio');
  for(var ci=0;ci<cand.length;ci++){ try{ if(fs.existsSync(cand[ci])&&fs.statSync(cand[ci]).isDirectory()) rutas.push(path.join(cand[ci],nombre)); }catch(_){} }
  for(var vi=0;vi<vista.length;vi++){ try{ if(fs.existsSync(vista[vi])&&fs.statSync(vista[vi]).isDirectory()) rutas.push(path.join(vista[vi],nombre)); }catch(_){} }
  rutas.push(path.join(__dirname,nombre));
  var unicas=[],visto={};
  for(var ui=0;ui<rutas.length;ui++){ var r=path.normalize(rutas[ui]); if(!visto[r]){visto[r]=true;unicas.push(r);} }
  return unicas;
}
function escribirEnTodas(texto,outF){
  var nombre = outF && path.isAbsolute(outF)? path.basename(outF):outF;
  var rutas=rutasSalida(nombre), primera=null;
  for(var i=0;i<rutas.length;i++){ try{ fs.writeFileSync(rutas[i],texto,'utf8'); if(!primera)primera=rutas[i]; }catch(_){} }
  return primera||path.join(__dirname,nombre);
}
function escribirCSVTodas(rows,head,outF){
  var csv=toCSV(rows,head);
  var p=escribirEnTodas(csv,outF);
  return p;
}
function stFecha(){ var d=new Date(), p=function(n){return String(n).padStart(2,'0');};
  return ''+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); }

/* ─────────── UNIDADES ─────────── */
function detectarUnidades(){
  var unidades=[],cand=['M:','P:','Z:','C:','D:','E:','F:','G:','H:','I:'];
  log('Detectando unidades...');
  for(var i=0;i<cand.length;i++){ var u=cand[i],root=u+'\\';
    try{ if(fs.existsSync(root)){ var e=fs.readdirSync(root); unidades.push({letra:u,root:root});
      log('  [OK] '+u+'/  ('+e.length+' elementos)'); }else log('  [--] '+u+'/ no existe');
    }catch(err){ log('  [!!] '+u+'/ '+err.message); } }
  return unidades;
}

/* ─────────── CLASIFICACION DE TABLAS por campos ─────────── */
var RE_COD   = /(^|_)(cod|code|id|id_art|art|item|nro|numero)$|^cod|^id$|^art_|^articulo_|^nro$/i;
var RE_DESC  = /^descri|^artic|^nombr|^producto|^detalle|^denomi|^nombre_|^desc_/i;
var RE_PREC  = /^prec|pvp|p\.?vent|^cost|p\.?mayor|p\.?minor|precio|pventa|pmayor|p1|p2|costo/i;
var RE_STOCK = /^exis|stock|saldo|cant|dispo|stk|^exist/i;
var RE_FAM   = /^fam|grupo|categ|rubro|linea|^tipo$|^seccion|^depart/i;
var RE_PROV  = /^prove|provee|suplidor|^alma|^deposito|^bodega/i;
var RE_CLIENT= /^nomcli|^razon|^cliente|^nombrecli|^denominacion/i;
var RE_RIF   = /^rif|^nit|^cedula|^cif|^identif/i;
var RE_TEL   = /^telf|^tel|^tlf|^mova|^celul|^telefo/i;
var RE_DIR   = /^direc|^dir$|^dom|^dirc/i;
var RE_FECHA = /^fecha|^fec|^fch|^date/i;
var RE_DOCTO = /^nro|^num|^factura|^docto|^doc/;
var RE_VEND  = /^vendedor|^vend|^vended/;
var RE_NOM   = /^nom|^razon|^nombre|^descrip/i;

function clasificar(fields){
  var fn=fields.map(function(f){ return f.name; });
  var has=function(re){ return hasField(fn,re); };
  var r=function(re){ return fn.filter(function(n){ return re.test(n); }); };
  var res={ fn:fn,
    cod:r(RE_COD), desc:r(RE_DESC), prec:r(RE_PREC), stk:r(RE_STOCK),
    fam:r(RE_FAM), prov:r(RE_PROV), cli:r(RE_CLIENT), rif:r(RE_RIF),
    tel:r(RE_TEL), dir:r(RE_DIR), fec:r(RE_FECHA), docto:r(RE_DOCTO),
    hasFec:has(RE_FECHA), hasCli:has(RE_CLIENT), hasRif:has(RE_RIF),
    hasTel:has(RE_TEL), hasCod:has(RE_COD), hasDesc:has(RE_DESC),
    hasPrec:has(RE_PREC), hasStk:has(RE_STOCK) };

  var tipo='OTRA';
  var scoreCli=(res.cli.length?1:0)+(res.rif.length?1:0)+(res.hasTel?1:0)+(res.hasRif?1:0);
  var scoreArt=0; if(res.hasCod&&res.hasDesc) scoreArt+=2; if(res.hasPrec) scoreArt+=2; if(res.hasStk) scoreArt+=1;

  if(scoreArt>=3 && res.cli.length===0) tipo=(res.hasFec?'VENTAS_LINEAS':'INVENTARIO');
  else if(scoreCli>=3) tipo=(res.hasFec||res.hasDocto?'MOVIMIENTO_CLIENTE':'CLIENTES');
  else if(res.hasCod&&res.hasFec&&res.hasDesc) tipo='MOVIMIENTOS';
  else if(res.hasCod&&res.hasPrec&&!res.hasDesc) tipo='PRECIOS';
  else if(res.hasCod&&res.hasStk&&!res.hasDesc) tipo='STOCK';
  else if(res.hasCod&&res.hasFam&&!res.hasDesc) tipo='FAMILIAS';
  else if(res.hasCod&&res.hasProv&&!res.hasDesc) tipo='PROVEEDORES';
  else if(res.fam.length>=2 && res.nombre0) tipo='CUALQUIERA';

  res.tipo=tipo; return res;
}

/* ─────────── ESCANEO CON PRESUPUESTO ─────────── */
var EXCLUDE=/windows|program files|programdata|appdata|perflogs|\$recycle|fonts|drivers|\.git|node_modules|\$windows|bluestacks|anaconda|nodejs|python|nvidia|intel\b|\.thumbnails|dcim|music|videos|pictures|musica|common files|microsoft office|microsoft.net|installshield|nero|brother|bullzip|hp\\|adobe|mozilla|google|java\\|intel\\|dvd maker/i;
var PRIO=/mixnet|mixer|respami|comp\d|multiemp|ventas|venta|factura|sistema|datos|base|clientes|contab|bases|dbf|banco|admin|\bmx\b|invent|stock|articulo|precio|provee|impuest/i;

function crearEscaneador(unidades){
  var queue=[],visitados={};
  var stats={carpetas:0,dbf:0,procesados:0,errores:0,ignoradas:0};
  var meta=[];
  for(var i=0;i<unidades.length;i++) queue.push({dir:unidades[i].root,prio:0,depth:0});
  function prioDe(n,d){ var p=100-d*3; if(PRIO.test(n))p+=800; if(/\.bak|backup|old|orig|tmp/i.test(n))p-=400; return p; }
  return {
    stats:stats, meta:meta,
    hayPendientes:function(){ return queue.length>0; },
    pendientes:function(){ return queue.length; },
    recorrer:function(limite){
      var leidos=[],proc=0;
      queue.sort(function(a,b){return b.prio-a.prio;});
      while(queue.length&&proc<limite){
        var item=queue.pop(),dir=item.dir,depth=item.depth; proc++;
        if(visitados[dir])continue; visitados[dir]=true; if(depth>45)continue;
        stats.carpetas++;
        var entries; try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(_){stats.errores++;continue;}
        for(var i=0;i<entries.length;i++){
          var e=entries[i],fp=path.join(dir,e.name);
          if(e.isDirectory()){ if(EXCLUDE.test(e.name)){stats.ignoradas++;continue;}
            queue.push({dir:fp,prio:prioDe(e.name,depth+1),depth:depth+1}); }
          else if(e.isFile()&&/\.dbf$/i.test(e.name)){
            stats.dbf++; var st; try{st=fs.statSync(fp);}catch(_){continue;} if(st.size<33)continue;
            var l=readDbfHeaderFields(fp); if(!l)continue; stats.procesados++;
            var cls=clasificar(l.fields);
            cls.path=fp; cls.nombre=path.basename(fp); cls.regs=l.header.numRecords; cls.size=st.size; cls.fecha=l.header.lastUpd;
            meta.push(cls);
          }
        }
        if(stats.carpetas%400===0) log('    ...'+stats.carpetas+' carpetas, '+stats.dbf+' DBF, '+stats.procesados+' procesados');
      }
      return leidos;
    }
  };
}

/* ─────────── MODO COMPLETO ─────────── */
function modoCompleto(opts){
  var presupuestoMs=(opts.tiempo||900)*1000;
  var t0=Date.now(), finT=t0+presupuestoMs;
  var stamp=stFecha();

  log('=========================================================');
  log('  EXTRACTOR TOTAL MIXNET  (solo lectura)');
  log('  Captura: inventario, clientes y tablas maestras');
  log('  Presupuesto: '+Math.round(presupuestoMs/1000)+'s');
  log('=========================================================');

  // 1. Unidades
  log('\n[PASO 1/4] Detectando unidades...');
  var unidades=detectarUnidades();
  if(!unidades.length){ log('[ERROR] No hay unidades.'); return; }

  // 2. Escanear y clasificar
  log('\n[PASO 2/4] Escaneando y clasificando tablas DBF...');
  var esc=crearEscaneador(unidades);
  while(esc.hayPendientes()&&Date.now()<finT) esc.recorrer(4000);
  var meta=esc.meta;
  log('\n  Fin escaneo: '+esc.stats.dbf+' DBF, '+esc.stats.procesados+' procesados, '+meta.length+' con datos utiles');

  // Clasificar por tipo
  var porTipo={};
  for(var mi=0;mi<meta.length;mi++){ var t=meta[mi].tipo; if(!porTipo[t])porTipo[t]=[]; porTipo[t].push(meta[mi]); }
  log('\n  Tablas por tipo:');
  var tipos=Object.keys(porTipo);
  for(var ti=0;ti<tipos.length;ti++){ log('    '+tipos[ti]+': '+porTipo[tipos[ti]].length); }

  // 3. Extraer datos de cada tipo y escribir CSV
  log('\n[PASO 3/4] Extrayendo datos de cada tabla...');
  var resumen=['TABLA_TIPO,CANTIDAD_TABLAS,REGISTROS_TOTAL'];
  var archivos=[];
  var contadores={ totalRegistros:0, tablas:0 };

  for(var tt=0;tt<tipos.length;tt++){
    var tipo=tipos[tt];
    var tablas=porTipo[tipo];
    // Ordenar por registros desc para ver la principal primero
    tablas.sort(function(a,b){ return b.regs-a.regs; });
    var regsTot=0;
    var tipoRows=[];
    // Unir las 2-3 tablas mas grandes del tipo (o todos si pocas)
    var limite=Math.min(tablas.length,3);
    for(var tb=0;tb<limite;tb++){
      var clsTabla=tablas[tb];
      var db=readDbfData(clsTabla.path);
      if(!db||!db.rows.length) continue;
      var headTodo=db.fields.map(function(f){return f.name;});
      regsTot+=db.rows.length;
      // Marcar origen
      var withOrigen=db.rows.map(function(r){ var o={__tabla:clsTabla.nombre}; for(var k in r)o[k]=r[k]; return o; });
      tipoRows=tipoRows.concat(withOrigen);
      contadores.totalRegistros+=db.rows.length;
      contadores.tablas++;
    }
    if(!tipoRows.length) continue;
    // Preparar columnas (unificar en la tabla mas grande)
    var head=[];
    for(var hi=0;hi<tipoRows.length;hi++){ Object.keys(tipoRows[hi]).forEach(function(k){ if(head.indexOf(k)===-1)head.push(k); }); }
    if(head.indexOf('__tabla')===-1) head.unshift('__tabla');
    var filename='mixnet_'+tipo.toLowerCase()+'_'+stamp+'.csv';
    var fp=escribirCSVTodas(tipoRows,head,filename);
    log('  ['+tipo+'] '+tipoRows.length+' registros en '+tipos.length+' tabla(s) -> '+fp);
    archivos.push({tipo:tipo,archivo:fp,regs:tipoRows.length});
    resumen.push(tipo+','+limite+','+regsTot);
  }

  contadores.tablas=debounceCount(contadores.tablas);
  log('\n  TABLAS EXTRAIDAS: '+contadores.tablas);
  log('  REGISTROS TOTALES: '+contadores.totalRegistros);

  // 4. Reporte final
  log('\n[PASO 4/4] Generando reportes...');
  var elap=Math.round((Date.now()-t0)/1000);
  // Resumen general
  var resLines=['METRICA,VALOR'].concat(resumen);
  resLines.push('TIEMPO_TOTAL_SEG,'+elap);
  var resPath=escribirEnTodas(resLines.join('\r\n'),'resumen_todo_mixnet_'+stamp+'.csv');
  log('  Resumen: '+resPath);

  // Exploracion de todas las tablas y campos
  var expLines=['TIPO,ARCHIVO,RUTA,REGISTROS,FECHA,CAMPOS'];
  for(var ei=0;ei<meta.length;ei++){
    var mm=meta[ei];
    expLines.push([mm.tipo,mm.nombre,mm.path,mm.regs,
      (mm.fecha? (mm.fecha.y+'/'+mm.fecha.m+'/'+mm.fecha.d):''),
      mm.fn.slice(0,25).join(';')].map(escCSV).join(','));
  }
  var expPath=escribirEnTodas(expLines.join('\r\n'),'exploracion_todo_mixnet_'+stamp+'.csv');
  log('  Exploracion tablas: '+expPath);

  log('\n=========================================================');
  log('  TERMINADO EN '+elap+'s');
  log('=========================================================');
  log('  Archivos generados en C: (junto a los .bat) y escritorio:');
  for(var ai=0;ai<archivos.length;ai++) log('    - '+path.basename(archivos[ai].archivo)+'  ['+archivos[ai].tipo+']  '+archivos[ai].regs+' regs');
  log('    - '+path.basename(resPath)+'  [resumen]');
  log('    - '+path.basename(expPath)+'  [exploracion tablas]');
  log('=========================================================');
}

function debounceCount(n){ return n; }

/* ─────────── MODO EXPLORAR ─────────── */
function modoExplorar(opts){
  var pres=(opts.tiempo||300)*1000, t0=Date.now();
  log('=========================================================');
  log('  EXPLORADOR TOTAL MIXNET');
  log('=========================================================');
  var unidades=detectarUnidades();
  if(!unidades.length) return;
  log('\n--- Escaneo (presupuesto '+Math.round(pres/1000)+'s) ---');
  var esc=crearEscaneador(unidades);
  while(esc.hayPendientes()&&Date.now()-t0<pres) esc.recorrer(4000);
  var meta=esc.meta;
  var porTipo={};
  for(var i=0;i<meta.length;i++){ var t=meta[i].tipo; if(!porTipo[t])porTipo[t]=[]; porTipo[t].push(meta[i]); }
  log('\n  RESUMEN: '+esc.stats.dbf+' DBF, '+meta.length+' con datos utiles en '+esc.stats.carpetas+' carpetas');
  var tipos=Object.keys(porTipo);
  log('\n  Tablas por tipo:');
  for(var ti=0;ti<tipos.length;ti++){
    var arr=porTipo[tipos[ti]];
    log('    '+tipos[ti]+': '+arr.length);
    for(var ai=0;ai<Math.min(4,arr.length);ai++)
      log('      '+arr[ai].nombre+' ('+arr[ai].regs+' regs, '+(arr[ai].fn.slice(0,6).join(','))+'...)');
  }
  var stamp=stFecha();
  var lines=['TIPO,ARCHIVO,RUTA,REGISTROS,FECHA,CAMPOS'];
  for(var mi2=0;mi2<meta.length;mi2++){ var m=meta[mi2];
    lines.push([m.tipo,m.nombre,m.path,m.regs,
      (m.fecha?(m.fecha.y+'/'+m.fecha.m+'/'+m.fecha.d):''), m.fn.slice(0,25).join(';')].map(escCSV).join(',')); }
  var fp=escribirEnTodas(lines.join('\r\n'),'exploracion_todo_mixnet_'+stamp+'.csv');
  log('\n  Reporte: '+fp);
}

/* ─────────── MODO DIAGNOSTICO ─────────── */
function modoDiagnostico(baseDir){
  log('DIAGNOSTICO:'+baseDir);
  if(!fs.existsSync(baseDir)){ log('[ERROR] no existe'); return; }
  var entries; try{entries=fs.readdirSync(baseDir);}catch(e){log('[ERROR] '+e.message);return;}
  var lines=['TIPO,ARCHIVO,REGISTROS,CAMPOS'];
  for(var i=0;i<entries.length;i++){ if(!/\.dbf$/i.test(entries[i]))continue;
    var fp=path.join(baseDir,entries[i]); var st; try{st=fs.statSync(fp);}catch(_){continue;} if(st.size<33)continue;
    var l=readDbfHeaderFields(fp); if(!l)continue;
    var cls=clasificar(l.fields);
    lines.push([cls.tipo,entries[i],l.header.numRecords,cls.fn.join(';')].map(escCSV).join(','));
    log('  ['+cls.tipo+'] '+entries[i]+' ('+l.header.numRecords+' regs) cod='+(cls.cod[0]||'-')+' desc='+(cls.desc[0]||'-')+' prec='+(cls.prec[0]||'-')+' stk='+(cls.stk[0]||'-')+' cli='+(cls.cli[0]||'-')+' rif='+(cls.rif[0]||'-'));
  }
  var fp2=escribirEnTodas(lines.join('\r\n'),'diagnostico_todo_'+stFecha()+'.csv');
  log('\n  Reporte: '+fp2);
}

/* ─────────── MODO ESQUEMA ─────────── */
function modoEsquema(filePath){
  log('Esquema: '+filePath);
  var l=readDbfHeaderFields(filePath);
  if(!l){ log('[ERROR] no se pudo leer'); return; }
  var cls=clasificar(l.fields);
  log('Registros: '+l.header.numRecords+' | Fecha: '+l.header.lastUpd.y+'/'+l.header.lastUpd.m+'/'+l.header.lastUpd.d+' | Tipo: '+cls.tipo);
  for(var i=0;i<l.fields.length;i++){ var f=l.fields[i]; var m='';
    if(cls.cod.indexOf(f.name)!==-1)m+=' <COD'; if(cls.desc.indexOf(f.name)!==-1)m+=' <DESC';
    if(cls.prec.indexOf(f.name)!==-1)m+=' <PREC'; if(cls.stk.indexOf(f.name)!==-1)m+=' <STOCK';
    if(cls.rif.indexOf(f.name)!==-1)m+=' <RIF'; if(cls.tel.indexOf(f.name)!==-1)m+=' <TEL';
    if(cls.dir.indexOf(f.name)!==-1)m+=' <DIR'; if(cls.fec.indexOf(f.name)!==-1)m+=' <FEC';
    log('  '+(i+1).toString().padStart(2)+'. '+f.name+' ['+f.type+' '+f.len+']'+m); }
}

/* ─────────── MAIN ─────────── */
function main(){
  var args=process.argv.slice(2);
  var tiempo=900, modos=[];
  for(var i=0;i<args.length;i++){ var a=args[i];
    if(a==='--tiempo'){tiempo=parseInt(args[i+1],10)||900;i++;}
    else modos.push(a); }
  var opts={tiempo:tiempo};
  if(!modos.length){ log('EXTRACTOR TOTAL MIXNET (automatico)'); modoCompleto(opts); return; }
  var mode=modos[0];
  if(mode==='--explorar'||mode==='--explore') return modoExplorar(opts);
  if(mode==='--diagnostico'||mode==='--diag') return modoDiagnostico(modos[1]||'M:\\comp01');
  if(mode==='--completo') return modoCompleto(opts);
  if(mode==='--esquema') return modoEsquema(modos[1]||'');
  if(mode==='--detectar') return detectarUnidades();
  log('USO:\n  node extraer-todo-mixnet.cjs          flujo completo\n  node extraer-todo-mixnet.cjs --explorar\n  node extraer-todo-mixnet.cjs --diagnostico "RUTA"\n  node extraer-todo-mixnet.cjs --esquema "RUTA\\ARCH.DBF"');
}

/* ─────────── WRAPPER ─────────── */
try{ main(); }catch(e){
  var msg=e&&e.stack?e.stack:String(e);
  log('\n[FATAL] '+msg);
  try{ fs.writeFileSync(path.join(__dirname,'error_todo.log'),'FECHA: '+new Date().toLocaleString()+'\r\n'+msg+'\r\n','utf8'); log('  Log: error_todo.log'); }catch(_){}
  process.exit(1);
}