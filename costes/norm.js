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
  const porCat = new Map(), porGrupo = {}, porClase = {}; const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
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
      if(veh && uso === 'maquina'){ add(porClase, claseFlota(veh), base); return; }
      add(porClase, 'pool', base);
    }
  });
  // reparto del pool de flota por horas de utilización de cada clase
  const poolF = porClase.pool || 0, clases = [];
  CLASES_MAQ.forEach(k => {
    const h = horasProd[k].h, directo = porClase[k] || 0, parte = hMaq ? poolF * h / hMaq : 0, total = directo + parte;
    if(!h && !directo) return;
    clases.push({clase: k, nombre: NOM[k], h, hReal: horasProd[k].real, manual: horasProd[k].manual, directo, parte, total, ...C.conv(total), horaProd: h ? total / h : null, maquinas: (P.flota || []).filter(f => claseFlota(f) === k && C.usoDe(f) === 'maquina' && f.estado !== 'vendida')});
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
const tabla = (cab, filas) => '<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;min-width:620px;"><thead><tr>' + cab + '</tr></thead><tbody>' + filas + '</tbody></table></div>';
const inp = (v, fn, w) => '<input type="text" inputmode="decimal" value="' + (v == null ? '' : v) + '" onchange="' + fn + '" style="width:' + (w || 70) + 'px;text-align:right;font-size:12.5px;padding:2px 4px;">';

C.vista = function(D){
  const c = C.cfg, { eur } = U(), hJ = D.hJ;
  let h = '';
  // 1. Parámetros
  h += card('Parámetros de conversión (una sola configuración para toda la web)',
    '<div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12.5px;align-items:center;">'
    + '<label>Días laborables/año ' + inp(c.diasLab, "COSTES.set('diasLab',this.value)") + '</label>'
    + '<label>Horas de jornada/día ' + inp(c.horasJornada, "COSTES.set('horasJornada',this.value)", 50) + '</label>'
    + '<label>Días naturales ' + inp(c.diasNat, "COSTES.set('diasNat',this.value)", 50) + '</label>'
    + '<label>Horas naturales ' + inp(c.horasNat, "COSTES.set('horasNat',this.value)", 60) + '</label>'
    + '<label><input type="checkbox" ' + (c.incluirB ? 'checked' : '') + ' onchange="COSTES.toggleB(this.checked)"> Incluir gastos en B</label></div>'
    + nota('Hora de jornada = días laborables × horas de jornada = <b>' + U().h1(hJ) + ' h</b> (convenio: 1.736 h = 217 días × 8 h). La hora natural (8.760 h) es solo referencia: nunca se usa para repartir a las obras. Horas con actividad en albaranes (12 m): <b>' + U().h1(D.horasEmpresa) + ' h</b> en <b>' + D.diasActividad + '</b> días.'));
  // 2. Tipos
  h += card('Qué es cada cosa', '<div style="font-size:12px;line-height:1.5;">' + REAL + ' gasto realmente pagado o facturado, sin IVA, últimos 12 meses (' + D.W0 + ' a ' + D.hoy + ').<br>' + CALC + ' coste obtenido por cálculo (reparto, convenio) a partir de datos registrados.<br>' + PROV + ' amortización: reserva para renovar, no es un pago. Necesita el precio de compra de cada máquina.</div>');
  const vu = (D.P.flota || []).filter(f => f.estado !== 'vendida').map(f => '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--line,#0001);"><span>' + esc(f.nombre) + ' <span style="color:var(--ink-soft);font-size:11px;">' + esc(f.matricula || '') + '</span></span><select onchange="COSTES.setUso(\'' + f.id + '\',this.value)" style="font-size:12px;">' + Object.keys(USOS).map(k => '<option value="' + k + '"' + (C.usoDe(f) === k ? ' selected' : '') + '>' + USOS[k] + '</option>').join('') + '</select></div>').join('');
  h += card('Uso de cada vehículo', vu + nota('Un gasto de un vehículo va a donde diga su uso. Nissan X-Trail y Hyundai Matrix: coches de empresa para ir a las obras. Los dos Audi: personales de Rafa, fuera del coste de explotación aunque a efectos fiscales se sigan deduciendo como mixtos (eso no se toca aquí). Galloper averiado, sin uso. El Evoque es de Alberto.'));
  // 3. Contratos
  const cf = D.ctr.map(k => {
    const v = k.anualCalc != null ? C.conv(k.anualCalc) : null, aviso = k.imp == null ? FALTA + ' sin importe' : k.cuadra === false ? EST + ' no cuadra: registrado ' + f2(k.reg) + ' / calculado ' + f2(k.anualCalc) : k.reg == null ? EST + ' sin coste anual registrado' : '';
    return '<tr><td style="' + TD + 'text-align:left;white-space:normal;">' + esc(k.nombre) + '<div style="font-size:10.5px;color:var(--ink-soft);">' + (k.imp != null ? f2(k.imp) + ' · ' + esc(k.periodicidad || '?') : 'sin importe') + (aviso ? ' · ' + aviso : '') + '</div></td>' + (v ? celdas(v) : '<td colspan="6" style="' + TD + '">' + FALTA + '</td>') + '</tr>';
  }).join('');
  h += card('Contratos recurrentes: importe original, periodicidad real y equivalentes', tabla(CAB, cf) + nota('El año se recalcula con importe × periodicidad real; si no coincide con el «coste anual» registrado se avisa, no se corrige solo. Los contratos cancelados no se cuentan.'));
  // 4. Registrado por categoría
  const grup = Object.keys(GRUPOS).filter(k => D.porGrupo[k]).map(k => {
    const cats = D.porCat.filter(x => x.grupo === k);
    return '<tr><td style="' + TD + 'text-align:left;background:var(--concrete-2);" colspan="7"><b>' + GRUPOS[k][0] + '</b> · reparto: ' + GRUPOS[k][1] + ' · ' + eur(D.porGrupo[k]) + '</td></tr>'
      + cats.map(x => '<tr><td style="' + TD + 'text-align:left;white-space:normal;">' + esc(x.cat) + ' <span style="font-size:10.5px;color:var(--ink-soft);">(' + x.n + ' doc.' + (x.baseB ? ', ' + eur(x.baseB) + ' en B' : '') + (x.recl ? ', ' + x.recl + ' pasados aquí por el uso del vehículo' : '') + ')</span></td>' + celdas(C.conv(x.base)) + '</tr>').join('');
  }).join('');
  h += card('Gastos registrados 12 meses por categoría ' + REAL, tabla(CAB, grup) + nota(D.gastos + ' gastos sin IVA' + (c.incluirB ? ' (incluye ' + D.nB + ' en B por ' + eur(D.baseB) + ')' : ' (sin los gastos en B)') + '. Los gastos de socios y los de fuera de la explotación se muestran pero no entran en el coste de explotación.'));
  // 5. Coste por recurso
  const rc = D.clases.map(k => '<tr><td style="' + TD + 'text-align:left;white-space:normal;"><b>' + k.nombre + '</b><div style="font-size:10.5px;color:var(--ink-soft);">' + (k.maquinas.length ? k.maquinas.map(m => esc(m.nombre)).join(', ') + ' · ' : '') + 'directo ' + f2(k.directo) + ' + reparto del resto de la flota ' + f2(k.parte) + '</div></td>' + celdas(k) + '</tr>').join('');
  const hp = D.clases.filter(k => k.clase !== 'desplazamiento').map(k => '<tr><td style="' + TD + 'text-align:left;">' + k.nombre + '</td><td style="' + TD + '">' + U().h1(k.hReal) + ' h</td><td style="' + TD + '">' + inp(k.manual ? k.h : '', "COSTES.setHP('" + k.clase + "',this.value)") + '</td><td style="' + TD + '"><b>' + U().h1(k.h) + ' h</b> ' + (k.manual ? EST : CALC) + '</td><td style="' + TD + '"><b>' + f2(k.horaProd) + '</b> / h productiva</td></tr>').join('');
  h += card('Coste por recurso: máquinas y vehículos ' + CALC, tabla(CAB, rc) + nota('Solo se asigna a una máquina lo que tiene vehículo o máquina indicados en el gasto; el resto de la flota (combustible, seguros, repuestos…) se reparte entre máquinas por sus horas productivas. Si pocos gastos llevan máquina, el reparto es aproximado.')
    + '<div style="font-weight:700;font-size:12.5px;margin-top:8px;">Horas productivas por máquina</div>' + tabla('<th style="' + TH + 'text-align:left;">Clase</th><th style="' + TH + '">Reales (albaranes)</th><th style="' + TH + '">Fijar a mano</th><th style="' + TH + '">Se usan</th><th style="' + TH + '">Coste</th>', hp) + nota('Horas reales sacadas de los albaranes de los últimos 12 meses. Si dejas el campo vacío se usan las reales; si escribes un número se usa ese y se marca como Estimado.'));
  // 6. Trabajadores
  const cv = c.convenio, hjo = hJ || 1;
  h += card('Coste por recurso: trabajadores ' + CALC,
    '<div style="font-size:12.5px;">Coste anual de empresa por trabajador (convenio + Seguridad Social): maquinista/oficial 1ª ' + inp(cv.maquinista, "COSTES.setConv('maquinista',this.value)", 80) + ' · oficial 2ª ' + inp(cv.oficial2, "COSTES.setConv('oficial2',this.value)", 80) + '</div>'
    + tabla(CAB, '<tr><td style="' + TD + 'text-align:left;">Maquinista / oficial 1ª</td>' + celdas(C.conv(num(cv.maquinista))) + '</tr><tr><td style="' + TD + 'text-align:left;">Oficial 2ª</td>' + celdas(C.conv(num(cv.oficial2))) + '</tr>')
    + nota('Coste teórico de convenio por trabajador a jornada completa. No se suma al total de empresa: lo realmente pagado a personal ya está en «Personal y autónomos».'));
  // 7. Amortización
  const am = D.amort.map(a => '<tr><td style="' + TD + 'text-align:left;">' + esc(a.nombre) + '</td><td style="' + TD + '">' + inp(a.compra, "COSTES.setCompra('" + a.id + "',this.value)", 90) + '</td>' + (a.anual != null ? celdas(C.conv(a.anual)) : '<td colspan="6" style="' + TD + '">' + FALTA + ' precio de compra</td>') + '</tr>').join('');
  h += card('Provisiones: amortización de maquinaria ' + PROV, tabla('<th style="' + TH + 'text-align:left;">Máquina</th><th style="' + TH + '">Precio de compra</th><th style="' + TH + '">Año</th><th style="' + TH + '">Mes</th><th style="' + TH + '">Día natural</th><th style="' + TH + '">Día laborable</th><th style="' + TH + '">Hora natural</th><th style="' + TH + '">Hora jornada</th>', am) + nota('Amortización lineal: precio × (1 − residual %) ÷ vida útil (' + (window.RENT.param.vidaUtil || 10) + ' años, en Rentabilidad → hipótesis). Sin precio de compra no se calcula nada ni se inventa.'));
  // 8. Total empresa
  const t = D.total, tr = (n, v, b, tag) => '<tr><td style="' + TD + 'text-align:left;white-space:normal;">' + (b ? '<b>' + n + '</b>' : n) + ' ' + tag + '</td>' + celdas(C.conv(v)) + '</tr>';
  const hpE = D.hMaq ? t.economico / D.hMaq : null;
  h += card('Coste total de la empresa',
    tabla(CAB, tr('Máquinas y vehículos', D.porGrupo.flota || 0, 0, REAL) + tr('Personal y autónomos', D.porGrupo.personal || 0, 0, REAL) + tr('Estructura', D.porGrupo.estructura || 0, 0, REAL) + tr('Directo de obra', D.porGrupo.obra || 0, 0, REAL)
      + tr('Total coste de explotación registrado', t.registrado, 1, REAL) + tr('Amortización (' + D.amort.filter(a => a.anual != null).length + ' de ' + D.amort.length + ' máquinas con precio)', t.provision, 0, D.amortTot ? PROV : FALTA) + tr('Coste económico total', t.economico, 1, D.amortTot ? CALC : EST))
    + nota('Por hora productiva de máquina (' + U().h1(D.hMaq) + ' h): <b>' + f2(hpE) + '</b>. Fuera de este total: retiradas y gastos personales de socios ' + eur(D.porGrupo.socios || 0) + '; Hacienda y compra de vehículos ' + eur(D.porGrupo.fuera || 0) + (D.porGrupo.sin ? '; sin clasificar ' + eur(D.porGrupo.sin) : '') + '.'));
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
C.pintar = async function(el, forzar){
  C.el = el; if(!C.D) el.innerHTML = '<div class="panel te-panel" style="font-size:13px;">Calculando costes…</div>';
  try{ const D = await C.cargar(forzar); el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><b style="font-size:14px;">Normalización y distribución de costes</b><a href="#" onclick="COSTES.recargar();return false" style="font-size:12px;">recalcular</a></div>' + C.vista(D); }
  catch(e){ console.error(e); el.innerHTML = '<div class="panel te-panel" style="font-size:13px;">No se pudieron calcular los costes: ' + esc(e.message) + '</div>'; }
};
})();
