/* ===== Calculadora de ajustes (V10.09) =====
   Rectificaciones, contrafacturas y compensaciones con los datos fiscales REALES de la app (impDatos, impCalc130, declaraciones, pagos del 130,
   banco). Solo LEE: no toca facturas, ni contabilidad, ni cobros; lo único que escribe son las simulaciones guardadas (sistema, tipo
   simulacion_ajuste). Cada cifra fiscal lleva su etiqueta: Confirmado / Estimado / Pendiente. Sin porcentajes inventados: el único % del
   130 es el de la propia app (IMP_PORC_130) y el IRPF anual solo entra si Daniel escribe un tipo. */
(function(){
  'use strict';
  const A = window.AJU = {};
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const eur = n => { const v = r2(n); const t = (typeof impEur === 'function') ? impEur(Math.abs(v) < 0.005 ? 0 : v) : v.toFixed(2).replace('.', ',') + ' €'; return t; };
  const num = v => { if(v == null) return 0; let s = String(v).trim().replace(/[€\s]/g, ''); if(!s) return 0; if(s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); else if((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, ''); const n = parseFloat(s); return isFinite(n) ? n : 0; };
  const fmtIn = n => { const v = r2(n); return v ? String(v).replace('.', ',') : ''; };
  const fmtF = d => { const x = new Date(d); return isNaN(x) ? '—' : String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); };
  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tag = (k, t) => '<i class="aju-tag ' + k + '">' + t + '</i>';
  const OK = tag('ok', 'Confirmado'), EST = tag('est', 'Estimado'), PEN = tag('pen', 'Pendiente');

  const TIPOS = {A: 'Completa', B: 'Parcial', C: 'Parcial + contrafactura', D: 'Compensar'};
  const TIPOS_L = {A: 'Rectificación completa', B: 'Rectificación parcial', C: 'Rectificación parcial + contrafactura', D: 'Compensación de deudas'};
  let S = nuevoEstado(), _fisc = null, _fiscKey = null, _solve = null, _guardadas = null;
  function nuevoEstado(){
    return {facturaId: null, manual: {client: '', num: '', fecha: '', base: '', iva: '21', cobrado: ''}, tipo: 'B', red: '', causa: 'por_estudiar',
      op: {sentido: 'nosotros', base: '', iva: '21', real: false, parte: '', ref: ''}, deudaPropia: '', deudaContraria: '', realesD: false, acuerdo: false,
      irpfAnual: '', objetivo: '', inversa: false};
  }

  // ---------- datos reales ----------
  function docs(){ try{ return Object.values(documentosRealesById || {}); }catch(e){ return []; } }
  function facturas(){ return docs().filter(d => d.type === 'factura' && d.estado !== 'borrador' && d.status !== 'Borrador' && d.estado !== 'anulado' && d.estado_cobro !== 'nula').sort((a, b) => String(b.dateRaw || '').localeCompare(String(a.dateRaw || ''))).slice(0, 80); }
  function baseAlb(d){ return d.type === 'albaran' ? d.total : (d.base != null ? d.base : d.total); } // el albarán no lleva IVA: su total son las líneas = base
  function albaranes(){ return docs().filter(d => (d.type === 'albaran' || d.type === 'proforma') && d.estado !== 'borrador' && d.status !== 'Borrador' && !['cobrado', 'cobrado_otra', 'anulado', 'nula'].includes(d.estado_cobro)).sort((a, b) => String(b.dateRaw || '').localeCompare(String(a.dateRaw || ''))).slice(0, 40); }
  function deDoc(d){
    const base = r2(d.base != null ? d.base : Number(d.total || 0) - Number(d.iva || 0)), iva = r2(d.iva), total = r2(d.total);
    let cob = r2(d.cobrado_importe); if(!cob && d.estado_cobro === 'cobrado') cob = total;
    const p = impPeriodo(d), pct = Number(d.ivaPct) || (base > 0 ? Math.round(iva / base * 100) : 21);
    return {id: d.id, manual: false, client: d.client || '—', num: d.num || d.numero || '—', fecha: d.dateRaw || '', base, ivaPct: pct, iva, total, cobrado: cob, anio: p.anio, q: p.q, isp: d.tratamientoIva === 'isp'};
  }
  function facturaCtx(){
    if(S.facturaId && S.facturaId !== 'manual'){ const d = (documentosRealesById || {})[S.facturaId]; if(d) return deDoc(d); }
    const m = S.manual, base = r2(num(m.base)), pct = num(m.iva), iva = r2(base * pct / 100), f = m.fecha ? new Date(m.fecha) : null, ok = f && !isNaN(f);
    return {id: null, manual: true, client: m.client || '—', num: m.num || '—', fecha: m.fecha || '', base, ivaPct: pct, iva, total: r2(base + iva), cobrado: r2(num(m.cobrado)), anio: ok ? f.getFullYear() : null, q: ok ? Math.floor(f.getMonth() / 3) + 1 : null, isp: false};
  }
  function estadoTrim(q, anio){
    const hoy = new Date(), fin = new Date(anio, q * 3, 0, 23, 59, 59), plazo = impPlazo(q, anio);
    const decl = (_impDeclaraciones || []).find(x => x.modelo === '130' && Number(x.anio) === anio && Number(x.trimestre) === q);
    if(decl) return {k: 'presentado', txt: 'Presentado (130 registrado)', abierto: false, plazo};
    if(hoy <= fin) return {k: 'curso', txt: 'En curso', abierto: true, plazo};
    if(hoy <= plazo) return {k: 'abierto', txt: 'Sin presentar, plazo hasta el ' + fmtF(plazo), abierto: true, plazo};
    return {k: 'vencido', txt: 'Plazo vencido y sin presentación registrada', abierto: false, plazo};
  }
  function pago303(q, anio){   // pago al banco del 303 de ese trimestre (si lo hay): AEAT «modelo 303» entre el fin del trimestre y 10 días tras el plazo
    const ini = new Date(anio, q * 3, 1), pl = impPlazo(q, anio), fin = new Date(pl.getTime() + 10 * 86400000);
    const m = ((typeof _impBanco !== 'undefined' && _impBanco.movs) || []).find(x => Number(x.importe) < 0 && /modelo 303/i.test((x.concepto || '') + ' ' + (x.comercio || '')) && new Date(x.fecha) >= ini && new Date(x.fecha) <= fin);
    return m ? {importe: -Number(m.importe), fecha: m.fecha} : null;
  }
  function fiscal(F){
    const key = [F.id || 'm', F.anio, F.q, F.base].join('|'); if(_fisc && _fiscKey === key) return _fisc;
    const X = {ok: false, pend: [], est: null};
    X.pend.push('No hay ningún modelo 303 registrado en la app: el IVA se calcula con los documentos del trimestre');
    X.pend.push('La app no tiene retenciones registradas en las facturas');
    if(!F.anio || !F.q){ X.pend.push('Falta la fecha de la factura para saber su trimestre'); _fisc = X; _fiscKey = key; return X; }
    X.est = estadoTrim(F.q, F.anio);
    let q = F.q; while(q <= 4 && !estadoTrim(q, F.anio).abierto) q++;
    X.qAplica = q <= 4 ? q : null;
    if(F.anio !== new Date().getFullYear() || X.qAplica == null){ X.pend.push('No hay un trimestre abierto de ' + F.anio + ' donde aplicar el ajuste: sin datos fiscales para calcular'); _fisc = X; _fiscKey = key; return X; }
    try{
      const D = impDatos(q, F.anio), c = impCalc130(q, F.anio, D), contado = !F.manual;
      X.D = D; X.c = c; X.contado = contado; X.estAplica = estadoTrim(q, F.anio);
      X.rendSin = c.rend - (contado ? F.base : 0);
      X.f130 = rend => Math.max(0, rend * IMP_PORC_130 / 100 - c.previos);
      X.res303 = impRes303(D); X.pago = pago303(F.q, F.anio); X.ok = true;
      if(c.faltan.length) X.pend.push('Falta el pago del modelo 130 de ' + c.faltan.map(k => k + 'T').join(', '));
      if(c.sinIva) X.pend.push(c.sinIva + ' gasto(s) sin IVA definido en el cálculo del 130');
    }catch(e){ console.error(e); X.pend.push('No se pudieron leer los datos fiscales de la app'); }
    _fisc = X; _fiscKey = key; return X;
  }

  // ---------- motor ----------
  function sim(tipo, F, X, o){
    o = o || {};
    const r = F.isp ? 0 : F.ivaPct / 100;
    let Bf = F.base, IVAf = F.iva, Tf = F.total;
    if(tipo === 'A'){ Bf = 0; IVAf = 0; Tf = 0; }
    else if(tipo === 'B' || tipo === 'C'){ Bf = r2(Math.max(0, o.Bf != null ? o.Bf : F.base - num(S.red))); IVAf = r2(Bf * r); Tf = r2(Bf + IVAf); }
    const op = (tipo === 'C' || tipo === 'D') ? S.op : null;
    let B2 = 0, IVA2 = 0, T2 = 0, emite = false, recibe = false;
    if(op){ B2 = r2(Math.max(0, o.B2 != null ? o.B2 : num(op.base))); IVA2 = r2(B2 * num(op.iva) / 100); T2 = r2(B2 + IVA2); emite = op.sentido === 'nosotros'; recibe = !emite && B2 > 0; }
    const dIn = tipo === 'D' ? r2(num(S.deudaContraria)) : 0, dOut = tipo === 'D' ? r2(num(S.deudaPropia)) : 0;
    const issued = emite ? T2 : 0, received = recibe ? T2 : 0, real = op ? !!op.real : true;
    const dev0 = Math.max(0, F.cobrado - Tf), cobr0 = Math.max(0, Tf - F.cobrado);
    const weOwe = r2(dev0 + received + dOut), theyOwe = r2(cobr0 + issued + dIn);
    const P = r2(theyOwe - weOwe), compensable = r2(Math.min(weOwe, theyOwe));
    const valor = r2(Tf + issued - received + dIn - dOut);
    const ivaDev = r2(IVAf + (emite ? IVA2 : 0)), ivaSop = recibe && real ? IVA2 : 0, ivaNeta = r2(ivaDev - ivaSop);
    const ingB = r2(Bf + (emite ? B2 : 0)), gasB = recibe && real ? B2 : 0, dRend = r2(ingB - gasB);
    const att = X.ok ? r2(X.f130(X.rendSin + dRend) - X.f130(X.rendSin)) : 0;
    const neto = r2(valor - ivaNeta - att);
    const m = num(S.irpfAnual), netoAnual = m > 0 ? r2(valor - ivaNeta - dRend * m / 100) : null;
    return {tipo, Bf, IVAf, Tf, B2, IVA2, T2, emite, recibe, dIn, dOut, weOwe, theyOwe, compensable, cobrar: Math.max(0, P), devolver: Math.max(0, -P), P, valor, ivaDev, ivaSop, ivaNeta, ingB, gasB, dRend, att, neto, netoAnual, real};
  }
  function base0(F, X){
    const att = X.ok ? r2(X.f130(X.rendSin + F.base) - X.f130(X.rendSin)) : 0, iva = F.isp ? 0 : F.iva;
    return {Tf: F.total, valor: F.total, ivaNeta: iva, att, neto: r2(F.total - iva - att), cobrar: Math.max(0, F.total - F.cobrado), devolver: 0, base: F.base};
  }
  function viab(tipo, F){
    const rect = tipo !== 'D', op = S.op, opBase = num(op.base) > 0;
    const out = [];
    if(rect){
      if(S.causa === 'sin') out.push(['no', 'No justificable: sin causa real que respalde la rectificación']);
      else if(S.causa === 'por_estudiar') out.push(['cond', 'Condicionada: falta justificar y documentar la causa de la rectificación']);
      if(tipo === 'B' || tipo === 'C'){ if(num(S.red) < -0.004) out.push(['no', 'Subir el importe no es una rectificación a la baja']); }
    }
    if((tipo === 'C' || tipo === 'D') && opBase && !op.real) out.push(['no', 'La otra factura debe corresponder a una operación real']);
    const dif = op.parte && norm(op.parte) !== norm(F.client);
    if(tipo === 'D'){
      if(!S.realesD) out.push(['cond', 'Condicionada: las deudas deben ser reales y estar documentadas']);
      if(dif && !S.acuerdo) out.push(['cond', 'Personas distintas: la compensación necesita acuerdo o justificación']);
    }else if((tipo === 'C') && dif && opBase && !S.acuerdo) out.push(['cond', 'La otra parte es distinta del cliente de la factura: hace falta acuerdo']);
    const k = out.some(x => x[0] === 'no') ? 'no' : out.some(x => x[0] === 'cond') ? 'cond' : 'ok';
    return {k, motivos: out.map(x => x[1]), txt: k === 'ok' ? 'Viable' : k === 'cond' ? 'Condicionada' : 'No viable'};
  }
  function resolver(tipo, F, X){
    const target = r2(num(S.objetivo)); let key;
    if(tipo === 'B' || tipo === 'C') key = 'Bf'; else if(tipo === 'D' && S.op.sentido === 'nosotros') key = 'B2'; else return null;
    const f = x => sim(tipo, F, X, {[key]: x}).neto - target;
    if(f(0) >= 0) return {key, x: 0, nota: 'Con 0 € de base ya se llega al objetivo'};
    let lo = 0, hi = Math.max(1000, Math.abs(target) * 2 + 1000), g = 0;
    while(f(hi) < 0 && g++ < 40) hi *= 2;
    for(let i = 0; i < 90; i++){ const m = (lo + hi) / 2; if(f(m) >= 0) hi = m; else lo = m; }
    let x = Math.ceil(hi * 100 - 1e-7) / 100, n = 0; while(f(x) < -0.0049 && n++ < 100) x = r2(x + 0.01);
    return {key, x: r2(x)};
  }

  // ---------- pantalla ----------
  let root = null, sheet = null;
  function css(){
    if(document.getElementById('aju-css')) document.getElementById('aju-css').remove();
    const s = document.createElement('style'); s.id = 'aju-css';
    s.textContent = `#aju-app,#aju-sheet{position:fixed;inset:0;z-index:3300;background:var(--paper,#faf8f4);overflow-y:auto;-webkit-overflow-scrolling:touch;color:var(--ink,#222);font-size:14px;}
#aju-sheet{z-index:3301;display:none;}
#aju-app .aju-in{max-width:760px;margin:0 auto;padding:0 14px 100px;}
#aju-app .aju-top{position:sticky;top:0;z-index:2;background:var(--paper,#faf8f4);display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#ddd);}
#aju-app .aju-top b{font-size:17px;}
#aju-app h4{margin:12px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft,#777);}
#aju-app select,#aju-app input[type=text],#aju-app input[type=date],#aju-app input:not([type]){width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line,#ddd);border-radius:12px;background:#fff;font:inherit;font-size:16px;color:inherit;}
#aju-app .aju-f{display:flex;flex-direction:column;gap:2px;margin:0 0 6px;flex:1;min-width:0;}
#aju-app .aju-f>span{font-size:12px;color:var(--ink-soft,#777);}
#aju-app .aju-row{display:flex;gap:8px;}
#aju-app .aju-chips{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
#aju-app .aju-chip{padding:8px;min-height:46px;border:1px solid var(--line,#ddd);border-radius:12px;background:#fff;font:inherit;font-weight:600;font-size:13.5px;cursor:pointer;color:inherit;line-height:1.2;}
#aju-app .aju-chip.on{border-color:var(--ink,#222);box-shadow:inset 0 0 0 2px var(--ink,#222);}
#aju-app .aju-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
#aju-app .aju-k{border:1px solid var(--line,#ddd);border-radius:14px;padding:10px 12px;background:#fff;min-width:0;}
#aju-app .aju-k>span{display:block;font-size:12px;color:var(--ink-soft,#777);}
#aju-app .aju-k>b{display:block;font-size:22px;margin-top:2px;white-space:nowrap;}
#aju-app .g{color:var(--green,#2f7a4f);} #aju-app .r{color:var(--red,#b3362b);}
#aju-app .aju-v{margin:10px 0;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.35;}
#aju-app .aju-v.ok{background:#e6f2ea;} #aju-app .aju-v.cond{background:#fbf0d9;} #aju-app .aju-v.no{background:#f7e1de;}
#aju-app .aju-cmpb{margin-top:10px;border:1px solid var(--line,#ddd);border-radius:14px;background:#fff;padding:4px 12px;}
#aju-app .aju-cmpb .l{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px dashed var(--line,#e5e0d6);}
#aju-app .aju-cmpb .l:last-child{border:none;}
#aju-app .aju-cmpb .l span{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--ink-soft,#777);}
#aju-app .aju-cmpb .l b{font-size:18px;white-space:nowrap;}
#aju-app .aju-cmpb .big b{font-size:22px;}
#aju-app .aju-btns{display:grid;gap:8px;margin-top:12px;}
#aju-app .aju-btns .btn{width:100%;padding:14px;font-size:15px;border-radius:14px;}
#aju-app .aju-btns.two{grid-template-columns:1fr 1fr;}
#aju-app .aju-tag{font-style:normal;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:99px;margin-left:6px;white-space:nowrap;}
#aju-app .aju-tag.ok{background:#dcefe2;color:#256040;} #aju-app .aju-tag.est{background:#fbebc8;color:#7a5a12;} #aju-app .aju-tag.pen{background:#f3d9d5;color:#8e2b22;}
#aju-app .aju-l{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--line,#e5e0d6);}
#aju-app .aju-l>span:first-child{color:var(--ink-soft,#777);} #aju-app .aju-l>span:last-child{text-align:right;}
#aju-app .aju-warn{margin:8px 0;padding:8px 12px;border-radius:12px;background:#fbf0d9;font-size:13px;}
#aju-app .aju-note{font-size:12px;color:var(--ink-soft,#777);margin:4px 0;}
#aju-app .aju-chk{display:flex;gap:10px;align-items:flex-start;margin:8px 0;font-size:14px;}
#aju-app .aju-chk input{margin-top:3px;width:20px;height:20px;}
#aju-app .aju-opt{border:1px solid var(--line,#ddd);border-radius:14px;background:#fff;padding:12px;margin:8px 0;}
#aju-app .aju-opt .t{font-weight:700;} #aju-app .aju-opt .n{font-size:22px;font-weight:700;margin:2px 0;} #aju-app .aju-opt .s{font-size:12.5px;color:var(--ink-soft,#777);}
#aju-app .aju-opt.best{border-color:var(--green,#2f7a4f);box-shadow:inset 0 0 0 2px var(--green,#2f7a4f);}
#aju-app .aju-opt.off{opacity:.6;}
#aju-sheet .aju-in{max-width:760px;margin:0 auto;padding:0 14px 100px;}
#aju-sheet .aju-top{position:sticky;top:0;z-index:2;background:var(--paper,#faf8f4);display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#ddd);}
#aju-sheet .aju-top b{font-size:17px;}`;
    document.head.appendChild(s);
    // las hojas comparten estilos con la app: se dejan dentro de #aju-app (ver pintar)
  }
  A.abrir = async function(){
    css();
    if(!root){ root = document.createElement('div'); root.id = 'aju-app'; document.body.appendChild(root);
      root.addEventListener('input', ev => { const k = ev.target.getAttribute && ev.target.getAttribute('data-k'); if(k) cambia(k, ev.target, false); });
      root.addEventListener('change', ev => { const k = ev.target.getAttribute && ev.target.getAttribute('data-k'); if(k) cambia(k, ev.target, true); });
      root.addEventListener('click', ev => { const b = ev.target.closest && ev.target.closest('[data-act]'); if(b) accion(b.getAttribute('data-act'), b); });
    }
    root.style.display = 'block'; document.body.style.overflow = 'hidden'; sheet = null;
    root.innerHTML = '<div class="aju-in"><p style="padding:30px 0;color:var(--ink-soft)">Cargando datos fiscales…</p></div>';
    try{ if(typeof impCargarPagos === 'function' && !_impPagosCargados) await impCargarPagos(); }catch(e){}
    try{ if(typeof _docsListos !== 'undefined' && !_docsListos) await new Promise(res => { const t = setTimeout(res, 25000); document.addEventListener('exg-docs-listos', () => { clearTimeout(t); res(); }, {once: true}); }); }catch(e){}
    const l = facturas(), vacio = !S.manual.base && !S.manual.client;
    if(!S.facturaId || (S.facturaId === 'manual' && vacio && l.length) || (S.facturaId !== 'manual' && !(documentosRealesById || {})[S.facturaId])) S.facturaId = l.length ? l[0].id : 'manual';
    _fisc = null; pintar();
  };
  function cerrar(){ if(root) root.style.display = 'none'; document.body.style.overflow = ''; sheet = null; }
  function pintar(){
    root.innerHTML = '<div class="aju-top"><b>Calculadora de ajustes</b><button type="button" class="btn sm" data-act="cerrar">Cerrar</button></div><div class="aju-in">'
      + '<h4>Factura</h4>' + htmlFactura() + '<h4>¿Qué quieres hacer?</h4>' + htmlTipo() + '<div id="aju-inputs">' + htmlInputs() + '</div><div id="aju-res"></div></div><div id="aju-sheet"></div>';
    resultados();
  }
  const money = n => eur(n);

  function htmlFactura(){
    const L = facturas(), F = facturaCtx();
    const opts = L.map(d => '<option value="' + d.id + '"' + (S.facturaId === d.id ? ' selected' : '') + '>' + esc((d.num || d.numero || '—') + ' · ' + String(d.client || '—').slice(0, 18) + ' · ' + eur(d.total)) + '</option>').join('');
    const man = S.facturaId === 'manual' ? '<div class="aju-row" style="margin-top:8px"><label class="aju-f"><span>Cliente</span><input type="text" data-k="m.client" value="' + esc(S.manual.client) + '"></label><label class="aju-f" style="max-width:90px"><span>Nº</span><input type="text" data-k="m.num" value="' + esc(S.manual.num) + '"></label></div>'
      + '<div class="aju-row"><label class="aju-f"><span>Fecha</span><input type="date" data-k="m.fecha" value="' + esc(S.manual.fecha) + '"></label><label class="aju-f"><span>Base (€)</span><input data-k="m.base" inputmode="decimal" value="' + esc(S.manual.base) + '"></label><label class="aju-f" style="max-width:70px"><span>IVA %</span><input data-k="m.iva" inputmode="decimal" value="' + esc(S.manual.iva) + '"></label></div><label class="aju-f"><span>Cobrado hasta ahora (€)</span><input data-k="m.cobrado" inputmode="decimal" value="' + esc(S.manual.cobrado) + '"></label>' : '';
    return '<select data-k="facturaId">' + opts + '<option value="manual"' + (S.facturaId === 'manual' ? ' selected' : '') + '>Introducir a mano…</option></select>' + man + '<div id="aju-fact">' + resumenFactura(F) + '</div>';
  }
  function resumenFactura(F){
    const d = Math.abs(r2(F.base + F.iva) - F.total);
    return '<p class="aju-note" style="margin-top:6px">Base ' + eur(F.base) + ' · cobrado ' + eur(F.cobrado) + (F.q ? ' · ' + F.q + 'T ' + F.anio : '') + (d >= 0.005 ? ' · <b style="color:var(--red,#b3362b)">base + IVA no suma el total (' + eur(d) + ')</b>' : '') + '</p>';
  }
  const TIPO_BTN = {A: 'Rectificar completamente', B: 'Rectificar parcialmente', C: 'Rectificar y añadir otra factura', D: 'Compensar deudas'};
  function htmlTipo(){ return '<div class="aju-chips">' + Object.keys(TIPO_BTN).map(k => '<button type="button" class="aju-chip' + (S.tipo === k ? ' on' : '') + '" data-act="tipo" data-t="' + k + '">' + TIPO_BTN[k] + '</button>').join('') + '</div>'; }
  const fld = (k, lab, val, ex, st) => '<label class="aju-f"' + (st ? ' style="' + st + '"' : '') + '><span>' + lab + '</span><input data-k="' + k + '" inputmode="decimal" autocomplete="off" value="' + esc(val) + '"' + (ex || '') + '></label>';
  const dif = F => !!(S.op.parte && norm(S.op.parte) !== norm(F.client));
  const solvable = () => S.tipo === 'B' || S.tipo === 'C' || (S.tipo === 'D' && S.op.sentido === 'nosotros');
  function htmlInputs(){
    const t = S.tipo, F = facturaCtx();
    const causa = '<label class="aju-f"><span>Motivo</span><select data-k="causa"><option value="justificada"' + (S.causa === 'justificada' ? ' selected' : '') + '>Error real</option><option value="por_estudiar"' + (S.causa === 'por_estudiar' ? ' selected' : '') + '>Por justificar</option><option value="sin"' + (S.causa === 'sin' ? ' selected' : '') + '>Sin causa</option></select></label>';
    let h = '<h4>Cantidades</h4>';
    if(t === 'A') h += '<p class="aju-note" style="margin:0 0 8px">Se anula toda la factura.</p>' + causa;
    if(t === 'B' || t === 'C') h += '<div class="aju-row">' + fld('red', 'Importe que descontamos (€)', S.red, ' data-lk="red"') + causa + '</div>';
    if(t === 'C' || t === 'D'){
      const al = albaranes().map(d => '<option value="' + d.id + '">' + esc((d.num || d.numero || '—') + ' · ' + (d.client || '—') + ' · ' + eur(baseAlb(d))) + '</option>').join('');
      h += '<div class="aju-row">' + fld('op.base', 'Importe de la otra factura (base, €)', S.op.base, ' data-lk="b2"') + fld('op.iva', 'IVA %', S.op.iva, '', 'max-width:72px') + '</div>'
        + '<div class="aju-row"><label class="aju-f"><span>¿Quién la emite?</span><select data-k="op.sentido"><option value="nosotros"' + (S.op.sentido === 'nosotros' ? ' selected' : '') + '>Nosotros</option><option value="cliente"' + (S.op.sentido === 'cliente' ? ' selected' : '') + '>El cliente</option></select></label>'
        + '<label class="aju-f"><span>Cargar de un albarán</span><select data-k="albaran"><option value="">—</option>' + al + '</select></label></div>';
      if(t === 'C') h += '<label class="aju-chk"><input type="checkbox" data-k="op.real"' + (S.op.real ? ' checked' : '') + '><span>La otra factura es una operación real</span></label>';
    }
    if(t === 'D') h += '<div class="aju-row">' + fld('deudaContraria', 'Nos deben sin factura (€)', S.deudaContraria) + fld('deudaPropia', 'Les debemos sin factura (€)', S.deudaPropia) + '</div>'
      + '<label class="aju-chk"><input type="checkbox" data-k="realesD"' + (S.realesD ? ' checked' : '') + '><span>Las deudas y facturas son reales y están documentadas</span></label>';
    if((t === 'C' || t === 'D') && dif(F)) h += '<label class="aju-chk"><input type="checkbox" data-k="acuerdo"' + (S.acuerdo ? ' checked' : '') + '><span>Hay acuerdo para compensar con «' + esc(S.op.parte) + '» (otra persona)</span></label>';
    if(t !== 'A' && solvable()) h += fld('objetivo', 'Quiero que me queden … € netos (opcional)', S.objetivo) + '<div id="aju-inv"></div>';
    return h;
  }

  function cambia(k, el, fin){
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if(k === 'facturaId'){ S.facturaId = v; S.red = ''; _fisc = null; pintar(); return; }
    if(k.indexOf('m.') === 0){ S.manual[k.slice(2)] = v; _fisc = null; const f = document.getElementById('aju-fact'); if(f) f.innerHTML = resumenFactura(facturaCtx()); resultados(true); return; }
    if(k === 'albaran'){ if(!v) return; const d = (documentosRealesById || {})[v]; if(d){ S.op.base = fmtIn(baseAlb(d)); S.op.parte = d.client || ''; S.op.ref = d.num || d.numero || ''; S.op.sentido = 'nosotros'; S.op.iva = String(Number(d.ivaPct) || 21); }
      document.getElementById('aju-inputs').innerHTML = htmlInputs(); resultados(); return; }
    if(k === 'op.sentido'){ S.op.sentido = v; document.getElementById('aju-inputs').innerHTML = htmlInputs(); resultados(); return; }
    if(k.indexOf('op.') === 0){ const kk = k.slice(3); S.op[kk] = kk === 'real' ? !!v : v; }
    else if(k === 'realesD'){ S.realesD = !!v; S.op.real = !!v; }
    else if(k === 'acuerdo') S.acuerdo = !!v;
    else if(k === 'objetivo'){ S.objetivo = v; S.inversa = num(v) !== 0; }
    else S[k] = v;
    if(k === 'causa' || k === 'realesD' || k === 'acuerdo' || k === 'objetivo' || k === 'op.sentido') { /* nada más */ }
    resultados(true, k === 'irpfAnual' && !fin);
  }
  function accion(a, b){
    if(a === 'cerrar') cerrar();
    else if(a === 'tipo'){ S.tipo = b.getAttribute('data-t'); S.inversa = solvable() && num(S.objetivo) !== 0; document.getElementById('aju-inputs').innerHTML = htmlInputs(); root.querySelectorAll('.aju-chip').forEach(c => c.classList.toggle('on', c.getAttribute('data-t') === S.tipo)); resultados(); }
    else if(a === 'cmp' || a === 'det' || a === 'sav'){ sheet = a; pintarSheet(); }
    else if(a === 'sheet0'){ sheet = null; pintarSheet(); }
    else if(a === 'guardar') guardar();
    else if(a === 'cargar') cargar(b.getAttribute('data-id'));
    else if(a === 'borrar') borrar(b.getAttribute('data-id'));
  }
  function sync(){   // pone en las casillas lo que ha resuelto la inversa, sin tocar la que se está escribiendo
    const act = document.activeElement;
    const set = (sel, val) => { const e = root.querySelector(sel); if(e && e !== act) e.value = val; };
    set('[data-lk="red"]', S.red); set('[data-lk="b2"]', S.op.base);
  }
  function configurado(k, F){
    const opB = num(S.op.base) > 0;
    if(k === 'A') return true;
    if(k === 'B') return num(S.red) > 0.004;
    if(k === 'C') return num(S.red) > 0.004 && opB;
    return opB || num(S.deudaContraria) > 0 || num(S.deudaPropia) > 0;
  }

  function resultados(sinSync, noSheet){
    const el = document.getElementById('aju-res'); if(!el) return;
    const F = facturaCtx(), X = fiscal(F); let inv = null;
    const usaInv = S.inversa && solvable() && num(S.objetivo) !== 0 && S.tipo !== 'A';
    if(usaInv){ inv = resolver(S.tipo, F, X); if(inv){ if(inv.key === 'Bf') S.red = fmtIn(F.base - inv.x); else S.op.base = fmtIn(inv.x); } }
    const s = sim(S.tipo, F, X), b0 = base0(F, X), v = viab(S.tipo, F);
    const efecto = r2((s.ivaNeta + s.att) - (b0.ivaNeta + b0.att)), dN = r2(s.neto - b0.neto);
    const invEl = document.getElementById('aju-inv');
    if(invEl){ invEl.innerHTML = !usaInv || !inv ? '' : '<div class="aju-warn" style="background:#e6f2ea">Hay que pactar <b>' + eur(inv.key === 'Bf' ? s.Tf : s.T2) + '</b> <span style="color:var(--ink-soft)">(base ' + eur(inv.key === 'Bf' ? s.Bf : s.B2) + ' + IVA ' + eur(inv.key === 'Bf' ? s.IVAf : s.IVA2) + ')</span>'
      + (inv.nota ? '<br>' + esc(inv.nota) : '') + (inv.key === 'Bf' && s.Bf > F.base + 0.004 ? '<br><b>Supera la factura original: no sería una rectificación a la baja.</b>' : '') + '</div>'; }
    const kp = (a, b, c) => '<div class="aju-k"><span>' + a + '</span><b class="' + (c || '') + '">' + b + '</b></div>';
    let h = '<h4>Resultado</h4><div class="aju-kpis">'
      + kp('Tenemos que devolver', eur(s.devolver), s.devolver > 0.004 ? 'r' : '')
      + kp('Nos tienen que pagar', eur(s.cobrar), s.cobrar > 0.004 ? 'g' : '')
      + kp('Diferencia de impuestos', (efecto > 0.004 ? '+' : efecto < -0.004 ? '−' : '') + eur(Math.abs(efecto)), efecto < -0.004 ? 'g' : efecto > 0.004 ? 'r' : '')
      + kp('Dinero neto que nos queda', eur(s.neto)) + '</div>';
    const msg = v.k === 'ok' ? 'Viable' : v.k === 'cond' ? 'Condicionada' : 'No viable';
    h += '<div class="aju-v ' + v.k + '"><b>' + msg + '</b>' + (v.motivos.length ? ' · ' + esc(v.motivos[0].replace(/^Condicionada: /, '')) : '') + '</div>';
    h += '<div class="aju-cmpb"><div class="l"><span>ANTES</span><b>' + eur(b0.neto) + ' netos</b></div><div class="l"><span>DESPUÉS</span><b>' + eur(s.neto) + ' netos</b></div>'
      + '<div class="l big"><span>DIFERENCIA</span><b class="' + (dN > 0.004 ? 'g' : dN < -0.004 ? 'r' : '') + '">' + (dN > 0.004 ? '+' : dN < -0.004 ? '−' : '') + eur(Math.abs(dN)) + '</b></div></div>';
    h += '<p class="aju-note" style="text-align:center;margin-top:6px">' + (Math.abs(dN) < 0.005 ? 'Sin cambio.' : dN > 0 ? '<b class="g">Salimos ganando.</b>' : '<b class="r">Salimos perdiendo.</b>') + (X.pend.length ? ' Cifras <b>estimadas</b>: faltan datos (ver cálculo).' : '') + '</p>';
    h += '<div class="aju-btns"><button type="button" class="btn" data-act="cmp">Comparar opciones</button><button type="button" class="btn" data-act="det">Ver cómo se ha calculado</button></div>'
      + '<div class="aju-btns two"><button type="button" class="btn" data-act="guardar">Guardar</button><button type="button" class="btn" data-act="sav">Guardadas</button></div>';
    el.innerHTML = h;
    if(!noSheet) pintarSheet();
    sync();
  }

  function pintarSheet(){
    const sh = document.getElementById('aju-sheet'); if(!sh) return;
    if(!sheet){ sh.style.display = 'none'; sh.innerHTML = ''; return; }
    const F = facturaCtx(), X = fiscal(F), tit = {cmp: 'Comparar opciones', det: 'Cómo se ha calculado', sav: 'Simulaciones guardadas'}[sheet];
    let body = '';
    if(sheet === 'cmp') body = comparador(F, X);
    else if(sheet === 'det') body = detalles(F, X, sim(S.tipo, F, X), base0(F, X));
    else body = '<button type="button" class="btn" style="width:100%;padding:14px;margin:12px 0" data-act="guardar">Guardar la simulación actual</button><div id="aju-guardadas"></div>';
    sh.innerHTML = '<div class="aju-top"><b>' + tit + '</b><button type="button" class="btn sm" data-act="sheet0">Volver</button></div><div class="aju-in">' + body + '</div>';
    sh.style.display = 'block';
    if(sheet === 'sav') pintarGuardadas();
  }
  function comparador(F, X){
    const ks = ['A', 'B', 'C', 'D'], R = {};
    ks.forEach(k => { const cfg = configurado(k, F), V = viab(k, F); R[k] = {cfg, V, s: cfg ? sim(k, F, X) : null}; });
    let mejor = null; ks.forEach(k => { if(R[k].cfg && R[k].V.k === 'ok' && (mejor == null || R[k].s.neto > R[mejor].s.neto)) mejor = k; });
    const sheetStyle = '<style>#aju-sheet .aju-opt{border:1px solid var(--line,#ddd);border-radius:14px;background:#fff;padding:12px;margin:8px 0;}#aju-sheet .aju-opt .t{font-weight:700;}#aju-sheet .aju-opt .n{font-size:22px;font-weight:700;margin:2px 0;}#aju-sheet .aju-opt .s{font-size:12.5px;color:var(--ink-soft,#777);}#aju-sheet .aju-opt.best{border-color:var(--green,#2f7a4f);box-shadow:inset 0 0 0 2px var(--green,#2f7a4f);}#aju-sheet .aju-opt.off{opacity:.6;}</style>';
    let h = sheetStyle + '<p class="aju-note">Neto final tras IVA y 130, con las cantidades de la pantalla.</p>';
    ks.forEach(k => {
      const r = R[k];
      const st = !r.cfg ? 'Pon las cantidades de esta opción para compararla' : r.V.k === 'ok' ? 'Viable' : r.V.k === 'cond' ? 'Condicionada: ' + r.V.motivos[0].replace(/^Condicionada: /, '') : 'No viable: ' + r.V.motivos[0];
      h += '<div class="aju-opt' + (k === mejor ? ' best' : '') + (!r.cfg || r.V.k === 'no' ? ' off' : '') + '"><div class="t">' + TIPOS_L[k] + (k === mejor ? ' <span class="aju-tag ok">Mayor neto viable</span>' : '') + '</div>'
        + (r.cfg ? '<div class="n">' + eur(r.s.neto) + '</div>' : '') + '<div class="s">' + esc(st) + '</div></div>';
    });
    if(!mejor) h += '<p class="aju-note">Ninguna opción es viable todavía, así que no se recomienda ninguna.</p>';
    return h;
  }
  function detalles(F, X, s, b0){
    const l = (a, b, t) => '<div class="aju-l"><span>' + a + '</span><span>' + b + (t || '') + '</span></div>';
    let h = '';
    h += '<p class="aju-note"><b>Quién debe a quién</b></p>' + l('Nosotros debemos', eur(s.weOwe)) + l('Nos deben', eur(s.theyOwe)) + l('Compensable', eur(s.compensable)) + l('Saldo pendiente', s.P > 0.004 ? 'Nos deben ' + eur(s.P) : s.P < -0.004 ? 'Debemos ' + eur(-s.P) : 'Saldado');
    if(S.tipo === 'C' || S.tipo === 'D'){ if(dif(F)) h += '<div class="aju-warn">«' + esc(S.op.parte) + '» no es el cliente de la factura («' + esc(F.client) + '»): no se da por hecho que sean el mismo deudor.</div>'; }
    if(!X.ok) h += '<div class="aju-warn">No hay datos fiscales reales para esta factura: los resultados no incluyen el IRPF.</div>';
    h += '<p class="aju-note" style="margin-top:12px"><b>Factura</b></p>' + l('Importes de la factura ' + esc(F.num), eur(F.base) + ' + ' + eur(F.iva) + ' = ' + eur(F.total), F.manual ? EST : OK) + l('Cobrado', eur(F.cobrado), F.manual ? EST : OK);
    if(Math.abs(r2(F.base + F.iva) - F.total) >= 0.005) h += '<div class="aju-warn">Diferencia de ' + eur(Math.abs(r2(F.base + F.iva) - F.total)) + ' entre base + IVA (' + eur(F.base + F.iva) + ') y el total (' + eur(F.total) + ').</div>';
    if(X.est){ h += l('Trimestre de la factura', F.q + 'T ' + F.anio + ' · ' + esc(X.est.txt)); if(X.qAplica && X.qAplica !== F.q) h += l('El ajuste se aplicaría en', X.qAplica + 'T ' + F.anio + ' (primero abierto)'); }
    if(X.ok){
      const D = X.D, c = X.c, ab = X.estAplica.abierto;
      h += '<p class="aju-note" style="margin-top:12px"><b>IVA · modelo 303 del ' + X.qAplica + 'T</b></p>'
        + l('IVA repercutido del trimestre', eur(D.rep), EST) + l('IVA deducible registrado', eur(D.ded), EST) + l('Resultado actual del 303', eur(X.res303), EST)
        + l('IVA que cambia con este ajuste', (s.ivaNeta - b0.ivaNeta > 0 ? '+' : '') + eur(s.ivaNeta - b0.ivaNeta), EST) + l('Resultado del 303 tras el ajuste', eur(X.res303 + s.ivaNeta - b0.ivaNeta), EST)
        + l('IVA efectivamente ingresado', X.pago ? eur(X.pago.importe) + ' el ' + fmtF(X.pago.fecha) : 'No consta', X.pago ? OK : PEN)
        + l('IVA pendiente de liquidar', ab ? eur(Math.max(0, X.res303 + s.ivaNeta - b0.ivaNeta)) : 'Sin determinar', ab ? EST : PEN);
      h += '<p class="aju-note" style="margin-top:12px"><b>IRPF · modelo 130</b></p>'
        + l('Ingresos acumulados del ejercicio', eur(c.R.ing), EST) + l('Gastos computables acumulados', eur(c.R.gas), EST) + l('Rendimiento neto acumulado', eur(c.rend), EST)
        + l('Declarado hasta el ' + c.R.p + 'T (modelos 130 presentados)', eur(c.R.ingDecl) + ' ingresos · ' + eur(c.R.gasDecl) + ' gastos', c.R.desdeDecl ? OK : '')
        + l('Pagos fraccionados anteriores (130)', eur(c.previos), c.faltan.length ? PEN : OK)
        + l('130 estimado sin esta factura', eur(X.f130(X.rendSin)), EST) + l('130 estimado con la factura tal cual', eur(X.f130(X.rendSin + F.base)), EST) + l('130 estimado con el ajuste', eur(X.f130(X.rendSin + s.dRend)), EST);
    }
    const m = num(S.irpfAnual);
    h += '<p class="aju-note" style="margin-top:12px"><b>IRPF anual (opcional)</b></p><label class="aju-f"><span>Tipo medio de IRPF anual estimado (%)</span><input data-k="irpfAnual" inputmode="decimal" value="' + esc(S.irpfAnual) + '"></label>'
      + (m > 0 ? l('Neto tras IRPF anual estimado', eur(s.netoAnual), EST) : l('Efecto sobre el IRPF anual', 'No calculable', PEN) + '<p class="aju-note">Falta la renta anual completa. El 130 es un pago a cuenta, no el IRPF definitivo.</p>');
    h += '<p class="aju-note" style="margin-top:12px"><b>Datos que faltan</b></p>' + (X.pend.length ? X.pend.map(p => '<div class="aju-l"><span>' + esc(p) + '</span><span>' + PEN + '</span></div>').join('') : '<p class="aju-note">Ninguno.</p>');
    return h;
  }

  // ---------- simulaciones guardadas ----------
  async function pintarGuardadas(){
    const el = document.getElementById('aju-guardadas'); if(!el) return;
    if(_guardadas == null){ try{ const {data, error} = await sb.from('sistema').select('id,data,created_at').eq('tipo', 'simulacion_ajuste').order('created_at', {ascending: false}).limit(30); if(error) throw error; _guardadas = data || []; }catch(e){ _guardadas = []; el.innerHTML = '<p class="aju-note">No se pudieron leer las simulaciones guardadas.</p>'; return; } }
    el.innerHTML = _guardadas.length ? _guardadas.map(r => '<div class="aju-l"><span>' + esc((r.data || {}).nombre || 'Sin nombre') + '<br><small>' + fmtF(r.created_at) + '</small></span><span><button type="button" class="btn sm" data-act="cargar" data-id="' + r.id + '">Abrir</button> <button type="button" class="btn sm" data-act="borrar" data-id="' + r.id + '">Borrar</button></span></div>').join('') : '<p class="aju-note">Todavía no hay simulaciones guardadas.</p>';
  }
  async function guardar(){
    const F = facturaCtx(), nombre = (window.prompt('Nombre de la simulación', TIPOS[S.tipo] + ' · ' + F.client + ' · ' + F.num) || '').trim(); if(!nombre) return;
    try{ const {error} = await sb.from('sistema').insert({tipo: 'simulacion_ajuste', data: {nombre, estado: 'guardada', estado_calc: JSON.parse(JSON.stringify(S))}}); if(error) throw error; _guardadas = null; pintarGuardadas(); if(typeof mostrarToast === 'function') mostrarToast('Simulación guardada', 'ok'); }
    catch(e){ if(typeof mostrarToast === 'function') mostrarToast('No se pudo guardar', 'err'); }
  }
  function cargar(id){ const r = (_guardadas || []).find(x => x.id === id); if(!r || !(r.data || {}).estado_calc) return; S = Object.assign(nuevoEstado(), r.data.estado_calc); S.op = Object.assign(nuevoEstado().op, S.op); S.manual = Object.assign(nuevoEstado().manual, S.manual); _fisc = null; sheet = null; pintar(); root.scrollTo({top: 0}); }
  async function borrar(id){ if(!window.confirm('¿Borrar esta simulación?')) return; try{ const {error} = await sb.from('sistema').delete().eq('id', id); if(error) throw error; _guardadas = null; pintarGuardadas(); }catch(e){ if(typeof mostrarToast === 'function') mostrarToast('No se pudo borrar', 'err'); } }

  A._test = {sim, base0, viab, resolver, fiscal, facturaCtx, get S(){ return S; }, set S(v){ S = v; }, nuevoEstado, num};
})();
