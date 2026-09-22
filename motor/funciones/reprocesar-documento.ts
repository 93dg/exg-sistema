// reprocesar-documento v15 — usa EXCLUSIVAMENTE el motor único (motor/extractor.ts).
// Solo reglas. Rellena campos VACÍOS; nunca sobrescribe un dato válido: si el motor ve otra cosa
// lo devuelve como discrepancia (CONFLICTO) para revisión. 0 IA en esta versión.
import { createClient } from "jsr:@supabase/supabase-js@2";
import WordExtractor from "npm:word-extractor@1.0.4";
import { XLSX, leerHoja, leerTexto, textoDeRTF, resolverCliente, lineasParaGuardar, fichaEsValida, VERSION_MOTOR } from "https://raw.githubusercontent.com/93dg/exg-sistema/bf9603cbe9800e446afba4b96ca7582805d58632/motor/extractor.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function extraer(sb: any, path: string) {
  const ext = (path.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  const { data: blob, error } = await sb.storage.from("documentos-exg").download(path);
  if (error || !blob) return { error: "inaccesible", detalle: error?.message };
  const buf = new Uint8Array(await blob.arrayBuffer());
  const anio = path.match(/\/(\d{4})\//)?.[1];
  if (["xls", "xlsx", "xlsm", "xlsb"].includes(ext)) {
    const r = leerHoja(XLSX.read(buf, { type: "array", cellDates: false }), anio);
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
    if (!doc.archivo_path) return json({ ok: true, resultado: "sin_archivo", documento_id });

    const x: any = await extraer(sb, doc.archivo_path);
    if (x.error) {
      if (!simular) await sb.from("documentos_economicos").update({ reprocesado_at: new Date().toISOString() }).eq("id", documento_id);
      return json({ ok: true, documento_id, resultado: x.error === "inaccesible" ? "inaccesible" : "necesita_ia", detalle: x.detalle, motor: VERSION_MOTOR });
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
    const res: any = await resolverCliente(sb, { nombre: r.cliente.nombre, nif: r.cliente.nif, direccion: r.cliente.direccion, preferidoId: doc.entidad_id, bloque: r.cliente.bloque });
    if (actualValido) {
      if (res.estado === "existente" && res.id !== doc.entidad_id) discrepancias.push({ campo: "cliente", actual: doc.entidad.nombre, motor: res.nombre, evidencia: res.evidencia });
      else if (res.estado === "nuevo") discrepancias.push({ campo: "cliente", actual: doc.entidad.nombre, motor: res.nombre, evidencia: "cliente distinto sin ficha" });
      else if (res.estado === "conflicto") discrepancias.push({ campo: "cliente", actual: doc.entidad.nombre, motor: r.cliente.nombre, evidencia: res.motivo });
    } else {
      if (res.estado === "existente") cambios.entidad_id = res.id;
      else if (res.estado === "nuevo" && crear_clientes === true && !simular) {
        const { data: nueva } = await sb.from("entidades").insert({ nombre: String(res.nombre).toUpperCase(), tipo: "cliente", nif: res.nif || null, direccion: r.cliente.direccion ? String(r.cliente.direccion).toUpperCase() : null, poblacion: r.cliente.poblacion ? String(r.cliente.poblacion).toUpperCase() : null }).select("id").single();
        if (nueva) cambios.entidad_id = nueva.id;
      } else pendientes.push({ campo: "cliente", estado: res.estado, propuesta: res.nombre || r.cliente.nombre || null, motivo: res.motivo || null });
    }
    // tipo documental: nunca automático
    if (r.tipo && r.tipo !== doc.tipo) discrepancias.push({ campo: "tipo", actual: doc.tipo, motor: r.tipo });

    let calidad: any = null;
    if (!simular) {
      cambios.reprocesado_at = new Date().toISOString();
      await sb.from("documentos_economicos").update(cambios).eq("id", documento_id);
      calidad = (await sb.rpc("verificar_calidad", { p_anio: null, p_id: documento_id })).data;
    }
    const aplicados = Object.keys(cambios).filter((k) => k !== "reprocesado_at");
    const resultado = discrepancias.length ? "conflicto" : aplicados.length ? (aplicados.includes("conceptos") ? "lineas_recuperadas" : "mejorado") : pendientes.length ? "revision_manual" : "sin_cambios";
    return json({ ok: true, documento_id, motor: VERSION_MOTOR, simulado: simular, resultado, aplicados, cambios: simular ? cambios : undefined, discrepancias, pendientes, calidad, cliente_asignado: !!cambios.entidad_id, conflictos: discrepancias.length });
  } catch (e) { return json({ error: String(e) }, 500); }
});
