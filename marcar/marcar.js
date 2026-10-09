/* EXG — Marcar fotos (S3.27): lápiz, círculo, flecha, deshacer. Resultado: JPEG que sustituye a la foto. */
(function(){
  const COLORES = ["#e5231b","#f5c400","#1f6feb","#ffffff"];
  const SVG = {
    lapiz:'<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/>',
    circulo:'<circle cx="12" cy="12" r="8"/>',
    flecha:'<path d="M5 19L19 5M10 5h9v9"/>',
    deshacer:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'
  };
  const ico = n => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+SVG[n]+'</svg>';
  function css(){
    if (document.getElementById("marcar-css")) return;
    const s = document.createElement("style"); s.id = "marcar-css";
    s.textContent = `#marcar-ov{position:fixed;inset:0;z-index:9999;background:#111;display:flex;flex-direction:column;touch-action:none;user-select:none;-webkit-user-select:none}
#marcar-ov .mk-top,#marcar-ov .mk-bot{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1b1f24;color:#fff;flex-wrap:wrap;justify-content:center}
#marcar-ov .mk-top{justify-content:space-between;flex-wrap:nowrap}
#marcar-ov .mk-lienzo{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
#marcar-ov canvas{touch-action:none;background:#000}
#marcar-ov button{border:none;border-radius:999px;background:#2d333b;color:#fff;font:600 14px system-ui,sans-serif;padding:0 14px;height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;gap:6px}
#marcar-ov button svg{width:22px;height:22px}
#marcar-ov button.on{background:#fff;color:#111}
#marcar-ov button.mk-ok{background:#2f9e44}
#marcar-ov .mk-col{width:34px;height:34px;min-width:34px;padding:0;border:3px solid #2d333b}
#marcar-ov .mk-col.on{border-color:#fff}`;
    document.head.appendChild(s);
  }
  function abrir(file, opc){
    css(); opc = opc || {};
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); opc.aviso && opc.aviso("No se pudo abrir la foto para marcarla."); };
    img.onload = () => {
      const MAX = 2400, k = Math.min(1, MAX/Math.max(img.naturalWidth, img.naturalHeight));
      const W = Math.round(img.naturalWidth*k), H = Math.round(img.naturalHeight*k);
      const ov = document.createElement("div"); ov.id = "marcar-ov";
      ov.innerHTML = '<div class="mk-top"><button type="button" data-a="x">Cancelar</button><button type="button" data-a="u" aria-label="Deshacer">'+ico("deshacer")+'</button><button type="button" class="mk-ok" data-a="ok">Listo</button></div><div class="mk-lienzo"></div><div class="mk-bot"></div>';
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      ov.querySelector(".mk-lienzo").appendChild(cv);
      const bot = ov.querySelector(".mk-bot");
      let herr = "lapiz", color = COLORES[0], trazos = [], actual = null;
      [["lapiz","Lápiz"],["circulo","Círculo"],["flecha","Flecha"]].forEach(([id,t]) => { const b = document.createElement("button"); b.type="button"; b.dataset.h=id; b.setAttribute("aria-label",t); b.innerHTML = ico(id)+t; bot.appendChild(b); });
      COLORES.forEach(c => { const b = document.createElement("button"); b.type="button"; b.className="mk-col"; b.dataset.c=c; b.style.background=c; b.setAttribute("aria-label","Color"); bot.appendChild(b); });
      const ctx = cv.getContext("2d");
      const grosor = () => Math.max(4, Math.round(Math.max(W,H)/180));
      function dibujar(t){
        ctx.strokeStyle = t.color; ctx.fillStyle = t.color; ctx.lineWidth = t.g; ctx.lineCap = "round"; ctx.lineJoin = "round";
        const a = t.pts[0], b = t.pts[t.pts.length-1];
        if (t.h === "lapiz"){ ctx.beginPath(); ctx.moveTo(a.x,a.y); t.pts.forEach(p => ctx.lineTo(p.x,p.y)); if (t.pts.length===1) ctx.lineTo(a.x+0.1,a.y); ctx.stroke(); }
        else if (t.h === "circulo"){ ctx.beginPath(); ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2||1,Math.abs(b.y-a.y)/2||1,0,0,Math.PI*2); ctx.stroke(); }
        else { const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy); if (L<2) return; const ang=Math.atan2(dy,dx), h=Math.min(L*0.5, t.g*5);
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x-h*Math.cos(ang-0.45),b.y-h*Math.sin(ang-0.45)); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x-h*Math.cos(ang+0.45),b.y-h*Math.sin(ang+0.45)); ctx.stroke(); }
      }
      function pintar(){ ctx.drawImage(img,0,0,W,H); trazos.forEach(dibujar); if (actual) dibujar(actual); }
      function marca(){ bot.querySelectorAll("[data-h]").forEach(b => b.classList.toggle("on", b.dataset.h===herr)); bot.querySelectorAll("[data-c]").forEach(b => b.classList.toggle("on", b.dataset.c===color)); }
      const pos = e => { const r = cv.getBoundingClientRect(); return { x:(e.clientX-r.left)*W/r.width, y:(e.clientY-r.top)*H/r.height }; };
      cv.addEventListener("pointerdown", e => { e.preventDefault(); try{cv.setPointerCapture(e.pointerId);}catch(_){} actual = { h:herr, color, g:grosor(), pts:[pos(e)] }; pintar(); });
      cv.addEventListener("pointermove", e => { if (!actual) return; e.preventDefault(); const p = pos(e); if (actual.h==="lapiz") actual.pts.push(p); else actual.pts[1]=p; pintar(); });
      const fin = e => { if (!actual) return; trazos.push(actual); actual = null; pintar(); };
      cv.addEventListener("pointerup", fin); cv.addEventListener("pointercancel", fin);
      let cerrar = function(){ ov.remove(); URL.revokeObjectURL(url); };
      ov.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.h){ herr = b.dataset.h; marca(); }
        else if (b.dataset.c){ color = b.dataset.c; marca(); }
        else if (b.dataset.a==="u"){ trazos.pop(); pintar(); }
        else if (b.dataset.a==="x"){ cerrar(); }
        else if (b.dataset.a==="ok"){
          if (!trazos.length){ cerrar(); return; }
          cv.toBlob(bl => {
            if (!bl){ opc.aviso && opc.aviso("No se pudo guardar la marca."); return; }
            const nombre = (file.name||"foto").replace(/\.[^.]+$/,"") + "-marcada.jpg";
            const f = new File([bl], nombre, { type:"image/jpeg", lastModified: Date.now() });
            cerrar(); opc.listo && opc.listo(f);
          }, "image/jpeg", 0.92);
        }
      });
      document.body.appendChild(ov); marca(); pintar();
      const lz = ov.querySelector(".mk-lienzo");
      function ajustar(){ const k2 = Math.min(lz.clientWidth/W, lz.clientHeight/H); cv.style.width = Math.floor(W*k2)+"px"; cv.style.height = Math.floor(H*k2)+"px"; }
      ajustar(); window.addEventListener("resize", ajustar);
      const _c = cerrar; cerrar = function(){ window.removeEventListener("resize", ajustar); _c(); };
    };
    img.src = url;
  }
  window.EXGMarcar = { abrir };
})();
