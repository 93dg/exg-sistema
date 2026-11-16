/* EXG — Tiempo (V14.05: litros en cada día. V14.02, Daniel 16/11/2026: «sigue siendo feísima, algo que se vea moderno»)
   Estilo app del tiempo: cabecera con el día de hoy sobre degradado según el cielo, y la lista de 7 días con icono,
   lluvia media y barra de temperaturas de la semana. Al tocar un día se despliega ahí mismo la comparación de las fuentes.
   La misma pieza en la web (sección Tiempo) y en la app aparte tiempo.html. Datos de la función tiempo. Solo lee. */
(function(){
  const URL_TIEMPO = 'https://sshctqnpuolawtcujxkt.supabase.co/functions/v1/tiempo';
  const FU = [['aemet','AEMET'],['meteored','Meteored'],['accuweather','AccuWeather']];
  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], LARGOS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'], MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const CSS = `
.tw{--tw-r:22px;font-family:'Inter',system-ui,sans-serif;color:#fff;border-radius:var(--tw-r);overflow:hidden;background:linear-gradient(165deg,var(--tw-a),var(--tw-b));box-shadow:0 10px 30px -12px rgba(20,40,70,.45);}
.tw[data-cielo="sol"]{--tw-a:#3d8fe0;--tw-b:#1d5fae;}
.tw[data-cielo="claros"]{--tw-a:#5a8cc4;--tw-b:#2d5a8c;}
.tw[data-cielo="nube"]{--tw-a:#6f8396;--tw-b:#3f5163;}
.tw[data-cielo="lluvia"],.tw[data-cielo="tormenta"]{--tw-a:#4d6378;--tw-b:#25323f;}
.tw[data-cielo="nieve"],.tw[data-cielo="niebla"]{--tw-a:#8798a8;--tw-b:#56687a;}
.tw-hero{padding:22px 20px 18px;text-align:center;}
.tw-lugar{font-size:15px;font-weight:600;letter-spacing:.2px;opacity:.95;}
.tw-gr{font-size:84px;font-weight:200;line-height:1;margin:6px 0 2px;letter-spacing:-3px;}
.tw-gr sup{font-size:40px;vertical-align:top;position:relative;top:8px;letter-spacing:0;}
.tw-ce{font-size:16px;font-weight:500;opacity:.95;}
.tw-mm{font-size:14px;opacity:.85;margin-top:3px;}
.tw-ll{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.16);font-size:13px;font-weight:500;}
.tw-ll svg{width:15px;height:15px;}
.tw-sem{margin:0 12px 12px;padding:6px 14px 4px;border-radius:16px;background:rgba(255,255,255,.12);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}
.tw-st{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;opacity:.7;padding:8px 0 6px;border-bottom:1px solid rgba(255,255,255,.18);}
.tw-fila{display:grid;grid-template-columns:48px 30px 50px 30px 1fr 32px;align-items:center;gap:6px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.14);cursor:pointer;}
.tw-d:last-child .tw-fila{border-bottom:none;}
.tw-d.abierto .tw-fila{border-bottom:none;}
.tw-dn{font-size:16px;font-weight:600;}
.tw-ic svg{width:26px;height:26px;display:block;}
.tw-pr{font-size:13px;font-weight:600;color:#9fd3ff;}
.tw-pr.cero{color:transparent;}
.tw-pr small{display:block;font-size:11px;font-weight:500;opacity:.85;margin-top:1px;}   /* V14.05 (Daniel 16/11: «me faltan los litros») */
.tw-mn{font-size:16px;opacity:.6;text-align:right;}
.tw-mx{font-size:16px;font-weight:600;text-align:right;}
.tw-rg{position:relative;height:5px;border-radius:3px;background:rgba(0,0,0,.22);}
.tw-rg i{position:absolute;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,#7fd1ff,#ffd36b,#ff9a4d);}
.tw-cmp{padding:2px 0 12px;border-bottom:1px solid rgba(255,255,255,.14);}
.tw-d:last-child .tw-cmp{border-bottom:none;}
.tw-cd{font-size:12.5px;opacity:.8;padding:0 0 8px;}
.tw-f{display:grid;grid-template-columns:88px 1fr 84px;align-items:center;gap:10px;padding:5px 0;font-size:13px;}
.tw-f small{display:block;font-size:11px;opacity:.65;}
.tw-b{height:6px;border-radius:3px;background:rgba(0,0,0,.22);overflow:hidden;}
.tw-b i{display:block;height:100%;border-radius:3px;background:#9fd3ff;}
.tw-v{text-align:right;font-weight:600;white-space:nowrap;}
.tw-v small{display:inline;font-weight:400;}
.tw-pie{font-size:11.5px;opacity:.7;line-height:1.45;padding:2px 18px 16px;text-align:center;}
.tw-vacio{text-align:center;color:var(--ink-soft,#6B7178);font-size:13px;padding:24px 0;}`;
  const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const ICO = {
    sol: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="12" r="4" fill="#ffd36b" stroke="#ffd36b"/><path stroke="#ffd36b" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`,
    claros: `<svg viewBox="0 0 24 24" ${P}><circle cx="8.5" cy="8.5" r="3.2" fill="#ffd36b" stroke="#ffd36b"/><path d="M8 19.5h9a3.3 3.3 0 0 0 .4-6.6 4.7 4.7 0 0 0-9.1.6A3 3 0 0 0 8 19.5z" fill="#fff" stroke="#fff"/></svg>`,
    nube: `<svg viewBox="0 0 24 24" ${P}><path d="M7 17.5h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 11 3.25 3.25 0 0 0 7 17.5z" fill="#fff" stroke="#fff"/></svg>`,
    lluvia: `<svg viewBox="0 0 24 24" ${P}><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.5 3.25 3.25 0 0 0 7 14z" fill="#fff" stroke="#fff"/><path stroke="#7fd1ff" stroke-width="2" d="M8.5 17l-1 2.8M12.5 17l-1 2.8M16.5 17l-1 2.8"/></svg>`,
    tormenta: `<svg viewBox="0 0 24 24" ${P}><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.5 3.25 3.25 0 0 0 7 14z" fill="#fff" stroke="#fff"/><path stroke="#ffd36b" stroke-width="2" d="M12.5 14.5l-2 3.5h3l-2 3.5"/></svg>`,
    nieve: `<svg viewBox="0 0 24 24" ${P}><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.5 3.25 3.25 0 0 0 7 14z" fill="#fff" stroke="#fff"/><path stroke-width="2.4" d="M8.5 18h.01M12 20h.01M15.5 18h.01"/></svg>`,
    niebla: `<svg viewBox="0 0 24 24" ${P}><path d="M4 9h16M3 13h18M5 17h14"/></svg>`,
    gota: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5c-3 4.2-6 7.7-6 10.8a6 6 0 0 0 12 0c0-3.1-3-6.6-6-10.8z"/></svg>`,
  };
  const tipo = (t, prob) => {
    t = (t || '').toLowerCase();
    if(/tormenta/.test(t)) return 'tormenta';
    if(/nieve|nevada/.test(t)) return 'nieve';
    if(/lluvia|chubasco|llovizna/.test(t) || prob >= 60) return 'lluvia';
    if(/niebla|bruma|neblina/.test(t)) return 'niebla';
    if(/cubierto|muy nuboso/.test(t)) return 'nube';
    if(/nub|claros|interval/.test(t)) return 'claros';
    return 'sol';
  };
  const fechaIso = iso => new Date(iso + 'T00:00:00');
  const dif = iso => { const h = new Date(); h.setHours(0,0,0,0); return Math.round((fechaIso(iso) - h) / 864e5); };
  const corto = iso => dif(iso) === 0 ? 'Hoy' : DIAS[(fechaIso(iso).getDay()+6)%7];
  const largo = iso => { const x = fechaIso(iso), d = dif(iso); return (d === 0 ? 'Hoy, ' : d === 1 ? 'Mañana, ' : '') + LARGOS[(x.getDay()+6)%7] + ' ' + x.getDate() + ' de ' + MESES[x.getMonth()]; };
  const media = x => { const v = FU.map(([k]) => x[k] && x[k].prob).filter(p => p != null); return v.length ? Math.round(v.reduce((a,b) => a + b, 0) / v.length) : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const abiertos = new Set();

  function render(caja, d){
    if(!document.getElementById('tw-css')){ const st = document.createElement('style'); st.id = 'tw-css'; st.textContent = CSS; document.head.appendChild(st); }
    const dias = d.dias || [];
    if(!dias.length){ caja.innerHTML = '<div class="tw-vacio">Sin datos del tiempo ahora mismo</div>'; return; }
    const FV = FU.filter(([k]) => dias.some(x => x[k]));
    const ref = x => x.aemet || x.meteored || x.accuweather || {};
    const hoy = dias[0], rh = ref(hoy), mh = media(hoy) ?? 0, th = tipo(rh.cielo, mh);
    const mins = dias.map(x => ref(x).min).filter(v => v != null), maxs = dias.map(x => ref(x).max).filter(v => v != null);
    const lo = Math.min(...mins), hi = Math.max(...maxs), rango = Math.max(1, hi - lo);
    const lluvia = dias.filter(x => (media(x) ?? 0) >= 50).map(x => dif(x.fecha) === 0 ? 'hoy' : dif(x.fecha) === 1 ? 'mañana' : LARGOS[(fechaIso(x.fecha).getDay()+6)%7]);
    let h = `<div class="tw" data-cielo="${th}"><div class="tw-hero"><div class="tw-lugar">Fuente Obejuna</div>`
      + `<div class="tw-gr">${rh.max != null ? rh.max : '–'}<sup>°</sup></div><div class="tw-ce">${esc(rh.cielo || '')}</div>`
      + `<div class="tw-mm">Máx. ${rh.max ?? '–'}°  ·  Mín. ${rh.min ?? '–'}°${(hoy.meteored && hoy.meteored.mm) ? '  ·  ' + String(hoy.meteored.mm).replace('.', ',') + ' l/m²' : ''}</div>`
      + `<div class="tw-ll">${ICO.gota}${lluvia.length ? 'Lluvia: ' + esc(lluvia.join(', ')) : 'Sin lluvia esta semana'}</div></div>`
      + `<div class="tw-sem"><div class="tw-st">Próximos 7 días · toca un día para comparar</div>`;
    h += dias.map(x => {
      const r = ref(x), m = media(x), t = tipo(r.cielo, m ?? 0), mm = Math.max(0, ...FU.map(([k]) => (x[k] && x[k].mm) || 0));   // litros: solo los da Meteored
      const izq = r.min != null ? (r.min - lo) / rango * 100 : 0, anc = r.max != null && r.min != null ? Math.max(6, (r.max - r.min) / rango * 100) : 0;
      const filas = FV.map(([k, n]) => {
        const v = x[k];
        if(!v) return `<div class="tw-f"><div>${n}</div><div class="tw-b"></div><div class="tw-v">—</div></div>`;
        const p = v.prob == null ? null : Math.max(0, Math.min(100, v.prob));
        return `<div class="tw-f"><div>${n}${v.max != null ? `<small>${v.max}° / ${v.min}°</small>` : ''}</div><div class="tw-b"><i style="width:${p ?? 0}%"></i></div><div class="tw-v">${p == null ? '—' : p + ' %'}${v.mm ? ` <small>${String(v.mm).replace('.', ',')} l/m²</small>` : ''}</div></div>`;
      }).join('');
      const ab = abiertos.has(x.fecha);
      return `<div class="tw-d${ab ? ' abierto' : ''}" data-f="${x.fecha}"><div class="tw-fila"><div class="tw-dn">${corto(x.fecha)}</div><div class="tw-ic">${ICO[t]}</div>`
        + `<div class="tw-pr${!m && !mm ? ' cero' : ''}">${m ? m + ' %' : ''}${mm ? `<small>${String(mm).replace('.', ',')} l/m²</small>` : ''}</div><div class="tw-mn">${r.min ?? ''}°</div>`
        + `<div class="tw-rg"><i style="left:${izq}%;width:${anc}%"></i></div><div class="tw-mx">${r.max ?? ''}°</div></div>`
        + `<div class="tw-cmp"${ab ? '' : ' hidden'}><div class="tw-cd">${esc(largo(x.fecha))}${r.cielo ? ' · ' + esc(r.cielo) : ''}</div>${filas}</div></div>`;
    }).join('');
    const f = d.fuentes || {};
    const faltan = FU.filter(([k]) => f[k] && f[k].error).map(([k, n]) => n + (k === 'accuweather' && /clave/.test(f[k].error) ? ' (falta la clave de su servicio)' : ' (no responde ahora)'));
    h += `</div><div class="tw-pie">El % de cada día es la media de ${FV.map(x => x[1]).join(' y ')}; los litros por metro cuadrado son de Meteored (AEMET no los da por pueblo). Al tocar un día, la probabilidad de lluvia y la máxima / mínima de cada uno.${faltan.length ? '<br>Sin datos: ' + esc(faltan.join(', ')) + '.' : ''}</div></div>`;
    caja.innerHTML = h;
    caja.querySelectorAll('.tw-d').forEach(el => el.querySelector('.tw-fila').addEventListener('click', () => {
      const c = el.querySelector('.tw-cmp'), abre = c.hidden; c.hidden = !abre; el.classList.toggle('abierto', abre);
      abre ? abiertos.add(el.dataset.f) : abiertos.delete(el.dataset.f);
    }));
  }

  let _ult = 0;
  async function cargar(caja, hora){
    if(!caja) return;
    if(!caja.querySelector('.tw')) caja.innerHTML = '<div class="tw-vacio">Cargando…</div>';
    if(hora) hora.textContent = 'Actualizando…';
    try{
      const d = await (await fetch(URL_TIEMPO, {cache: 'no-store'})).json();
      render(caja, d); _ult = Date.now();
      const t = new Date(d.actualizado || Date.now());
      if(hora) hora.textContent = 'Actualizado a las ' + String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
    }catch(e){
      if(!caja.querySelector('.tw')) caja.innerHTML = '<div class="tw-vacio">Sin conexión con el tiempo ahora mismo</div>';
      if(hora) hora.textContent = 'Sin conexión';
    }
  }
  window.EXGTiempo = { cargar, render, ultima: () => _ult };
})();
