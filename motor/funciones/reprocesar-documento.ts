// reprocesar-documento v34 — usa EXCLUSIVAMENTE el motor único (motor/extractor.ts).
// Solo reglas. Rellena campos VACÍOS; nunca sobrescribe un dato válido: si el motor ve otra cosa
// lo devuelve como discrepancia (CONFLICTO) para revisión. 0 IA en esta versión.
// v17: es el paso central del CIRCUITO DE CALIDAD:
//   DETECTAR (verificar_calidad) → REPROCESAR con el motor actual → COMPARAR → CORREGIR si es seguro
//   → REVALIDAR → estado final: validado (OK) | corregido_automatico | revision_necesaria/error (REVISAR) | conflicto
import { createClient } from "jsr:@supabase/supabase-js@2";
import WordExtractor from "npm:word-extractor@1.0.4";
import { XLSX, leerHoja, leerTexto, textoDeRTF, resolverCliente, lineasParaGuardar, fichaEsValida, VERSION_MOTOR } from "https://raw.githubusercontent.com/93dg/exg-sistema/aea8961d01f2a8b7efa5768b0377eca6f3508609/motor/extractor.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const codigos = (info: any) => (String(info || "").match(/\[control-calidad: ([^\]]+)\]/)?.[1] || "").split(", ").filter(Boolean);
async function cerrarCircuito(sb: any, doc: any, antes: string[], salida: any) {
  // REVALIDAR con las reglas de calidad y decidir el estado final
  const { data: cal } = await sb.rpc("verificar_calidad", { p_anio: null, p_id: doc.id });
  const { data: tras } = await sb.from("documentos_economicos").select("estado_calidad, info_faltante").eq("id", doc.id).single();
  let estado = tras?.estado_calidad;
  // lo que el motor dejó PENDIENTE (p.ej. cliente sin ficha fiable) es un fallo real aunque la regla SQL no lo vea:
  // se añade a los códigos y el documento queda en REVISAR, nunca en OK
  const extra = (salida.pendientes || []).map((p: any) => ({ entidad_id: "cliente", cliente: "cliente", fecha: "fecha", fecha_devengo: "fecha", numero: "numero", conceptos: "lineas" } as any)[p.campo] || p.campo);
  let cods = codigos(tras?.info_faltante);
  if (extra.length) {
    cods = [...new Set([...cods, ...extra])];
    const info = String(tras?.info_faltante || "").replace(/\s*\[control-calidad:[^\]]*\]/g, "") + ` [control-calidad: ${cods.join(", ")}]`;
    await sb.from("documentos_economicos").update({ info_faltante: info }).eq("id", doc.id);
    if (estado === "validado" || estado === "corregido_automatico") estado = "revision_necesaria";
  }
  if ((salida.discrepancias || []).length) estado = "conflicto";
  else if ((estado === "validado" || estado === "corregido_automatico") && (salida.aplicados || []).length) estado = "corregido_automatico";
  if (estado !== tras?.estado_calidad) await sb.from("documentos_economicos").update({ estado_calidad: estado }).eq("id", doc.id);
  await sb.from("circuito_calidad_log").insert({ documento_id: doc.id, motor: VERSION_MOTOR, fallos_antes: antes, resultado: salida.resultado, aplicados: salida.aplicados || [], discrepancias: salida.discrepancias || [], pendientes: salida.pendientes || [], fallos_despues: cods, estado_final: estado });
  return { calidad: cal, estado_final: estado };
}
const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function extraer(sb: any, path: string) {
  const ext = (path.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  const { data: blob, error } = await sb.storage.from("documentos-exg").download(path);
  if (error || !blob) return { error: "inaccesible", detalle: error?.message };
  const buf = new Uint8Array(await blob.arrayBuffer());
  const anio = path.match(/\/(\d{4})\//)?.[1];
  if (["xls", "xlsx", "xlsm", "xlsb"].includes(ext)) {
    const r = leerHoja(XLSX.read(buf, { type: "array", cellDates: false }), anio, { archivo: path });
    return r ? { r, anio } : { error: "sin_reglas", detalle: "hoja sin forma de documento" };
  }
  if (ext === "doc") {
    const tmp = await Deno.makeTempFile({ suffix: ".doc" });
    await Deno.writeFile(tmp, buf);
    try { return { r: leerTexto((await new WordExtractor().extract(tmp)).getBody(), anio), anio }; }
    catch (e) { return { error: "sin_reglas", detalle: String(e) }; }
    finally { try { await Deno.remove(tmp); } catch (_) {} }
  }
  if (ext === "rtf") return { r: leerTexto(textoDeRTF(new TextDecoder("latin1").decode(buf)), anio), anio };
  return { error: "sin_reglas", detalle: `.${ext} necesita lectura visual (IA)` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { documento_id, modo, crear_clientes } = await req.json();
    if (!documento_id) return json({ error: "Falta documento_id" }, 400);
    const simular = modo === "simular";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: doc } = await sb.from("documentos_economicos").select("*, entidad:entidades(id,nombre,nif)").eq("id", documento_id).single();
    if (!doc) return json({ ok: false, resultado: "error", error: "Documento no encontrado" });
    const antes = codigos(doc.info_faltante);
    if (!doc.archivo_path) {
      const fin = simular ? {} : await cerrarCircuito(sb, doc, antes, { resultado: "sin_archivo" });
      return json({ ok: true, resultado: "sin_archivo", documento_id, ...fin });
    }

    const x: any = await extraer(sb, doc.archivo_path);
    if (x.error) {
      const resultado = x.error === "inaccesible" ? "inaccesible" : "necesita_ia";
      let fin: any = {};
      if (!simular) { await sb.from("documentos_economicos").update({ reprocesado_at: new Date().toISOString() }).eq("id", documento_id); fin = await cerrarCircuito(sb, doc, antes, { resultado }); }
      return json({ ok: true, documento_id, resultado, detalle: x.detalle, motor: VERSION_MOTOR, ...fin });
    }
    const r = x.r;
    const cambios: any = {}, discrepancias: any[] = [], pendientes: any[] = [];

    // líneas
    const actuales = Array.isArray(doc.conceptos) ? doc.conceptos : [];
    const nuevas = lineasParaGuardar(r.conceptos || []);
    if (!actuales.length && nuevas.length) cambios.conceptos = nuevas;
    // número
    const numActual = (doc.numero || "").trim();
    if ((!numActual || /^0+$/.test(numActual)) && r.numero) cambios.numero = r.numero;
    else if (numActual && r.numero && numActual.replace(/^0+/, "").toLowerCase() !== String(r.numero).replace(/^0+/, "").toLowerCase()) discrepancias.push({ campo: "numero", actual: numActual, motor: r.numero });
    // fecha (con coherencia de año respecto a la carpeta)
    const fechaCoherente = r.fecha && (!x.anio || Math.abs(Number(r.fecha.slice(0, 4)) - Number(x.anio)) <= 1);
    if (!doc.fecha_devengo && r.fecha) { if (fechaCoherente) cambios.fecha_devengo = r.fecha; else pendientes.push({ campo: "fecha", motor: r.fecha, motivo: `año distinto a la carpeta ${x.anio}` }); }
    else if (doc.fecha_devengo && r.fecha && doc.fecha_devengo !== r.fecha) discrepancias.push({ campo: "fecha", actual: doc.fecha_devengo, motor: r.fecha });
    // cliente
    const actualValido = doc.entidad && fichaEsValida(doc.entidad.nombre, doc.entidad.nif);
    const res: any = await resolverCliente(sb, { nombre: r.cliente.nombre, nif: r.cliente.nif, direccion: r.cliente.direccion, preferidoId: doc.entidad_id, bloque: r.cliente.bloque, archivo: doc.archivo_path, poblacion: r.cliente.poblacion });
    if (actualValido) {
      if (res.estado === "existente" && res.id !== doc.entidad_id) discrepancias.push({ campo: "cliente", actual: doc.entidad.nombre, motor: res.nombre, evidencia: res.evidencia });
      else if (res.estado === "nuevo") discrepancias.push({ campo: "cliente", actual: doc.entidad.nombre, motor: res.nombre, evidencia: "cliente distinto sin ficha" });
      else if (res.estado === "conflicto") discrepancias.push({ campo: "cliente", actual: doc.entidad.nombre, motor: r.cliente.nombre, evidencia: res.motivo });
    } else {
      if (res.estado === "existente") {
        cambios.entidad_id = res.id;
        if (res.enriquecer_nif && !simular) await sb.rpc("consolidar_cliente_dato", { p_entidad_id: res.id, p_campo: "nif", p_valor: res.enriquecer_nif, p_origen: "motor:" + VERSION_MOTOR });
        // fichas duplicadas: se registran para fusión revisada, nunca se fusionan solas
        if (res.duplicados?.length && !simular) for (const otro of res.duplicados) {
          const { data: ya } = await sb.from("duplicados_clientes_pendientes").select("id").or(`and(entidad_a.eq.${res.id},entidad_b.eq.${otro}),and(entidad_a.eq.${otro},entidad_b.eq.${res.id})`).limit(1);
          if (!ya?.length) await sb.from("duplicados_clientes_pendientes").insert({ entidad_a: res.id, entidad_b: otro, puntuacion: 95, motivos: { nivel: "muy_probable", etiquetas: ["Mismo nombre", "Dirección compatible", "Sin NIF contradictorio"], origen: VERSION_MOTOR }, estado: "pendiente_resolver" });
        }
      }
      else if (res.estado === "nuevo" && (res.alta_segura || crear_clientes === true)) {
        if (simular) { cambios.entidad_id = `(nueva ficha: ${res.nombre} · ${res.nif})`; } else {
        const { data: nueva } = await sb.from("entidades").insert({ nombre: String(res.nombre).toUpperCase(), tipo: "cliente", nif: res.nif || null, direccion: r.cliente.direccion ? String(r.cliente.direccion).toUpperCase() : null, poblacion: r.cliente.poblacion ? String(r.cliente.poblacion).toUpperCase() : null, clase_nombre: res.clase, clase_motor: VERSION_MOTOR }).select("id").single();
        if (nueva) cambios.entidad_id = nueva.id; }
      } else pendientes.push({ campo: "cliente", estado: res.estado, propuesta: res.nombre || r.cliente.nombre || null, motivo: res.motivo || null });
    }
    // tipo documental: nunca automático
    // "si pone PROFORMA dentro, es proforma": el tipo que declara el propio documento se aplica
    if (r.tipo && r.tipo !== doc.tipo && r.tipo_origen === "contenido" && r.tipo === "proforma") {
      cambios.tipo = "proforma";
    } else if (r.tipo && r.tipo !== doc.tipo) {
      // si el documento parece de otro tipo, NO se rellena nada: número/fecha/cliente serían de otro documento
      discrepancias.push({ campo: "tipo", actual: doc.tipo, motor: r.tipo });
      for (const k of Object.keys(cambios)) { pendientes.push({ campo: k, motor: k === "conceptos" ? `${cambios[k].length} líneas` : cambios[k], motivo: "tipo documental en duda" }); delete cambios[k]; }
    }

    const aplicados = Object.keys(cambios);
    const resultado = discrepancias.length ? "conflicto" : aplicados.length ? (aplicados.includes("conceptos") ? "lineas_recuperadas" : "mejorado") : pendientes.length ? "revision_manual" : "sin_cambios";
    let fin: any = {};
    if (!simular) {
      await sb.from("documentos_economicos").update({ ...cambios, reprocesado_at: new Date().toISOString() }).eq("id", documento_id);
      fin = await cerrarCircuito(sb, doc, antes, { resultado, aplicados, discrepancias, pendientes });
    }
    return json({ ok: true, documento_id, motor: VERSION_MOTOR, simulado: simular, resultado, aplicados, cambios: simular ? cambios : undefined, discrepancias, pendientes, ...fin, cliente_asignado: !!cambios.entidad_id, conflictos: discrepancias.length });
  } catch (e) { return json({ error: String(e) }, 500); }
});
