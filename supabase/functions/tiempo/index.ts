// TIEMPO (16/11/2026, Daniel: «una sección de tiempo que compare estos tres sitios, de 7 días, siempre»).
// 16/11 22:48 Daniel aprueba añadir Yr (servicio meteorológico de Noruega, api.met.no, gratuito y oficial; pide identificarse con User-Agent).
// Devuelve los próximos 7 días de Fuente Obejuna según AEMET (XML público), Meteored (tiempo.com), Yr y AccuWeather
// Yr no da probabilidad de lluvia fuera de los países nórdicos: solo litros, temperaturas y cielo.
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

const YR_TXT: Record<string, string> = { clearsky: "Despejado", fair: "Poco nuboso", partlycloudy: "Intervalos nubosos", cloudy: "Cubierto", fog: "Niebla", lightrain: "Lluvia débil", rain: "Lluvia", heavyrain: "Lluvia fuerte", lightrainshowers: "Chubascos débiles", rainshowers: "Chubascos", heavyrainshowers: "Chubascos fuertes", lightsleet: "Aguanieve", sleet: "Aguanieve", snow: "Nieve", lightsnow: "Nieve débil", heavysnow: "Nieve fuerte" };
const yrTxt = (c: string) => { const b = String(c || "").replace(/_(day|night|polartwilight)$/, ""); if (/thunder/.test(b)) return "Tormenta"; return YR_TXT[b] || YR_TXT[b.replace(/showers$/, "")] || null; };
async function yr() {
  const r = await fetch("https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=38.26&lon=-5.45&altitude=590", { headers: { "User-Agent": "EXG-Tiempo/1.0 github.com/93dg/exg-sistema" } });
  if (!r.ok) return { error: "Yr respondió " + r.status };
  const j = await r.json();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const out: Record<string, any> = {};
  let cubierto = 0;
  for (const e of j?.properties?.timeseries ?? []) {
    const t = new Date(e.time).getTime();
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const f = `${p.year}-${p.month}-${p.day}`, hora = +p.hour;
    const o = out[f] ||= { prob: null, mm: 0, max: null, min: null, cielo: null, _h: 99, _n: 0 };
    const temp = e.data?.instant?.details?.air_temperature;
    if (temp != null) { o._n++; o.max = o.max == null ? temp : Math.max(o.max, temp); o.min = o.min == null ? temp : Math.min(o.min, temp); }
    const n1 = e.data?.next_1_hours, n6 = e.data?.next_6_hours, per = n1 || n6;
    if (per) {
      const pr = per.details?.probability_of_precipitation; if (pr != null) o.prob = Math.max(o.prob ?? 0, pr);
      if (t >= cubierto) { o.mm += per.details?.precipitation_amount ?? 0; cubierto = t + (n1 ? 1 : 6) * 3600e3; }
      if (per.summary?.symbol_code && Math.abs(hora - 13) < Math.abs(o._h - 13)) { o.cielo = yrTxt(per.summary.symbol_code); o._h = hora; }
    }
  }
  for (const f in out) { const o = out[f]; if (o._n < 8) { o.max = null; o.min = null; }   // día empezado: no es la máxima/mínima del día entero
    delete o._h; delete o._n; o.max = o.max == null ? null : Math.round(o.max); o.min = o.min == null ? null : Math.round(o.min); o.mm = Math.round(o.mm * 10) / 10; if (o.prob != null) o.prob = Math.round(o.prob); }
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
  const [a, m, y, w] = await Promise.allSettled([aemet(), meteored(), yr(), accuweather()]);
  const val = (r: PromiseSettledResult<any>, n: string) => { if (r.status === "rejected") { fuentes[n] = { error: String(r.reason) }; return {}; } if (r.value?.error) { fuentes[n] = { error: r.value.error }; return {}; } fuentes[n] = { ok: true, dias: Object.keys(r.value).length }; return r.value; };
  const A = val(a, "aemet"), M = val(m, "meteored"), Y = val(y, "yr"), W = val(w, "accuweather");
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(hoy); d.setDate(hoy.getDate() + i);
    const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dias.push({ fecha: f, aemet: A[f] ?? null, meteored: M[f] ?? null, yr: Y[f] ?? null, accuweather: W[f] ?? null });
  }
  return new Response(JSON.stringify({ ok: true, lugar: "Fuente Obejuna (Córdoba)", actualizado: new Date().toISOString(), fuentes, dias }), { headers: CORS });
});
