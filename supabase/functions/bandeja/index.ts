import { createClient } from "jsr:@supabase/supabase-js@2";

// MÉTODO EXG: revisar la bandeja es UNA llamada que devuelve TODO lo que hay pendiente.
// V2 (15/10/2026): reportes, entradas, cola de PDF, Gmail sin tratar, avisos sin verificar, pagos pendientes y movimientos del banco sin identificar.
// V4: un correo que espera una decisión de Daniel (correo_tratado.estado = pendiente) se sigue enseñando hasta que decida.
// V5: ya_contestado = hay un mensaje NUESTRO posterior a ese correo.
// V6 (15/10/2026): cada correo trae su HILO ENTERO en orden.
// V7 (18/10/2026): la bandeja trae también las TAREAS que vencen o toca revisar en los próximos 3 días (y las ya pasadas).
// V8 (18/10/2026): los pagos pendientes con fecha en los próximos 3 días también salen como tareas.
// V9 (19/10/2026, Daniel: «¿cómo das por hecho que no hay correos?»): antes de nada llama a correo-vigilar (correo al día en ese momento);
// mira todo el correo recibido, no solo la bandeja de entrada; trae primero las RESPUESTAS a correos que enviamos, los hilos que siguen
// esperando respuesta y la publicidad agrupada por remitente para preguntar a Daniel si se bloquea. Lo que va por regla (Envíos) no sale.
// V10 (20/10/2026, Daniel: «que esté todo interconectado»): trae las AVERÍAS y mantenimientos abiertos de la flota (con los días que llevan
// y si la máquina está parada) y los PAGOS CON TARJETA que siguen sin factura (antes solo salían los que no tenían comercio).
// Solo lee. Acceso: cabecera x-exg-clave igual a exg_claves (nombre bandeja).
const CLIENT_ID = "86457265161-d04tdo3paksi8v8qj05lnv3snf23me77.apps.googleusercontent.com";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const J = { "Content-Type": "application/json" };
const resp = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: J });

Deno.serve(async (req: Request) => {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const clave = req.headers.get("x-exg-clave") ?? "";
    const { data: k } = await db.from("exg_claves").select("valor").eq("nombre", "bandeja").maybeSingle();
    if (!clave || !k?.valor || clave !== k.valor) return resp({ error: "no autorizado" }, 401);
    const body = await req.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body.dias) || 3, 1), 30);
    const hasta = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    let vigilancia: any = null;
    try { vigilancia = await (await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/correo-vigilar", { method: "POST", headers: { "Content-Type": "application/json", "x-exg-clave": clave }, body: JSON.stringify({ dias }) })).json(); } catch (e) { vigilancia = { error: String(e) }; }

    const [rep, ent, cola, av, pp, mb, esp, rec, inc, ff] = await Promise.all([
      db.from("sistema").select("id, created_at, data").eq("tipo", "mejora").or("data->>estado.eq.pendiente,data->>estado.is.null").order("created_at"),
      db.from("documentos").select("id, created_at, nota, file_name, storage_path").eq("status", "pendiente").order("created_at"),
      db.from("gastos_correo").select("id, created_at, remitente, nombre_archivo").eq("estado", "pendiente").order("created_at"),
      db.from("sistema_notificaciones").select("id, created_at, mensaje_original, decision_sistema, accion_realizada").or("verificado.is.null,verificado.eq.false").order("created_at", { ascending: false }).limit(30),
      db.from("sistema").select("id, created_at, data").eq("tipo", "pago_pendiente").eq("data->>estado", "pendiente"),
      db.from("movimientos_banco").select("id, fecha, importe, concepto, comercio, estado, nota").is("comercio", null).lt("importe", 0).in("estado", ["falta_factura", "a_decidir"]).gte("fecha", new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)).order("fecha", { ascending: false }),
      db.from("correo_tratado").select("message_id, thread_id, remitente, asunto, nota, created_at").eq("estado", "pendiente").order("created_at"),
      db.from("sistema").select("id, data").eq("tipo", "recordatorio").or("data->>estado.eq.pendiente,data->>estado.is.null").lte("data->>vence", hasta).order("data->>vence"),
      db.from("flota_incidencias").select("id, fecha, tipo, prioridad, descripcion, pieza, pedido, sigue_trabajando, coste, estado, flota(nombre)").neq("estado", "resuelta").in("tipo", ["averia", "mantenimiento"]).order("fecha"),
      db.from("movimientos_banco").select("id, fecha, importe, comercio, nota").not("comercio", "is", null).lt("importe", 0).eq("estado", "falta_factura").order("fecha"),
    ]);

    let gmail: any = { error: null, nuevos: [] };
    const esperando: any[] = esp.data ?? [];
    const { data: t } = await db.from("gmail_tokens").select("refresh_token").eq("id", 1).maybeSingle();
    if (!t?.refresh_token || !CLIENT_SECRET) gmail.error = "sin conexión de Gmail";
    else {
      const tk = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: t.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token" }) });
      const tkj = await tk.json();
      if (!tkj.access_token) gmail.error = "Google no dio acceso";
      else {
        const auth = { Authorization: "Bearer " + tkj.access_token };
        const hilo = async (threadId: string, msgId: string) => {
          try {
            const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From`, { headers: auth }); const th = await r.json();
            const msgs: any[] = (th.messages ?? []).sort((a: any, b: any) => Number(a.internalDate) - Number(b.internalDate));
            const ts = Number(msgs.find((m) => m.id === msgId)?.internalDate || 0);
            const nuestro = msgs.filter((m) => (m.labelIds ?? []).includes("SENT") && Number(m.internalDate) > ts).pop();
            const conversacion = msgs.map((m) => ({ id: m.id, fecha: new Date(Number(m.internalDate)).toISOString(), quien: (m.labelIds ?? []).includes("SENT") ? "nosotros" : ((m.payload?.headers ?? []).find((h: any) => h.name.toLowerCase() === "from")?.value ?? ""), texto: m.snippet, es_este: m.id === msgId }));
            return { ya_contestado: !!nuestro, contestado_el: nuestro ? new Date(Number(nuestro.internalDate)).toISOString() : null, mensajes_en_el_hilo: msgs.length, conversacion };
          } catch (_) { return { ya_contestado: null, conversacion: null }; }
        };
        const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent("newer_than:" + dias + "d -in:sent -in:chats -in:spam -in:trash")}`, { headers: auth });
        const lj = await lr.json();
        const ids: string[] = (lj.messages ?? []).map((m: any) => m.id);
        const { data: tr } = ids.length ? await db.from("correo_tratado").select("message_id").in("message_id", ids) : { data: [] as any[] };
        const { data: ce } = ids.length ? await db.from("correo_entrante").select("message_id, estado, posible_basura").in("message_id", ids) : { data: [] as any[] };
        const hechos = new Set([...(tr ?? []).map((x: any) => x.message_id), ...(ce ?? []).filter((x: any) => x.estado !== "nuevo" || x.posible_basura).map((x: any) => x.message_id)]);
        for (const id of ids.filter((i) => !hechos.has(i))) {
          const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth });
          const m = await mr.json();
          const cab = (n: string) => (m.payload?.headers ?? []).find((h: any) => h.name.toLowerCase() === n)?.value ?? "";
          gmail.nuevos.push({ message_id: id, thread_id: m.threadId, de: cab("from"), asunto: cab("subject"), fecha: new Date(Number(m.internalDate)).toISOString(), extracto: m.snippet, adjuntos: (m.payload?.parts ?? []).some((p: any) => p.filename), ...(await hilo(m.threadId, id)) });
        }
        for (const e of esperando) if (e.thread_id) Object.assign(e, await hilo(e.thread_id, e.message_id));
      }
    }
    const [resp1, esp2, bas] = await Promise.all([
      db.from("correo_entrante").select("message_id, thread_id, de, asunto, extracto, fecha").eq("es_respuesta", true).in("estado", ["nuevo", "pendiente"]).order("fecha"),
      db.from("correo_espera").select("thread_id, para, asunto, enviado_at, plazo, nota").eq("estado", "esperando").order("plazo"),
      db.from("correo_entrante").select("remitente_email, de, asunto").eq("posible_basura", true).eq("estado", "nuevo").gte("fecha", new Date(Date.now() - 14 * 864e5).toISOString()),
    ]);
    const basura: Record<string, any> = {};
    for (const x of (bas.data ?? [])) { const k2 = x.remitente_email || x.de; basura[k2] = basura[k2] || { remitente: k2, nombre: x.de, correos: 0, ejemplo: x.asunto }; basura[k2].correos++; }
    const tareas = (rec.data ?? []).map((r: any) => ({ id: r.id, titulo: r.data?.titulo_corto || r.data?.titulo, vence: r.data?.vence, vence_tipo: r.data?.vence_tipo || "limite", estado_rec: r.data?.estado_rec, con: r.data?.con, descripcion: r.data?.descripcion }))
      .concat((pp.data ?? []).filter((r: any) => r.data?.vence && r.data.vence <= hasta).map((r: any) => ({ id: r.id, titulo: "Pago: " + (r.data?.acreedor || "") + (r.data?.concepto ? " · " + r.data.concepto : ""), vence: r.data.vence, vence_tipo: "limite", estado_rec: "por_pagar", con: r.data?.acreedor, descripcion: r.data?.nota })))
      .sort((a: any, b: any) => String(a.vence).localeCompare(String(b.vence)));
    const hoy = Date.now();
    const averias = (inc.data ?? []).map((x: any) => ({ id: x.id, maquina: x.flota?.nombre, tipo: x.tipo, desde: x.fecha, dias_abierta: Math.floor((hoy - new Date(x.fecha).getTime()) / 864e5), parada: x.sigue_trabajando === false, sigue_trabajando: x.sigue_trabajando, prioridad: x.prioridad, descripcion: x.descripcion, pieza: x.pieza, pedido: x.pedido, coste: x.coste }));
    const facturas_por_pedir = (ff.data ?? []).map((x: any) => ({ ...x, dias: Math.floor((hoy - new Date(x.fecha).getTime()) / 864e5) }));
    const n = { respuestas_a_nuestros_correos: (resp1.data ?? []).length, publicidad_por_decidir: Object.keys(basura).length, tareas: tareas.length, reportes: (rep.data ?? []).length, entradas: (ent.data ?? []).length, cola_pdf: (cola.data ?? []).length, correos: gmail.nuevos.length, correos_esperando_a_daniel: esperando.length, avisos: (av.data ?? []).length, pagos_pendientes: (pp.data ?? []).length, banco_sin_identificar: (mb.data ?? []).length, averias_abiertas: averias.length, maquinas_paradas: averias.filter((a) => a.parada).length, pagos_sin_factura: facturas_por_pedir.length };
    const nuevo = n.respuestas_a_nuestros_correos + n.publicidad_por_decidir + n.tareas + n.reportes + n.entradas + n.cola_pdf + n.correos + n.correos_esperando_a_daniel + n.avisos + n.banco_sin_identificar;
    const resumen = (nuevo === 0 ? `Bandeja sin nada nuevo (pagos pendientes abiertos: ${n.pagos_pendientes})` : `Bandeja: ${n.respuestas_a_nuestros_correos} respuestas a correos nuestros · ${n.tareas} tareas que vencen o toca revisar en 3 días · ${n.reportes} reportes · ${n.entradas} entradas · ${n.cola_pdf} PDF del correo · ${n.correos} correos sin tratar · ${n.correos_esperando_a_daniel} correos esperando decisión de Daniel · ${n.avisos} avisos sin verificar · ${n.banco_sin_identificar} movimientos del banco sin identificar · ${n.pagos_pendientes} pagos pendientes abiertos · ${(esp2.data ?? []).length} correos nuestros esperando respuesta · ${n.publicidad_por_decidir} remitentes de publicidad para preguntar si se bloquean`)
      + ` · ${n.averias_abiertas} averías o mantenimientos abiertos (${n.maquinas_paradas} con la máquina parada) · ${n.pagos_sin_factura} pagos con tarjeta sin factura`;
    return resp({ ok: true, resumen, recuento: n, correo_al_dia: vigilancia, respuestas_a_nuestros_correos: resp1.data ?? [], esperando_respuesta: esp2.data ?? [], publicidad_por_decidir: Object.values(basura), tareas, averias_abiertas: averias, reportes: rep.data ?? [], entradas: ent.data ?? [], cola_pdf_correo: cola.data ?? [], gmail_sin_tratar: gmail.nuevos, correos_esperando_a_daniel: esperando, gmail_error: gmail.error,
      avisos_sin_verificar: av.data ?? [], pagos_pendientes: pp.data ?? [], banco_sin_identificar: mb.data ?? [], pagos_sin_factura: facturas_por_pedir,
      recordatorio: "CORREO: esta llamada ya trae el correo al día (correo_al_dia); NUNCA se dice que no hay correos sin haberla llamado en ese mismo mensaje. Las respuestas a nuestros correos van lo primero. La publicidad se pregunta a Daniel, un remitente cada vez, si se bloquea para siempre (correo_reglas, accion papelera). TAREAS: cada tarea que vence o toca revisar se aborda en el momento (hacer lo que se pueda, preparar el borrador o preguntar UNA cosa) y se le pone su nueva fecha o se cierra; nunca se deja en espera sin fecha. Un pago vive solo en Deudas pendientes (con fecha), nunca repetido como recordatorio. Las sedes (AEAT, Hacienda Local, DGT, Ayuntamiento) las hacemos nosotros con el certificado digital de Rafael, no el gestor. Cada correo trae su conversación entera: leerla TODA (y, si hace falta, el texto completo con get_thread) antes de proponer nada. Si ya_contestado, no se repite la respuesta. tratado/ignorado SOLO si no necesita nada de Daniel; si pide respuesta o decisión, estado pendiente y se le pregunta UNA cosa cada vez con la propuesta escrita. Un movimiento del banco sin identificar se comprueba ENTERO antes de preguntar. AVERÍAS: cada avería o mantenimiento abierto se sigue (pieza pedida, llegada, montaje, coste, si la máquina está parada) preguntando UNA cosa cada vez hasta cerrarla con su fecha de resolución y su coste. PAGOS SIN FACTURA: la factura de cada uno se pide o se busca en el correo; ninguno se queda sin seguimiento." });
  } catch (e) { return resp({ error: String(e) }, 500); }
});
