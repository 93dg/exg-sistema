// @ts-nocheck
/* =====================================================================
   EXG — MOTOR DE EXTRACCIÓN ÚNICO (fuente única de verdad)
   Lo importan TODAS las funciones que digitalizan o reprocesan documentos
   (motor-reglas-digitalizacion, reprocesar-documento, diagnósticos).
   Ninguna función debe tener su propia copia de estas reglas.
   ===================================================================== */
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
export { XLSX };
export const VERSION_MOTOR = "motor-exg-2.19";

/* ---------------- normalización ---------------- */
export function norm(t: any): string {
  return String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}
export function soloAlnum(t: any): string { return norm(t).replace(/[^A-Z0-9]/g, ""); }

/* ---------------- emisor (Excavaciones Gómez) ---------------- */
const EMISOR = {
  nifs: ["75706590C"],
  telefonos: ["670983221", "957584084"],
  nombres: ["EXCAVACIONES GOMEZ", "RAFAEL GOMEZ MARTINEZ"],
  emails: ["EXGOMEZ"],
  direcciones: [/\bINDUSTRIA\s*S\.?\s*\/?\s*N\b/, /C\/\.?\s*SEVILLA/, /\bCALLE INDUSTRIA\b/],
};
export function esDatoEmisor(t: any): boolean {
  const n = norm(t); if (!n) return false;
  const a = soloAlnum(t);
  if (EMISOR.nifs.some((x) => a.includes(x))) return true;
  if (EMISOR.telefonos.some((x) => a.includes(x))) return true;
  if (EMISOR.emails.some((x) => a.includes(x))) return true;
  if (EMISOR.nombres.some((x) => n.includes(x))) return true;
  if (EMISOR.direcciones.some((re) => re.test(n))) return true;
  return false;
}

/* ---------------- NIF ---------------- */
const RE_NIF = /(?:^|[^A-Z0-9])([ABCDEFGHJNPQRSUVW]\s?[-.]?\s?\d{2}\.?\d{3}\.?\d{2}\s?[-.]?\s?[0-9A-J]|[XYZ]\s?[-.]?\s?\d{7}\s?[-.]?\s?[A-Z]|\d{1,2}\.?\d{3}\.?\d{3}(?:\s?[-.]?\s?[A-Z])?)(?![A-Z0-9])/;
export function extraerNif(t: any): string | null {
  const n = norm(t).replace(/^(D\.?\s?N\.?\s?I\.?|N\.?\s?I\.?\s?F\.?|C\.?\s?I\.?\s?F\.?)\s*[:.]?\s*/, "");
  const m = n.match(RE_NIF);
  if (!m) return null;
  let limpio = m[1].replace(/[^A-Z0-9]/g, "");
  // CAR#3: DNI antiguo escrito sin el cero inicial ("8.704.517-Y" → 08704517Y)
  if (/^\d{7}[A-Z]$/.test(limpio)) limpio = "0" + limpio;
  if (limpio.length < 8 || limpio.length > 9) return null;
  return limpio;
}

/* ---------------- CAR#2: validación oficial de NIF / NIE / CIF (dígito o letra de control) ---------------- */
export function nifValido(nif: any): boolean {
  let n = String(nif || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^\d{7}[A-Z]$/.test(n)) n = "0" + n;
  const LETRAS = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (/^\d{8}[A-Z]$/.test(n)) return LETRAS[Number(n.slice(0, 8)) % 23] === n[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(n)) return LETRAS[Number("XYZ".indexOf(n[0]) + n.slice(1, 8)) % 23] === n[8];
  const m = n.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!m) return false;
  const d = m[2].split("").map(Number);
  let suma = 0;
  d.forEach((x, i) => { if (i % 2 === 1) suma += x; else { const y = x * 2; suma += Math.floor(y / 10) + (y % 10); } });
  const control = (10 - (suma % 10)) % 10;
  const letra = "JABCDEFGHI"[control];
  if (/[PQRSNW]/.test(m[1])) return m[3] === letra;          // organismos: letra
  if (/[ABEH]/.test(m[1])) return m[3] === String(control);   // sociedades: número
  return m[3] === String(control) || m[3] === letra;
}

/* ---------------- CLASIFICADOR DE TEXTO ----------------
   Criterio general: un cliente solo puede ser PERSONA, EMPRESA u ORGANISMO.
   Todo lo demás se clasifica por su NATURALEZA (no por una lista de frases). */
export type Clase = "dudoso_con_numero"|"vacio"|"emisor"|"identificador"|"contacto"|"etiqueta"|"fecha"|"importe"|"titulo"|"obra"|"direccion"|"poblacion"|"organismo"|"empresa"|"persona"|"dudoso";
const VOCAB_CAMPOS = /^(N\.?\s*[º°O1]?\.?\s*(DE\s*)?(FACTURA|PRESUPUESTO|ALBARAN|PEDIDO)|NUMERO|FECHA|CONCEPTO|DESCRIPCION|TOTAL|SUBTOTAL|BASE|IMPORTE|CANTIDAD|CANT\.?|PRECIO|DIRECCION|DOMICILIO|POBLACION|PROVINCIA|CLIENTE|NOMBRE|OBRA|FACTURA|PRO ?-?FORMA|PRESUPUESTO|ALBARAN|HORAS?|UNIDADES|I\.?V\.?A|FORMA DE PAGO|OBSERVACIONES|TRABAJOS?|MATERIAL(ES)?)\b/;
const RE_ORGANISMO = /\b(AYUNTAMIENTO|DIPUTACION|MANCOMUNIDAD|JUNTA DE|CONSEJERIA|MINISTERIO|CONFEDERACION|DELEGACION|GOBIERNO|UNIVERSIDAD|DIRECCION GENERAL|AGENCIA)\b/;
const RE_EMPRESA = /(\bE HIJOS?\b|\bS\.?\s?L\.?\s?U?\.?(\s|$|,)|,\s?S[,.]?\s?L|\bS\.?\s?A\.?\s?L?\.?(\s|$)|\bS\.?\s?C\.?\s?[AP]\.?\b|\bC\.?\s?B\.?$|\bS\.?\s?R\.?\s?L\b|\bSLU?$|\bUTE\b|\bSAT\b|\bASOCIACION\b|\bCOMUNIDAD\b|\bPENA\b|\bCOOPERATIVA\b|\bFUNDACION\b|\bCONSTRUCCION(ES)?\b|\bCONSTRUCTORA\b|\bPROMOCION(ES)?\b|\bINDUSTRIAS?\b|\bAGRO\w*|\bVIVEROS\b|\bMONTAJES\b|\bHNOS\b|\bHNAS\b|\bHERMANOS\b|\bEXPLOTACION(ES)?\b|\bGANADERA\b|\bTRANSPORTES\b|\bMINERALS?\b|\bINVERSIONES\b|\bSERVICIOS\b|\bESTACION DE SERVICIO\b|\bOBRAS Y\b)/;
const PROVINCIAS = "CORDOBA|BADAJOZ|SEVILLA|JAEN|MADRID|MALAGA|GRANADA|HUELVA|CADIZ|ALMERIA|CIUDAD REAL|TOLEDO|CACERES|BARCELONA|VALENCIA|MURCIA|ALICANTE|ZARAGOZA|ASTURIAS|VIZCAYA|NAVARRA|LEON|SALAMANCA|VALLADOLID|BURGOS|ALBACETE|CUENCA|GUADALAJARA";
const OTRAS_CAPITALES = "MERIDA|AZUAGA|LLERENA|ZAFRA|LUCENA|CABRA|PRIEGO|BAENA|MONTILLA|ANDUJAR|LINARES|UBEDA|JEREZ|ALGECIRAS|MARBELLA";
export function clasificarTexto(t: any): Clase {
  const n = norm(t).replace(/^[-–·.,:;\s]+/, "");
  if (!n) return "vacio";
  if (esDatoEmisor(n)) return "emisor";
  if (/^(D\.?\s?N\.?\s?I|N\.?\s?I\.?\s?F|C\.?\s?I\.?\s?F)\b/.test(n) || (extraerNif(n) && n.replace(RE_NIF, "").replace(/[^A-Z]/g, "").length < 4)) return "identificador";
  if (/(\bTELF?\b|\bTELEFONO|\bTLFNO|\bMOV\b|\bMOVIL|\bFAX\b|@|\bE-?MAIL)/.test(n)) return "contacto";
  if (/:\s*$/.test(n) || VOCAB_CAMPOS.test(n) || /^(DEL?|DE LA|LA|EL|LOS|LAS)\s/.test(n) && /\b(CLIENTE|FACTURA|OBRA|TRABAJO|DOCUMENTO)\b/.test(n) || /\b(DEL CLIENTE|DATOS DEL|FIRMA|SELLO)\b/.test(n)) return "etiqueta";
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(n) || /^\d{5}(\.\d+)?$/.test(n)) return "fecha";
  if (/^[\d.,\s€%-]+$/.test(n)) return "importe";
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}|\bHASTA\b|\bPENDIENTES?\b|\bRELACION DE\b|\bRESUMEN\b|\bLISTADO\b/.test(n)) return "titulo";
  if (/^(PER|PFEA|PROFEA|FINCA|CAMINO|CTRA\.?|CARRETERA|ARROYO|PARAJE|VEREDA|CANADA|VIA VERDE|CORTIJO)\b/.test(n)) return "obra";
  // CAR#8: "CLL" es abreviatura de Calle, tan válida como "CL." o "CL/"
  if (/^(C\/|CL\/|CL\.|CLL\b|C\.\s|CALLE\b|AVDA?\.?\s|AVENIDA|PLAZA\b|PL\.|PZA|PASEO|BARRIADA|URB\.|URBANIZACION|POLIGONO|POLG\.?\s|POL\.|PLG\.?\s|P\.?\s?I\.?\s|INDUSTRIAL\s|APARTADO|APDO)/.test(n) || /\b(S\/N|N[º°O]\s?\d+)\b/.test(n)) return "direccion";
  if (new RegExp(`\\((${PROVINCIAS}|[A-Z ]{3,20})\\)\\s*,?\\s*(\\d{5})?$`).test(n) || /,?\s*\d{5}$/.test(n) && n.split(" ").length <= 6 || new RegExp(`^(${PROVINCIAS}|${OTRAS_CAPITALES})$`).test(n)) return "poblacion";
  if (/^\d{5}\b/.test(n) || new RegExp(`^[A-Z\\- .]+\\(\\s*(${PROVINCIAS})\\s*\\)$`).test(n) || /^(FUENTE[ -]?OBEJUNA|FT\.? OBEJUNA|CORDOBA|POZOBLANCO|PENARROYA[ -]PUEBLONUEVO|BELMEZ|LA GRANJUELA|VALSEQUILLO|AZUAGA|HINOJOSA DEL DUQUE)$/.test(n)) return "poblacion";
  // municipios "X DE <provincia>" y aldeas/parajes de la zona: son lugares, no clientes
  if (new RegExp(`^[A-Z ]+\\s(DE|DEL)\\s(${PROVINCIAS})$`).test(n) && !RE_ORGANISMO.test(n) && !RE_EMPRESA.test(n)) return "poblacion";
  if (/^(LOS |LAS |EL |LA )?(OJUELOS|CARDENCHOSA|CORONADA|CUENCA|ARGALLON|PICONCILLO|POSADILLA|MORENOS?|CANADA DEL GAMO|PORVENIR|NAVALCUERVO|ALCORNOCAL|GRANJUELA|PIEDRAS BLANCAS|PANCHEZ|ALTOS|BAJOS|HOYO|ALDEAS?)\b/.test(n) && n.split(" ").length <= 4) return "obra";
  if (RE_ORGANISMO.test(n)) return "organismo";
  if (RE_EMPRESA.test(n)) return "empresa";
  if (/\d/.test(n)) return /\b\d{1,4}\s*[A-Z]?\s*$/.test(n) ? "direccion" : "dudoso_con_numero";
  const palabras = n.replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  if (/\b(POR|CON|PARA|SIN|TODO|TODOS|MEDIOS|MECANICOS|PUERTA|PRINCIPAL|TRABAJOS?|MAQUINAS?|MAQUINARIA|HORAS|METROS|CAMION|RETRO|CARGA|LIMPIEZA|ARREGLO|REPARACION|MATERIAL(ES)?|ESCOMBROS?|TIERRA|ZAHORRA|HORMIGON|NAVE|PARCELA|SOLAR|TEATRO|COLEGIOS?|PARQUE|CEMENTERIO|PISCINA|DEPURADORA|EDIFICIO|VIVIENDA|CASA|CORRAL|PALOMAS)\b/.test(n)) return "dudoso";
  if (/^[A-ZÑª. ]+$/.test(n) && palabras.length >= 2 && palabras.length <= 6 && palabras.every((p) => p.length >= 1)) return "persona";
  return "dudoso";
}
export const CLASES_ENTIDAD: Clase[] = ["persona", "empresa", "organismo"];
export function esEntidad(t: any): boolean { return CLASES_ENTIDAD.includes(clasificarTexto(t)); }

/* ---------------- fechas ---------------- */
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[a.length][b.length];
}
export function mesPorPrefijo(texto: string): string | null {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  if (t.length < 3) return null;
  if (t.startsWith("set")) return "09";
  for (let i = 0; i < 12; i++) if (MESES[i].startsWith(t) || t.startsWith(MESES[i].slice(0, 3))) return String(i + 1).padStart(2, "0");
  const ABREV: any = { sbre: "09", stbre: "09", setbre: "09", obre: "10", octbre: "10", nbre: "11", nvbre: "11", novbre: "11", dbre: "12", dcbre: "12", dicbre: "12", mzo: "03", fbro: "02", fbre: "02", ag: "08", agto: "08" };
  if (ABREV[t]) return ABREV[t];
  // abreviaturas sin vocales: "fbre", "fbro", "sbre", "nbre", "dbre", "mzo", "jnio"…
  const esq = (x: string) => x[0] + x.slice(1).replace(/[aeiou]/g, "");
  const et = esq(t);
  const porEsqueleto = MESES.map((m, i) => ({ i, e: esq(m) })).filter((x) => et.length >= 3 && x.e.startsWith(et.slice(0, 3)) && x.e[0] === et[0]);
  if (porEsqueleto.length === 1) return String(porEsqueleto[0].i + 1).padStart(2, "0");
  let best = -1, bd = 99, emp = 0;
  for (let i = 0; i < 12; i++) { if (MESES[i][0] !== t[0]) continue; const d = lev(t, MESES[i].slice(0, t.length)); if (d < bd) { bd = d; best = i; emp = 1; } else if (d === bd) emp++; }
  return best >= 0 && bd <= 2 && emp === 1 ? String(best + 1).padStart(2, "0") : null;
}
function fechaValida(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dm = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1995 && y <= 2035 && mo >= 1 && mo <= 12 && d >= 1 && d <= dm[mo - 1];
}
export function excelFecha(serial: number): string | null {
  if (!serial || isNaN(serial) || serial < 30000 || serial > 50000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  const iso = d.toISOString().slice(0, 10);
  return fechaValida(iso) ? iso : null;
}
export function fechaTexto(texto: any, anioEsperado?: string): string | null {
  const t = String(texto ?? "").trim().toLowerCase().replace(/^fecha[.:]?\s*/i, "");
  const anio = (a: string) => a.length === 4 ? (Number(a) < 1990 && anioEsperado ? anioEsperado : a) : (a.length === 3 && anioEsperado ? anioEsperado : "20" + a.slice(-2));
  let m = t.match(/^(\d{1,2})[\s\/\-\\.]*(?:de\s+)?([a-záéíóúñ]+)\.?[\/\-\\\s.]*(?:de\s+)?(\d{2,4})$/i);
  if (m) { const mes = mesPorPrefijo(m[2]); if (mes) { const r = `${anio(m[3])}-${mes}-${m[1].padStart(2, "0")}`; return fechaValida(r) ? r : null; } }
  m = t.match(/^0*(\d{1,2})[\/\-\\.]+(\d{1,2})[\/\-\\.]+(\d{2,4})$/);
  if (m) { const r = `${anio(m[3])}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return fechaValida(r) ? r : null; }
  m = t.match(/^(\d{2})(\d{2})[\/\-\\](\d{2,4})$/);
  if (m) { const r = `${anio(m[3])}-${m[2]}-${m[1]}`; return fechaValida(r) ? r : null; }
  return null;
}
function valorFecha(v: any, anioEsperado?: string): string | null {
  if (typeof v === "number") return excelFecha(v);
  if (typeof v === "string" && v.trim()) return fechaTexto(v, anioEsperado);
  return null;
}

/* ---------------- tipo documental ----------------
   Solo cuentan los TÍTULOS de la cabecera (zona antes de la tabla de conceptos) y el
   valor del campo número. Una palabra dentro de una línea de concepto NO cambia el tipo. */
export function detectarTipo(textosCabecera: string[], valorNumero?: any, archivo?: string | null): string | null {
  const vn = norm(valorNumero);
  const deArchivo = () => { const f = norm(String(archivo || "").split("/").pop()); return /\bALBAR/.test(f) ? "albaran" : /PRO-?FORMA/.test(f) ? "proforma" : /^PRES(UP)?/.test(f) ? "presupuesto" : null; };
  if (/PRO\s*-?\s*FORMA/.test(vn)) return "proforma";
  const cab = textosCabecera.map(norm).filter((t) => t && t.length <= 40);
  if (cab.some((t) => /^(FACTURA\s+)?PRO\s*-?\s*FORMA\b/.test(t))) return "proforma";
  if (cab.some((t) => /^ALBAR[AÁ]N\b/.test(t))) return "albaran";
  if (cab.some((t) => /^PRESUPUESTO\b/.test(t) && !/N[º°O]?\s*DE\s*PRESUPUESTO/.test(t))) return "presupuesto";
  // CAR#A1: la etiqueta "Nº Factura" de la plantilla con el campo VACÍO no demuestra que sea factura;
  // sin título real, manda el nombre del archivo
  if (cab.some((t) => /^FACTURA\b/.test(t))) return "factura";
  if (cab.some((t) => /^N\.?\s*[º°O1]?\.?\s*(DE\s*)?FACTURA/.test(t)) && vn && /\d/.test(vn)) return deArchivo() || "factura";
  return deArchivo();
}

/* ---------------- CLIENTE: anclado al bloque del destinatario ----------------
   Rejilla = filas x columnas (hoja) o una columna (texto libre).
   1) Se delimita el bloque del EMISOR (filas superiores con datos propios) y se excluye.
   2) Ancla = NIF que no es del emisor; si no hay, primera dirección/CP fuera del bloque emisor.
   3) Desde el ancla se sube buscando la primera celda con forma de ENTIDAD.
   4) Etiqueta explícita "Cliente/Nombre/Sr." con valor-entidad tiene prioridad.
   5) Sin evidencia suficiente → null (NO RESUELTO → revisión). Nunca se inventa. */
type Celda = { r: number; c: number; v: any; t: string; cl: Clase };
export function detectarCliente(filas: any[][], limiteFila: number, opciones: { textoLibre?: boolean } = {}) {
  const celdas: Celda[] = [];
  const lim = Math.min(limiteFila, filas.length);
  for (let r = 0; r < lim; r++) for (let c = 0; c < (filas[r] || []).length; c++) {
    const v = filas[r][c];
    if (v === "" || v == null) continue;
    const t = String(v).replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (!t) continue;
    celdas.push({ r, c, v, t, cl: typeof v === "number" ? "importe" : clasificarTexto(t) });
  }
  // 1) bloque emisor: desde arriba hasta la última fila con dato propio, ampliado con filas de
  //    solo dirección/población/contacto justo debajo (p.ej. "14290 FUENTE-OBEJUNA (CÓRDOBA)")
  const filasEmisor = new Set<number>();
  const conMarca = [...new Set(celdas.filter((x) => x.cl === "emisor").map((x) => x.r))].sort((a, b) => a - b);
  if (conMarca.length) {
    let fin = conMarca.filter((r) => r <= conMarca[0] + 6).pop()!;
    while (true) {
      const sig = celdas.filter((x) => x.r === fin + 1);
      if (sig.length && sig.every((x) => ["direccion", "poblacion", "contacto", "emisor", "identificador", "fecha"].includes(x.cl) && (x.cl !== "identificador" || esDatoEmisor(x.t)))) fin++; else break;
    }
    for (let r = 0; r <= fin; r++) filasEmisor.add(r);
  }
  // en las filas del bloque emisor solo se aprovechan celdas claramente a la derecha de los datos propios
  // (plantillas con el destinatario arriba a la derecha); el resto de esas filas se ignora
  const colMaxEmisor = (r: number) => Math.max(-1, ...celdas.filter((y) => y.r === r && (y.cl === "emisor" || y.cl === "direccion" || y.cl === "poblacion")).map((y) => y.c));
  const utiles = celdas.filter((x) => !filasEmisor.has(x.r) || (x.cl !== "emisor" && !esDatoEmisor(x.t) && x.c >= colMaxEmisor(x.r) + 2));

  let nifEtiqueta: string | null = null;
  let nombre: string | null = null, nif: string | null = null, direccion: string | null = null, poblacion: string | null = null, via = "";
  // 4) etiqueta explícita
  for (const x of utiles) {
    const m = x.t.match(/^(CLIENTE|NOMBRE|SR\.?|SRA\.?|D\.|DON|DOÑA|DESTINATARIO)\s*[:.]?\s*(.*)$/i);
    if (m && !/^(DE\s)/i.test(m[2] || "")) {
      const cand = (m[2] || "").trim() || (utiles.find((y) => y.r === x.r && y.c > x.c)?.t ?? "");
      if (cand && esEntidad(cand)) {
        nombre = cand; via = "etiqueta_cliente";
        // NIF del MISMO bloque: el más cercano por debajo del nombre (no el primero de la hoja)
        const cerca = utiles.filter((y) => y.r >= x.r && y.r <= x.r + 5 && extraerNif(y.t) && !esDatoEmisor(y.t))
          .sort((a, b) => (a.r - b.r) || (Math.abs(a.c - x.c) - Math.abs(b.c - x.c)))[0];
        nifEtiqueta = cerca ? extraerNif(cerca.t) : null;
        break;
      }
    }
  }
  // 2) ancla
  const nifsCliente = utiles.filter((x) => (x.cl === "identificador" || x.cl === "dudoso" || x.cl === "etiqueta") && extraerNif(x.t) && !esDatoEmisor(x.t));
  let ancla: Celda | null = nifsCliente[0] || null;
  if (ancla) nif = extraerNif(ancla.t);
  if (via === "etiqueta_cliente") nif = nifEtiqueta;
  // en texto libre (cartas, .doc) una dirección cualquiera no es ancla fiable: solo NIF, etiqueta u organismo
  if (!ancla && !opciones.textoLibre) ancla = utiles.find((x) => (x.cl === "poblacion" || x.cl === "direccion") && !filasEmisor.has(x.r)) || null;
  // 3) subir desde el ancla
  if (!nombre && ancla) {
    const candidatos = utiles.filter((x) => x.r <= ancla!.r && x.r >= ancla!.r - 6 && CLASES_ENTIDAD.includes(x.cl) && !esDatoEmisor(x.t))
      .sort((a, b) => (b.r - a.r) || (Math.abs(a.c - ancla!.c) - Math.abs(b.c - ancla!.c)));
    // NIF de organismo público (P/Q/S): si en el bloque hay un organismo, ese es el cliente
    if (nif && /^[PQS]/.test(nif)) { const org = candidatos.filter((x) => x.cl === "organismo"); if (org.length) candidatos.splice(0, candidatos.length, ...org); }
    // la fila más cercana por encima; en empate, la columna más próxima
    if (candidatos.length) { nombre = candidatos[0].t; via = nif ? "ancla_nif" : "ancla_direccion"; }
    else if (nif) {
      // nombre de una sola palabra (p.ej. ECOASFALT) justo encima del NIF: solo vale respaldado por ese NIF
      const d = utiles.filter((x) => x.r < ancla!.r && x.r >= ancla!.r - 3 && x.cl === "dudoso" && !esDatoEmisor(x.t)).sort((a, b) => b.r - a.r)[0];
      if (d) { nombre = d.t; via = "ancla_nif_dudoso"; }
    }
    // dirección / población del bloque
    const bloque = utiles.filter((x) => x.r >= (candidatos[0]?.r ?? ancla!.r) && x.r <= ancla!.r + 1);
    direccion = bloque.find((x) => x.cl === "direccion")?.t ?? null;
    const pob = bloque.find((x) => x.cl === "poblacion")?.t ?? null;
    poblacion = pob ? pob.replace(/^\d{5}[\s,-]*/, "").trim() : null;
  }
  // último recurso con evidencia fuerte: organismo explícito fuera del bloque emisor
  if (!nombre) {
    const org = utiles.find((x) => x.cl === "organismo" && !filasEmisor.has(x.r));
    if (org) { nombre = org.t; via = "organismo"; }
  }
  if (nombre) nombre = nombre.replace(/^[-–·.,:;\s]+/, "").replace(/\s+/g, " ").trim();
  // textos del bloque del destinatario (para contrastar identidad con NIF sin depender de una sola línea)
  const bloque = ancla ? utiles.filter((x) => x.r <= ancla!.r && x.r >= ancla!.r - 6 && !["importe", "fecha", "vacio"].includes(x.cl)).map((x) => x.t) : [];
  return { nombre, nif, direccion, poblacion, via, bloque, filas_emisor: [...filasEmisor] };
}

/* ---------------- NÚMERO ---------------- */
function numeroDesdeRejilla(filas: any[][], limiteFila: number) {
  let numero: string | null = null, valorBruto: any = null;
  for (let r = 0; r < Math.min(limiteFila + 2, filas.length) && !numero; r++) {
    const fila = filas[r] || [];
    for (let c = 0; c < fila.length && !numero; c++) {
      const v = fila[c]; if (typeof v !== "string") continue;
      const n = norm(v);
      const mInline = n.match(/^N\.?\s*[º°O1]?\.?\s*(DE\s*)?FACTURA\s*[:.]?\s*([A-Z]{0,4}[-\/]?\d+[A-Z]?([-\/]\d+)*)$/);
      if (mInline) { numero = mInline[2]; break; }
      if (!/^(N\.?\s*[º°O1]?\.?\s*(DE\s*)?FACTURA|FACTURA\s*N[º°O]?\.?|NUMERO\s*(DE\s*)?FACTURA|FACTURA)\s*[:.]?$/.test(n)) continue;
      const derecha = fila.slice(c + 1).find((x: any) => x !== "" && x != null);
      const abajo = filas[r + 1]?.[c];
      for (const cand of [derecha, abajo]) {
        if (cand == null || cand === "") continue;
        valorBruto = valorBruto ?? cand;
        const s = String(cand).trim();
        if (typeof cand === "number" ? (cand > 0 && cand < 100000 && Number.isInteger(cand)) : (/^[A-Z]{0,4}[-\/]?\d{1,6}[A-Z]?([-\/]\d{1,4})?$/i.test(s) && !/^0+[A-Z]?$/i.test(s))) { numero = s; break; }
      }
    }
  }
  return { numero, valorBruto };
}


/* ---------------- LÍNEAS, IVA Y TOTALES (hoja) ---------------- */
export function esLineaResumen(t: any) { return /^(SUBTOTAL|TOTAL|I\.?V\.?A\.?|BASE IMPONIBLE|IMPUESTO)/i.test(String(t || "").trim()); }
export function lineasYTotales(filas: any[][], wb?: any) {
  let filaCab = -1, colHoras = -1, colConcepto = -1, colPrecio = -1, colTotal = -1, colCantidad = -1;
  for (let r = 0; r < filas.length && filaCab < 0; r++) {
    const fila = filas[r] || [];
    const esCab = fila.some((v: any) => typeof v === "string" && (/^Concepto\b/i.test(v.trim()) || /Descripci[óo]n/i.test(v) || /^Lote\s*\d*$/i.test(v.trim())));
    if (!esCab) continue;
    filaCab = r;
    fila.forEach((v: any, c: number) => {
      if (typeof v !== "string") return; const t = v.trim();
      if (/^Horas?$/i.test(t)) colHoras = c;
      else if (/^(Cant\.?(idad)?|m[²³23]?|ml|ud\.?|uds\.?|unidades)$/i.test(t) && colCantidad < 0) colCantidad = c;
      else if (/^Concepto\b/i.test(t) || /Descripci[óo]n/i.test(t) || /^Lote\s*\d*$/i.test(t)) colConcepto = c;
      else if (/^Precio(\s*unitario)?$/i.test(t)) colPrecio = c;
      else if (/^(TOTAL|IMPORTE)$/i.test(t)) colTotal = c;
      else if (colTotal < 0 && colPrecio >= 0 && c > colPrecio && /^CANTIDAD$/i.test(t)) colTotal = c;
    });
  }
  const conceptos: any[] = [];
  if (filaCab >= 0 && colConcepto >= 0) {
    let blancos = 0;
    for (let r = filaCab + 1; r < filas.length; r++) {
      const f = filas[r] || [];
      const horas = colHoras >= 0 ? f[colHoras] : null, cant = colCantidad >= 0 ? f[colCantidad] : null;
      const precio = colPrecio >= 0 ? f[colPrecio] : null, tot = colTotal >= 0 ? f[colTotal] : null;
      const texto = typeof f[colConcepto] === "string" ? f[colConcepto].trim() : "";
      if (texto && esLineaResumen(texto)) break;
      if (!f.some((v: any) => v !== "")) { if (++blancos >= 5) break; continue; }
      blancos = 0;
      if (typeof horas === "number" || typeof cant === "number" || typeof tot === "number") {
        const o: any = { descripcion: texto || null, horas: typeof horas === "number" ? horas : null, precio_unitario: typeof precio === "number" ? precio : null, importe: typeof tot === "number" ? tot : null };
        if (typeof cant === "number") o.cantidad = cant; else if (typeof horas === "number") o.cantidad = horas;
        else if (o.precio_unitario != null && o.importe != null && Math.abs(o.precio_unitario - o.importe) < 0.01) o.cantidad = 1;
        conceptos.push(o);
      } else if (texto && conceptos.length) conceptos[conceptos.length - 1].descripcion = ((conceptos[conceptos.length - 1].descripcion || "") + " " + texto).trim();
    }
  }
  let importe: number | null = null, ivaPct: number | null = null, hayIva = false, tratamiento: "normal" | "isp" = "normal";
  for (const f of filas) for (const v of f) if (typeof v === "string") {
    if (/I\.?V\.?A\.?/i.test(v)) hayIva = true;
    if (ivaPct == null) { const m = v.match(/I\.?V\.?A\.?\s*(\d{1,2}(?:[.,]\d+)?)\s*%/i); if (m) ivaPct = Number(m[1].replace(",", ".")); }
    if (/inversi[oó]n\s+del\s+sujeto\s+pasivo|art\.?\s*84\.?\s*uno\.?\s*2/i.test(v)) tratamiento = "isp";
  }
  const tpl = wb?.Sheets?.["TemplateInformation"];
  if (tpl) {
    const ft: any[][] = XLSX.utils.sheet_to_json(tpl, { header: 1, raw: true, defval: "" });
    const campos = ft.find((f) => f[0] === "Nombre del campo:"), valores = ft.find((f) => f[0] === "Hace referencia a:");
    if (campos && valores) { const iT = campos.indexOf("Total de la factura"); if (iT > 0 && typeof valores[iT] === "number" && valores[iT] > 0) importe = valores[iT]; }
  }
  let subPie: number | null = null, totPie: number | null = null;
  for (const f of filas) for (let c = 0; c < f.length; c++) {
    const v = f[c]; if (typeof v !== "string") continue; const t = v.trim();
    const num = () => f.slice(c + 1).find((x: any) => typeof x === "number");
    if (subPie == null && /^(SUBTOTAL|BASE(\s+IMPONIBLE)?)\b/i.test(t)) subPie = num() ?? null;
    if (totPie == null && /^TOTAL\b/i.test(t) && !/SUBTOTAL/i.test(t)) totPie = num() ?? null;
  }
  let conflictoIvaTotal = false;
  if (totPie != null) {
    importe = totPie;
    if (ivaPct == null && subPie != null && totPie > subPie) { ivaPct = Math.round(((totPie - subPie) / subPie) * 10000) / 100; hayIva = true; }
    if (subPie != null) { const esp = ivaPct != null ? subPie * (1 + ivaPct / 100) : subPie; if (Math.abs(esp - totPie) > Math.max(totPie * 0.02, 1)) conflictoIvaTotal = true; }
  } else if (subPie != null && ivaPct != null) importe = subPie * (1 + ivaPct / 100);
  const subLineas = conceptos.reduce((a, c) => a + (c.importe || 0), 0);
  let sinIva = false;
  if (tratamiento === "isp") { ivaPct = 0; if (!importe && conceptos.length) importe = subLineas; }
  else if (!importe && conceptos.length) { importe = ivaPct != null ? subLineas * (1 + ivaPct / 100) : subLineas; if (ivaPct == null) sinIva = true; }
  else if (ivaPct == null && !hayIva) sinIva = true;
  else if (ivaPct == null && importe != null && subLineas > 0) sinIva = Math.abs(importe - subLineas) < 0.02;
  const esperado = ivaPct != null && !sinIva ? subLineas * (1 + ivaPct / 100) : subLineas;
  const cuadra = conceptos.length > 0 && importe != null && Math.abs(esperado - importe) <= Math.max(importe * 0.02, 1) && !conflictoIvaTotal;
  return { conceptos, importe, iva_pct: ivaPct, sin_iva: sinIva, tratamiento_iva: tratamiento, conflicto_iva_total: conflictoIvaTotal, matematica_cuadra: cuadra };
}

/* ---------------- HOJA DE CÁLCULO (plantilla de factura) ---------------- */
export function leerHoja(wb: any, anioEsperado?: string, opciones?: { archivo?: string }) {
  // hoja "Factura…" y, si no existe, la primera hoja que tenga forma de documento (Fecha + Nº/Factura/Concepto arriba)
  let nombreHoja = wb.SheetNames.find((n: string) => /^factura/i.test(n)) || null;
  if (!nombreHoja) nombreHoja = wb.SheetNames.find((n: string) => {
    const f: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }).slice(0, 30);
    const txt = f.flat().filter((v: any) => typeof v === "string").map(norm);
    return txt.some((t: string) => /^FECHA\b/.test(t)) && txt.some((t: string) => /(FACTURA|CONCEPTO|DESCRIPCION|PRESUPUESTO|ALBARAN|PRO ?FORMA)/.test(t));
  }) || null;
  const hoja = nombreHoja ? wb.Sheets[nombreHoja] : null;
  if (!hoja) return null;
  const filas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" });

  // cabecera de conceptos = fin de la zona de cabecera
  let filaItems = -1;
  for (let r = 0; r < filas.length && filaItems < 0; r++)
    if ((filas[r] || []).some((v: any) => typeof v === "string" && /^(CONCEPTO|DESCRIPCI[OÓ]N|CANT\.?|CANTIDAD|HORAS?)\b/i.test(v.trim()))) filaItems = r;
  const limite = filaItems >= 0 ? filaItems : Math.min(filas.length, 25);

  // fecha
  let fecha: string | null = null;
  for (let r = 0; r < limite + 1 && !fecha; r++) {
    const fila = filas[r] || [];
    for (let c = 0; c < fila.length && !fecha; c++) {
      const v = fila[c]; if (typeof v !== "string") continue;
      if (!/^\s*fecha\s*[.:]?/i.test(v)) continue;
      fecha = fechaTexto(v.replace(/^\s*fecha\s*[.:]?\s*/i, ""), anioEsperado)
        || valorFecha(fila.slice(c + 1).find((x: any) => x !== "" && x != null), anioEsperado)
        || valorFecha(filas[r + 1]?.[c], anioEsperado);
    }
  }
  if (!fecha) for (let r = 0; r < limite && !fecha; r++) for (const v of filas[r] || []) {
    if (typeof v === "string" && /^\d{1,2}[\s\/\-.]+([a-záéíóú]+|\d{1,2})[\s\/\-.]+\d{2,4}$/i.test(v.trim())) { fecha = fechaTexto(v, anioEsperado); if (fecha) break; }
  }
  // plantilla de Excel con metadatos
  const tpl = wb.Sheets["TemplateInformation"];
  let numeroTpl: string | null = null;
  if (tpl) {
    const ft: any[][] = XLSX.utils.sheet_to_json(tpl, { header: 1, raw: true, defval: "" });
    const campos = ft.find((f) => f[0] === "Nombre del campo:"), valores = ft.find((f) => f[0] === "Hace referencia a:");
    if (campos && valores) {
      const iN = campos.indexOf("N\u00famero de factura"), iF = campos.indexOf("Fecha de la factura");
      if (iN > 0 && typeof valores[iN] === "number" && valores[iN] > 0) numeroTpl = String(valores[iN]);
      if (!fecha && iF > 0 && typeof valores[iF] === "number") fecha = excelFecha(valores[iF]);
    }
  }
  const { numero: numeroRej, valorBruto } = numeroDesdeRejilla(filas, limite);
  const numero = numeroRej || numeroTpl;
  const cliente = detectarCliente(filas, limite + 1);
  const textosCab = filas.slice(0, limite).flat().filter((v: any) => typeof v === "string");
  // Decisión de Daniel: lo que dice DENTRO del documento manda sobre el nombre del archivo y la carpeta
  const tipoContenido = detectarTipo(textosCab, numero || valorBruto, null);
  const tipo = tipoContenido || detectarTipo(textosCab, numero || valorBruto, opciones?.archivo);
  const tipo_origen = tipoContenido ? "contenido" : (tipo ? "archivo" : null);
  const totales = lineasYTotales(filas, wb);
  return { hoja: nombreHoja, filas, limite, numero, fecha, cliente, tipo, tipo_origen, ...totales };
}

/* ---------------- TEXTO LIBRE (.doc / .rtf / texto de PDF) ---------------- */
export function leerTexto(texto: string, anioEsperado?: string) {
  const lineas = String(texto || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const idxTabla = lineas.findIndex((l) => /^(CONCEPTO|DESCRIPCI[OÓ]N|CANT\.?|CANTIDAD|UNIDADES|RESUMEN|CAP[IÍ]TULO)\b/i.test(l));
  const limite = idxTabla >= 0 ? idxTabla : Math.min(lineas.length, 30);
  const filas = lineas.map((l) => [l]);
  let fecha: string | null = null;
  // la fecha suele ir al pie ("Fuente Obejuna, a 7 de febrero de 2011"): se busca en todo el texto,
  // primero la fórmula de lugar+fecha y luego cualquier fecha completa
  const ordenadas = [...lineas.filter((l) => /\ba\s+\d{1,2}\s+de\s+/i.test(l)), ...lineas];
  for (const l of ordenadas) {
    const m = l.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de|del)?\s*(\d{4})/i) || l.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (m) {
      const r = isNaN(Number(m[2])) ? (mesPorPrefijo(m[2]) ? `${m[3]}-${mesPorPrefijo(m[2])}-${m[1].padStart(2, "0")}` : null) : fechaTexto(`${m[1]}/${m[2]}/${m[3]}`, anioEsperado);
      if (r && fechaValida(r)) { fecha = r; break; }
    }
  }
  let numero: string | null = null, etiquetaNumero: string | null = null;
  for (const l of lineas.slice(0, limite + 3)) {
    const m = norm(l).match(/(?:N\.?\s*[º°O1]?\.?\s*(?:DE\s*)?(?:FACTURA|PRESUPUESTO)|(?:FACTURA|PRESUPUESTO)\s*(?:N[º°O]?\.?)?)\s*[:.]?\s*([A-Z]{0,4}[-\/]?\d{1,6}[A-Z]?([-\/]\d{1,4})?)\b/);
    if (m) { numero = m[1]; etiquetaNumero = /PRESUPUESTO/.test(norm(l)) ? "presupuesto" : "factura"; break; }
  }
  const cliente = detectarCliente(filas, Math.max(limite + 1, 40), { textoLibre: true });
  // el número de un "PRESUPUESTO n" delata el tipo real del documento
  const tipo = detectarTipo(lineas.slice(0, limite), null) || (etiquetaNumero === "presupuesto" ? "presupuesto" : null);
  return { filas, limite, numero, fecha, cliente, tipo };
}

/* ---------------- RESOLUCIÓN DE IDENTIDAD DEL CLIENTE ----------------
   Orden de evidencia: NIF → nombre normalizado → alias aprendidos → similitud.
   Solo se permite ficha NUEVA si el candidato tiene forma de entidad.
   Nunca se vincula a una ficha cuyo propio nombre no es una entidad (fichas basura). */
// CAR#1: "(Departamento de …)", "(Área …)", "(Servicio …)" son subunidades del mismo cliente, no otro cliente
export function sinSubunidad(t: any) { return norm(t).replace(/\s*\((DEPARTAMENTO|DPTO|AREA|SERVICIO|DELEGACION|OFICINA|SECCION|PROGRAMA|PROYECTO)\b[^)]*\)?\s*$/, "").trim(); }
export function nombreNorm(t: any) { return sinSubunidad(t).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim(); }
const EQUIV: any = { EXCM: "EXCMO", EXMO: "EXCMO", EXM: "EXCMO", EXCMO: "EXCMO", FTE: "FUENTE", FT: "FUENTE", AYTO: "AYUNTAMIENTO" };
// palabras que describen el TIPO de negocio, no la identidad: coincidir solo en ellas no es evidencia
// (mismo motivo por el que "S.L."/"S.A." tampoco cuentan)
const GENERICAS = /^(CONSTRUCCION(ES)?|PROMOCION(ES)?|INICIATIVA|SERVICIOS|AGROPECUARIA|EXPLOTACION(ES)?|INDUSTRIAS|MONTAJES|TRANSPORTES|REFORMAS|OBRAS|Y|DE|DEL|LAS|LOS)$/;
function tokens(t: string) { return nombreNorm(t).split(" ").map((w) => EQUIV[w] || w).filter((w) => w.length > 2 && !/^(SL|SA|SLU|SAL|SCP|SCA|DEL|LAS|LOS|DE)$/.test(w)); }
// versión "distintiva": para decidir si dos nombres son la MISMA identidad, se exige solape también
// fuera de las palabras genéricas de tipo de negocio — igual que dos SL distintas no son la misma empresa
function tokensDistintivos(t: string) { return tokens(t).filter((w) => !GENERICAS.test(w)); }
export function parecidos(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const cerca = (x: string, y: string) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4)))) || (x.length >= 5 && y.length >= 5 && lev(x, y) <= 2);
  const comunes = ta.filter((x) => tb.some((y) => cerca(x, y)));
  if (comunes.length / Math.min(ta.length, tb.length) < 0.5) return false;
  // coincidir solo en la palabra genérica del tipo de negocio (CONSTRUCCIONES, SERVICIOS…) no basta:
  // hace falta que al menos una coincidencia caiga en la parte DISTINTIVA del nombre
  const da = tokensDistintivos(a), db = tokensDistintivos(b);
  if (!da.length || !db.length) return true; // nombres formados solo por palabras genéricas: no se puede exigir más
  return da.some((x) => db.some((y) => cerca(x, y)));
}
// CAR#4: dirección normalizada ("CL/ NUEVA N1" ≡ "CALLE NUEVA, 1")
export function direccionNorm(t: any) {
  return norm(t).replace(/\b\d{5}\b.*$/, "").replace(/^(C\/\.?|CL\/?\.?|CALLE|AVDA?\.?|AVENIDA|PLAZA|PL\.|PZA\.?|CTRA\.?|CARRETERA|PASEO)\s*/, "")
    .replace(/\bN\s*[º°O]?\s*(?=\d)/g, " ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function direccionesCompatibles(a: any, b: any) { const x = direccionNorm(a), y = direccionNorm(b); return !x || !y || x === y || x.startsWith(y) || y.startsWith(x); }
export async function resolverCliente(sb: any, cand: { nombre: string | null; nif: string | null; direccion?: string | null; preferidoId?: string | null; bloque?: string[]; archivo?: string | null; poblacion?: string | null }, cache?: any) {
  const nifC = cand.nif && !esDatoEmisor(cand.nif) ? cand.nif.replace(/[^A-Z0-9]/gi, "").toUpperCase() : null;
  const claseC = cand.nombre ? clasificarTexto(cand.nombre) : "vacio";
  // "dudoso" (p.ej. una sola palabra: CARIMSA, URBINA) solo vale si viene respaldado por un NIF
  const nombreOk = cand.nombre && (CLASES_ENTIDAD.includes(claseC) || (claseC === "dudoso" && nifC)) ? cand.nombre : null;
  if (!nifC && !nombreOk) return { estado: "no_resuelto", motivo: cand.nombre ? `candidato no es entidad (${clasificarTexto(cand.nombre)})` : "sin candidato" };
  const ents = cache?.entidades || (await sb.from("entidades").select("id,nombre,nif,direccion,poblacion")).data || [];
  if (cache && !cache.entidades) cache.entidades = ents;
  const validas = ents.filter((e: any) => esEntidad(e.nombre) || (clasificarTexto(e.nombre) === "dudoso" && e.nif));
  if (nifC) {
    const porNif = validas.filter((e: any) => (e.nif || "").replace(/[^A-Z0-9]/gi, "").toUpperCase() === nifC);
    if (porNif.length === 1) {
      // el NIF manda, pero si el nombre del documento no se parece en nada a la ficha de ese NIF, hay contradicción
      const textosBloque = [cand.nombre, ...(cand.bloque || [])].filter(Boolean);
      if (cand.nombre && CLASES_ENTIDAD.includes(clasificarTexto(cand.nombre)) && !textosBloque.some((t) => parecidos(t, porNif[0].nombre)))
        return { estado: "conflicto", motivo: `NIF de ${porNif[0].nombre} pero nombre ${cand.nombre}`, ids: [porNif[0].id] };
      return { estado: "existente", id: porNif[0].id, nombre: porNif[0].nombre, evidencia: "nif" };
    }
    if (porNif.length > 1 && cand.preferidoId && porNif.some((e: any) => e.id === cand.preferidoId)) return { estado: "existente", id: cand.preferidoId, evidencia: "nif (ficha actual)" };
    if (porNif.length > 1) return { estado: "revisar", motivo: `NIF ${nifC} en ${porNif.length} fichas`, ids: porNif.map((e: any) => e.id) };
  }
  if (nombreOk) {
    const nn = nombreNorm(nombreOk);
    const porNombre = validas.filter((e: any) => nombreNorm(e.nombre) === nn);
    if (porNombre.length) {
      const conNifDistinto = nifC && porNombre.every((e: any) => e.nif && e.nif.replace(/[^A-Z0-9]/gi, "").toUpperCase() !== nifC);
      if (conNifDistinto) return { estado: "conflicto", motivo: "mismo nombre, NIF distinto", ids: porNombre.map((e: any) => e.id) };
      // CAR#1: si el NIF del documento solo vivía en una ficha basura y la ficha buena no lo tiene, se le traslada
      if (porNombre.length === 1) return { estado: "existente", id: porNombre[0].id, nombre: porNombre[0].nombre, evidencia: "nombre", enriquecer_nif: nifC && !porNombre[0].nif ? nifC : null };
      if (cand.preferidoId && porNombre.some((e: any) => e.id === cand.preferidoId)) return { estado: "existente", id: cand.preferidoId, evidencia: "nombre (ficha actual)" };
      // CAR#4: fichas duplicadas del mismo cliente (mismo nombre, NIF no contradictorio, dirección compatible)
      const nifs = [...new Set(porNombre.map((e: any) => (e.nif || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()).filter(Boolean))];
      const dirsOk = porNombre.every((e: any) => porNombre.every((f: any) => direccionesCompatibles(e.direccion, f.direccion)));
      if (nifs.length <= 1 && (!nifC || !nifs.length || nifs[0] === nifC) && dirsOk) {
        if (!cache?.docsPorEntidad) {
          const { data } = await sb.from("documentos_economicos").select("entidad_id").not("entidad_id", "is", null).range(0, 9999);
          const m: any = {}; for (const r of data || []) m[r.entidad_id] = (m[r.entidad_id] || 0) + 1;
          if (cache) cache.docsPorEntidad = m; else (cand as any)._docs = m;
        }
        const docs = cache?.docsPorEntidad || (cand as any)._docs || {};
        const principal = [...porNombre].sort((a: any, b: any) => (docs[b.id] || 0) - (docs[a.id] || 0) || (b.nif ? 1 : 0) - (a.nif ? 1 : 0) || String(a.id).localeCompare(String(b.id)))[0];
        return { estado: "existente", id: principal.id, nombre: principal.nombre, evidencia: "nombre (fichas duplicadas del mismo cliente)", duplicados: porNombre.filter((e: any) => e.id !== principal.id).map((e: any) => e.id) };
      }
      return { estado: "revisar", motivo: `nombre en ${porNombre.length} fichas`, ids: porNombre.map((e: any) => e.id) };
    }
    // CAR#A1: nombre abreviado = comienzo de UNA sola ficha ("JOSE CAMACHO" → "JOSE CAMACHO MURILLO"),
    // solo con corroboración (archivo o población)
    const porPrefijo = validas.filter((e: any) => nombreNorm(e.nombre).startsWith(nn + " ") && nn.split(" ").length >= 2);
    if (porPrefijo.length === 1) {
      const e = porPrefijo[0];
      const fich = norm(String(cand.archivo || "").split("/").pop()).replace(/[^A-Z]/g, " ");
      const corrobora = nn.split(" ").filter((w) => w.length >= 4).some((w) => fich.split(" ").includes(w)) || (cand.poblacion && e.poblacion && norm(cand.poblacion).includes(norm(e.poblacion).split(" ")[0]));
      if (corrobora) return { estado: "existente", id: e.id, nombre: e.nombre, evidencia: "nombre abreviado corroborado" };
      return { estado: "revisar", motivo: `puede ser ${e.nombre}`, ids: [e.id] };
    }
    // CAR#9: nombre con erratas típicas (letra que falta, consonante cambiada) de una ficha VÁLIDA existente
    // — mismo criterio de "parecidos" que ya usamos para fusionar duplicados, aplicado a la coincidencia
    if (!nifC) {
      const porErrata = validas.filter((e: any) => CLASES_ENTIDAD.includes(clasificarTexto(e.nombre)) && parecidos(nombreOk, e.nombre));
      if (porErrata.length === 1) return { estado: "revisar", motivo: `parecido a ${porErrata[0].nombre} (posible errata)`, ids: [porErrata[0].id] };
      // varias candidatas por errata: si a su vez son duplicadas entre sí (mismo criterio que CAR#4), se
      // sugiere la más usada; nunca se elige sola, siempre queda en REVISAR
      if (porErrata.length > 1 && porErrata.every((e: any, _i: number, arr: any[]) => arr.every((f: any) => parecidos(e.nombre, f.nombre)))) {
        if (!cache?.docsPorEntidad) {
          const { data } = await sb.from("documentos_economicos").select("entidad_id").not("entidad_id", "is", null).range(0, 9999);
          const m: any = {}; for (const r of data || []) m[r.entidad_id] = (m[r.entidad_id] || 0) + 1;
          if (cache) cache.docsPorEntidad = m;
        }
        const docs = cache?.docsPorEntidad || {};
        const mejor = [...porErrata].sort((a: any, b: any) => (docs[b.id] || 0) - (docs[a.id] || 0))[0];
        return { estado: "revisar", motivo: `parecido a ${mejor.nombre} (posible errata; ${porErrata.length} fichas duplicadas)`, ids: porErrata.map((e: any) => e.id) };
      }
    }
    const alias = (cache?.alias || (await sb.from("aprendizaje_nombres_clientes").select("variante,canonico")).data || []);
    if (cache && !cache.alias) cache.alias = alias;
    const a = alias.find((x: any) => nombreNorm(x.variante) === nn);
    if (a) {
      const e = validas.filter((e: any) => nombreNorm(e.nombre) === nombreNorm(a.canonico));
      if (e.length === 1) return { estado: "existente", id: e[0].id, nombre: e[0].nombre, evidencia: "alias" };
    }
    try {
      const { data: sug } = await sb.rpc("sugerir_clientes_similares", { p_nombre: nombreOk, p_nif: nifC, p_direccion: cand.direccion || null });
      const mejor = (sug || []).find((s: any) => esEntidad(s.nombre));
      if (mejor && mejor.puntuacion >= 85) return { estado: "existente", id: mejor.id, nombre: mejor.nombre, evidencia: `similitud ${mejor.puntuacion}` };
      if (mejor && mejor.puntuacion >= 60) return { estado: "revisar", motivo: `parecido a ${mejor.nombre} (${mejor.puntuacion})`, ids: [mejor.id] };
    } catch (_) { /* sin similitud disponible */ }
    if (!CLASES_ENTIDAD.includes(claseC) && !(nifC && /^[A-HJ-NP-SUVW]/.test(nifC))) return { estado: "revisar", motivo: "nombre sin forma clara de entidad" };
    // CAR#2: alta automática solo con evidencia fuerte (forma de entidad + NIF oficial válido y libre)
    // CAR#6: un NIF "ocupado" en una ficha BASURA (Nº FACTURA, etc.) no cuenta como ocupado de verdad —
  // esas fichas son cajones de sastre sin identidad propia, no el cliente real dueño del NIF
  const nifLibre = nifC && !validas.some((e: any) => (e.nif || "").replace(/[^A-Z0-9]/gi, "").toUpperCase() === nifC);
    // CAR#5: DNI sin letra (8 cifras) solo vale si el nombre del archivo corrobora el nombre del cliente
    const tokensArchivo = norm(String(cand.archivo || "").split("/").pop()).replace(/[^A-Z]/g, " ").split(" ").filter((w) => w.length >= 4);
    const corroboraArchivo = nombreNorm(nombreOk).split(" ").filter((w) => w.length >= 4).some((w) => tokensArchivo.includes(w));
    const nifAceptable = !!nifC && (nifValido(nifC) || (/^\d{8}$/.test(nifC) && claseC === "persona" && corroboraArchivo));
    // Decisión de Daniel: sin NIF, si el nombre del ARCHIVO confirma el nombre del cliente, se da de alta
    const altaSegura = CLASES_ENTIDAD.includes(claseC) && ((nifAceptable && nifLibre) || (!nifC && corroboraArchivo));
    return { estado: "nuevo", nombre: nombreOk, nif: nifC, clase: claseC, alta_segura: altaSegura, motivo: altaSegura ? (!nifC ? "sin NIF, confirmado por el nombre del archivo" : nifValido(nifC) ? "NIF oficial válido y sin ficha" : "DNI sin letra corroborado por el nombre del archivo") : (nifC ? (nifAceptable ? "NIF ya en otra ficha" : "NIF no supera el control") : "sin NIF") };
  }
  return { estado: "no_resuelto", motivo: `NIF ${nifC} sin ficha y sin nombre válido` };
}

/* ---------------- decodificación de RTF (solo formato, sin reglas) ---------------- */
export function textoDeRTF(rtf: string): string {
  let t = rtf.replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict|object|filetbl|listtable|revtbl|generator|\*[^}]*)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, " ");
  t = t.replace(/\\par[d]?\b/g, "\n").replace(/\\line\b/g, "\n").replace(/\\tab\b/g, "\t");
  t = t.replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode(((parseInt(n, 10) % 65536) + 65536) % 65536));
  t = t.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/\\[a-zA-Z]+-?\d*\s?/g, " ").replace(/[{}]/g, "");
  return t.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/* ---------------- normalización de líneas para guardar ---------------- */
export function lineasParaGuardar(conceptos: any[]) {
  return (conceptos || []).filter((c) => c && (c.descripcion || "").trim() && !esLineaResumen(c.descripcion)).map((c) => {
    const o: any = { descripcion: String(c.descripcion).trim(), importe: Number(c.importe) || 0 };
    if (c.cantidad != null) o.cantidad = Number(c.cantidad);
    if (c.horas != null) o.horas = Number(c.horas);
    if (c.precio_unitario != null) o.precio_unitario = Number(c.precio_unitario);
    if (o.cantidad == null && o.precio_unitario != null && Math.abs(o.precio_unitario - o.importe) < 0.01) o.cantidad = 1;
    return o;
  });
}

/* ---------------- valor de un campo actual: ¿es un cliente válido? ---------------- */
export function fichaEsValida(nombre: any, nif: any): boolean {
  const cl = clasificarTexto(nombre);
  return CLASES_ENTIDAD.includes(cl) || (cl === "dudoso" && !!nif);
}
