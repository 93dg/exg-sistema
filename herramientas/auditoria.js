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
    // 1) minúscula al principio de un bloque de texto
    if (BLOQ.test(s.display)) {
      const first = [...e.childNodes].find(n => (n.nodeType === 3 && n.textContent.trim()) || n.nodeType === 1);
      if (first && first.nodeType === 3) {
        const t = first.textContent.trim();
        if (/^[a-zñáéíóú]/.test(t) && !/^(h|x|vs|kg|km|m|l|de|del|en|y|o|a|e|al|por|con|sin|desde|hasta)\b/.test(t) && s.textTransform !== 'uppercase') {
          const k = 'm' + t.slice(0, 40); if (!vistos.has(k)) { vistos.add(k); out.push(['minuscula', t.slice(0, 80)]); }
        }
      }
    }
    // 2) texto corto partido en dos líneas (pastillas, importes, etiquetas, filas de una línea)
    const txt = e.textContent.trim();
    const soloInline = !e.querySelector('br') && [...e.querySelectorAll('*')].every(x => getComputedStyle(x).display === 'inline');
    if (txt.length <= 60 && soloInline) {
      const rg = document.createRange(); rg.selectNodeContents(e);
      const tops = new Set([...rg.getClientRects()].filter(x => x.width > 1).map(x => Math.round(x.top)));
      if (tops.size > 1) { const k = 'p' + txt; if (!vistos.has(k)) { vistos.add(k); out.push(['partido', txt]); } }
    }
    // 3) texto que se sale de la pantalla
    const r = e.getBoundingClientRect();
    if (r.right > W + 2 && s.position !== 'fixed' && !e.closest('[style*="overflow-x"],.tabla-scroll')) {
      const k = 'd' + txt.slice(0, 40); if (!vistos.has(k)) { vistos.add(k); out.push(['desborda', txt.slice(0, 80)]); }
    }
  }
  return out;
})()
