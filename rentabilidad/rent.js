/* EXG — Rentabilidad de trabajos (V9.33, Daniel 09/10/2026)
   Cinco apartados: Resultado directo · Beneficio real · Coste de oportunidad · Simulador · Comparativa.
   Cada cifra lleva su nivel de fiabilidad: real (dato comprobado) · calculada (con datos comprobados) · estimada · falta (dato que no hay).
   Este archivo solo lee de la aplicación; escribe únicamente en rent_vinculos, rent_imputaciones, rent_historial y en sistema (rent_parametros, rent_escenarios). */
(function(){
'use strict';
const R = window.RENT = {};
const DAY = 86400000;
const PARAM0 = {reduccionAverias: 30, horasMecanicaSemana: 10, jornadas: 250, impuesto: 20, vidaUtil: 10, residualPct: 0, horasSocioDia: 8, diasSemanaSocios: 5, ocupacion: 70, horasDia: 6, indisponibilidad: 10, ahorroTaller: 50, condMecPct: 50, usarEstimaciones: true, margen: 10, repSemana: 10, gesSemana: 0};
R.param = {...PARAM0};
R.P = null;   // datos cargados
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const dia = s => String(s || '').slice(0, 10);
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const eur = (n, d) => { n = num(n); const neg = n < 0 && Math.abs(n) >= (d ? 0.005 : 0.5); const [e, dd] = Math.abs(n).toFixed(d || 0).split('.'); return (neg ? '−' : '') + e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dd ? ',' + dd : '') + ' €'; };
const pct = n => (isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString('es-ES') : '—') + ' %';
const h1 = n => (Math.round(num(n) * 10) / 10).toLocaleString('es-ES');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00').getTime() + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY);
R.util = {norm, dia, num, sum, eur, pct, h1, esc, addDays, diffDays};

// ---------- IVA: base de un documento ----------
R.baseGasto = d => { const des = Array.isArray(d.desglose_iva) ? d.desglose_iva : []; if(des.length) return Math.abs(sum(des, x => num(x.base))); const t = Math.abs(num(d.importe)), p = num(d.iva_pct); return p > 0 ? t / (1 + p / 100) : t; };
R.baseIngreso = d => { const t = num(d.importe), p = d.iva_pct != null ? num(d.iva_pct) : 0; return p > 0 ? t / (1 + p / 100) : t; };

// ---------- clasificación de líneas de albarán por máquina ----------
const CLASES = [['giratoria', /giratoria|excavadora|oruga|miniexcavadora/i], ['niveladora', /niveladora|motoniveladora/i], ['camion', /cami[oó]n|doble carro|multilift|volquete|portes?\b|carro\b/i], ['mixta', /retro|mixta|cargadora|pala\b|martillo/i], ['rulo', /rulo|compactad/i], ['cuba', /cuba|riego|agua/i]];
R.claseLinea = txt => { const t = String(txt || '').trim(), ini = t.split(/\s+/).slice(0, 2).join(' '); const c = CLASES.find(([, re]) => re.test(ini)) || CLASES.find(([, re]) => re.test(t)); return c ? c[0] : 'otros'; };   // la máquina va al principio de la línea («Retro cargando camión» es retro, no camión)
R.NOMBRE_CLASE = {mixta: 'Mixta (retro)', camion: 'Camión', giratoria: 'Giratoria', niveladora: 'Niveladora', rulo: 'Rulo', cuba: 'Cuba de agua', otros: 'Otros / sin máquina'};
R.lineas = d => (Array.isArray(d.conceptos) ? d.conceptos : []).map(c => ({f: dia(c.fecha) || dia(d.fecha_devengo), h: num(c.horas != null ? c.horas : (c.unidad === 'h' ? c.cantidad : 0)) || (/cuba\s+de\s+agua/i.test(c.descripcion || '') ? 1 : 0),   // V10.52 (Daniel): una cuba de agua cuenta como 1 h
    imp: num(c.importe), clase: R.claseLinea(c.descripcion), desc: c.descripcion || ''})).filter(l => l.f);

// ---------- carga ----------
async function pag(q, cols, fn){ const out = []; let o = 0; while(true){ let b = sb.from(q).select(cols); if(fn) b = fn(b); const {data, error} = await b.order(q === 'polizas_seguro' ? 'flota_id' : 'id', {ascending: true}).range(o, o + 999); if(error){ console.error('RENT carga ' + q, error); R.errores.push(q + ': ' + (error.message || error)); break; } out.push(...(data || [])); if(!data || data.length < 1000) break; o += 1000; } const vistos = new Set(); return out.filter(r => { if(r.id == null) return true; if(vistos.has(r.id)) return false; vistos.add(r.id); return true; }); }
R.errores = [];
R.cargar = async function(forzar){
  if(R.P && !forzar) return R.P;
  R.errores = [];
  const P = {};
  const [docs, gastos, flota, polizas, vinc, imp, sis, tarifas] = await Promise.all([
    pag('documentos_economicos', 'id,tipo,numero,fecha_devengo,entidad_id,obra_texto,importe,iva_pct,conceptos,cobrado_importe,estado_cobro,documento_siguiente_id,documento_anterior_id,documento_relacionado_id,estado', b => b.is('deleted_at', null).in('tipo', ['albaran', 'factura', 'proforma'])),
    pag('documentos_economicos', 'id,numero,fecha_devengo,entidad_id,importe,iva_pct,desglose_iva,categoria,concepto,vehiculo_id,relacion_actividad,contabilidad,lineas_fechadas,estado_calidad', b => b.is('deleted_at', null).eq('tipo', 'gasto')),
    pag('flota', 'id,nombre,clase,matricula,estado,coste_compra', b => b.neq('estado', 'vendida')),
    pag('polizas_seguro', 'flota_id,coste_anual,activa'),
    pag('rent_vinculos', '*'),
    pag('rent_imputaciones', '*', b => b.eq('activo', true)),
    pag('sistema', 'id,tipo,data', b => b.in('tipo', ['trabajo_cola', 'coste_hora', 'rent_parametros', 'rent_escenarios', 'costes_config', 'valoracion_flota'])),
    pag('entidades', 'id,nombre,tipo', b => b.is('deleted_at', null))
  ]);
  P.docs = docs; P.gastos = gastos; P.flota = flota; P.polizas = polizas.filter(p => p.activa !== false); P.vinculos = vinc; P.imput = imp; P.entidades = tarifas;
  P.jobs = sis.filter(r => r.tipo === 'trabajo_cola' && r.data).map(r => ({id: r.id, ...r.data}));
  const ch = sis.find(r => r.tipo === 'coste_hora'); P.ayudantes = (ch && ch.data && ch.data.ayudantes) || {};
  const pa = sis.find(r => r.tipo === 'rent_parametros'); P.paramId = pa ? pa.id : null; R.param = {...PARAM0, ...((pa && pa.data) || {})};
  const vf = sis.find(r => r.tipo === 'valoracion_flota' && r.data && r.data.clave === 'flota:valoracion'); P.valFlota = {}; ((vf && vf.data.items) || []).forEach(x => { if(x.maquina && x.estimado) P.valFlota[String(x.flota_id)] = x; });   // V11.63: el valor de venta de cada máquina es el de Valor flota (Economía)
  const es = sis.find(r => r.tipo === 'rent_escenarios'); P.escId = es ? es.id : null; P.escenarios = (es && es.data && es.data.lista) || []; P.esc2 = (es && es.data && es.data.lista2) || [];
  try{ P.socios = await costeSociosCargar(); }catch(e){ P.socios = []; R.errores.push('socios: ' + e.message); }
  try{ const {data} = await sb.from('tarifas').select('concepto,precio_particular'); P.tarifas = data || []; }catch(e){ P.tarifas = []; }
  if(window.COSTES){ try{ COSTES.aplicarCfg(sis.find(r => r.tipo === 'costes_config')); P.costes = COSTES.calcular(P, []); }catch(e){ P.costes = null; R.errores.push('costes: ' + e.message); console.error('COSTES', e); } }
  P.cargadoEn = Date.now(); R.P = P; return P;
};
R.invalidar = () => { R.P = null; };


// ---------- documentos que cuentan como ingreso: una factura sustituye a los albaranes con los que está enlazada (no se suma dos veces) ----------
R.efectivos = function(P){
  if(P._ef) return P._ef;
  const docs = (P.docs || []).filter(d => d.estado_cobro !== 'nula' && d.estado_cobro !== 'revisar' && ['albaran', 'factura', 'proforma'].includes(d.tipo)), byId = new Map(docs.map(d => [d.id, d])), ady = new Map();
  const une = (a, b) => { if(!a || !b || !byId.has(a) || !byId.has(b) || a === b) return; (ady.get(a) || ady.set(a, new Set()).get(a)).add(b); (ady.get(b) || ady.set(b, new Set()).get(b)).add(a); };
  docs.forEach(d => { une(d.id, d.documento_relacionado_id); une(d.id, d.documento_anterior_id); une(d.id, d.documento_siguiente_id); });
  const tieneLin = d => R.lineas(d).length > 0, cubiertos = new Set(), cubrePor = {};
  const firma = l => [l.f, norm(l.desc), Math.round(l.h * 100), Math.round(l.imp * 100)].join('|');
  docs.filter(d => d.tipo !== 'albaran' && tieneLin(d)).forEach(f => { const fs = new Set(R.lineas(f).map(firma)); (ady.get(f.id) || []).forEach(x => { const a = byId.get(x); if(!a || a.tipo !== 'albaran') return; const ls = R.lineas(a); if(!ls.length) return; (cubrePor[f.id] = cubrePor[f.id] || []).push(a);
    if(ls.filter(l => fs.has(firma(l))).length / ls.length >= 0.8) cubiertos.add(a.id); }); });   // el albarán solo desaparece si la factura repite sus mismas líneas; si son líneas distintas (factura parcial de un trabajo), cuentan los dos
  // proformas enlazadas con una factura: cuenta solo la factura
  const prof = new Set(); docs.filter(d => d.tipo === 'proforma').forEach(pf => { if([...(ady.get(pf.id) || [])].some(x => byId.get(x).tipo === 'factura' && tieneLin(byId.get(x)))) prof.add(pf.id); });
  const lista = docs.filter(d => !cubiertos.has(d.id) && !prof.has(d.id));
  return P._ef = {lista, cubiertos, cubrePor};
};

// ---------- asignación de albaranes a obras (sin mezclar obras del mismo cliente) ----------
R.entidadCasa = (job, ent) => { const nj = norm(job.cliente), ne = norm(ent && ent.nombre); if(!nj || !ne) return false; if(nj === ne) return true; if(nj.length >= 5 && (ne.includes(nj) || nj.includes(ne))) return true; const tj = nj.split(' ').filter(t => t.length >= 3), te = ne.split(' '); return tj.length >= 2 && tj.every(t => te.includes(t)); };
R.fechaRef = d => { const f = R.lineas(d).map(l => l.f).sort(); return f.length ? f[f.length - 1] : dia(d.fecha_devengo); };
const _asigCache = new WeakMap();   // V11.29 (reporte 4fa0f2c6: «tarda mucho en desplegar»): el reparto de documentos por obra se calculaba 43 veces en cada repintado (≈9 s); ahora una vez por carga de datos
R.asignar = function(P){ if(P && _asigCache.has(P)) return _asigCache.get(P); const res = R._asignar(P); if(P) _asigCache.set(P, res); return res; };
R._asignar = function(P){
  const jobs = (P.jobs || []).filter(j => j.estado !== 'Cancelado'), entById = new Map((P.entidades || []).map(e => [e.id, e]));
  const porJob = {}, ambiguos = [], sinAsignar = [], origen = {};
  jobs.forEach(j => { porJob[j.id] = []; });
  const vincDoc = new Map(); (P.vinculos || []).filter(v => v.rol === 'albaran').forEach(v => { if(!vincDoc.has(v.documento_id)) vincDoc.set(v.documento_id, []); vincDoc.get(v.documento_id).push(v); });
  R.efectivos(P).lista.forEach(d => {
    const vs = vincDoc.get(d.id) || [], inc = vs.find(v => v.accion === 'incluir');
    if(inc && porJob[inc.job_id]){ porJob[inc.job_id].push(d); origen[d.id] = {job: inc.job_id, como: 'manual'}; return; }
    const excl = new Set(vs.filter(v => v.accion === 'excluir').map(v => v.job_id));
    const ent = entById.get(d.entidad_id), fr = R.fechaRef(d), obra = norm(d.obra_texto);
    const porTexto = jobs.filter(j => !excl.has(j.id) && norm(j.trabajo).length >= 4 && obra && obra.includes(norm(j.trabajo)) && (!norm(j.cliente) || (ent && R.entidadCasa(j, ent))));   // el texto de obra solo vale si el cliente también es el de la obra (hay otras «NAVE AVÍCOLA» de otros clientes)
    if(porTexto.length){ const j = porTexto.sort((a, b) => norm(b.trabajo).length - norm(a.trabajo).length)[0]; porJob[j.id].push(d); origen[d.id] = {job: j.id, como: 'obra'}; return; }
    const cand = jobs.filter(j => { if(excl.has(j.id) || !ent || !R.entidadCasa(j, ent)) return false; const ini = dia(j.plan && j.plan.fecha); if(!ini || fr < ini) return false; const fin = j.terminado_at ? dia(j.terminado_at) : ''; return !fin || fr <= fin; });
    if(cand.length === 1){ porJob[cand[0].id].push(d); origen[d.id] = {job: cand[0].id, como: 'cliente y fechas'}; }
    else if(cand.length > 1) ambiguos.push({doc: d, candidatos: cand.map(j => j.id)});
    else sinAsignar.push(d);
  });
  return {porJob, ambiguos, sinAsignar, origen};
};

// ---------- ventana de empresa (12 meses hasta una fecha): horas, días trabajados, ingresos, combustible ----------
R.factorLineas = d => { const ls = Array.isArray(d.conceptos) ? d.conceptos : [], sl = sum(ls, c => num(c.importe)), g = Math.abs(num(d.importe)), n = Math.abs(R.baseIngreso(d)); if(!sl || !g || g === n) return 1; return Math.abs(sl - n) <= Math.abs(sl - g) ? 1 : n / g; };   // las líneas de unos documentos suman el neto y las de otros el total con IVA
R.empresaVentana = function(P, hasta){
  const k = hasta; P._ev = P._ev || {}; if(P._ev[k]) return P._ev[k];
  const W0 = addDays(hasta, -364);
  const indep = R.efectivos(P).lista;
  const horasDia = {}, horasClase = {}, dias = new Set(); let ingresos = 0, horas = 0, ingConHoras = 0, cobrado = 0;
  indep.forEach(d => { const ls = R.lineas(d).filter(l => l.f >= W0 && l.f <= hasta); if(!ls.length) return; const fl = R.factorLineas(d); ingresos += sum(ls, l => l.imp) * fl; ingConHoras += sum(ls.filter(l => l.h > 0), l => l.imp) * fl; { const imp = num(d.importe); if(imp) cobrado += Math.min(1, num(d.cobrado_importe) / imp) * sum(ls, l => l.imp) * fl; }
    ls.forEach(l => { horasDia[l.f] = (horasDia[l.f] || 0) + l.h; horasClase[l.clase] = (horasClase[l.clase] || 0) + l.h; horas += l.h; if(l.h > 0 || l.imp > 0) dias.add(l.f); }); });
  const gW = (P.gastos || []).filter(g => g.fecha_devengo >= W0 && g.fecha_devengo <= hasta && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada'));
  const comb = sum(gW.filter(g => /combust/i.test(g.categoria || '')), R.baseGasto);
  return P._ev[k] = {W0, hasta, horasDia, horasClase, horas, dias: dias.size, ingresos, cobrado, ingConHoras, gW, comb};
};

// ---------- obra de referencia: precio actual por hora y mezcla de horas por máquina ----------
R.referencia = function(P){
  if(P._ref !== undefined) return P._ref;
  const asig = R.asignar(P), jobs = P.jobs || [], idm = R.param.refJob;
  const job = jobs.find(j => j.id === idm) || jobs.find(j => /nave av[ií]cola/i.test(j.trabajo || '') && (asig.porJob[j.id] || []).length);
  if(!job) return P._ref = null;
  const cls = {}; let H = 0, I = 0;
  (asig.porJob[job.id] || []).forEach(d => { const f = R.factorLineas(d); R.lineas(d).forEach(l => { if(!(l.h > 0)) return; const o = cls[l.clase] = cls[l.clase] || {h: 0, imp: 0}; o.h += l.h; o.imp += l.imp * f; H += l.h; I += l.imp * f; }); });
  const CO = P.costes; let mh = 0, cub = 0;
  Object.keys(cls).forEach(c => { const o = cls[c], k = CO && CO.clases.find(x => x.clase === c); o.tarifa = o.imp / o.h; o.costeH = k && k.horaProd != null ? k.horaProd : null; o.margenH = o.costeH != null ? o.tarifa - o.costeH : null; if(o.margenH != null){ mh += o.margenH * o.h; cub += o.h; } });
  return P._ref = {job, cls, H, I, ingH: H ? I / H : NaN, margenH: cub ? mh / cub : NaN, cobertura: H ? cub / H : 0};
};

// ---------- máquinas ----------
const PAT_MAQ = {mixta: /mixta/i, camion: /cami[oó]n|iveco|multilift/i, giratoria: /giratoria/i, niveladora: /niveladora/i};
R.maquinasDeClase = (P, clase) => (P.flota || []).filter(f => ['activo', 'averiada', 'averia'].includes(f.estado) && PAT_MAQ[clase] && (PAT_MAQ[clase].test(f.nombre || '') || PAT_MAQ[clase].test(f.clase || '')) && !/todoterreno|turismo|coche/i.test(f.clase || ''));
const CAT_FIJO = /seguro|impuesto|tasa|itv|circulaci/i, CAT_MANT = /repuesto|recambio|taller|neum[aá]tico|lubricante/i;
const GENERALES = [['Autónomos y Seguridad Social', /aut[oó]nomo|seguridad social/i], ['Alquiler de la nave', /alquiler de nave/i], ['Gestoría y asesoría', /gestor/i], ['Financiación y banco', /financiero|pr[eé]stamo|comisiones banco/i], ['Prevención de riesgos', /prevenci/i], ['Seguros generales e impuestos', /seguro|impuesto|tasa/i], ['Suministros, luz y programas', /electricidad|software|tecnolog|suministros|ferreter/i]];
R.GENERALES = GENERALES;

// ---------- cálculo de una obra ----------
const dsg = (o, f) => Object.entries(o || {}).map(([k, v]) => [k, v * f]).filter(x => Math.abs(x[1]) >= 0.5).sort((a, b) => b[1] - a[1]);   // V11.49: desglose de una línea de coste (partidas × la parte de esta obra)
const L = (clave, label, valor, nivel, criterio, nota, extra) => ({clave, label, valor, nivel, criterio: criterio || '', nota: nota || '', ...(extra || {})});
R.calcular = function(job, P, asig){
  const albs = (asig.porJob[job.id] || []).slice(); const prm = R.param;
  if(!albs.length) return {vacio: true, job, ambiguos: asig.ambiguos.filter(a => a.candidatos.includes(job.id))};
  const lin = []; albs.forEach(d => R.lineas(d).forEach(l => lin.push({...l, doc: d})));
  const fechas = [...new Set(lin.map(l => l.f))].sort(), desde = fechas[0], hasta = fechas[fechas.length - 1];
  const diasHoras = new Set(lin.filter(l => l.h > 0).map(l => l.f)), D = Math.max(1, (diasHoras.size || fechas.length));
  const H = sum(lin, l => l.h), hClase = {}, diasClase = {}; lin.forEach(l => { hClase[l.clase] = (hClase[l.clase] || 0) + l.h; (diasClase[l.clase] = diasClase[l.clase] || new Set()).add(l.f); });
  const ev = R.empresaVentana(P, hasta), usados = new Set(), avisos = [], lineasD = [], lineasI = [];
  // ---- ingresos: ejecutado / facturado / cobrado ----
  const ejecutado = sum(albs, R.baseIngreso), docById = new Map((P.docs || []).map(d => [d.id, d]));
  const conFact = albs.filter(a => a.tipo !== 'albaran' || a.documento_siguiente_id && docById.get(a.documento_siguiente_id) && ['factura', 'proforma'].includes(docById.get(a.documento_siguiente_id).tipo));
  const facturado = sum(conFact, R.baseIngreso), cobrado = sum(albs, a => { const imp = num(a.importe); return imp ? Math.min(1, num(a.cobrado_importe) / imp) * R.baseIngreso(a) : 0; });
  const ing = {ejecutado, facturado, cobrado, nAlb: albs.length, nFact: conFact.length, sinImporte: albs.filter(a => !num(a.importe)).length};
  albs.filter(a => a.tipo !== 'albaran').forEach(f => { const cub = (R.efectivos(P).cubrePor[f.id] || []).filter(a => R.efectivos(P).cubiertos.has(a.id)), sc = sum(cub, R.baseIngreso); if(cub.length && R.baseIngreso(f) < sc - 1) avisos.push('La factura ' + (f.numero || '') + ' repite las líneas de ' + cub.length + ' albarán(es) y suma menos (' + eur(R.baseIngreso(f)) + ' frente a ' + eur(sc) + '): se cuenta la factura.'); });
  const parcial = albs.filter(a => a.tipo === 'albaran' && (R.efectivos(P).lista.includes(a)) && [...(P.docs || [])].some(f => f.tipo === 'factura' && f.documento_relacionado_id === a.id)); if(parcial.length) avisos.push('Factura y albarán enlazados con líneas distintas: se cuentan los dos (' + parcial.map(a => 'albarán ' + (a.numero || '') + ' ' + eur(R.baseIngreso(a))).join(', ') + ').');
  if(ing.sinImporte) avisos.push(ing.sinImporte + ' documento(s) sin importe: el ingreso puede estar incompleto.');
  if(cobrado > facturado + 1) avisos.push('Hay ' + eur(cobrado - facturado) + ' cobrados sin factura enlazada.');
  // ---- máquinas usadas (por lo que dicen las líneas de los albaranes) ----
  const maq = new Map();   // id -> {m, horas, dias}
  Object.keys(hClase).forEach(c => { const ms = R.maquinasDeClase(P, c); ms.forEach(m => { const x = maq.get(m.id) || {m, horas: 0, dias: new Set(), clases: new Set()}; x.horas += hClase[c] / ms.length; (diasClase[c] || new Set()).forEach(f => x.dias.add(f)); x.clases.add(c); maq.set(m.id, x); }); });
  const sinFlota = Object.keys(hClase).filter(c => !PAT_MAQ[c] && hClase[c] > 0);
  if(sinFlota.length) avisos.push('Horas de ' + sinFlota.map(c => R.NOMBRE_CLASE[c]).join(', ') + ' sin máquina en la flota: no llevan coste de máquina.');
  // ---- DIRECTO: combustible (V9.62) ----
  // Por meses y por tipo: el gasóleo B (agrícola) es de las máquinas de obra, el gasóleo A del camión; la gasolina es de los coches y no entra.
  // A la obra le toca, cada mes, su parte de lo que trabajaron esas máquinas (por ingreso de las líneas). Solo se estima un mes que aún no tiene factura.
  const horasIndep = ev.horasDia, CO = P.costes;
  const coches = new Set((P.flota || []).filter(f => /todoterreno|turismo|coche/i.test(f.clase || '')).map(f => f.id));
  const fuel = (P.gastos || []).filter(g => /combust/i.test(g.categoria || '') && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada') && !(g.vehiculo_id && coches.has(g.vehiculo_id)));
  const mesD = desde.slice(0, 7), mesH = hasta.slice(0, 7), GR = c => c === 'camion' ? 'A' : 'B';
  const fMes = {A: {}, B: {}}, lMes = {A: {}, B: {}};
  const suma = (o, m, v) => { o[m] = (o[m] || 0) + v; };
  fuel.forEach(g => { const tot = Math.abs(num(g.importe)), ratio = tot ? R.baseGasto(g) / tot : 1;
    if(Array.isArray(g.lineas_fechadas) && g.lineas_fechadas.length){ g.lineas_fechadas.forEach(l => { const m = ('20' + l[0]).slice(0, 7), t = String(l[1] || 'A').toUpperCase(); if(m < mesD || m > mesH || t === 'G') return; const k = t === 'B' ? 'B' : 'A'; suma(fMes[k], m, num(l[3]) * ratio); suma(lMes[k], m, num(l[2])); usados.add(g.id); }); }
    else if(g.fecha_devengo){ const m = g.fecha_devengo.slice(0, 7); if(m < mesD || m > mesH) return; const cs = Array.isArray(g.conceptos) ? g.conceptos : [], b = sum(cs.filter(c => c.tipo === 'gasoleo_b'), c => num(c.importe)), a = sum(cs.filter(c => c.tipo === 'diesel'), c => num(c.importe)), t0 = b + a;
      if(t0 > 0){ suma(fMes.B, m, R.baseGasto(g) * b / sum(cs, c => num(c.importe))); suma(fMes.A, m, R.baseGasto(g) * a / sum(cs, c => num(c.importe))); } else suma(fMes.A, m, R.baseGasto(g)); usados.add(g.id); } });
  const ingEmp = {A: {}, B: {}}, ingObra = {A: {}, B: {}};
  R.efectivos(P).lista.forEach(d => { const f = R.factorLineas(d); R.lineas(d).forEach(l => { const m = l.f.slice(0, 7); if(m < mesD || m > mesH || l.clase === 'otros') return; suma(ingEmp[GR(l.clase)], m, l.imp * f); }); });
  albs.forEach(d => { const f = R.factorLineas(d); R.lineas(d).forEach(l => { if(l.clase === 'otros') return; suma(ingObra[GR(l.clase)], l.f.slice(0, 7), l.imp * f); }); });
  const CLS = {A: ['camion'], B: Object.keys(hClase).filter(c => c !== 'camion' && c !== 'otros')};
  let combReal = 0;
  ['B', 'A'].forEach(k => { let real = 0, lit = 0, fCub = 0, iCub = 0; const sinF = [];
    Object.keys(ingObra[k]).forEach(m => { const io = ingObra[k][m], ie = ingEmp[k][m] || io, parte = ie > 0 ? Math.min(1, io / ie) : 0;
      if(fMes[k][m] > 0){ real += fMes[k][m] * parte; lit += (lMes[k][m] || 0) * parte; fCub += fMes[k][m]; iCub += ie; } else if(io > 0) sinF.push(m); });
    const nom = k === 'B' ? 'Gasóleo B de las máquinas' : 'Gasóleo A del camión', ex = {clases: CLS[k]};
    if(real > 0 || sum(Object.values(ingObra[k])) > 0) lineasD.push(L('combustible:' + k, nom, real, real ? 'calculada' : 'falta', 'combustible de cada mes × la parte de esta obra en lo que trabajaron ' + (k === 'B' ? 'las máquinas' : 'el camión') + ' ese mes', real ? h1(lit) + ' litros' : 'No hay facturas en los meses de la obra.', ex));
    const est = iCub > 0 ? sum(sinF, m => ingObra[k][m]) * fCub / iCub : 0;
    if(est > 1) lineasD.push(L('combustible_est:' + k, nom + ' (meses aún sin factura)', est, 'estimada', 'Gasto medio por € trabajado de los meses con factura × lo trabajado en ' + sinF.join(', '), 'Se sustituye por el real cuando llegue la factura.', ex));
    combReal += real; });
  if(lineasD.some(x => /^combustible(_est)?:A$/.test(x.clave) && x.valor > 0)) avisos.push('El gasóleo A incluye también el de los coches (X-Trail, Matrix y Audi): el coste del camión sale más alto de lo real.');
  // ---- DIRECTO: gastos vinculados, ayudantes, reparaciones ----
  const vinG = (P.vinculos || []).filter(v => v.job_id === job.id && v.rol === 'gasto' && v.accion === 'incluir');
  const porCat = {}; vinG.forEach(v => { const g = (P.gastos || []).find(x => x.id === v.documento_id); if(!g) return; usados.add(g.id); const c = g.categoria || 'Otros'; porCat[c] = (porCat[c] || 0) + R.baseGasto(g); });
  Object.keys(porCat).forEach(c => lineasD.push(L('vinc:' + c, c + ' (asignado a la obra)', porCat[c], 'real', 'facturas asignadas a mano a esta obra', '')));
  const ayu = num(P.ayudantes[job.id]); if(ayu) lineasD.push(L('ayudantes', 'Ayudantes y subcontratados', ayu, 'real', 'apuntado a mano', ''));
  const idsMaq = new Set([...maq.keys()]);
  const rep = (P.gastos || []).filter(g => g.vehiculo_id && idsMaq.has(g.vehiculo_id) && CAT_MANT.test(g.categoria || '') && g.fecha_devengo >= desde && g.fecha_devengo <= hasta && !usados.has(g.id) && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada'));
  rep.forEach(g => usados.add(g.id)); const repTot = sum(rep, R.baseGasto);
  { const porV = {}; rep.forEach(g => { (porV[g.vehiculo_id] = porV[g.vehiculo_id] || []).push(g); });
    const ids = Object.keys(porV); if(!ids.length) lineasD.push(L('reparaciones', 'Reparaciones de las máquinas usadas', 0, 'falta', 'facturas anotadas a la máquina entre las fechas de la obra', 'No hay ninguna factura anotada a las máquinas usadas en esas fechas (puede que no haya habido o que no estén asignadas).'));
    ids.forEach(id => { const x = maq.get(id) || [...maq.values()].find(y => String(y.m.id) === String(id)), gs = porV[id]; lineasD.push(L('reparaciones:' + id, 'Reparaciones: ' + (x ? x.m.nombre : 'máquina'), sum(gs, R.baseGasto), 'real', 'facturas anotadas a esta máquina entre las fechas de la obra', gs.length + ' factura(s)', {clases: x ? [...x.clases] : []})); }); }
  // ---- INDIRECTO: parte fija de las máquinas (seguros, impuestos…) de los 12 meses, repartida por horas de utilización ----
  Object.keys(hClase).forEach(c => { if(!(hClase[c] > 0)) return; const k = CO && CO.clases.find(x => x.clase === c), nom = R.NOMBRE_CLASE[c] || c;
    if(k && k.horaFija != null) lineasI.push(L('maq:' + c, 'Costes fijos de máquina: ' + nom, k.horaFija * hClase[c], k.manual ? 'estimada' : 'calculada', eur(k.horaFija, 2) + ' por hora productiva × ' + h1(hClase[c]) + ' h', 'Seguros, impuestos y demás costes fijos de la flota (12 meses) repartidos por horas de utilización (Gastos → Normalización).', {desg: dsg(k.fijoCat, k.h ? hClase[c] / k.h : 0)}));
    else lineasI.push(L('maq:' + c, 'Costes fijos de máquina: ' + nom, 0, 'falta', '', 'No hay coste por hora para esta clase en Normalización.')); });
  // ---- INDIRECTO: amortización (provisión; solo con precio de compra) ----
  const W0 = ev.W0, W1 = hasta, jorn = num(window.COSTES && COSTES.cfg.diasLab) || num(prm.jornadas) || 250;
  maq.forEach(x => { const m = x.m, d = x.dias.size, compra = num(m.coste_compra);
    if(compra > 0){ const vida = num(prm.vidaUtil) || 10, res = num(prm.residualPct) / 100, am = compra * (1 - res) / vida; lineasI.push(L('amort:' + m.id, m.nombre + ': amortización', am / jorn * d, 'estimada', 'compra ' + eur(compra) + ' ÷ ' + vida + ' años de vida útil (hipótesis), por ' + jorn + ' días laborables', 'Vida útil y valor residual son hipótesis tuyas, editables en Hipótesis.')); }
    else lineasI.push(L('amort:' + m.id, m.nombre + ': amortización', 0, 'falta', '', 'Falta el coste de compra de la máquina (ficha de flota): no se imputa amortización.')); });
  // ---- INDIRECTO: estructura, Seguridad Social/autónomos y coches de empresa (Normalización, por días laborables) y retribución de los socios ----
  // V9.61: los gastos generales se reparten por días, pero cada día solo una vez entre todas las obras: a esta le toca su parte de lo trabajado ese día (por ingreso de las líneas)
  const ingEmpDia = {}, ingObraDia = {};
  R.efectivos(P).lista.forEach(d => { const f = R.factorLineas(d); R.lineas(d).forEach(l => { if(l.f >= desde && l.f <= hasta) ingEmpDia[l.f] = (ingEmpDia[l.f] || 0) + l.imp * f; }); });
  albs.forEach(d => { const f = R.factorLineas(d); R.lineas(d).forEach(l => { ingObraDia[l.f] = (ingObraDia[l.f] || 0) + l.imp * f; }); });
  const Dq = Math.max(0.01, sum([...diasHoras.size ? diasHoras : new Set(fechas)], f => { const io = ingObraDia[f] || 0, ie = ingEmpDia[f] || 0; return ie > 0 ? Math.min(1, io / ie) : 1; }));
  const dLab = num(window.COSTES && COSTES.cfg.diasLab) || 217;
  if(CO){
    const est0 = CO.porGrupo.estructura || 0, ges = sum(CO.porCat.filter(x => x.grupo === 'estructura' && /gestor/i.test(x.cat)), x => x.base), est = est0 - ges;
    if(ges > 0) lineasI.push(L('gen:gestoria', 'Gestoría (sin ella no se declara el IVA)', ges / dLab * Dq, 'calculada', eur(ges) + ' al año ÷ ' + dLab + ' días laborables × ' + h1(Dq) + ' días de esta obra (su parte de cada día trabajado)', 'Gastos → Normalización, estructura.', {desg: dsg(Object.fromEntries(CO.porCat.filter(x => x.grupo === 'estructura' && /gestor/i.test(x.cat)).map(x => [x.cat, x.base])), Dq / dLab)}));
    if(est > 0) lineasI.push(L('gen:estructura', 'Resto de la estructura (nave, financiación, suministros, programas…)', est / dLab * Dq, 'calculada', eur(est) + ' al año ÷ ' + dLab + ' días laborables × ' + h1(Dq) + ' días de esta obra (su parte de cada día trabajado)', 'Gastos → Normalización, grupo Estructura.'));
    const ss = sum(CO.porCat.filter(x => x.grupo === 'personal' && /seguridad social|aut[oó]nomo/i.test(x.cat)), x => x.base), otrosP = (CO.porGrupo.personal || 0) - ss;
    if(ss > 0) lineasI.push(L('gen:ss', 'Autónomos y Seguridad Social', ss / dLab * Dq, 'calculada', eur(ss) + ' al año ÷ ' + dLab + ' días laborables × ' + h1(Dq) + ' días de esta obra (su parte de cada día trabajado)', otrosP > 1 ? 'No se imputan ' + eur(otrosP) + ' de nóminas y pagos en B a personas: falta decidir si son coste de obra.' : '', {desg: dsg(Object.fromEntries(CO.porCat.filter(x => x.grupo === 'personal' && /seguridad social|aut[oó]nomo/i.test(x.cat)).map(x => [x.cat, x.base])), Dq / dLab)}));
    const des = CO.clases.find(x => x.clase === 'desplazamiento'); if(des && des.total > 0) lineasI.push(L('gen:coches', 'Coches de empresa (desplazamiento a obras)', des.total / dLab * Dq, 'calculada', eur(des.total) + ' al año ÷ ' + dLab + ' días laborables × ' + h1(Dq) + ' días de esta obra (su parte de cada día trabajado)', 'Nissan X-Trail y Hyundai Matrix.'));
  } else avisos.push('No se pudo leer la normalización de costes: faltan los costes generales.');
  const sociosAnual = sum((P.socios || []).filter(x => x.f >= W0 && x.f <= W1), x => x.imp), socios = sociosAnual / dLab * Dq;
  const socW = (P.socios || []).filter(x => x.f >= W0 && x.f <= W1), sinQ = sum(socW.filter(x => !x.q), x => x.imp), socAnual = {rafa: sum(socW.filter(x => x.q === 'rafa'), x => x.imp) + sinQ / 2, manolo: sum(socW.filter(x => x.q === 'manolo'), x => x.imp) + sinQ / 2};   // V11.64: lo de cada uno; lo que no dice de quién es, a medias
  const socL = L('socios', 'Retribución de Rafa y Manolo (retiradas y gastos personales)', socios, sociosAnual > 0 ? 'calculada' : 'falta', eur(sociosAnual) + ' al año ÷ ' + dLab + ' días laborables × ' + h1(Dq) + ' días de esta obra (su parte de cada día trabajado)', 'No es un gasto deducible: se resta para ver cuánto queda de verdad, pero no baja los impuestos.', {deducible: false, desg: dsg((P.socios || []).filter(x => x.f >= W0 && x.f <= W1).reduce((o, x) => { o[x.o || 'Otros'] = (o[x.o || 'Otros'] || 0) + x.imp; return o; }, {}), Dq / dLab)});
  // ---- imputaciones manuales y correcciones ----
  const imps = (P.imput || []).filter(i => i.job_id === job.id);
  const aplicar = (arr, bloque) => { imps.filter(i => i.bloque === bloque).forEach(i => { if(i.modo === 'sustituir' && i.clave){ const x = arr.find(y => y.clave === i.clave); if(x){ x.original = x.valor; x.valor = num(i.importe); x.nivel = i.nivel; x.nota = (x.nota ? x.nota + ' · ' : '') + 'Corregido a mano: ' + (i.nota || 'sin nota'); x.manualId = i.id; return; } } arr.push(L('man:' + i.id, i.concepto, num(i.importe), i.nivel, 'imputación manual (' + i.origen + ')', i.nota || '', {manualId: i.id})); }); };
  aplicar(lineasD, 'directo'); aplicar(lineasI, 'indirecto'); { const x = imps.find(i => i.modo === 'sustituir' && i.clave === 'socios'); if(x){ socL.original = socL.valor; socL.valor = num(x.importe); socL.nivel = x.nivel; socL.nota += ' · Corregido a mano.'; socL.manualId = x.id; } }
  // V11.97 (reporte e14de7ff): las partidas que Daniel desmarca en «Costes y beneficio» no cuentan en ningún total de esta obra
  lineasD.concat(lineasI, [socL]).forEach(x => { if(R.excl.has(job.id + '|' + x.clave)){ x.excluido = true; x.valorExcl = x.valor; x.valor = 0; } });
  // ---- resultados ----
  const directo = sum(lineasD, x => x.valor), indirecto = sum(lineasI, x => x.valor), sociosV = socL.valor;
  const est = x => x.nivel === 'estimada', directoComp = sum(lineasD.filter(x => !est(x)), x => x.valor), indirectoComp = sum(lineasI.filter(x => !est(x)), x => x.valor);
  const bAntesSocios = ejecutado - directo - indirecto, beneficioReal = bAntesSocios - sociosV;
  const baseImp = Math.max(0, ejecutado - directo - indirecto), impuestos = baseImp * num(prm.impuesto) / 100, neto = beneficioReal - impuestos;
  const desembolsable = directo + sum(lineasI.filter(x => !/^amort:/.test(x.clave)), x => x.valor), tesoreria = cobrado - desembolsable - sociosV;
  const comprobado = ejecutado - directoComp - indirectoComp - sociosV;
  const estimadoImp = sum(lineasD.concat(lineasI).filter(est), x => x.valor), totalCostes = directo + indirecto + sociosV;
  const dCal = diffDays(desde, hasta) + 1;
  const hDia = {}; lin.forEach(l => { if(l.h > 0) hDia[l.f] = (hDia[l.f] || 0) + l.h; });
  const res = {vacio: false, socAnual, dLab, ssAnual: sum(lineasI.filter(x => x.clave === 'gen:ss'), x => x.valor) / Math.max(1, Dq) * dLab, job, hDia, desde, hasta, D, Dq, H, dCal, ing, lineasD, lineasI, socios: socL, directo, indirecto, ejecutado, resultadoDirecto: ejecutado - directo, bAntesSocios, beneficioReal, comprobado, impuestos, neto, tesoreria, cobrado, estimadoImp, pctEstimado: totalCostes > 0 ? estimadoImp / totalCostes * 100 : 0, avisos, maq: [...maq.values()].map(x => ({id: x.m.id, nombre: x.m.nombre, horas: x.horas, dias: x.dias.size, clases: [...x.clases]})), hClase, ev: {diasEmp: Math.max(1, ev.dias), horas: ev.horas, ingresos: ev.ingresos, comb: ev.comb}, albs};
  // ---- tres niveles de coste (cada nivel contiene al anterior; no se suman) ----
  const rel = x => /^(maq:|amort:|gen:ss|gen:coches|gen:gestoria)/.test(x.clave), relI = sum(lineasI.filter(rel), x => x.valor), gloI = indirecto - relI;
  const n1 = directo, n2 = directo + relI + sociosV, n3 = directo + indirecto + sociosV;
  res.niv = {n1, n2, n3, relI, gloI, socios: sociosV, r1: ejecutado - n1, r2: ejecutado - n2, r3: ejecutado - n3, h1: H ? n1 / H : NaN, h2: H ? n2 / H : NaN, h3: H ? n3 / H : NaN, tarifa: H ? ejecutado / H : NaN};
  { const t = num(prm.impuesto) / 100, di = directo + indirecto, eMin = (n3 - t * di) / (1 - t); res.niv.t = t; res.niv.minImp = H ? eMin / H : NaN; res.niv.margenH = H ? (ejecutado - n3) / H : NaN; res.niv.margenPct = n3 ? (ejecutado - n3) / n3 * 100 : NaN; res.niv.impH = H ? (res.niv.minImp - res.niv.h3) : NaN; }
  res.m = {pctIngresos: ejecutado ? beneficioReal / ejecutado * 100 : NaN, porJornada: beneficioReal / D, porHora: H ? beneficioReal / H : NaN, directoPctIng: ejecutado ? (ejecutado - directo) / ejecutado * 100 : NaN};
  // ---- coste de oportunidad (independiente del beneficio real) ----
  const hMaq = sum(['mixta', 'camion', 'giratoria', 'niveladora'], c => hClase[c] || 0);
  const resto = {ing: Math.max(0, ev.ingresos - ejecutado), h: Math.max(0, ev.horas - H), comb: Math.max(0, ev.comb - combReal)};
  const ref = R.referencia(P), margenH = ref ? ref.margenH : NaN;
  const pend = (P.jobs || []).filter(j => j.estado === 'Pendiente' && j.id !== job.id), backlog = sum(pend, j => (typeof tbDurHoras === 'function' ? num(tbDurHoras(j.duracion)) : 0));
  const hReal = Math.min(hMaq, backlog), opMaq = isFinite(margenH) ? hReal * margenH : NaN;
  let costeHoraPersona = NaN; try{ costeHoraPersona = convenioSueldoInfo('maquinista').costeHora; }catch(e){}
  res.op = {hMaq, backlog, hReal, margenH, opMaq, costeHoraPersona, valorTiempo: isFinite(costeHoraPersona) ? H * costeHoraPersona : NaN, margenObraH: H ? (ejecutado - directo) / H : NaN};
  return res;
};
R.huella = r => r.vacio ? 'vacio' : [Math.round(r.ejecutado), Math.round(r.directo), Math.round(r.indirecto), Math.round(r.socios.valor), r.albs.length, Math.round(r.cobrado)].join('|');

// ================= SIMULADOR (empresa, base 12 meses) =================
const coste = cat => { try{ return convenioSueldoInfo(cat).coste; }catch(e){ return NaN; } };
R.base12 = function(P){
  const hoy = new Date().toISOString().slice(0, 10), ev = R.empresaVentana(P, hoy), prm = R.param;
  const GP = /^gasto personal|n[oó]mina|compra de veh/i;
  const costesOp = sum(ev.gW.filter(g => !GP.test(g.categoria || '')), R.baseGasto), socios = sum((P.socios || []).filter(x => x.f >= ev.W0 && x.f <= ev.hasta), x => x.imp);
  const taller = sum(ev.gW.filter(g => CAT_MANT.test(g.categoria || '')), R.baseGasto);
  const maquinas = (P.flota || []).filter(f => ['activo'].includes(f.estado) && !/todoterreno|turismo|coche/i.test(f.clase || '')).length;
  const pend = (P.jobs || []).filter(j => j.estado === 'Pendiente'); let backlog = 0, nBack = 0;
  pend.forEach(j => { const h = typeof tbDurHoras === 'function' ? num(tbDurHoras(j.duracion)) : 0; if(h > 0){ backlog += h; nBack++; } });
  const ref = R.referencia(P), margenH = ref ? ref.margenH : NaN, ingH = ref ? ref.ingH : NaN;
  return {ev, ingresos: ev.ingresos, cobrado: ev.cobrado, horas: ev.horas, dias: ev.dias, comb: ev.comb, costesOp, socios, taller, maquinas, backlog, nBack, pendientes: pend.length, margenH, ingH, cobHoras: ev.ingresos > 0 ? ev.ingConHoras / ev.ingresos : NaN, ref, margenPct: ref && ref.ingH > 0 ? ref.margenH / ref.ingH : NaN, beneficio: ev.ingresos - costesOp, beneficioTrasSocios: ev.ingresos - costesOp - socios};
};
R.ESC0 = {socios8: false, operarios: 0, mecanico: false, mecCond: false};
R.nombreEsc = e => { const p = []; if(e.socios8) p.push('Rafa y Manolo 8 h L-V'); if(e.operarios) p.push(e.operarios + ' operario' + (e.operarios > 1 ? 's' : '')); if(e.mecanico) p.push('mecánico'); if(e.mecCond) p.push('mecánico-conductor'); return p.length ? p.join(' + ') : 'Situación actual real'; };
R.simular = function(b, e){
  const prm = R.param, jorn = num(prm.jornadas) || 250, oc = num(prm.ocupacion) / 100, hOp = 8 * jorn * oc, cm = num(prm.condMecPct) / 100;
  const cOp = coste('oficial2'), cMec = coste('oficial1'), faltan = [];
  const nOp = e.operarios | 0, mec = !!e.mecanico, mc = !!e.mecCond;
  if(nOp && !isFinite(cOp)) faltan.push('convenio operario'); if((mec || mc) && !isFinite(cMec)) faltan.push('convenio mecánico');
  const costeEmp = nOp * (isFinite(cOp) ? cOp : 0) + ((mec ? 1 : 0) + (mc ? 1 : 0)) * (isFinite(cMec) ? cMec : 0);
  const E = (nOp + (mc ? cm : 0)) * hOp;                                   // horas de máquina que aportan los contratados
  const sociosCap = e.socios8 ? 2 * 8 * jorn * oc : b.horas;               // lo que ponen Rafa y Manolo
  const red = (mec ? 1 : 0) + (mc ? 1 - cm : 0), indisp = Math.max(0, num(prm.indisponibilidad) - Math.min(1, red) * num(prm.reduccionAverias != null ? prm.reduccionAverias : 30) * num(prm.indisponibilidad) / 100) / 100;
  const capMaq = b.maquinas * 8 * jorn * oc * (1 - indisp);
  const cap = Math.min(capMaq, sociosCap + E), demanda = b.horas + (b.backlog || 0);
  const W = Math.min(cap, demanda), dH = W - b.horas;
  const horasEmp = Math.min(E, W), horasSoc = Math.max(0, W - horasEmp);
  const horasMec = num(prm.horasMecanicaSemana != null ? prm.horasMecanicaSemana : 10) * 46, mecEvit = Math.min(1, red) * horasMec;
  const ahorro = Math.min(1, red) * num(prm.ahorroTaller) / 100 * b.taller;
  const margenH = isFinite(b.margenH) ? b.margenH : 0, ingExtra = dH * margenH;
  const benef = b.beneficio + ingExtra + ahorro - costeEmp, benefSoc = benef - b.socios;
  const be = costeEmp > 0 ? Math.max(0, costeEmp - ahorro) : 0;
  const notas = []; if(!isFinite(b.margenH)) notas.push('No hay horas facturadas en 12 meses: no se puede estimar el margen por hora.');
  if(dH > 0 && b.backlog <= 0) notas.push('No hay trabajos pendientes con duración conocida: no se supone ninguna facturación extra.'); if(dH < -1) notas.push('Con esas horas se facturaría MENOS que ahora: hoy se trabaja más de 8 h L-V (estimado).');
  if(cap === capMaq && capMaq < sociosCap + E) notas.push('El límite es la maquinaria disponible, no las personas.'); if(W === demanda && cap > demanda) notas.push('El límite es el trabajo disponible: sobra capacidad.');
  if(faltan.length) notas.push('Falta dato: ' + faltan.join(', '));
  return {e, nombre: R.nombreEsc(e), costeEmp, capacidad: cap, capMaq, demanda, trabajo: W, dH, horasEmp, horasSoc, productividad: costeEmp > 0 ? (horasEmp ? horasEmp / ((nOp + (mc ? cm : 0)) || 1) : 0) : NaN, ahorro, ingExtra, beneficio: benef, beneficioTrasSocios: benefSoc, dBenef: benef - b.beneficio, equilibrioCoste: be, equilibrioHoras: margenH > 0 ? be / margenH : NaN, equilibrioFact: b.margenPct > 0 ? be / b.margenPct : NaN, esfuerzoEvitado: Math.max(0, b.horas - horasSoc) + mecEvit, horasSocios: horasSoc + (mec || mc ? Math.max(0, horasMec - mecEvit) : horasMec), notas};
};
R.combinaciones = function(b){ const out = []; [false, true].forEach(s8 => [0, 1, 2].forEach(n => [[0, 0], [1, 0], [0, 1]].forEach(([m, c]) => out.push(R.simular(b, {socios8: s8, operarios: n, mecanico: !!m, mecCond: !!c}))))); return out; };

// ================= CONCLUSIONES de una obra (8 preguntas) =================
R.conclusiones = function(r, P, b){
  const q = [], prm = R.param, B = b || R.base12(P);
  if(r.vacio) return [];
  const peso = [...r.lineasD.filter(x => x.valor > 0), ...r.lineasI.filter(x => x.valor > 0), r.socios].filter(x => x.valor > 0).sort((a, c) => c.valor - a.valor).slice(0, 3);
  const incierto = r.pctEstimado >= 20 ? 'Ojo: ' + Math.round(r.pctEstimado) + ' % de los costes son estimaciones.' : '';
  q.push(['¿Cuánto beneficio real ha dejado?', eur(r.beneficioReal) + ' tras pagar todos los costes y la retribución de Rafa y Manolo (' + eur(r.bAntesSocios) + ' antes de retribuirles). Solo con datos comprobados: ' + eur(r.comprobado) + '. ' + incierto + (r.ing.facturado < r.ejecutado ? ' Falta facturar ' + eur(r.ejecutado - r.ing.facturado) + ' y cobrar ' + eur(r.ejecutado - r.cobrado) + '.' : '')]);
  q.push(['¿Qué gastos han reducido más la rentabilidad?', peso.length ? peso.map(x => x.label + ' (' + eur(x.valor) + ', ' + pct(r.ejecutado ? x.valor / r.ejecutado * 100 : NaN) + ' del ingreso)').join(' · ') : 'No hay gastos imputados: faltan datos.']);
  q.push(['¿Cuánto hemos ganado por día y por hora?', eur(r.m.porJornada) + ' por jornada trabajada (' + r.D + ' días con horas)' + (r.H ? ' y ' + eur(r.m.porHora, 2) + ' por hora de máquina (' + h1(r.H) + ' h)' : ' (sin horas en los albaranes)') + '.']);
  const refH = B.horas > 0 ? B.beneficioTrasSocios / B.horas : NaN, cobH = B.cobHoras;
  let comp; if(isFinite(cobH) && cobH < 0.9) comp = 'Beneficio real de la obra: ' + eur(r.beneficioReal) + (r.ejecutado ? ' (' + pct(r.beneficioReal / r.ejecutado * 100) + ' del ingreso)' : '') + '. No se puede comparar de forma fiable con el resto de la empresa: solo el ' + Math.round(cobH * 100) + ' % de los ingresos de los últimos 12 meses tiene horas anotadas en los albaranes.' + (isFinite(r.op.opMaq) && r.op.opMaq > r.beneficioReal ? ' Las mismas horas en trabajo que ya estaba pendiente habrían dado ≈ ' + eur(r.op.opMaq) + ' (estimado).' : ''); else if(!isFinite(refH) || !r.H) comp = 'No hay datos para comparar con el resto de la empresa.'; else comp = (r.m.porHora >= refH ? 'Sí, por encima' : 'Por debajo') + ' de la media de la empresa en 12 meses (' + eur(refH, 2) + ' por hora tras retribuir a los socios; esta obra ' + eur(r.m.porHora, 2) + '). ' + (r.beneficioReal < 0 ? 'Perdió dinero.' : '') + (isFinite(r.op.opMaq) && r.op.opMaq > r.beneficioReal ? ' Las mismas horas en trabajo que ya estaba pendiente habrían dado ≈ ' + eur(r.op.opMaq) + ' (estimado).' : '');
  q.push(['¿Nos ha compensado hacerla?', comp]);
  const mdias = sum(r.maq, x => x.dias), hd = mdias ? r.H / mdias : NaN, dias8 = Math.max(0, ...r.maq.map(x => x.horas)) / 8; q.push(['¿Qué habría cambiado trabajando más horas?', !isFinite(hd) ? 'Los albaranes no traen horas ni máquinas: no se puede estimar.' : hd >= 8 ? 'Cada máquina trabajó una media de ' + h1(hd) + ' h por día de uso: no hay margen de jornada.' : 'Cada máquina trabajó una media de ' + h1(hd) + ' h por día de uso. A 8 h/día la obra habría ocupado ' + h1(dias8) + ' días en vez de ' + r.D + ': se liberan ' + h1(Math.max(0, r.D - dias8)) + ' jornadas que se pueden dedicar a otro trabajo (solo si hay trabajo) y los costes que se reparten por actividad real (' + eur(sum(r.lineasI.filter(x => /^(gen|vehiculos)/.test(x.clave)), x => x.valor) + r.socios.valor) + ' aquí) bajarían ≈ ' + eur((sum(r.lineasI.filter(x => /^(gen|vehiculos)/.test(x.clave)), x => x.valor) + r.socios.valor) * (1 - dias8 / r.D)) + ' (estimado). No se supone que facture más.']);
  const sims = [['operario', {operarios: 1}], ['mecánico', {mecanico: true}], ['mecánico-conductor', {mecCond: true}]].map(([n, e]) => [n, R.simular(B, {...R.ESC0, ...e})]);
  q.push(['¿Compensa contratar?', sims.map(([n, s]) => n + ': ' + (s.dBenef >= 0 ? 'compensaría, ' : 'no compensa con la demanda conocida, ') + (s.dBenef >= 0 ? '+' : '') + eur(s.dBenef) + ' al año (coste ' + eur(s.costeEmp) + ')').join(' · ') + '. Estimado con la demanda pendiente conocida (' + (B.backlog ? h1(B.backlog) + ' h en ' + B.nBack + ' trabajos' : 'ninguna con duración conocida') + '), no con facturación supuesta.']);
  q.push(['¿Cuánto habría que facturar extra para recuperar cada contratación?', sims.map(([n, s]) => n + ': ' + (isFinite(s.equilibrioFact) ? eur(s.equilibrioFact) + ' al año (≈ ' + h1(s.equilibrioHoras) + ' h extra)' : 'sin datos')).join(' · ')]);
  const todas = R.combinaciones(B).sort((a, c) => c.beneficio - a.beneficio), mejor = todas[0], suave = todas.filter(s => s.horasSocios <= (R.simular(B, R.ESC0).horasSocios) * 0.8).sort((a, c) => c.beneficio - a.beneficio)[0];
  q.push(['¿Qué organización gana más con menos esfuerzo físico?', 'Más beneficio: ' + mejor.nombre + ' (' + eur(mejor.beneficio) + ' al año, ' + eur(mejor.dBenef) + ' sobre hoy). ' + (suave ? 'Con al menos un 20 % menos de horas de los socios, la mejor es ' + suave.nombre + ' (' + eur(suave.beneficio) + ', ' + h1(suave.esfuerzoEvitado) + ' h menos al año). ' : 'Ninguna combinación baja un 20 % el esfuerzo de los socios con los datos actuales. ') + 'Estimación: depende de la ocupación, la demanda y las averías de Hipótesis.']);
  return q.slice(0, 6);   // V9.55: las de contratar viven en el simulador nuevo (sin límite por demanda)
};

// ================= PANTALLA =================
const NIVEL = {real: ['Real comprobada', 'var(--green)'], calculada: ['Calculada con datos comprobados', 'var(--blue, #2f6fb0)'], estimada: ['Estimada', 'var(--orange)'], falta: ['Falta dato', 'var(--red)']};
const badge = n => { const x = NIVEL[n] || NIVEL.estimada; return '<span style="display:inline-block;font-size:10px;font-weight:700;border:1px solid ' + x[1] + ';color:' + x[1] + ';border-radius:8px;padding:0 5px;white-space:nowrap;">' + x[0] + '</span>'; };
const col = n => n < 0 ? 'var(--red)' : 'var(--green)';
R.tab = 1; R.sel = null; R.build = {socios8: false, operarios: 0, mecanico: false, mecCond: false};
const card = (t, inner, st) => '<div class="tb-cos" style="margin-bottom:10px;' + (st || '') + '">' + (t ? '<div style="font-weight:800;font-size:13.5px;margin-bottom:6px;">' + t + '</div>' : '') + inner + '</div>';
const fila = (a, b, c) => '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--line, #0001);"><span style="min-width:0;">' + a + '</span><span style="text-align:right;white-space:nowrap;flex:none;">' + b + '</span></div>' + (c ? '<div style="font-size:11px;color:var(--ink-soft);padding:1px 0 4px;">' + c + '</div>' : '');
const resumen = r => r.vacio ? null : {ej: r.ejecutado, dir: r.resultadoDirecto, ben: r.beneficioReal};

R.lineaHtml = (r, x, bloque) => fila(esc(x.label) + ' ' + badge(x.nivel) + (x.manualId ? ' <a href="#" onclick="RENT.quitarImp(\'' + x.manualId + '\');return false" style="font-size:11px;">deshacer</a>' : ''), x.nivel === 'falta' ? '<i>sin dato</i>' : '<b style="color:var(--red);">' + eur(x.valor) + '</b>', esc([x.criterio, x.nota].filter(Boolean).join(' — ')) + (x.manualId || !/^(socios|man:)/.test(x.clave) || true ? ' <a href="#" onclick="RENT.corregir(\'' + r.job.id + '\',\'' + esc(x.clave) + '\',\'' + bloque + '\');return false" style="font-size:11px;">corregir</a>' : ''));

// V9.82 (reporte de Daniel: «¿por qué dos cifras de combustible?»): el combustible sale como UNA sola cifra; el desglose por tipo (B, A) y por meses con factura o sin ella queda dentro, plegado
R.lineasDirectoHtml = r => {
  const comb = r.lineasD.filter(x => /^combustible/.test(x.clave)), resto = r.lineasD.filter(x => !/^combustible/.test(x.clave));
  let h = '';
  if(comb.length === 1) h += R.lineaHtml(r, comb[0], 'directo');
  else if(comb.length > 1){
    const tot = sum(comb, x => x.valor), est = sum(comb.filter(x => x.nivel === 'estimada'), x => x.valor), real = tot - est;
    h += fila('Combustible ' + badge(est > 1 ? 'estimada' : 'calculada'), '<b style="color:var(--red);">' + eur(tot) + '</b>', est > 1 ? 'Con factura ' + eur(real) + ' + estimado ' + eur(est) + ' de los meses que aún no tienen factura.' : 'Sacado de las facturas de combustible de los meses de la obra.')
      + det('Ver el desglose del combustible', comb.map(x => R.lineaHtml(r, x, 'directo')).join(''));
  }
  return h + resto.map(x => R.lineaHtml(r, x, 'directo')).join('');
};
R.secDirecto = r => {
  const i = r.ing, f = (t, v, n) => fila(t, '<b style="color:var(--green);">' + eur(v) + '</b>', n);
  return card('Ingreso (sin IVA)', f('Ejecutado (trabajo hecho)', i.ejecutado, i.nAlb + ' documento(s): ' + i.nFact + ' factura(s) y ' + (i.nAlb - i.nFact) + ' albarán(es) sin facturar. Trabajo hecho, no dinero cobrado.') + f('Facturado', i.facturado, i.nFact + ' con factura enlazada' + (i.facturado < i.ejecutado ? ' · pendiente de facturar ' + eur(i.ejecutado - i.facturado) : '')) + f('Cobrado', i.cobrado, i.cobrado < i.ejecutado ? 'pendiente de cobrar ' + eur(i.ejecutado - i.cobrado) : 'todo cobrado') + '<div style="margin-top:4px;">' + badge('real') + '</div>')
    + card('Coste directo de la obra', R.lineasDirectoHtml(r) + fila('<b>Total directos</b>', '<b style="color:var(--red);">' + eur(r.directo) + '</b>') + '<div style="margin-top:6px;"><a href="#" onclick="RENT.anadir(\'' + r.job.id + '\',\'directo\');return false" style="font-size:12px;">+ añadir gasto directo</a></div>')
    + card('', '<div style="display:flex;justify-content:space-between;font-weight:800;font-size:15px;"><span>Resultado directo</span><span style="color:' + col(r.resultadoDirecto) + ';">' + eur(r.resultadoDirecto) + '</span></div><div style="font-size:11.5px;color:var(--ink-soft);">Ejecutado − directos. Aún sin repartir seguros, amortización, gestoría ni la retribución de los socios.</div>', 'background:var(--paper);border-color:var(--line);');
};
R.cardNiveles = r => { const v = r.niv, fl = (t, c, res, hh, n) => fila('<b>' + t + '</b>', '<b>' + eur(c) + '</b> · ' + (isFinite(hh) ? eur(hh, 2) + '/h' : 'sin horas'), n + ' Resultado: <b style="color:' + col(res) + ';">' + eur(res) + '</b>');
  return card('Tres niveles de coste (cada nivel contiene al anterior)', fl('1. Directo', v.n1, v.r1, v.h1, 'Combustible, averías, ayudantes y lo vinculado, solo de las fechas de la obra.')
    + fl('2. Directo + indirecto relacionado', v.n2, v.r2, v.h2, 'Añade lo necesario para poder hacerla: costes fijos de máquina, coches, autónomos, gestoría y la retribución de Rafa y Manolo (' + eur(v.relI + v.socios) + ').')
    + fl('3. Coste completo', v.n3, v.r3, v.h3, 'Añade el resto de la estructura de la empresa (' + eur(v.gloI) + '), prorrateada por días de obra.')
    + fila('Precio mínimo por hora que cubre todo e impuestos', '<b>' + (isFinite(v.minImp) ? eur(v.minImp, 2) + '/h' : 'sin horas') + '</b>', 'Coste completo más los impuestos estimados (' + R.param.impuesto + ' %, hipótesis). Por debajo pierdes dinero.')
    + fila('Margen sobre el coste completo', '<b style="color:' + col(v.margenH) + ';">' + (isFinite(v.margenH) ? eur(v.margenH, 2) + '/h · ' + pct(v.margenPct) : 'sin horas') + '</b>', 'Lo cobrado por hora − el coste del nivel 3. Cuando haya precios de compra se descontará la reposición.')
    + fila('Lo que se cobró por hora', '<b>' + (isFinite(v.tarifa) ? eur(v.tarifa, 2) + '/h' : 'sin horas') + '</b>', 'Ingreso ejecutado ÷ horas de máquina. Para ganar de verdad debe superar el coste por hora del nivel 3.') + '<div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">Falta la reposición de las máquinas (amortizadas, pendiente de dato) y el camión (deuda con Alberto).</div>'); };
R.secReal = r => {
  const m = r.m, ind = r.lineasI.map(x => R.lineaHtml(r, x, 'indirecto')).join('') + R.lineaHtml(r, r.socios, 'indirecto');
  const grande = (t, v, s) => '<div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;padding:3px 0;"><span>' + t + '</span><span style="color:' + col(v) + ';">' + eur(v) + '</span></div>' + (s ? '<div style="font-size:11px;color:var(--ink-soft);margin:-2px 0 4px;">' + s + '</div>' : '');
  return card('', '<div style="font-size:12px;color:var(--ink-soft);">BENEFICIO REAL</div><div style="font-size:26px;font-weight:900;color:' + col(r.beneficioReal) + ';">' + eur(r.beneficioReal) + '</div><div style="font-size:12px;">' + pct(m.pctIngresos) + ' del ingreso · ' + eur(m.porJornada) + ' por jornada · ' + (isFinite(m.porHora) ? eur(m.porHora, 2) + ' por hora' : 'sin horas') + '</div><div style="margin-top:6px;">' + (r.pctEstimado > 0 ? badge('estimada') + ' <span style="font-size:11px;">' + Math.round(r.pctEstimado) + ' % de los costes son estimados. Solo con datos comprobados: <b>' + eur(r.comprobado) + '</b></span>' : badge('calculada')) + '</div>', 'background:var(--paper);border-color:var(--line);')
    + card('Coste indirecto repartido a esta obra', ind + fila('<b>Total indirectos</b> (sin retribución socios)', '<b style="color:var(--red);">' + eur(r.indirecto) + '</b>') + '<div style="margin-top:6px;"><a href="#" onclick="RENT.anadir(\'' + r.job.id + '\',\'indirecto\');return false" style="font-size:12px;">+ añadir coste indirecto</a></div>')
    + card('Cuenta final', grande('Resultado directo', r.resultadoDirecto) + grande('− Indirectos', -r.indirecto) + grande('Beneficio antes de retribuir a los socios', r.bAntesSocios, 'Antes de impuestos.') + grande('− Retribución de Rafa y Manolo', -r.socios.valor, 'No es gasto deducible: las retiradas no bajan los impuestos.') + grande('Beneficio real (antes de impuestos)', r.beneficioReal) + grande('− Impuestos estimados (' + R.param.impuesto + ' %)', -r.impuestos, 'Hipótesis editable. Se calcula sobre el beneficio antes de retribuir a los socios.') + grande('Beneficio neto estimado', r.neto) + '<div style="border-top:1px solid var(--line,#0002);margin:6px 0;"></div>' + grande('Tesorería: cobrado − pagos − retiradas', r.tesoreria, 'Dinero que ha entrado menos lo que ha salido, sin contar amortización (no sale dinero). Lo no cobrado aún no cuenta.'));
};
R.secOport = r => {
  const o = r.op;
  return card('Coste de oportunidad', '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px;">Independiente del beneficio real: qué habrían podido dar esas mismas horas en otra cosa. Solo con hipótesis basadas en datos reales.</div>'
    + fila('Horas de máquina usadas', '<b>' + h1(o.hMaq) + ' h</b>', 'Según las líneas de los albaranes. ' + badge('real'))
    + fila('Trabajo pendiente en cola (con duración conocida)', '<b>' + h1(o.backlog) + ' h</b>', badge('real') + ' Si no había trabajo esperando, las máquinas no habrían ingresado nada distinto.')
    + fila('Horas que realmente podían haberse ocupado', '<b>' + h1(o.hReal) + ' h</b>', 'Menor entre las horas usadas y las horas pendientes. ' + badge('calculada'))
    + fila('Margen por hora de la obra de referencia', isFinite(o.margenH) ? '<b>' + eur(o.margenH, 2) + '</b>' : '<i>sin dato</i>', 'Precio actual por hora (obra de referencia) − coste de máquina por hora productiva, mezcla de horas de esa obra. ' + badge('estimada'))
    + fila('<b>Alternativa de las máquinas</b>', isFinite(o.opMaq) ? '<b>' + eur(o.opMaq) + '</b>' : '<i>sin dato</i>', 'Horas ocupables × margen medio. Es una hipótesis, no un ingreso seguro. ' + badge('estimada'))
    + fila('Margen de esta obra por hora (antes de indirectos)', isFinite(o.margenObraH) ? '<b>' + eur(o.margenObraH, 2) + '</b>' : '<i>sin dato</i>', 'Para comparar con la fila de arriba.')
    + fila('Valor del tiempo de las personas', isFinite(o.valorTiempo) ? '<b>' + eur(o.valorTiempo) + '</b>' : '<i>sin dato</i>', h1(r.H) + ' h × ' + (isFinite(o.costeHoraPersona) ? eur(o.costeHoraPersona, 2) : '—') + ' por hora (coste de un maquinista de convenio). Lo que costaría pagar ese tiempo, no lo que ganarían Rafa y Manolo. ' + badge('estimada')));
};
R.sinHorasAviso = r => r.H ? '' : '<div style="font-size:11.5px;color:var(--orange);margin-bottom:8px;">Los albaranes de esta obra no traen horas: los repartos por horas y por máquina no son fiables.</div>';

R.tablaEsc = (b, lista) => {
  const base = R.simular(b, R.ESC0), filas = [base, ...lista.map(e => R.simular(b, e))];
  const f = (t, fn, neg) => '<tr><td style="padding:3px 6px 3px 0;color:var(--ink-soft);white-space:nowrap;">' + t + '</td>' + filas.map(s => '<td style="padding:3px 6px;text-align:right;white-space:nowrap;">' + fn(s) + '</td>').join('') + '</tr>';
  return '<div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:12px;min-width:100%;"><tr><td></td>' + filas.map((s, i) => '<th style="padding:3px 6px;text-align:right;font-size:11.5px;vertical-align:bottom;max-width:130px;">' + esc(s.nombre) + (i ? ' <a href="#" onclick="RENT.escDel(' + (i - 1) + ');return false">✕</a>' : '') + '</th>').join('') + '</tr>'
    + f('Coste empresarial / año', s => s.costeEmp ? eur(s.costeEmp) : '—') + f('Capacidad (h de máquina)', s => h1(s.capacidad)) + f('Trabajo realizado (h)', s => h1(s.trabajo)) + f('Capacidad adicional (h)', s => (s.dH >= 0 ? '+' : '') + h1(s.dH)) + f('Productividad (h/persona contratada)', s => isFinite(s.productividad) && s.productividad ? h1(s.productividad) : '—') + f('Ahorro potencial (taller)', s => s.ahorro ? eur(s.ahorro) : '—') + f('Beneficio resultante / año', s => '<b style="color:' + col(s.beneficio) + ';">' + eur(s.beneficio) + '</b>') + f('Cambio sobre hoy', s => (s.dBenef >= 0 ? '+' : '') + eur(s.dBenef)) + f('Tras retribuir socios', s => eur(s.beneficioTrasSocios)) + f('Punto de equilibrio (facturación extra / año)', s => s.costeEmp ? (isFinite(s.equilibrioFact) ? eur(s.equilibrioFact) : '—') : '—') + f('… en horas extra facturadas', s => s.costeEmp && isFinite(s.equilibrioHoras) ? h1(s.equilibrioHoras) : '—') + f('Esfuerzo evitado a los socios (h/año)', s => s.esfuerzoEvitado ? '<b>' + h1(s.esfuerzoEvitado) + '</b>' : '—') + '</table></div>'
    + [...new Set(filas.flatMap(s => s.notas))].map(n => '<div style="font-size:11px;color:var(--orange);margin-top:4px;">• ' + esc(n) + '</div>').join('');
};
R.secSim = (P, b) => {
  const bd = R.build, nb = R.simular(b, bd), inp = (k, l, u) => '<label style="font-size:11.5px;display:flex;flex-direction:column;gap:2px;">' + l + '<input type="number" value="' + R.param[k] + '" onchange="RENT.setParam(\'' + k + '\',this.value)" style="width:90px;"><span' + (/^(d|h|kg|km)\b/.test(u || '') ? ' class="no-cap"' : '') + ' style="color:var(--ink-soft);">' + (u || '') + '</span></label>';
  return card('Situación actual real (últimos 12 meses)', fila('Ingresos sin IVA', '<b>' + eur(b.ingresos) + '</b>', badge('calculada')) + fila('Horas facturadas', h1(b.horas) + ' h', b.dias + ' días con trabajo · ' + b.maquinas + ' máquinas productivas') + fila('Costes de actividad (sin retiradas)', eur(b.costesOp), 'Incluye combustible ' + eur(b.comb)) + fila('Beneficio antes de retribuir a los socios', '<b style="color:' + col(b.beneficio) + ';">' + eur(b.beneficio) + '</b>') + fila('Retiradas y gastos personales de los socios', eur(b.socios), 'No deducible.') + fila('Margen por hora (obra de referencia' + (b.ref ? ': ' + esc(b.ref.job.trabajo || '') + ', ' + h1(b.ref.H) + ' h, ' + eur(b.ref.ingH, 2) + ' por hora' : '') + ')', isFinite(b.margenH) ? eur(b.margenH, 2) : 'sin dato', 'Precio por hora actual − coste de máquina por hora productiva. ' + badge('estimada') + (b.ref && b.ref.cobertura < 1 ? ' Solo ' + Math.round(b.ref.cobertura * 100) + ' % de las horas tienen coste de máquina.' : '')) + fila('Trabajo pendiente en cola', b.backlog ? h1(b.backlog) + ' h' : 'sin duración conocida', b.pendientes + ' trabajos pendientes, ' + b.nBack + ' con duración'))
    + card('Montar escenario', '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;"><label style="font-size:12px;"><input type="checkbox" ' + (bd.socios8 ? 'checked' : '') + ' onchange="RENT.build.socios8=this.checked;RENT.repinta()"> Rafa y Manolo 8 h L-V</label><label style="font-size:12px;">Operarios <select onchange="RENT.build.operarios=+this.value;RENT.repinta()">' + [0, 1, 2, 3].map(n => '<option ' + (bd.operarios === n ? 'selected' : '') + '>' + n + '</option>').join('') + '</select></label><label style="font-size:12px;"><input type="checkbox" ' + (bd.mecanico ? 'checked' : '') + ' onchange="RENT.build.mecanico=this.checked;RENT.repinta()"> Mecánico</label><label style="font-size:12px;"><input type="checkbox" ' + (bd.mecCond ? 'checked' : '') + ' onchange="RENT.build.mecCond=this.checked;RENT.repinta()"> Mecánico-conductor</label><button type="button" class="btn" onclick="RENT.escAdd()">Guardar y comparar</button></div><div style="font-size:11px;color:var(--ink-soft);margin-top:6px;">Vista previa: <b>' + esc(nb.nombre) + '</b> → ' + eur(nb.beneficio) + ' al año (' + (nb.dBenef >= 0 ? '+' : '') + eur(nb.dBenef) + ' sobre hoy). Todo escenario es una ' + badge('estimada') + '</div>')
    + card('Comparación', R.tablaEsc(b, P.escenarios || []))
    + card('Obra de referencia (precio por hora y mezcla de máquinas)', '<select class="rt-sel" onchange="RENT.setRef(this.value)" style="font-size:12.5px;max-width:100%;"><option value="">Automática: nave avícola</option>' + (P.jobs || []).filter(j => (R.asignar(P).porJob[j.id] || []).length).map(j => '<option value="' + j.id + '"' + (R.param.refJob === j.id ? ' selected' : '') + '>' + esc(j.trabajo || j.id) + '</option>').join('') + '</select><div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">Solo cuentan las líneas con horas. De aquí salen el precio actual por hora de cada máquina y el margen por hora del simulador.</div>')
    + card('Hipótesis (editables)', '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + inp('jornadas', 'Jornadas al año', 'd') + inp('ocupacion', 'Ocupación productiva', '% de la jornada con máquina trabajando') + inp('indisponibilidad', 'Averías / paradas', '% de tiempo') + inp('reduccionAverias', 'Reducción con mecánico', '% de las averías') + inp('ahorroTaller', 'Ahorro en taller con mecánico', '%') + inp('condMecPct', 'Mecánico-conductor conduce', '% del tiempo') + inp('horasMecanicaSemana', 'Horas de mecánica de los socios', 'h/semana') + inp('impuesto', 'Impuestos', '% sobre beneficio') + inp('vidaUtil', 'Vida útil maquinaria', 'años') + inp('residualPct', 'Valor residual', '%') + '</div><div style="font-size:11px;color:var(--ink-soft);margin-top:6px;">Estos valores son hipótesis tuyas, no datos. La capacidad extra solo se factura si hay trabajo pendiente en cola; no se supone que más horas = más ingresos.</div>');
};
R.secComp = (r, P, b) => {
  if(!r || r.vacio) return card('', '<div style="font-size:12.5px;">Elige una obra con albaranes en el apartado 1 para ver las conclusiones.</div>');
  return card('Conclusiones: ' + esc(r.job.trabajo || 'obra'), R.conclusiones(r, P, b).map(([a, c]) => '<div style="margin-bottom:9px;"><div style="font-weight:700;font-size:12.5px;">' + esc(a) + '</div><div style="font-size:12.5px;">' + esc(c) + '</div></div>').join('') + '<div style="font-size:11px;color:var(--orange);">Las cifras estimadas están marcadas en cada apartado. Las conclusiones de contratación son del conjunto de la empresa, no de esta obra.</div>');
};
// ================= V9.55 · PANTALLA ÚNICA: 4 niveles + simulador de plantilla (Daniel 09/10/2026) =================
// Reparto por máquina: cada gasto general se reparte UNA sola vez por horas de máquina (si dos máquinas trabajan el mismo día no se cuenta dos veces); los costes fijos de una máquina van solo a esa máquina.
R.objetivo = (ded, soc, t, m) => { const den = (1 - t) - m; return den > 0.01 ? ((1 - t) * ded + soc) / den : NaN; };   // precio que deja m (% del ingreso) NETO tras impuestos: E − ded − soc − t·(E − ded) = m·E; las retiradas no desgravan
R.porClase = function(r){
  const H = r.H; if(!(H > 0)) return null;
  const cls = Object.keys(r.hClase).filter(c => r.hClase[c] > 0), t = num(R.param.impuesto) / 100, m = num(R.param.margen) / 100;
  const ing = {}; r.albs.forEach(d => { const f = R.factorLineas(d); R.lineas(d).forEach(l => { if(l.h > 0) ing[l.clase] = (ing[l.clase] || 0) + l.imp * f; }); });
  const maqCl = {}; (r.maq || []).forEach(x => { maqCl[String(x.id)] = (x.clases || []).filter(c => r.hClase[c] > 0); });
  const parte = (x, c) => { let k;
    if((k = /^maq:(.+)$/.exec(x.clave))) return k[1] === c ? x.valor : 0;
    if((k = /^amort:(.+)$/.exec(x.clave))){ const cs = maqCl[k[1]] || []; if(!cs.length) return x.valor * r.hClase[c] / H; return cs.includes(c) ? x.valor * r.hClase[c] / sum(cs, q => r.hClase[q]) : 0; }
    if(Array.isArray(x.clases) && x.clases.length){ const cs = x.clases.filter(q => r.hClase[q] > 0); if(cs.length) return cs.includes(c) ? x.valor * r.hClase[c] / sum(cs, q => r.hClase[q]) : 0; }
    return x.valor * r.hClase[c] / H; };
  const rel = x => /^(maq:|amort:|gen:ss|gen:coches|gen:gestoria)/.test(x.clave);
  return cls.map(c => { const h = r.hClase[c], D = sum(r.lineasD, x => parte(x, c)), I = sum(r.lineasI, x => parte(x, c)), IR = sum(r.lineasI.filter(rel), x => parte(x, c)), S = r.socios.valor * h / H;
    return {clase: c, nombre: R.NOMBRE_CLASE[c] || c, h, n1: D, n2: D + IR + S, n3: D + I + S, n4: R.objetivo(D + I, S, t, m), cobrado: ing[c] || 0, tarifa: ing[c] ? ing[c] / h : NaN}; });
};
R.niveles4 = function(r){
  const t = num(R.param.impuesto) / 100, m = num(R.param.margen) / 100, ded = r.directo + r.indirecto, soc = r.socios.valor, E = R.objetivo(ded, soc, t, m);
  return {n1: r.niv.n1, n2: r.niv.n2, n3: r.niv.n3, n4: E, imp: isFinite(E) ? t * Math.max(0, E - ded) : NaN, mar: isFinite(E) ? m * E : NaN, t, m, H: r.H};
};
// horas de Rafa y Manolo por actividad (12 meses): máquina y camión salen de los albaranes; reparar y gestionar son horas/semana de Hipótesis (no hay otro dato)
R.horasSocios = function(b){
  const ev = b.ev, hc = ev.horasClase || {}, prm = R.param, cond = hc.camion || 0, maq = Math.max(0, ev.horas - cond), rep = num(prm.repSemana) * (b.semanas || 46), ges = num(prm.gesSemana) * (b.semanas || 46);
  return {maq, cond, rep, ges, total: maq + cond + rep + ges, porDia: ev.dias ? ev.horas / ev.dias : NaN};
};
R.ESC2 = {rafa: 'hoy', manolo: 'hoy', mec: 0, cm: 0, maq: 0, cam: 0};
R.build2 = {...R.ESC2};
R.nombreEsc2 = e => { const p = [], pl = (n, s) => '+' + n + ' ' + s + (n > 1 ? 's' : ''); if(e.rafa !== 'hoy') p.push('Rafa ' + e.rafa); if(e.manolo !== 'hoy') p.push('Manolo ' + e.manolo); if(e.maq) p.push(pl(e.maq, 'maquinista')); if(e.cam) p.push(pl(e.cam, 'camionero')); if(e.mec) p.push(pl(e.mec, 'mecánico')); if(e.cm) p.push(pl(e.cm, 'conductor/mecánico')); return p.length ? p.join(', ') : 'Como hoy'; };
// Simulador: capacidad (lo que se podría producir) separada de lo asegurado (lo que ya se factura). La demanda NO limita: hay trabajo de sobra y conseguirlo es gestión comercial aparte.
// V10.64 (Daniel): simulador de UNA obra, todo por días. Las mismas horas (las de la obra) hechas por la gente elegida a 7 h operativas al día.
// Los días que la obra dura menos que los reales quedan libres: sus horas (7 h × personas) se trabajan en otra obra al margen por hora de la obra de referencia.
// Caja 1: al ritmo de hoy (Rafa y Manolo con sus horas reales por día; contratados y «empleado» a 7 h). Caja 2: todos a 7 h/día; los días que sobran se trabajan en otra obra.
// Costes por día: generales (gestoría, estructura, SS, coches) × días; Rafa y Manolo: su parte diaria × días; contratados y «empleado»: sueldo de convenio ÷ jornadas del año × días.
// Directos y fijos de máquina no cambian: son las mismas horas de máquina.
// V11.64 (Daniel 14/10/2026): el simulador trabaja SIEMPRE a las horas operativas de referencia (selector de Datos reales).
// Rafa: sus retiradas reales, que no desgravan. Manolo en el simulador: nómina de convenio (maquinista), que sí desgrava. Contratados: convenio.
// El camionero y el conductor/mecánico solo hacen horas de camión; el maquinista solo de máquina; Rafa y Manolo, de las dos.
// Las horas que sobran se trabajan en otras obras solo si hay trabajo: se toma la parte que la previsión del año deja ocupada (R.simAnio).
R.PUESTO = {maq: 'maquinista', cam: 'conductor1', mec: 'oficial1', cm: 'oficial1'};
R.rafaSim = () => { try{ return 2 * convenioSueldoInfo('maquinista').bruto; }catch(e){ return NaN; } };   // V11.65 (Daniel): en el simulador Rafa se lleva lo de dos maquinistas (2 × bruto de convenio), en retiradas: no desgrava
R.capacidad = function(e, hd){   // horas por día que puede hacer la gente: solo máquina, solo camión y de las dos
  const cmP = num(R.param.condMecPct) / 100 || 0, nSoc = (e.rafa === 'hoy' ? 1 : 0) + (e.manolo === 'hoy' ? 1 : 0);
  return {M: (e.maq | 0) * hd, C: ((e.cam | 0) + (e.cm | 0) * cmP) * hd, F: nSoc * hd, nSoc};
};
R.diasPara = function(Hm, Hc, cap, maxM, maxC){   // días que tarda en hacerse Hm h de máquina y Hc h de camión
  const cM = Math.min(cap.M + cap.F, maxM), cC = Math.min(cap.C + cap.F, maxC), cT = Math.min(cap.M + cap.C + cap.F, maxM + maxC);
  const a = Hm > 0 ? (cM > 0 ? Hm / cM : Infinity) : 0, c = Hc > 0 ? (cC > 0 ? Hc / cC : Infinity) : 0, t = (Hm + Hc) > 0 ? (cT > 0 ? (Hm + Hc) / cT : Infinity) : 0;
  return Math.max(a, c, t);
};
R.simObra = function(b, e, real){
  const r = b.r, prm = R.param, hd = num(prm.horasDia) || 6, t = num(prm.impuesto) / 100, hs = R.horasSocios(b), ok = x => isFinite(x) ? x : 0, faltan = [];
  const dLab = r.dLab || num(prm.jornadas) || 250, H = r.H, Hc = Math.min(H, (r.hClase || {}).camion || 0), Hm = H - Hc, Dtr = Math.max(1, Object.keys(r.hDia).length), mH = isFinite(b.margenH) ? b.margenH : 0, ingH = isFinite(b.ingH) ? b.ingH : 0;
  const nMaqF = Math.max(1, (r.maq || []).filter(x => !(x.clases || []).includes('camion')).length), nCamF = Math.max(Hc > 0 ? 1 : 0, (r.maq || []).filter(x => (x.clases || []).includes('camion')).length);
  const cap = R.capacidad(e, hd), persE = (cap.M + cap.C + cap.F) / hd, sinGente = persE <= 0;
  const cst = k => { const v = coste(R.PUESTO[k]); if(!isFinite(v) && (e[k] | 0)) faltan.push('convenio de ' + R.PUESTO[k]); return ok(v); };
  const manEmp = e.manolo === 'hoy' && !real ? cst('maq') : 0;   // Manolo en nómina de maquinista (en «hoy», con sus retiradas)
  const salAnual = (e.maq | 0) * cst('maq') + (e.cam | 0) * cst('cam') + ((e.mec | 0) + (e.cm | 0)) * cst('mec') + manEmp;
  const gen = sum(r.lineasI.filter(x => /^gen:/.test(x.clave)), x => x.valor), rafaDia = (e.rafa === 'hoy' ? ok(real ? (r.socAnual || {}).rafa : R.rafaSim()) / dLab : 0) + (real && e.manolo === 'hoy' ? ok((r.socAnual || {}).manolo) / dLab : 0);
  const red = Math.min(1, (e.mec | 0) + (e.cm | 0) * (1 - (num(prm.condMecPct) / 100 || 0))), ahorro = red * num(prm.ahorroTaller) / 100 * b.taller;
  const d = sinGente ? 0 : R.diasPara(Hm, Hc, cap, nMaqF * hd, nCamF * hd), imposible = !isFinite(d);
  const an = R.P ? R.simAnio(R.P, b, e, real) : null, uso = an ? an.uso : 1;   // parte de las horas libres que la previsión del año deja trabajar en otras obras
  const caja = dd => { if(sinGente || imposible) return {d: dd, libre: 0, vendido: 0, soc: 0, sal: 0, gen: 0, ben: -r.indirecto, imp: 0, net: -r.indirecto};
    const libre = Math.max(0, Dtr - dd) * (cap.M + cap.C + cap.F), vendido = libre * uso, k = dd / Dtr, soc = rafaDia * dd, sal = salAnual / dLab * dd, ben = b.beneficio - gen * (k - 1) - soc - sal + ahorro + vendido * mH, imp = t * Math.max(0, ben + soc);
    return {d: dd, libre, vendido, soc, sal, gen: gen * k, ben, imp, net: ben - imp}; };
  const c2 = caja(d), c1 = c2, hoy1 = b.beneficio - b.socios;
  const shareC = H ? Hc / H : 0, hSoc = persE > 0 ? H * cap.nSoc / persE : 0;
  const tr = {maq: hSoc * (1 - shareC), cond: hSoc * shareC, rep: cap.nSoc ? hs.rep * (1 - red) : 0, ges: cap.nSoc ? hs.ges : 0}; tr.total = tr.maq + tr.cond + tr.rep + tr.ges;
  const cambio = c2.sal + c2.soc - b.socios, falta = Math.max(0, cambio - ahorro), eqH = mH > 0 ? falta / mH : NaN;
  const notas = []; if(sinGente) notas.push('Sin nadie que maneje máquinas no se hace la obra: no hay ingresos y quedan los costes fijos.');
  if(imposible) notas.push(Hc > 0 && !(cap.C + cap.F) ? 'Nadie puede llevar el camión: el maquinista no coge el camión. Pon un camionero o deja a Rafa o a Manolo.' : 'Nadie puede llevar las máquinas: el camionero no coge una máquina. Pon un maquinista o deja a Rafa o a Manolo.');
  if(faltan.length) notas.push('Falta dato: ' + [...new Set(faltan)].join(', ') + '.');
  if(d > Dtr + 0.05) notas.push('Con esta gente la obra dura ' + h1(d) + ' días, más que los ' + Dtr + ' reales: los costes por día suben.');
  if(uso < 0.999) notas.push('De las horas que quedan libres solo se trabaja el ' + Math.round(uso * 100) + ' %: es lo que deja la previsión de trabajo del año.');
  return {e, nombre: R.nombreEsc2(e), obra: true, c1, c2, d1: d, d2: d, Dtr, persE, hLibre: c2.libre, costePers: c2.sal, retrib: c2.soc, capacidad: sinGente ? 0 : H + c2.vendido, horasAseg0: sinGente ? 0 : H, horasAseg: sinGente ? 0 : H, dPot: sinGente ? -H : c2.vendido, dAseg: sinGente ? -H : 0, ahorro,
    benAseg: c2.ben, benPot: c2.ben, netAseg: c2.net, netPot: c2.net, dBenAseg: c2.ben - hoy1, dBenPot: c2.ben - hoy1, eqH, eqFact: eqH * ingH, ingPot: c2.vendido * ingH, tr, nP: cap.nSoc, red, notas};
};
// ---- V11.64 (Daniel): el año entero con la previsión de trabajo. Los meses flojos (lluvia) dejan gente sin trabajo: más gente no siempre es más dinero ----
// V11.67 (Daniel 14/10/2026): el reparto del trabajo por meses sale de las FECHAS DE LAS LÍNEAS de los documentos con trabajo de máquina o camión (cada línea con su fecha):
// ya recoge lo que de verdad se trabaja cuando llueve. Un mes sin líneas con fecha toma el peso de las facturas de ese mes (5 años).
R.estacion = function(P){
  if(P._est) return P._est;
  const ef = R.efectivos(P), hoy = new Date().toISOString().slice(0, 10), desde = addDays(hoy, -365 * 5), fac = Array(12).fill(0), lin = Array(12).fill(0), anios = Array.from({length: 12}, () => new Set()), dias = Array.from({length: 12}, () => new Set());
  (ef.lista || []).forEach(d => { const f0 = dia(d.fecha_devengo); if(f0 && f0 >= desde && f0 <= hoy) fac[+f0.slice(5, 7) - 1] += R.baseIngreso(d);
    (Array.isArray(d.conceptos) ? d.conceptos : []).forEach(c => { const f = dia(c.fecha); if(!/^\d{4}-\d{2}-\d{2}$/.test(f) || f < desde || f > hoy || R.claseLinea(c.descripcion) === 'otros') return; const m = +f.slice(5, 7) - 1; lin[m] += Math.abs(num(c.importe)); anios[m].add(f.slice(0, 4)); dias[m].add(f); }); });
  const medL = lin.map((x, m) => anios[m].size ? x / anios[m].size : NaN), conL = medL.filter(isFinite), totF = sum(fac);
  let w;
  if(conL.length >= 6){ const pf = fac.map(x => totF > 0 ? x / totF : 1 / 12), escala = sum(conL) / Math.max(1e-9, sum(medL.map((x, m) => isFinite(x) ? pf[m] : 0)));
    const crudo = medL.map((x, m) => isFinite(x) ? x : pf[m] * escala), t = sum(crudo); w = crudo.map(x => x / t); }
  else w = totF > 0 ? fac.map(x => x / totF) : Array(12).fill(1 / 12);
  w.fuente = conL.length >= 6 ? 'lineas' : 'facturas'; w.diasMes = dias.map((d, m) => anios[m].size ? d.size / anios[m].size : NaN); w.mesesLin = conL.length;
  return P._est = w;
};
R.MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
R.simAnio = function(P, b, e, real){   // real = como hoy: Rafa y Manolo con sus retiradas (no desgravan)
  const r = b.r, prm = R.param, hd = num(prm.horasDia) || 6, t = num(prm.impuesto) / 100, ok = x => isFinite(x) ? x : 0;
  if(!r || !(r.H > 0)) return null;
  const dLab = r.dLab || num(prm.jornadas) || 250, Dq = Math.max(1, r.Dq || r.D || 1), H = r.H, Hc = Math.min(H, (r.hClase || {}).camion || 0), shC = Hc / H, ingH = r.ejecutado / H;
  const vH = (r.directo + sum(r.lineasI.filter(x => !/^gen:/.test(x.clave)), x => x.valor)) / H;   // combustible, averías y fijos de máquina: van con las horas
  const F = sum(r.lineasI.filter(x => /^gen:/.test(x.clave)), x => x.valor) / Dq * dLab;   // gestoría, estructura, autónomos y SS, coches: al año
  const A = b.anual || {}, Dh = (ingH > 0 ? ok(A.ingresos) / ingH : 0) + ok(A.backlog), w = R.estacion(P), ind = num(prm.indisponibilidad) / 100;
  const nMaqF = Math.max(1, (r.maq || []).filter(x => !(x.clases || []).includes('camion')).length), nCamF = Math.max(Hc > 0 ? 1 : 0, (r.maq || []).filter(x => (x.clases || []).includes('camion')).length);
  const cap = R.capacidad(e, hd), maxM = nMaqF * hd, maxC = nCamF * hd;
  // El trabajo que no se hace un mes (falta de gente) espera al siguiente, como mucho 2 meses de trabajo medio; lo que pasa de ahí se pierde (el cliente se va a otro)
  const capMes = i => { const dm = dLab / 12 * (1 - ind), cM = Math.min(cap.M + cap.F, maxM) * dm, cC = Math.min(cap.C + cap.F, maxC) * dm, cT = Math.min(cap.M + cap.C + cap.F, maxM + maxC) * dm; return {cM, cC, cT, dm}; };
  const tope = Dh / 12 * 2; let qm = 0, qc = 0, meses = [];
  for(let pasada = 0; pasada < 2; pasada++){ meses = w.map((p, i) => { const c = capMes(i), am = qm + Dh * p * (1 - shC), ac = qc + Dh * p * shC;
      let sm = Math.min(am, c.cM), sc = Math.min(ac, c.cC); if(sm + sc > c.cT && sm + sc > 0){ const k = c.cT / (sm + sc); sm *= k; sc *= k; }
      const pm = Math.max(0, am - sm), pc = Math.max(0, ac - sc), k2 = pm + pc > tope ? tope / (pm + pc) : 1; qm = pm * k2; qc = pc * k2;
      return {mes: R.MESES[i], dem: Dh * p, cola: am + ac, cap: c.cT, hechas: sm + sc, diasTrab: w.diasMes ? w.diasMes[i] : NaN, perdido: (pm + pc) * (1 - k2)}; }); }
  const S = sum(meses, x => x.hechas), Cap = sum(meses, x => x.cap), libres = Math.max(0, Cap - S);
  const SA = r.socAnual || {rafa: 0, manolo: 0}, rafa = e.rafa === 'hoy' ? ok(real ? SA.rafa : R.rafaSim()) : 0, manRet = real && e.manolo === 'hoy' ? ok(SA.manolo) : 0;
  const cst = k => ok(coste(R.PUESTO[k])), manNom = !real && e.manolo === 'hoy' ? cst('maq') : 0;
  const nominas = (e.maq | 0) * cst('maq') + (e.cam | 0) * cst('cam') + ((e.mec | 0) + (e.cm | 0)) * cst('mec') + manNom;
  const red = Math.min(1, (e.mec | 0) + (e.cm | 0) * (1 - (num(prm.condMecPct) / 100 || 0))), ahorro = red * num(prm.ahorroTaller) / 100 * ok(b.taller) / Dq * dLab;
  const ing = S * ingH, varC = S * vH, ret = rafa + manRet, ben = ing - varC - F - nominas - ret + ahorro, imp = t * Math.max(0, ben + ret), net = ben - imp;
  const VF = P.valFlota || {}, inv = sum((r.maq || []).map(x => num((VF[String(x.id)] || {}).estimado))), faltaV = (r.maq || []).some(x => !(num((VF[String(x.id)] || {}).estimado) > 0));
  return {meses, Dh, S, Cap, libres, uso: Cap > 0 ? S / Cap : 0, ing, varC, F, nominas, ret, rafa, manRet, manNom, ahorro, ben, imp, net, margen: ing > 0 ? net / ing * 100 : NaN, roa: inv > 0 && !faltaV ? net / inv * 100 : NaN, inv};
};
R.equilibrio = function(P, b, e, k){   // cuántos de un puesto dejan más dinero al año, con el resto como está
  const fil = []; for(let n = 0; n <= 6; n++){ const x = R.simAnio(P, b, Object.assign({}, e, {[k]: n})); if(!x) return null; fil.push({n, net: x.net, libres: x.libres}); }
  const best = fil.reduce((a, x) => x.net > a.net ? x : a, fil[0]); return {fil, best};
};
R.simular2 = function(b, e, real){
  if(b.obra && b.r) return R.simObra(b, e, real);
  const prm = R.param, jorn = b.jornadas || num(prm.jornadas) || 250, cmP = num(prm.condMecPct) / 100, t = num(prm.impuesto) / 100, contrato = (num(prm.horasDia) || 6) * jorn, hs = R.horasSocios(b);   // V9.84 (Daniel): 7 h de facturación por jornada (1 h es de mantenimiento de la maquinaria), sin recorte por ocupación
  const cMaq = coste('maquinista'), cMec = coste('oficial1'), faltan = [], nMaq = e.maq | 0, nMec = e.mec | 0, nCM = e.cm | 0, ok = x => isFinite(x) ? x : 0, prorr = b.obra ? jorn / (num(prm.jornadas) || 250) : 1;   // V10.58: el sueldo es anual; en una obra solo cuenta la parte de los días de esa obra
  if((nMaq || e.rafa === 'empleado' || e.manolo === 'empleado') && !isFinite(cMaq)) faltan.push('convenio de maquinista'); if((nMec || nCM) && !isFinite(cMec)) faltan.push('convenio de mecánico');
  const red = Math.min(1, nMec + nCM * (1 - cmP));
  // V9.86 (Daniel): una persona tiene tope de horas; reparar y gestionar lo hacen los que se quedan (si uno sale, el otro asume su parte), y a Rafa y Manolo se les paga por las horas que echan
  const mods = [e.rafa, e.manolo], nFuera = mods.filter(m => m === 'fuera').length, nAv = 2 - nFuera, nHoy = mods.filter(m => m === 'hoy').length;
  const carga = hs.rep * (1 - red) + hs.ges, capUno = nAv ? Math.max(0, contrato - carga / nAv) : 0;
  let capSoc = 0, capHoy = 0, costeEmp = 0;
  mods.forEach(m => { if(m === 'hoy'){ capSoc += capUno; capHoy += capUno; } else if(m === 'empleado'){ costeEmp += ok(cMaq) * prorr; capSoc += capUno; } });
  const capHired = nMaq * contrato + nCM * contrato * cmP, costeHired = (nMaq * ok(cMaq) + (nMec + nCM) * ok(cMec)) * prorr, costePers = costeHired + costeEmp;
  const ind0 = num(prm.indisponibilidad) / 100, ind1 = Math.max(0, num(prm.indisponibilidad) - red * num(prm.reduccionAverias) * num(prm.indisponibilidad) / 100) / 100;
  const capMaq0 = Math.max(b.horas, b.maquinas * (num(prm.horasDia) || 6) * jorn * (1 - ind0)), capMaq = capMaq0 * (1 - ind1) / (1 - ind0);
  const capPers = capSoc + capHired; let cap = Math.min(capMaq, capPers);
  // V10.43 (Daniel): una sola cuenta, la hecha día por día: lo que se echó + lo que cada día se podía haber echado (7 h por persona, L-V), menos reparar y gestionar
  if(b.obra && b.r){ const persE = (2 - nFuera) + nMaq + nCM * cmP, x = R.perdidas(b.r, persE, NaN, hs.rep * (1 - red) + hs.ges); cap = persE <= 0 ? 0 : Math.min(capMaq, b.r.H + x.hPerd); }
  const sinGente = !!(b.obra && b.r && (2 - nFuera) + nMaq + nCM * cmP <= 0);   // V10.61 (Daniel): sin nadie trabajando no hay obra: ni horas ni ingresos; solo quedan los costes fijos
  const ahorro = red * num(prm.ahorroTaller) / 100 * b.taller, mH = isFinite(b.margenH) ? b.margenH : 0, ingH = isFinite(b.ingH) ? b.ingH : 0;
  const horasAseg = Math.min(b.horas, cap), dPot = cap - b.horas, dAseg = horasAseg - b.horas, base = b.beneficio - b.socios;
  const pagoH = (b.horas + hs.rep + hs.ges) > 0 ? b.socios / (b.horas + hs.rep + hs.ges) : 0, retribDe = pro => pagoH * ((capPers > 0 ? pro * capHoy / capPers : 0) + (nAv ? carga * nHoy / nAv : 0));
  const costeUso = pro => b.obra ? costePers * Math.min(1, capPers > 0 ? pro / capPers : 0) : costePers, costeAseg = costeUso(horasAseg), costePot = b.obra ? costeAseg : costeUso(cap);   // V10.60 (Daniel): se paga solo a los días que la obra necesita; los días que sobran no se pagan aquí y se aprovechan en otra obra   // V10.59 (Daniel): en una obra los contratados cuestan solo la parte de su tiempo que la obra necesita (la duración ideal), no todos los días
  const retrib = retribDe(horasAseg), retribPot = retribDe(cap), cambio = costeAseg + retrib - b.socios, cambioPot = costePot + retribPot - b.socios;
  const benAseg = sinGente ? -b.r.indirecto : base + dAseg * mH + ahorro - cambio, benPot = sinGente ? -b.r.indirecto : base + dPot * mH + ahorro - cambioPot, imp = x => t * Math.max(0, x + retrib), impP = x => t * Math.max(0, x + retribPot);
  const falta = Math.max(0, cambio - ahorro), eqH = mH > 0 ? falta / mH : NaN;
  // trabajo de Rafa y Manolo (h/año) por actividad
  const nP = 2 - nFuera, maqSoc = capPers > 0 ? horasAseg * capSoc / capPers : 0, shareC = (hs.maq + hs.cond) ? hs.cond / (hs.maq + hs.cond) : 0;
  const tr = {maq: maqSoc * (1 - shareC), cond: maqSoc * shareC, rep: hs.rep * (1 - red), ges: hs.ges}; if(nP === 0){ tr.rep = 0; tr.ges = 0; } tr.total = tr.maq + tr.cond + tr.rep + tr.ges;
  const notas = []; if(nFuera && hs.ges > 0) notas.push('Con ' + (nFuera === 2 ? 'los dos fuera' : 'uno fuera') + ' la gestión de la empresa queda sin cubrir.'); if(nFuera === 2 && !nMaq && !nCM) notas.push('Sin Rafa ni Manolo y sin nadie que maneje máquinas, no se produce.');
  if(capPers > capMaq + 1) notas.push('El límite son las máquinas, no las personas.'); if(faltan.length) notas.push('Falta dato: ' + faltan.join(', ') + '.'); if(!hs.ges) notas.push('Las horas de gestión de Rafa y Manolo están a 0: ponlas en Hipótesis para que cuenten.');
  return {e, nombre: R.nombreEsc2(e), costePers: costeAseg, retrib, capacidad: cap, horasAseg0: horasAseg, capPers, capMaq, dPot, dAseg, horasAseg, ahorro, benAseg, benPot, netAseg: benAseg - imp(benAseg), netPot: benPot - impP(benPot), dBenAseg: benAseg - base, dBenPot: benPot - base, eqH, eqFact: eqH * ingH, ingPot: Math.max(0, dPot) * ingH, tr, nP, red, notas};
};

// ---------- presentación ----------
// Colores: verde = bien / ingreso, rojo = mal / coste. Cada cifra dice qué es (ingreso, coste, beneficio). Sin fondos grises: papel con borde, como el resto de la app.
{ const old = document.getElementById('rt-css'); if(old) old.remove(); const st = document.createElement('style'); st.id = 'rt-css'; st.textContent = `
.rt-w{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:100%}
.rt-w *{min-width:0;box-sizing:border-box}
.rt-sum{display:flex;flex-direction:column}
.rt-t{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
.rt-t:first-child{border-top:0}
.rt-t span{grid-column:1;display:block;font-size:12.5px;font-weight:800}
.rt-t b{grid-column:2;grid-row:1/span 2;display:block;font-size:16px;font-weight:900;white-space:nowrap;text-align:right}
.rt-t small{grid-column:1;display:block;font-size:11px;color:var(--ink-soft)}
.rt-c{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:8px 12px}
.rt-c>h3{margin:0 0 2px;font-size:14px;font-weight:800}
.rt-k{display:inline-block;font-size:10px;font-weight:800;border-radius:6px;padding:1px 6px;text-transform:uppercase;letter-spacing:.03em}
.rt-k.g{background:var(--green-soft);color:var(--green)}.rt-k.r{background:var(--red-soft);color:var(--red)}
.rt-n{display:grid;grid-template-columns:5px minmax(0,1fr) auto;gap:10px;align-items:center;padding:4px 0;border-top:1px solid var(--line)}
.rt-n.p1{border-top:0}
.rt-n i{align-self:stretch;border-radius:3px}
.rt-n b{font-size:13.5px}.rt-n small{display:block;font-size:11px;color:var(--ink-soft)}
.rt-n .v{text-align:right}.rt-n .v b{font-size:15px;font-weight:900;display:block;white-space:nowrap}
.rt-n .v small{white-space:nowrap}
.rt-n .x{grid-column:2/4;font-size:12.5px;display:flex;flex-direction:column;gap:4px;align-items:flex-start}.rt-n .x em{display:block;font-style:normal;font-size:12px;font-weight:800;border-radius:8px;padding:3px 9px}
.rt-n .x em.g{background:var(--green-soft);color:var(--green)}.rt-n .x em.r{background:var(--red-soft);color:var(--red)}
.rt-sel{background:#fff;border:1.5px solid var(--orange);border-radius:10px;padding:3px 8px;font-weight:700;color:var(--ink);font-size:13px}
.rt-nd>summary{list-style:none;cursor:pointer}.rt-nd>summary::-webkit-details-marker{display:none}.rt-nd .rt-bd{padding:2px 0 10px 14px;font-size:12px;border-bottom:1px solid var(--line)}
.rt-ch{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;font-size:12px}
.rt-ch button,.rt-seg button{border:1.5px solid var(--line);background:transparent;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700;color:inherit}
.rt-ch button.on,.rt-seg button.on{background:var(--paper);border:2px solid var(--orange);color:var(--ink)}
.rt-tb{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}.rt-tb th:first-child,.rt-tb td:first-child{width:34%}
.rt-tb.rt-fit{min-width:0 !important;width:100%}   /* V9.84: la regla global table{min-width:600px} desbordaba la tabla por máquina en el móvil */
.rt-th9 th{font-size:8.5px !important;letter-spacing:0;padding-left:0 !important;padding-right:2px !important}.rt-th9 th:first-child,.rt-th9 td:first-child{width:25% !important}
.rt-tb th{font-size:10.5px;font-weight:800;text-align:right;padding:3px 4px;text-transform:uppercase}
.rt-tb th:first-child,.rt-tb td:first-child{text-align:left}
.rt-tb td{padding:7px 3px;text-align:right;border-top:1px solid var(--line);white-space:nowrap;font-size:12.5px}
.rt-tb td:first-child{white-space:normal}
.rt-d{border-radius:10px;border:1px solid var(--line);padding:0 10px;background:var(--paper)}
.rt-w details>summary{list-style:none}.rt-w details>summary::-webkit-details-marker{display:none}
.rt-d>summary{padding:6px 0;font-weight:800;font-size:13px;color:var(--orange);cursor:pointer}
.rt-d[open]>summary{margin-bottom:6px}
.rt-d .tb-cos{margin-left:0;margin-right:0}
.rt-sim-r{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid var(--line);font-size:13px;line-height:1.25}
.rt-sim-r:first-of-type{border-top:0}
.rt-sim-r>b{text-align:right;white-space:nowrap;flex-shrink:0}.rt-sim-r>span{min-width:0}
.rt-ph{display:block;font-size:11px;font-weight:700;color:var(--ink-soft);white-space:nowrap}
.rt-ld>summary{list-style:none;cursor:pointer;-webkit-tap-highlight-color:transparent}.rt-ld>summary::-webkit-details-marker{display:none}.rt-ld>summary:active{background:var(--concrete)}.rt-ld[open]>summary{border-left:2px solid var(--orange);padding-left:6px}
.rt-ldb{padding:0 0 6px 10px;font-size:12px}.rt-ldb .rt-sim-r{font-size:12px}.rt-ldx{font-size:11.5px;color:var(--ink-soft);padding:3px 0;border-top:1px solid var(--line)}
.rt-ld+.rt-ld>summary,.rt-ld+.rt-sim-r,.rt-sim-r+.rt-ld>summary{border-top:1px solid var(--line)}
.rt-st{display:inline-flex;align-items:center;gap:8px}
.rt-st button{width:28px;height:28px;border:none;background:transparent;font-size:22px;font-weight:800;color:var(--orange);line-height:1;padding:0;flex:none}
.rt-st b{min-width:20px;text-align:center;font-size:16px}
.rt-seg{display:flex;gap:4px;flex-wrap:nowrap;justify-content:flex-end;flex-shrink:0}
.rt-big{display:flex;flex-direction:column;margin:2px 0 4px}
.rt-w .tb-cos{margin-bottom:0!important;padding:8px 10px}
#te-subtabs{margin:0 0 6px!important;gap:6px}#te-subtabs .docs-tab{padding:5px 8px;font-size:12px}
.rt-pl{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)}.rt-pl>button{border:1.5px solid var(--line);background:transparent;border-radius:999px;padding:5px 22px;font-size:13px;font-weight:800;color:inherit}.rt-pl>button.on{background:var(--paper);border:2px solid var(--orange);color:var(--ink)}.rt-pw{margin-top:6px}
.rt-pp{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:2px 0 6px}.rt-pp>div{display:flex;flex-direction:column;align-items:center;gap:2px}.rt-pp small{text-align:center}
.rt-pp button{border:1.5px solid var(--line);background:transparent;border-radius:999px;padding:5px 22px;font-size:13px;font-weight:800;color:inherit}.rt-pp button.on{background:var(--paper);border:2px solid var(--orange);color:var(--ink)}
.rt-g3{display:flex;flex-direction:column}
.rt-tl{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:center;text-align:left;font-size:12.5px;line-height:1.25;color:var(--ink);padding:6px 0;border-top:1px solid var(--line)}
.rt-tl span{grid-column:1}
.rt-tl b{grid-column:2;grid-row:1/span 2;font-size:14.5px;font-weight:800;white-space:nowrap;text-align:right}
.rt-tl small{grid-column:1;font-size:11px;color:var(--ink-soft)}
.rt-big small *{display:inline!important;font-size:11px!important;margin:0!important}
.rt-big small b{display:inline;font-size:11px;margin:0;white-space:normal}
.rt-fila-t{cursor:pointer;-webkit-tap-highlight-color:transparent;}.rt-fila-t:active{background:var(--concrete);}.rt-stg{display:flex;flex-direction:column;border-top:1px solid var(--line)}.rt-stw>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;padding:5px 0}.rt-stw+.rt-stw{border-top:1px solid var(--line)}
.rt-big div{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);text-align:left}
.rt-big span{grid-column:1;display:block;font-size:12.5px;font-weight:800}.rt-big b{grid-column:2;grid-row:1/span 2;display:block;font-size:16px;font-weight:900;white-space:nowrap;text-align:right}.rt-big small{grid-column:1;display:block;font-size:11px;color:var(--ink-soft)}
.rt-an{font-size:11.5px;color:var(--orange);margin-top:4px}
.rt-lab{display:flex;align-items:center;gap:8px;min-width:0}
.rt-off,.rt-off span,.rt-off s{color:var(--ink-soft)!important}.rt-lab.rt-off>span:last-child{text-decoration:line-through}
.rt-gr>.rt-ldb{border-left:2px solid var(--line);margin-left:8px}
`; document.head.appendChild(st); }

const G = 'var(--green)', RJ = 'var(--red)', cs = (v, t) => '<span style="color:' + (v >= 0 ? G : RJ) + ';">' + t + '</span>';
const cG = t => '<span style="color:' + G + ';">' + t + '</span>', cR = t => '<span style="color:' + RJ + ';">' + t + '</span>';
const kg = '<span class="rt-k g">ingreso</span>', kr = '<span class="rt-k r">coste</span>';
const dEur = (v, dec) => (v >= 0 ? '+' : '−') + eur(Math.abs(v), dec);
const n0 = v => isFinite(v) ? eur(v).replace(' €', '') : '—';
const det = (t, inner) => '<details class="rt-d"><summary>' + t + '</summary>' + inner + '</details>';

R.vistaObra = function(r, P, b){
  const nv = R.niveles4(r), cl = R.porClase(r), tar = r.niv.tarifa, hOk = r.H > 0, n2 = v => isFinite(v) ? v.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
  const ok4 = isFinite(nv.n4) && hOk && isFinite(tar) ? tar >= nv.n4 / r.H : null, c4 = ok4 == null ? 'var(--ink)' : ok4 ? G : RJ;
  const mgPct = v => r.ejecutado > 0 && isFinite(v) ? Math.round(v / r.ejecutado * 100) : null;   // margen = beneficio ÷ trabajo hecho
  // V10.86 (Daniel): cada coste lleva al lado su % sobre el ingreso de la obra; los nombres empiezan siempre en mayúscula
  const pcI = v => r.ejecutado > 0 && isFinite(v) ? ' <span style="font-size:.78em;color:var(--ink-soft);font-weight:700;">' + (Math.round(v / r.ejecutado * 1000) / 10).toLocaleString('es-ES', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' %</span>' : '', mayus = t => { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const pcH = v => r.H > 0 && isFinite(v) ? ' <span style="font-size:.78em;color:var(--ink-soft);font-weight:700;">· ' + eur(v / r.H, 2) + '/h</span>' : '';   // V10.98 (Daniel): cada coste con su importe, su % y su €/h
  const pcIH = v => '<small class="rt-ph">' + (pcI(v) + pcH(v)).replace(/<[^>]+>/g, '').trim() + '</small>';   // V11.49 (reporte 17a04432): % y €/h debajo del importe, sin partirse
  // V11.49 (Daniel): cada línea se toca y se despliega ahí mismo con su desglose: partidas que la forman, cómo se calcula y la nota
  // V11.97 (reporte e14de7ff): cada partida lleva una casilla; desmarcada no cuenta en los totales (se ve tachada)
  const jid = r.job.id, cb = (claves, on) => '<input type="checkbox" class="rt-cbx"' + (on ? ' checked' : '') + ' onclick="event.preventDefault();event.stopPropagation();RENT.toggleExcl(\'' + encodeURIComponent(jid) + '\',\'' + claves.map(encodeURIComponent).join(',') + '\',' + (on ? 1 : 0) + ')">';
  const unaL = x => { const dd = (!x.manualId && x.desg && x.desg.length ? x.desg.map(([k, v]) => '<div class="rt-sim-r"><span>' + mayus(esc(k)) + '</span><b>' + eur(v) + '</b></div>').join('') : '') + (x.criterio ? '<div class="rt-ldx">' + mayus(esc(x.criterio)) + '</div>' : '') + (x.nota ? '<div class="rt-ldx">' + mayus(esc(x.nota)) + '</div>' : '');
    const fila = '<span class="rt-lab' + (x.excluido ? ' rt-off' : '') + '">' + cb([x.clave], !x.excluido) + '<span>' + mayus(esc(x.label || x.clave)) + '</span></span><b' + (x.excluido ? ' class="rt-off"' : '') + '>' + (x.excluido ? '<s>' + eur(x.valorExcl) + '</s><small class="rt-ph">Sin contar</small>' : eur(x.valor) + pcIH(x.valor)) + '</b>';
    return dd ? '<details class="rt-ld"><summary class="rt-sim-r">' + fila + '</summary><div class="rt-ldb">' + dd + '</div></details>' : '<div class="rt-sim-r">' + fila + '</div>'; };
  // V11.97 (reporte e14de7ff): las partidas parecidas se agrupan (combustible, reparaciones, personal…); el grupo se despliega y se puede desmarcar entero
  const GRUPOS = [['Combustible', x => /^combustible/.test(x.clave) || /gas[oó]leo|combust|gasolina/i.test(x.label || '')], ['Reparaciones', x => /^reparaciones/.test(x.clave) || /repara|manten|taller|neum/i.test(x.label || '')], ['Personal', x => /^(ayudantes|gen:ss|socios)$/.test(x.clave) || /n[oó]mina|personal/i.test(x.label || '')], ['Máquinas: costes fijos y amortización', x => /^(maq:|amort:)/.test(x.clave)], ['Estructura y gastos generales', x => /^gen:/.test(x.clave)]];
  const bdL = ls => { ls = ls.filter(x => Math.abs(x.valor) >= 0.5 || x.excluido); const usadas = new Set(), out = [];
    ls.forEach(x => { if(usadas.has(x)) return; const g = GRUPOS.find(([, f]) => f(x)), miembros = g ? ls.filter(y => !usadas.has(y) && g[1](y)) : [x];
      miembros.forEach(y => usadas.add(y));
      if(miembros.length < 2){ out.push(unaL(x)); return; }
      const v = sum(miembros, y => y.valor), algunoOn = miembros.some(y => !y.excluido);
      out.push('<details class="rt-ld rt-gr"><summary class="rt-sim-r"><span class="rt-lab' + (algunoOn ? '' : ' rt-off') + '">' + cb(miembros.map(y => y.clave), algunoOn) + '<span><b style="font-size:inherit;">' + g[0] + '</b> <small style="color:var(--ink-soft);font-weight:700;">' + miembros.length + '</small></span></span>' + (algunoOn ? '<b>' + eur(v) + pcIH(v) + '</b>' : '<b class="rt-off"><s>' + eur(sum(miembros, y => y.valorExcl || 0)) + '</s><small class="rt-ph">Sin contar</small></b>') + '</summary><div class="rt-ldb">' + miembros.map(unaL).join('') + '</div></details>'); });
    return out.join('') || '<div class="rt-sim-r"><span>Sin importes</span></div>'; };
  const relRx = /^(maq:|amort:|gen:ss|gen:coches|gen:gestoria)/, relL = r.lineasI.filter(x => relRx.test(x.clave)), restoL = r.lineasI.filter(x => !relRx.test(x.clave));
  const sociosL = [Object.assign({}, r.socios, {label: 'Salario de Rafa y Manolo'})];
  const fil = (titulo, sub, v, color, bd, cOver, base) => { const ok = v >= 0, c = cOver || (ok ? G : RJ), mg = base > 0 && isFinite(v) ? Math.round(v / base * 100) : mgPct(v);
    return '<details class="rt-nd"><summary><div class="rt-n"><i style="background:' + color + ';"></i><div><b>' + titulo + '</b><small>' + sub + '</small></div><div class="v"><b style="color:' + c + ';">' + (isFinite(v) ? eur(v) : 'sin dato') + (mg != null ? ' <span style="font-size:.72em;font-weight:700;">' + mg + ' %</span>' : '') + '</b><small style="color:' + c + ';font-weight:700;">' + (hOk && isFinite(v) ? eur(v / r.H, 2) + '/h' : 'sin horas') + '</small></div></div></summary><div class="rt-bd">' + bd + '</div></details>'; };
  const sg = v => v >= 0 ? G : RJ, tile = (cl2, t, v, sm, c) => '<div class="rt-t"><span style="color:' + c + ';">' + t + '</span><b style="color:' + c + ';">' + v + '</b><small>' + sm + '</small></div>';
  const resumen = '<div class="rt-c rt-sum">' + tile('g', 'Ingreso', eur(r.ejecutado), (hOk ? h1(r.H) + ' h' : 'sin horas'), G)
    + tile(r.beneficioReal >= 0 ? 'g' : 'r', 'Beneficio', eur(r.beneficioReal), 'antes de impuestos', sg(r.beneficioReal))
    + tile(r.neto >= 0 ? 'g' : 'r', 'Beneficio neto', eur(r.neto), 'tras impuestos', sg(r.neto)) + '</div>';
  // V9.90 (Daniel): tarjeta 1 = beneficio al ir restando costes; tarjeta 2 = lo que queda LIMPIO (tras impuestos): final frente a objetivo, aparte para compararlos; porcentaje de 1 a 100
  const m100 = Math.min(100, Math.max(1, num(R.param.margen) || 1));
  const cr = t => '<span style="color:' + G + ';">Benef.</span> <span style="color:' + RJ + ';">' + t + '</span>';
  const hd = (t, v) => '<div class="rt-sim-r" style="font-weight:800;border-top:1px solid var(--line,#ddd);margin-top:4px;"><span>' + t + '</span><b>' + eur(v) + pcIH(v) + '</b></div>';
  const limpioFin = r.neto, limpioObj = nv.mar, okLim = isFinite(limpioObj) && limpioFin >= limpioObj;
  const filaL = (tit, sub, v, pct, color, c, bd) => '<details class="rt-nd"><summary><div class="rt-n"><i style="background:' + color + ';"></i><div><b>' + tit + '</b><small>' + sub + '</small></div><div class="v"><b style="color:' + c + ';">' + (isFinite(v) ? eur(v) : 'sin dato') + (pct != null ? ' <span style="font-size:.72em;font-weight:700;">' + pct + ' %</span>' : '') + '</b><small style="color:' + c + ';font-weight:700;">' + (hOk && isFinite(v) ? eur(v / r.H, 2) + '/h' : 'sin horas') + '</small></div></div></summary><div class="rt-bd">' + bd + '</div></details>';
  // V10.98 (Daniel 12/10/2026): una sola lista de 7 filas, cada una con importe, % sobre el ingreso y €/h
  const nProd = nv.n2 - nv.n1, nResto = nv.n3 - nv.n2, sr = (t, v) => '<div class="rt-sim-r"><span>' + t + '</span><b>' + eur(v) + '</b></div>';
  const f1 = filaL('Coste directo', '', nv.n1, mgPct(nv.n1), '#2f8f5b', RJ, bdL(r.lineasD));
  const f2 = filaL(cr('− coste directo'), '', r.ejecutado - nv.n1, mgPct(r.ejecutado - nv.n1), '#2f8f5b', sg(r.ejecutado - nv.n1), sr('Trabajo hecho', r.ejecutado) + sr('− Costes directos', nv.n1) + sr('= Beneficio', r.ejecutado - nv.n1));
  const f3 = filaL('Coste de producción', '', nProd, mgPct(nProd), '#2f6fb0', RJ, bdL(relL.concat(sociosL)));
  const f4 = filaL(cr('− coste directo − producción'), '', r.ejecutado - nv.n2, mgPct(r.ejecutado - nv.n2), '#2f6fb0', sg(r.ejecutado - nv.n2), sr('Trabajo hecho', r.ejecutado) + sr('− Costes directos', nv.n1) + sr('− Producción', nProd) + sr('= Beneficio', r.ejecutado - nv.n2));
  const f5 = filaL('Todos los costes', '', nv.n3, mgPct(nv.n3), '#8a6d3b', RJ, hd('Costes directos', nv.n1) + bdL(r.lineasD) + hd('Producción', nProd) + bdL(relL.concat(sociosL)) + (Math.abs(nResto) >= 0.5 ? hd('Resto de costes', nResto) + bdL(restoL) : ''));
  const f6 = filaL('Beneficio neto final', 'Tras todos los costes e impuestos', limpioFin, mgPct(limpioFin), '#c58a1b', sg(limpioFin), '<div class="rt-sim-r"><span>Trabajo hecho</span><b>' + eur(r.ejecutado) + '</b></div><div class="rt-sim-r"><span>− todos los costes</span><b>' + cR(eur(nv.n3)) + '</b></div><div class="rt-sim-r"><span>− impuestos</span><b>' + cR(eur(r.impuestos)) + '</b></div><div class="rt-sim-r"><span>= limpio</span><b>' + eur(limpioFin) + '</b></div>');
  const f7 = isFinite(limpioObj) ? filaL('Beneficio objetivo', 'Con precio de ' + (hOk ? eur(nv.n4 / r.H, 2) + '/h' : eur(nv.n4)), limpioObj, m100, '#c0392b', sg(limpioObj), '<div class="rt-sim-r"><span>Coste completo</span><b>' + cR(eur(nv.n3)) + '</b></div><div class="rt-sim-r"><span>+ impuestos</span><b>' + cR(eur(nv.imp)) + '</b></div><div class="rt-sim-r"><span>+ beneficio limpio (' + m100 + ' %)</span><b>' + cG(eur(nv.mar)) + '</b></div><div class="rt-sim-r"><span>= precio necesario</span><b>' + eur(nv.n4) + '</b></div><div class="rt-sim-r"><span>Trabajo hecho</span><b>' + eur(r.ejecutado) + '</b></div>') : '<div class="rt-an">Con ese porcentaje no hay precio posible: bájalo.</div>';
  const slider = '<div class="rt-ch" style="flex-wrap:nowrap;"><span>Margen objetivo <b id="rt-pct-v">' + m100 + ' %</b></span><input type="range" min="1" max="100" step="1" value="' + m100 + '" style="flex:1;accent-color:var(--orange);" oninput="document.getElementById(\'rt-pct-v\').textContent=this.value+\' %\'" onchange="RENT.setParam(\'margen\',this.value)"></div>';
  const nEx = r.lineasD.concat(r.lineasI, [r.socios]).filter(x => x.excluido), avEx = nEx.length ? '<div class="rt-an" style="margin:0 0 6px;">' + nEx.length + (nEx.length === 1 ? ' partida sin contar' : ' partidas sin contar') + ' (' + eur(sum(nEx, x => x.valorExcl)) + ') · <a href="#" onclick="RENT.contarTodo(\'' + encodeURIComponent(r.job.id) + '\');return false">Contar todo</a></div>' : '';
  const niveles = '<div class="rt-c"><h3>Costes y beneficio</h3><div style="font-size:11.5px;color:var(--ink-soft);margin:-4px 0 6px;">Ingresos: <b>' + eur(r.ejecutado) + '</b> (sin IVA)</div>' + avEx + f1 + f2 + f3 + f4 + '<div style="height:10px;"></div>' + f5 + f6 + f7 + slider + '</div>';
  const col4 = (x) => { const ob = isFinite(x.n4) ? x.n4 / x.h : NaN, ok = isFinite(ob) && isFinite(x.tarifa) ? x.tarifa >= ob : null; return ok == null ? 'var(--ink)' : ok ? G : RJ; };
  const maq = cl ? '<div class="rt-c"><h3>Por máquina · €/h</h3><div style="font-size:11px;color:var(--ink-soft);margin:-4px 0 4px;">Costes y precio objetivo. Verde: ya se cobra más que el objetivo.</div><table class="rt-tb rt-fit rt-th9"><tr><th>Máquina</th><th>Directo</th><th>Produc.</th><th>Completo</th><th>Objetivo</th></tr>' + cl.map(x => '<tr><td><b>' + esc(x.nombre) + '</b><small style="display:block;color:var(--ink-soft);font-size:11px;">' + h1(x.h) + ' h' + (isFinite(x.tarifa) ? ' · cobras ' + n2(x.tarifa) : '') + '</small></td><td style="color:' + RJ + ';">' + n2(x.n1 / x.h) + '</td><td style="color:' + RJ + ';">' + n2(x.n2 / x.h) + '</td><td style="color:' + RJ + ';">' + n2(x.n3 / x.h) + '</td><td style="font-weight:800;color:' + col4(x) + ';">' + n2(x.n4 / x.h) + '</td></tr>').join('') + '</table></div>' : '';
  const detNiv = '<div style="padding-bottom:8px;">' + (cl ? '<div style="font-weight:800;font-size:13px;margin:4px 0;">Por máquina · € en total</div><div style="font-size:11px;color:var(--ink-soft);margin:-4px 0 4px;">Directo · Producción · Completo · Objetivo</div><table class="rt-tb rt-fit"><tr><th>Máquina</th><th>1</th><th>2</th><th>3</th><th>4</th></tr>' + cl.map(x => '<tr><td>' + esc(x.nombre) + '</td><td style="color:' + RJ + ';">' + n0(x.n1) + '</td><td style="color:' + RJ + ';">' + n0(x.n2) + '</td><td style="color:' + RJ + ';">' + n0(x.n3) + '</td><td style="font-weight:800;color:' + col4(x) + ';">' + n0(x.n4) + '</td></tr>').join('') + '<tr style="font-weight:800;"><td>Total</td><td style="color:' + RJ + ';">' + n0(nv.n1) + '</td><td style="color:' + RJ + ';">' + n0(nv.n2) + '</td><td style="color:' + RJ + ';">' + n0(nv.n3) + '</td><td style="color:' + c4 + ';">' + n0(nv.n4) + '</td></tr></table>' : '')
    + (isFinite(nv.n4) ? '<div class="rt-sim-r"><span>Precio objetivo: coste completo</span><b>' + cR(eur(nv.n3)) + '</b></div><div class="rt-sim-r"><span>+ impuestos</span><b>' + cR(eur(nv.imp)) + '</b></div><div class="rt-sim-r"><span>+ margen (' + R.param.margen + ' %)</span><b>' + cG(eur(nv.mar)) + '</b></div>' : '<div class="rt-an">Con ese margen e impuestos no hay precio posible: baja el margen.</div>')
    + '<div style="font-size:11.5px;color:var(--ink-soft);margin-top:6px;">Los gastos generales se reparten una sola vez por horas de máquina: si dos máquinas trabajan el mismo día, ese día no se cuenta dos veces. Los costes fijos de cada máquina van solo a ella. Impuestos: ' + R.param.impuesto + ' % sobre el beneficio, sin contar lo que se llevan Rafa y Manolo, que no desgrava. El margen es lo que queda limpio tras impuestos, como % del precio. Falta la reposición real de las máquinas sin precio de compra. Verde en el nivel 4: lo que ya cobráis cubre ese precio; rojo: no.</div></div>';
  const avisos = (r.avisos.length ? '<div class="rt-an">' + r.avisos.map(a => '• ' + esc(a)).join('<br>') + '</div>' : '') + R.sinHorasAviso(r);
  const detalle = det('Ver detalle', avisos + detNiv + R.secDirecto(r) + R.secReal(r) + R.secOport(r) + R.secComp(r, P, b));
  const opObra = '<div class="rt-c"><h3>Coste de oportunidad</h3>' + R.opHtml(r, 2, b.margenH, r.socios.valor, (() => { const hh = R.horasSocios(R.baseObra(r, b)); return hh.rep + hh.ges; })()) + '</div>';
  return R.datosReales(r, b) + niveles + R.htmlPrecios(R.preciosDe(r), true) + R.htmlComparar(r, P) + detalle;   // V11.62 (Daniel 14/10): ¿Estamos en precio? (la misma tarjeta que Economía) y ¿Cómo de rentable es?   // V10.49 (Daniel): sin los tres cuadros de arriba; los ingresos van dentro de Beneficio bruto   // V10.47 (Daniel): sin tarjeta «Por máquina €/h» (no se usa); el coste de oportunidad va junto a Organización
};

R.escHtml2 = (b, lista) => {
  const hoy = R.simular2(b, R.ESC2), filas = [hoy, ...lista.map(e => R.simular2(b, e))];
  const f = (t, fn) => '<tr><td style="color:var(--ink-soft);">' + t + '</td>' + filas.map(s => '<td>' + fn(s) + '</td>').join('') + '</tr>';
  return '<div style="overflow-x:auto;"><table class="rt-tb"><tr><th></th>' + filas.map((s, i) => '<th style="max-width:96px;white-space:normal;text-transform:none;">' + esc(s.nombre) + (i ? ' <a href="#" onclick="RENT.escDel2(' + (i - 1) + ');return false" style="color:var(--red);">✕</a>' : '') + '</th>').join('') + '</tr>'
    + f('Coste de personal', s => s.costePers + s.retrib ? '<b>' + cR(eur(s.costePers + s.retrib)) + '</b>' : '—') + f('Se podría producir', s => h1(s.capacidad) + ' h') + f('Beneficio neto con las horas de hoy', s => '<b>' + cs(s.netAseg, eur(s.netAseg)) + '</b>') + f('Beneficio neto a ' + h1(num(R.param.horasDia) || 6) + ' h al día', s => '<b>' + cs(s.netPot, eur(s.netPot)) + '</b>') + f('Trabajo de Rafa y Manolo', s => cs(hoy.tr.total - s.tr.total, h1(s.tr.total) + ' h')) + '</table></div>';
};
// V10.40 (Daniel): coste de oportunidad = horas que se podían haber echado (7 h operativas por persona y día, lunes a viernes, mientras duró la obra) menos las que se echaron; cada día cuenta por separado
R.perdidas = function(r, personas, margenH, carga){
  const pot = (num(R.param.horasDia) || 6) * personas, mH = r.H > 0 ? r.ejecutado / r.H : NaN;   // V10.85 (Daniel): solo cuenta la obra elegida; las horas perdidas valen lo que esta obra da por hora operativa, nunca el margen de otras obras
   let dLab = 0, hPerd = 0, dFlojos = 0, dVacios = 0;
  for(let f = r.desde; f <= r.hasta; f = addDays(f, 1)){ const dow = new Date(f + 'T12:00:00').getDay(); if(dow === 0 || dow === 6) continue; dLab++; const h = r.hDia[f] || 0, p = Math.max(0, pot - h); hPerd += p; if(!h) dVacios++; else if(p > 0) dFlojos++; }
  carga = 0;   // V10.51 (Daniel): de 8 h de jornada, 1 h se reserva a mantenimiento/reparaciones/preparativos: las 7 h operativas ya la excluyen
  const dTr = Object.keys(r.hDia).length, tope = R.param.diasTope || {}, dT = Object.keys(r.hDia).filter(f => tope[f]), hTope = sum(dT, f => r.hDia[f] || 0); hPerd = Math.max(0, pot * (dTr - dT.length) - (r.H - hTope));   // V11.72 (Daniel): los días con tope (inspección de trabajo) se trabajó lo máximo posible: no cuentan como desaprovechados   // V10.55 (Daniel): solo cuentan los días trabajados en esta obra; los demás días de su periodo pudieron ser de otra obra
  return {pot, personas, carga, dLab, hPerd, diasTope: dT.length, dEq: pot > 0 ? hPerd / pot : 0, dFlojos, dVacios, dinero: isFinite(mH) ? hPerd * mH : NaN, margenH: mH};
};
R.opHtml = function(r, personas, margenH, socios, carga, quien){
  quien = quien || 'Rafa y Manolo';
  const x = R.perdidas(r, personas, margenH, carga), tl = (t, v, col, sub) => '<div class="rt-tl"><span>' + t + '</span><b style="color:' + col + ';">' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  const como = '<div style="font-size:11.5px;color:var(--ink-soft);line-height:1.5;padding:4px 0 2px;"><b>Valor:</b> horas operativas desaprovechadas × ' + (isFinite(x.margenH) ? eur(x.margenH, 2) : '—') + '/h: lo que habrían dado trabajadas en otra obra al ritmo de esta (lo que esta obra da por hora operativa). <b>Coste real:</b> lo que ' + (quien.indexOf(' y ') > 0 ? 'cobran ' : 'cobra ') + quien + ' + ese valor.</div>';
  if(!isFinite(x.dinero)) return '';
  return '<div class="rt-g3">' + tl('Valor de ' + h1(x.hPerd) + ' h en otra obra', eur(x.dinero), '#c0392b') + (socios > 0 ? tl('Salario de ' + quien, eur(socios), 'var(--ink)') + tl('Coste real', eur(socios + x.dinero), '#c0392b', eur((socios + x.dinero) / Math.max(1, r.H), 2) + ' por hora') : '') + '</div>'
    + '<details><summary style="font-size:11.5px;color:var(--orange);font-weight:700;cursor:pointer;">Cómo se calcula</summary>' + como + '</details>';
};
R.datosReales = function(r, b){   // V10.51 (Daniel): datos reales sobre la hora, arriba de todo
  const e = R.build2, cmP = num(R.param.condMecPct) / 100 || 0, pers = (2 - (e.rafa === 'fuera' ? 1 : 0) - (e.manolo === 'fuera' ? 1 : 0)) + (e.maq | 0) + (e.cm | 0) * cmP;
  const x = R.perdidas(r, pers, b.margenH, 0), dTr = Object.keys(r.hDia).length, dSab = Object.keys(r.hDia).filter(f => new Date(f + 'T12:00:00').getDay() === 6).length, dDom = Object.keys(r.hDia).filter(f => new Date(f + 'T12:00:00').getDay() === 0).length, dFin = dSab + dDom, media = dTr ? r.H / dTr : NaN, dEmp = x.pot > 0 ? r.H / x.pot : NaN;
  const f = (t, v, col, sub) => '<div class="rt-sim-r"><span>' + t + (sub ? '<small style="display:block;color:var(--ink-soft);font-size:10.5px;">' + sub + '</small>' : '') + '</span><b style="white-space:nowrap;' + (col ? 'color:' + col + ';' : '') + '">' + v + '</b></div>';
  const mq = (r.maq || []).slice().sort((a, c2) => c2.horas - a.horas);
  const hO = num(R.param.horasDia) || 6;   // V11.40 (reporte 939a652d): selector de media en media hora, máximo 8; el resto de la jornada de 8 h es reserva
  return '<div class="rt-c"><h3>Datos reales</h3><div class="rt-stw"><div class="rt-fila-t" style="cursor:default;"><div style="font-size:12.5px;padding:6px 0;">Horas operativas al día<small style="display:block;color:var(--ink-soft);font-size:10.5px;">Reserva ' + h1(8 - hO) + ' h para mantenimiento, reparaciones e incidencias</small></div><span class="rt-st" style="margin-left:auto;flex:none;"><button type="button" onclick="RENT.stepHoras(-0.5)">−</button><b style="min-width:42px;text-align:center;white-space:nowrap;">' + h1(hO) + ' h</b><button type="button" onclick="RENT.stepHoras(0.5)">+</button></span></div></div>'
    + f('Días de la obra (L-V)', x.dLab) + f('Días trabajados' + (dFin ? ' (' + [dSab ? dSab + (dSab === 1 ? ' sáb' : ' sáb') : '', dDom ? dDom + ' dom' : ''].filter(Boolean).join(' y ') + ')' : ''), dTr) + f('Días laborables no trabajados', x.dVacios) + f('Horas operativas trabajadas', h1(r.H) + ' h') + f('Media: ' + h1(r.H) + ' h ÷ ' + dTr + ' días trabajados', isFinite(media) ? h1(media) + ' h/día' : '—')
    + f('€/h operativas (ingreso ÷ horas)', r.H > 0 ? eur(r.ejecutado / r.H, 2) : '—', G)
    + f('€/día operativo (ingreso ÷ días trabajados)', dTr > 0 ? eur(r.ejecutado / dTr) : '—', G)
    + f('Duración ideal (' + h1(hO) + ' h/día × empleado)', isFinite(dEmp) ? h1(dEmp) + ' días' : '—', G)
    + f('Días operativos desaprovechados', h1(x.dEq) + ' días', '#c58a1b') + f('Horas operativas desaprovechadas', h1(x.hPerd) + ' h', '#c58a1b', x.diasTope ? 'Sin ' + x.diasTope + (x.diasTope === 1 ? ' día' : ' días') + ' de inspección de trabajo (no se podía más)' : '') + f('Valor de las horas perdidas', isFinite(x.dinero) ? eur(x.dinero) : '—', '#c0392b', h1(x.hPerd) + ' h × ' + (isFinite(x.margenH) ? eur(x.margenH, 2) : '—') + '/h en otra obra') + f('H/día operativas desaprovechadas · ' + h1(x.pot) + ' − ' + (isFinite(media) ? h1(media) : '—'), isFinite(media) ? h1(Math.max(0, x.pot - media)) + ' h/día' : '—', '#c58a1b')
    + f('Empleados', h1(x.personas))
    + R.salariosReales(r)
    + f('Maquinaria usada', mq.length)
    + (mq.length ? '<div style="font-weight:800;font-size:12.5px;margin:4px 0 0;">Horas por máquina</div>' + mq.map(m => f(esc(m.nombre), h1(m.horas) + ' h · ' + m.dias + ' días')).join('') : '')
    + '</div>';
};
// V11.64 (Daniel 14/10/2026): lo que cobra cada socio y lo que cuesta de verdad: lo que cobra más las horas que se perdieron en la obra (coste de oportunidad). V11.70: sin la cuota de autónomos, que es de la empresa
R.salarioSocio = function(r, k){   // la misma cuenta en Datos reales y en el simulador
  const SA = r.socAnual || {}, dLab = r.dLab || num(R.param.jornadas) || 250, Dq = Math.max(1, r.Dq || r.D || 1), xr = R.perdidas(r, 2, NaN, 0), mesDias = dLab / 12;
  const anual = num(SA[k]), sal = anual / dLab * Dq, ss = 0, perd = isFinite(xr.dinero) ? xr.dinero / 2 : 0, coste = sal + perd, hT = r.H / 2;   // V11.70 (Daniel): la cuota de autónomos es gasto de la empresa, no de la persona
  const cobMes = anual / 12; return {xr, sal, ss, perd, coste, hT, cobMes, costeMes: coste / Dq * mesDias, cobH: cobMes / (8 * mesDias), costeH: hT > 0 ? coste / hT : NaN};
};
R.salariosReales = function(r){
  const SA = r.socAnual; if(!SA || !(r.H > 0)) return '';
  const dLab = r.dLab || num(R.param.jornadas) || 250, Dq = Math.max(1, r.Dq || r.D || 1), xr = R.perdidas(r, 2, NaN, 0), mesDias = dLab / 12;
  const sr = (a, b2, c, sub) => '<div class="rt-sim-r"><span>' + a + (sub ? '<small style="display:block;color:var(--ink-soft);font-size:10.5px;">' + sub + '</small>' : '') + '</span><b style="white-space:nowrap;' + (c ? 'color:' + c + ';' : '') + '">' + b2 + '</b></div>';
  const uno = (k, nom) => { const {sal, ss, perd, coste, hT, cobMes, costeMes, cobH, costeH} = R.salarioSocio(r, k);
    return '<details class="rt-nd"><summary><div class="rt-sim-r"><span style="flex:1;min-width:0;font-weight:700;">Salario ' + nom + '<small style="display:block;color:var(--ink-soft);font-size:10.5px;font-weight:400;">Cobra ' + eur(cobH, 2) + '/h · coste real ' + eur(costeH, 2) + '/h</small></span><span style="text-align:right;white-space:nowrap;"><b>' + eur(cobMes) + '/mes</b><small style="display:block;font-size:10.5px;font-weight:700;color:' + RJ + ';">Coste ' + eur(costeMes) + '/mes</small></span></div></summary><div class="rt-bd">'
      + sr('Cobra al mes', eur(cobMes), null, 'Retiradas y gastos personales de los últimos 12 meses ÷ 12') + sr('Coste real al mes', eur(costeMes), RJ) + sr('Cobra por hora', eur(cobH, 2) + '/h', null, '8 h al día, de lunes a viernes') + sr('Coste real por hora', isFinite(costeH) ? eur(costeH, 2) + '/h' : '—', RJ, 'Por cada hora que de verdad se facturó (' + h1(hT) + ' h, su mitad)')
      + '<div style="font-weight:800;font-size:12px;margin:6px 0 2px;">En esta obra</div>' + sr('Lo que cobra', eur(sal)) + sr('Horas perdidas (su mitad)', eur(perd), RJ, h1(xr.hPerd / 2) + ' h × ' + (isFinite(xr.margenH) ? eur(xr.margenH, 2) : '—') + '/h') + sr('Coste real', eur(coste), RJ)
      + '<div class="rt-ldx">Sus retiradas no desgravan. Lo que no dice de quién es se reparte a medias.</div></div></details>'; };
  return '<div style="font-weight:800;font-size:12.5px;margin:6px 0 0;">Rafa y Manolo</div>' + uno('rafa', 'Rafa') + uno('manolo', 'Manolo');
};
R.baseObra = function(r, b){   // V10.38 (Daniel): el simulador parte de la obra elegida (su trabajo hecho, horas y costes), no de toda la empresa
  if(!r || r.vacio) return b;
  const hc = r.hClase || {}, jornadas = Math.max(1, r.D);
  return Object.assign({}, b, {anual: {ingresos: b.ingresos, backlog: b.backlog, nBack: b.nBack}, obra: true, r, margenH: r.H > 0 ? r.ejecutado / r.H : NaN, ingresos: r.ejecutado, horas: r.H, dias: r.D, jornadas: R.perdidas(r, 1, NaN).dLab || jornadas, semanas: Math.max(1, (R.perdidas(r, 1, NaN).dLab || r.D) / 5), maquinas: Math.max(1, (r.maq || []).length), costesOp: r.directo + r.indirecto, socios: r.socios.valor, beneficio: r.bAntesSocios, taller: sum((r.lineasD || []).filter(x => /aver|repar|taller/i.test(x.label || '')), x => x.valor), backlog: 0, ev: {horas: r.H, dias: r.D, horasClase: hc, horasDia: {}}});
};
R.simHtml = function(P, b){
  const bd = R.build2, s = R.simular2(b, bd), hs = R.horasSocios(b), hoy = R.simular2(b, R.ESC2, true);   // V11.64: «hoy» = Rafa y Manolo con sus retiradas, a las mismas horas de referencia
  const seg = k => '<div class="rt-seg"><button type="button" class="' + (bd[k] === 'fuera' ? '' : 'on') + '" onclick="RENT.setEsc2(\'' + k + '\',\'hoy\')">' + (bd[k] === 'fuera' ? 'Fuera' : '✓ Trabaja') + '</button></div>';   // V10.66 (Daniel): un solo botón por persona; contratar se hace con Maquinistas
  const persSim = (2 - (s.e.rafa === 'fuera' ? 1 : 0) - (s.e.manolo === 'fuera' ? 1 : 0)) + (s.e.maq | 0) + (s.e.cm | 0) * (num(R.param.condMecPct) / 100 || 0);
  const xOp = b.obra && b.r ? R.perdidas(b.r, persSim, b.margenH, s.tr.rep + s.tr.ges) : null;
  const quedan = ['rafa', 'manolo'].filter(k => s.e[k] === 'hoy'), sociosSim = s.obra ? s.retrib : b.socios * quedan.length / 2, quienSim = quedan.map(k => k === 'rafa' ? 'Rafa' : 'Manolo').join(' y ');   // V10.57 (Daniel): si uno sale (o pasa a empleado), se descuenta lo suyo
  const opSim = b.obra && b.r ? R.opHtml(b.r, persSim, b.margenH, sociosSim, s.tr.rep + s.tr.ges, quienSim || undefined) : '';
  const pagoHr = (b.horas + hs.rep + hs.ges) > 0 ? b.socios / (b.horas + hs.rep + hs.ges) : NaN, cMaqH = coste('maquinista');
  const cobH = k => { const m = bd[k]; if(k === 'manolo' && m === 'hoy'){ const v = isFinite(cMaqH) ? cMaqH / ((num(R.param.horasDia) || 6) * (num(R.param.jornadas) || 250)) : NaN; return isFinite(v) ? '<small style="color:var(--ink-soft);font-size:11px;text-align:right;line-height:1.35;"><span style="display:block;white-space:nowrap;">Nómina ' + eur(v, 2) + '/h</span><span style="display:block;white-space:nowrap;">Desgrava</span></small>' : ''; } if(k === 'rafa' && m === 'hoy'){ const v = R.rafaSim() / ((num(R.param.horasDia) || 6) * (num(R.param.jornadas) || 250)); return isFinite(v) ? '<small style="color:var(--ink-soft);font-size:11px;text-align:right;line-height:1.35;"><span style="display:block;white-space:nowrap;">Retira ' + eur(v, 2) + '/h</span><span style="display:block;white-space:nowrap;">No desgrava</span></small>' : ''; } const v = m === 'hoy' ? pagoHr : m === 'empleado' ? (isFinite(cMaqH) ? cMaqH / (((num(R.param.horasDia) || 6)) * (num(R.param.jornadas) || 250)) : NaN) : NaN; return isFinite(v) ? '<small style="color:var(--ink-soft);font-size:11px;text-align:right;line-height:1.35;"><span style="display:block;white-space:nowrap;">' + (m === 'hoy' ? 'Salario ' : 'Cobra ') + eur(v, 2) + '/h</span>' + (m === 'hoy' && xOp && isFinite(xOp.dinero) && (b.horas + hs.rep + hs.ges) > 0 ? '<span style="display:block;white-space:nowrap;">Coste ' + eur((b.socios + xOp.dinero) / Math.max(1, b.horas), 2) + '/h</span>' : '') + '</small>' : ''; };   // V11.47 (reporte 40b25d21): «es salario y lo otro es coste»; una cosa por línea
  const infPuesto = k => { try{ return convenioSueldoInfo(R.PUESTO[k] || 'maquinista'); }catch(e){ return null; } };
  const tasaImp = (num(R.param.impuesto) || 0) / 100, hAnio = (num(R.param.horasDia) || 6) * (num(R.param.jornadas) || 250);
  const trasDedH = k => { const inf = infPuesto(k); return inf && inf.coste > 0 ? inf.coste / hAnio * (1 - tasaImp) : NaN; };   // V11.24 (Daniel, reporte ecec04fa): coste tras deducir por hora, también en la fila del puesto
  const ganaLibre = k => {   // V11.24 (Daniel): lo que se gana en otra obra con los días que libera una persona más de este puesto (al ritmo de hoy)
    if(!s.obra || !isFinite(b.margenH)) return NaN;
    const n = bd[k] | 0, con = Object.assign({}, bd, {[k]: Math.max(1, n)}), sin = Object.assign({}, bd, {[k]: Math.max(1, n) - 1});
    try{ const dias = Math.max(0, R.simular2(b, sin).c1.d - R.simular2(b, con).c1.d); return dias * (num(R.param.horasDia) || 6) * b.margenH; }catch(e){ return NaN; }   // V11.25 (Daniel): solo las horas del propio puesto en los días que se acaba antes, no las de Rafa y Manolo
  };
  const st = (k, t) => '<div class="rt-stw"><div class="rt-fila-t" onclick="RENT.setFicha(\'' + k + '\')"><div style="font-size:12.5px;padding:6px 0;">' + t + '</div>' + (isFinite(trasDedH(k)) ? '<small style="color:var(--ink-soft);font-size:11px;white-space:nowrap;margin-left:auto;margin-right:10px;">' + eur(trasDedH(k), 2) + '/h</small>' : '') + '<span class="rt-st" onclick="event.stopPropagation()"><button type="button" onclick="RENT.stepEsc2(\'' + k + '\',-1)">−</button><b>' + bd[k] + '</b><button type="button" onclick="RENT.stepEsc2(\'' + k + '\',1)">+</button></span></div>' + fichaDe(k) + '</div>';   // V11.06 (Daniel): sin pastilla; al pulsar el puesto se despliega su ficha ahí mismo
  const pp = (k, n) => '<div class="rt-pl rt-fila-t" onclick="RENT.setFicha(\'' + k + '\')"><button type="button" class="' + (bd[k] === 'fuera' ? '' : 'on') + '" onclick="event.stopPropagation();RENT.setEsc2(\'' + k + '\',\'hoy\')">' + n + '</button>' + (cobH(k) || '') + '</div>';   // V10.67: el nombre es la pastilla
  // V11.00 (Daniel 12/10/2026): al pulsar «cobra…» de Rafa o Manolo, o el nombre de un puesto, sale su ficha: neto, bruto, coste para la empresa y coste tras deducirlo como gasto
  const fichaDe = k => {
    if(R.ficha !== k || (bd[k] === 'fuera')) return '';
    const tasa = (num(R.param.impuesto) || 0) / 100, horasT = Math.max(1, b.horas), hDia = num(R.param.horasDia) || 6, jor = num(R.param.jornadas) || 250;
    const fr = (t, tot, hh, nota) => '<div class="rt-sim-r"><span style="flex:1;min-width:0;">' + t + (nota ? '<small style="display:block;color:var(--ink-soft);font-size:10px;">' + nota + '</small>' : '') + '</span><b style="white-space:nowrap;">' + (isFinite(tot) ? eur(tot) : '—') + (isFinite(hh) ? ' <span style="font-size:.78em;color:var(--ink-soft);font-weight:700;">· ' + eur(hh, 2) + '/h</span>' : '') + '</b></div>';
    let tit, filas, pie = '';
    if(k === 'rafa'){
      const an = R.rafaSim(), hAn = (num(R.param.horasDia) || 6) * (num(R.param.jornadas) || 250);
      tit = 'Rafa (lo de dos maquinistas)';
      filas = fr('Al año', an, an / hAn, '2 × sueldo bruto de convenio de maquinista') + fr('Al mes', an / 12, NaN) + fr('En esta obra', an / hAn * Math.max(1, b.horas / 2), NaN, 'Su mitad de las horas de la obra');
      pie = 'Se lo lleva en retiradas: sin nómina ni Seguridad Social, cuenta entero y no baja los impuestos.';
    } else {
      const cat = k === 'manolo' ? 'maquinista' : R.PUESTO[k], nom = {manolo: 'Manolo en nómina (convenio de maquinista)', maq: 'Maquinista', cam: 'Camionero', mec: 'Mecánico', cm: 'Conductor/mecánico'}[k], inf = (() => { try{ return convenioSueldoInfo(cat); }catch(e){ return null; } })();
      if(!inf || !(inf.bruto > 0)) return '<div class="rt-an" style="margin-top:6px;">' + nom + ': falta el sueldo de convenio para sacar su ficha.</div>';
      const ph = x => x / (hDia * jor), tl = x => ph(x) * horasT;
      tit = k === 'manolo' ? nom : nom + ' (por persona)';
      // V11.15 (Daniel): su salario al mes por convenio, sin depender de la obra, antes de lo de la obra
      filas = fr('Salario neto al mes', inf.neto / 14, NaN) + fr('Salario bruto al mes', inf.bruto / 14, NaN) + fr('Coste para la empresa al mes', inf.coste / 12, NaN) + fr('Coste al mes tras deducir', inf.coste / 12 * (1 - tasa), NaN, 'baja ' + Math.round(tasa * 100) + ' % por impuestos')
        + fr('Salario neto en la obra', tl(inf.neto), ph(inf.neto)) + fr('Salario bruto en la obra', tl(inf.bruto), ph(inf.bruto)) + fr('Coste para la empresa en la obra', tl(inf.coste), ph(inf.coste), 'bruto + Seguridad Social de empresa') + fr('Coste tras deducir en la obra', tl(inf.coste) * (1 - tasa), ph(inf.coste) * (1 - tasa), 'baja ' + Math.round(tasa * 100) + ' % por impuestos')
        + (k === 'manolo' ? '' : (() => { const g = ganaLibre(k), cf = tl(inf.coste) * (1 - tasa) - g; return isFinite(g) ? fr('Coste final', cf, cf / horasT, 'menos ' + eur(g) + ': sus ' + h1(g / (b.margenH * (num(R.param.horasDia) || 6))) + ' días libres en otra obra') : ''; })());
      pie = 'Convenio de construcción, jornada completa, 14 pagas: el neto y el bruto al mes son de cada nómina y el coste de empresa es el del año repartido en 12 meses. En la obra: €/h × ' + h1(horasT) + ' h.';
    }
    return '<div class="rt-c" style="margin:6px 0 8px;background:var(--paper);border:2px solid var(--orange);"><div style="font-weight:800;font-size:13px;margin-bottom:4px;">' + tit + '</div>' + filas + '<div style="font-size:10.5px;color:var(--ink-soft);margin-top:4px;">' + pie + '</div></div>';
  };
  const controles = '<div class="rt-pw">' + pp('rafa', 'Rafa') + fichaDe('rafa') + pp('manolo', 'Manolo') + fichaDe('manolo') + '</div>' + '<div class="rt-stg">' + st('maq', 'Maquinistas') + st('cam', 'Camioneros') + st('mec', 'Mecánicos') + st('cm', 'Conduc./mecánico') + '</div>';   // V11.64: sin el cuadro de horas perdidas: ya va en Datos reales (coste real de cada uno) y en «Horas sin trabajo» del año
  const bx = (t, v, d, n, hh) => '<div class="' + (n >= 0 ? 'g' : 'r') + '"><span style="color:' + (n >= 0 ? G : RJ) + ';">' + t + '</span><b style="color:' + (n >= 0 ? G : RJ) + ';">' + eur(n) + '</b><small>' + hh + ' · ' + cs(d, dEur(d)) + ' vs hoy</small></div>';
  const costeNuevo = s.costePers + s.retrib - (s.obra ? hoy.costePers + hoy.retrib : b.socios);
  const tl2 = (l, v) => '<div class="rt-tl"><span>' + l + '</span><b>' + v + '</b></div>';
  // V11.64 (Daniel 14/10/2026): una sola cuenta a las horas de referencia; debajo, el año entero con la previsión de trabajo y el punto de equilibrio
  const res = '<div class="rt-big">' + bx('Esta obra en ' + h1(s.d2) + ' días a ' + h1(num(R.param.horasDia) || 6) + ' h/día', s.benPot, s.netPot - hoy.netPot, s.netPot, h1(s.capacidad) + ' h') + '</div>'
    + '<div class="rt-g3">' + tl2('Coste de personal vs hoy', costeNuevo > 0 ? cR('+' + eur(costeNuevo)) : costeNuevo < 0 ? cG(eur(costeNuevo)) : '0 €') + tl2('Trabajo Rafa y Manolo', cs(hoy.tr.total - s.tr.total, h1(s.tr.total) + ' h')) + (s.ahorro ? tl2('Ahorro taller (est.)', cG(eur(s.ahorro))) : '') + '</div>'
    + (s.obra ? R.anioHtml(P, b, bd) : '');
  const cuentas = s.obra ? (() => { const r = b.r, c1 = s.c1, c2 = s.c2, fx = (t, f1, f2, neg) => '<tr><td>' + t + '</td><td>' + f1 + '</td><td>' + f2 + '</td></tr>', m = v => v ? cR('− ' + eur(v)) : '—', p = v => v ? cG('+ ' + eur(v)) : '—';
    return '<table class="rt-tb"><tr><th>Cuenta de la obra</th><th>' + h1(c1.d) + ' días</th><th>' + h1(c2.d) + ' días</th></tr>'
      + fx('Ingresos (trabajo hecho)', eur(s.horasAseg ? r.ejecutado : 0), eur(s.horasAseg ? r.ejecutado : 0)) + fx('− Directos y fijos de máquina', m(s.horasAseg ? r.ejecutado - b.beneficio - sum(r.lineasI.filter(x => /^gen:/.test(x.clave)), x => x.valor) : 0), m(s.horasAseg ? r.ejecutado - b.beneficio - sum(r.lineasI.filter(x => /^gen:/.test(x.clave)), x => x.valor) : 0))
      + fx('− Generales (gestoría, estructura, SS…) por días', m(s.horasAseg ? c1.gen : 0), m(s.horasAseg ? c2.gen : 0)) + fx('− Rafa y Manolo por días', m(c1.soc), m(c2.soc)) + fx('− Sueldos contratados por días', m(c1.sal), m(c2.sal))
      + (s.ahorro ? fx('+ Ahorro en taller (estimado)', p(s.ahorro), p(s.ahorro)) : '') + fx('+ Días libres en otra obra', p(c1.libre * (isFinite(b.margenH) ? b.margenH : 0)) + (c1.libre ? ' <small>(' + h1(c1.libre) + ' h)</small>' : ''), p(c2.libre * (isFinite(b.margenH) ? b.margenH : 0)) + (c2.libre ? ' <small>(' + h1(c2.libre) + ' h)</small>' : ''))
      + fx('<b>Antes de impuestos</b>', '<b>' + eur(c1.ben) + '</b>', '<b>' + eur(c2.ben) + '</b>') + fx('− Impuestos (' + R.param.impuesto + ' %; lo de Rafa y Manolo no desgrava)', m(c1.imp), m(c2.imp)) + fx('<b>Neto</b>', '<b>' + cs(c1.net, eur(c1.net)) + '</b>', '<b>' + cs(c2.net, eur(c2.net)) + '</b>') + '</table>'; })() : '';
  const comp = (P.esc2 || []).length ? '<div class="rt-c"><h3>Comparar</h3>' + R.escHtml2(b, P.esc2) + '</div>' : '';
  const act = (n, a, c) => '<tr><td>' + n + '</td><td>' + h1(a) + ' h</td><td>' + cs(a - c, h1(c) + ' h') + '</td></tr>';
  const detalle = det('Ver detalle', '<div>' + cuentas + '<table class="rt-tb"><tr><th>Rafa y Manolo, al año</th><th>Hoy</th><th>Con esto</th></tr>' + act('Manejar máquinas', hs.maq, s.tr.maq) + act('Conducir', hs.cond, s.tr.cond) + act('Reparar', hs.rep, s.tr.rep) + act('Gestionar la empresa', hs.ges, s.tr.ges) + '<tr style="font-weight:800;"><td>Total</td><td>' + h1(hs.total) + ' h</td><td>' + cs(hs.total - s.tr.total, h1(s.tr.total) + ' h') + '</td></tr></table>'
    + '<div style="font-size:11.5px;color:var(--ink-soft);margin:6px 0;">Hoy trabajan de media ' + h1(hs.porDia) + ' h de máquina por día de trabajo, de 16 posibles (8 h cada uno, lunes a viernes). Manejar y conducir salen de las horas de los albaranes (12 meses); reparar y gestionar son horas por semana de Hipótesis.</div>'
    + '<div class="rt-sim-r"><span>Ingreso extra posible ' + kg + '</span><b>' + cG(eur(s.ingPot)) + '</b></div><div class="rt-sim-r"><span>Para cubrir el coste nuevo habría que facturar</span><b>' + (s.eqH > 0 && isFinite(s.eqH) ? h1(s.eqH) + ' h ≈ ' + cG(eur(s.eqFact)) + ' al año' : '—') + '</b></div>'
    + '<div class="rt-sim-r"><span>Trabajos pendientes ya conocidos</span><b>' + (b.backlog ? h1(b.backlog) + ' h en ' + b.nBack + ' trabajos' : '—') + '</b></div>'
    + (s.notas.length ? s.notas.map(n => '<div class="rt-an">• ' + esc(n) + '</div>').join('') : '')
    + (b.obra ? '<div style="font-size:11.5px;color:var(--ink-soft);margin:8px 0;"><b>Cómo se calcula.</b> Se hacen las mismas ' + h1(b.r.H) + ' h de esta obra con la gente elegida. <b>Al ritmo de hoy:</b> Rafa y Manolo echan sus horas reales por día; contratados y «empleado», ' + h1(num(R.param.horasDia) || 6) + ' h. <b>A ' + h1(num(R.param.horasDia) || 6) + ' h/día:</b> todos ' + h1(num(R.param.horasDia) || 6) + ' h, y las horas que sobran de los ' + s.Dtr + ' días reales se trabajan en otra obra al ritmo de esta, lo que da por hora operativa (' + (isFinite(b.margenH) ? eur(b.margenH, 2) : '—') + '/h). Los ingresos, los directos y los fijos de máquina no cambian (son las mismas horas). Cambian con los días: gastos generales, lo que cuestan Rafa y Manolo (su parte por día) y los sueldos de convenio (÷ ' + (num(R.param.jornadas) || 250) + ' jornadas del año). Impuestos: ' + R.param.impuesto + ' % del beneficio sin restar lo de Rafa y Manolo (no desgrava); los sueldos sí desgravan.</div>' : '')
    + (b.obra ? '' : '<div style="font-size:11.5px;color:var(--ink-soft);margin:8px 0;"><b>Cómo se calcula.</b> Asegurado: las horas que ya se facturan hoy (o menos, si falta gente), más los ahorros, menos el coste de personal. Si se ocupa todo: igual, pero facturando las horas que cabrían, a lo que deja cada hora hoy. No se limita por falta de trabajo. Los sueldos salen del convenio. El empleado trabaja 8 h, lunes a viernes, menos el tiempo de reparar y gestionar. El mecánico no suma horas de máquina: quita reparaciones externas, paradas y trabajo físico a Rafa y Manolo. Los ahorros son estimaciones de Hipótesis.</div>')
    + R.hipHtml(P) + '</div>');
  // V11.02 (Daniel): Organización y «Como hoy» eran dos tarjetas de una misma simulación: una sola, «Simulación», con una cosa por línea
  const cabSim = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><h3 style="margin:0;">Simulación</h3><span class="rt-ch" style="margin:0;"><button type="button" onclick="RENT.escAdd2()">Guardar</button></span></div>'; // V11.10 (Daniel): sin la línea «Rafa fuera, Manolo fuera»: ya lo dicen las casillas
  return '<div class="rt-c">' + cabSim + controles + res + detalle + '</div>' + comp;
};
R.anioHtml = function(P, b, e){
  const A = R.simAnio(P, b, e), H0 = R.simAnio(P, b, R.ESC2, true); if(!A || !H0) return '';
  const p1 = v => isFinite(v) ? (Math.round(v * 10) / 10).toLocaleString('es-ES', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' %' : 'sin dato';
  const dif = (v, v0, fmt, mejorMenos) => { const d = v - v0; if(!isFinite(d) || Math.abs(d) < 0.5) return 'igual que hoy'; const bueno = mejorMenos ? d < 0 : d > 0; return '<span style="color:' + (bueno ? G : RJ) + ';">' + (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + ' vs hoy</span>'; };
  const L = (t, v, v0, fmt, c, mejorMenos, sub) => '<div class="rt-sim-r"><span style="flex:1;min-width:0;">' + t + (sub ? '<small style="display:block;color:var(--ink-soft);font-size:10.5px;">' + sub + '</small>' : '') + '</span><span style="text-align:right;white-space:nowrap;"><b' + (c ? ' style="color:' + c + ';"' : '') + '>' + fmt(v) + '</b><small style="display:block;font-size:10.5px;font-weight:700;">' + dif(v, v0, fmt, mejorMenos) + '</small></span></div>';
  const hh = v => h1(v) + ' h', ee = v => eur(v), pp = v => p1(v);
  const lin = L('Trabajo previsto al año', A.Dh, H0.Dh, hh, null, false, 'Ingresos de 12 meses ÷ ' + eur(b.r.ejecutado / b.r.H, 2) + '/h de esta obra' + (num((b.anual || {}).backlog) ? ' + ' + h1(b.anual.backlog) + ' h pendientes' : ''))
    + L('Se podría hacer', A.Cap, H0.Cap, hh, null, false, 'Con esta gente a ' + h1(num(R.param.horasDia) || 6) + ' h/día, menos averías y paradas') + L('Se trabajaría', A.S, H0.S, hh, G) + L('Horas sin trabajo', A.libres, H0.libres, hh, A.libres > 0.5 ? RJ : null, true, 'Gente pagada sin obra porque no queda trabajo')
    + L('Ingresos', A.ing, H0.ing, ee, G) + L('Coste de máquinas', A.varC, H0.varC, ee, RJ, true, 'Combustible, averías y fijos') + L('Gastos generales', A.F, H0.F, ee, RJ, true, 'Gestoría, estructura, autónomos y SS, coches')
    + L('Nóminas', A.nominas, H0.nominas, ee, RJ, true, A.manNom ? 'Incluye a Manolo: ' + eur(A.manNom) + ' (desgrava)' : 'Desgravan') + L('Retiradas', A.ret, H0.ret, ee, RJ, true, (A.manRet ? 'Rafa y Manolo, lo de hoy' : 'Rafa, lo de dos maquinistas') + ': no desgravan') + (A.ahorro ? L('Ahorro en taller (est.)', A.ahorro, H0.ahorro, ee, G) : '')
    + L('Impuestos', A.imp, H0.imp, ee, RJ, true) + L('<b>Limpio al año</b>', A.net, H0.net, ee, col(A.net)) + L('Margen neto', A.margen, H0.margen, pp, col(A.margen)) + L('Rentabilidad sobre lo invertido', A.roa, H0.roa, pp, isFinite(A.roa) ? col(A.roa) : null, false, 'Sobre ' + eur(A.inv) + ' de las máquinas (Valor flota)');
  const eqs = [['maq', 'Maquinistas'], ['cam', 'Camioneros']].map(([k, n]) => { const q = R.equilibrio(P, b, e, k); if(!q) return '';
    const sub = q.fil.slice(0, Math.min(q.fil.length, q.best.n + 3)).map(x => '<div class="rt-sim-r"><span>' + x.n + ' ' + n.toLowerCase() + (x.n === q.best.n ? ' (lo que más deja)' : '') + '<small style="display:block;color:var(--ink-soft);font-size:10.5px;">' + h1(x.libres) + ' h sin trabajo al año</small></span><b style="color:' + col(x.net) + ';">' + eur(x.net) + '</b></div>').join('');
    const sig = q.fil[q.best.n + 1];
    return '<details class="rt-nd"><summary><div class="rt-sim-r"><span style="flex:1;min-width:0;font-weight:700;">' + n + ' que más dejan<small style="display:block;color:var(--ink-soft);font-size:10.5px;font-weight:400;">' + (sig ? 'Con uno más: ' + eur(sig.net - q.best.net) + ' al año' : '') + '</small></span><b>' + q.best.n + '</b></div></summary><div class="rt-bd">' + sub + '</div></details>'; }).join('');
  const meses = '<details class="rt-nd"><summary><div class="rt-sim-r"><span style="flex:1;min-width:0;font-weight:700;">Trabajo por meses<small style="display:block;color:var(--ink-soft);font-size:10.5px;font-weight:400;">' + (R.estacion(P).fuente === 'lineas' ? 'Por las fechas de las líneas de máquina y camión' : 'Por las facturas de 5 años') + '</small></span><b>' + hh(A.S) + '</b></div></summary><div class="rt-bd">' + A.meses.map(m => '<div class="rt-sim-r"><span>' + m.mes + '<small style="display:block;color:var(--ink-soft);font-size:10.5px;">' + h1(m.cola) + ' h por hacer · ' + h1(m.cap) + ' h posibles' + (isFinite(m.diasTrab) ? ' · ' + h1(m.diasTrab) + ' días con trabajo' : '') + '</small></span><b' + (m.cap - m.hechas > 0.5 ? ' style="color:' + RJ + ';"' : '') + '>' + hh(m.hechas) + '</b></div>').join('') + '</div></details>';
  return '<div style="font-weight:800;font-size:13px;margin:12px 0 4px;">Al año con esta gente</div>' + lin + '<div style="font-weight:800;font-size:13px;margin:12px 0 4px;">Punto de equilibrio</div>' + eqs + meses
    + '<div style="font-size:11px;color:var(--ink-soft);margin-top:6px;">Cada hora vale lo que esta obra: ' + eur(b.r.ejecutado / b.r.H, 2) + '/h de ingreso y su coste de máquina por hora. ' + (R.estacion(P).fuente === 'lineas' ? 'El trabajo de cada mes sale de las fechas de las líneas de máquina y camión de los documentos (' + R.estacion(P).mesesLin + ' meses con datos; los demás, por las facturas): ya recoge lo que se trabaja cuando llueve' : 'El trabajo de cada mes sale de las facturas: aún hay pocas líneas con fecha') + '. Lo que no se hace un mes espera al siguiente (como mucho 2 meses de trabajo; lo demás se pierde). Contratar más solo suma mientras haya trabajo: si no queda, la gente de más cobra sin obra. Hoy: Rafa y Manolo con sus retiradas reales. En la simulación Rafa se lleva lo de dos maquinistas (no desgrava) y Manolo va en nómina de maquinista (desgrava).</div>';
};
R.hipHtml = P => { const prm = R.param, inp = (k, l, u) => '<label style="font-size:11.5px;display:flex;flex-direction:column;gap:2px;">' + l + '<input type="number" value="' + prm[k] + '" onchange="RENT.setParam(\'' + k + '\',this.value)" style="width:90px;"><span' + (/^(d|h|kg|km)\b/.test(u || '') ? ' class="no-cap"' : '') + ' style="color:var(--ink-soft);">' + (u || '') + '</span></label>';
  return '<div style="font-weight:800;font-size:13px;margin:8px 0 4px;">Hipótesis</div><div style="display:flex;flex-wrap:wrap;gap:10px;">' + inp('jornadas', 'Jornadas al año', 'd') + inp('horasDia', 'Horas operativas al día', 'h (el resto hasta 8 h es reserva)') + inp('indisponibilidad', 'Averías / paradas', '% de tiempo') + inp('reduccionAverias', 'Reducción con mecánico', '% de las averías') + inp('ahorroTaller', 'Ahorro en taller con mecánico', '%') + inp('condMecPct', 'Conductor/mecánico conduce', '% del tiempo') + inp('repSemana', 'Rafa y Manolo reparan', 'h/semana entre los dos') + inp('gesSemana', 'Rafa y Manolo gestionan', 'h/semana entre los dos') + inp('impuesto', 'Impuestos', '% sobre beneficio') + inp('vidaUtil', 'Vida útil maquinaria', 'años') + inp('residualPct', 'Valor residual', '%') + '</div>'
  + '<div style="font-weight:800;font-size:13px;margin:10px 0 4px;">Obra de referencia (precio por hora)</div><select class="rt-sel" onchange="RENT.setRef(this.value)" style="font-size:12.5px;max-width:100%;"><option value="">Automática: nave avícola</option>' + (P.jobs || []).filter(j => (R.asignar(P).porJob[j.id] || []).length).map(j => '<option value="' + j.id + '"' + (R.param.refJob === j.id ? ' selected' : '') + '>' + esc(j.trabajo || j.id) + '</option>').join('') + '</select>'; };

R.vista = function(P){
  const asig = R.asignar(P), b = R.base12(P);
  const calc = j => { try{ return R.calcular(j, P, asig); }catch(e){ return {vacio: true, job: j, error: e.message}; } };
  const jobs = (P.jobs || []).filter(j => j.estado !== 'Cancelado'), todos = jobs.map(calc), con = todos.filter(x => !x.vacio).sort((a, c) => c.hasta.localeCompare(a.hasta));
  if(!R.sel || !con.some(x => x.job.id === R.sel)) R.sel = con[0] ? con[0].job.id : null;
  const r = con.find(x => x.job.id === R.sel) || {vacio: true}; R._r = r; R._asig = asig;
  const dep = (P.jobs || []).filter(j => j.estado !== 'Cancelado' && !asig.porJob[j.id].length).length;
  const selTxt = x => (x.job.trabajo || 'Obra') + ' · ' + (x.job.cliente || '') + ' · ' + eur(x.beneficioReal), selAct = con.find(x => x.job.id === R.sel), selFs = selAct ? Math.max(8.5, Math.min(10.5, 230 / (selTxt(selAct).length * 0.6))).toFixed(1) : 10.5;   // V9.86: si el texto no cabe, la letra se hace más pequeña
  const selector = '<select class="rt-sel" onchange="RENT.setSel(this.value)" style="width:100%;font-size:' + selFs + 'px;padding-left:8px;padding-right:4px;">' + con.map(x => '<option value="' + x.job.id + '" ' + (x.job.id === R.sel ? 'selected' : '') + '>' + esc((x.job.trabajo || 'Obra') + ' · ' + (x.job.cliente || '') + ' · ' + eur(x.beneficioReal)) + '</option>').join('') + '</select>';
  const amb = asig.ambiguos.length ? card('Albaranes por asignar (' + asig.ambiguos.length + ')', '<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:6px;">El mismo cliente tiene varias obras abiertas en esas fechas. No se reparten solos para no mezclar obras.</div>' + asig.ambiguos.slice(0, 8).map(a => '<div style="font-size:12px;padding:3px 0;">' + esc((a.doc.numero || 'albarán') + ' · ' + R.fechaRef(a.doc) + ' · ' + eur(R.baseIngreso(a.doc))) + ' <select onchange="if(this.value)RENT.asignarAlb(\'' + a.doc.id + '\',this.value)"><option value="">asignar a…</option>' + a.candidatos.map(id => { const j = jobs.find(x => x.id === id); return '<option value="' + id + '">' + esc(j ? j.trabajo : id) + '</option>'; }).join('') + '</select></div>').join('')) : '';
  let obra;
  if(!con.length) obra = '<div class="rt-c">Todavía no hay obras con albaranes asignados. ' + (asig.sinAsignar.length ? asig.sinAsignar.length + ' albaranes sin obra reconocible.' : '') + '</div>';
  else if(r.vacio) obra = '<div class="rt-c">Esta obra no tiene albaranes asignados.</div>';
  else {
    const albs = card('Documentos incluidos (una factura sustituye a sus albaranes)', r.albs.map(d => fila(esc((d.tipo === 'albaran' ? 'Albarán ' : d.tipo === 'proforma' ? 'Proforma ' : 'Factura ') + (d.numero || '') + ' · ' + R.fechaRef(d)) + ' <i style="font-size:11px;">(' + ((asig.origen[d.id] || {}).como || '?') + ')</i>', eur(R.baseIngreso(d)) + ' <a href="#" onclick="RENT.excluirAlb(\'' + d.id + '\',\'' + r.job.id + '\');return false" style="font-size:11px;">quitar</a>')).join(''));
    const hist = R.hist ? card('Histórico de cálculos', (R.hist.length ? R.hist.map(h => fila(new Date(h.created_at).toLocaleDateString('es-ES'), eur(h.resultado && h.resultado.beneficioReal))).join('') : '<div style="font-size:12px;">Primer cálculo guardado hoy.</div>')) : '';
    const m = (P.imput || []).filter(i => i.job_id === r.job.id), manual = m.length ? card('Correcciones manuales', m.map(i => fila(esc(i.concepto) + ' <span style="font-size:11px;">(' + i.modo + ', ' + i.origen + ', ' + new Date(i.created_at).toLocaleDateString('es-ES') + ')</span>', eur(i.importe) + ' <a href="#" onclick="RENT.quitarImp(\'' + i.id + '\');return false" style="font-size:11px;">deshacer</a>', esc(i.nota || ''))).join('')) : '';
    obra = R.vistaObra(r, P, b).replace(/<\/details>$/, albs + manual + hist + amb + '</details>');
  }
  return '<div class="panel te-panel rt-w">' + selector + obra + R.simHtml(P, R.baseObra(r, b)) + (R.errores && R.errores.length ? '<div style="font-size:11px;color:var(--ink-soft);">Fallos al leer: ' + esc(R.errores.join(', ')) + '</div>' : '') + '</div>';   // V11.40 (reporte ddac333f): fuera «Actualizar datos · N obras sin albaranes…»
};
R.ficha = null;
R.setFicha = k => { R.ficha = R.ficha === k ? null : k; R.repinta(); };
R.setEsc2 = (k, v) => { R.build2[k] = (R.build2[k] === v && (k === 'rafa' || k === 'manolo')) ? 'fuera' : v; R.repinta(); };   // V9.90: sin botón «Fuera»: quitar la marca = fuera
R.stepEsc2 = (k, d) => { R.build2[k] = Math.max(0, Math.min(10, (R.build2[k] | 0) + d)); R.repinta(); };
R.escAdd2 = async () => { const P = R.P, e = {...R.build2}; if(R.nombreEsc2(e) === R.nombreEsc2(R.ESC2)) return; P.esc2 = [...(P.esc2 || []), e]; await R.escGuardar(); R.repinta(); };
R.escDel2 = async i => { R.P.esc2.splice(i, 1); await R.escGuardar(); R.repinta(); };

// ---- acciones ----
const guarda = async (q, nota) => { const {error} = await q; if(error){ alert('No se pudo guardar' + (nota ? ' (' + nota + ')' : '') + ': ' + error.message); return false; } return true; };
R.repinta = () => { if(R.el && R.P){ R.el.innerHTML = R.vista(R.P); if(!R._exclLeido) setTimeout(R.leeExcl, 0); } };
// V11.97 (reporte e14de7ff): partidas desmarcadas por obra («obra|clave»); se guardan en este móvil y al repintar se dejan abiertos los mismos desplegables
R.excl = (() => { try{ return new Set(JSON.parse(localStorage.getItem('rent-excl') || '[]')); }catch(e){ return new Set(); } })();
R.guardaExcl = () => { const v = JSON.stringify([...R.excl]); try{ localStorage.setItem('rent-excl', v); }catch(e){} try{ if(typeof sb !== 'undefined' && sb) sb.from('filtros_persistentes').upsert({container_id: 'rent-excl', valor: v}, {onConflict: 'container_id'}).then(() => {}); }catch(e){} };
R.leeExcl = async () => { if(R._exclLeido || typeof sb === 'undefined' || !sb) return; R._exclLeido = true; try{ const {data} = await sb.from('filtros_persistentes').select('valor').eq('container_id', 'rent-excl').maybeSingle(); if(data && data.valor){ const v = JSON.parse(data.valor); if(JSON.stringify(v) !== JSON.stringify([...R.excl])){ R.excl = new Set(v); try{ localStorage.setItem('rent-excl', data.valor); }catch(e){} R.repintaAbierto(); } } }catch(e){} };
R.repintaAbierto = () => { if(!R.el) return; const ab = [...R.el.querySelectorAll('details')].map(d => d.open); R.repinta(); [...R.el.querySelectorAll('details')].forEach((d, i) => { if(ab[i]) d.open = true; }); };
R.toggleExcl = (jid, claves, on) => { jid = decodeURIComponent(jid); claves.split(',').map(decodeURIComponent).forEach(c => { const k = jid + '|' + c; if(on) R.excl.add(k); else R.excl.delete(k); }); R.guardaExcl(); R.repintaAbierto(); };
R.contarTodo = jid => { jid = decodeURIComponent(jid); [...R.excl].forEach(k => { if(k.startsWith(jid + '|')) R.excl.delete(k); }); R.guardaExcl(); R.repintaAbierto(); };
R.setTab = n => { R.tab = n; R.repinta(); R.snapshot(); };
R.setSel = id => { R.sel = id; R.repinta(); R.snapshot(); };

// ---------- ¿Estamos en precio? (V11.62, Daniel 14/10/2026): la MISMA tarjeta en Economía y en Ren. obras, con el reparto por máquina de R.porClase ----------
// Por máquina: lo que se cobra por hora frente a su coste completo, el mínimo (coste completo + impuestos) y el precio objetivo (mínimo + el margen limpio del marcador).
R.preciosDe = function(r){
  if(!r || r.vacio || !(r.H > 0)) return null; const cl = R.porClase(r); if(!cl) return null;
  const t = num(R.param.impuesto) / 100;
  const filas = cl.filter(x => x.h > 0 && isFinite(x.tarifa) && x.clase !== 'otros').map(x => ({clase: x.clase, nombre: x.nombre, horas: x.h, tarifa: x.tarifa, coste: x.n3 / x.h, min: R.objetivo(x.n3 - r.socios.valor * x.h / r.H, r.socios.valor * x.h / r.H, t, 0) / x.h, obj: x.n4 / x.h}));
  if(!filas.length) return null;
  const nv = R.niveles4(r), tm = r.ejecutado / r.H;
  return {filas, obra: r.job.trabajo, horas: r.H, tarifaMedia: tm, minMedio: R.objetivo(r.directo + r.indirecto, r.socios.valor, t, 0) / r.H, objMedio: nv.n4 / r.H, impuesto: R.param.impuesto, margen: R.param.margen};
};
R.tablaPrecios = function(P){ const ref = R.referencia(P); if(!ref || !P.costes) return null; return R.preciosDe(R.calcular(ref.job, P, R.asignar(P))); };
R.htmlPrecios = (T, enObra) => {
  const caja = h => enObra ? '<div class="rt-c">' + h + '</div>' : '<div class="panel" style="padding:12px;margin-top:12px;">' + h + '</div>';
  if(!T) return caja('<div style="font-size:12.5px;color:var(--ink-soft);">¿Estamos en precio? Aún no hay una obra con horas completas para calcularlo.</div>');
  const f = T.filas, okO = f.filter(x => x.tarifa >= x.obj).length, okM = f.filter(x => x.tarifa >= x.min).length, r2 = v => eur(v, 2) + '/h';
  const sr = (a, b2, c) => '<div class="rt-sim-r"><span>' + a + '</span><b' + (c ? ' style="color:' + c + ';"' : '') + '>' + b2 + '</b></div>';
  // V11.30 (reporte 00aea0c7): una línea por máquina, sin tabla; V11.62: se toca y despliega ahí mismo su cuenta; la diferencia es con el precio objetivo, en verde o rojo por su signo
  const rows = f.map(x => { const dO = x.tarifa - x.obj, dM = x.tarifa - x.min, est = dO >= 0 ? 'En precio' : dM >= 0 ? 'Cubre costes, no llega al objetivo' : 'No cubre costes';
    return '<details class="rt-nd"><summary><div class="rt-sim-r"><span style="flex:1;min-width:0;font-weight:700;">' + esc(x.nombre) + '<small style="display:block;color:var(--ink-soft);font-size:10.5px;font-weight:400;">' + est + ' · objetivo ' + r2(x.obj) + '</small></span><span style="text-align:right;white-space:nowrap;"><b>' + r2(x.tarifa) + '</b><small style="display:block;font-size:10.5px;font-weight:700;color:' + col(dO) + ';">' + (dO >= 0 ? '+' : '') + eur(dO, 2) + '</small></span></div></summary><div class="rt-bd">'
      + sr('Cobráis', r2(x.tarifa)) + sr('Coste completo', r2(x.coste), RJ) + sr('Mínimo (coste + impuestos)', r2(x.min), RJ) + sr('Precio objetivo (' + T.margen + ' % limpio)', r2(x.obj)) + sr('Diferencia con el mínimo', (dM >= 0 ? '+' : '') + eur(dM, 2), col(dM)) + sr('Diferencia con el objetivo', (dO >= 0 ? '+' : '') + eur(dO, 2), col(dO)) + sr('Horas en la obra', h1(x.horas) + ' h') + '</div></details>'; }).join('');
  return caja('<div style="font-weight:800;font-size:14px;">¿Estamos en precio?</div><div style="font-size:12px;color:var(--ink-soft);margin:2px 0 8px;">' + okO + ' de ' + f.length + ' máquinas llega' + (okO === 1 ? '' : 'n') + ' al objetivo y ' + okM + ' cubre' + (okM === 1 ? '' : 'n') + ' su coste. En conjunto cobráis <span style="white-space:nowrap;">' + r2(T.tarifaMedia) + '</span>, el mínimo es <span style="white-space:nowrap;">' + r2(T.minMedio) + '</span> y el objetivo <span style="white-space:nowrap;">' + r2(T.objMedio) + '.</span></div><div>' + rows + '</div>'
    + '<div style="font-size:11px;color:var(--ink-soft);margin-top:8px;">Obra «' + esc(T.obra) + '» (' + h1(T.horas) + ' h). Mínimo: coste completo más impuestos (' + T.impuesto + ' %). Objetivo: un ' + T.margen + ' % limpio, el del marcador. Sin la reposición de las máquinas.</div>');
};
// ---------- ¿Cómo de rentable es? (V11.62, Daniel 14/10/2026): margen neto, si el objetivo es razonable y rentabilidad sobre lo invertido, con referencias para comparar con otros negocios ----------
R.REF_RENT = {letras: 2.7, empresas: 6.7, construccionROE: 3.1};   // Letras del Tesoro 12 meses (subastas 2026) · rentabilidad del activo de las empresas españolas (Banco de España, 2024) · rentabilidad de los fondos propios en construcción (BBVA Research, 2023)
R.htmlComparar = function(r, P){
  if(!r || r.vacio || !(r.ejecutado > 0)) return '';
  const m = num(R.param.margen), mg = r.neto / r.ejecutado * 100, dT = Object.keys(r.hDia || {}).length, jA = num(R.param.jornadas) || 250;
  const p1 = v => (Math.round(v * 10) / 10).toLocaleString('es-ES', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' %';
  const sr = (a, b2, c) => '<div class="rt-sim-r"><span>' + a + '</span><b' + (c ? ' style="color:' + c + ';"' : '') + '>' + b2 + '</b></div>', tx = t => '<div class="rt-ldx">' + t + '</div>';
  const lin = (tit, sub, v, c, bd) => '<details class="rt-nd"><summary><div class="rt-sim-r"><span style="flex:1;min-width:0;font-weight:700;">' + tit + '<small style="display:block;color:var(--ink-soft);font-size:10.5px;font-weight:400;">' + sub + '</small></span><b style="white-space:nowrap;' + (c ? 'color:' + c + ';' : '') + '">' + v + '</b></div></summary><div class="rt-bd">' + bd + '</div></details>';
  const vObj = m < 5 ? 'Bajo: deja poco para imprevistos y para reponer máquinas' : m < 8 ? 'Normal en construcción' : m <= 12 ? 'Bueno y razonable para una empresa pequeña con máquinas propias' : m <= 15 ? 'Alto: hay que cobrar por encima de la media' : 'Muy alto: difícil de cobrar salvo trabajos especiales';
  const l1 = lin('Margen neto de esta obra', 'Lo que queda limpio de cada 100 € facturados', p1(mg), col(mg), sr('Trabajo hecho', eur(r.ejecutado)) + sr('Limpio tras todos los costes e impuestos', eur(r.neto), col(r.neto)) + sr('Margen neto', p1(mg), col(mg)) + sr('Construcción en España (orientativo)', 'entre 3 y 5 %') + sr('Vuestro objetivo', p1(m)) + tx('Ya cuenta como coste la retribución de Rafa y Manolo: es lo que queda después de pagaros.'));
  const l2 = lin('Objetivo del marcador', vObj, p1(m), null, sr('Menos del 5 %', 'bajo') + sr('Del 5 al 8 %', 'normal del sector') + sr('Del 8 al 12 %', 'bueno (recomendado)') + sr('Más del 12 %', 'alto') + tx('Recomendado entre el 8 y el 12 %. Mientras no se cuente la reposición de las máquinas, mejor no bajar del 10 %: ese hueco sale del margen.'));
  const VF = P.valFlota || {}, usadas = (r.maq || []).map(x => ({id: String(x.id), nombre: x.nombre})), val = f => num((VF[f.id] || {}).estimado), falta = usadas.filter(f => !(val(f) > 0)), cap = sum(usadas, val);
  const anual = dT ? r.neto / dT * jA : NaN, roa = cap > 0 && !falta.length ? anual / cap * 100 : NaN, RF = R.REF_RENT;
  const vRoa = !isFinite(roa) ? 'Falta el valor de alguna máquina en Valor flota' : roa >= RF.empresas ? 'Renta más que la media de las empresas españolas' : roa >= RF.letras ? 'Renta más que las Letras del Tesoro, menos que la media' : 'Renta menos que tener el dinero en Letras del Tesoro';
  const l3 = lin('Rentabilidad sobre lo invertido', vRoa, isFinite(roa) ? p1(roa) + ' al año' : 'sin dato', isFinite(roa) ? col(roa) : null,
    sr('Limpio de la obra', eur(r.neto), col(r.neto)) + sr('Días con trabajo', h1(dT) + ' d') + sr('Limpio al año a este ritmo (' + jA + ' jornadas)', isFinite(anual) ? eur(anual) : '—', col(anual))
    + usadas.map(f => sr(esc(f.nombre), val(f) > 0 ? eur(val(f)) : 'falta')).join('') + sr('Total invertido', cap > 0 ? eur(cap) : 'falta')
    + sr('Letras del Tesoro a 12 meses (2026)', p1(RF.letras)) + sr('Media de las empresas españolas (Banco de España, 2024)', p1(RF.empresas)) + sr('Construcción en España, sobre fondos propios (2023)', p1(RF.construccionROE))
    + tx('Es la cifra que se usa para comparar negocios: cuánto deja al año cada 100 € metidos en él. Lo invertido es el valor de venta de las máquinas de la obra, el de «Valor flota» en Economía: es el dinero que tenéis metido.' + (falta.length ? ' Falta el valor de ' + falta.map(f => esc(f.nombre)).join(', ') + ' en Valor flota.' : '')));
  return '<div class="rt-c"><h3>¿Cómo de rentable es?</h3>' + l1 + l2 + l3 + '</div>';
};
R.pintarPrecios = async function(el){ if(!el) return; try{ const P = await R.cargar(false); el.innerHTML = R.htmlPrecios(R.tablaPrecios(P)); }catch(e){ console.error(e); el.innerHTML = ''; } };
R.recargar = async () => { R.invalidar(); if(R.el) await R.pintar(R.el, true); };
R.param_ = async () => { const P = R.P; const data = {...R.param}; if(P.paramId) await guarda(sb.from('sistema').update({data}).eq('id', P.paramId), 'hipótesis'); else { const {data: d, error} = await sb.from('sistema').insert({tipo: 'rent_parametros', data}).select('id').single(); if(!error && d) P.paramId = d.id; } };
R.setRef = async id => { R.param.refJob = id || null; await R.param_(); if(R.P) delete R.P._ref; R.repinta(); };
R.stepHoras = d => { const v = Math.min(8, Math.max(0.5, Math.round(((num(R.param.horasDia) || 6) + d) * 2) / 2)); R.setParam('horasDia', v); };
R.setParam = async (k, v) => { R.param[k] = Number(String(v).replace(',', '.')) || 0; await R.param_(); R.repinta(); };
R.asignarAlb = async (docId, jobId) => { if(await guarda(sb.from('rent_vinculos').upsert({job_id: jobId, documento_id: docId, rol: 'albaran', accion: 'incluir', nota: 'asignado a mano'}, {onConflict: 'job_id,documento_id'}))) await R.recargar(); };
R.excluirAlb = async (docId, jobId) => { if(!confirm('¿Quitar este albarán de la obra?')) return; if(await guarda(sb.from('rent_vinculos').upsert({job_id: jobId, documento_id: docId, rol: 'albaran', accion: 'excluir', nota: 'quitado a mano'}, {onConflict: 'job_id,documento_id'}))) await R.recargar(); };
R.corregir = async (jobId, clave, bloque) => {
  const x = [...R._r.lineasD, ...R._r.lineasI, R._r.socios].find(y => y.clave === clave); if(!x) return;
  const v = prompt('Importe correcto para «' + x.label + '» (€). Ahora: ' + eur(x.valor), String(Math.round(x.valor * 100) / 100).replace('.', ',')); if(v == null) return;
  const imp = Number(String(v).replace(/\./g, '').replace(',', '.')); if(!isFinite(imp)) return alert('Importe no válido');
  const nota = prompt('¿De dónde sale este importe? (queda guardado como origen)', ''); if(nota == null) return;
  if(await guarda(sb.from('rent_imputaciones').insert({job_id: jobId, bloque: clave === 'socios' ? 'indirecto' : bloque, concepto: x.label, importe: imp, modo: 'sustituir', clave, nivel: 'real', origen: 'manual', nota}))) await R.recargar();
};
R.anadir = async (jobId, bloque) => {
  const c = prompt('Concepto del ' + (bloque === 'directo' ? 'gasto directo' : 'coste indirecto')); if(!c) return;
  const v = prompt('Importe sin IVA (€)'); if(v == null) return; const imp = Number(String(v).replace(/\./g, '').replace(',', '.')); if(!isFinite(imp)) return alert('Importe no válido');
  const nota = prompt('Origen / factura (queda guardado)', ''); if(nota == null) return;
  if(await guarda(sb.from('rent_imputaciones').insert({job_id: jobId, bloque, concepto: c, importe: imp, modo: 'añadir', nivel: 'real', origen: 'manual', nota}))) await R.recargar();
};
R.quitarImp = async id => { if(await guarda(sb.from('rent_imputaciones').update({activo: false}).eq('id', id))) await R.recargar(); };
R.escAdd = async () => { const P = R.P, e = {...R.build}; if(R.nombreEsc(e) === R.nombreEsc(R.ESC0)) return; P.escenarios = [...(P.escenarios || []), e]; await R.escGuardar(); R.repinta(); };
R.escDel = async i => { R.P.escenarios.splice(i, 1); await R.escGuardar(); R.repinta(); };
R.escGuardar = async () => { const P = R.P, data = {lista: P.escenarios || [], lista2: P.esc2 || []}; if(P.escId) await guarda(sb.from('sistema').update({data}).eq('id', P.escId), 'escenarios'); else { const {data: d, error} = await sb.from('sistema').insert({tipo: 'rent_escenarios', data}).select('id').single(); if(!error && d) P.escId = d.id; } };
R.snapshot = async () => {   // histórico: solo guarda si cambió algo respecto al último cálculo
  const r = R._r; if(!r || r.vacio || !window.sb) return; const hu = R.huella(r);
  try{ const {data} = await sb.from('rent_historial').select('huella,created_at,resultado').eq('job_id', r.job.id).order('created_at', {ascending: false}).limit(6); R.hist = data || [];
    if(!R.hist.length || R.hist[0].huella !== hu){ const row = {job_id: r.job.id, huella: hu, resultado: {ejecutado: r.ejecutado, directo: r.directo, indirecto: r.indirecto, socios: r.socios.valor, beneficioReal: r.beneficioReal, comprobado: r.comprobado, neto: r.neto, tesoreria: r.tesoreria, porJornada: r.m.porJornada, porHora: r.m.porHora}}; const ins = await sb.from('rent_historial').insert(row); if(!ins.error) R.hist = [{...row, created_at: new Date().toISOString()}, ...R.hist]; }
    R.repinta(); }catch(e){ console.error('histórico', e); }
};
R.pintar = async function(el, forzar){
  R.el = el; if(!R.P) el.innerHTML = '<div class="panel te-panel" style="font-size:13px;">Calculando rentabilidad…</div>';
  try{ const P = await R.cargar(forzar); el.innerHTML = R.vista(P); R.snapshot(); }catch(e){ console.error(e); el.innerHTML = '<div class="panel te-panel" style="font-size:13px;">No se pudo calcular la rentabilidad: ' + esc(e.message) + '</div>'; }
};
})();
