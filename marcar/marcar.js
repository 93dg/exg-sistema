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
      let sel = null, mov = null, lupa = null, zoom = 1, tx = 0, ty = 0, ptrs = new Map(), pinch = null, ignorar = false, W = Math.round(img.naturalWidth*k), H = Math.round(img.naturalHeight*k), base = img, hist = [], rec = null, drag = null;
      const ov = document.createElement("div"); ov.id = "marcar-ov";
      ov.innerHTML = '<div class="mk-top"><button type="button" data-a="x">Cancelar</button><button type="button" data-a="z" aria-label="Zoom 1x">1×</button><button type="button" data-a="del" aria-label="Borrar" style="display:none">Borrar</button><button type="button" data-a="u" aria-label="Deshacer">'+ico("deshacer")+'</button><button type="button" class="mk-ok" data-a="ok">Listo</button><button type="button" class="mk-ok" data-a="ap" style="display:none">Aplicar</button></div><div class="mk-lienzo"></div><div class="mk-bot"></div>';
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      ov.querySelector(".mk-lienzo").appendChild(cv);
      const bot = ov.querySelector(".mk-bot");
      let herr = "lapiz", color = COLORES[0], trazos = [], actual = null;
      [["lapiz","Lápiz"],["circulo","Círculo"],["flecha","Flecha"]].forEach(([id,t]) => { const b = document.createElement("button"); b.type="button"; b.dataset.h=id; b.setAttribute("aria-label",t); b.innerHTML = ico(id)+t; bot.appendChild(b); });
      { const b = document.createElement("button"); b.type="button"; b.dataset.h="recorte"; b.setAttribute("aria-label","Recortar"); b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/></svg>Recortar'; bot.appendChild(b); }
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
      const bbox = t => { const xs = t.pts.map(q=>q.x), ys = t.pts.map(q=>q.y); return { x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys) }; };
      const pxv = () => W / (cv.getBoundingClientRect().width || W);
      function dSeg(p,a,b){ const dx=b.x-a.x, dy=b.y-a.y, L=dx*dx+dy*dy; let u = L ? ((p.x-a.x)*dx+(p.y-a.y)*dy)/L : 0; u = Math.max(0,Math.min(1,u)); return Math.hypot(p.x-a.x-u*dx, p.y-a.y-u*dy); }
      function toca(t,p,tol){ if (t.h==="circulo"){ const b = bbox(t), a = Math.max(1,(b.x1-b.x0)/2), c = Math.max(1,(b.y1-b.y0)/2), r = Math.hypot((p.x-(b.x0+b.x1)/2)/(a+tol), (p.y-(b.y0+b.y1)/2)/(c+tol)); return r<=1; }
        if (t.h==="flecha") return dSeg(p,t.pts[0],t.pts[1]) < tol;
        for (let i=0;i<t.pts.length;i++){ if (Math.hypot(p.x-t.pts[i].x,p.y-t.pts[i].y)<tol) return true; if (i && dSeg(p,t.pts[i-1],t.pts[i])<tol) return true; } return false; }
      function asas(t){ if (t.h==="flecha") return [{k:"a",x:t.pts[0].x,y:t.pts[0].y},{k:"b",x:t.pts[1].x,y:t.pts[1].y}]; const b = bbox(t); return [{k:"nw",x:b.x0,y:b.y0},{k:"ne",x:b.x1,y:b.y0},{k:"sw",x:b.x0,y:b.y1},{k:"se",x:b.x1,y:b.y1}]; }
      function pintarSel(){ if (!sel) return; const u = pxv(), hs = 11*u; ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2*u; ctx.setLineDash([6*u,4*u]);
        if (sel.h!=="flecha"){ const b = bbox(sel); ctx.strokeRect(b.x0,b.y0,b.x1-b.x0,b.y1-b.y0); } ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1b1f24";
        asas(sel).forEach(h => { ctx.beginPath(); ctx.arc(h.x,h.y,hs,0,Math.PI*2); ctx.fill(); ctx.stroke(); }); ctx.restore(); }
      function copia(t){ return t.pts.map(q=>({x:q.x,y:q.y})); }
      function selUI(){ ov.querySelector('[data-a="del"]').style.display = sel ? "" : "none"; }
      function mostrarLupa(p){ if (!lupa) return; const D = 120, z = 3, r = D/z*pxv()/ (1) ; lupa.el.style.display = "block"; const lc = lupa.cv.getContext("2d"); lc.fillStyle = "#000"; lc.fillRect(0,0,D,D);
        const sw = D/z*pxv()*1, sx = p.x-sw/2, sy = p.y-sw/2; lc.drawImage(cv, sx, sy, sw, sw, 0, 0, D, D); lc.strokeStyle = "#fff"; lc.lineWidth = 1; lc.beginPath(); lc.moveTo(D/2-8,D/2); lc.lineTo(D/2+8,D/2); lc.moveTo(D/2,D/2-8); lc.lineTo(D/2,D/2+8); lc.stroke();
        const rc = cv.getBoundingClientRect(), fx = rc.left + p.x/W*rc.width, fy = rc.top + p.y/H*rc.height; lupa.el.style.left = (fx < innerWidth/2 && fy < innerHeight*0.45 ? innerWidth-D-18 : 10)+"px"; }
      function ocultarLupa(){ if (lupa) lupa.el.style.display = "none"; }
      function pintar(){ ctx.drawImage(base,0,0,W,H); trazos.forEach(dibujar); if (actual) dibujar(actual);
        pintarSel(); if (rec){ ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0,0,W,rec.y); ctx.fillRect(0,rec.y+rec.h,W,H-rec.y-rec.h); ctx.fillRect(0,rec.y,rec.x,rec.h); ctx.fillRect(rec.x+rec.w,rec.y,W-rec.x-rec.w,rec.h);
          const g = Math.max(3, W/300); ctx.strokeStyle = "#fff"; ctx.lineWidth = g; ctx.strokeRect(rec.x,rec.y,rec.w,rec.h);
          ctx.lineWidth = g/2; ctx.beginPath(); for (let i=1;i<3;i++){ ctx.moveTo(rec.x+rec.w*i/3,rec.y); ctx.lineTo(rec.x+rec.w*i/3,rec.y+rec.h); ctx.moveTo(rec.x,rec.y+rec.h*i/3); ctx.lineTo(rec.x+rec.w,rec.y+rec.h*i/3); } ctx.stroke();
          ctx.fillStyle = "#fff"; const hs = Math.max(10, W/45); [[rec.x,rec.y],[rec.x+rec.w,rec.y],[rec.x,rec.y+rec.h],[rec.x+rec.w,rec.y+rec.h]].forEach(([x,y]) => ctx.fillRect(x-hs/2,y-hs/2,hs,hs)); } }
      function marca(){ bot.querySelectorAll("[data-h]").forEach(b => b.classList.toggle("on", b.dataset.h===herr)); bot.querySelectorAll("[data-c]").forEach(b => b.classList.toggle("on", b.dataset.c===color)); }
      function modoRecorte(on){ rec = on ? { x:W*0.05, y:H*0.05, w:W*0.9, h:H*0.9 } : null; ov.querySelector('[data-a="ap"]').style.display = on ? "" : "none"; ov.querySelector('[data-a="ok"]').style.display = on ? "none" : ""; pintar(); }
      function aplicarRecorte(){ const r = rec; if (!r || r.w<20 || r.h<20){ modoRecorte(false); return; }
        pintar(); rec = null; pintar();
        const nb = document.createElement("canvas"); nb.width = Math.round(r.w); nb.height = Math.round(r.h); nb.getContext("2d").drawImage(cv, Math.round(r.x), Math.round(r.y), nb.width, nb.height, 0, 0, nb.width, nb.height);
        hist.push({ crop:true, base, W, H, trazos }); base = nb; W = nb.width; H = nb.height; trazos = []; cv.width = W; cv.height = H; modoRecorte(false); ajustar(); }
      function aplicarZoom(){ cv.style.transform = "translate("+tx+"px,"+ty+"px) scale("+zoom+")"; }
      const lzc = () => { const r = ov.querySelector(".mk-lienzo").getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; };
      function ptsPinch(){ const a = Array.from(ptrs.values()); return { m:{ x:(a[0].x+a[1].x)/2, y:(a[0].y+a[1].y)/2 }, d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1 }; }
      const pos = e => { const r = cv.getBoundingClientRect(); return { x:(e.clientX-r.left)*W/r.width, y:(e.clientY-r.top)*H/r.height }; };
      cv.addEventListener("pointerdown", e => { e.preventDefault(); try{cv.setPointerCapture(e.pointerId);}catch(_){}
        ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
        if (ptrs.size >= 2){ actual = null; drag = null; if (mov){ const h = hist.pop(); if (h && h.mov){ h.t.pts.forEach((q,i)=>{ q.x=h.ant[i].x; q.y=h.ant[i].y; }); } mov = null; } ocultarLupa(); ignorar = true; const q = ptsPinch(), C = lzc(); pinch = { z:zoom, tx, ty, d:q.d, m:q.m, ux:(q.m.x-C.x-tx)/zoom, uy:(q.m.y-C.y-ty)/zoom }; pintar(); return; }
        if (ignorar) return;
        if (!herr && !rec){ const p = pos(e), tol = 22*pxv();
          if (sel){ const h = asas(sel).find(h => Math.hypot(p.x-h.x,p.y-h.y) < 26*pxv()); if (h){ mov = { m:"asa", k:h.k, ant:copia(sel), b:bbox(sel) }; hist.push({ mov:true, t:sel, ant:copia(sel) }); mostrarLupa(p); return; } }
          let hit = null; for (let i=trazos.length-1;i>=0;i--) if (toca(trazos[i],p,tol)){ hit = trazos[i]; break; }
          if (hit){ sel = hit; selUI(); mov = { m:"mover", p0:p, ant:copia(hit) }; hist.push({ mov:true, t:hit, ant:copia(hit) }); pintar(); return; }
          if (sel){ sel = null; selUI(); pintar(); }
          pinch = { pan:true, x:e.clientX, y:e.clientY, tx, ty }; return; }
        if (!herr) return;
        if (rec){ const p = pos(e), t = Math.max(30, W/18), cx = [rec.x, rec.x+rec.w], cy = [rec.y, rec.y+rec.h]; let mx = null, my = null;
          cx.forEach((x,i) => { if (Math.abs(p.x-x)<t) mx = i; }); cy.forEach((y,i) => { if (Math.abs(p.y-y)<t) my = i; });
          if (mx!==null || my!==null) drag = { m:"borde", mx, my }; else if (p.x>rec.x && p.x<rec.x+rec.w && p.y>rec.y && p.y<rec.y+rec.h) drag = { m:"mover", dx:p.x-rec.x, dy:p.y-rec.y }; else drag = null; return; }
        actual = { h:herr, color, g:grosor(), pts:[pos(e)] }; pintar(); mostrarLupa(actual.pts[0]); });
      cv.addEventListener("pointermove", e => { if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
        if (mov && !pinch){ e.preventDefault(); const p = pos(e), t = sel;
          if (mov.m==="mover"){ const dx = p.x-mov.p0.x, dy = p.y-mov.p0.y; t.pts.forEach((q,i)=>{ q.x = mov.ant[i].x+dx; q.y = mov.ant[i].y+dy; }); }
          else if (t.h==="flecha"){ const i = mov.k==="a"?0:1; t.pts[i].x = p.x; t.pts[i].y = p.y; }
          else { const b = mov.b, k = mov.k, ox = k.includes("w") ? b.x1 : b.x0, oy = k.includes("n") ? b.y1 : b.y0, w0 = (b.x1-b.x0)||1, h0 = (b.y1-b.y0)||1;
            const cx0 = k.includes("w") ? b.x0 : b.x1, cy0 = k.includes("n") ? b.y0 : b.y1, f = (v,o,c0,d) => { let r = (v-o)/((c0-o)||d); if (Math.abs(r)<0.05) r = r<0 ? -0.05 : 0.05; return r; };
            const sx = f(p.x,ox,cx0,1), sy = f(p.y,oy,cy0,1);
            t.pts.forEach((q,i)=>{ q.x = ox + (mov.ant[i].x-ox)*sx; q.y = oy + (mov.ant[i].y-oy)*sy; }); }
          pintar(); mostrarLupa(p); return; }
        if (pinch){ e.preventDefault();
          if (pinch.pan){ if (ptrs.size===1){ tx = pinch.tx + e.clientX - pinch.x; ty = pinch.ty + e.clientY - pinch.y; aplicarZoom(); } return; }
          if (ptrs.size>=2){ const q = ptsPinch(), C = lzc(); zoom = Math.max(1, Math.min(8, pinch.z*q.d/pinch.d)); tx = q.m.x-C.x-zoom*pinch.ux; ty = q.m.y-C.y-zoom*pinch.uy; if (zoom===1){ tx = 0; ty = 0; } aplicarZoom(); } return; }
        if (ignorar) return;
        if (rec){ if (!drag) return; e.preventDefault(); const p = pos(e), c = (v,a,b) => Math.max(a,Math.min(b,v)), mn = 40;
          if (drag.m==="mover"){ rec.x = c(p.x-drag.dx,0,W-rec.w); rec.y = c(p.y-drag.dy,0,H-rec.h); }
          else { if (drag.mx===0){ const r = rec.x+rec.w; rec.x = c(p.x,0,r-mn); rec.w = r-rec.x; } else if (drag.mx===1){ rec.w = c(p.x,rec.x+mn,W)-rec.x; }
                 if (drag.my===0){ const b = rec.y+rec.h; rec.y = c(p.y,0,b-mn); rec.h = b-rec.y; } else if (drag.my===1){ rec.h = c(p.y,rec.y+mn,H)-rec.y; } }
          pintar(); mostrarLupa(pos(e)); return; }
        if (!actual) return; e.preventDefault(); const p = pos(e); if (actual.h==="lapiz") actual.pts.push(p); else actual.pts[1]=p; pintar(); mostrarLupa(p); });
      const fin = e => { ptrs.delete(e.pointerId); if (ptrs.size<2 && pinch && !pinch.pan) pinch = null; if (pinch && pinch.pan) pinch = null; if (ptrs.size===0) ignorar = false; ocultarLupa(); if (mov){ mov = null; pintar(); return; } if (rec){ drag = null; return; } if (!actual) return; trazos.push(actual); hist.push({});  actual = null; pintar(); };
      cv.addEventListener("pointerup", fin); cv.addEventListener("pointercancel", fin);
      let cerrar = function(){ ov.remove(); URL.revokeObjectURL(url); };
      ov.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.h==='recorte'){ modoRecorte(!rec); bot.querySelector('[data-h=recorte]').classList.toggle('on', !!rec); }
        else if (b.dataset.h){ if (sel){ sel = null; selUI(); pintar(); } if (rec) modoRecorte(false); bot.querySelector('[data-h=recorte]').classList.remove('on'); herr = (herr === b.dataset.h) ? null : b.dataset.h; marca(); }
        else if (b.dataset.c){ color = b.dataset.c; if (!herr) herr = "lapiz"; marca(); }
        else if (b.dataset.a==="del"){ if (sel){ const i = trazos.indexOf(sel); if (i>=0){ trazos.splice(i,1); hist.push({ del:true, t:sel, i }); } sel = null; selUI(); pintar(); } }
        else if (b.dataset.a==="z"){ zoom = 1; tx = 0; ty = 0; aplicarZoom(); }
        else if (b.dataset.a==="ap"){ aplicarRecorte(); bot.querySelector('[data-h=recorte]').classList.remove('on'); }
        else if (b.dataset.a==="u"){ if (rec){ modoRecorte(false); bot.querySelector('[data-h=recorte]').classList.remove('on'); return; } const h = hist.pop(); if (!h) return; sel = null; selUI(); if (h.mov){ h.t.pts.forEach((q,i)=>{ q.x=h.ant[i].x; q.y=h.ant[i].y; }); } else if (h.del){ trazos.splice(h.i,0,h.t); } else if (h.crop){ base = h.base; W = h.W; H = h.H; trazos = h.trazos; cv.width = W; cv.height = H; ajustar(); } else trazos.pop(); pintar(); }
        else if (b.dataset.a==="x"){ cerrar(); }
        else if (b.dataset.a==="ok"){
          if (!trazos.length && !hist.length){ cerrar(); return; } sel = null; rec = null; pintar();
          cv.toBlob(bl => {
            if (!bl){ opc.aviso && opc.aviso("No se pudo guardar la marca."); return; }
            const nombre = (file.name||"foto").replace(/\.[^.]+$/,"") + "-editada.jpg";
            const f = new File([bl], nombre, { type:"image/jpeg", lastModified: Date.now() });
            cerrar(); opc.listo && opc.listo(f);
          }, "image/jpeg", 0.92);
        }
      });
      ov.addEventListener("wheel", e => { e.preventDefault(); const C = lzc(), z2 = Math.max(1, Math.min(8, zoom*(e.deltaY<0?1.15:1/1.15))), ux = (e.clientX-C.x-tx)/zoom, uy = (e.clientY-C.y-ty)/zoom; zoom = z2; tx = e.clientX-C.x-zoom*ux; ty = e.clientY-C.y-zoom*uy; if (zoom===1){ tx = 0; ty = 0; } aplicarZoom(); }, { passive:false });
      { const el = document.createElement("div"); el.style.cssText = "position:fixed;top:78px;left:10px;width:120px;height:120px;border-radius:50%;border:3px solid #fff;overflow:hidden;z-index:10000;display:none;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.6);background:#000"; const c2 = document.createElement("canvas"); c2.width = 120; c2.height = 120; c2.style.cssText = "width:100%;height:100%"; el.appendChild(c2); ov.appendChild(el); lupa = { el, cv:c2 }; }
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
