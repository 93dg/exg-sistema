/* EXG — Tiempo (V14.01, Daniel 16/11/2026: «mejora eso visualmente, es súper cutre»)
   Una sola tarjeta de día para la web (sección Tiempo) y para la app aparte tiempo.html.
   Datos de la función tiempo: los próximos 7 días de AEMET, Meteored y AccuWeather en Fuente Obejuna. Solo lee. */
(function(){
  const URL_TIEMPO = 'https://sshctqnpuolawtcujxkt.supabase.co/functions/v1/tiempo';
  const FU = [['aemet','AEMET'],['meteored','Meteored'],['accuweather','AccuWeather']];
  const DIAS = ['lun','mar','mié','jue','vie','sáb','dom'], LARGOS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'], MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const CSS = `
.tw-res,.tw-dia{background:var(--paper,#FBFAF7);border:1px solid var(--line,#E3DFD3);border-radius:14px;padding:12px 14px;margin-bottom:10px;}
.tw-res .tw-l{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:5px 0;}
.tw-res .tw-l span:first-child{color:var(--ink-soft,#6B7178);}
.tw-res .tw-l span:last-child{font-weight:600;text-align:right;}
.tw-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.tw-dn{font-weight:700;font-size:15px;line-height:1.2;}
.tw-df{font-size:12px;color:var(--ink-soft,#6B7178);margin-top:1px;}
.tw-tp{display:flex;align-items:center;gap:8px;color:var(--ink,#1B1F24);}
.tw-tp svg{width:30px;height:30px;}
.tw-tmax{font-weight:700;font-size:17px;}
.tw-tmin{font-size:14px;color:var(--ink-soft,#6B7178);}
.tw-cielo{font-size:12px;color:var(--ink-soft,#6B7178);margin:4px 0 8px;}
.tw-f{display:grid;grid-template-columns:92px 1fr 82px;align-items:center;gap:10px;padding:5px 0;}
.tw-fn{font-size:13px;line-height:1.15;}
.tw-fn small{display:block;font-size:11px;color:var(--ink-soft,#6B7178);margin-top:1px;}
.tw-bar{height:8px;border-radius:4px;background:var(--line,#E3DFD3);overflow:hidden;}
.tw-bar i{display:block;height:100%;border-radius:4px;background:var(--blue,#2B5C7A);}
.tw-v{font-size:13px;font-weight:600;text-align:right;white-space:nowrap;min-width:44px;}
.tw-v small{font-weight:400;color:var(--ink-soft,#6B7178);}
.tw-f.tw-no .tw-fn,.tw-f.tw-no .tw-v{color:var(--ink-soft,#6B7178);font-weight:400;}
.tw-nota{font-size:11.5px;color:var(--ink-soft,#6B7178);line-height:1.45;padding:2px 2px 8px;}
.tw-vacio{text-align:center;color:var(--ink-soft,#6B7178);font-size:13px;padding:24px 0;}`;
  const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const NUBE = '<path d="M7 17h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 10.5 3.25 3.25 0 0 0 7 17z"/>';
  const ICO = {
    sol: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`,
    claros: `<svg viewBox="0 0 24 24" ${P}><path d="M8 3.5v1.2M3.5 8h1.2M4.8 4.8l.9.9M11.2 4.8l-.9.9"/><path d="M10.6 7.6A3 3 0 0 0 5.4 9.8"/><path d="M8 19h9a3.3 3.3 0 0 0 .4-6.6 4.7 4.7 0 0 0-9.1.6A3 3 0 0 0 8 19z"/></svg>`,
    nube: `<svg viewBox="0 0 24 24" ${P}>${NUBE}</svg>`,
    lluvia: `<svg viewBox="0 0 24 24" ${P}><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.5 3.25 3.25 0 0 0 7 14z"/><path d="M8.5 17l-1 2.5M12.5 17l-1 2.5M16.5 17l-1 2.5"/></svg>`,
    tormenta: `<svg viewBox="0 0 24 24" ${P}><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.5 3.25 3.25 0 0 0 7 14z"/><path d="M12.5 14.5l-2 3.5h3l-2 3.5"/></svg>`,
    nieve: `<svg viewBox="0 0 24 24" ${P}><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.5 3.25 3.25 0 0 0 7 14z"/><path d="M8.5 18h.01M12 19.5h.01M15.5 18h.01"/></svg>`,
    niebla: `<svg viewBox="0 0 24 24" ${P}><path d="M4 9h16M3 13h18M5 17h14"/></svg>`,
  };
  const icono = (t, prob) => {
    t = (t || '').toLowerCase();
    if(/tormenta/.test(t)) return ICO.tormenta;
    if(/nieve|nevada/.test(t)) return ICO.nieve;
    if(/lluvia|chubasco|llovizna/.test(t) || prob >= 60) return ICO.lluvia;
    if(/niebla|bruma|neblina/.test(t)) return ICO.niebla;
    if(/cubierto|muy nuboso/.test(t)) return ICO.nube;
    if(/nub|claros|interval/.test(t)) return ICO.claros;
    return ICO.sol;
  };
  const fechaIso = iso => new Date(iso + 'T00:00:00');
  const nombre = iso => { const x = fechaIso(iso), h = new Date(); h.setHours(0,0,0,0); const d = Math.round((x - h) / 864e5); return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : LARGOS[(x.getDay()+6)%7]; };
  const sub = iso => { const x = fechaIso(iso), n = nombre(iso); return (n === 'Hoy' || n === 'Mañana' ? DIAS[(x.getDay()+6)%7] + ' ' : '') + x.getDate() + ' ' + MESES[x.getMonth()]; };
  const corta = iso => { const x = fechaIso(iso); return DIAS[(x.getDay()+6)%7] + ' ' + x.getDate() + ' ' + MESES[x.getMonth()]; };
  const media = x => { const v = FU.map(([k]) => x[k] && x[k].prob).filter(p => p != null); return v.length ? v.reduce((a,b) => a + b, 0) / v.length : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function render(caja, d){
    if(!document.getElementById('tw-css')){ const st = document.createElement('style'); st.id = 'tw-css'; st.textContent = CSS; document.head.appendChild(st); }
    const dias = d.dias || [];
    const FV = FU.filter(([k]) => dias.some(x => x[k]));   // una fuente sin ningún dato no se pinta en cada día: se dice abajo
    const lluvia = dias.filter(x => (media(x) ?? 0) >= 50).map(x => nombre(x.fecha) === 'Hoy' || nombre(x.fecha) === 'Mañana' ? nombre(x.fecha).toLowerCase() : corta(x.fecha).replace(/ \w+$/, ''));
    const secos = dias.filter(x => { const v = FU.map(([k]) => x[k] && x[k].prob).filter(p => p != null); return v.length && Math.max(...v) <= 20; }).map(x => nombre(x.fecha) === 'Hoy' || nombre(x.fecha) === 'Mañana' ? nombre(x.fecha).toLowerCase() : corta(x.fecha).replace(/ \w+$/, ''));
    let h = `<div class="tw-res"><div class="tw-l"><span>Lluvia probable</span><span>${lluvia.length ? esc(lluvia.join(', ')) : 'ningún día'}</span></div><div class="tw-l"><span>Días secos</span><span>${secos.length ? esc(secos.join(', ')) : 'ninguno'}</span></div></div>`;
    h += dias.map(x => {
      const ref = x.aemet || x.meteored || x.accuweather || {};
      const m = media(x);
      const filas = FV.map(([k, n]) => {
        const v = x[k];
        if(!v) return `<div class="tw-f tw-no"><div class="tw-fn">${n}</div><div class="tw-bar"></div><div class="tw-v">—</div></div>`;
        const p = v.prob == null ? null : Math.max(0, Math.min(100, v.prob));
        const mm = v.mm ? ` <small>${String(v.mm).replace('.', ',')} l</small>` : '';
        const t = v.max != null ? `<small>${v.max}° / ${v.min}°</small>` : '';
        return `<div class="tw-f"><div class="tw-fn">${n}${t}</div><div class="tw-bar"><i style="width:${p ?? 0}%"></i></div><div class="tw-v">${p == null ? '—' : p + ' %'}${mm}</div></div>`;
      }).join('');
      return `<div class="tw-dia"><div class="tw-cab"><div><div class="tw-dn">${nombre(x.fecha)}</div><div class="tw-df">${sub(x.fecha)}</div></div>`
        + `<div class="tw-tp">${icono(ref.cielo, m ?? 0)}<span class="tw-tmax">${ref.max != null ? ref.max + '°' : ''}</span><span class="tw-tmin">${ref.min != null ? ref.min + '°' : ''}</span></div></div>`
        + (ref.cielo ? `<div class="tw-cielo">${esc(ref.cielo)}</div>` : '') + filas + `</div>`;
    }).join('');
    const f = d.fuentes || {};
    const faltan = FU.filter(([k]) => f[k] && f[k].error).map(([k, n]) => n + (k === 'accuweather' && /clave/.test(f[k].error) ? ' (falta la clave de su servicio)' : ' (no responde ahora)'));
    h += `<div class="tw-nota">Barra = probabilidad de lluvia del día; debajo de cada fuente, su máxima / mínima; «l» = litros por metro cuadrado.${faltan.length ? ' Sin datos: ' + esc(faltan.join(', ')) + '.' : ''}</div>`;
    caja.innerHTML = h;
  }

  let _ult = 0;
  async function cargar(caja, hora){
    if(!caja) return;
    if(!caja.querySelector('.tw-dia')) caja.innerHTML = '<div class="tw-vacio">Cargando…</div>';
    if(hora) hora.textContent = 'Actualizando…';
    try{
      const d = await (await fetch(URL_TIEMPO, {cache: 'no-store'})).json();
      render(caja, d); _ult = Date.now();
      const t = new Date(d.actualizado || Date.now());
      if(hora) hora.textContent = 'Actualizado a las ' + String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
    }catch(e){
      if(!caja.querySelector('.tw-dia')) caja.innerHTML = '<div class="tw-vacio">Sin conexión con el tiempo ahora mismo</div>';
      if(hora) hora.textContent = 'Sin conexión';
    }
  }
  window.EXGTiempo = { cargar, render, ultima: () => _ult };
})();
