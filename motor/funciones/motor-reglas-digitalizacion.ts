// motor-reglas-digitalizacion v40 — digitalización masiva por año usando EXCLUSIVAMENTE el motor único.
// Cambios respecto a v39: sin reglas propias; cliente anclado al destinatario y validado; nunca crea
// fichas con nombres que no son entidad; documento nace "pendiente" y pasa por verificar_calidad.
import { createClient } from "jsr:@supabase/supabase-js@2";
import WordExtractor from "npm:word-extractor@1.0.4";
import { XLSX, leerHoja, leerTexto, textoDeRTF, resolverCliente, lineasParaGuardar, VERSION_MOTOR } from "https://raw.githubusercontent.com/93dg/exg-sistema/f325f38a05753f1758b0f3b277368ead0de15459/motor/extractor.ts";

const BUCKET = "documentos-exg";

async function extraer(admin: any, ruta: string, anio: string) {
  const ext = (ruta.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  const { data: blob } = await admin.storage.from(BUCKET).download(ruta);
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (["xls", "xlsx", "xlsm", "xlsb"].includes(ext)) return leerHoja(XLSX.read(buf, { type: "array", cellDates: false }), anio, { archivo: ruta });
  if (ext === "doc") {
    const tmp = await Deno.makeTempFile({ suffix: ".doc" });
    await Deno.writeFile(tmp, buf);
    try { return leerTexto((await new WordExtractor().extract(tmp)).getBody(), anio); } catch (_) { return null; } finally { try { await Deno.remove(tmp); } catch (_) {} }
  }
  if (ext === "rtf") return leerTexto(textoDeRTF(new TextDecoder("latin1").decode(buf)), anio);
  return null;
}

async function procesarAnio(admin: any, anio: string, limite: number, crearClientes: boolean) {
  const { data: inventario, error } = await admin.rpc("inventario_storage_anio", { p_bucket: BUCKET, p_anio: anio });
  if (error) throw new Error("No se pudo leer el inventario real: " + error.message);
  const todos = (inventario || []).filter((f: any) => /^(facturas|albaranes|presupuestos|proformas)$/i.test(f.carpeta_tipo) && !/\.lnk$/i.test(f.ruta_exacta));
  const hechos = async (vals: string[], col: string) => {
    const s = new Set<string>();
    for (let i = 0; i < vals.length; i += 40) {
      const { data } = await admin.from("documentos_economicos").select(col).in(col, vals.slice(i, i + 40));
      for (const r of data || []) if ((r as any)[col]) s.add((r as any)[col]);
    }
    return s;
  };
  const [rutas, etags] = await Promise.all([hechos(todos.map((f: any) => f.ruta_exacta), "archivo_path"), hechos(todos.map((f: any) => f.etag).filter(Boolean), "storage_etag")]);
  const archivos = todos.filter((f: any) => !rutas.has(f.ruta_exacta) && !etags.has(f.etag)).slice(0, limite);
  const cache: any = {};
  const res = { anio, motor: VERSION_MOTOR, total_archivos: todos.length, ya_existian: todos.length - archivos.length, extraidos: 0, cliente_resuelto: 0, cliente_pendiente: 0, posibles_duplicados: 0, errores: [] as string[] };

  for (const f of archivos) {
    const nombre = f.ruta_exacta.split("/").pop();
    let r: any = null;
    try { r = await extraer(admin, f.ruta_exacta, anio); } catch (e) { res.errores.push(`${f.ruta_exacta}: ${String(e)}`); }
    const conceptos = lineasParaGuardar(r?.conceptos || []);
    let entidadId: string | null = null, notaCliente = "";
    if (r) {
      const c: any = await resolverCliente(admin, { nombre: r.cliente.nombre, nif: r.cliente.nif, direccion: r.cliente.direccion, bloque: r.cliente.bloque, archivo: f.ruta_exacta, poblacion: r.cliente.poblacion }, cache);
      if (c.estado === "existente") entidadId = c.id;
      else if (c.estado === "nuevo" && crearClientes) {
        const { data: n } = await admin.from("entidades").insert({ nombre: String(c.nombre).toUpperCase(), tipo: "cliente", nif: c.nif || null, direccion: r.cliente.direccion ? String(r.cliente.direccion).toUpperCase() : null, poblacion: r.cliente.poblacion ? String(r.cliente.poblacion).toUpperCase() : null }).select("id").single();
        if (n) { entidadId = n.id; cache.entidades = null; }
      } else notaCliente = ` [cliente no resuelto: ${c.estado}${c.nombre || r.cliente.nombre ? " — propuesta " + (c.nombre || r.cliente.nombre) : ""}]`;
    }
    entidadId ? res.cliente_resuelto++ : res.cliente_pendiente++;
    // tipo: título real del documento; si no hay, la carpeta
    let tipo = r?.tipo || (/^presupuestos$/i.test(f.carpeta_tipo) ? "presupuesto" : /^proformas$/i.test(f.carpeta_tipo) ? "proforma" : /^albaranes$/i.test(f.carpeta_tipo) ? "albaran" : "factura");
    let dup: string | null = null;
    if (entidadId && r?.numero && r?.importe) {
      const { data: p } = await admin.from("documentos_economicos").select("id").eq("tipo", tipo).eq("numero", r.numero).eq("entidad_id", entidadId).gte("importe", Number(r.importe) - 1).lte("importe", Number(r.importe) + 1).limit(1).maybeSingle();
      if (p) { dup = p.id; res.posibles_duplicados++; }
    }
    const historico = Number(anio) < new Date().getUTCFullYear();
    const importe = r?.importe || 0;
    const { data: ins, error: e2 } = await admin.from("documentos_economicos").insert({
      tipo, estado: "emitido", numero: r?.numero || null, fecha_devengo: r?.fecha || null, entidad_id: entidadId,
      concepto: conceptos[0]?.descripcion || null, importe, conceptos, contabilidad: "oficial",
      estado_cobro: historico ? "cobrado" : "pendiente_cobrar", cobrado_importe: historico ? importe : 0,
      enviado_gestor: historico, enviado_gestor_fecha: historico ? (r?.fecha || null) : null,
      iva_pct: r?.tratamiento_iva === "isp" ? 0 : (r?.sin_iva ? 0 : (r?.iva_pct ?? 16)), tratamiento_iva: r?.tratamiento_iva || "normal",
      confianza_extraccion: r && r.numero && r.fecha && entidadId && conceptos.length && r.matematica_cuadra ? "alta" : r && r.fecha && conceptos.length ? "media" : "baja",
      metodo_extraccion: "reglas", firma_plantilla: VERSION_MOTOR, conflicto_iva_total: !!r?.conflicto_iva_total, posible_duplicado_de: dup,
      estado_calidad: "pendiente",
      info_faltante: `Año ${anio}. Archivo original: ${nombre}.${notaCliente}${dup ? " [posible duplicado]" : ""}`,
      archivo_path: f.ruta_exacta, storage_etag: f.etag || null,
    }).select("id").single();
    if (e2) { res.errores.push(`insert ${f.ruta_exacta}: ${e2.message}`); continue; }
    await admin.rpc("verificar_calidad", { p_anio: null, p_id: ins.id });
    res.extraidos++;
  }
  return res;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const anio = url.searchParams.get("anio") || "2005";
  const limite = Number(url.searchParams.get("limite") || "40");
  const crear = url.searchParams.get("crear_clientes") === "1";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try { return new Response(JSON.stringify({ ok: true, resumen: await procesarAnio(admin, anio, limite, crear) }), { headers: { "Content-Type": "application/json" } }); }
  catch (e) { return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 }); }
});
