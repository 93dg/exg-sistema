import { createClient } from "npm:@supabase/supabase-js@2";

// MÉTODO EXG: revisar la bandeja es UNA llamada que devuelve TODO lo que hay pendiente.
// V2 (15/10/2026): reportes, entradas, cola de PDF, Gmail sin tratar, avisos sin verificar, pagos pendientes y movimientos del banco sin identificar.
// V4: un correo que espera una decisión de Daniel (correo_tratado.estado = pendiente) se sigue enseñando hasta que decida.
// V5: ya_contestado = hay un mensaje NUESTRO posterior a ese correo.
// V6 (15/10/2026): cada correo trae su HILO ENTERO en orden.
// V7 (18/10/2026): la bandeja trae también las TAREAS que vencen o toca revisar en los próximos 3 días (y las ya pasadas).
// V8 (18/10/2026): los pagos pendientes con fecha en los próximos 3 días también salen como tareas.
// V9 (19/10/2026): antes de nada llama a correo-vigilar; mira todo el correo recibido; respuestas, esperas y publicidad agrupada.
// V10 (20/10/2026): AVERÍAS y mantenimientos abiertos de la flota y PAGOS CON TARJETA que siguen sin factura.
// V11 (29/10/2026, Daniel: «una retirada en efectivo que se hizo y ni me la has nombrado»): trae el EFECTIVO SIN EXPLICAR
// (retiradas de cajero en estado efectivo de los últimos 90 días) y lo cuenta en el resumen.
// V12 (04/11/2026, Daniel: «Bandeja es email, reportes y subir. ¿Cómo hago para que entiendas que son los 3 y no uno?»):
// cada llamada deja constancia (sistema tipo bandeja_revision, con caso_id y recuento). Un caso cuya orden diga «bandeja»
// no se puede cerrar sin esa constancia (trigger exg_bandeja_cierre en casos_exg). Por defecto mira el correo desde la
// última revisión (no solo 3 días), para que ningún correo se quede sin ver entre una bandeja y la siguiente.
// V13 (16/11/2026, Daniel: «si una tarea no está hecha, no está hecha»): salen TODAS las tareas sin hacer, no solo las que vencen en 3 días
// (primero las pasadas y las de los próximos 3 días, luego el resto), y todos los pagos pendientes. Trae también los movimientos del banco
// de los últimos 7 días que siguen sin factura (vengan de Fintable o del aviso) y cuándo importó la web de Fintable por última vez.
// V14 (19/11/2026, Daniel: «las tareas siguen desactualizadas… al 200 %»): trae tareas_por_revisar (pasadas de fecha o con novedad sin
// revisar: un correo, un pago o un documento que encaja con sus claves). La Bandeja NO está terminada mientras haya alguna: cada una se
// revisa con Daniel (select tarea_revisada(id, nota, nueva_fecha)) o se cierra.
// V15 (19/11/2026): tareas_por_revisar incluye también ITV de la flota, pagos pendientes vencidos y averías con la revisión pasada.
// Solo lee (salvo la constancia). Acceso: cabecera x-exg-clave igual a exg_claves (nombre bandeja).
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
    const { data: ult } = await db.from("sistema").select("created_at").eq("tipo", "bandeja_revision").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const desdeUlt = ult?.created_at ? Math.ceil((Date.now() - new Date(ult.created_at).getTime()) / 864e5) + 1 : 3;
    const dias = Math.min(Math.max(Number(body.dias) || Math.max(desdeUlt, 3), 1), 30);
    const hasta = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    let vigilancia: any = null;
    try { vigilancia = await (await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/correo-vigilar", { method: "POST", headers: { "Content-Type": "application/json", "x-exg-clave": clave }, body: JSON.stringify({ dias }) })).json(); } catch (e) { vigilancia = { error: String(e) }; }

    const [rep, ent, cola, av, pp, mb, esp, rec, inc, ff, ef, b7, sy, fl] = await Promise.all([
      db.from("sistema").select("id, created_at, data").eq("tipo", "mejora").or("data->>estado.eq.pendiente,data->>estado.is.null").order("created_at"),
      db.from("documentos").select("id, created_at, nota, file_name, storage_path").eq("status", "pendiente").order("created_at"),
      db.from("gastos_correo").select("id, created_at, remitente, nombre_archivo").eq("estado", "pendiente").order("created_at"),
      db.from("sistema_notificaciones").select("id, created_at, mensaje_original, decision_sistema, accion_realizada").or("verificado.is.null,verificado.eq.false").order("created_at", { ascending: false }).limit(30),
      db.from("sistema").select("id, created_at, data").eq("tipo", "pago_pendiente").eq("data->>estado", "pendiente"),
      db.from("movimientos_banco").select("id, fecha, importe, concepto, comercio, estado, nota").is("comercio", null).lt("importe", 0).in("estado", ["falta_factura", "a_decidir"]).gte("fecha", new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)).order("fecha", { ascending: false }),
      db.from("correo_tratado").select("message_id, thread_id, remitente, asunto, nota, created_at").eq("estado", "pendiente").order("created_at"),
      db.from("sistema").select("id, data").eq("tipo", "recordatorio").or("data->>estado.eq.pendiente,data->>estado.is.null").order("data->>vence"),
      db.from("flota_incidencias").select("id, fecha, tipo, prioridad, descripcion, pieza, pedido, sigue_trabajando, coste, estado, revisar, flota(nombre)").neq("estado", "resuelta").in("tipo", ["averia", "mantenimiento"]).order("fecha"),
      db.from("movimientos_banco").select("id, fecha, importe, comercio, nota").not("comercio", "is", null).lt("importe", 0).eq("estado", "falta_factura").order("fecha"),
      db.from("movimientos_banco").select("id, fecha, importe, concepto, nota").eq("estado", "efectivo").lt("importe", 0).gte("fecha", new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).order("fecha"),
      db.from("movimientos_banco").select("id, fecha, importe, concepto, comercio, estado, nota, origen").lt("importe", 0).in("estado", ["falta_factura", "a_decidir", "efectivo"]).gte("fecha", new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).order("fecha", { ascending: false }),
      db.from("sistema_eventos").select("created_at, contexto").eq("accion", "sync_banco").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("flota").select("id, nombre, matricula, itv_vence, estado").not("itv_vence", "is", null),
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
      .concat((pp.data ?? []).map((r: any) => ({ id: r.id, titulo: "Pago: " + (r.data?.acreedor || "") + (r.data?.concepto ? " · " + r.data.concepto : ""), vence: r.data.vence, vence_tipo: "limite", estado_rec: "por_pagar", con: r.data?.acreedor, descripcion: r.data?.nota })))
      .map((x: any) => ({ ...x, cuando: !x.vence ? "sin_fecha" : x.vence <= hasta ? "ya_o_en_3_dias" : "mas_adelante" }))
      .sort((a: any, b: any) => String(a.vence || "9999").localeCompare(String(b.vence || "9999")));
    const hoy = Date.now();
    const hoyF = new Date().toISOString().slice(0, 10);
    const tareas_por_revisar: any[] = (rec.data ?? []).map((r: any) => { const d = r.data ?? {}; const nov = (Array.isArray(d.novedades) ? d.novedades : []).filter((x: any) => !x.revisada); const venc = !!d.vence && d.vence < hoyF; return (venc || d.prueba_nueva === true || nov.length) ? { id: r.id, titulo: d.titulo_corto || d.titulo, vence: d.vence, vencida: venc, novedades: nov, pruebas_recientes: (Array.isArray(d.vinculos) ? d.vinculos : []).filter((v: any) => v.auto).slice(-3), ultima_revision: d.revisada_at ?? null } : null; }).filter(Boolean);
    // V15 (19/11, Daniel: «la ITV del Hyundai es la primera que me sale en Control y no la mencionas»): tareas_por_revisar = TODO lo que Control
    // enseña pasado de fecha, no solo los recordatorios: avisos de ITV de la flota (misma regla que la web: vence en 15 días o menos y no hay tarea
    // pendiente con esa matrícula) y averías con la fecha de revisar pasada. Al pasar una ITV hay que poner la nueva fecha en flota.itv_vence.
    const mat = (x: string) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const pendTxt = (rec.data ?? []).map((r: any) => mat((r.data?.titulo || "") + JSON.stringify(r.data?.claves || [])));
    for (const v of (fl.data ?? [])) {
      if (v.estado === "vendida" || v.estado === "particular") continue;
      const dias = Math.round((new Date(v.itv_vence + "T00:00:00").getTime() - new Date(hoyF + "T00:00:00").getTime()) / 864e5);
      const m = mat(v.matricula);
      if (dias <= 15 && !(m.length >= 5 && pendTxt.some((t: string) => t.includes(m)))) tareas_por_revisar.push({ id: "flota:" + v.id, titulo: "ITV " + v.nombre + " (" + v.matricula + ")", vence: v.itv_vence, vencida: dias < 0, novedades: [], aviso: "Sale en Control (ITV). Si ya se pasó, poner la nueva fecha en flota.itv_vence" });
    }
    for (const r of (pp.data ?? [])) if (r.data?.vence && r.data.vence < hoyF) tareas_por_revisar.push({ id: r.id, titulo: "Pago: " + (r.data?.acreedor || "") + " · " + (r.data?.concepto || ""), vence: r.data.vence, vencida: true, novedades: [] });
    for (const x of (inc.data ?? [])) if (x.revisar && x.revisar < hoyF) tareas_por_revisar.push({ id: "averia:" + x.id, titulo: "Avería " + (x.flota?.nombre || "") + ": " + String(x.descripcion || "").slice(0, 60), vence: x.revisar, vencida: true, novedades: [] });
    const averias = (inc.data ?? []).map((x: any) => ({ id: x.id, maquina: x.flota?.nombre, tipo: x.tipo, desde: x.fecha, dias_abierta: Math.floor((hoy - new Date(x.fecha).getTime()) / 864e5), parada: x.sigue_trabajando === false, sigue_trabajando: x.sigue_trabajando, prioridad: x.prioridad, descripcion: x.descripcion, pieza: x.pieza, pedido: x.pedido, coste: x.coste }));
    const facturas_por_pedir = (ff.data ?? []).map((x: any) => ({ ...x, dias: Math.floor((hoy - new Date(x.fecha).getTime()) / 864e5) }));
    const efectivo = (ef.data ?? []).map((x: any) => ({ ...x, dias: Math.floor((hoy - new Date(x.fecha).getTime()) / 864e5) }));
    const n = { tareas_por_revisar: tareas_por_revisar.length, respuestas_a_nuestros_correos: (resp1.data ?? []).length, publicidad_por_decidir: Object.keys(basura).length, tareas: tareas.length, tareas_ya_o_en_3_dias: tareas.filter((x: any) => x.cuando === "ya_o_en_3_dias").length, banco_7_dias_sin_factura: (b7.data ?? []).length, reportes: (rep.data ?? []).length, entradas: (ent.data ?? []).length, cola_pdf: (cola.data ?? []).length, correos: gmail.nuevos.length, correos_esperando_a_daniel: esperando.length, avisos: (av.data ?? []).length, pagos_pendientes: (pp.data ?? []).length, banco_sin_identificar: (mb.data ?? []).length, efectivo_sin_explicar: efectivo.length, averias_abiertas: averias.length, maquinas_paradas: averias.filter((a) => a.parada).length, pagos_sin_factura: facturas_por_pedir.length };
    const nuevo = n.respuestas_a_nuestros_correos + n.publicidad_por_decidir + n.tareas + n.reportes + n.entradas + n.cola_pdf + n.correos + n.correos_esperando_a_daniel + n.avisos + n.banco_sin_identificar + n.efectivo_sin_explicar;
    const tres = (tareas_por_revisar.length ? `TAREAS POR REVISAR ${tareas_por_revisar.length} (la Bandeja no está terminada hasta que sea 0) · ` : "TAREAS AL DÍA · ") + `LAS TRES PARTES: EMAIL ${n.correos + n.respuestas_a_nuestros_correos + n.correos_esperando_a_daniel} · REPORTES ${n.reportes} · SUBIR ${n.entradas}`;
    const resumen = tres + " — " + (nuevo === 0 ? `Bandeja sin nada nuevo (pagos pendientes abiertos: ${n.pagos_pendientes})` : `Bandeja: ${n.respuestas_a_nuestros_correos} respuestas a correos nuestros · ${n.tareas} tareas sin hacer (${n.tareas_ya_o_en_3_dias} pasadas o en 3 días) · ${n.banco_7_dias_sin_factura} pagos del banco de los últimos 7 días sin factura · ${n.reportes} reportes · ${n.entradas} entradas · ${n.cola_pdf} PDF del correo · ${n.correos} correos sin tratar · ${n.correos_esperando_a_daniel} correos esperando decisión de Daniel · ${n.avisos} avisos sin verificar · ${n.banco_sin_identificar} movimientos del banco sin identificar · ${n.efectivo_sin_explicar} retiradas de efectivo sin explicar · ${n.pagos_pendientes} pagos pendientes abiertos · ${(esp2.data ?? []).length} correos nuestros esperando respuesta · ${n.publicidad_por_decidir} remitentes de publicidad para preguntar si se bloquean`)
      + ` · ${n.averias_abiertas} averías o mantenimientos abiertos (${n.maquinas_paradas} con la máquina parada) · ${n.pagos_sin_factura} pagos con tarjeta sin factura`;
    try { await db.from("sistema").insert({ tipo: "bandeja_revision", data: { caso_id: body.caso_id ?? null, at: new Date().toISOString(), dias_correo: dias, recuento: n, resumen } }); } catch (_) {}
    return resp({ ok: true, resumen, recuento: n, tareas_por_revisar, correo_al_dia: vigilancia, respuestas_a_nuestros_correos: resp1.data ?? [], esperando_respuesta: esp2.data ?? [], publicidad_por_decidir: Object.values(basura), tareas, averias_abiertas: averias, reportes: rep.data ?? [], entradas: ent.data ?? [], cola_pdf_correo: cola.data ?? [], gmail_sin_tratar: gmail.nuevos, correos_esperando_a_daniel: esperando, gmail_error: gmail.error,
      avisos_sin_verificar: av.data ?? [], pagos_pendientes: pp.data ?? [], banco_sin_identificar: mb.data ?? [], efectivo_sin_explicar: efectivo, pagos_sin_factura: facturas_por_pedir, banco_7_dias: b7.data ?? [], fintable_ultima_importacion: sy.data ? { at: sy.data.created_at, recibidos: sy.data.contexto?.recibidos, nuevos: sy.data.contexto?.nuevos, saldo: sy.data.contexto?.saldo_banco } : null,
      recordatorio: "PRIMERO tareas_por_revisar: la Bandeja NO está terminada mientras haya alguna; cada una se revisa con Daniel, una a una, y se actualiza con tarea_revisada(id, nota, nueva_fecha) o se cierra; nunca se dejan pasadas de fecha ni con novedad sin mirar. Las de ITV (id flota:…) se resuelven poniendo la nueva fecha en flota.itv_vence. Ningún correo sale sin tarea (correo-enviar V5). BANDEJA = EMAIL + REPORTES + SUBIR, SIEMPRE LAS TRES. Nunca se dice «vacía» ni «nada» si una de las tres no está a 0 en esta misma llamada; se dicen siempre los tres números. CORREO: esta llamada ya trae el correo al día (correo_al_dia); NUNCA se dice que no hay correos sin haberla llamado en ese mismo mensaje. Cada correo tratado se apunta en correo_tratado en el momento. Las respuestas a nuestros correos van lo primero. La publicidad se pregunta a Daniel, un remitente cada vez, si se bloquea para siempre (correo_reglas, accion papelera). TAREAS: salen TODAS las que no están hechas (una tarea sin hacer no desaparece por su fecha); se enseñan siempre, comprobadas, y se avisa de las importantes aunque venzan más adelante; BANCO: se repasan los movimientos de banco_7_dias (Fintable y avisos); cada tarea que vence o toca revisar se aborda en el momento y se le pone su nueva fecha o se cierra. EFECTIVO: cada retirada de efectivo sin explicar se enseña SIEMPRE y se pregunta en qué se gastó hasta que quede explicada. Un pago vive solo en Deudas pendientes (con fecha). Las sedes (AEAT, Hacienda Local, DGT, Ayuntamiento) las hacemos nosotros con el certificado digital de Rafael. Cada correo trae su conversación entera: leerla TODA antes de proponer nada. Si ya_contestado, no se repite la respuesta. tratado/ignorado SOLO si no necesita nada de Daniel. Un movimiento del banco sin identificar se comprueba ENTERO antes de preguntar. AVERÍAS: cada una se sigue preguntando UNA cosa cada vez hasta cerrarla. PAGOS SIN FACTURA: la factura de cada uno se pide o se busca en el correo." });
  } catch (e) { return resp({ error: String(e) }, 500); }
});
