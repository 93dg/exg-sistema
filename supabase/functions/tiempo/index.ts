// TIEMPO (16/11/2026, Daniel: «una sección de tiempo que compare estos tres sitios, de 7 días, siempre»).
// 17/11: la tercera fuente es ECMWF (vía Open-Meteo) en lugar de Yr, que no daba % de lluvia en España.
// Devuelve los próximos 7 días de Fuente Obejuna según AEMET (XML público), Meteored (tiempo.com), ECMWF y AccuWeather
// (AccuWeather solo si hay clave ACCUWEATHER_KEY; su web bloquea la lectura directa). Solo lee; no guarda nada.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "es-ES,es;q=0.9" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Content-Type": "application/json" };
const AEMET = "https://www.aemet.es/xml/municipios/localidad_14029.xml";
const METEORED = "https://www.tiempo.com/fuente-obejuna.htm";
const ACCU_KEY = Deno.env.get("ACCUWEATHER_KEY") ?? "";
const MESES: Record<string, string> = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };

const num = (s: string | undefined | null) => { const n = parseFloat(String(s ?? "").replace(",", ".")); return isNaN(n) ? null : n; };

async function aemet() {
  const r = await fetch(AEMET, { headers: H });
  const buf = new Uint8Array(await r.arrayBuffer());
  const x = new TextDecoder("iso-8859-15").decode(buf);
  const out: Record<string, any> = {};
  for (const m of x.matchAll(/<dia fecha="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/dia>/g)) {
    const [, f, b] = m;
    const probs = [...b.matchAll(/<prob_precipitacion(?: periodo="([^"]*)")?>(\d*)<\/prob_precipitacion>/g)].map((p) => ({ per: p[1] || "", v: num(p[2]) }));
    const p24 = probs.find((p) => p.per === "00-24" || p.per === "");
    const prob = p24 && p24.v != null ? p24.v : Math.max(...probs.map((p) => p.v ?? -1).concat(-1));
    const cielos = [...b.matchAll(/<estado_cielo(?: periodo="([^"]*)")? descripcion="([^"]*)">[^<]*<\/estado_cielo>/g)].map((c) => ({ per: c[1] || "", d: c[2] }));
    const c24 = cielos.find((c) => (c.per === "00-24" || c.per === "") && c.d) || cielos.find((c) => c.per === "12-24" && c.d) || cielos.find((c) => c.d);
    const t = b.match(/<temperatura>\s*<maxima>(-?\d+)<\/maxima>\s*<minima>(-?\d+)<\/minima>/);
    out[f] = { prob: prob < 0 ? null : prob, max: t ? num(t[1]) : null, min: t ? num(t[2]) : null, cielo: c24?.d || null };
  }
  return out;
}

async function meteored() {
  const r = await fetch(METEORED, { headers: H });
  const h = await r.text();
  const out: Record<string, any> = {};
  const anio = new Date().getFullYear();
  const trozos = h.split(/<li class="grid-item dia d\d+/).slice(1, 8);
  for (const t of trozos) {
    const d = t.match(/class="subtitle-m">(\d{1,2}) (\w{3})/);
    if (!d) continue;
    const mes = MESES[d[2].toLowerCase()];
    let y = anio; if (mes === "01" && new Date().getMonth() === 11) y++;
    const f = `${y}-${mes}-${d[1].padStart(2, "0")}`;
    const p = t.match(/class="txt-strng probabilidad center">(\d+)%/);
    const mm = t.match(/class="changeUnitR" data-weather="([\d.]+)\|/);
    const mx = t.match(/class="max changeUnitT" data-weather="(-?[\d.]+)\|/);
    const mn = t.match(/class="min changeUnitT" data-weather="(-?[\d.]+)\|/);
    const c = t.match(/class="simbW"[^>]*alt="([^"]*)"/);
    out[f] = { prob: p ? num(p[1]) : 0, mm: mm ? num(mm[1]) : 0, max: mx ? Math.round(num(mx[1])!) : null, min: mn ? Math.round(num(mn[1])!) : null, cielo: c ? c[1] : null };
  }
  return out;
}

// ECMWF (Centro Europeo de Previsión a Plazo Medio), el modelo global de referencia, servido gratis por Open-Meteo.
// Sustituye a Yr (17/11, Daniel: «si ese motor no aporta exactitud, no lo quiero»): Yr no da probabilidad de lluvia en España.
const WMO: Record<number, string> = { 0: "Despejado", 1: "Poco nuboso", 2: "Intervalos nubosos", 3: "Cubierto", 45: "Niebla", 48: "Niebla", 51: "Llovizna débil", 53: "Llovizna", 55: "Llovizna intensa", 61: "Lluvia débil", 63: "Lluvia", 65: "Lluvia fuerte", 66: "Lluvia helada", 67: "Lluvia helada", 71: "Nieve débil", 73: "Nieve", 75: "Nieve fuerte", 77: "Nieve", 80: "Chubascos débiles", 81: "Chubascos", 82: "Chubascos fuertes", 85: "Chubascos de nieve", 86: "Chubascos de nieve", 95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta con granizo" };
async function ecmwf() {
  const u = "https://api.open-meteo.com/v1/forecast?latitude=38.26&longitude=-5.45&elevation=590&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FMadrid&forecast_days=8&models=ecmwf_ifs025";
  const r = await fetch(u);
  if (!r.ok) return { error: "ECMWF respondió " + r.status };
  const d = (await r.json())?.daily ?? {};
  const out: Record<string, any> = {};
  (d.time ?? []).forEach((f: string, i: number) => {
    out[f] = { prob: d.precipitation_probability_max?.[i] ?? null, mm: d.precipitation_sum?.[i] == null ? null : Math.round(d.precipitation_sum[i] * 10) / 10, max: d.temperature_2m_max?.[i] == null ? null : Math.round(d.temperature_2m_max[i]), min: d.temperature_2m_min?.[i] == null ? null : Math.round(d.temperature_2m_min[i]), cielo: WMO[d.weather_code?.[i]] ?? null };
  });
  return out;
}

async function accuweather() {
  if (!ACCU_KEY) return { error: "sin clave de AccuWeather" };
  const base = "https://dataservice.accuweather.com";
  const g = await (await fetch(`${base}/locations/v1/cities/geoposition/search?apikey=${ACCU_KEY}&q=38.262,-5.452&language=es`)).json();
  if (!g?.Key) return { error: "AccuWeather no dio la localidad" };
  const d = await (await fetch(`${base}/forecasts/v1/daily/5day/${g.Key}?apikey=${ACCU_KEY}&language=es&details=true&metric=true`)).json();
  const out: Record<string, any> = {};
  for (const x of d?.DailyForecasts ?? []) {
    const f = String(x.Date).slice(0, 10);
    out[f] = { prob: Math.max(x.Day?.PrecipitationProbability ?? 0, x.Night?.PrecipitationProbability ?? 0), prob_dia: x.Day?.PrecipitationProbability ?? null, max: Math.round(x.Temperature?.Maximum?.Value), min: Math.round(x.Temperature?.Minimum?.Value), cielo: x.Day?.IconPhrase || null };
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const fuentes: Record<string, any> = {};
  const [a, m, e, w] = await Promise.allSettled([aemet(), meteored(), ecmwf(), accuweather()]);
  const val = (r: PromiseSettledResult<any>, n: string) => { if (r.status === "rejected") { fuentes[n] = { error: String(r.reason) }; return {}; } if (r.value?.error) { fuentes[n] = { error: r.value.error }; return {}; } fuentes[n] = { ok: true, dias: Object.keys(r.value).length }; return r.value; };
  const A = val(a, "aemet"), M = val(m, "meteored"), E = val(e, "ecmwf"), W = val(w, "accuweather");
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(hoy); d.setDate(hoy.getDate() + i);
    const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dias.push({ fecha: f, aemet: A[f] ?? null, meteored: M[f] ?? null, ecmwf: E[f] ?? null, accuweather: W[f] ?? null });
  }
  return new Response(JSON.stringify({ ok: true, lugar: "Fuente Obejuna (Córdoba)", actualizado: new Date().toISOString(), fuentes, dias }), { headers: CORS });
});
