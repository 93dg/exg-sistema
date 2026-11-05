// sincronizar-banco — trae los movimientos de la cuenta …5612 desde la API de Fintable a movimientos_banco.
// Solo lectura sobre Fintable. Lo llama la tarea programada de la base de datos con la clave interna SYNC_BANCO_TOKEN.
// Sin cuerpo: los últimos 45 días (como siempre). Con cuerpo JSON {"desde":"AAAA-MM-DD","modo":"contar"|"importar"}: modo contar NO escribe nada y cuenta lo que Fintable tiene desde esa fecha (y lista las cuentas que ve); modo importar trae todo desde esa fecha (idempotente por id de Fintable).
// V4 (05/11/2026): si la fila ya existía por un aviso del correo con concepto genérico («Cargo en cuenta (aviso del banco)»), se le pone el concepto real de Fintable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const FINTABLE = "https://fintable.io/api/v2";
const CUENTA_FINAL = "5612";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function secretos(): Promise<Record<string, string>> {
  const { data } = await sb.from("secretos_api").select("clave,valor").in("clave", ["SYNC_BANCO_TOKEN", "FINTABLE_API_KEY"]);
  return Object.fromEntries((data || []).map((r: any) => [r.clave, r.valor]));
}
async function fintable(ruta: string, clave: string) {
  const r = await fetch(FINTABLE + ruta, { headers: { Authorization: `Bearer ${clave}`, Accept: "application/json" } });
  const texto = await r.text();
  let cuerpo: any = null; try { cuerpo = JSON.parse(texto); } catch (_) { /* no era JSON */ }
  if (!r.ok) throw new Error(`Fintable ${r.status} en ${ruta.split("?")[0]}: ${(cuerpo?.error?.message || texto).slice(0, 200)}`);
  return cuerpo;
}
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const dias = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const hoyMenos = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const fechaMenos = (f: string, n: number) => new Date(Date.parse(f) - n * 86400000).toISOString().slice(0, 10);
// concepto que solo dice «cargo en cuenta» / «préstamo» / «retirada en cajero» sacado del aviso del correo: se sustituye por el de Fintable
const generico = (c: string) => /^(cargo en cuenta|abono en cuenta|pr[eé]stamo|retirada en cajero|transferencia)?\s*\(aviso del banco\)$/i.test(String(c || "").trim());

async function md5(t: string) {
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(t)).catch(() => null);
  if (buf) return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  const s = await secretos();
  if (!s.SYNC_BANCO_TOKEN || req.headers.get("x-sync-token") !== s.SYNC_BANCO_TOKEN) return json({ ok: false, error: "no autorizado" }, 401);
  if (!s.FINTABLE_API_KEY) return json({ ok: true, hecho: false, motivo: "Falta FINTABLE_API_KEY en secretos_api" });
  const clave = s.FINTABLE_API_KEY;
  let cuerpo: any = {}; try { cuerpo = await req.json(); } catch (_) { /* sin cuerpo: modo normal */ }
  const desde: string = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo?.desde || "")) ? cuerpo.desde : hoyMenos(45);
  const modo: string = cuerpo?.modo === "contar" ? "contar" : "importar";
  try {
    const cuentas = (await fintable("/accounts", clave)).data || [];
    const cuenta = cuentas.find((c: any) => String(c.iban || "").replace(/\s/g, "").endsWith(CUENTA_FINAL)) || (cuentas.length === 1 ? cuentas[0] : null);
    if (!cuenta) return json({ ok: true, hecho: false, motivo: "Fintable todavía no tiene la cuenta …5612", cuentas_vistas: cuentas.length });

    let cursor: string | null = null, recibidos: any[] = [];
    for (let pagina = 0; pagina < 60; pagina++) {
      const q = new URLSearchParams({ date_from: desde, limit: "500", order: "date" });
      q.append("account_ids[]", cuenta.id);
      if (cursor) q.set("cursor", cursor);
      const r = await fintable(`/transactions?${q.toString()}`, clave);
      recibidos = recibidos.concat(r.data || []);
      cursor = r.next_cursor || null;
      if (!cursor) break;
    }

    const { data: existentes } = await sb.from("movimientos_banco").select("id,fecha,importe,concepto,fintable_id").gte("fecha", fechaMenos(desde, 15));
    const filas: any[] = existentes || [];

    if (modo === "contar") {
      const porFt = new Set<string>(filas.filter((f: any) => f.fintable_id).map((f: any) => f.fintable_id));
      const meses: Record<string, { n: number; suma: number; ya_en_app: number }> = {};
      let minF = "9999", maxF = "0000", yaEstan = 0;
      for (const t of recibidos) {
        const importe = Math.round(Number(t.amount) * 100) / 100; if (!Number.isFinite(importe)) continue;
        const m = String(t.date).slice(0, 7); meses[m] = meses[m] || { n: 0, suma: 0, ya_en_app: 0 };
        const ya = porFt.has(t.id) || filas.some((f: any) => Math.abs(Number(f.importe) - importe) < 0.005 && dias(f.fecha, t.date) <= 3);
        meses[m].n++; meses[m].suma = Math.round((meses[m].suma + importe) * 100) / 100; if (ya) { meses[m].ya_en_app++; yaEstan++; }
        if (t.date < minF) minF = t.date; if (t.date > maxF) maxF = t.date;
      }
      return json({ ok: true, modo, cuenta: cuenta.display_name || cuenta.name, desde, recibidos: recibidos.length, primera_fecha: minF === "9999" ? null : minF, ultima_fecha: maxF === "0000" ? null : maxF, ya_en_la_app: yaEstan, por_meses: meses, saldo_banco: cuenta.balance, cuentas_en_fintable: cuentas.map((c: any) => ({ nombre: c.display_name || c.name, iban_final: String(c.iban || "").slice(-4), saldo: c.balance, moneda: c.currency, tipo: c.type })) });
    }

    let nuevos = 0, enlazados = 0, ya_estaban = 0, cambiados = 0, conceptos_puestos = 0;
    const porFintable = new Map<string, any>(filas.filter((f: any) => f.fintable_id).map((f: any) => [f.fintable_id, f]));
    for (const t of recibidos) {
      const importe = Math.round(Number(t.amount) * 100) / 100;
      if (!Number.isFinite(importe)) continue;
      const concepto = [t.description, t.merchant && !String(t.description || "").toLowerCase().includes(String(t.merchant).toLowerCase()) ? t.merchant : null].filter(Boolean).join(" · ").slice(0, 300) || "(sin concepto)";
      const real = concepto !== "(sin concepto)";
      const previa = porFintable.get(t.id);
      if (previa) {
        const cambio: any = {};
        if (Math.abs(Number(previa.importe) - importe) > 0.001 || previa.fecha !== t.date) { cambio.importe = importe; cambio.fecha = t.date; cambio.concepto = concepto; }
        else if (real && generico(previa.concepto)) { cambio.concepto = concepto; conceptos_puestos++; }
        if (Object.keys(cambio).length) { await sb.from("movimientos_banco").update(cambio).eq("id", previa.id); if (cambio.importe !== undefined) cambiados++; } else ya_estaban++;
        continue;
      }
      const candidatas = filas.filter((f: any) => !f.fintable_id && Math.abs(Number(f.importe) - importe) < 0.005 && dias(f.fecha, t.date) <= 3)
        .sort((a: any, b: any) => dias(a.fecha, t.date) - dias(b.fecha, t.date) || (norm(b.concepto).includes(norm(t.description).slice(0, 8)) ? 1 : 0) - (norm(a.concepto).includes(norm(t.description).slice(0, 8)) ? 1 : 0));
      if (candidatas.length) {
        const f = candidatas[0]; f.fintable_id = t.id;
        const upd: any = { fintable_id: t.id };
        if (real && generico(f.concepto)) { upd.concepto = concepto; conceptos_puestos++; }
        await sb.from("movimientos_banco").update(upd).eq("id", f.id); porFintable.set(t.id, f); enlazados++;
      } else {
        const huella = await md5("fintable|" + t.id);
        const { data: ins, error } = await sb.from("movimientos_banco").insert({ cuenta: "ES40 3187 0588 5420 6788 5612", fecha: t.date, fecha_valor: t.date, concepto, importe, saldo: null, orden: null, origen: "fintable", fintable_id: t.id, huella }).select("id,fecha,importe,concepto,fintable_id").single();
        if (!error && ins) { nuevos++; filas.push(ins as any); porFintable.set(t.id, ins as any); }
      }
    }

    let aviso: string | null = null;
    if (nuevos > 0 || conceptos_puestos > 0) await sb.rpc("cruzar_movimientos_banco", { p_solo_pendientes: true });
    if (nuevos > 0) {
      const { data: sin } = await sb.from("movimientos_banco").select("fecha,concepto,importe,estado").eq("origen", "fintable").in("estado", ["falta_factura", "a_decidir"]).gte("fecha", hoyMenos(10)).order("fecha", { ascending: false });
      if (sin && sin.length) {
        const total = sin.reduce((a: number, m: any) => a + Math.abs(Number(m.importe)), 0);
        aviso = `Pagos nuevos del banco sin factura: ${sin.length} (${total.toFixed(2).replace(".", ",")} €)`;
        await sb.from("sistema_notificaciones").insert({ mensaje_original: "Sincronización automática del banco", decision_sistema: aviso, accion_realizada: sin.slice(0, 12).map((m: any) => `${m.fecha} ${String(m.concepto).slice(0, 34)} ${Math.abs(Number(m.importe)).toFixed(2).replace(".", ",")} €`).join(" · "), seccion: "economia", origen: "banco", datos_cambio: { nuevos, sin_factura: sin.length } });
      }
    }
    const resumen = { ok: true, hecho: true, desde, cuenta: cuenta.display_name || cuenta.name, recibidos: recibidos.length, nuevos, enlazados_con_el_extracto: enlazados, ya_estaban, cambiados, conceptos_puestos, saldo_banco: cuenta.balance, aviso };
    await sb.from("sistema_eventos").insert({ accion: "sync_banco", contexto: resumen });
    return json(resumen);
  } catch (e) {
    const error = String((e as Error).message || e).slice(0, 400);
    await sb.from("sistema_eventos").insert({ accion: "sync_banco_error", contexto: { error } });
    return json({ ok: false, error }, 500);
  }
});
