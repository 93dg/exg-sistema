// Normalización y distribución de costes (Gastos). Importe original + periodicidad real → equivalentes automáticos; reparto por recurso; total empresa.
// Usa los datos que ya carga Rentabilidad (RENT.cargar) para no duplicar lecturas. Todo sin IVA.
(function(){
const C = window.COSTES = {};
const U = () => window.RENT.util;
const DEF = {diasLab: 217, horasJornada: 8, diasNat: 365, horasNat: 8760, incluirB: true, horasProd: {}, usoVeh: {}, convenio: {maquinista: 38629, oficial2: 37203.8}};
C.cfg = JSON.parse(JSON.stringify(DEF)); C.cfgId = null; C.D = null;
const FREQ = {mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1};
const CLASES_MAQ = ['mixta', 'camion', 'giratoria', 'niveladora', 'rulo', 'cuba'];
const NOM = {mixta: 'Mixta (retro)', camion: 'Camión', giratoria: 'Giratoria', niveladora: 'Niveladora', rulo: 'Rulo', cuba: 'Cuba de agua', desplazamiento: 'Coches de empresa (desplazamiento a obras)', pool: 'Flota sin asignar a máquina'};

// ---- a qué grupo de coste y a qué criterio de reparto pertenece cada categoría ----
const GRUPOS = {
  flota: ['Máquinas y vehículos', 'horas productivas de cada máquina'],
  personal: ['Personal y autónomos', 'horas de jornada'],
  estructura: ['Estructura de la empresa', 'días laborables'],
  obra: ['Directo de obra (subcontratas, vertedero)', 'se imputa a la obra concreta'],
  socios: ['Retiradas y gastos personales de los socios (incluye coches personales de Rafa)', 'no es coste de explotación'],
  ajeno: ['No es de la empresa (coche de Alberto)', 'no es coste de explotación'],
  fuera: ['Fuera de la explotación (Hacienda, compra de vehículos)', 'no es coste de explotación'],
  sin: ['Sin clasificar', 'revisar']
};
C.GRUPOS = GRUPOS;
C.grupoDe = cat => {
  const t = String(cat || '');
  if(/gasto personal/i.test(t)) return 'socios';
  if(/hacienda|embargo|compra de veh/i.test(t)) return 'fuera';
  if(/subcontrat|vertedero/i.test(t)) return 'obra';
  if(/combust|repuest|recambio|lubric|neum|taller|^seguros?$|impuestos y tasas/i.test(t)) return 'flota';
  if(/n[oó]mina|^personal|seguridad social/i.test(t)) return 'personal';
  if(/alquiler|gestor|financ|comisi|pr[eé]stamo|tecnolog|software|suministro|ferreter|prevenci|electric|amazon|bazar|cooperativa|compras varias/i.test(t)) return 'estructura';
  return 'sin';
};
const claseFlota = f => { const t = ((f && f.nombre) || '') + ' ' + ((f && f.clase) || ''); if(/todoterreno|turismo|coche|audi|hyundai|range|nissan/i.test(t)) return 'turismo'; if(/mixta/i.test(t)) return 'mixta'; if(/cami[oó]n|iveco|multilift/i.test(t)) return 'camion'; if(/giratoria/i.test(t)) return 'giratoria'; if(/niveladora/i.test(t)) return 'niveladora'; if(/rulo/i.test(t)) return 'rulo'; if(/cuba/i.test(t)) return 'cuba'; return 'turismo'; };

// ---- uso de cada vehículo: lo que Daniel ha dicho (Nissan X-Trail y Hyundai Matrix = coches de empresa; los dos Audi = personales de Rafa, aunque fiscalmente se deduzcan como mixtos; Galloper averiado; Evoque = Alberto) ----
const USOS = {maquina: 'Máquina', empresa: 'Coche de empresa', socio: 'Personal de Rafa', alberto: 'De Alberto', averiado: 'Averiado, sin uso'};
C.USOS = USOS;
C.usoDe = f => { if(!f) return null; const m = C.cfg.usoVeh && C.cfg.usoVeh[f.id]; if(m) return m; if(claseFlota(f) !== 'turismo') return 'maquina'; const t = (f.nombre || '') + ' ' + (f.matricula || ''); if(/x-trail|matrix/i.test(t)) return 'empresa'; if(/audi/i.test(t)) return 'socio'; if(/galloper/i.test(t)) return 'averiado'; if(/evoque|range/i.test(t)) return 'alberto'; return 'empresa'; };
const usoTexto = t => { t = String(t || ''); if(/retroexcavadora|liebherr|nissan|x-trail|mixta|iveco|cami[oó]n/i.test(t)) return null; if(/evoque|range rover/i.test(t)) return 'alberto'; if(/audi|galloper/i.test(t)) return 'socio'; if(/hyundai matrix/i.test(t)) return 'empresa'; return null; };

// ---- conversiones automáticas a partir del importe ANUAL ----
C.aplicarCfg = row => { if(row){ C.cfgId = row.id; C.cfg = {...JSON.parse(JSON.stringify(DEF)), ...(row.data || {})}; } };
C.conv = anual => {
  const c = C.cfg, hJ = c.diasLab * c.horasJornada;
  return {anual, mes: anual / 12, diaNat: anual / c.diasNat, diaLab: c.diasLab ? anual / c.diasLab : null, horaNat: anual / c.horasNat, horaJ: hJ ? anual / hJ : null};
};

// ---- carga ----
C.cargar = async function(forzar){
  const P = await window.RENT.cargar(forzar);
  if(C.D && !forzar && C.D.P === P) return C.D;
  try{ const {data} = await sb.from('sistema').select('id,data').eq('tipo', 'costes_config').limit(1); if(data && data[0]){ C.cfgId = data[0].id; C.cfg = {...JSON.parse(JSON.stringify(DEF)), ...(data[0].data || {})}; } }catch(e){ console.error('COSTES config', e); }
  let contratos = []; try{ const {data} = await sb.from('contratos_recurrentes').select('id,nombre,categoria,afecta_a,flota_id,importe,periodicidad,coste_anual,estado').order('categoria'); contratos = data || []; }catch(e){ console.error('COSTES contratos', e); }
  C.D = C.calcular(P, contratos); return C.D;
};

C.calcular = function(P, contratos){
  const { sum, num, addDays } = U(), R = window.RENT, c = C.cfg;
  const hoy = new Date().toISOString().slice(0, 10), W0 = addDays(hoy, -364);
  const ev = R.empresaVentana(P, hoy);
  const flotaById = new Map((P.flota || []).map(f => [f.id, f]));
  // horas productivas por clase: reales (albaranes 12 m) salvo que se haya fijado a mano
  const horasProd = {}; let hMaq = 0;
  CLASES_MAQ.forEach(k => { const man = c.horasProd && c.horasProd[k] != null && c.horasProd[k] !== '' ? num(c.horasProd[k]) : null, real = num(ev.horasClase[k]); horasProd[k] = {h: man != null ? man : real, real, manual: man != null}; hMaq += horasProd[k].h; });
  const gW = (P.gastos || []).filter(g => g.fecha_devengo >= W0 && g.fecha_devengo <= hoy && (g.relacion_actividad == null || g.relacion_actividad === 'relacionada') && (c.incluirB || g.contabilidad !== 'en_b'));
  const porCat = new Map(), porGrupo = {}, porClase = {}, varClase = {}; const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const fijoCatC = {}, fijoCatPool = {}; const addC = (k, cat, v) => { (fijoCatC[k] = fijoCatC[k] || {}); add(fijoCatC[k], cat, v); };   // V11.49: de qué se componen los costes fijos de cada clase (para el desglose en Ren. obras)
  let nB = 0, baseB = 0;
  gW.forEach(g => {
    const base = R.baseGasto(g), cat = g.categoria || '(sin categoría)', esB = g.contabilidad === 'en_b', veh = g.vehiculo_id ? flotaById.get(g.vehiculo_id) : null;
    let grupo = C.grupoDe(cat), uso = veh ? C.usoDe(veh) : usoTexto(g.concepto), recl = false;
    if(grupo !== 'fuera' && grupo !== 'socios'){   // un gasto de vehículo manda el uso del vehículo sobre la categoría
      if(uso === 'socio'){ grupo = 'socios'; recl = true; } else if(uso === 'alberto'){ grupo = 'ajeno'; recl = true; } else if(uso === 'averiado'){ grupo = 'fuera'; recl = true; }
      else if(uso === 'empresa' && grupo !== 'personal'){ grupo = 'flota'; }
    }
    const e = porCat.get(cat + '|' + grupo) || {cat, grupo, base: 0, baseB: 0, n: 0, recl: 0}; e.base += base; e.n++; if(recl) e.recl++; if(esB){ e.baseB += base; baseB += base; nB++; } porCat.set(cat + '|' + grupo, e);
    add(porGrupo, grupo, base);
    if(grupo === 'flota'){
      if(uso === 'empresa'){ add(porClase, 'desplazamiento', base); return; }
      const esVar = /combust|repuest|recambio|lubric|neum|taller/i.test(cat);
      if(veh && uso === 'maquina'){ add(porClase, claseFlota(veh), base); if(esVar) add(varClase, claseFlota(veh), base); else addC(claseFlota(veh), cat, base); return; }
      add(porClase, 'pool', base); if(esVar) add(varClase, 'pool', base); else add(fijoCatPool, cat, base);
    }
  });
  // reparto del pool de flota por horas de utilización de cada clase
  const poolF = porClase.pool || 0, poolV = varClase.pool || 0, clases = [];
  CLASES_MAQ.forEach(k => {
    const h = horasProd[k].h, directo = porClase[k] || 0, parte = hMaq ? poolF * h / hMaq : 0, total = directo + parte, variable = (varClase[k] || 0) + (hMaq ? poolV * h / hMaq : 0), fijo = total - variable;
    if(!h && !directo) return;
    const fijoCat = Object.assign({}, fijoCatC[k] || {}); if(hMaq) Object.keys(fijoCatPool).forEach(ct => { fijoCat[ct] = (fijoCat[ct] || 0) + fijoCatPool[ct] * h / hMaq; });
    clases.push({clase: k, nombre: NOM[k], fijoCat, h, hReal: horasProd[k].real, manual: horasProd[k].manual, directo, parte, total, variable, fijo, ...C.conv(total), horaProd: h ? total / h : null, horaFija: h ? fijo / h : null, maquinas: (P.flota || []).filter(f => claseFlota(f) === k && C.usoDe(f) === 'maquina' && f.estado !== 'vendida')});
  });
  if(porClase.desplazamiento) clases.push({clase: 'desplazamiento', nombre: NOM.desplazamiento, h: 0, directo: porClase.desplazamiento, parte: 0, total: porClase.desplazamiento, ...C.conv(porClase.desplazamiento), horaProd: null, maquinas: (P.flota || []).filter(f => C.usoDe(f) === 'empresa' && f.estado !== 'vendida')});
  // amortización (provisión): solo con precio de compra conocido
  const amort = (P.flota || []).filter(f => f.estado !== 'vendida' && ['maquina', 'empresa'].includes(C.usoDe(f))).map(f => {
    const compra = f.coste_compra != null ? num(f.coste_compra) : null, vida = num(R.param.vidaUtil) || 10, res = num(R.param.residualPct) || 0;
    return {id: f.id, nombre: f.nombre, clase: claseFlota(f), uso: C.usoDe(f), compra, anual: compra ? compra * (1 - res / 100) / vida : null};
  });
  const amortTot = sum(amort.filter(a => a.anual != null), a => a.anual);
  // contratos: importe original + periodicidad real → anual recalculado
  const ctr = (contratos || []).filter(k => k.estado !== 'cancelado').map(k => {
    const f = FREQ[String(k.periodicidad || '').toLowerCase()], imp = k.importe != null ? num(k.importe) : null, anualCalc = imp != null && f ? imp * f : null, reg = k.coste_anual != null ? num(k.coste_anual) : null;
    return {...k, frec: f || null, imp, anualCalc, reg, cuadra: anualCalc != null && reg != null ? Math.abs(anualCalc - reg) <= 1 : null};
  });
  const expl = ['flota', 'personal', 'estructura', 'obra'].reduce((s, k) => s + (porGrupo[k] || 0), 0);
  const hJ = c.diasLab * c.horasJornada;
  return {P, hoy, W0, gastos: gW.length, nB, baseB, porCat: [...porCat.values()].sort((a, b) => b.base - a.base), porGrupo, clases, hMaq, horasEmpresa: ev.horas, diasActividad: ev.dias, amort, amortTot, ctr, expl, hJ, total: {registrado: expl, provision: amortTot, economico: expl + amortTot}};
};

// ---- API para Rentabilidad ----
C.horaProductiva = clase => { const k = C.D && C.D.clases.find(x => x.clase === clase); return k ? k.horaProd : null; };
C.diaEstructura = () => C.D ? (C.D.porGrupo.estructura || 0) / C.cfg.diasLab : null;

// ---- pantalla ----
const f2 = n => n == null || !isFinite(n) ? '—' : U().eur(n, Math.abs(n) < 100 ? 2 : 0);
const esc = s => U().esc(s);
const card = (t, inner, st) => '<div class="tb-cos" style="margin-bottom:10px;' + (st || '') + '">' + (t ? '<div style="font-weight:800;font-size:13.5px;margin-bottom:6px;">' + t + '</div>' : '') + inner + '</div>';
const nota = t => '<div style="font-size:11.5px;color:var(--ink-soft);margin:4px 0 6px;">' + t + '</div>';
const nivel = (t, c) => '<span style="font-size:10.5px;padding:1px 6px;border-radius:8px;background:' + c + '22;color:' + c + ';white-space:nowrap;">' + t + '</span>';
const REAL = nivel('Registrado', '#2e7d32'), CALC = nivel('Calculado', '#1565c0'), PROV = nivel('Provisión', '#6a1b9a'), FALTA = nivel('Falta dato', '#c62828'), EST = nivel('Estimado', '#ef6c00');
const TH = 'text-align:right;padding:3px 6px;font-size:11px;color:var(--ink-soft);white-space:nowrap;', TD = 'text-align:right;padding:3px 6px;font-size:12px;white-space:nowrap;border-top:1px solid var(--line,#0001);';
const CAB = '<th style="' + TH + 'text-align:left;">Concepto</th><th style="' + TH + '">Año</th><th style="' + TH + '">Mes</th><th style="' + TH + '">Día natural</th><th style="' + TH + '">Día laborable</th><th style="' + TH + '">Hora natural</th><th style="' + TH + '">Hora jornada</th>';
const celdas = v => '<td style="' + TD + '"><b>' + f2(v.anual) + '</b></td><td style="' + TD + '">' + f2(v.mes) + '</td><td style="' + TD + '">' + f2(v.diaNat) + '</td><td style="' + TD + '">' + f2(v.diaLab) + '</td><td style="' + TD + '">' + f2(v.horaNat) + '</td><td style="' + TD + '">' + f2(v.horaJ) + '</td>';
// V9.71 (Daniel: «esto no está pensado para móvil»): en pantallas estrechas cada fila de la tabla pasa a ser una tarjeta (nombre arriba, cifras en dos columnas con su etiqueta)
if(!document.getElementById('nm-css')){ const st = document.createElement('style'); st.id = 'nm-css'; st.textContent = '@media (max-width:700px){table.nm-t{min-width:0 !important;display:block;} table.nm-t thead{display:none;} table.nm-t tbody{display:block;} table.nm-t tr{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;padding:10px 12px;margin:0 0 8px;border:1px solid var(--line,#0002);border-radius:14px;background:var(--paper,#fff);} table.nm-t td{display:block;border:0 !important;padding:2px 0 !important;text-align:left !important;white-space:normal !important;font-size:13px !important;} table.nm-t td:first-child,table.nm-t td[colspan]{grid-column:1/-1;font-size:14px !important;padding-bottom:4px !important;} table.nm-t td[data-l]:not(:first-child)::before{content:attr(data-l);display:block;font-size:10.5px;font-weight:600;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.03em;} table.nm-t td[data-l]:not(:first-child){font-weight:700;}}'; document.head.appendChild(st); }
const tabla = (cab, filas) => {
  const labs = (cab.match(/<th[^>]*>(.*?)<\/th>/g) || []).map(t => t.replace(/<[^>]+>/g, ''));
  const f2 = filas.replace(/<tr>([\s\S]*?)<\/tr>/g, (m, inner) => { let i = 0; return '<tr>' + inner.replace(/<td([^>]*)>/g, (mm, at) => { const l = labs[i] || ''; i += /colspan="(\d+)"/.test(at) ? +RegExp.$1 : 1; return /colspan/.test(at) ? mm : '<td' + at + ' data-l="' + l.replace(/"/g, '') + '">'; }) + '</tr>'; });
  return '<div style="overflow-x:auto;"><table class="nm-t" style="border-collapse:collapse;width:100%;min-width:620px;"><thead><tr>' + cab + '</tr></thead><tbody>' + f2 + '</tbody></table></div>';
};
const inp = (v, fn, w) => '<input type="text" inputmode="decimal" value="' + (v == null ? '' : v) + '" onchange="' + fn + '" style="width:' + (w || 70) + 'px;text-align:right;font-size:12.5px;padding:2px 4px;">';

// V11.51 (reporte 4e562a8a: «esta sección da asco, el diseño es antidiseño web»): como Control y Ren. obras: tarjetas blancas con líneas (nombre a la izquierda, importe a la derecha),
// cada línea se toca y se despliega ahí mismo con su desglose (mes, día laborable, hora de jornada…); sin tablas, sin mayúsculas de etiqueta y sin textos largos
if(!document.getElementById('nm2-css')){ const st = document.createElement('style'); st.id = 'nm2-css'; st.textContent = `
.nm2-c{background:var(--paper,#fff);border:1px solid var(--line);border-radius:14px;padding:10px 14px;margin:0 0 10px;}
.nm2-c>h3{font-size:14px;font-weight:800;margin:2px 0 6px;}
.nm2-l>summary{list-style:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}.nm2-l>summary::-webkit-details-marker{display:none}
.nm2-r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:13px;line-height:1.25;}
.nm2-c>.nm2-r:first-of-type,.nm2-c>h3+.nm2-l>summary>.nm2-r,.nm2-c>h3+.nm2-r,.nm2-c>h3+.nm2-g>summary>.nm2-r{border-top:0;}
.nm2-r>span{min-width:0;}.nm2-r>span small{display:block;font-size:11px;color:var(--ink-soft);}
.nm2-r>b{white-space:nowrap;text-align:right;flex-shrink:0;font-weight:800;}.nm2-r>b small{display:block;font-size:11px;font-weight:700;color:var(--ink-soft);}
.nm2-l[open]>summary>.nm2-r{border-left:2px solid var(--orange);padding-left:8px;}
.nm2-d{padding:0 0 6px 10px;}.nm2-d .nm2-r{font-size:12px;padding:5px 0;}
.nm2-g>summary{list-style:none;cursor:pointer}.nm2-g>summary::-webkit-details-marker{display:none}.nm2-g>summary .nm2-r{font-weight:800;}
.nm2-g[open]>summary .nm2-r{border-left:2px solid var(--orange);padding-left:8px;}.nm2-g>.nm2-gb{padding-left:10px;}
.nm2-tot .nm2-r{font-weight:800;font-size:13.5px;}
.nm2-falta{color:var(--red);}
.nm2-c input[type=text]{width:84px;text-align:right;font-size:13px;padding:3px 6px;border:1px solid var(--line);border-radius:8px;background:var(--paper,#fff);font-family:inherit;}
.nm2-c select{font-size:12.5px;padding:3px 6px;border:1px solid var(--line);border-radius:8px;background:var(--paper,#fff);font-family:inherit;max-width:150px;}
`; document.head.appendChild(st); }
C.vista = function(D){
  const c = C.cfg, { eur } = U(), hJ = D.hJ, h1 = U().h1;
  const fila = (izq, der, sub, subD, cls) => '<div class="nm2-r' + (cls ? ' ' + cls : '') + '"><span>' + izq + (sub ? '<small>' + sub + '</small>' : '') + '</span><b>' + der + (subD ? '<small>' + subD + '</small>' : '') + '</b></div>';
  const lin = (izq, der, cuerpo, sub, subD) => cuerpo ? '<details class="nm2-l"><summary>' + fila(izq, der, sub, subD) + '</summary><div class="nm2-d">' + cuerpo + '</div></details>' : fila(izq, der, sub, subD);
  const eqv = v => fila('Al mes', f2(v.mes)) + fila('Por día laborable', f2(v.diaLab)) + fila('Por hora de jornada', f2(v.horaJ)) + fila('Por día natural', f2(v.diaNat));
  const card2 = (t, inner) => '<div class="nm2-c"><h3>' + t + '</h3>' + inner + '</div>';
  let h = '';
  // V12.89 (reporte f6d3e6e7): en Resumen solo va lo que no está repetido en otro sitio: coste de la empresa y coste por máquina;
  // los datos con los que se calcula (amortización, convenio, uso de vehículos, ajustes y si cuentan los gastos en B) van plegados en «Ajustes de costes».
  // Gastos por categoría (ya está en Resumen) y Contratos (ya está en Recurrentes) no salen.
  const enResumen = C.modo === 'resumen', partes = {};
  // 1. Lo que cuesta la empresa
  const t = D.total, hpE = D.hMaq ? t.economico / D.hMaq : null;
  h += card2('Coste de la empresa (12 meses)',
    [['Máquinas y vehículos', D.porGrupo.flota || 0], ['Personal y autónomos', D.porGrupo.personal || 0], ['Estructura', D.porGrupo.estructura || 0], ['Directo de obra', D.porGrupo.obra || 0]].map(([n, v]) => lin(n, f2(v), eqv(C.conv(v)))).join('')
    + '<div class="nm2-tot">' + lin('Coste de explotación', f2(t.registrado), eqv(C.conv(t.registrado))) + '</div>'
    + lin('Amortización', D.amortTot ? f2(t.provision) : '<span class="nm2-falta">Falta precio</span>', D.amortTot ? eqv(C.conv(t.provision)) : '', D.amort.filter(a => a.anual != null).length + ' de ' + D.amort.length + ' máquinas con precio')
    + '<div class="nm2-tot">' + lin('Coste total', f2(t.economico), eqv(C.conv(t.economico)) + fila('Por hora de máquina', f2(hpE), h1(D.hMaq) + ' h productivas')) + '</div>'
    + fila('Fuera: retiradas y gastos de socios', f2(D.porGrupo.socios || 0)) + fila('Fuera: Hacienda y compra de vehículos', f2(D.porGrupo.fuera || 0)) + (D.porGrupo.sin ? fila('Sin clasificar', f2(D.porGrupo.sin)) : ''));
  // 2. Por máquina
  h += card2('Coste por máquina', D.clases.map(k => {
    const cuerpo = (k.clase !== 'desplazamiento' ? fila('Horas productivas', '<input type="text" inputmode="decimal" placeholder="' + h1(k.hReal) + '" value="' + (k.manual ? k.h : '') + '" onchange="COSTES.setHP(\'' + k.clase + '\',this.value)">', 'Reales: ' + h1(k.hReal) + ' h (vacío = reales)') : '')
      + fila('Al año', f2(k.total)) + fila('Al mes', f2(k.mes)) + fila('Suyo directo', f2(k.directo)) + fila('Parte del resto de la flota', f2(k.parte)) + (k.maquinas.length ? fila('Máquinas', '', k.maquinas.map(m => esc(m.nombre)).join(', ')) : '');
    return lin(esc(k.nombre), k.horaProd != null ? f2(k.horaProd) + '/h' : f2(k.total), cuerpo, k.clase !== 'desplazamiento' ? h1(k.h) + ' h' : '', k.horaProd != null ? f2(k.total) + ' al año' : 'al año');
  }).join(''));
  const hBase = h;
  // 3. Gastos por categoría
  h += card2('Gastos por categoría (12 meses)', Object.keys(GRUPOS).filter(k => D.porGrupo[k]).map(k => {
    const cats = D.porCat.filter(x => x.grupo === k);
    return '<details class="nm2-g"><summary>' + fila(GRUPOS[k][0], f2(D.porGrupo[k]), 'Se reparte por ' + GRUPOS[k][1]) + '</summary><div class="nm2-gb">'
      + cats.map(x => lin(esc(x.cat), f2(x.base), fila('Documentos', x.n + (x.baseB ? ' · ' + f2(x.baseB) + ' en B' : '')) + eqv(C.conv(x.base)))).join('') + '</div></details>';
  }).join('') + fila('Incluir gastos en B', '<input type="checkbox" ' + (c.incluirB ? 'checked' : '') + ' onchange="COSTES.toggleB(this.checked)">'));
  // 4. Contratos
  h += card2('Contratos recurrentes', D.ctr.map(k => {
    const falta = k.imp == null, dif = k.cuadra === false;
    return lin(esc(k.nombre), falta ? '<span class="nm2-falta">Sin importe</span>' : f2(k.anualCalc), falta ? '' : fila('Importe', f2(k.imp), '', esc(k.periodicidad || '')) + (dif ? fila('Coste anual apuntado', '<span class="nm2-falta">' + f2(k.reg) + '</span>', 'No cuadra con importe × periodicidad') : '') + eqv(C.conv(k.anualCalc)), '', falta ? '' : 'al año');
  }).join('') || fila('Sin contratos', ''));
  const hAntesAmort = h;
  // 5. Amortización
  h += card2('Amortización de maquinaria', D.amort.map(a => lin(esc(a.nombre), a.anual != null ? f2(a.anual) : '<span class="nm2-falta">Falta precio</span>', fila('Precio de compra', '<input type="text" inputmode="decimal" value="' + (a.compra == null ? '' : a.compra) + '" onchange="COSTES.setCompra(\'' + a.id + '\',this.value)">') + (a.anual != null ? eqv(C.conv(a.anual)) : ''), '', a.anual != null ? 'al año' : '')).join(''));
  // 6. Trabajadores (convenio)
  const cv = c.convenio;
  h += card2('Coste de un trabajador (convenio)', [['maquinista', 'Maquinista / oficial 1ª'], ['oficial2', 'Oficial 2ª']].map(([kk, n]) => lin(n, f2(num(cv[kk])), fila('Coste anual de empresa', '<input type="text" inputmode="decimal" value="' + (cv[kk] == null ? '' : cv[kk]) + '" onchange="COSTES.setConv(\'' + kk + '\',this.value)">') + eqv(C.conv(num(cv[kk]))), '', 'al año')).join(''));
  // 7. Uso de cada vehículo
  h += card2('Uso de cada vehículo', (D.P.flota || []).filter(f => f.estado !== 'vendida').map(f => fila(esc(f.nombre), '<select onchange="COSTES.setUso(\'' + f.id + '\',this.value)">' + Object.entries(USOS).map(([k, l]) => '<option value="' + k + '"' + (C.usoDe(f) === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>', esc(f.matricula || ''))).join(''));
  // 8. Ajustes
  h += card2('Ajustes', fila('Días laborables al año', '<input type="text" inputmode="numeric" value="' + c.diasLab + '" onchange="COSTES.set(\'diasLab\',this.value)">') + fila('Horas de jornada al día', '<input type="text" inputmode="decimal" value="' + c.horasJornada + '" onchange="COSTES.set(\'horasJornada\',this.value)">', 'Hora de jornada = ' + h1(hJ) + ' h al año') + fila('Actividad en albaranes (12 m)', h1(D.horasEmpresa) + ' h', D.diasActividad + ' días'));
  if(enResumen){
    const ajustes = h.slice(hAntesAmort.length).replace(/<div class="nm2-c"><h3>([^<]*)<\/h3>/g, '<details class="nm2-g"><summary>' + fila('$1', '') + '</summary><div class="nm2-gb">').replace(/<\/div>(?=<details class="nm2-g">|$)/g, '</div></details>');
    return hBase + card2('Ajustes de costes', fila('Incluir gastos en B', '<input type="checkbox" ' + (c.incluirB ? 'checked' : '') + ' onchange="COSTES.toggleB(this.checked)">') + ajustes);
  }
  return h;
};

C.save = async function(){
  const data = C.cfg;
  if(C.cfgId){ const {error} = await sb.from('sistema').update({data}).eq('id', C.cfgId); if(error) alert('No se pudo guardar: ' + error.message); }
  else { const {data: d, error} = await sb.from('sistema').insert({tipo: 'costes_config', data}).select('id').single(); if(error) alert('No se pudo guardar: ' + error.message); else C.cfgId = d.id; }
  C.D = null; await C.repinta();
};
const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
C.set = async (k, v) => { const n = num(v); if(n <= 0) return; C.cfg[k] = n; await C.save(); };
C.toggleB = async b => { C.cfg.incluirB = !!b; await C.save(); };
C.setHP = async (k, v) => { C.cfg.horasProd = {...(C.cfg.horasProd || {})}; if(String(v).trim() === '') delete C.cfg.horasProd[k]; else C.cfg.horasProd[k] = num(v); await C.save(); };
C.setUso = async (id, v) => { C.cfg.usoVeh = {...(C.cfg.usoVeh || {}), [id]: v}; await C.save(); };
C.setConv = async (k, v) => { C.cfg.convenio = {...C.cfg.convenio, [k]: num(v)}; await C.save(); };
C.setCompra = async (id, v) => { const n = String(v).trim() === '' ? null : num(v); const {error} = await sb.from('flota').update({coste_compra: n}).eq('id', id); if(error){ alert('No se pudo guardar: ' + error.message); return; } await C.recargar(); };
C.repinta = async () => { if(C.el) await C.pintar(C.el, false); };
C.recargar = async () => { if(window.RENT) window.RENT.invalidar(); C.D = null; if(C.el) await C.pintar(C.el, true); };
// V11.51 (reporte d80cd0e4: «¿por qué calcula costes cada vez que entro? Esto no debe pasar en ningún sitio»): se enseña al momento lo último calculado (guardado en este dispositivo)
// y se pone al día por detrás sin avisos ni «Calculando…»; lo que se abrió sigue abierto
const CACHE_K = 'costes_vista_v2';
C.pintar = async function(el, forzar){
  C.el = el;
  if(!C.D && !el.querySelector('.nm2-c')){ let html = ''; try{ html = localStorage.getItem(CACHE_K) || ''; }catch(e){} el.innerHTML = html || '<div class="nm2-c" style="font-size:13px;color:var(--ink-soft);">Cargando…</div>'; }
  try{ const D = await C.cargar(forzar); const abiertos = [...el.querySelectorAll('details[open]')].map(d => d.querySelector('summary')?.textContent); const html = C.vista(D);
    el.innerHTML = html; el.querySelectorAll('details').forEach(d => { if(abiertos.includes(d.querySelector('summary')?.textContent)) d.open = true; });
    try{ localStorage.setItem(CACHE_K, html); }catch(e){} }
  catch(e){ console.error(e); if(!el.querySelector('.nm2-c')) el.innerHTML = '<div class="nm2-c" style="font-size:13px;">No se pudieron calcular los costes: ' + esc(e.message) + '</div>'; }
};
})();
