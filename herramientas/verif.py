# Prueba la web REAL con los datos REALES (solo lectura): sesión simulada de administrador, toda lectura de la base pasa por exg-prueba-lectura y nada se escribe.
# Uso: EXG_CLAVE=... python3 herramientas/verif.py [espera_ms] "js|nombre" ...  (capturas en /tmp/x_nombre.png). Necesita playwright + chromium.
import asyncio,threading,http.server,functools,sys,json,base64,time,urllib.request,os
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
threading.Thread(target=http.server.ThreadingHTTPServer(("",8767),functools.partial(Q,directory=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))).serve_forever,daemon=True).start()
from playwright.async_api import async_playwright
import os
U="https://sshctqnpuolawtcujxkt.supabase.co";CL=os.environ["EXG_CLAVE"]   # exg_claves.correo-adjuntos
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
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
        bloqueadas=[]
        async def ruta(route,req):
            u=req.url
            if '/auth/v1/' in u:
                if 'user' in u: return await route.fulfill(status=200,content_type='application/json',body=json.dumps(user))
                return await route.fulfill(status=200,content_type='application/json',body=json.dumps(ses))
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
        await pg.route(U+"/**",ruta)
        await pg.goto('http://localhost:8767/index.html');await pg.wait_for_timeout(int(sys.argv[1]) if sys.argv[1:] and sys.argv[1].isdigit() else 15000)
        args=[a for a in sys.argv[1:] if not a.isdigit()]
        for a in args:
            js,name=a.rsplit('|',1)
            try:
                r=await pg.evaluate(js)
                if r is not None: print('R',name,str(r)[:1500])
            except Exception as e: print('EVAL',name,str(e)[:200])
            await pg.wait_for_timeout(3000);await pg.screenshot(path='/tmp/x_'+name+'.png')
        print('ERRORES',errs[:6]);print('ESCRITURAS BLOQUEADAS',len(bloqueadas),bloqueadas[:5])
        await b.close()
asyncio.run(main())
