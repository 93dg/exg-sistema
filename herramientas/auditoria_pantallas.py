# AUDITORÍA DE PANTALLAS (control de diseño renderizado). Basado en verif.py: prueba la web REAL con los datos REALES (solo lectura): sesión simulada de administrador, toda lectura de la base pasa por exg-prueba-lectura y nada se escribe.
# Uso: EXG_CLAVE=... python3 herramientas/verif.py [espera_ms] "js|nombre" ...  (capturas en /tmp/x_nombre.png). Necesita playwright + chromium.
import asyncio,threading,http.server,functools,sys,json,base64,time,urllib.request,os
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("",8768),functools.partial(Q,directory=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))).serve_forever,daemon=True).start()
from playwright.async_api import async_playwright
import os
U="https://sshctqnpuolawtcujxkt.supabase.co";_cf=os.path.join(os.path.dirname(os.path.abspath(__file__)),".clave_lectura")
CL=os.environ.get("EXG_CLAVE") or (open(_cf).read().strip() if os.path.exists(_cf) else "")
if not CL:
    print("❌ Falta la clave de lectura para la auditoría de pantallas. Sácala con SQL: select valor from exg_claves where nombre='correo-adjuntos'; y guárdala en herramientas/.clave_lectura (no se sube al repo)"); sys.exit(1)   # exg_claves.correo-adjuntos
b64=lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
exp=int(time.time())+86400*30
user={"id":"00000000-0000-0000-0000-0000000000dg","email":"dg@exg.local","aud":"authenticated","role":"authenticated","user_metadata":{"rol":"admin"},"app_metadata":{}}
tok=b64({"alg":"HS256","typ":"JWT"})+"."+b64({"sub":user["id"],"email":user["email"],"exp":exp,"role":"authenticated","user_metadata":{"rol":"admin"}})+".x"
ses={"access_token":tok,"token_type":"bearer","expires_in":86400*30,"expires_at":exp,"refresh_token":"r","user":user}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
        await ctx.add_init_script("localStorage.setItem('sb-sshctqnpuolawtcujxkt-auth-token',"+json.dumps(json.dumps(ses))+");")
        errs=[]
        bloqueadas=[]
        async def ruta(route,req):
            u=req.url
            if '/auth/v1/' in u:
                if 'user' in u: return await route.fulfill(status=200,content_type='application/json',body=json.dumps(user))
                return await route.fulfill(status=200,content_type='application/json',body=json.dumps(ses))
            if req.method=='POST' and '/rest/v1/rpc/' in u and (req.post_data or '{}').strip() in ('{}',''):
                u2=u; h=req.headers;cuerpo=json.dumps({"ruta":u2[len(U):],"range":h.get('range'),"prefer":None,"accept":h.get('accept')}).encode()
                def llamar2():
                    try:
                        r=urllib.request.urlopen(urllib.request.Request(U+"/functions/v1/exg-prueba-lectura",data=cuerpo,headers={"x-exg-clave":CL,"Content-Type":"application/json"}),timeout=60)
                        return r.status,r.read(),r.headers.get('content-type')
                    except urllib.error.HTTPError as e: return e.code,e.read(),'application/json'
                st,bd,ct=await asyncio.get_event_loop().run_in_executor(None,llamar2)
                return await route.fulfill(status=st,headers={'content-type':ct or 'application/json'},body=bd)
            if req.method!='GET':
                bloqueadas.append(req.method+' '+u.split('/rest/v1/')[-1][:60] if '/rest/v1/' in u else req.method+' '+u[:80])
                return await route.fulfill(status=200,content_type='application/json',body='[]')
            if '/rest/v1/' in u:
                h=req.headers;cuerpo=json.dumps({"ruta":u[len(U):],"range":h.get('range'),"prefer":h.get('prefer'),"accept":h.get('accept')}).encode()
                def llamar():
                    try:
                        r=urllib.request.urlopen(urllib.request.Request(U+"/functions/v1/exg-prueba-lectura",data=cuerpo,headers={"x-exg-clave":CL,"Content-Type":"application/json"}),timeout=60)
                        return r.status,r.read(),r.headers.get('x-content-range'),r.headers.get('content-type')
                    except urllib.error.HTTPError as e: return e.code,e.read(),None,'application/json'
                st,bd,cr,ct=await asyncio.get_event_loop().run_in_executor(None,llamar)
                hd={'content-type':ct or 'application/json'}
                if cr: hd['content-range']=cr
                return await route.fulfill(status=st,headers=hd,body=bd)
            return await route.continue_()
        await ctx.route(U+"/**",ruta)
        AUD=open(os.environ.get('AUD_JS') or os.path.join(os.path.dirname(os.path.abspath(__file__)),'auditoria.js'),encoding='utf-8').read()
        res=[]
        async def tanda(vistas):   # V11.34: varias pestañas a la vez para revisar todas las pantallas sin pasar del tiempo del deploy
            pg=await ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
            await pg.goto('http://localhost:8768/index.html');await pg.wait_for_timeout(15000)
            for v in vistas:
                try:
                    vv,sub=(v.split(':')+[''])[:2]
                    await pg.evaluate("v=>{const b=document.querySelector('.nav button[data-view='+v+']')||document.querySelector('[data-view='+v+']'); if(b) b.click();}", vv)
                    if sub: await pg.wait_for_timeout(1500); await pg.evaluate(sub)
                    await pg.wait_for_timeout(22000 if ':' in v else 2500)
                    prev=-1; quieto=0; t0=time.time()
                    while time.time()-t0 < (40 if ':' in v else 20):   # espera a que la pantalla deje de cambiar (datos cargados)
                        n=await pg.evaluate("document.body.innerText.length")
                        quieto = quieto+1 if n==prev else 0
                        if quieto>=3: break
                        prev=n; await pg.wait_for_timeout(800)
                    r=await pg.evaluate(AUD)
                    for x in r: res.append({'vista':v,'regla':x[0],'txt':x[1]})
                except Exception as e: print('EVAL',v,str(e)[:200])
            await pg.close()
        N=int(os.environ.get('TANDAS','4'))
        await asyncio.gather(*[tanda(VISTAS[k::N]) for k in range(N)])
        await b.close()
        return res
VISTAS_TODAS=['control','trabajos','planificacion',"trabestad:teSub('costes')",'economia','documentos','albaranes','proformas','facturas','presupuestos','gastospro','impuestos','clientes','flota','direccion','empresa','personal','archivos','entradas','gastosrec','proyectos','tarifas','calcempleado','ayuntamiento','correo','reportes']   # V11.34: todas las pantallas (Empresa no se revisaba y por eso volvían las minúsculas)
VISTAS=[v for v in VISTAS_TODAS if not os.environ.get('SOLO') or v==os.environ.get('SOLO')]
DESC={'minuscula':'Texto que empieza en minúscula (todo texto empieza con mayúscula)','partido':'Texto corto partido en dos líneas','desborda':'Texto que se sale de la pantalla','circulo':'Botón de solo icono con círculo o borde alrededor','marcado':'Algo marcado con fondo oscuro (solo borde naranja)','lupa':'Lupa que no está en un extremo de su línea','correo_mayus':'Correo o enlace que sale con la primera letra en mayúscula (ponle class no-cap)'}
BASE=os.path.join(os.path.dirname(os.path.abspath(__file__)),'auditoria_baseline.json')
res=asyncio.run(main())
c={}
for x in res: k=x['vista']+'|'+x['regla']; c[k]=c.get(k,0)+1
if '--todo' in sys.argv:
    for x in res: print(x['regla'],x['vista'],'|',x['txt'])
if '--baseline' in sys.argv:
    if os.path.exists(BASE) and '--nueva' not in sys.argv:
        old=json.load(open(BASE)); c={k:max(c.get(k,0),old.get(k,0)) for k in set(c)|set(old)}   # se guarda el máximo visto: una pantalla que tarda en cargar no rebaja la línea base
    json.dump(c,open(BASE,'w'),indent=0); print('baseline de pantallas guardada:',sum(c.values())); sys.exit(0)
base=json.load(open(BASE)) if os.path.exists(BASE) else {}
malos=[k for k,v in c.items() if v>(0 if k.split('|')[1] in ('minuscula','correo_mayus','lupa','marcado','circulo') else base.get(k,0))]   # V11.34: ninguna minúscula al principio, ni nueva ni de antes
if malos:
    print('❌ PANTALLAS: aparece algo nuevo que incumple la guía de Daniel (python3 herramientas/auditoria_pantallas.py --todo):')
    for k in malos:
        vi,r=k.split('|'); print(' -',DESC[r],'| vista',vi,'| antes',base.get(k,0),'ahora',c[k])
        for x in res:
            if x['vista']==vi and x['regla']==r: print('     ·',x['txt'])
    sys.exit(1)
print('✓ Pantallas: nada nuevo que incumpla la guía (por repasar de antes:',len(res),')')
