import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json();

  // Crear cliente si no existe
  let entidad_id = body.entidad_id;
  if (!entidad_id && body.cliente_nombre) {
    const { data: existe } = await sb.from("entidades").select("id").ilike("nombre", body.cliente_nombre).maybeSingle();
    if (existe) {
      entidad_id = existe.id;
    } else {
      const { data: nuevo } = await sb.from("entidades").insert({ nombre: body.cliente_nombre.toUpperCase(), tipo: "cliente", clase_nombre: "persona" }).select("id").single();
      entidad_id = nuevo?.id;
    }
  }

  const doc = {
    tipo: body.tipo || "albaran",
    entidad_id,
    fecha_devengo: body.fecha_devengo,
    importe: body.importe,
    conceptos: body.conceptos || [],
    estado_calidad: "validado",
    enviado_gestor: false,
    numero: body.numero || null,
  };

  const { data, error } = await sb.from("documentos_economicos").insert(doc).select().single();
  if (error) return new Response(JSON.stringify({ error }), { headers: { ...cors, "Content-Type": "application/json" }, status: 400 });
  return new Response(JSON.stringify({ id: data.id, resultado: "creado" }), { headers: { ...cors, "Content-Type": "application/json" } });
});
