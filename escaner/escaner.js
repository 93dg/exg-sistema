/* escaner.js — Escáner de documentos para subir.html (como el de Notas del iPhone).
   Hace la foto -> detecta el documento -> quita el fondo -> lo endereza -> lo limpia (Color o Blanco y negro).
   El motor es OpenCV.js (escaner/opencv.js), que solo se descarga la primera vez que se toca Escanear. */
(function () {
  "use strict";
  const BASE = (function () { const s = document.currentScript; return s && s.src ? s.src.replace(/[^/]*$/, "") : "escaner/"; })();
  let promesaCV = null;

  // ---------- OpenCV ----------
  function cargarOpenCV() {
    if (promesaCV) return promesaCV;
    promesaCV = new Promise((ok, ko) => {
      // OJO: el objeto cv de OpenCV tiene un método "then"; si se devolviera dentro de una promesa se quedaría en un bucle. Se deja en window.cv y la promesa no lleva valor.
      const listo = (cv) => { if (cv && cv.Mat) { window.cv = cv; ok(); } else ko(new Error("opencv sin inicializar")); };
      if (window.cv && window.cv.Mat) return ok();
      const s = document.createElement("script");
      s.src = BASE + "opencv.js"; s.async = true;
      s.onload = () => {
        const cv = window.cv;
        if (cv && typeof cv.then === "function") cv.then((r) => listo(r), ko);      // versiones nuevas: cv se inicializa con then
        else if (cv && cv.Mat) listo(cv);
        else if (cv) cv.onRuntimeInitialized = () => listo(window.cv);
        else ko(new Error("opencv no cargó"));
      };
      s.onerror = () => { promesaCV = null; ko(new Error("No se pudo descargar el escáner")); };
      document.head.appendChild(s);
    });
    return promesaCV;
  }

  // ---------- Geometría ----------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function ordenar(pts) {   // -> [arriba-izq, arriba-der, abajo-der, abajo-izq]
    const s = pts.map((p) => p.x + p.y), d = pts.map((p) => p.y - p.x);
    return [pts[s.indexOf(Math.min(...s))], pts[d.indexOf(Math.min(...d))], pts[s.indexOf(Math.max(...s))], pts[d.indexOf(Math.max(...d))]];
  }
  function areaPoligono(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a) / 2; }
  function esquinasPorDefecto(w, h) { const mx = w * 0.06, my = h * 0.06; return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }]; }

  // ---------- Detección del documento ----------
  // Devuelve { esquinas: [4 puntos en coordenadas del canvas], seguro: true/false }
  function detectar(cv, canvas) {
    const p1 = unaPasada(cv, canvas);
    if (!p1) return { esquinas: esquinasPorDefecto(canvas.width, canvas.height), seguro: false };
    // Segunda pasada, recortando alrededor de lo encontrado: menos fondo alrededor ayuda a precisar los bordes reales.
    const xs = p1.quad.map((q) => q.x), ys = p1.quad.map((q) => q.y);
    const mx = (Math.max(...xs) - Math.min(...xs)) * 0.12, my = (Math.max(...ys) - Math.min(...ys)) * 0.12;
    const x0 = Math.max(0, Math.min(...xs) - mx), y0 = Math.max(0, Math.min(...ys) - my);
    const x1 = Math.min(canvas.width, Math.max(...xs) + mx), y1 = Math.min(canvas.height, Math.max(...ys) + my);
    const wr = Math.round(x1 - x0), hr = Math.round(y1 - y0);
    if (wr < 40 || hr < 40) return { esquinas: ordenar(p1.quad), seguro: p1.cobertura >= 0.75 };
    const recorte = document.createElement("canvas"); recorte.width = wr; recorte.height = hr;
    recorte.getContext("2d").drawImage(canvas, x0, y0, wr, hr, 0, 0, wr, hr);
    const p2 = unaPasada(cv, recorte);
    const final = p2 ? { quad: p2.quad.map((q) => ({ x: q.x + x0, y: q.y + y0 })), cobertura: p2.cobertura } : p1;
    return { esquinas: ordenar(final.quad), seguro: final.cobertura >= 0.75 };
  }

  // Una pasada de detección sobre una imagen (foto completa o un recorte de ella).
  // Combina cuatro formas de ver el documento y se queda con la que mejor coincide con "esto parece papel":
  //  1) contraste global (Otsu), 2) bordes (Canny), 3) el trozo de papel más grande, 4) todos los trozos de papel unidos
  //     (una fila oscura de una tabla, un pliegue, etc. puede partir el papel en varios trozos).
  function unaPasada(cv, canvas) {
    const borrar = [];
    const M = (m) => { borrar.push(m); return m; };
    try {
      const src = M(cv.imread(canvas));
      const esc = Math.min(1, 720 / Math.max(src.cols, src.rows));
      const w = Math.max(1, Math.round(src.cols * esc)), h = Math.max(1, Math.round(src.rows * esc));
      const peq = M(new cv.Mat()); cv.resize(src, peq, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
      const gris = M(new cv.Mat()); cv.cvtColor(peq, gris, cv.COLOR_RGBA2GRAY);
      const suave = M(new cv.Mat()); cv.GaussianBlur(gris, suave, new cv.Size(5, 5), 0);
      const hsv = M(new cv.Mat()); cv.cvtColor(peq, hsv, cv.COLOR_RGBA2RGB); cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
      const canalesHSV = M(new cv.MatVector()); cv.split(hsv, canalesHSV);
      const saturacion = M(canalesHSV.get(1));
      const area = w * h;

      // Máscara "esto parece papel": liso (poca variación local), claro y sin apenas color.
      const kv = Math.max(5, Math.round(Math.min(w, h) / 60)) | 1;
      const media = M(new cv.Mat()); cv.boxFilter(suave, media, cv.CV_32F, new cv.Size(kv, kv));
      const suave2 = M(new cv.Mat()); suave.convertTo(suave2, cv.CV_32F); cv.multiply(suave2, suave2, suave2);
      const mediaCuad = M(new cv.Mat()); cv.boxFilter(suave2, mediaCuad, cv.CV_32F, new cv.Size(kv, kv));
      const mediaAlCuad = M(new cv.Mat()); cv.multiply(media, media, mediaAlCuad);
      const varianza = M(new cv.Mat()); cv.subtract(mediaCuad, mediaAlCuad, varianza);
      const varRec = M(new cv.Mat()); cv.min(varianza, new cv.Mat(varianza.rows, varianza.cols, varianza.type(), new cv.Scalar(90)), varRec);
      const var8 = M(new cv.Mat()); varRec.convertTo(var8, cv.CV_8U, 255 / 90);
      const media8 = M(new cv.Mat()); media.convertTo(media8, cv.CV_8U);
      const liso = M(new cv.Mat()), claro = M(new cv.Mat()), pocoColor = M(new cv.Mat()), papel = M(new cv.Mat());
      cv.threshold(var8, liso, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      cv.threshold(media8, claro, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.threshold(saturacion, pocoColor, 70, 255, cv.THRESH_BINARY_INV);
      cv.bitwise_and(liso, claro, papel); cv.bitwise_and(papel, pocoColor, papel);
      const cierrePapel = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)));
      cv.morphologyEx(papel, papel, cv.MORPH_OPEN, cierrePapel);
      cv.morphologyEx(papel, papel, cv.MORPH_CLOSE, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(19, 19))));

      const bordes = M(new cv.Mat());   // se rellena más abajo, antes de puntuar candidatos
      // Cuánto de un candidato cae dentro de esa máscara de papel (0 a 1): descarta bordes del propio fondo (madera, mantel...).
      function cobertura(quad) {
        const relleno = M(cv.Mat.zeros(h, w, cv.CV_8U));
        const pts = quad.map((p) => [Math.round(p.x), Math.round(p.y)]);
        const matPts = M(cv.matFromArray(pts.length, 1, cv.CV_32SC2, pts.flat()));
        const vec = M(new cv.MatVector()); vec.push_back(matPts);
        cv.fillPoly(relleno, vec, new cv.Scalar(255));
        const inter = M(new cv.Mat()); cv.bitwise_and(relleno, papel, inter);
        const nRel = cv.countNonZero(relleno);
        return nRel > 0 ? cv.countNonZero(inter) / nRel : 0;
      }
      function aQuad(contorno) {
        const hull = M(new cv.Mat()); cv.convexHull(contorno, hull, false, true);
        const areaHull = cv.contourArea(hull), per = cv.arcLength(hull, true); let quad = null, exacto = false;
        for (const eps of [0.015, 0.025, 0.04, 0.06, 0.09, 0.13]) {
          const ap = M(new cv.Mat()); cv.approxPolyDP(hull, ap, eps * per, true);
          if (ap.rows === 4) { quad = []; for (let k = 0; k < 4; k++) quad.push({ x: ap.data32S[k * 2], y: ap.data32S[k * 2 + 1] }); exacto = true; }
          if (quad) break;
        }
        if (!quad) { const r = cv.minAreaRect(hull); quad = cv.RotatedRect.points(r).map((p) => ({ x: p.x, y: p.y })); }
        return { quad, areaHull, exacto };
      }
      // V7.40 — APOYO EN BORDES: qué parte del contorno del candidato cae sobre un borde real de la foto (0 a 1).
      // Un documento de verdad tiene borde en sus cuatro lados; un cuadrilátero inventado (líneas que cruzan la foto) no.
      // Así funciona también con tarjetas de colores (DNI, permiso) sobre fondos con textura, donde «parece papel» falla.
      function apoyo(quad) {
        let si = 0, tot = 0;
        for (let k = 0; k < 4; k++) {
          const a = quad[k], b = quad[(k + 1) % 4];
          for (let t = 0.08; t <= 0.92; t += 0.02) {
            const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t); tot++;
            if (x >= 0 && y >= 0 && x < w && y < h && bordes.ucharPtr(y, x)[0] > 0) si++;
          }
        }
        return tot ? si / tot : 0;
      }
      function rectitud(quad) {   // 1 si los cuatro ángulos son rectos; baja con lo torcido que esté
        let peor = 0;
        for (let k = 0; k < 4; k++) {
          const p = quad[(k + 3) % 4], q = quad[k], r = quad[(k + 1) % 4];
          const v1 = { x: p.x - q.x, y: p.y - q.y }, v2 = { x: r.x - q.x, y: r.y - q.y };
          const c = Math.abs((v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1));
          peor = Math.max(peor, c);
        }
        return Math.max(0, 1 - peor * 1.4);
      }
      function puntuar(quad, areaHull, exacto) {
        const qa = areaPoligono(quad), relleno = Math.min(areaHull, qa) / Math.max(areaHull, qa);
        const fracImg = qa / area, penaliza = fracImg > 0.97 ? 0.5 : 1;
        const cob = cobertura(quad), ap = apoyo(ordenar(quad)), rc = rectitud(ordenar(quad));
        // Solo se exige coincidir con "esto es papel" a los candidatos grandes (fracImg > 0.75): son los que pueden ser en
        // realidad el fondo colándose. Un candidato normal, con margen visible, se puntúa igual que antes.
        const factorCobertura = fracImg > 0.75 ? Math.pow(Math.max(cob, ap), 2.5) : 1;
        return { quad, cobertura: cob, apoyo: ap, score: Math.sqrt(fracImg) * relleno * relleno * (exacto ? 1 : 0.85) * penaliza * factorCobertura * Math.pow(0.15 + ap, 2) * (0.4 + 0.6 * rc) };
      }
      function probarMayor(bin) {
        const contornos = new cv.MatVector(), jer = new cv.Mat();
        cv.findContours(bin, contornos, jer, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let mejor = null;
        for (let i = 0; i < contornos.size(); i++) {
          const c = contornos.get(i), a = cv.contourArea(c);
          if (a > area * 0.04 && a < area * 0.995) { const { quad, areaHull, exacto } = aQuad(c); const cand = puntuar(quad, areaHull, exacto); if (!mejor || cand.score > mejor.score) mejor = cand; }
        }
        contornos.delete(); jer.delete();
        return mejor;
      }
      function probarLista(bin) {   // también los contornos de dentro (la tarjeta dentro de la cartera, el papel sobre la carpeta…)
        const contornos = new cv.MatVector(), jer = new cv.Mat();
        cv.findContours(bin, contornos, jer, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        let mejor = null;
        for (let i = 0; i < contornos.size(); i++) {
          const c = contornos.get(i), a = cv.contourArea(c);
          if (a > area * 0.05 && a < area * 0.995) { const { quad, areaHull, exacto } = aQuad(c); const cand = puntuar(quad, areaHull, exacto); if (!mejor || cand.score > mejor.score) mejor = cand; }
        }
        contornos.delete(); jer.delete();
        return mejor;
      }
      function probarUnion(bin) {
        const contornos = new cv.MatVector(), jer = new cv.Mat();
        cv.findContours(bin, contornos, jer, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let puntos = [];
        for (let i = 0; i < contornos.size(); i++) { const c = contornos.get(i); if (cv.contourArea(c) > area * 0.01) for (let j = 0; j < c.rows; j++) puntos.push(c.data32S[j * 2], c.data32S[j * 2 + 1]); }
        contornos.delete(); jer.delete();
        if (puntos.length < 6) return null;
        const matPts = cv.matFromArray(puntos.length / 2, 1, cv.CV_32SC2, puntos);
        const hull = new cv.Mat(); cv.convexHull(matPts, hull, false, true);
        const { quad, areaHull, exacto } = aQuad(hull);
        matPts.delete(); hull.delete();
        return puntuar(quad, areaHull, exacto);
      }

      const cierre = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)));
      const bin = M(new cv.Mat()); cv.threshold(suave, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, cierre);
      const ed = M(new cv.Mat()); cv.Canny(suave, ed, 35, 110); cv.dilate(ed, ed, cierre); cv.morphologyEx(ed, ed, cv.MORPH_CLOSE, cierre);
      const bordesFinos = M(new cv.Mat()); cv.Canny(suave, bordesFinos, 30, 90);
      cv.dilate(bordesFinos, bordes, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))));
      const candidatos = [probarMayor(bin), probarMayor(ed), probarLista(ed), probarMayor(papel), probarUnion(papel)].filter(Boolean);
      if (!candidatos.length) return null;
      const g = candidatos.sort((a, b) => b.score - a.score)[0];
      const k = 1 / esc;
      return { quad: g.quad.map((p) => ({ x: p.x * k, y: p.y * k })), cobertura: Math.max(g.cobertura, g.apoyo || 0) };
    } finally { borrar.forEach((m) => { try { m.delete(); } catch (e) {} }); }
  }

  // ---------- Enderezar y limpiar ----------
  // modo: "original" | "color" | "bn". Devuelve un canvas nuevo con solo el documento.
  function enderezar(cv, canvas, esquinas, modo, maxLado) {
    maxLado = maxLado || 2000;
    const borrar = [], M = (m) => { borrar.push(m); return m; };
    try {
      const [tl, tr, br, bl] = ordenar(esquinas);
      let W = Math.max(dist(br, bl), dist(tr, tl)), H = Math.max(dist(tr, br), dist(tl, bl));
      const f = Math.min(1, maxLado / Math.max(W, H)); W = Math.max(2, Math.round(W * f)); H = Math.max(2, Math.round(H * f));
      const src = M(cv.imread(canvas));
      const a = M(cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]));
      const b = M(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W - 1, 0, W - 1, H - 1, 0, H - 1]));
      const T = M(cv.getPerspectiveTransform(a, b));
      const plano = M(new cv.Mat()); cv.warpPerspective(src, plano, T, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
      // Se quita la iluminación desigual y las sombras: cada píxel se divide por el color del papel de su zona.
      // El "papel" se estima en una copia pequeña y con un cierre morfológico, para que la tinta no se aclare.
      const rgb = M(new cv.Mat()); cv.cvtColor(plano, rgb, cv.COLOR_RGBA2RGB);
      const r = Math.max(1, Math.round(Math.max(W, H) / 300));
      const pw = Math.max(4, Math.round(W / r)), ph = Math.max(4, Math.round(H / r));
      const peq = M(new cv.Mat()); cv.resize(rgb, peq, new cv.Size(pw, ph), 0, 0, cv.INTER_AREA);
      const kr = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
      cv.morphologyEx(peq, peq, cv.MORPH_CLOSE, kr); cv.GaussianBlur(peq, peq, new cv.Size(0, 0), 3);
      const fondo = M(new cv.Mat()); cv.resize(peq, fondo, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
      const limpio = M(new cv.Mat()); cv.divide(rgb, fondo, limpio, 255, -1);
      let salida = limpio;
      if (modo === "original") {   // Daniel 03/10/2026: solo recortar y enderezar, sin tocar colores (a veces el original ya se ve perfecto)
        salida = plano;
      } else if (modo === "bn") {
        const g = M(new cv.Mat()); cv.cvtColor(limpio, g, cv.COLOR_RGB2GRAY);
        const bin = M(new cv.Mat()); cv.adaptiveThreshold(g, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 41, 12);
        salida = M(new cv.Mat()); cv.cvtColor(bin, salida, cv.COLOR_GRAY2RGBA);
      } else {
        const suave = M(new cv.Mat()); cv.convertScaleAbs(limpio, suave, 1.06, -4);   // un punto más de contraste
        salida = M(new cv.Mat()); cv.cvtColor(suave, salida, cv.COLOR_RGB2RGBA);
      }
      // se recorta un 1,2 % por cada lado: ahí se cuela la sombra o el borde de la mesa
      const mx = Math.round(W * 0.012), my = Math.round(H * 0.012);
      const recorte = M(salida.roi(new cv.Rect(mx, my, W - 2 * mx, H - 2 * my))), cont = M(recorte.clone());
      W = W - 2 * mx; H = H - 2 * my; salida = cont;
      const out = document.createElement("canvas"); out.width = W; out.height = H;
      cv.imshow(out, salida);
      return out;
    } finally { borrar.forEach((m) => { try { m.delete(); } catch (e) {} }); }
  }

  // ---------- Foto a canvas (respetando la orientación de la cámara) ----------
  async function fotoACanvas(file, maxLado) {
    maxLado = maxLado || 3000;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const f = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }

  const aBlob = (canvas, calidad) => new Promise((ok) => canvas.toBlob(ok, "image/jpeg", calidad || 0.88));
  function nombreEscaneo() { const d = new Date(), z = (x) => String(x).padStart(2, "0"); return `escaneo-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.jpg`; }

  // ---------- Pantalla del escáner ----------
  function inyectarEstilos() {
    if (document.getElementById("esc-estilos")) return;
    const st = document.createElement("style"); st.id = "esc-estilos";
    st.textContent = `#escaner{position:fixed;inset:0;z-index:9999;background:#141618;display:flex;flex-direction:column;color:#fff;font-family:'Inter',sans-serif;-webkit-user-select:none;user-select:none;}
#escaner[hidden]{display:none;}
.esc-barra{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 10px;}
.esc-barra button{-webkit-appearance:none;appearance:none;border:none;background:transparent;color:#fff;font:600 16px 'Inter',sans-serif;padding:10px 6px;}
.esc-barra .esc-primario{background:#D8560F;border-radius:12px;padding:10px 18px;font-weight:700;}
.esc-barra .esc-primario:disabled{opacity:.45;}
#esc-titulo{font-weight:600;font-size:15px;opacity:.9;text-align:center;flex:1;}
#esc-caja{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:6px 10px;}
#esc-lienzo{max-width:100%;max-height:100%;touch-action:none;border-radius:6px;background:#000;}
#esc-cargando{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;background:rgba(20,22,24,.86);font-weight:600;line-height:1.4;}
#esc-cargando[hidden]{display:none;}
.esc-pie{display:flex;gap:10px;justify-content:center;align-items:center;padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 14px);}
.esc-pie[hidden]{display:none;}
.esc-pie button{-webkit-appearance:none;appearance:none;border:1.5px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:12px;padding:11px 14px;font:600 14px 'Inter',sans-serif;}
.esc-modos{display:flex;border:1.5px solid rgba(255,255,255,.35);border-radius:12px;overflow:hidden;}
.esc-modos button{border:none;border-radius:0;}
.esc-modos button.on{background:#fff;color:#141618;}
#esc-ayuda{font-size:12.5px;opacity:.75;text-align:center;padding:0 16px 4px;}`;
    document.head.appendChild(st);
  }
  function crearPantalla() {
    let el = document.getElementById("escaner");
    if (el) return el;
    inyectarEstilos();
    el = document.createElement("div"); el.id = "escaner"; el.hidden = true;
    el.innerHTML = `<div class="esc-barra"><button type="button" id="esc-cancelar">Cancelar</button><span id="esc-titulo">Escanear</span><button type="button" id="esc-siguiente" class="esc-primario" disabled>Escanear</button></div>
<div id="esc-caja"><canvas id="esc-lienzo"></canvas><div id="esc-cargando" hidden>Preparando el escáner…</div></div>
<div id="esc-ayuda"></div>
<div class="esc-pie" id="esc-pie-ajuste"><button type="button" id="esc-repetir">Repetir foto</button><button type="button" id="esc-auto">Detectar de nuevo</button></div>
<div class="esc-pie" id="esc-pie-resultado" hidden><button type="button" id="esc-volver">Ajustar</button><div class="esc-modos"><button type="button" data-modo="original">Original</button><button type="button" data-modo="color" class="on">Color</button><button type="button" data-modo="bn">Blanco y negro</button></div></div>`;
    document.body.appendChild(el);
    return el;
  }

  // abrir(file, { añadir(file), aviso(texto), repetir() })
  async function abrir(file, cb) {
    cb = cb || {};
    const el = crearPantalla(), $ = (id) => document.getElementById(id);
    const lienzo = $("esc-lienzo"), ctx = lienzo.getContext("2d");
    const st = { foto: null, esquinas: null, paso: "ajustar", modo: "color", resultado: null, arrastrando: -1, cv: null, escala: 1, dpr: Math.min(2, window.devicePixelRatio || 1) };

    const cargando = (txt) => { $("esc-cargando").textContent = txt || ""; $("esc-cargando").hidden = !txt; };
    const cerrar = () => { el.hidden = true; ["click", "pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(() => {}); lienzo.onpointerdown = lienzo.onpointermove = lienzo.onpointerup = lienzo.onpointercancel = null; window.removeEventListener("resize", ajustarLienzo); };
    const limpiarPaso = () => { $("esc-pie-ajuste").hidden = st.paso !== "ajustar"; $("esc-pie-resultado").hidden = st.paso !== "resultado"; $("esc-titulo").textContent = st.paso === "ajustar" ? "Ajusta las esquinas" : "Documento escaneado"; $("esc-siguiente").textContent = st.paso === "ajustar" ? "Escanear" : "Añadir"; $("esc-ayuda").textContent = st.paso === "ajustar" ? "Arrastra los círculos hasta las esquinas del documento" : ""; };

    function ajustarLienzo() {
      const base = st.paso === "ajustar" ? st.foto : st.resultado; if (!base) return;
      const caja = $("esc-caja").getBoundingClientRect(), maxW = Math.max(50, caja.width - 20), maxH = Math.max(50, caja.height - 12);
      st.escala = Math.min(maxW / base.width, maxH / base.height);
      const cw = Math.round(base.width * st.escala), ch = Math.round(base.height * st.escala);
      lienzo.style.width = cw + "px"; lienzo.style.height = ch + "px";
      lienzo.width = Math.round(cw * st.dpr); lienzo.height = Math.round(ch * st.dpr);
      dibujar();
    }
    function dibujar() {
      const base = st.paso === "ajustar" ? st.foto : st.resultado; if (!base) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, lienzo.width, lienzo.height);
      ctx.drawImage(base, 0, 0, lienzo.width, lienzo.height);
      if (st.paso !== "ajustar" || !st.esquinas) return;
      const k = st.escala * st.dpr, p = st.esquinas.map((q) => ({ x: q.x * k, y: q.y * k }));
      ctx.beginPath(); ctx.rect(0, 0, lienzo.width, lienzo.height); ctx.moveTo(p[0].x, p[0].y); [3, 2, 1].forEach((i) => ctx.lineTo(p[i].x, p[i].y)); ctx.closePath();
      ctx.fillStyle = "rgba(0,0,0,.42)"; ctx.fill("evenodd");            // se oscurece lo que quedará fuera
      ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
      ctx.lineWidth = 3 * st.dpr; ctx.strokeStyle = "#FF7A2E"; ctx.stroke();
      p.forEach((q, i) => { if (i === st.arrastrando) return; ctx.beginPath(); ctx.arc(q.x, q.y, 12 * st.dpr, 0, Math.PI * 2); ctx.fillStyle = "#D8560F"; ctx.fill(); ctx.lineWidth = 3 * st.dpr; ctx.strokeStyle = "#fff"; ctx.stroke(); });
      if (st.arrastrando >= 0) lupa(p, k);
    }
    // LUPA (Daniel 03/10/2026: «cuando muevo una esquina me tapo con mi propio dedo»): mientras se arrastra una esquina, en la esquina
    // contraria de la foto sale un círculo con esa zona ampliada 3 veces y una cruz justo donde cae el punto
    function lupa(p, k) {
      // la lupa va FUERA de la foto (en el hueco oscuro de arriba o de abajo), para no tapar ninguna esquina
      let lc = document.getElementById("esc-lupa");
      if (!lc) { lc = document.createElement("canvas"); lc.id = "esc-lupa"; lc.style.cssText = "position:fixed;z-index:10;width:132px;height:132px;border-radius:50%;border:3px solid #fff;box-shadow:0 6px 22px rgba(0,0,0,.55);pointer-events:none;display:none;background:#141618;"; el.appendChild(lc); }
      const D = Math.round(132 * st.dpr); if (lc.width !== D){ lc.width = D; lc.height = D; }
      const r = lienzo.getBoundingClientRect(), q = p[st.arrastrando], qyPant = r.top + q.y / st.dpr;
      const arriba = qyPant > window.innerHeight / 2;   // el dedo abajo: lupa arriba; el dedo arriba: lupa abajo
      lc.style.left = Math.round(window.innerWidth / 2 - 66) + "px";
      lc.style.top = (arriba ? Math.max(70, r.top - 150) : Math.min(window.innerHeight - 220, r.bottom + 18)) + "px";
      lc.style.display = "block";
      const c2 = lc.getContext("2d"), R = D / 2, Z = 3, f = st.esquinas[st.arrastrando], lado = D / (k * Z);
      c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, D, D); c2.fillStyle = "#141618"; c2.fillRect(0, 0, D, D);
      c2.drawImage(st.foto, f.x - lado / 2, f.y - lado / 2, lado, lado, 0, 0, D, D);
      c2.lineWidth = 2 * st.dpr; c2.strokeStyle = "#FF7A2E";
      [(st.arrastrando + 1) % 4, (st.arrastrando + 3) % 4].forEach((j) => { const o = st.esquinas[j]; c2.beginPath(); c2.moveTo(R, R); c2.lineTo(R + (o.x - f.x) * k * Z, R + (o.y - f.y) * k * Z); c2.stroke(); });
      c2.lineWidth = 1.5 * st.dpr; c2.strokeStyle = "#fff";
      c2.beginPath(); c2.moveTo(R - 14 * st.dpr, R); c2.lineTo(R + 14 * st.dpr, R); c2.moveTo(R, R - 14 * st.dpr); c2.lineTo(R, R + 14 * st.dpr); c2.stroke();
      // el punto que se arrastra se dibuja hueco, para ver lo que hay debajo
      ctx.beginPath(); ctx.arc(q.x, q.y, 14 * st.dpr, 0, Math.PI * 2); ctx.lineWidth = 2.5 * st.dpr; ctx.strokeStyle = "#FF7A2E"; ctx.stroke();
    }
    function lupaFuera(){ const lc = document.getElementById("esc-lupa"); if (lc) lc.style.display = "none"; }
    function punto(ev) { const r = lienzo.getBoundingClientRect(); return { x: (ev.clientX - r.left) / st.escala, y: (ev.clientY - r.top) / st.escala }; }
    lienzo.onpointerdown = (ev) => {
      if (st.paso !== "ajustar" || !st.esquinas) return;
      const p = punto(ev); let mejor = -1, md = 48 / st.escala;   // hasta 48 px del dedo
      st.esquinas.forEach((q, i) => { const d = dist(q, p); if (d < md) { md = d; mejor = i; } });
      if (mejor >= 0) { st.arrastrando = mejor; try { lienzo.setPointerCapture(ev.pointerId); } catch (e) {} ev.preventDefault(); dibujar(); }
    };
    lienzo.onpointermove = (ev) => {
      if (st.arrastrando < 0) return;
      const p = punto(ev); st.esquinas[st.arrastrando] = { x: Math.max(0, Math.min(st.foto.width, p.x)), y: Math.max(0, Math.min(st.foto.height, p.y)) };
      dibujar(); ev.preventDefault();
    };
    lienzo.onpointerup = lienzo.onpointercancel = () => { st.arrastrando = -1; lupaFuera(); dibujar(); };

    async function detectarAhora() {
      cargando("Detectando el documento…"); await new Promise((r) => setTimeout(r, 30));
      try {
        const r = detectar(st.cv, st.foto); st.esquinas = r.esquinas;
        if (!r.seguro && cb.aviso) cb.aviso("No he visto bien los bordes: ajusta las esquinas con el dedo.");
      } catch (e) { st.esquinas = esquinasPorDefecto(st.foto.width, st.foto.height); if (cb.aviso) cb.aviso("No se pudo detectar el documento: ajusta las esquinas."); }
      cargando(""); dibujar(); $("esc-siguiente").disabled = false;
    }
    async function generar() {
      cargando("Escaneando…"); await new Promise((r) => setTimeout(r, 30));
      try { st.resultado = enderezar(st.cv, st.foto, st.esquinas, st.modo); }
      catch (e) { cargando(""); if (cb.aviso) cb.aviso("No se pudo escanear: " + (e && e.message || "error")); return false; }
      st.paso = "resultado"; cargando(""); limpiarPaso(); ajustarLienzo(); return true;
    }

    // botones
    $("esc-cancelar").onclick = cerrar;
    $("esc-repetir").onclick = () => { cerrar(); if (cb.repetir) cb.repetir(); };
    $("esc-auto").onclick = detectarAhora;
    $("esc-volver").onclick = () => { st.paso = "ajustar"; limpiarPaso(); ajustarLienzo(); };
    el.querySelectorAll(".esc-modos button").forEach((b) => (b.onclick = async () => {
      st.modo = b.dataset.modo; el.querySelectorAll(".esc-modos button").forEach((x) => x.classList.toggle("on", x === b)); await generar();
    }));
    $("esc-siguiente").onclick = async () => {
      if (st.paso === "ajustar") { $("esc-siguiente").disabled = true; const ok = await generar(); $("esc-siguiente").disabled = false; return ok; }
      const blob = await aBlob(st.resultado, 0.88);
      const f = new File([blob], nombreEscaneo(), { type: "image/jpeg", lastModified: Date.now() });
      cerrar(); if (cb.añadir) cb.añadir(f);
    };

    // arranque
    st.paso = "ajustar"; st.modo = "color"; el.querySelectorAll(".esc-modos button").forEach((x) => x.classList.toggle("on", x.dataset.modo === "color"));
    $("esc-siguiente").disabled = true; limpiarPaso(); el.hidden = false; window.addEventListener("resize", ajustarLienzo);
    cargando("Preparando el escáner… (la primera vez tarda unos segundos)");
    try {
      st.foto = await fotoACanvas(file);
      ajustarLienzo();
      await cargarOpenCV(); st.cv = window.cv;
    } catch (e) {
      cerrar();
      if (cb.aviso) cb.aviso("El escáner no está disponible (" + ((e && e.message) || "error") + "). Se añade la foto tal cual.");
      if (cb.añadir) cb.añadir(file);
      return;
    }
    await detectarAhora();
  }

  window.EXGEscaner = { abrir, cargarOpenCV, detectar, enderezar, fotoACanvas, ordenar, esquinasPorDefecto };
})();
