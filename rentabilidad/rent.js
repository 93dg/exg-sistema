/* EXG — Rentabilidad de trabajos (V9.33, Daniel 09/10/2026)
   Cinco apartados: Resultado directo · Beneficio real · Coste de oportunidad · Simulador · Comparativa.
   Cada cifra lleva su nivel de fiabilidad: real (dato comprobado) · calculada (con datos comprobados) · estimada · falta (dato que no hay).
   Este archivo solo lee de la aplicación; escribe únicamente en rent_vinculos, rent_imputaciones, rent_historial y en sistema (rent_parametros, rent_escenarios). */
(function(){
'use strict';
const R = window.RENT = {};
const DAY = 86400000;
const PARAM0 = {reduccionAverias: 30, horasMecanicaSemana: 10, jornadas: 250, impuesto: 20, vidaUtil: 10, residualPct: 0, horasSocioDia: 8, diasSemanaSocios: 5, ocupacion: 70, indisponibilidad: 10, ahorroTaller: 50, condMecPct: 50, usarEstimaciones: true};
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
R.lineas = d => (Array.isArray(d.conceptos) ? d.conceptos : []).map(c => ({f: dia(c.fecha) || dia(d.fecha_devengo), h: num(c.horas != null ? c.horas : (c.unidad === 'h' ? c.cantidad : 0)), imp: num(c.importe), clase: R.claseLinea(c.descripcion), desc: c.descripcion || ''})).filter(l => l.f);

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
    pag('sistema', 'id,tipo,data', b => b.in('tipo', ['trabajo_cola', 'coste_hora', 'rent_parametros', 'rent_escenarios', 'costes_config'])),
    pag('entidades', 'id,nombre,tipo', b => b.is('deleted_at', null))
  ]);
  P.docs = docs; P.gastos = gastos; P.flota = flota; P.polizas = polizas.filter(p => p.activa !== false); P.vinculos = vinc; P.imput = imp; P.entidades = tarifas;
  P.jobs = sis.filter(r => r.tipo === 'trabajo_cola' && r.data).map(r => ({id: r.id, ...r.data}));
  const ch = sis.find(r => r.tipo === 'coste_hora'); P.ayudantes = (ch && ch.data && ch.data.ayudantes) || {};
  const pa = sis.find(r => r.tipo === 'rent_parametros'); P.paramId = pa ? pa.id : null; R.param = {...PARAM0, ...((pa && pa.data) || {})};
  const es = sis.find(r => r.tipo === 'rent_escenarios'); P.escId = es ? es.id : null; P.escenarios = (es && es.data && es.data.lista) || [];
  try{ P.socios = await costeSociosCargar(); }catch(e){ P.socios = []; R.errores.push('socios: ' + e.message); }
  try{ const {data} = await sb.from('tarifas').select('concepto,precio_particular'); P.tarifas = data || []; }catch(e){ P.tarifas = []; }
  if(window.COSTES){ try{ COSTES.aplicarCfg(sis.find(r => r.tipo === 'costes_config')); P.costes = COSTES.calcular(P, []); }catch(e){ P.costes = null; R.errores.push('costes: ' + e.message); console.error('COSTES', e); } }
  P.cargadoEn = Date.now(); R.P = P; return P;
};
R.invalidar = () => { R.P = null; };


// ---------- documentos que cuentan como ingreso: una factura sustituye a los albaranes con los que está enlazada (no se suma dos veces) ----------
R.efectivos = function(P){
  if(P._ef) return P._ef;
  const docs = (P.docs || []).filter(d => d.estado_cobro !== 'nula' && ['albaran', 'factura', 'proforma'].includes(d.tipo)), byId = new Map(docs.map(d => [d.id, d])), ady = new Map();
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
R.asignar = function(P){
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
  const horasDia = {}, horasClase = {}, dias = new Set(); let ingresos = 0, horas = 0, ingConHoras = 0;
  indep.forEach(d => { const ls = R.lineas(d).filter(l => l.f >= W0 && l.f <= hasta); if(!ls.length) return; const fl = R.factorLineas(d); ingresos += sum(ls, l => l.imp) * fl; ingConHoras += sum(ls.filter(l => l.h > 0), l => l.imp) * fl;
    ls.forEach(l => { horasDia[l.f] = (horasDia[l.f] || 0) + l.h; horasClase[l.clase] = (horasClase[l.clase] || 0) + l.h; horas += l.h; if(l.h > 0 || l.imp > 0) dias.add(l.f); }); });
  const gW = (P.gastos || []).filter(g => g.fecha_devengo >= W0 && g.fecha_devengo <= hasta && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada'));
  const comb = sum(gW.filter(g => /combust/i.test(g.categoria || '')), R.baseGasto);
  return P._ev[k] = {W0, hasta, horasDia, horasClase, horas, dias: dias.size, ingresos, ingConHoras, gW, comb};
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
  // ---- DIRECTO: combustible ----
  const horasIndep = ev.horasDia, CO = P.costes;
  const fuel = (P.gastos || []).filter(g => /combust/i.test(g.categoria || '') && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada'));
  let combReal = 0, litros = 0, sinDesg = 0, nSin = 0;
  fuel.forEach(g => { if(Array.isArray(g.lineas_fechadas)){ const tot = Math.abs(num(g.importe)), ratio = tot ? R.baseGasto(g) / tot : 1; let usadoDoc = false; g.lineas_fechadas.forEach(l => { const f = '20' + l[0], hm = lin.filter(x => x.f === f).reduce((s, x) => s + x.h, 0); if(!hm) return; const rep = horasIndep[f] > 0 ? Math.min(1, hm / horasIndep[f]) : 1; combReal += num(l[3]) * ratio * rep; litros += num(l[2]) * rep; usadoDoc = true; }); if(usadoDoc) usados.add(g.id); }
    else if(g.fecha_devengo && g.fecha_devengo.slice(0, 7) >= desde.slice(0, 7) && g.fecha_devengo.slice(0, 7) <= hasta.slice(0, 7)){ sinDesg += R.baseGasto(g); nSin++; } });
  lineasD.push(L('combustible', 'Combustible de esos días', combReal, combReal ? 'calculada' : 'falta', 'facturas con líneas por día, repartido por horas trabajadas ese día', combReal ? h1(litros) + ' litros' : 'No hay facturas de combustible desglosadas por día en estas fechas.'));
  const consumoH = ev.horas > 0 ? ev.comb / ev.horas : 0, combEst = Math.max(0, consumoH * H - combReal);
  if(combEst > 1) lineasD.push(L('combustible_est', 'Combustible sin desglose por día', combEst, 'estimada', 'consumo medio de la empresa (12 meses) × horas de esta obra − lo ya comprobado', 'Consumo medio ' + eur(consumoH, 2) + ' por hora facturada. ' + (nSin ? nSin + ' factura(s) de combustible de esos meses no traen el detalle por día.' : '')));
  const idsMaqX = null;
  // ---- DIRECTO: gastos vinculados, ayudantes, reparaciones ----
  const vinG = (P.vinculos || []).filter(v => v.job_id === job.id && v.rol === 'gasto' && v.accion === 'incluir');
  const porCat = {}; vinG.forEach(v => { const g = (P.gastos || []).find(x => x.id === v.documento_id); if(!g) return; usados.add(g.id); const c = g.categoria || 'Otros'; porCat[c] = (porCat[c] || 0) + R.baseGasto(g); });
  Object.keys(porCat).forEach(c => lineasD.push(L('vinc:' + c, c + ' (asignado a la obra)', porCat[c], 'real', 'facturas asignadas a mano a esta obra', '')));
  const ayu = num(P.ayudantes[job.id]); if(ayu) lineasD.push(L('ayudantes', 'Ayudantes y subcontratados', ayu, 'real', 'apuntado a mano', ''));
  const idsMaq = new Set([...maq.keys()]);
  const rep = (P.gastos || []).filter(g => g.vehiculo_id && idsMaq.has(g.vehiculo_id) && CAT_MANT.test(g.categoria || '') && g.fecha_devengo >= desde && g.fecha_devengo <= hasta && !usados.has(g.id) && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada'));
  rep.forEach(g => usados.add(g.id)); const repTot = sum(rep, R.baseGasto);
  lineasD.push(L('reparaciones', 'Reparaciones de las máquinas usadas', repTot, repTot ? 'real' : 'falta', 'facturas anotadas a la máquina entre las fechas de la obra', repTot ? rep.length + ' factura(s)' : 'No hay ninguna factura anotada a las máquinas usadas en esas fechas (puede que no haya habido o que no estén asignadas).'));
  // ---- INDIRECTO: parte fija de las máquinas (seguros, impuestos…) de los 12 meses, repartida por horas de utilización ----
  Object.keys(hClase).forEach(c => { if(!(hClase[c] > 0)) return; const k = CO && CO.clases.find(x => x.clase === c), nom = R.NOMBRE_CLASE[c] || c;
    if(k && k.horaFija != null) lineasI.push(L('maq:' + c, 'Costes fijos de máquina: ' + nom, k.horaFija * hClase[c], k.manual ? 'estimada' : 'calculada', eur(k.horaFija, 2) + ' por hora productiva × ' + h1(hClase[c]) + ' h', 'Seguros, impuestos y demás costes fijos de la flota (12 meses) repartidos por horas de utilización (Gastos → Normalización).'));
    else lineasI.push(L('maq:' + c, 'Costes fijos de máquina: ' + nom, 0, 'falta', '', 'No hay coste por hora para esta clase en Normalización.')); });
  // ---- INDIRECTO: amortización (provisión; solo con precio de compra) ----
  const W0 = ev.W0, W1 = hasta, jorn = num(window.COSTES && COSTES.cfg.diasLab) || num(prm.jornadas) || 250;
  maq.forEach(x => { const m = x.m, d = x.dias.size, compra = num(m.coste_compra);
    if(compra > 0){ const vida = num(prm.vidaUtil) || 10, res = num(prm.residualPct) / 100, am = compra * (1 - res) / vida; lineasI.push(L('amort:' + m.id, m.nombre + ': amortización', am / jorn * d, 'estimada', 'compra ' + eur(compra) + ' ÷ ' + vida + ' años de vida útil (hipótesis), por ' + jorn + ' días laborables', 'Vida útil y valor residual son hipótesis tuyas, editables en Hipótesis.')); }
    else lineasI.push(L('amort:' + m.id, m.nombre + ': amortización', 0, 'falta', '', 'Falta el coste de compra de la máquina (ficha de flota): no se imputa amortización.')); });
  // ---- INDIRECTO: estructura, Seguridad Social/autónomos y coches de empresa (Normalización, por días laborables) y retribución de los socios ----
  const dLab = num(window.COSTES && COSTES.cfg.diasLab) || 217;
  if(CO){
    const est0 = CO.porGrupo.estructura || 0, ges = sum(CO.porCat.filter(x => x.grupo === 'estructura' && /gestor/i.test(x.cat)), x => x.base), est = est0 - ges;
    if(ges > 0) lineasI.push(L('gen:gestoria', 'Gestoría (sin ella no se declara el IVA)', ges / dLab * D, 'calculada', eur(ges) + ' al año ÷ ' + dLab + ' días laborables × ' + D + ' días de esta obra', 'Gastos → Normalización, estructura.'));
    if(est > 0) lineasI.push(L('gen:estructura', 'Resto de la estructura (nave, financiación, suministros, programas…)', est / dLab * D, 'calculada', eur(est) + ' al año ÷ ' + dLab + ' días laborables × ' + D + ' días de esta obra', 'Gastos → Normalización, grupo Estructura.'));
    const ss = sum(CO.porCat.filter(x => x.grupo === 'personal' && /seguridad social|aut[oó]nomo/i.test(x.cat)), x => x.base), otrosP = (CO.porGrupo.personal || 0) - ss;
    if(ss > 0) lineasI.push(L('gen:ss', 'Autónomos y Seguridad Social', ss / dLab * D, 'calculada', eur(ss) + ' al año ÷ ' + dLab + ' días laborables × ' + D, otrosP > 1 ? 'No se imputan ' + eur(otrosP) + ' de nóminas y pagos en B a personas: falta decidir si son coste de obra.' : ''));
    const des = CO.clases.find(x => x.clase === 'desplazamiento'); if(des && des.total > 0) lineasI.push(L('gen:coches', 'Coches de empresa (desplazamiento a obras)', des.total / dLab * D, 'calculada', eur(des.total) + ' al año ÷ ' + dLab + ' días laborables × ' + D, 'Nissan X-Trail y Hyundai Matrix.'));
  } else avisos.push('No se pudo leer la normalización de costes: faltan los costes generales.');
  const sociosAnual = sum((P.socios || []).filter(x => x.f >= W0 && x.f <= W1), x => x.imp), socios = sociosAnual / dLab * D;
  const socL = L('socios', 'Retribución de Rafa y Manolo (retiradas y gastos personales)', socios, sociosAnual > 0 ? 'calculada' : 'falta', eur(sociosAnual) + ' al año ÷ ' + dLab + ' días laborables × ' + D, 'No es un gasto deducible: se resta para ver cuánto queda de verdad, pero no baja los impuestos.', {deducible: false});
  // ---- imputaciones manuales y correcciones ----
  const imps = (P.imput || []).filter(i => i.job_id === job.id);
  const aplicar = (arr, bloque) => { imps.filter(i => i.bloque === bloque).forEach(i => { if(i.modo === 'sustituir' && i.clave){ const x = arr.find(y => y.clave === i.clave); if(x){ x.original = x.valor; x.valor = num(i.importe); x.nivel = i.nivel; x.nota = (x.nota ? x.nota + ' · ' : '') + 'Corregido a mano: ' + (i.nota || 'sin nota'); x.manualId = i.id; return; } } arr.push(L('man:' + i.id, i.concepto, num(i.importe), i.nivel, 'imputación manual (' + i.origen + ')', i.nota || '', {manualId: i.id})); }); };
  aplicar(lineasD, 'directo'); aplicar(lineasI, 'indirecto'); { const x = imps.find(i => i.modo === 'sustituir' && i.clave === 'socios'); if(x){ socL.original = socL.valor; socL.valor = num(x.importe); socL.nivel = x.nivel; socL.nota += ' · Corregido a mano.'; socL.manualId = x.id; } }
  // ---- resultados ----
  const directo = sum(lineasD, x => x.valor), indirecto = sum(lineasI, x => x.valor), sociosV = socL.valor;
  const est = x => x.nivel === 'estimada', directoComp = sum(lineasD.filter(x => !est(x)), x => x.valor), indirectoComp = sum(lineasI.filter(x => !est(x)), x => x.valor);
  const bAntesSocios = ejecutado - directo - indirecto, beneficioReal = bAntesSocios - sociosV;
  const baseImp = Math.max(0, ejecutado - directo - indirecto), impuestos = baseImp * num(prm.impuesto) / 100, neto = beneficioReal - impuestos;
  const desembolsable = directo + sum(lineasI.filter(x => !/^amort:/.test(x.clave)), x => x.valor), tesoreria = cobrado - desembolsable - sociosV;
  const comprobado = ejecutado - directoComp - indirectoComp - sociosV;
  const estimadoImp = sum(lineasD.concat(lineasI).filter(est), x => x.valor), totalCostes = directo + indirecto + sociosV;
  const dCal = diffDays(desde, hasta) + 1;
  const res = {vacio: false, job, desde, hasta, D, H, dCal, ing, lineasD, lineasI, socios: socL, directo, indirecto, ejecutado, resultadoDirecto: ejecutado - directo, bAntesSocios, beneficioReal, comprobado, impuestos, neto, tesoreria, cobrado, estimadoImp, pctEstimado: totalCostes > 0 ? estimadoImp / totalCostes * 100 : 0, avisos, maq: [...maq.values()].map(x => ({id: x.m.id, nombre: x.m.nombre, horas: x.horas, dias: x.dias.size})), hClase, ev: {diasEmp: Math.max(1, ev.dias), horas: ev.horas, ingresos: ev.ingresos, comb: ev.comb}, albs};
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
  return {ev, ingresos: ev.ingresos, horas: ev.horas, dias: ev.dias, comb: ev.comb, costesOp, socios, taller, maquinas, backlog, nBack, pendientes: pend.length, margenH, ingH, cobHoras: ev.ingresos > 0 ? ev.ingConHoras / ev.ingresos : NaN, ref, margenPct: ref && ref.ingH > 0 ? ref.margenH / ref.ingH : NaN, beneficio: ev.ingresos - costesOp, beneficioTrasSocios: ev.ingresos - costesOp - socios};
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
  return q;
};

// ================= PANTALLA =================
const NIVEL = {real: ['Real comprobada', 'var(--green)'], calculada: ['Calculada con datos comprobados', 'var(--blue, #2f6fb0)'], estimada: ['Estimada', 'var(--orange)'], falta: ['Falta dato', 'var(--red)']};
const badge = n => { const x = NIVEL[n] || NIVEL.estimada; return '<span style="display:inline-block;font-size:10px;font-weight:700;border:1px solid ' + x[1] + ';color:' + x[1] + ';border-radius:8px;padding:0 5px;white-space:nowrap;">' + x[0] + '</span>'; };
const col = n => n < 0 ? 'var(--red)' : 'var(--green)';
R.tab = 1; R.sel = null; R.build = {socios8: false, operarios: 0, mecanico: false, mecCond: false};
const card = (t, inner, st) => '<div class="tb-cos" style="margin-bottom:10px;' + (st || '') + '">' + (t ? '<div style="font-weight:800;font-size:13.5px;margin-bottom:6px;">' + t + '</div>' : '') + inner + '</div>';
const fila = (a, b, c) => '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--line, #0001);"><span style="min-width:0;">' + a + '</span><span style="text-align:right;white-space:nowrap;">' + b + '</span></div>' + (c ? '<div style="font-size:11px;color:var(--ink-soft);padding:1px 0 4px;">' + c + '</div>' : '');
const resumen = r => r.vacio ? null : {ej: r.ejecutado, dir: r.resultadoDirecto, ben: r.beneficioReal};

R.lineaHtml = (r, x, bloque) => fila(esc(x.label) + ' ' + badge(x.nivel) + (x.manualId ? ' <a href="#" onclick="RENT.quitarImp(\'' + x.manualId + '\');return false" style="font-size:11px;">deshacer</a>' : ''), x.nivel === 'falta' ? '<i>sin dato</i>' : eur(x.valor), esc([x.criterio, x.nota].filter(Boolean).join(' — ')) + (x.manualId || !/^(socios|man:)/.test(x.clave) || true ? ' <a href="#" onclick="RENT.corregir(\'' + r.job.id + '\',\'' + esc(x.clave) + '\',\'' + bloque + '\');return false" style="font-size:11px;">corregir</a>' : ''));

R.secDirecto = r => {
  const i = r.ing, f = (t, v, n) => fila(t, '<b>' + eur(v) + '</b>', n);
  return card('Ingresos sin IVA', f('Ejecutado (trabajo hecho)', i.ejecutado, i.nAlb + ' documento(s): ' + i.nFact + ' factura(s) y ' + (i.nAlb - i.nFact) + ' albarán(es) sin facturar. Trabajo hecho, no dinero cobrado.') + f('Facturado', i.facturado, i.nFact + ' con factura enlazada' + (i.facturado < i.ejecutado ? ' · pendiente de facturar ' + eur(i.ejecutado - i.facturado) : '')) + f('Cobrado', i.cobrado, i.cobrado < i.ejecutado ? 'pendiente de cobrar ' + eur(i.ejecutado - i.cobrado) : 'todo cobrado') + '<div style="margin-top:4px;">' + badge('real') + '</div>')
    + card('Gastos directos de la obra', r.lineasD.map(x => R.lineaHtml(r, x, 'directo')).join('') + fila('<b>Total directos</b>', '<b>' + eur(r.directo) + '</b>') + '<div style="margin-top:6px;"><a href="#" onclick="RENT.anadir(\'' + r.job.id + '\',\'directo\');return false" style="font-size:12px;">+ añadir gasto directo</a></div>')
    + card('', '<div style="display:flex;justify-content:space-between;font-weight:800;font-size:15px;"><span>Resultado directo</span><span style="color:' + col(r.resultadoDirecto) + ';">' + eur(r.resultadoDirecto) + '</span></div><div style="font-size:11.5px;color:var(--ink-soft);">Ejecutado − directos. Aún sin repartir seguros, amortización, gestoría ni la retribución de los socios.</div>', 'background:var(--concrete-2);');
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
  return card('', '<div style="font-size:12px;color:var(--ink-soft);">BENEFICIO REAL</div><div style="font-size:26px;font-weight:900;color:' + col(r.beneficioReal) + ';">' + eur(r.beneficioReal) + '</div><div style="font-size:12px;">' + pct(m.pctIngresos) + ' del ingreso · ' + eur(m.porJornada) + ' por jornada · ' + (isFinite(m.porHora) ? eur(m.porHora, 2) + ' por hora' : 'sin horas') + '</div><div style="margin-top:6px;">' + (r.pctEstimado > 0 ? badge('estimada') + ' <span style="font-size:11px;">' + Math.round(r.pctEstimado) + ' % de los costes son estimados. Solo con datos comprobados: <b>' + eur(r.comprobado) + '</b></span>' : badge('calculada')) + '</div>', 'background:var(--concrete-2);')
    + card('Costes indirectos repartidos a esta obra', ind + fila('<b>Total indirectos</b> (sin retribución socios)', '<b>' + eur(r.indirecto) + '</b>') + '<div style="margin-top:6px;"><a href="#" onclick="RENT.anadir(\'' + r.job.id + '\',\'indirecto\');return false" style="font-size:12px;">+ añadir coste indirecto</a></div>')
    + R.cardNiveles(r)
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
  const bd = R.build, nb = R.simular(b, bd), inp = (k, l, u) => '<label style="font-size:11.5px;display:flex;flex-direction:column;gap:2px;">' + l + '<input type="number" value="' + R.param[k] + '" onchange="RENT.setParam(\'' + k + '\',this.value)" style="width:90px;"><span style="color:var(--ink-soft);">' + (u || '') + '</span></label>';
  return card('Situación actual real (últimos 12 meses)', fila('Ingresos sin IVA', '<b>' + eur(b.ingresos) + '</b>', badge('calculada')) + fila('Horas facturadas', h1(b.horas) + ' h', b.dias + ' días con trabajo · ' + b.maquinas + ' máquinas productivas') + fila('Costes de actividad (sin retiradas)', eur(b.costesOp), 'Incluye combustible ' + eur(b.comb)) + fila('Beneficio antes de retribuir a los socios', '<b style="color:' + col(b.beneficio) + ';">' + eur(b.beneficio) + '</b>') + fila('Retiradas y gastos personales de los socios', eur(b.socios), 'No deducible.') + fila('Margen por hora (obra de referencia' + (b.ref ? ': ' + esc(b.ref.job.trabajo || '') + ', ' + h1(b.ref.H) + ' h, ' + eur(b.ref.ingH, 2) + ' por hora' : '') + ')', isFinite(b.margenH) ? eur(b.margenH, 2) : 'sin dato', 'Precio por hora actual − coste de máquina por hora productiva. ' + badge('estimada') + (b.ref && b.ref.cobertura < 1 ? ' Solo ' + Math.round(b.ref.cobertura * 100) + ' % de las horas tienen coste de máquina.' : '')) + fila('Trabajo pendiente en cola', b.backlog ? h1(b.backlog) + ' h' : 'sin duración conocida', b.pendientes + ' trabajos pendientes, ' + b.nBack + ' con duración'))
    + card('Montar escenario', '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;"><label style="font-size:12px;"><input type="checkbox" ' + (bd.socios8 ? 'checked' : '') + ' onchange="RENT.build.socios8=this.checked;RENT.repinta()"> Rafa y Manolo 8 h L-V</label><label style="font-size:12px;">Operarios <select onchange="RENT.build.operarios=+this.value;RENT.repinta()">' + [0, 1, 2, 3].map(n => '<option ' + (bd.operarios === n ? 'selected' : '') + '>' + n + '</option>').join('') + '</select></label><label style="font-size:12px;"><input type="checkbox" ' + (bd.mecanico ? 'checked' : '') + ' onchange="RENT.build.mecanico=this.checked;RENT.repinta()"> Mecánico</label><label style="font-size:12px;"><input type="checkbox" ' + (bd.mecCond ? 'checked' : '') + ' onchange="RENT.build.mecCond=this.checked;RENT.repinta()"> Mecánico-conductor</label><button type="button" class="btn" onclick="RENT.escAdd()">Guardar y comparar</button></div><div style="font-size:11px;color:var(--ink-soft);margin-top:6px;">Vista previa: <b>' + esc(nb.nombre) + '</b> → ' + eur(nb.beneficio) + ' al año (' + (nb.dBenef >= 0 ? '+' : '') + eur(nb.dBenef) + ' sobre hoy). Todo escenario es una ' + badge('estimada') + '</div>')
    + card('Comparación', R.tablaEsc(b, P.escenarios || []))
    + card('Obra de referencia (precio por hora y mezcla de máquinas)', '<select onchange="RENT.setRef(this.value)" style="font-size:12.5px;max-width:100%;"><option value="">Automática: nave avícola</option>' + (P.jobs || []).filter(j => (R.asignar(P).porJob[j.id] || []).length).map(j => '<option value="' + j.id + '"' + (R.param.refJob === j.id ? ' selected' : '') + '>' + esc(j.trabajo || j.id) + '</option>').join('') + '</select><div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">Solo cuentan las líneas con horas. De aquí salen el precio actual por hora de cada máquina y el margen por hora del simulador.</div>')
    + card('Hipótesis (editables)', '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + inp('jornadas', 'Jornadas al año', 'd') + inp('ocupacion', 'Ocupación productiva', '% de la jornada con máquina trabajando') + inp('indisponibilidad', 'Averías / paradas', '% de tiempo') + inp('reduccionAverias', 'Reducción con mecánico', '% de las averías') + inp('ahorroTaller', 'Ahorro en taller con mecánico', '%') + inp('condMecPct', 'Mecánico-conductor conduce', '% del tiempo') + inp('horasMecanicaSemana', 'Horas de mecánica de los socios', 'h/semana') + inp('impuesto', 'Impuestos', '% sobre beneficio') + inp('vidaUtil', 'Vida útil maquinaria', 'años') + inp('residualPct', 'Valor residual', '%') + '</div><div style="font-size:11px;color:var(--ink-soft);margin-top:6px;">Estos valores son hipótesis tuyas, no datos. La capacidad extra solo se factura si hay trabajo pendiente en cola; no se supone que más horas = más ingresos.</div>');
};
R.secComp = (r, P, b) => {
  if(!r || r.vacio) return card('', '<div style="font-size:12.5px;">Elige una obra con albaranes en el apartado 1 para ver las conclusiones.</div>');
  return card('Conclusiones: ' + esc(r.job.trabajo || 'obra'), R.conclusiones(r, P, b).map(([a, c]) => '<div style="margin-bottom:9px;"><div style="font-weight:700;font-size:12.5px;">' + esc(a) + '</div><div style="font-size:12.5px;">' + esc(c) + '</div></div>').join('') + '<div style="font-size:11px;color:var(--orange);">Las cifras estimadas están marcadas en cada apartado. Las conclusiones de contratación son del conjunto de la empresa, no de esta obra.</div>');
};
R.vista = function(P){
  const asig = R.asignar(P), b = R.base12(P);
  const calc = j => { try{ return R.calcular(j, P, asig); }catch(e){ return {vacio: true, job: j, error: e.message}; } };
  const jobs = (P.jobs || []).filter(j => j.estado !== 'Cancelado'), todos = jobs.map(calc), con = todos.filter(x => !x.vacio).sort((a, c) => c.hasta.localeCompare(a.hasta));
  if(!R.sel || !con.some(x => x.job.id === R.sel)) R.sel = con[0] ? con[0].job.id : null;
  const r = con.find(x => x.job.id === R.sel) || {vacio: true}; R._r = r; R._asig = asig;
  const tabs = ['Resultado directo', 'Beneficio real', 'Coste de oportunidad', 'Simulador', 'Comparativa'].map((t, i) => '<button type="button" class="docs-tab ' + (R.tab === i + 1 ? 'active' : '') + '" onclick="RENT.setTab(' + (i + 1) + ')">' + (i + 1) + '. ' + t + '</button>').join('');
  const dep = (P.jobs || []).filter(j => j.estado !== 'Cancelado' && !asig.porJob[j.id].length).length;
  const selector = '<select onchange="RENT.setSel(this.value)" style="width:100%;margin-bottom:8px;">' + con.map(x => '<option value="' + x.job.id + '" ' + (x.job.id === R.sel ? 'selected' : '') + '>' + esc((x.job.trabajo || 'Obra') + ' · ' + (x.job.cliente || '') + ' · ' + eur(x.beneficioReal)) + '</option>').join('') + '</select>';
  const amb = asig.ambiguos.length ? card('Albaranes por asignar (' + asig.ambiguos.length + ')', '<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:6px;">El mismo cliente tiene varias obras abiertas en esas fechas. No se reparten solos para no mezclar obras.</div>' + asig.ambiguos.slice(0, 8).map(a => '<div style="font-size:12px;padding:3px 0;">' + esc((a.doc.numero || 'albarán') + ' · ' + R.fechaRef(a.doc) + ' · ' + eur(R.baseIngreso(a.doc))) + ' <select onchange="if(this.value)RENT.asignarAlb(\'' + a.doc.id + '\',this.value)"><option value="">asignar a…</option>' + a.candidatos.map(id => { const j = jobs.find(x => x.id === id); return '<option value="' + id + '">' + esc(j ? j.trabajo : id) + '</option>'; }).join('') + '</select></div>').join('')) : '';
  let cuerpo;
  if(R.tab === 4) cuerpo = R.secSim(P, b);
  else if(!con.length) cuerpo = card('', '<div style="font-size:12.5px;">Todavía no hay obras con albaranes asignados. ' + (asig.sinAsignar.length ? asig.sinAsignar.length + ' albaranes sin obra reconocible.' : '') + '</div>') + amb;
  else cuerpo = selector + (r.vacio ? '' : (r.avisos.length ? '<div style="font-size:11.5px;color:var(--orange);margin-bottom:8px;">' + r.avisos.map(a => '• ' + esc(a)).join('<br>') + '</div>' : '') + R.sinHorasAviso(r)) + (r.vacio ? '' : (R.tab === 1 ? R.secDirecto(r) : R.tab === 2 ? R.secReal(r) : R.tab === 3 ? R.secOport(r) : R.secComp(r, P, b))) + (R.tab <= 2 ? amb : '');
  const albs = !r.vacio && R.tab === 1 ? card('Documentos incluidos (una factura sustituye a sus albaranes)', r.albs.map(d => fila(esc((d.tipo === 'albaran' ? 'Albarán ' : d.tipo === 'proforma' ? 'Proforma ' : 'Factura ') + (d.numero || '') + ' · ' + R.fechaRef(d)) + ' <i style="font-size:11px;">(' + ((asig.origen[d.id] || {}).como || '?') + ')</i>', eur(R.baseIngreso(d)) + ' <a href="#" onclick="RENT.excluirAlb(\'' + d.id + '\',\'' + r.job.id + '\');return false" style="font-size:11px;">quitar</a>')).join('')) : '';
  const hist = !r.vacio && R.tab === 2 && R.hist ? card('Histórico de cálculos', (R.hist.length ? R.hist.map(h => fila(new Date(h.created_at).toLocaleDateString('es-ES'), eur(h.resultado && h.resultado.beneficioReal))).join('') : '<div style="font-size:12px;">Primer cálculo guardado hoy.</div>')) : '';
  const manual = !r.vacio && R.tab <= 2 ? (() => { const m = (P.imput || []).filter(i => i.job_id === r.job.id); return m.length ? card('Correcciones manuales', m.map(i => fila(esc(i.concepto) + ' <span style="font-size:11px;">(' + i.modo + ', ' + i.origen + ', ' + new Date(i.created_at).toLocaleDateString('es-ES') + ')</span>', eur(i.importe) + ' <a href="#" onclick="RENT.quitarImp(\'' + i.id + '\');return false" style="font-size:11px;">deshacer</a>', esc(i.nota || ''))).join('')) : ''; })() : '';
  return '<div class="panel te-panel"><div style="font-weight:800;font-size:15px;margin-bottom:6px;">Rentabilidad de trabajos</div><div class="docs-tabs" style="margin:0 0 10px;display:flex;flex-wrap:wrap;gap:4px;">' + tabs + '</div>' + cuerpo + albs + manual + hist + '<div style="font-size:11px;color:var(--ink-soft);margin-top:6px;"><a href="#" onclick="RENT.recargar();return false">Actualizar datos</a> · ' + dep + ' obras sin albaranes asignados no se calculan.' + (R.errores && R.errores.length ? ' Fallos al leer: ' + esc(R.errores.join(', ')) : '') + '</div></div>';
};
// ---- acciones ----
const guarda = async (q, nota) => { const {error} = await q; if(error){ alert('No se pudo guardar' + (nota ? ' (' + nota + ')' : '') + ': ' + error.message); return false; } return true; };
R.repinta = () => { if(R.el && R.P) R.el.innerHTML = R.vista(R.P); };
R.setTab = n => { R.tab = n; R.repinta(); R.snapshot(); };
R.setSel = id => { R.sel = id; R.repinta(); R.snapshot(); };
R.recargar = async () => { R.invalidar(); if(R.el) await R.pintar(R.el, true); };
R.param_ = async () => { const P = R.P; const data = {...R.param}; if(P.paramId) await guarda(sb.from('sistema').update({data}).eq('id', P.paramId), 'hipótesis'); else { const {data: d, error} = await sb.from('sistema').insert({tipo: 'rent_parametros', data}).select('id').single(); if(!error && d) P.paramId = d.id; } };
R.setRef = async id => { R.param.refJob = id || null; await R.param_(); if(R.P) delete R.P._ref; R.repinta(); };
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
R.escGuardar = async () => { const P = R.P, data = {lista: P.escenarios}; if(P.escId) await guarda(sb.from('sistema').update({data}).eq('id', P.escId), 'escenarios'); else { const {data: d, error} = await sb.from('sistema').insert({tipo: 'rent_escenarios', data}).select('id').single(); if(!error && d) P.escId = d.id; } };
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
