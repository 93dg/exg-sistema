(() => {
  // Comprobaciones de la GUÍA DE DISEÑO EXG sobre lo que se ve de verdad (a 390 px).
  const out = [], W = innerWidth, vistos = new Set();
  const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && r.bottom > -100000; };
  const BLOQ = /^(block|flex|grid|list-item|table-cell|inline-block|inline-flex)$/;
  const SIN = 'INPUT,TEXTAREA,SELECT,OPTION,SCRIPT,STYLE,CODE,PRE,svg';
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest(SIN) || e.closest('[contenteditable=true]') || e.closest('.visor-doc,.visor,#visor')) continue;
    const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!own.length || !visible(e)) continue;
    const s = getComputedStyle(e);
    // 1) minúscula al principio de un texto (V11.34, Daniel: «ni una minúscula al principio en toda la web»): bloques, pastillas y también lo que va en línea si es lo primero de su bloque; sin excepciones de palabras
    {
      const first = [...e.childNodes].find(n => (n.nodeType === 3 && n.textContent.trim()) || n.nodeType === 1);
      if (first && first.nodeType === 3) {
        const t = first.textContent.trim();
        let alPrincipio = BLOQ.test(s.display), bl = e;
        if (!alPrincipio) { let b = e.parentElement; while (b && !BLOQ.test(getComputedStyle(b).display)) b = b.parentElement; bl = b; alPrincipio = !!b && (b.innerText || '').trim().startsWith(t.slice(0, 12)); }
        // lo que cuenta es lo que ve Daniel: si la primera letra ya sale en mayúscula por la regla general (::first-letter), está bien
        if (alPrincipio && bl) { let q = bl, sale = false; while (q && q !== document.body) { const d = getComputedStyle(q).display; if (/flex|grid/.test(d)) break; if (getComputedStyle(q, '::first-letter').textTransform === 'uppercase') { sale = true; break; } if ((q.parentElement && (q.parentElement.innerText || '').trim().startsWith(t.slice(0, 12)))) q = q.parentElement; else break; } if (sale) { alPrincipio = false; if (/^[a-z0-9._%+-]+@\S+|^(https?:|www\.)/.test(t)) { const k = 'c' + t.slice(0, 40); if (!vistos.has(k)) { vistos.add(k); out.push(['correo_mayus', t.slice(0, 80)]); } } } }
        if (alPrincipio && /^[a-zñáéíóúü]/.test(t) && !/^(h|d|x|kg|km|ud|uds|cm|mm|t|l)\b/.test(t) && !/^\S+@\S+/.test(t) && !/^(https?:|www\.)/.test(t) && s.textTransform !== 'uppercase' && !e.closest('.no-cap,.mono,[translate=no]')) {
          const k = 'm' + t.slice(0, 40); if (!vistos.has(k)) { vistos.add(k); out.push(['minuscula', t.slice(0, 80)]); }
        }
      }
    }
    // 2) texto corto partido en dos líneas (pastillas, importes, etiquetas, filas de una línea)
    const txt = e.textContent.trim();
    const soloInline = !e.querySelector('br') && [...e.querySelectorAll('*')].every(x => getComputedStyle(x).display === 'inline');
    if (txt.length <= 60 && soloInline) {
      const rg = document.createRange(); rg.selectNodeContents(e);
      const rs = [...rg.getClientRects()].filter(x => x.width > 1), tops = [...new Set(rs.map(x => Math.round(x.top)))].sort((a, b) => a - b);
      // partido feo: una etiqueta/importe corto en dos líneas, o una última línea con un trozo suelto (p. ej. «h», «€/h», «%»)
      const anchoLinea = t => rs.filter(x => Math.round(x.top) === t).reduce((m, x) => m + x.width, 0);
      const huerfano = tops.length > 1 && anchoLinea(tops[tops.length - 1]) < 0.25 * anchoLinea(tops[0]);
      if (tops.length > 1 && (txt.length <= 25 || huerfano)) { const k = 'p' + txt; if (!vistos.has(k)) { vistos.add(k); out.push(['partido', txt]); } }
    }
    // 3) texto que se sale de la pantalla
    const r = e.getBoundingClientRect();
    let recortado = false; for (let q = e; q && q !== document.body; q = q.parentElement) { const qs = getComputedStyle(q); if (qs.textOverflow === 'ellipsis' && qs.overflow !== 'visible') { recortado = q.getBoundingClientRect().right <= W + 2; break; } }   // lo que se corta con «…» dentro de su caja no se sale: Daniel ve los puntos suspensivos
    if (r.right > W + 2 && !recortado && s.position !== 'fixed' && !e.closest('[style*="overflow-x"],.tabla-scroll')) {
      const k = 'd' + txt.slice(0, 40); if (!vistos.has(k)) { vistos.add(k); out.push(['desborda', txt.slice(0, 80)]); }
    }
  }
  // 4) la lupa siempre en un extremo de su línea (Daniel 13/10/2026)
  document.querySelectorAll('button[title="Buscar"], .busq-lupa, .emp-f-lupa').forEach(b => {
    if (!b.offsetParent || b.closest('#busq-ov,#busq-fab')) return;
    const q = b.getBoundingClientRect(); let f = b.parentElement; while (f && f.parentElement && f.getBoundingClientRect().width < 0.6 * f.parentElement.getBoundingClientRect().width) f = f.parentElement; if (!f) return;
    const mid = (q.top + q.bottom) / 2, hojas = [...f.querySelectorAll('*')].filter(x => x !== b && !b.contains(x) && !x.contains(b) && x.offsetParent && x.children.length === 0 && x.getBoundingClientRect().width > 0 && Math.abs((x.getBoundingClientRect().top + x.getBoundingClientRect().bottom) / 2 - mid) < 14);
    const der = hojas.some(x => x.getBoundingClientRect().left > q.right - 2), izq = hojas.some(x => x.getBoundingClientRect().right < q.left + 2);
    if (der && izq) { const t = 'Lupa en medio de su línea: ' + (f.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50); if (!vistos.has(t)) { vistos.add(t); out.push(['lupa', t]); } }
  });
  return out;
})()
