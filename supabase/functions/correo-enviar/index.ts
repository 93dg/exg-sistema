import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// ENVÍA un correo desde el Gmail de la empresa con adjuntos sacados del Storage de EXG (sin copiar archivos a mano).
// Solo Claude, y solo tras la orden expresa de Daniel (ley de correos). Acceso: x-exg-clave = exg_claves.correo-borrador.
// V2 (14/10/2026): base64 rápido y envío por la subida directa de Gmail (message/rfc822), para adjuntos grandes (paquete del gestor).
// V3 (15/10/2026, Daniel: «error súper hiper grave, no puede volver a suceder»): una respuesta (responder_a) NO se envía si en el hilo ya
// hay un mensaje NUESTRO posterior a ese correo: devuelve ya_contestado con lo que se dijo y la fecha. Solo pasa con forzar: true, que se
// usa únicamente si Daniel lo pide sabiendo que ya se contestó.
// V4 (19/10/2026, Daniel: «¿por qué no te habías dado cuenta de que nos habían contestado?»): cada envío queda en correo_espera
// (esperando respuesta, plazo plazo_dias, 7 por defecto); correo-vigilar avisa en cuanto llega la respuesta y, si no llega, crea la tarea
// de reclamar. Con sin_espera: true no se registra (p. ej. un «gracias» que no espera nada).
// V5 (19/11/2026, Daniel: «las tareas siguen desactualizadas… tiene que ser al 200 %»): NINGÚN correo sale sin decir a qué tarea va.
// Hace falta tarea_id (la tarea que ya existe), crear_tarea {titulo, vence, claves, descripcion?} (se crea antes de enviar) o
// sin_tarea con el motivo (al menos 10 letras: p. ej. «solo agradecer, no queda nada pendiente»). El envío se apunta en la tarea.
const CLIENT_ID = "86457265161-d04tdo3paksi8v8qj05lnv3snf23me77.apps.googleusercontent.com";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const BUCKET = "documentos-exg";
const J = { "Content-Type": "application/json" };
const resp = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: J });
const te = new TextEncoder();
const lineas = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
const enc = (t: string) => "=?UTF-8?B?" + encodeBase64(te.encode(t)) + "?=";
const hoyTxt = () => new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" });

Deno.serve(async (req: Request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const clave = req.headers.get("x-exg-clave") ?? "";
    const { data: k } = await db.from("exg_claves").select("valor").eq("nombre", "correo-borrador").maybeSingle();
    if (!clave || !k?.valor || clave !== k.valor) return resp({ error: "no autorizado" }, 401);
    const b = await req.json();
    const to: string[] = b.to ?? []; if (!to.length) return resp({ error: "falta destinatario" }, 400);
    // V5: la tarea, antes de nada
    let tareaId: string | null = b.tarea_id ?? null;
    if (!tareaId && !b.crear_tarea && !(typeof b.sin_tarea === "string" && b.sin_tarea.trim().length >= 10))
      return resp({ ok: false, enviado: false, error: "V5: falta la tarea. Pasa tarea_id, crear_tarea {titulo, vence, claves} o sin_tarea con el motivo." }, 400);
    if (tareaId) {
      const { data: t0 } = await db.from("sistema").select("id").eq("id", tareaId).eq("tipo", "recordatorio").maybeSingle();
      if (!t0) return resp({ ok: false, enviado: false, error: "V5: no existe la tarea " + tareaId }, 400);
    }
    if (!tareaId && b.crear_tarea) {
      const c = b.crear_tarea;
      const { data: nt, error: ne } = await db.from("sistema").insert({ tipo: "recordatorio", data: { titulo: c.titulo, titulo_corto: c.titulo_corto ?? c.titulo, vence: c.vence, vence_tipo: c.vence_tipo ?? "revisar", estado: "pendiente", estado_rec: c.estado_rec ?? "en_espera", con: c.con ?? to.join(", "), claves: c.claves, descripcion: c.descripcion ?? "" } }).select("id").single();
      if (ne || !nt) return resp({ ok: false, enviado: false, error: "V5: no se pudo crear la tarea: " + (ne?.message ?? "") }, 400);
      tareaId = nt.id;
    }
    const { data: t } = await db.from("gmail_tokens").select("refresh_token").eq("id", 1).maybeSingle();
    const tk = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: t!.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token" }) });
    const tkj = await tk.json(); if (!tkj.access_token) throw new Error("Google no dio acceso: " + (tkj.error_description || tkj.error));
    const auth = { Authorization: "Bearer " + tkj.access_token };
    let threadId: string | undefined, inReply = "";
    if (b.responder_a) {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${b.responder_a}?format=metadata&metadataHeaders=Message-ID`, { headers: auth });
      const m = await r.json(); threadId = m.threadId;
      inReply = ((m.payload?.headers ?? []).find((h: any) => /^message-id$/i.test(h.name)) || {}).value ?? "";
      // V3: ¿ya contestamos a este correo?
      const th = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=minimal`, { headers: auth })).json();
      const ts = Number(m.internalDate || 0);
      const nuestro = (th.messages ?? []).filter((x: any) => (x.labelIds ?? []).includes("SENT") && Number(x.internalDate) > ts).pop();
      if (nuestro && b.forzar !== true) return resp({ ok: false, enviado: false, ya_contestado: true, contestado_el: new Date(Number(nuestro.internalDate)).toISOString(), lo_que_se_contesto: nuestro.snippet, error: "Ya se contestó a este correo: no se envía otra respuesta sin que Daniel lo pida sabiendo esto" }, 409);
    }
    const frontera = "exg" + crypto.randomUUID().replace(/-/g, "");
    const partes: string[] = [];
    partes.push(`--${frontera}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lineas(encodeBase64(te.encode(b.body ?? "")))}\r\n`);
    for (const a of b.adjuntos ?? []) {
      const { data, error } = await db.storage.from(BUCKET).download(a.path); if (error || !data) throw new Error("no encuentro " + a.path);
      const bytes = new Uint8Array(await data.arrayBuffer());
      partes.push(`--${frontera}\r\nContent-Type: ${a.mime || "application/octet-stream"}; name="${enc(a.filename)}"\r\nContent-Disposition: attachment; filename="${enc(a.filename)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${lineas(encodeBase64(bytes))}\r\n`);
    }
    const cab = [`To: ${to.join(", ")}`, `Subject: ${enc(b.subject ?? "")}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${frontera}"`];
    if (inReply) cab.push(`In-Reply-To: ${inReply}`, `References: ${inReply}`);
    const raw = cab.join("\r\n") + "\r\n\r\n" + partes.join("") + `--${frontera}--`;
    let dr: Response;
    if (threadId) {
      const rawB = encodeBase64(te.encode(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      dr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ raw: rawB, threadId }) });
    } else {
      dr = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", { method: "POST", headers: { ...auth, "Content-Type": "message/rfc822" }, body: te.encode(raw) });
    }
    const dj = await dr.json(); if (!dr.ok) throw new Error("Gmail " + dr.status + ": " + JSON.stringify(dj).slice(0, 300));
    // V4: queda esperando respuesta (un hilo solo tiene una espera abierta: si ya había una, se actualiza)
    if (b.sin_espera !== true) {
      const plazo = new Date(Date.now() + (Number(b.plazo_dias) || 7) * 864e5).toISOString().slice(0, 10);
      const { data: ab } = await db.from("correo_espera").select("id").eq("thread_id", dj.threadId).eq("estado", "esperando").maybeSingle();
      if (ab) await db.from("correo_espera").update({ message_id: dj.id, enviado_at: new Date().toISOString(), plazo }).eq("id", ab.id);
      else await db.from("correo_espera").insert({ thread_id: dj.threadId, message_id: dj.id, para: to.join(", "), asunto: b.subject ?? "", plazo });
    }
    // V5: el envío queda apuntado en su tarea (texto, vínculo y el hilo, para que la respuesta también caiga en ella)
    let tarea_apuntada = false;
    if (tareaId) {
      const { data: tt } = await db.from("sistema").select("data").eq("id", tareaId).maybeSingle();
      if (tt) {
        const d: any = tt.data ?? {};
        const linea = `${hoyTxt()}: correo enviado a ${to.join(", ")}${b.subject ? " («" + String(b.subject).slice(0, 80) + "»)" : ""}${(b.adjuntos ?? []).length ? " con " + (b.adjuntos ?? []).map((a: any) => a.filename).join(", ") : ""}`;
        const claves = Array.isArray(d.claves) ? d.claves : [];
        const hilo = "hilo:" + dj.threadId;
        d.descripcion = (d.descripcion ? d.descripcion + " | " : "") + linea;
        d.vinculos = (Array.isArray(d.vinculos) ? d.vinculos : []).concat([{ k: "correo_enviado:" + dj.id, fecha: new Date().toISOString().slice(0, 10), etiqueta: linea, auto: true }]);
        d.hilos = Array.from(new Set((Array.isArray(d.hilos) ? d.hilos : []).concat([dj.threadId])));
        if (!claves.includes(hilo)) d.claves = claves.concat([hilo]);
        const { error: ue } = await db.from("sistema").update({ data: d }).eq("id", tareaId);
        tarea_apuntada = !ue;
      }
    }
    return resp({ ok: true, message_id: dj.id, thread_id: dj.threadId, esperando_respuesta: b.sin_espera !== true, tarea_id: tareaId, tarea_apuntada, sin_tarea: tareaId ? null : b.sin_tarea });
  } catch (e) { return resp({ error: String(e) }, 500); }
});
